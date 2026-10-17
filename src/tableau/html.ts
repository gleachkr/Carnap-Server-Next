/**
 * A tableau as static markup: what a server draws for a first paint or a
 * review, from the same layout the browser editor draws from.
 *
 * The grid has a column of row numbers, one column per leaf, and a margin
 * column; each line of the layout is two grid rows, a thin one for the
 * connectors above it and one for its rows. The consumer supplies everything
 * that means anything (marks, margin notes, which rows to flag, how to
 * describe a row to a screen reader) as {@link TableauAnnotations}.
 *
 * The drawn grid is hidden from assistive technology, which reads the outline
 * list after it instead: the tree's nodes as nested lists, each row described
 * in words. The live editor replaces both with an ARIA tree.
 */

import type { TableauDocument, TableauNode } from "./document";
import { TableauIndex } from "./document";
import type { ColumnSpan, Guide, TableauLayout } from "./layout";

/**
 * A line's margin note, `1 ∨`: the rows its step cites, and the rule the step
 * names. Either may be blank.
 */
export interface MarginNote {
  readonly cites: string;
  readonly rule: string;
}

/** The two fields of a margin note. */
export type MarginField = keyof MarginNote;

export interface TableauAnnotations {
  /** A row's mark, after its text: `✓`, `\a,b`. */
  readonly marks?: ReadonlyMap<string, string>;
  /** A line's margin note. */
  readonly margins?: ReadonlyMap<number, MarginNote>;
  /** Rows and branch ends to draw as wrong. */
  readonly flagged?: ReadonlySet<string>;
  /** Lines whose margin citation, or rule, to draw as wrong. */
  readonly flaggedMargins?: Readonly<
    Partial<Record<MarginField, ReadonlySet<number>>>
  >;
  /** The note under a branch's end mark: the rows a closure cites. */
  readonly endNotes?: ReadonlyMap<string, string>;
  /** A row in words, for the outline. */
  readonly describeRow: (rowId: string) => string;
  /** A branch's end in words, for the outline. */
  readonly describeEnd: (nodeId: string) => string;
  /** A split's branch in words, for the outline: "Branch 1 of 2". */
  readonly describeBranch: (position: number, count: number) => string;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '"': "&quot;",
  "&": "&amp;",
  "'": "&#39;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** The grid row a line's content sits in; its connectors sit one above. */
export function contentRow(line: number): number {
  return 2 * line;
}

/**
 * The grid rows a guide runs down: from the connector above its first line,
 * or, under a fork, from where the fork's arm ends, to the connector below
 * its last.
 */
export function guideRows(guide: Guide): string {
  const top = contentRow(guide.from) - (guide.fromFork ? 0 : 1);
  return `${top} / ${contentRow(guide.to) + 1}`;
}

/** The grid columns a span of leaves covers, after the numbers column. */
export function gridColumns(span: ColumnSpan): string {
  return `${span.start + 2} / ${span.end + 2}`;
}

/**
 * The connector from a node to its children, in a 100 × 10 box: one line from
 * the middle of the node's span to the middle of each child's.
 */
export function forkPath(
  span: ColumnSpan,
  children: readonly ColumnSpan[],
): string {
  const width = Math.max(1, span.end - span.start);

  return children
    .map((child) => {
      const centre = ((child.start + child.end) / 2 - span.start) / width;
      return `M50 0 L${(centre * 100).toFixed(2)} 10`;
    })
    .join(" ");
}

/** The grid's columns: the numbers, one per leaf, and the margin. */
export function gridTemplate(columns: number, gutter = "2.2rem"): string {
  return `${gutter} repeat(${Math.max(1, columns)}, minmax(6.5rem, 1fr)) minmax(3.5rem, auto)`;
}

/** End-mark symbols: closed, and open and complete. */
export const END_SYMBOLS = { closed: "×", open: "↑" } as const;

export function tableauGridHtml(
  document: TableauDocument,
  layout: TableauLayout,
  annotations: TableauAnnotations,
): string {
  const index = new TableauIndex(document);
  const parts: string[] = [];
  const flagged = annotations.flagged ?? new Set<string>();

  for (const [line, ids] of layout.lineRows) {
    const row = contentRow(line);
    parts.push(
      `<span class="tableau-number" style="grid-row:${row};grid-column:1">${line}</span>`,
    );
    const margin = annotations.margins?.get(line);

    if (margin !== undefined) {
      const field = (name: MarginField, flags?: ReadonlySet<number>) =>
        margin[name] === ""
          ? ""
          : `<span class="tableau-margin-${name}"${flags?.has(line) === true ? " data-flagged" : ""}>${escapeText(margin[name])}</span>`;
      const fields = [
        field("cites", annotations.flaggedMargins?.cites),
        field("rule", annotations.flaggedMargins?.rule),
      ].filter((each) => each !== "");

      parts.push(
        `<span class="tableau-margin" style="grid-row:${row};grid-column:${layout.columns + 2}">${fields.join(" ")}</span>`,
      );
    }

    for (const id of ids) {
      const placed = layout.rows.get(id);
      const text = index.row(id)?.row.text ?? "";
      const mark = annotations.marks?.get(id);

      if (placed === undefined) {
        continue;
      }

      parts.push(
        `<span class="tableau-row"${flagged.has(id) ? " data-flagged" : ""} style="grid-row:${row};grid-column:${gridColumns(placed.span)}"><span class="tableau-text">${escapeText(text)}</span>${
          mark === undefined
            ? ""
            : `<span class="tableau-mark">${escapeText(mark)}</span>`
        }</span>`,
      );
    }
  }

  for (const fork of layout.forks) {
    parts.push(
      `<svg aria-hidden="true" class="tableau-fork" focusable="false" preserveAspectRatio="none" style="grid-row:${contentRow(fork.line) - 1};grid-column:${gridColumns(fork.span)}" viewBox="0 0 100 10"><path d="${forkPath(fork.span, fork.children)}"/></svg>`,
    );
  }

  for (const guide of layout.guides) {
    parts.push(
      `<span class="tableau-guide"${guide.fromFork ? " data-from-fork" : ""} style="grid-row:${guideRows(guide)};grid-column:${gridColumns(guide.span)}"></span>`,
    );
  }

  for (const [nodeId, placed] of layout.ends) {
    const end = index.nodes.get(nodeId)?.end;

    if (end === undefined) {
      continue;
    }

    const note = annotations.endNotes?.get(nodeId);

    parts.push(
      `<span class="tableau-end" data-end="${end.type}"${flagged.has(nodeId) ? " data-flagged" : ""} style="grid-row:${contentRow(placed.line)};grid-column:${gridColumns(placed.span)}"><span class="tableau-end-mark">${END_SYMBOLS[end.type]}</span>${
        note === undefined
          ? ""
          : `<span class="tableau-end-note">${escapeText(note)}</span>`
      }</span>`,
    );
  }

  return `<div aria-hidden="true" class="tableau-grid" style="grid-template-columns:${gridTemplate(layout.columns)}">${parts.join("")}</div>`;
}

/** The tree in words: nested lists, one per node, each row described. */
export function tableauOutlineHtml(
  document: TableauDocument,
  annotations: TableauAnnotations,
): string {
  const index = new TableauIndex(document);

  const node = (current: TableauNode): string => {
    const rows = current.rows
      .map((row) => `<li>${escapeText(annotations.describeRow(row.id))}</li>`)
      .join("");
    const end =
      current.end === undefined
        ? ""
        : `<li>${escapeText(annotations.describeEnd(current.id))}</li>`;
    const children = index.children(current.id);
    const branches =
      children.length === 0
        ? ""
        : `<li><ul>${children
            .map(
              (child, position) =>
                `<li>${escapeText(annotations.describeBranch(position + 1, children.length))}<ul>${node(child)}</ul></li>`,
            )
            .join("")}</ul></li>`;

    return `${rows}${end}${branches}`;
  };

  return index.root === null
    ? ""
    : `<ul class="tableau-outline">${node(index.root)}</ul>`;
}
