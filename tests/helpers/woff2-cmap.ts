/**
 * Which characters a `.woff2` actually paints.
 *
 * There is no way to ask a font this from Node or Bun without a font library,
 * and the question is one the platform has to be able to answer: a family that
 * is missing `∀` does not fail, it silently hands the character to whatever the
 * reader's machine has, which looks fine on the machine of whoever chose the
 * font. `tests/fonts.test.ts` is the caller; see the note there for the bug
 * that made this worth writing.
 *
 * Only as much of WOFF2 and `cmap` as that question needs: the table directory
 * (to find `cmap`'s offset in the decompressed stream) and subtable formats 4
 * and 12 (the two any modern font uses for Unicode). Nothing here handles the
 * glyf/loca transforms beyond skipping over them, because `cmap` is never
 * transformed — only the tables ahead of it have to be measured correctly.
 */

import { brotliDecompressSync } from "node:zlib";

/** Table tags by their index in a directory entry's flags, per the spec. */
const KNOWN_TAGS = [
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
  "gvar",
  "hsty",
  "just",
  "lcar",
  "mort",
  "morx",
  "opbd",
  "prop",
  "trak",
  "Zapf",
  "Silf",
  "Glat",
  "Gloc",
  "Feat",
  "Sill",
];

/** The variable-length integer a WOFF2 directory measures tables with. */
function readBase128(view: DataView, start: number): [number, number] {
  let value = 0;
  let at = start;

  for (let byte = 0; byte < 5; byte += 1) {
    const next = view.getUint8(at);
    at += 1;
    value = value * 128 + (next & 0x7f);

    if ((next & 0x80) === 0) {
      return [value, at];
    }
  }

  throw new Error("UIntBase128 longer than five bytes");
}

/** The decompressed `cmap` table, located through the WOFF2 directory. */
function cmapTable(file: Uint8Array): DataView {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);

  if (view.getUint32(0) !== 0x774f4632) {
    throw new Error("not a WOFF2 file");
  }

  const numTables = view.getUint16(12);
  let at = 48;
  let offset = 0;
  let found: { length: number; offset: number } | undefined;

  for (let table = 0; table < numTables; table += 1) {
    const flags = view.getUint8(at);
    at += 1;

    const index = flags & 0x3f;
    let tag: string;

    if (index === 0x3f) {
      tag = String.fromCharCode(
        view.getUint8(at),
        view.getUint8(at + 1),
        view.getUint8(at + 2),
        view.getUint8(at + 3),
      );
      at += 4;
    } else {
      tag = KNOWN_TAGS[index] as string;
    }

    let length: number;
    [length, at] = readBase128(view, at);

    // A transformed table occupies its transformed length in the stream. Only
    // glyf/loca (version 0) and hmtx (version 1) may be transformed at all.
    const version = flags >> 6;
    const transformed =
      ((tag === "glyf" || tag === "loca") && version === 0) ||
      (tag === "hmtx" && version === 1);

    if (transformed) {
      [length, at] = readBase128(view, at);
    }

    if (tag === "cmap") {
      found = { length, offset };
    }

    offset += length;
  }

  if (found === undefined) {
    throw new Error("no cmap table in the directory");
  }

  const tables = brotliDecompressSync(file.subarray(at));

  return new DataView(
    tables.buffer,
    tables.byteOffset + found.offset,
    found.length,
  );
}

/** Whether a format 4 subtable maps `code` to a glyph other than `.notdef`. */
function lookupFormat4(cmap: DataView, base: number, code: number): boolean {
  if (code > 0xffff) {
    return false;
  }

  const segments = cmap.getUint16(base + 6) / 2;
  const ends = base + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;

  for (let segment = 0; segment < segments; segment += 1) {
    if (cmap.getUint16(ends + segment * 2) < code) {
      continue;
    }

    if (cmap.getUint16(starts + segment * 2) > code) {
      return false;
    }

    const rangeOffset = cmap.getUint16(rangeOffsets + segment * 2);

    if (rangeOffset === 0) {
      return (code + cmap.getInt16(deltas + segment * 2)) % 0x10000 !== 0;
    }

    const at =
      rangeOffsets +
      segment * 2 +
      rangeOffset +
      (code - cmap.getUint16(starts + segment * 2)) * 2;

    return at + 1 < cmap.byteLength && cmap.getUint16(at) !== 0;
  }

  return false;
}

/** Whether a format 12 subtable maps `code`. */
function lookupFormat12(cmap: DataView, base: number, code: number): boolean {
  const groups = cmap.getUint32(base + 12);

  for (let group = 0; group < groups; group += 1) {
    const at = base + 16 + group * 12;

    if (
      cmap.getUint32(at) <= code &&
      code <= cmap.getUint32(at + 4) &&
      cmap.getUint32(at + 8) !== 0
    ) {
      return true;
    }
  }

  return false;
}

/**
 * The characters from `text` the font does *not* paint, as one string.
 *
 * Returned rather than thrown so a caller can name all of them at once: what
 * a reader needs to know is which operators went missing, not the first.
 */
export function unpaintedBy(file: Uint8Array, text: string): string {
  const cmap = cmapTable(file);
  const subtables = cmap.getUint16(2);
  const bases: number[] = [];

  for (let record = 0; record < subtables; record += 1) {
    bases.push(cmap.getUint32(4 + record * 8 + 4));
  }

  const missing = [...text].filter((character) => {
    const code = character.codePointAt(0) as number;

    return !bases.some((base) => {
      const format = cmap.getUint16(base);

      return format === 4
        ? lookupFormat4(cmap, base, code)
        : format === 12 && lookupFormat12(cmap, base, code);
    });
  });

  return missing.join("");
}
