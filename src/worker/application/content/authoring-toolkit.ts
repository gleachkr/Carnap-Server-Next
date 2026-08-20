import type { ElementContent } from "hast";
import type { Root, RootContent } from "mdast";
import type { ContainerDirective } from "mdast-util-directive";
import type { Extension as FromMarkdownExtension } from "mdast-util-from-markdown";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import type { InlineMath } from "mdast-util-math";
import { mathFromMarkdown } from "mdast-util-math";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { gfmTable } from "micromark-extension-gfm-table";
import { math } from "micromark-extension-math";
import type { Options as SanitizeSchema } from "rehype-sanitize";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import type { Processor } from "unified";
import { unified } from "unified";
import type { Position } from "unist";
import type {
  ContentNode,
  ExerciseCapabilities,
  ExerciseFeedback,
  ExerciseKind,
  ExerciseManifestItem,
  ExerciseRenderSpec,
} from "../../domain/content";
import type { JsonValue } from "../../domain/json";
import type { TranslatableMessage } from "../../i18n/translator";
import type { DiagnosticMessageId } from "./diagnostic-strings";
import { sha256Id, stableJson } from "./hash";
import { createMathCompiler, type MathCompiler } from "./math";
import { mathmlAttributes, mathmlTagNames } from "./math-sanitize";

/**
 * Shared authoring machinery for exercise directives. This is a leaf module:
 * the per-type `authoring.ts` files (in `src/worker/exercises/<type>/`) and
 * the top-level `compiler.ts` dispatcher both depend on it, so it must not
 * depend on either of them. It owns the markdown → sanitized-HTML pipeline,
 * the directive-attribute parsers, and the declaration/manifest assembly that
 * every exercise type shares.
 */

export type MarkdownNode = RootContent;

/**
 * One complaint about the author's source, positioned in it.
 *
 * The message is carried as data — an unfilled English template plus its values
 * — rather than as a finished sentence, because the compiler runs both in the
 * Worker and in the author's browser and has no translator in either place. The
 * revision editor words it when it lists it; everything else (the JSON error a
 * failed save returns, the tests) resolves it to English with the same call.
 */
export interface CompilerDiagnostic extends TranslatableMessage {
  readonly code: string;
  readonly column: number;
  readonly line: number;
  readonly message: DiagnosticMessageId;
}

export interface DirectiveBlock {
  readonly attrs: Record<string, string>;
  readonly bodyLines: readonly string[];
  readonly bodyStartLine: number;
  readonly children: readonly MarkdownNode[];
  readonly line: number;
  readonly name: string;
}

/** The compiled output for one exercise directive. */
export interface CompiledExercise {
  readonly manifestItem: ExerciseManifestItem;
  readonly node: ContentNode;
}

/**
 * What an exercise ID may be: an HTML id, bounded in length.
 *
 * HTML's own rule is "not empty and no ASCII whitespace", and that is very
 * nearly this one. An id reaches the page only as `data-exercise-id="…"` and,
 * for the two server-rendered answer forms, as an HTML `id`/`for` pair — none
 * of which needs a character class narrower than the one HTML already gives.
 * A tighter rule than that would only be refusing `ex1.2` to no purpose, which
 * is what this used to do.
 *
 * Excluded past HTML's rule, all for the same reason — an id that cannot be
 * seen cannot be typed back or told apart: whitespace of every kind rather than
 * just ASCII's, so a non-breaking space is not an invisible difference between
 * two ids; control characters; and format characters, which include the bidi
 * overrides that would let one id render as another.
 *
 * A dotted id has to be written `id="ex1.2"`. The `#` shorthand cannot spell
 * one, because `.` opens a class there — see `docs/carnap-markdown-v1.md`.
 */
export const EXERCISE_ID_PATTERN = /^[^\s\p{Cc}\p{Cf}]{1,64}$/u;

/**
 * The default GitHub-style sanitize schema, relaxed to keep `class`
 * attributes on every element. Compiled content renders in isolated content
 * documents, so author classes cannot restyle app chrome; nothing in the
 * dialect emits them yet, but they must survive sanitization for author CSS
 * to target them once a syntax does.
 */
