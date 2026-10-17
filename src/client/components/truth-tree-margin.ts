/**
 * The truth-tree editor's margin: the citation and rule each step is written
 * with, beside its first row, as the book sets them.
 *
 * What the element does with the margin is here, as functions of the tree as
 * it stands: which lines take one, where the arrow keys go among them, what a
 * field shows, and what typing one makes of the step. The element keeps the
 * state and applies what these return. DOM-free.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import type { TableauIndex } from "../../tableau/document";
import type {
  MarginField,
  MarginNote,
  TableauAnnotations,
} from "../../tableau/html";
import type { TableauLayout } from "../../tableau/layout";
import { rowAtLine } from "../../tableau/layout";
import type { TableauKeyAction } from "../../tableau/navigate";
import { ruleSpelling } from "../../worker/exercises/truth-tree/aufbau/theory";
import type { TruthTreeStringId } from "../../worker/exercises/truth-tree/strings";

/** The element's translator. */
export type MarginWords = (
  id: TruthTreeStringId,
  values?: Readonly<Record<string, string>>,
) => string;

/**
 * A margin field typed that does not resolve: a citation of `3,` or of a row
 * not above, or a rule the theory has no name for. The step stays uncited, or
 * ruleless, and the margin keeps the text, squiggled, until it is put right.
 * Editor state, not answer: a reload keeps the tree and its rules only.
 */
export interface MarginDraft {
  readonly text: string;
  readonly problem: string;
}

/** The steps' unresolved citations and rules, by field and development. */
export type MarginDrafts = Readonly<
  Record<MarginField, ReadonlyMap<string, MarginDraft>>
>;

/** A margin field being typed: the row whose step it is, and the draft. */
export interface MarginEdit {
  readonly row: string;
  readonly draft: string;
  readonly field: MarginField;
}

/** The tree as the margin reads it, at one layout. */
export interface MarginTree {
  readonly index: TableauIndex;
  readonly layout: TableauLayout;
  /** Whether a row is one of the root's, which no step writes. */
  readonly isRootRow: (rowId: string) => boolean;
  /** A row's number in the layout. */
  readonly number: (rowId: string) => string;
}

/** Of some rows, the one furthest right in the layout. */
function rightmost(
  rows: readonly string[],
  layout: TableauLayout,
): string | null {
  let best: { id: string; start: number } | null = null;

  for (const id of rows) {
    const start = layout.rows.get(id)?.span.start;

    if (start !== undefined && (best === null || start > best.start)) {
      best = { id, start };
    }
  }

  return best?.id ?? null;
}

/** Row numbers typed as text: `4, 5`, `4 5`. `null` if any is not a number. */
function parseNumbers(text: string): number[] | null {
  const pieces = text.split(/[\s,]+/).filter((piece) => piece.length > 0);
  const numbers = pieces.map((piece) => Number(piece));

  return numbers.every((number) => Number.isInteger(number) && number > 0)
    ? numbers
    : null;
}

/** The lines whose margin can be typed in: every line below the root that begins a step. */
export function editableLines(tree: MarginTree): Set<number> {
  const lines = new Set<number>();

  for (const [line, rows] of tree.layout.lineRows) {
    if (
      tree.layout.marginLines.has(line) &&
      rows.some((row) => !tree.isRootRow(row))
    ) {
      lines.add(line);
    }
  }

  return lines;
}

/** The row a line's margin belongs to: its rightmost step head. */
export function marginHead(tree: MarginTree, line: number): string | null {
  const { layout } = tree;
  const heads = (layout.lineRows.get(line) ?? []).filter(
    (row) => layout.heads.get(row) === row && !tree.isRootRow(row),
  );

  return rightmost(heads, layout);
}

/**
 * The row whose margin → reaches from the cursor: at the end of its line,
 * with nothing further right on it, a line whose margin can be typed in.
 */
export function marginToRight(
  tree: MarginTree,
  cursor: string | null,
): string | null {
  const { layout } = tree;
  const placed = cursor === null ? undefined : layout.rows.get(cursor);

  if (
    placed === undefined ||
    !editableLines(tree).has(placed.line) ||
    [...layout.rows.values(), ...layout.ends.values()].some(
      (other) =>
        other.line === placed.line && other.span.start >= placed.span.end,
    )
  ) {
    return null;
  }

  return marginHead(tree, placed.line);
}

