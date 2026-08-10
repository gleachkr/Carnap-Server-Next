/**
 * Container directives, for the Markdown parser the source views are built on.
 *
 * `@lezer/markdown` knows nothing about directives, so to it `:::aufbau-mm0{…}`
 * is a paragraph and a lesson's structure is invisible. This teaches it the
 * construct: a composite block whose body is still parsed as Markdown, with the
 * fences and the name as nodes of their own. Everything that used to work off
 * the line text — the highlighting, the fold ranges — then comes off the syntax
 * tree instead.
 *
 * The server parses the same documents with `remark-directive`
 * (`authoring-toolkit.ts`), and the two must agree about what a directive is,
 * because one of them decides what the compiler sees and the other decides what
 * the author is shown. This follows micromark's container tokenizer: three or
 * more colons, then a name, then an optional `[label]` and `{attributes}`, then
 * nothing else on the line; a closing fence is colons alone, at least as many as
 * the opener's, which is what lets a `::::` block contain a `:::` one.
 *
 * One consequence of following it exactly is worth knowing, because it is not
 * what the source looks like: the closing-fence check runs at the start of every
 * line before the body is parsed, so a bare `:::` inside a fenced code block
 * inside a directive closes the directive. `tests/markdown-fold.test.ts` pins
 * that to remark's behaviour rather than to this file's opinion of it.
 *
 * Where it is looser: the label and attributes are recognized by their brackets
 * rather than parsed, so `:::note{a}b}` opens a directive here and does not for
 * remark. Highlighting a construct the compiler will reject is the safe
 * direction to err — the compiler's diagnostic still lands on the line — and
 * parsing micromark's attribute grammar a second time is not.
 */
import { Tag } from "@lezer/highlight";
import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";

const COLON = 58;
const MIN_FENCE = 3;

/**
 * A directive's name: micromark takes any run of non-punctuation, allowing `-`
 * and `_` inside but not at the end.
 */
const NAME = /^[A-Za-z0-9][\w-]*/;

/** The colons and the name — the part of a directive that is its identity. */
export const directiveTag = Tag.define();
/** Its `[label]` and `{attributes}`. */
export const directiveAttributesTag = Tag.define();

interface Opener {
  /** How many colons: a closing fence needs at least this many. */
  readonly fence: number;
  /** Line offset where the name ends and any label/attributes begin. */
  readonly nameEnd: number;
  /** Line offset where the whole opener ends, trailing space excluded. */
  readonly end: number;
}

/** How many colons `line` starts with, or -1 if it does not start with a run. */
function fenceLength(line: Line): number {
  if (line.next !== COLON) {
    return -1;
  }

  let pos = line.pos;

  while (pos < line.text.length && line.text.charCodeAt(pos) === COLON) {
    pos += 1;
  }

  return pos - line.pos;
}

function directiveOpener(line: Line): Opener | null {
  const fence = fenceLength(line);

  if (fence < MIN_FENCE) {
    return null;
  }

  const name = NAME.exec(line.text.slice(line.pos + fence))?.[0];

  // No name means this is a closing fence, or nothing at all.
  if (name === undefined || /[-_]$/.test(name)) {
    return null;
  }

  const nameEnd = line.pos + fence + name.length;
  // Whatever follows must be the label and attributes and nothing else: their
  // brackets have to open it and close it.
  const rest = line.text.slice(nameEnd).trimEnd();
  const bracketed =
    (rest.startsWith("[") || rest.startsWith("{")) &&
    (rest.endsWith("]") || rest.endsWith("}"));

  if (rest.length > 0 && !bracketed) {
    return null;
  }

  return { end: nameEnd + rest.length, fence, nameEnd };
}

/** Line offset just past a closing fence for a directive of `fence` colons. */
function directiveCloser(line: Line, fence: number): number {
  const length = fenceLength(line);

  if (length < fence) {
    return -1;
  }

  const end = line.pos + length;

  return line.text.slice(end).trim().length === 0 ? end : -1;
}

export const carnapDirectives: MarkdownConfig = {
  defineNodes: [
    {
      /**
       * Whether the block continues on this line — and, when it does not, the
       * closing fence.
       *
       * A marker registered here before returning false is what pulls the fence
       * inside the block that it closes: the parser extends the block's end to
       * cover any marker the check added. Moving the base past it is what stops
       * the fence being parsed a second time as a paragraph of its own.
       */
      composite(cx: BlockContext, line: Line, fence: number): boolean {
        const end = directiveCloser(line, fence);

        if (end < 0) {
          return true;
        }

        line.addMarker(
          cx.elt(
            "DirectiveMark",
            cx.lineStart + line.pos,
            cx.lineStart + end,
          ),
        );
        line.moveBase(line.text.length);

        return false;
      },
      block: true,
      name: "Directive",
    },
    { name: "DirectiveMark", style: directiveTag },
    { name: "DirectiveName", style: directiveTag },
    { name: "DirectiveAttributes", style: directiveAttributesTag },
  ],
  parseBlock: [
    {
      name: "Directive",
      /**
       * The opening line. The composite is started before the marks are added so
       * they land inside it, and the line is then consumed whole — a directive's
       * opener carries no content, unlike a blockquote's `>`.
       */
      parse(cx: BlockContext, line: Line): boolean | null {
        const opener = directiveOpener(line);

        if (opener === null) {
          return false;
        }

        const start = cx.lineStart + line.pos;

        cx.startComposite("Directive", line.pos, opener.fence);
        cx.addElement(cx.elt("DirectiveMark", start, start + opener.fence));
        cx.addElement(
          cx.elt(
            "DirectiveName",
            start + opener.fence,
            cx.lineStart + opener.nameEnd,
          ),
        );

        if (opener.end > opener.nameEnd) {
          cx.addElement(
            cx.elt(
              "DirectiveAttributes",
              cx.lineStart + opener.nameEnd,
              cx.lineStart + opener.end,
            ),
          );
        }

        line.moveBase(line.text.length);

        return null;
      },
      // A directive can open straight after a line of prose, with no blank line
      // between — so it has to be able to end the paragraph, as a code fence can.
      endLeaf(_cx: BlockContext, line: Line): boolean {
        return directiveOpener(line) !== null;
      },
    },
  ],
};