export const CONTENT_SANITIZE_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Every MathML element and the presentation attributes it may carry, from
    // `math-sanitize.ts`. Listed per element rather than folded into `*` so
    // that `columnalign` on a `<p>` stays as meaningless as it sounds.
    ...mathmlAttributes(),
    // The footnote section's heading is hidden by the site's own utility class.
    // The default schema's whole `h2` entry is `[["className", "sr-only"]]` —
    // GitHub's name for the same thing — and the first definition found for a
    // key wins, so this replaces that list rather than appending to it. A class
    // that fails the check is dropped silently, which would print "Footnotes"
    // above every set of notes.
    h2: [["className", "sr-only", "visually-hidden"]],
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
  },
  // Footnote ids arrive already namespaced: `mdast-util-to-hast` prefixes the
  // `id`, the `href` that points at it, and the `aria-describedby` together.
  // The sanitizer only namespaces ids and ARIA references — never an href — so
  // letting it prefix a second time would leave every footnote link pointing at
  // an id that no longer exists. Nothing else in the dialect can author an id.
  clobberPrefix: "",
  tagNames: [...(defaultSchema.tagNames ?? []), ...mathmlTagNames()],
};

const ITEM_LINK_PREFIX = "item:";
const ITEM_LINK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * The resolver path an `item:` link compiles into. It is relative on purpose:
 * the browser resolves it against the content document's own URL, which
 * carries the course, so the compiled artifact stays course-agnostic and the
 * same revision links correctly from every course it is published into. Each
 * content-document URL has a `go` route registered two segments up.
 */
function itemLinkHref(contentItemId: string): string {
  return `../../go/${contentItemId}`;
}

/**
 * Rewrite `item:<content-item-id>` link targets into relative resolver URLs.
 * Runs on mdast before the sanitizer, which would strip the unknown scheme.
 * Invalid item IDs are left alone here — compilation already failed on them —
 * and the sanitizer drops their hrefs.
 */
function remarkItemLinks() {
  return (tree: Root): void => {
    const rewrite = (node: {
      readonly children?: readonly unknown[];
      readonly type?: string;
      url?: string;
    }): void => {
      if (
        node.type === "link" &&
        node.url !== undefined &&
        node.url.startsWith(ITEM_LINK_PREFIX)
      ) {
        const id = node.url.slice(ITEM_LINK_PREFIX.length);

        if (ITEM_LINK_ID_PATTERN.test(id)) {
          node.url = itemLinkHref(id);
        }
      }

      for (const child of node.children ?? []) {
        rewrite(child as { readonly type?: string });
      }
    };

    rewrite(tree);
  };
}

export function isItemLinkTarget(url: string): boolean {
  return url.startsWith(ITEM_LINK_PREFIX);
}

export function isValidItemLinkTarget(url: string): boolean {
  return ITEM_LINK_ID_PATTERN.test(url.slice(ITEM_LINK_PREFIX.length));
}

/**
 * Two GFM constructs, and only those two: pipe tables and footnotes. The
 * dialect takes the micromark extensions directly rather than `remark-gfm`,
 * which would also switch on strikethrough, task lists, and autolink literals —
 * and each of those changes what existing sources mean, silently. Task lists
 * are the sharp one: `- [x] id | label` is how a multiple-choice directive
 * writes its options, and GFM would read that leading `[x]` as a checkbox.
 * `mdast-util-to-hast` already knows both node types, so only the parser needs
 * teaching.
 */
function remarkTablesAndFootnotes(this: Processor): void {
  const data = this.data();

  data.micromarkExtensions = [
    ...(data.micromarkExtensions ?? []),
    gfmTable(),
    gfmFootnote(),
  ];
  data.fromMarkdownExtensions = [
    ...(data.fromMarkdownExtensions ?? []),
    gfmTableFromMarkdown(),
    gfmFootnoteFromMarkdown(),
  ];
}

declare module "mdast-util-math" {
  interface InlineMathData {
    /**
     * The dollars and all, exactly as the author typed them — `$x$`, `$$x$$`,
     * `$5 and $`. See {@link inlineMathKind} for what is read out of it.
     */
    carnapSource?: string;
  }
}

/**
 * `mdast-util-math`'s own inline handlers, with two changes.
 *
 * The first is that the node keeps the source that produced it. Everything the
 * dialect decides about a run of dollars — whether it is displayed, whether it
 * is math at all — is decided by the delimiters, and by the time an `inlineMath`
 * node exists they have been consumed: `$x$` and `$$x$$` both arrive as the
 * value `x`. `sliceSerialize` is the only place that distinction survives.
 *
 * The second is what is *not* here: the upstream handlers hang a
 * `<code class="language-math">` shape off `node.data` for a client-side
 * renderer to find later. Nothing renders on the client, so it is dead weight,
 * and {@link htmlRendererFor}'s handlers would override it in any case.
 */
