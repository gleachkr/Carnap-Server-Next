import { CONTENT_STYLES } from "../../src/worker/web/styles";

/**
 * How the palette tests find the `:root` blocks in the served stylesheet.
 *
 * Both `contrast.test.ts` and `tokens.test.ts` once found them with a regex
 * over the indentation the CSS had while it lived in a template literal. When
 * the rules moved to `.css` files the indentation went with them, and the
 * regexes went on matching — the wrong block, or both blocks at once — so the
 * suite kept passing while measuring the dark palette as "light" and finding
 * no second palette at all. The lesson is that a stylesheet has a structure
 * and the tests should read *that*: the `:root` block is the palette, and
 * each `light-dark()` pair in it is the two palettes at once.
 */

interface CssBlock {
  /** Whatever precedes the `{`: a selector list, or an at-rule prelude. */
  readonly prelude: string;
  /** The text between the braces, nested blocks included. */
  readonly body: string;
}

/**
 * Blank out comments, preserving offsets and line breaks, so prose naming a
 * token is not read as CSS. `//` is a comment in TypeScript and nothing in
 * CSS, where it would sit inside a `url(https://…)`; the caller says which.
 */
export function stripComments(text: string, lineComments: boolean): string {
  const out = [...text];
  let index = 0;

  while (index < text.length - 1) {
    const two = text.slice(index, index + 2);

    if (two !== "/*" && !(lineComments && two === "//")) {
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

/**
 * The blocks at one nesting level of a comment-free stylesheet, found by
 * counting braces rather than by matching indentation. Called on the whole
 * sheet it yields the top-level rules; called on an `@media` body it yields
 * the rules inside it.
 */
export function blocksOf(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = 0;

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];

    if (char === "{") {
      if (depth === 0) {
        bodyStart = index + 1;
      }

      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        blocks.push({
          body: css.slice(bodyStart, index),
          prelude: css.slice(preludeStart, bodyStart - 1).trim(),
        });
        preludeStart = index + 1;
      }
    } else if (char === ";" && depth === 0) {
      // A top-level statement such as `@import …;` has no block.
      preludeStart = index + 1;
    }
  }

  return blocks;
}

/**
 * The top-level comma of a `light-dark(a, b)` value — the one that is not
 * inside a nested `color-mix(...)` or `var(...)`.
 */
function splitPair(inner: string): [string, string] | undefined {
  let depth = 0;

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];

    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      return [inner.slice(0, index).trim(), inner.slice(index + 1).trim()];
    }
  }

  return undefined;
}

/**
 * The two palettes `CONTENT_STYLES` declares, each as raw `--token: value;`
 * declarations: `light` and `dark`. There is one `:root` block, and every
 * colour in it is a `light-dark(a, b)` pair, so the two palettes are the two
 * halves of that block — a token written without the pair (a font, a measure,
 * a derived value) is the same in both. Splitting the pairs here is what lets
 * the contrast test measure dark as a palette of its own and the token test
 * compare a fallback against the light half alone.
 *
 * A `:root` inside an `@media` is refused rather than read: the palette is
 * keyed on `color-scheme`, which an author's stylesheet can pin, and not on
 * the media query, which nothing an author writes can switch off. A second
 * block under a query would quietly bring that back.
 */
export function rootBlocks(): Map<string, string> {
  const top = blocksOf(stripComments(CONTENT_STYLES, false));
  const roots = top.filter((block) => block.prelude === ":root");

  if (roots.length === 0) {
    throw new Error("no top-level :root block in CONTENT_STYLES");
  }

  for (const block of top) {
    if (
      /^@media\b/.test(block.prelude) &&
      blocksOf(block.body).some((inner) => inner.prelude === ":root")
    ) {
      throw new Error(
        `a :root block under ${block.prelude}: the palette is keyed on color-scheme, not on a media query`,
      );
    }
  }

  const light: string[] = [];
  const dark: string[] = [];

  for (const block of roots) {
    for (const match of block.body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gs)) {
      const name = match[1] as string;
      const value = (match[2] as string).trim();
      const pair = /^light-dark\((.*)\)$/s.exec(value);
      const halves = pair?.[1] === undefined ? undefined : splitPair(pair[1]);

      if (pair !== null && halves === undefined) {
        throw new Error(`${name}: light-dark() with no top-level comma`);
      }

      light.push(`${name}: ${halves === undefined ? value : halves[0]};`);
      dark.push(`${name}: ${halves === undefined ? value : halves[1]};`);
    }
  }

  return new Map([
    ["light", light.join("\n")],
    ["dark", dark.join("\n")],
  ]);
}
