/**
 * Where everything in a tableau goes: the line each row sits on, the columns
 * each node spans, and the connectors between them. A pure function of the
 * document, so the server's read-only view and the browser editor draw the
 * same tree from the same answer.
 *
 * **Lines are shared across branches**, as in the textbooks: a row's number
 * is the line it sits on, and a line has one justification in the margin. A
 * row takes the first line below the row above it on its branch whose margin
 * is still free, or already carries the same justification. So when a step is
 * repeated on two branches, the two copies sit on the same lines under one
 * margin note, and a different step on another branch waits for fresh lines.
 * The lines a branch skips are drawn as a dotted guide.
 *
 * The justification a line carries is its rows' citations and the rule their
 * step names, as in the books, where a line's margin says one thing: two
 * steps on two branches citing one row by different rules (or one by a rule
 * and one not yet) take a line each, so that each margin says what its own
 * step is. A row with no citation yet stands for its own development, so it
 * shares a line only with the other rows of that step (the two sides of a
 * split, say).
 *
 * **A step is justified once**, beside its first line, as in the book: a row
 * under another of the same development continues that step, and a line of
 * such rows only has its margin left blank. That blank is what tells a step's
 * second row from a new step that cites the same row.
 *
 * **Columns are leaves.** Each leaf is one column, and a node spans the
 * columns of the leaves below it, so a node's rows are centred over its
 * branches.
 */

import type { TableauDocument, TableauNode, TableauRow } from "./document";
import { TableauIndex } from "./document";

/** A run of columns, `start` inclusive and `end` exclusive, from 0. */
export interface ColumnSpan {
  readonly start: number;
  readonly end: number;
}

export interface PlacedRow {
  readonly line: number;
  readonly span: ColumnSpan;
}

export interface PlacedNode {
  readonly span: ColumnSpan;
  /** The node's first and last row lines, or `null` for a node with no rows. */
  readonly first: number | null;
  readonly last: number | null;
}

/** The connector from a node to its children, drawn above `line`. */
export interface Fork {
  readonly node: string;
  readonly line: number;
  readonly span: ColumnSpan;
  readonly children: readonly ColumnSpan[];
}

/** Lines a column passes through with no row of its own, `from`–`to` inclusive. */
export interface Guide {
  readonly span: ColumnSpan;
  readonly from: number;
  readonly to: number;
  /**
   * The guide carries a split's branch down from the fork above `from`, so
   * it starts where the fork's arm ends, not beside it.
   */
  readonly fromFork: boolean;
}

export interface TableauLayout {
  readonly columns: number;
  /** The last line anything is drawn on. */
  readonly lines: number;
  readonly rows: ReadonlyMap<string, PlacedRow>;
  readonly nodes: ReadonlyMap<string, PlacedNode>;
  /** Each line's rows, left to right. Every row on a line shares its margin. */
  readonly lineRows: ReadonlyMap<number, readonly string[]>;
  /**
   * Each row's step head: the first row of the run of its development it sits
   * in on its node. A row that begins a step is its own head.
   */
  readonly heads: ReadonlyMap<string, string>;
  /**
   * The lines a step begins on, whose margin carries its justification. A
   * line of rows that only continue steps begun above them has none.
   */
  readonly marginLines: ReadonlySet<number>;
  /** A closed or open mark, on the line under its branch's last row. */
  readonly ends: ReadonlyMap<string, PlacedRow>;
  readonly forks: readonly Fork[];
  readonly guides: readonly Guide[];
}

/** What a line's margin says, as a key two rows can share. */
function marginKey(
  row: TableauRow,
  rules: ReadonlyMap<string, string>,
): string {
  return row.cites.length > 0
    ? JSON.stringify([[...row.cites].sort(), rules.get(row.dev) ?? ""])
    : `dev:${row.dev}`;
}

/**
 * The tableau laid out. `rules` are the rule each development names, by its
 * `dev`, which kept beside the document are part of a line's justification.
 */