const inlineMathFromMarkdown: FromMarkdownExtension = {
  enter: {
    mathText(token) {
      this.enter({ type: "inlineMath", value: "" }, token);
      this.buffer();
    },
  },
  exit: {
    mathText(token) {
      const value = this.resume();
      const node = this.stack[this.stack.length - 1] as InlineMath;

      this.exit(token);
      node.value = value;
      node.data = { ...node.data, carnapSource: this.sliceSerialize(token) };
    },
  },
};

/**
 * TeX between dollars: `$…$` inline, `$$…$$` displayed.
 *
 * The extension itself is wired in beside the gfm ones, and the same caution
 * applies as there — a construct that changes what existing prose means has to
 * earn it. `$` earns it (a logic course is going to write formulas) but it is
 * the most dangerous delimiter markdown has, because unlike a backtick or a
 * bracket it is a character people also write for its own sake. Hence
 * {@link inlineMathKind}, and hence `\$` for a literal one.
 */
function remarkMath(this: Processor): void {
  const data = this.data();

  data.micromarkExtensions = [...(data.micromarkExtensions ?? []), math()];
  data.fromMarkdownExtensions = [
    ...(data.fromMarkdownExtensions ?? []),
    mathFromMarkdown(),
    inlineMathFromMarkdown,
  ];
}

/**
 * What a run of dollars meant, read back off the source it came from.
 *
 * Two rules, both of them about matching what an author who has written LaTeX
 * already believes:
 *
 * - `$$…$$` is displayed, wherever it appears. Upstream only treats `$$` as
 *   display when it fences its own lines, so `$$\frac{a}{b}$$` alone on a line
 *   would otherwise typeset inline — a cramped fraction and no way to tell why.
 * - A single `$` must touch its formula on both sides. This is Pandoc's rule,
 *   and it is what keeps `it cost $5 and then $10` prose: the run `$5 and $`
 *   closes on a space, so it is not a formula and the literal text goes back.
 *   Without it that sentence silently sets "5 and" as mathematics, which is the
 *   worst kind of wrong — no error, no diagnostic, just mangled prose that an
 *   author finds later. The price is that `$ x $` is literal too; padding a
 *   formula with spaces is the one habit this dialect will not read.
 */
export function inlineMathKind(
  source: string,
): "display" | "inline" | "literal" {
  if (source.startsWith("$$")) {
    return "display";
  }

  const content = source.slice(1, -1);

  return /^\s|\s$/.test(content) ? "literal" : "inline";
}

export const markdownParser = unified()
  .use(remarkParse)
  .use(remarkDirective)
  .use(remarkTablesAndFootnotes)
  .use(remarkMath);

/**
 * How far through a document's footnotes the compiler has got.
 *
 * A document is not rendered as one tree. Each run of prose between two
 * exercises, and each exercise's prompt, goes through the pipeline on its own,
 * and `mdast-util-to-hast` numbers the notes of every tree it is handed from 1 —
 * so a lesson that opens a note before an exercise and another one after it
 * would show two notes numbered 1, and the reader has no way to tell them apart.
 * Blocks share this counter instead: each reads the number its first note should
 * carry, and leaves behind the number the next block should start from.
 *
 * Mutable, and handed to the blocks rather than kept in this module, because two
 * revisions can be compiling at once in one isolate and must not share a count.
 */
export interface FootnoteNumbering {
  next: number;
}

export function createFootnoteNumbering(): FootnoteNumbering {
  return { next: 1 };
}