/** Where the selection is, while it is on a margin field. */
export interface MarginSelection {
  /** The row whose margin it is. */
  readonly cursor: string;
  /** That row, while the selection stays on its margin; null once it leaves. */
  readonly marginOf: string | null;
  readonly field: MarginField;
}

/**
 * An arrow key with the selection on a margin field: → goes on from the
 * citation to the rule, ← back to the citation and from it to the line's
 * rows, ↑ and ↓ to the same field of the lines above and below. Null for any
 * other action.
 */
export function marginMove(
  tree: MarginTree,
  selection: MarginSelection,
  action: TableauKeyAction,
): MarginSelection | null {
  const { layout } = tree;
  const line = layout.rows.get(selection.cursor)?.line;

  if (line === undefined) {
    return null;
  }

  switch (action) {
    case "left":
      return selection.field === "rule"
        ? { ...selection, field: "cites" }
        : {
            ...selection,
            cursor:
              rightmost(layout.lineRows.get(line) ?? [], layout) ??
              selection.cursor,
            marginOf: null,
          };
    case "right":
      return { ...selection, field: "rule" };
    case "up":
    case "down": {
      const lines = [...editableLines(tree)].sort((a, b) => a - b);
      const next =
        action === "up"
          ? lines.filter((each) => each < line).pop()
          : lines.find((each) => each > line);
      const head = next === undefined ? null : marginHead(tree, next);

      return head === null
        ? selection
        : { ...selection, cursor: head, marginOf: head };
    }
    default:
      return null;
  }
}

/**
 * A field of a row's margin as it shows: its draft, or the step's citation
 * as numbers, or the rule it names.
 */
export function fieldText(
  tree: MarginTree,
  drafts: MarginDrafts,
  rules: ReadonlyMap<string, string>,
  rowId: string,
  field: MarginField,
): string {
  const row = tree.index.row(rowId)?.row;

  if (row === undefined) {
    return "";
  }

  const draft = drafts[field].get(row.dev)?.text;

  if (draft !== undefined) {
    return draft;
  }

  return field === "rule"
    ? (rules.get(row.dev) ?? "")
    : row.cites.map(tree.number).join(", ");
}

/** A margin field's name, for the selection on it. */
export function marginLabel(
  tree: MarginTree,
  drafts: MarginDrafts,
  rules: ReadonlyMap<string, string>,
  rowId: string,
  field: MarginField,
  t: MarginWords,
): string {
  const row = tree.number(rowId);
  const text = fieldText(tree, drafts, rules, rowId, field);

  if (field === "rule") {
    return text === ""
      ? t("Rule of row {row}, not yet named", { row })
      : t("Rule of row {row}: {rule}", { row, rule: text });
  }

  return text === ""
    ? t("Citation of row {row}, not yet written", { row })
    : t("Citation of row {row}: {cites}", { cites: text, row });
}

/** What typing a step's rule made of it. */
export interface RuleTyped {
  readonly rules: ReadonlyMap<string, string>;
  readonly drafts: ReadonlyMap<string, MarginDraft>;
  readonly announcement: string;
}

/**
 * The step `dev` with its rule typed as `text`: the rule the theory spells
 * it, if it names one, and otherwise a draft the margin shows squiggled, with
 * the step left without a rule.
 */
export function typeRule(
  language: SurfaceLanguage,
  rules: ReadonlyMap<string, string>,
  drafts: MarginDrafts,
  dev: string,
  row: string,
  text: string,
  t: MarginWords,
): RuleTyped {
  const spelled = text === "" ? null : ruleSpelling(language, text);
  const nextRules = new Map(rules);
  const nextDrafts = new Map(drafts.rule);

  if (spelled !== null) {
    nextRules.set(dev, spelled);
    nextDrafts.delete(dev);

    return {
      announcement: t("Row {row} now names the rule {rule}.", {
        row,
        rule: spelled,
      }),
      drafts: nextDrafts,
      rules: nextRules,
    };
  }

  nextRules.delete(dev);

  if (text === "") {
    nextDrafts.delete(dev);

    return {
      announcement: t("Row {row} no longer names a rule.", { row }),
      drafts: nextDrafts,
      rules: nextRules,
    };
  }

  const announcement = t("This system has no rule called “{rule}”.", {
    rule: text,
  });
  nextDrafts.set(dev, { problem: announcement, text });

  return { announcement, drafts: nextDrafts, rules: nextRules };
}

