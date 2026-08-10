import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CONTENT_STYLES } from "../../src/worker/web/styles";

/**
 * The palette's integrity, as two facts about `var()`.
 *
 * Shadow-DOM stylesheets are written `var(--token, <fallback>)`, and the
 * fallback is not decoration: a content document rendered with `cssReset`
 * (`src/worker/web/content-document.tsx`) carries no stylesheet of ours at all,
 * so there the fallback is the only colour a widget has. That makes the pattern
 * load-bearing and, left unchecked, quietly wrong in two ways:
 *
 *   1. a `var(--x)` whose `--x` is not defined anywhere renders as its
 *      fallback *forever*, so the token layer silently does not reach it;
 *   2. a fallback that has drifted from its token pins the value it was
 *      copied from, which was always a light one.
 *
 * Neither is visible in light mode — the fallback and the token agree closely
 * enough to look right — and both are plainly visible under a dark palette,
 * where a stale light hex sits glowing in the middle of a dark widget. This
 * test is what makes the second palette safe: it fails at the moment the two
 * disagree rather than at the moment somebody looks at the page in the dark.
 *
 * Found on introduction: three tokens used and never defined (`--sheet`,
 * `--sheet-2`, `--fitch-scope`) and twenty-six fallbacks disagreeing with their
 * token, most of them a `--green` left at the pre-AA `#26935d`.
 */

const SOURCE_ROOT = join(import.meta.dir, "..", "..", "src");

/** Blank out comments, preserving offsets, so prose naming a token is not read
 *  as CSS. The doc comment above `:root` says `var(--token, <fallback>)`. */
function stripComments(text: string): string {
  const out = [...text];
  let index = 0;

  while (index < text.length - 1) {
    const two = text.slice(index, index + 2);

    if (two !== "/*" && two !== "//") {
      index += 1;
      continue;
    }

    const close =
      two === "/*"
        ? text.indexOf("*/", index + 2)
        : text.indexOf("\n", index);
    const end = close === -1 ? text.length : two === "/*" ? close + 2 : close;

    for (let blank = index; blank < end; blank += 1) {
      if (out[blank] !== "\n") {
        out[blank] = " ";
      }
    }

    index = end;
  }

  return out.join("");
}

/** The light palette, as `name -> value`. Values may wrap across lines. */
function paletteTokens(): Map<string, string> {
  const block = /:root \{(.*?)\n {2}\}/s.exec(stripComments(CONTENT_STYLES));

  if (block?.[1] === undefined) {
    throw new Error("no :root block in CONTENT_STYLES");
  }

  const tokens = new Map<string, string>();

  for (const match of block[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gs)) {
    tokens.set(
      match[1] as string,
      (match[2] as string).split(/\s+/).join(" "),
    );
  }

  return tokens;
}

interface VarUse {
  readonly fallback: string | undefined;
  readonly line: number;
  readonly name: string;
}

/**
 * Every `var(...)` in a file. Scanned with a paren counter rather than matched
 * with a regex, because a fallback can itself be a `color-mix(...)` call and
 * `[^)]+` would stop inside it.
 */
function varUses(text: string): VarUse[] {
  const uses: VarUse[] = [];

  for (const match of text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
    let index = match.index + match[0].length;
    let depth = 1;

    while (index < text.length && depth > 0) {
      if (text[index] === "(") {
        depth += 1;
      } else if (text[index] === ")") {
        depth -= 1;

        if (depth === 0) {
          break;
        }
      }

      index += 1;
    }

    const inner = text.slice(match.index + match[0].length, index).trim();

    uses.push({
      fallback: inner.startsWith(",")
        ? inner.slice(1).trim().split(/\s+/).join(" ")
        : undefined,
      line: text.slice(0, match.index).split("\n").length,
      name: match[1] as string,
    });
  }

  return uses;
}

/** `#abc` and `#AABBCC` are the same colour; compare them as one. */
function normalize(value: string): string {
  const lower = value.trim().toLowerCase();

  return /^#[0-9a-f]{3}$/.test(lower)
    ? `#${[...lower.slice(1)].map((digit) => digit + digit).join("")}`
    : lower;
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }

  return found.sort();
}

const TOKENS = paletteTokens();
const FILES = sourceFiles(SOURCE_ROOT);

test("the palette defines every token the source asks for", () => {
  const missing: string[] = [];

  for (const file of FILES) {
    const text = stripComments(readFileSync(file, "utf8"));

    for (const use of varUses(text)) {
      if (!TOKENS.has(use.name)) {
        missing.push(
          `${file.slice(SOURCE_ROOT.length + 1)}:${use.line}: ${use.name}`,
        );
      }
    }
  }

  expect(missing).toEqual([]);
});

test("every var() fallback repeats its token's light value", () => {
  const drifted: string[] = [];

  for (const file of FILES) {
    const text = stripComments(readFileSync(file, "utf8"));

    for (const use of varUses(text)) {
      const value = TOKENS.get(use.name);

      if (
        use.fallback !== undefined &&
        value !== undefined &&
        normalize(use.fallback) !== normalize(value)
      ) {
        drifted.push(
          `${file.slice(SOURCE_ROOT.length + 1)}:${use.line}: ${use.name}` +
            ` is ${value}, fallback says ${use.fallback}`,
        );
      }
    }
  }

  expect(drifted).toEqual([]);
});