/** Enough of a hast node to renumber footnotes by walking one. */
interface HastNodeLike {
  children?: HastNodeLike[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type?: string;
  value?: string;
}

/** The marker's number is a text child of the link: `<sup><a …>1</a></sup>`. */
function renumberMarker(link: HastNodeLike, offset: number): void {
  const [text] = link.children ?? [];

  if (text?.type === "text" && text.value !== undefined) {
    text.value = String(Number(text.value) + offset);
  }
}

/** The notes are an `<ol>` inside the section; it has to start where they do. */
function startNotesAt(section: HastNodeLike, start: number): void {
  for (const child of section.children ?? []) {
    if (child.tagName === "ol") {
      child.properties = { ...child.properties, start };
    }
  }
}

/**
 * Carry this block's notes on from the number the document has reached, and
 * namespace the heading they describe themselves by.
 *
 * `mdast-util-to-hast` counts within the tree it is handed and offers no way in:
 * the marker's number is written as text, the list restarts at 1, the back-link
 * label says which reference it returns to, and the section's heading gets the
 * literal id `footnote-label` — the one part of the markup `clobberPrefix` does
 * not touch, and not reachable through `footnoteLabelProperties`, which it
 * spreads before setting that id. (The label is the only one of those handled
 * elsewhere: it is passed as an option, since to-hast words it.) Runs before the
 * sanitizer, which allows every attribute involved but could not know which
 * heading a marker meant.
 */
function rehypeContinuedFootnotes(offset: number, labelId: string) {
  return (tree: unknown): void => {
    const rewrite = (node: HastNodeLike): void => {
      const properties = node.properties;

      if (properties !== undefined) {
        if (properties.dataFootnoteRef !== undefined) {
          properties.ariaDescribedBy = [labelId];
          renumberMarker(node, offset);
        }

        if (properties.id === "footnote-label") {
          properties.id = labelId;
        }

        if (properties.dataFootnotes !== undefined && offset > 0) {
          startNotesAt(node, offset + 1);
        }
      }

      for (const child of node.children ?? []) {
        rewrite(child);
      }
    };

    rewrite(tree as HastNodeLike);
  };
}

/**
 * The markdown → sanitized-HTML pipeline for one block: a run of prose between
 * two exercises, or one exercise's prompt.
 *
 * `offset` is how many notes the document has already numbered, which stands in
 * for the block's identity too. Ids are built from the labels the author wrote,
 * so two blocks that both use `[^1]` would mint the same id; the count is
 * distinct for every block that has notes at all (each advances it by at least
 * one), which is exactly the set of blocks that could collide.
 */
function htmlRendererFor(
  offset: number,
  mathCompiler: MathCompiler,
  lineOffset: number,
) {
  const prefix = `user-content-n${offset + 1}-`;
  const labelId = `${prefix}footnote-label`;
  const renderMath = (
    node: { readonly position?: Position; readonly value: string },
    display: boolean,
  ): ElementContent => {
    const rendered = mathCompiler.render(
      node.value,
      display,
      (node.position?.start.line ?? 1) + lineOffset,
      node.position?.start.column ?? 1,
    );

    // A formula that typesets to nothing is a formula that only defined
    // something — `$\newcommand{\Nec}{\Box}$` at the top of a document. Left
    // in, it is an empty element with a displayed block's margins above and
    // below it: a gap the author cannot account for and cannot remove.
    return rendered.type === "element" && rendered.children.length === 0
      ? { type: "text", value: "" }
      : rendered;
  };

  return (
    unified()
      .use(remarkItemLinks)
      // The section's heading is hidden with the site's own utility class
      // rather than the `sr-only` mdast-util-to-hast assumes, which this
      // stylesheet has never defined; without it the word "Footnotes" would
      // print above every set of notes.
      .use(remarkRehype, {
        clobberPrefix: prefix,
        footnoteBackLabel: (referenceIndex, rereferenceIndex) =>
          `Back to reference ${offset + referenceIndex + 1}${
            rereferenceIndex > 1 ? `-${rereferenceIndex}` : ""
          }`,
        footnoteLabelProperties: {
          className: ["visually-hidden"],
          id: labelId,
        },
        // These win over the `data.hName` the mdast nodes carry, which
        // describes the `<code class="language-math">` shape a client-side
        // renderer would look for. The formula becomes MathML here instead,
        // once, at save time.
        handlers: {
          inlineMath: (_state, node) => {
            const source = String(
              node.data?.carnapSource ?? `$${node.value}$`,
            );
            const kind = inlineMathKind(source);

            return kind === "literal"
              ? { type: "text", value: source }
              : renderMath(node, kind === "display");
          },
          math: (_state, node) => renderMath(node, true),
        },
      })
      .use(rehypeContinuedFootnotes, offset, labelId)
      .use(rehypeSanitize, CONTENT_SANITIZE_SCHEMA)
      .use(rehypeStringify)
  );
}

/**
 * What one document's compile shares across every block it renders. Threaded
 * rather than held in this module because two revisions can be compiling at once
 * in one isolate and must share neither a footnote count nor a macro table.
 */
export interface MarkdownRenderOptions {
  /**
   * The document's running footnote count, read for this block's first number
   * and advanced past the notes it emits. Omitted where a block cannot emit any:
   * an inline render carries no definitions, so its markers stay literal text.
   */
  readonly footnoteNumbering?: FootnoteNumbering;
  /**
   * Where in the document this block's own line 1 falls, when the block is
   * re-parsed from source rather than rendered from the document's tree — an
   * exercise's prompt lines, say. Positions in a tree parsed from the whole
   * source are already absolute, so prose leaves this alone.
   */
  readonly lineOffset?: number;
  /**
   * The document's TeX engine, which also collects the formulas that would not
   * parse. Omitted only by callers with no diagnostics to report them to: they
   * get a private engine, so the math still renders, but a broken formula
   * passes unremarked and document-scoped `\newcommand` does not reach them.
   */
  readonly math?: MathCompiler;
}

/**
 * The `{placeholder}` names in one message template.
 *
 * Recursive on purpose: it lets {@link diagnostic} demand exactly the values its
 * own sentence interpolates, so forgetting `params`, misspelling a name, or
 * passing one the sentence has no slot for are all type errors rather than a
 * `{name}` left showing in an author's face.
 */
type Placeholders<Message extends string> =
  Message extends `${string}{${infer Name}}${infer Rest}`
    ? Name | Placeholders<Rest>
    : never;

type DiagnosticValues<Message extends DiagnosticMessageId> = Readonly<
  Record<Placeholders<Message>, TranslatableMessage | number | string>
>;

/**
 * Report one problem in the author's source. `params` is required exactly when
 * `message` has placeholders, and then only its own names are accepted.
 */
export function diagnostic<Message extends DiagnosticMessageId>(
  line: number,
  code: string,
  message: Message,
  ...rest: [Placeholders<Message>] extends [never]
    ? [options?: { readonly column?: number }]
    : [
        options: {
          readonly column?: number;
          readonly params: DiagnosticValues<Message>;
        },
      ]
): CompilerDiagnostic {
  const options: {
    readonly column?: number;
    readonly params?: TranslatableMessage["params"];
  } = rest[0] ?? {};

  return {
    code,
    column: options.column ?? 1,
    line,
    message,
    ...(options.params === undefined ? {} : { params: options.params }),
  };
}

/**
 * Report a problem a sub-parser already worded — the starter-tree parser, whose
 * issues carry their own message and values. Separate from {@link diagnostic}
 * because the message is a variable there, so which placeholders it has is not
 * known statically and the check above cannot apply.
 */
export function diagnosticFrom(
  line: number,
  code: string,
  message: TranslatableMessage & { readonly message: DiagnosticMessageId },
  column = 1,
): CompilerDiagnostic {
  return {
    code,
    column,
    line,
    message: message.message,
    ...(message.params === undefined ? {} : { params: message.params }),
  };
}

/**
 * A node's children, if it has any. Footnote references can sit anywhere
 * phrasing content can — inside a table cell, a list item, a heading — so
 * finding them means walking rather than scanning the top level.
 */
function childrenOf(node: unknown): readonly unknown[] {
  return typeof node === "object" &&
    node !== null &&
    Array.isArray((node as { readonly children?: unknown }).children)
    ? ((node as { readonly children: readonly unknown[] }).children ?? [])
    : [];
}

function collectFootnoteIdentifiers(
  nodes: readonly unknown[],
  type: "footnoteDefinition" | "footnoteReference",
  into: Set<string>,
): Set<string> {
  for (const node of nodes) {
    const candidate = node as {
      readonly identifier?: string;
      readonly type?: string;
    };

    if (candidate.type === type && candidate.identifier !== undefined) {
      into.add(candidate.identifier);
    }

    collectFootnoteIdentifiers(childrenOf(node), type, into);
  }

  return into;
}

export function footnoteReferencesIn(
  nodes: readonly MarkdownNode[],
): ReadonlySet<string> {
  return collectFootnoteIdentifiers(nodes, "footnoteReference", new Set());
}

/**
 * Put back the literal `[^label]` for a reference whose note is not in this
 * batch of nodes. Every batch is rendered on its own — a run of prose between
 * two exercises, one exercise's prompt — and a reference the renderer cannot
 * resolve becomes a link to an id that is never emitted: a footnote marker that
 * goes nowhere when clicked and reads as a stray number to a screen reader. The
 * text the author typed is the honest thing to show instead.
 */
function withResolvableFootnotesOnly(
  nodes: readonly MarkdownNode[],
  defined: ReadonlySet<string>,
): MarkdownNode[] {
  return nodes.map((node) => {
    const candidate = node as {
      readonly identifier?: string;
      readonly label?: string;
      readonly type?: string;
    };

    if (
      candidate.type === "footnoteReference" &&
      candidate.identifier !== undefined &&
      !defined.has(candidate.identifier)
    ) {
      return {
        type: "text",
        value: `[^${candidate.label ?? candidate.identifier}]`,
      } as MarkdownNode;
    }

    const children = childrenOf(node);

    return children.length === 0
      ? node
      : ({
          ...node,
          children: withResolvableFootnotesOnly(
            children as readonly MarkdownNode[],
            defined,
          ),
        } as MarkdownNode);
  });
}

export async function renderMarkdownChildren(
  children: readonly MarkdownNode[],
  options: MarkdownRenderOptions = {},
): Promise<string> {
  const defined = collectFootnoteIdentifiers(
    children,
    "footnoteDefinition",
    new Set(),
  );
  const rendered = withResolvableFootnotesOnly(children, defined);
  const root: Root = { children: rendered, type: "root" };
  const numbering = options.footnoteNumbering;
  const renderer = htmlRendererFor(
    numbering === undefined ? 0 : numbering.next - 1,
    options.math ?? createMathCompiler(),
    options.lineOffset ?? 0,
  );
  const htmlTree = await renderer.run(root);

  if (numbering !== undefined) {
    // Every reference still standing resolves — the rest were just put back as
    // text — and a note is numbered once however often it is cited, so the
    // block's distinct references are exactly the notes it emitted.
    numbering.next += footnoteReferencesIn(rendered).size;
  }

  return renderer.stringify(htmlTree).trim();
}

export async function renderMarkdownSource(
  source: string,
  options: MarkdownRenderOptions = {},
): Promise<string> {
  const tree = markdownParser.parse(source) as Root;

  return renderMarkdownChildren(tree.children, options);
}

export async function renderInlineMarkdown(
  source: string,
  options: MarkdownRenderOptions = {},
): Promise<string> {
  const html = await renderMarkdownSource(source.trim(), options);
  const paragraph = /^<p>(.*)<\/p>$/s.exec(html);

  return paragraph?.[1] ?? html;
}

function normalizeAttributeValue(value: string | null | undefined): string {
  return value ?? "";
}

export function directiveBlockFromNode(
  directive: ContainerDirective,
  lines: readonly string[],
): DirectiveBlock {
  const startLine = directive.position?.start.line ?? 1;
  const endLine = directive.position?.end.line ?? startLine;
  const bodyStartLine = startLine + 1;
  const bodyLines = lines.slice(startLine, Math.max(startLine, endLine - 1));
  const attrs: Record<string, string> = {};

  for (const [key, value] of Object.entries(directive.attributes ?? {})) {
    attrs[key] = normalizeAttributeValue(value);
  }

  return {
    attrs,
    bodyLines,
    bodyStartLine,
    children: directive.children,
    line: startLine,
    name: directive.name,
  };
}

export function requireAttribute(
  block: DirectiveBlock,
  name: string,
  diagnostics: CompilerDiagnostic[],
): string | null {
  const value = block.attrs[name];

  if (value === undefined || value.trim().length === 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        `missing_${name}`,
        "The {name} attribute is required.",
        {
          params: { name },
        },
      ),
    );