/** Typed row numbers as the rows above `rowId` they name, or what is wrong. */
function readCitation(
  tree: MarginTree,
  text: string,
  rowId: string,
  t: MarginWords,
):
  | { readonly type: "cites"; readonly cites: string[] }
  | { readonly type: "problem"; readonly problem: string } {
  const numbers = parseNumbers(text);
  const location = tree.index.row(rowId);

  if (numbers === null || location === null) {
    return { problem: t("Type row numbers, such as 3."), type: "problem" };
  }

  const cites: string[] = [];

  for (const number of numbers) {
    const found = rowAtLine(
      tree.index,
      tree.layout,
      location.node.id,
      number,
      rowId,
    );

    if (found === null) {
      return {
        problem: t("Row {cited} is not above this row on its branch.", {
          cited: String(number),
        }),
        type: "problem",
      };
    }

    cites.push(found);
  }

  return { cites, type: "cites" };
}

/** What typing a step's citation made of it. */
export interface CitationTyped {
  /** The step's rows, every one of which cites the same rows. */
  readonly step: readonly string[];
  readonly cites: readonly string[];
  readonly drafts: ReadonlyMap<string, MarginDraft>;
  readonly announcement: string;
}

/**
 * The step of `rowId` with its citation typed as `text`: the rows it names,
 * if it names rows above, and otherwise a draft the margin shows squiggled,
 * with the step uncited. Null for a row not in the tree.
 */
export function typeCitation(
  tree: MarginTree,
  drafts: MarginDrafts,
  rowId: string,
  text: string,
  t: MarginWords,
): CitationTyped | null {
  const location = tree.index.row(rowId);

  if (location === null) {
    return null;
  }

  const read = readCitation(tree, text, rowId, t);
  const dev = location.row.dev;
  const nextDrafts = new Map(drafts.cites);
  // Every row of the step cites the same row, wherever the step put it.
  const step = tree.index.document.nodes.flatMap((node) =>
    node.rows.filter((each) => each.dev === dev).map((each) => each.id),
  );
  const row = tree.number(rowId);

  if (read.type === "problem") {
    nextDrafts.set(dev, { problem: read.problem, text });

    return {
      announcement: read.problem,
      cites: [],
      drafts: nextDrafts,
      step,
    };
  }

  nextDrafts.delete(dev);
  const [cited = "", other = ""] = read.cites;

  return {
    announcement:
      read.cites.length === 0
        ? t("Row {row} no longer cites a row.", { row })
        : read.cites.length === 2
          ? t("Row {row} now cites rows {cited} and {other}.", {
              cited: tree.number(cited),
              other: tree.number(other),
              row,
            })
          : t("Row {row} now cites row {cited}.", { cited: text, row }),
    cites: read.cites,
    drafts: nextDrafts,
    step,
  };
}

/** The margins with the unresolved citations and rules in them, squiggled. */
export function withDrafts(
  annotations: TableauAnnotations,
  tree: MarginTree,
  drafts: MarginDrafts,
): TableauAnnotations {
  const { index, layout } = tree;
  const margins = new Map<number, MarginNote>(annotations.margins);
  const flags: Record<MarginField, Set<number>> = {
    cites: new Set(annotations.flaggedMargins?.cites),
    rule: new Set(annotations.flaggedMargins?.rule),
  };

  for (const [line, rows] of layout.lineRows) {
    const devs = rows
      .filter((row) => layout.heads.get(row) === row)
      .map((row) => index.row(row)?.row.dev ?? "");

    for (const field of ["cites", "rule"] as const) {
      const draft = devs
        .map((dev) => drafts[field].get(dev))
        .find((each) => each !== undefined);

      if (draft !== undefined) {
        margins.set(line, {
          ...(margins.get(line) ?? { cites: "", rule: "" }),
          [field]: draft.text,
        });
        flags[field].add(line);
      }
    }
  }

  return { ...annotations, flaggedMargins: flags, margins };
}
