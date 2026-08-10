/**
 * Read-only Carnap Markdown, wherever a page shows source it does not let you
 * edit — today, a saved revision's immutable text.
 *
 * The server renders that text in a `<pre>`, which is correct and complete on
 * its own; this replaces it with the same CodeMirror rendering the editor uses,
 * so a directive looks like a directive in both places rather than only in the
 * one where it can be typed. Nothing here compiles anything: the bundle is the
 * view and the Markdown language, and none of the authoring machinery.
 */
import { createMarkdownViewer } from "./markdown-editor";

const SOURCE_LABEL_ATTRIBUTE = "data-source-label";
const FOLD_LABEL_ATTRIBUTE = "data-fold-label";
const UNFOLD_LABEL_ATTRIBUTE = "data-unfold-label";

for (const host of document.querySelectorAll<HTMLElement>(
  "[data-source-view]",
)) {
  const source = host.querySelector("pre");

  if (source === null) {
    continue;
  }

  // `textContent`, not `innerText`: the latter reports the text as laid out,
  // which collapses the runs of spaces that indentation is made of.
  const value = source.textContent ?? "";
  // Server-resolved, so the name is in the reader's language without this
  // bundle carrying a catalog. A missing attribute is a page rendered before
  // this enhancement existed — leave its `<pre>` alone rather than mount an
  // unnamed region over it.
  const label = host.getAttribute(SOURCE_LABEL_ATTRIBUTE);

  if (label === null) {
    continue;
  }

  source.remove();
  createMarkdownViewer({
    // Server-resolved for the same reason the name is. Absent — a page from
    // before folding existed — leaves the controls named in the English they
    // were written in rather than unnamed.
    foldLabels: {
      fold: host.getAttribute(FOLD_LABEL_ATTRIBUTE) ?? "Fold this block",
      unfold:
        host.getAttribute(UNFOLD_LABEL_ATTRIBUTE) ?? "Unfold this block",
    },
    label,
    parent: host,
    value,
  });
  host.dataset.enhanced = "true";
}