    return null;
  }

  return value.trim();
}

export function parsePoints(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): number {
  if (value === undefined) {
    return 1;
  }

  const points = Number(value);

  if (!Number.isFinite(points) || points <= 0 || points > 1000) {
    diagnostics.push(
      diagnostic(
        line,
        "invalid_points",
        "Exercise points must be a positive number no greater than 1000.",
      ),
    );

    return 1;
  }

  return points;
}

export function parseBooleanAttribute(
  value: string | undefined,
  line: number,
  name: string,
  diagnostics: CompilerDiagnostic[],
): boolean {
  if (value === undefined || value === "false") {
    return false;
  }

  // A bare attribute ({exam}) parses as an empty string: presence means true.
  if (value === "" || value === "true") {
    return true;
  }

  diagnostics.push(
    diagnostic(
      line,
      `invalid_${name.replaceAll("-", "_")}`,
      "The {name} attribute must be true or false.",
      { params: { name } },
    ),
  );

  return false;
}

/**
 * Read `exam=`, or `undefined` when the author did not say.
 *
 * Its own parser rather than {@link parseBooleanAttribute} because the absence
 * carries information that a plain boolean cannot hold. An assignment holding
 * its grades back keeps every submission and an assignment that has released
 * them keeps only correct ones, so "no instruction" is a third value and
 * `resolveExerciseExam` settles it where the assignment is known. Collapsing it
 * to `false` here is what made `exam="false"` a no-op — indistinguishable from
 * writing nothing, in a place where the two now mean different things.
 *
 * Same vocabulary and same diagnostic as the plain parser: a bare `{exam}` is
 * presence, and therefore true.
 */
