/**
 * The revision editor's source pane: a CodeMirror view over Carnap Markdown.
 *
 * It replaces a plain `<textarea>`, which had two problems. The browser
 * spellchecked it — and a document full of directive names, attribute keys, and
 * logical operators is mostly "misspelled", so the red underlines meant nothing
 * and hid the ones that would. And the compiler's diagnostics could only be
 * listed underneath, leaving the author to count lines to find the one at fault.
 * A CodeMirror content surface is `spellcheck="false"` by default and can carry
 * the diagnostics inline, on the lines they are about.
 *
 * The textarea stays in the form and stays the thing that submits: this view
 * writes through to it on every edit. Without JS the page is exactly what it was.
 */
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  codeFolding,
  defineLanguageFacet,
  foldGutter,
  foldKeymap,
  foldNodeProp,
  HighlightStyle,
  Language,
  syntaxHighlighting,
} from "@codemirror/language";
import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { GFM, parser as markdownParser } from "@lezer/markdown";

import type { MarkdownFoldStrings } from "../worker/web/ui-strings";
import {
  carnapDirectives,
  directiveAttributesTag,
  directiveTag,
} from "./markdown-directives";
import { carnapMath, mathMarkTag, mathTag } from "./markdown-math";

/**
 * A syntax node, as much of one as the fold functions below need. Spelled out
 * rather than imported: `SyntaxNode` lives in `@lezer/common`, which this project
 * only has by way of the CodeMirror packages that depend on it.
 */
interface FoldableNode {
  readonly from: number;
  readonly lastChild: { readonly from: number; readonly name: string } | null;
  readonly to: number;
}

type FoldRange = { readonly from: number; readonly to: number };

/**
 * Fold a block away but leave the line it starts on visible — so a folded fence
 * still shows its ``` and its language, and a folded directive still shows its
 * name and attributes. The shape `@codemirror/lang-markdown` folds blocks with.
 */
const foldPastFirstLine = (
  node: FoldableNode,
  state: EditorState,
): FoldRange => ({
  from: state.doc.lineAt(node.from).to,
  to: node.to,
});

/**
 * The same, for a directive — but only once it has a closing fence.
 *
 * An unterminated directive runs to the end of the document (that is what the
 * parser does with it, and what `remark-directive` does too), so folding one
 * would hide everything below the line an author is still typing. The closing
 * fence is the block's last child when there is one; the opening fence never is,
 * because the name follows it.
 */
const foldClosedDirective = (
  node: FoldableNode,
  state: EditorState,
): FoldRange | null =>
  node.lastChild?.name === "DirectiveMark" && node.lastChild.from > node.from
    ? foldPastFirstLine(node, state)
    : null;

const FOLDABLE_BLOCKS = {
  CodeBlock: foldPastFirstLine,
  Directive: foldClosedDirective,
  FencedCode: foldPastFirstLine,
};

/**
 * Markdown built straight from the Lezer parser rather than through
 * `@codemirror/lang-markdown`.
 *
 * That package statically imports `@codemirror/lang-html` — and with it CSS and
 * JavaScript and the autocomplete machinery — to highlight embedded HTML. In
 * Carnap Markdown raw HTML is not a feature but a diagnostic
 * (`unsafe_raw_html`), so the sub-languages would highlight, prettily and
 * confidently, source the compiler is about to reject. Dropping them took the
 * viewer bundle from 0.54 MB to 0.35 MB and the editor's from 0.87 to 0.67. The
 * highlighting tags come from `@lezer/markdown` itself, so nothing is lost with
 * them.
 *
 * {@link carnapDirectives} and {@link carnapMath} add the two constructs
 * neither package knows: the container directives that are a lesson's
 * structure, and mathematics between dollars. With those in the tree,
 * highlighting and folding are both just node props.
 */
export const markdownLanguage = new Language(
  defineLanguageFacet(),
  markdownParser.configure([
    GFM,
    carnapDirectives,
    carnapMath,
    { props: [foldNodeProp.add(FOLDABLE_BLOCKS)] },
  ]),
  [],
  "markdown",
);

/**
 * Markdown highlighting in the sheet's own palette rather than CodeMirror's
 * default, which is tuned for a dark code editor and reads as a foreign object
 * on a warm paper surface. Structural marks (`#`, `*`, list bullets) are muted
 * so the prose stays dominant; only what changes meaning gets colour.
 */
