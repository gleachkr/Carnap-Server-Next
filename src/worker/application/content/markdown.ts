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
import type { DirectiveBlock } from "../../exercise-kit/authoring";
import { createMathCompiler, type MathCompiler } from "./math";
import { mathmlAttributes, mathmlTagNames } from "./math-sanitize";

/**
 * The Markdown side of authoring: the parser and its extensions, the sanitize
 * schema, footnote numbering, the block and inline renderers every prompt goes
 * through, and the cut from a parsed directive node to the
 * {@link DirectiveBlock} the exercise kit works in. `compiler.ts` drives it
 * over the document; the per-type `authoring.ts` files call the renderers on
 * their prompts.
 *
 * What a directive is *to an exercise* — the attribute parsers, the manifest
 * assembly — is the kit's, in `exercise-kit/authoring.ts`, and the diagnostic
 * envelope both sides report through is `diagnostics.ts`. This module reads
 * the block type back from the kit and nothing else from it, so the kit stays
 * on the consuming side of the application's Markdown pipeline.
 */

export type MarkdownNode = RootContent;

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