export function parseExamAttribute(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return parseBooleanAttribute(value, line, "exam", diagnostics);
}

/**
 * Read `feedback=`, or `undefined` when the author did not say.
 *
 * The absence is kept rather than defaulted here because the default is not a
 * property of the exercise: an assignment holding its grades back says nothing
 * and one that has released them says everything, and one compiled artifact
 * serves both. `resolveExerciseFeedback` settles it at render and submit time,
 * where the assignment is known.
 *
 * A bare `{feedback}` is refused along with everything else that is not one of
 * the three words — unlike `exam`, whose presence plainly means true, "some
 * feedback" is not an amount.
 */
export function parseFeedbackAttribute(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): ExerciseFeedback | undefined {
  const value = block.attrs.feedback;

  if (value === undefined) {
    return undefined;
  }

  if (value !== "full" && value !== "terse" && value !== "none") {
    diagnostics.push(
      diagnostic(
        block.line,
        "invalid_feedback",
        "The feedback attribute must be full, terse, or none.",
      ),
    );

    return undefined;
  }

  return value;
}

/**
 * Reconcile a type's own `check=` spelling with the shared `feedback=`.
 *
 * The truth table and the model each shipped a per-type knob for this before
 * there was a cross-type one — `check="cells|terse|off"` and `check="on|off"`,
 * both mirroring Carnap's `nocheck`. They keep working, so ported content does
 * not churn, but they are now two spellings of one setting and an author who
 * writes both has said one thing twice and possibly disagreed with themselves.
 *
 * `fromCheck` is what the type's own attribute worked out to, or `undefined`
 * when the author wrote neither it nor the flag — which is the distinction that
 * matters: an unwritten `check` must not read as an explicit request for full
 * detail, or it would override the `exam` default for every exercise ever
 * written.
 */
