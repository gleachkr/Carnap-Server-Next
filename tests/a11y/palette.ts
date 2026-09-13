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
 * and the tests should read *that*: a `:root` block at the top level is the
 * light palette, and a `:root` block inside an `@media` is one more palette,
 * inheriting whatever it does not redeclare.
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
 * Every `:root` block `CONTENT_STYLES` declares, as raw declarations. `light`
 * is the top-level one; each `@media (…)` that redeclares `:root` contributes
 * one more under its query. A media palette lists only what it overrides —
 * resolving what it inherits is the caller's job, once it has decided what
 * a declaration is (the contrast test wants hex colours, the token test
 * wants every value).
 */
export function rootBlocks(): Map<string, string> {
  const found = new Map<string, string>();
  const roots = (blocks: CssBlock[]): string[] =>
    blocks
      .filter((block) => block.prelude === ":root")
      .map((block) => block.body);
  const top = blocksOf(stripComments(CONTENT_STYLES, false));
  const light = roots(top);

  if (light.length === 0) {
    throw new Error("no top-level :root block in CONTENT_STYLES");
  }

  found.set("light", light.join("\n"));

  for (const block of top) {
    const query = /^@media\s+\((.*)\)$/s.exec(block.prelude);

    if (query?.[1] === undefined) {
      continue;
    }

    const inner = roots(blocksOf(block.body));

    if (inner.length > 0) {
      found.set(query[1].trim(), inner.join("\n"));
    }
  }

  return found;
}