export function layoutTableau(
  document: TableauDocument,
  rules: ReadonlyMap<string, string> = new Map(),
): TableauLayout {
  const index = new TableauIndex(document);
  const order = index.preorder();
  const spans = new Map<string, ColumnSpan>();
  let column = 0;

  const span = (node: TableauNode): ColumnSpan => {
    const children = index.children(node.id);

    if (children.length === 0) {
      const own = { end: column + 1, start: column };
      column += 1;
      spans.set(node.id, own);
      return own;
    }

    const parts = children.map(span);
    const own = {
      end: parts[parts.length - 1]?.end ?? column,
      start: parts[0]?.start ?? column,
    };
    spans.set(node.id, own);
    return own;
  };

  if (index.root !== null) {
    span(index.root);
  }

  const margins = new Map<number, string>();
  const rows = new Map<string, PlacedRow>();
  const nodes = new Map<string, PlacedNode>();
  const lineRows = new Map<number, string[]>();
  const heads = new Map<string, string>();
  const marginLines = new Set<number>();
  const ends = new Map<string, PlacedRow>();
  const forks: Fork[] = [];
  const guides: Guide[] = [];
  /** The last line used on each node's branch, down to and including it. */
  const bottom = new Map<string, number>();
  let lines = 0;

  for (const node of order) {
    const own = spans.get(node.id) ?? { end: 0, start: 0 };
    const above = node.parent === null ? 0 : (bottom.get(node.parent) ?? 0);
    let previous = above;
    let first: number | null = null;
    let head: TableauRow | null = null;

    for (const row of node.rows) {
      const key = marginKey(row, rules);

      if (head === null || head.dev !== row.dev) {
        head = row;
      }

      let line = previous + 1;

      while (margins.has(line) && margins.get(line) !== key) {
        line += 1;
      }

      margins.set(line, key);

      if (line > previous + 1) {
        guides.push({
          from: previous + 1,
          fromFork: first === null && node.parent !== null,
          span: own,
          to: line - 1,
        });
      }

      rows.set(row.id, { line, span: own });
      heads.set(row.id, head.id);

      if (head === row) {
        marginLines.add(line);
      }

      lineRows.set(line, [...(lineRows.get(line) ?? []), row.id]);
      first ??= line;
      previous = line;
      lines = Math.max(lines, line);
    }

    nodes.set(node.id, {
      first,
      last: first === null ? null : previous,
      span: own,
    });
    bottom.set(node.id, previous);

    if (node.end !== undefined) {
      const line = previous + 1;
      ends.set(node.id, { line, span: own });
      lines = Math.max(lines, line);
    }

    const children = index.children(node.id);

    if (children.length > 0) {
      forks.push({
        children: children.map(
          (child) => spans.get(child.id) ?? { end: 0, start: 0 },
        ),
        line: previous + 1,
        node: node.id,
        span: own,
      });
    }
  }

  // Lines listed left to right, whatever order the preorder reached them in.
  const ordered = new Map(
    [...lineRows].map(([line, ids]) => [
      line,
      [...ids].sort(
        (left, right) =>
          (rows.get(left)?.span.start ?? 0) -
          (rows.get(right)?.span.start ?? 0),
      ),
    ]),
  );

  return {
    columns: column,
    ends,
    forks,
    guides,
    heads,
    lineRows: ordered,
    lines,
    marginLines,
    nodes,
    rows,
  };
}

/**
 * The row on line `line` of the branch through a node, looking only at rows
 * above `before` if it is given: what a typed row number cites. `null` when
 * the branch has no row there.
 */
export function rowAtLine(
  index: TableauIndex,
  layout: TableauLayout,
  nodeId: string,
  line: number,
  before?: string,
): string | null {
  const candidates =
    before === undefined ? index.branchRows(nodeId) : index.rowsAbove(before);

  return (
    candidates.find((row) => layout.rows.get(row.id)?.line === line)?.id ??
    null
  );
}