export function reconcileFeedback(
  block: DirectiveBlock,
  fromCheck: ExerciseFeedback | undefined,
  diagnostics: CompilerDiagnostic[],
): ExerciseFeedback | undefined {
  const feedback = parseFeedbackAttribute(block, diagnostics);

  if (feedback === undefined) {
    return fromCheck;
  }

  if (fromCheck !== undefined) {
    diagnostics.push(
      diagnostic(
        block.line,
        "redundant_check_attribute",
        "The check and feedback attributes say the same thing; keep feedback and drop check.",
      ),
    );
  }

  return feedback;
}

/**
 * The attributes every exercise directive takes, whatever its type.
 *
 * `id` is spelled `#id` in the source; `title` and `points` are the manifest's;
 * `exam` decides whether wrong work is recorded and `feedback` how much of the
 * verdict comes back. A type adds its own on top — see
 * {@link validateAttributes}.
 */
export const COMMON_EXERCISE_ATTRIBUTES = [
  "exam",
  "feedback",
  "id",
  "points",
  "title",
] as const;

/**
 * Reject an attribute the directive does not understand.
 *
 * Until this existed, an attribute nobody read was simply dropped: an author
 * could write `feedback="none"` on a proof exercise, or misspell `exam` as
 * `exm`, and the revision saved clean. The second is the one that bites — `exam`
 * decides whether a wrong answer is recorded at all, so a typo silently turns a
 * summative exercise back into a practice one and nothing on the page says so.
 * Silently discarding an instruction is the worst of the three options; the
 * other two are obeying it and saying you can't.
 *
 * It is a hard error rather than a warning because every diagnostic is one (see
 * `compileCarnapMarkdown`, which fails the compile on a non-empty list) and
 * there is no severity channel to put a softer one in. The cost is real and
 * accepted: a stored revision carrying a stray attribute will refuse to re-save
 * until its author deletes it.
 *
 * The message names the accepted set, because "unknown attribute" without it
 * leaves an author guessing at a spelling — the shape `parseProofOptions`
 * already uses for `options=`.
 *
 * `accepted` is the whole list, not the per-type remainder: `aufbau-mm0` is a
 * directive without being an exercise, so it has none of
 * {@link COMMON_EXERCISE_ATTRIBUTES} and would have to opt out of a set it was
 * given implicitly. The exercise types spread the common ones in themselves.
 */
