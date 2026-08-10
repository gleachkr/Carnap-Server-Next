/**
 * Mathematics between dollars, for the Markdown parser the source views are
 * built on.
 *
 * The same bargain `markdown-directives.ts` makes: `@lezer/markdown` knows
 * nothing about `$…$`, so without this a formula is prose to the editor and an
 * author gets no signal at all about the one delimiter markdown has that people
 * also write for its own sake.
 *
 * That last part is why this exists rather than being nice to have. The dialect
 * only reads a single `$` as opening a formula when it touches its content on
 * both sides, so `it cost $5 and then $10` stays prose (see `inlineMathKind` in
 * `authoring-toolkit.ts`). Implemented here to the same rule, the highlighting
 * *is* the explanation: the sentence about money stays the colour of prose, and
 * a formula the author expected to be one and did not close correctly does too.
 * A test pins the two parsers to each other rather than to this file's opinion.
 *
 * Only inline math is recognized. A `$$` fence across its own lines is display
 * math to the compiler and shows here as an unremarkable paragraph, which is a
 * gap rather than a hazard — nothing is highlighted as something it is not.
 */
import { Tag } from "@lezer/highlight";
import type { InlineContext, MarkdownConfig } from "@lezer/markdown";

const DOLLAR = 36;

/** The longest run of dollars that opens a formula: `$` inline, `$$` displayed. */
const MAX_FENCE = 2;

/** The formula itself. */
export const mathTag = Tag.define();
/** Its dollars. */
export const mathMarkTag = Tag.define();

/**
 * Whitespace, or the end of the inline section — `char` answers NaN past it,
 * and a formula that runs to the end of a block never closed.
 */
function isBlank(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || Number.isNaN(code);
}

/** How many dollars start at `pos`. */
function fenceAt(cx: InlineContext, pos: number): number {
  let end = pos;

  while (cx.char(end) === DOLLAR) {
    end += 1;
  }

  return end - pos;
}

export const carnapMath: MarkdownConfig = {
  defineNodes: [
    { name: "Math", style: mathTag },
    { name: "MathMark", style: mathMarkTag },
  ],
  parseInline: [
    {
      name: "CarnapMath",
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== DOLLAR) {
          return -1;
        }

        const size = fenceAt(cx, pos);

        if (size > MAX_FENCE) {
          return -1;
        }

        const contentStart = pos + size;

        for (let scan = contentStart; scan < cx.end; scan += 1) {
          if (cx.char(scan) !== DOLLAR) {
            continue;
          }

          const closing = fenceAt(cx, scan);

          // A run of the wrong length is content, not the end — and skipping
          // past all of it is what stops `$$x$$` closing on its first dollar.
          if (closing !== size) {
            scan += closing - 1;
            continue;
          }

          // `$$` with nothing between it, and the rule that keeps prose prose.
          if (
            scan === contentStart ||
            (size === 1 &&
              (isBlank(cx.char(contentStart)) || isBlank(cx.char(scan - 1))))
          ) {
            return -1;
          }

          const end = scan + size;

          return cx.addElement(
            cx.elt("Math", pos, end, [
              cx.elt("MathMark", pos, contentStart),
              cx.elt("MathMark", scan, end),
            ]),
          );
        }

        return -1;
      },
    },
  ],
};