const carnapHighlightStyle = HighlightStyle.define([
  // Directive lines are the document's structure, so they are the one thing
  // highlighted more strongly than the prose around them.
  { tag: directiveTag, color: "var(--blue-strong)", fontWeight: "600" },
  { tag: directiveAttributesTag, color: "var(--gold)" },
  // A formula reads as its own kind of thing, with the dollars muted the way
  // every other structural mark here is.
  { tag: mathTag, color: "var(--green)" },
  { tag: mathMarkTag, color: "var(--ink-muted)" },
  // Muted, but still text an author reads and edits — so --ink-muted, which
  // clears AA on the field's surface, rather than the fainter decorative ink.
  { tag: tags.processingInstruction, color: "var(--ink-muted)" },
  { tag: tags.heading, color: "var(--ink)", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "var(--blue)" },
  { tag: tags.url, color: "var(--blue)" },
  { tag: tags.monospace, color: "var(--green)" },
  { tag: tags.quote, color: "var(--ink-muted)" },
  { tag: tags.contentSeparator, color: "var(--ink-muted)" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
]);

/**
 * Collapse the blocks that are mostly height: fenced code, indented code, and
 * container directives. A lesson's theory panel is two hundred lines of MM0 an
 * author reads once and then scrolls past a hundred times, and an exercise block
 * is a screen of prompt around the one line being changed.
 *
 * Where the controls can live is decided by the gutter: CodeMirror marks the
 * whole of `.cm-gutters` `aria-hidden` (line numbers read aloud on every line
 * would bury the text), and `aria-hidden` cannot be undone from inside. So the
 * arrow in the gutter stays what CodeMirror makes it — a span, for the mouse,
 * carrying a translated `title` — because a focusable control there would be a
 * tab stop that no screen reader can announce. Keyboard folding is the fold
 * keymap (Ctrl-Shift-[ and ]), which is why the read-only viewer's content is
 * given a tabindex it would not otherwise have.
 *
 * The placeholder *is* a `<button>`: it sits in the content, where nothing is
 * hidden, so it can be both the visible affordance for unfolding and the tab
 * stop that does it.
 *
 * The live-region sentence the fold commands announce ("Folded lines 5 to 11")
 * is CodeMirror's own, assembled from phrases in a fixed order; it stays English
 * rather than being handed a translation it could only mangle.
 */
function folding(labels: MarkdownFoldStrings): Extension[] {
  return [
    EditorState.phrases.of({
      "Fold line": labels.fold,
      "Unfold line": labels.unfold,
    }),
    codeFolding({
      placeholderDOM: (_view, onclick) => {
        const button = document.createElement("button");

        button.className = "cm-foldPlaceholder";
        button.onclick = onclick;
        button.setAttribute("aria-label", labels.unfold);
        button.textContent = "…";
        button.type = "button";

        return button;
      },
    }),
    foldGutter(),
    keymap.of(foldKeymap),
  ];
}

/**
 * How Carnap Markdown looks, wherever it is shown. Everything here is about
 * reading the source; what the writable editor adds on top is about changing it.
 */
function presentation(labels: MarkdownFoldStrings): Extension[] {
  return [
    lineNumbers(),
    ...folding(labels),
    EditorView.lineWrapping,
    markdownLanguage,
    syntaxHighlighting(carnapHighlightStyle),
  ];
}

export interface MarkdownEditorOptions {
  /**
   * Names for the fold controls, resolved by the server: this bundle carries no
   * catalog of its own.
   */
  readonly foldLabels: MarkdownFoldStrings;
  /** The id of the visible `<label>`; CodeMirror's content is not labelable. */
  readonly labelledBy: string;
  readonly onChange: (value: string) => void;
  readonly parent: HTMLElement;
  readonly value: string;
}

export function createMarkdownEditor(
  options: MarkdownEditorOptions,
): EditorView {
  return new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.value,
      extensions: [
        ...presentation(options.foldLabels),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // CodeMirror's editable surface is a `role="textbox"` with no name of
        // its own. `<label for>` cannot reach it — that only binds to form
        // controls — so the visible label is referenced instead.
        EditorView.contentAttributes.of({
          "aria-labelledby": options.labelledBy,
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            options.onChange(update.state.doc.toString());
          }
        }),
      ],
    }),
  });
}

export interface MarkdownViewerOptions {
  /** As on {@link MarkdownEditorOptions}. */
  readonly foldLabels: MarkdownFoldStrings;
  /** The accessible name; a viewer has no label beside it to point at. */
  readonly label: string;
  readonly parent: HTMLElement;
  readonly value: string;
}

/**
 * The same rendering, for source that cannot be changed — a saved revision's
 * immutable text. Read-only *and* non-editable: `readOnly` alone would still
 * hand the reader a caret and a blinking insertion point in text no keystroke
 * can affect.
 */
export function createMarkdownViewer(
  options: MarkdownViewerOptions,
): EditorView {
  return new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.value,
      extensions: [
        ...presentation(options.foldLabels),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        // Focus and a cursor, which a non-editable view has neither of by
        // default — and without both, folding here would be mouse-only: the
        // fold commands act on the line the selection is on, and with no way to
        // move the selection that line is always the first. `readOnly` above is
        // what refuses the editing half of this keymap.
        EditorView.contentAttributes.of({
          "aria-label": options.label,
          tabindex: "0",
        }),
        keymap.of(defaultKeymap),
      ],
    }),
  });
}

/**
 * Put the compiler's diagnostics on the lines they are about.
 *
 * The compiler reports a line and (nominally) a column, but every diagnostic it
 * currently raises is about a whole construct rather than a character, and the
 * column is left at 1. Underlining the line's content — from its first non-space
 * character, so an indented directive is not underlined back to the margin — says
 * what is actually known instead of pointing at a spuriously precise spot.
 */
export function showDiagnostics(
  view: EditorView,
  diagnostics: readonly { line: number; message: string }[],
): void {
  const doc = view.state.doc;
  const marks: Diagnostic[] = [];

  for (const item of diagnostics) {
    // A diagnostic can outlive the text it describes: the author deletes the
    // offending lines and the compile that was already in flight still names
    // them. Clamping keeps a stale report in view instead of throwing.
    const line = doc.line(Math.min(Math.max(item.line, 1), doc.lines));
    const indent = line.text.length - line.text.trimStart().length;

    marks.push({
      from: line.from + (line.text.trim().length === 0 ? 0 : indent),
      message: item.message,
      severity: "error",
      to: line.to,
    });
  }

  // `setDiagnostics` builds a range set, which has to be fed in document order.
  // The compiler emits its diagnostics in the order the passes run, not the
  // order the lines appear.
  marks.sort((left, right) => left.from - right.from);

  view.dispatch(setDiagnostics(view.state, marks));
}