export function validateAttributes(
  block: DirectiveBlock,
  accepted: readonly string[],
  diagnostics: CompilerDiagnostic[],
): void {
  const known = new Set<string>(accepted);
  const listed = [...accepted].sort().join(", ");

  for (const name of Object.keys(block.attrs)) {
    if (known.has(name)) {
      continue;
    }

    diagnostics.push(
      diagnostic(
        block.line,
        "unknown_attribute",
        "Unknown attribute “{name}”. This directive accepts: {accepted}.",
        { params: { accepted: listed, name } },
      ),
    );
  }
}

export function validateExerciseId(
  block: DirectiveBlock,
  id: string,
  diagnostics: CompilerDiagnostic[],
): void {
  if (!EXERCISE_ID_PATTERN.test(id)) {
    diagnostics.push(
      diagnostic(
        block.line,
        "invalid_exercise_id",
        "Exercise IDs must be 1 to 64 characters long and contain no spaces.",
      ),
    );
  }
}

/**
 * Assemble the shared declaration, manifest item, and content node for one
 * exercise. The declaration (which is hashed) deliberately omits `capabilities`
 * and only carries `exam` and `feedback` when set, so existing content keeps its
 * recorded declaration hashes; the title is normalized to `null` when empty
 * there and omitted from the manifest item.
 */
export async function buildCompiledExercise(input: {
  readonly answerKind: string;
  readonly capabilities: ExerciseCapabilities;
  readonly exam: boolean | undefined;
  readonly feedback: ExerciseFeedback | undefined;
  readonly id: string;
  readonly kind: ExerciseKind;
  readonly nominalPoints: number;
  readonly privateData: unknown;
  readonly publicData: unknown;
  readonly render: ExerciseRenderSpec;
  readonly schemaVersion: number;
  readonly title: string | undefined;
}): Promise<CompiledExercise> {
  const hasTitle = input.title !== undefined && input.title.length > 0;
  // Absent unless the author said, like `feedback` below — so content written
  // before either attribute existed still hashes to what the database recorded.
  // The `false` is carried, though: it is now a different instruction from
  // silence, and an exercise that spells it out gets a new hash on next save.
  const examFields = input.exam === undefined ? {} : { exam: input.exam };
  // Absent unless the author said, so every declaration hash written before
  // `feedback` existed still hashes to what the database recorded.
  const feedbackFields =
    input.feedback === undefined ? {} : { feedback: input.feedback };
  const declaration = {
    answerKind: input.answerKind,
    ...examFields,
    ...feedbackFields,
    id: input.id,
    kind: input.kind,
    nominalPoints: input.nominalPoints,
    privateData: input.privateData,
    publicData: input.publicData,
    render: input.render,
    schemaVersion: input.schemaVersion,
    title: hasTitle ? (input.title as string) : null,
  };
  const manifestItem: ExerciseManifestItem = {
    answerKind: input.answerKind,
    capabilities: input.capabilities,
    declarationHash: await sha256Id(stableJson(declaration)),
    ...examFields,
    ...feedbackFields,
    id: input.id,
    kind: input.kind,
    nominalPoints: input.nominalPoints,
    privateData: input.privateData as JsonValue,
    publicData: input.publicData as JsonValue,
    render: input.render,
    schemaVersion: input.schemaVersion,
    ...(hasTitle ? { title: input.title as string } : {}),
  };
  const node: ContentNode = {
    exerciseId: input.id,
    exerciseKind: input.kind,
    kind: "exercise",
    publicData: input.publicData as JsonValue,
    render: input.render,
  };

  return { manifestItem, node };
}
