/**
 * A tree's problems and verdict in words, for the widget's live feedback and
 * Check line and for the review page alike.
 *
 * Rows are named by the number a reader sees, which the layout gives them,
 * so every function here takes a `number` lookup from row id to that number.
 * DOM-free and catalog-free: it words through a {@link TreeWords} lookup,
 * which the browser fills from its hydration strings.
 */

import type { TableauDocument } from "../../../tableau/document";
import { TableauIndex } from "../../../tableau/document";
import type { TableauLayout } from "../../../tableau/layout";
import { layoutTableau } from "../../../tableau/layout";
import type { MessageResolver } from "../../i18n/translator";
import type { EngineFailure } from "./aufbau/judge";
import type { TreeJudgement } from "./grading";
import type { EndProblem, RowProblem, TreeProblem } from "./report";
import type { TruthTreeVerdict } from "./types";

export type TreeWords = MessageResolver;

/** A row's number as a reader sees it, or `?` for a row that is not there. */
export type RowNumber = (rowId: string) => string;

/** The row numbers a layout gives. */
export function layoutNumbers(layout: TableauLayout): RowNumber {
  return (rowId) => {
    const line = layout.rows.get(rowId)?.line;
    return line === undefined ? "?" : String(line);
  };
}

/** The row numbers of a tree, from its layout. */
function rowNumbers(
  tree: TableauDocument,
  rules: ReadonlyMap<string, string>,
): RowNumber {
  return layoutNumbers(layoutTableau(tree, rules));
}

/** A row's note, said of that row: "Row 4: …". */
export function atRow(
  note: string,
  rowId: string,
  words: TreeWords,
  number: RowNumber,
): string {
  return words("Row {row}: {problem}", { problem: note, row: number(rowId) });
}

/**
 * A branch end's note, said of its branch by the row it ends at: "The branch
 * ending at row 7: …".
 */
export function atBranchEnd(
  note: string,
  lastRowId: string | undefined,
  words: TreeWords,
  number: RowNumber,
): string {
  return words("The branch ending at row {row}: {problem}", {
    problem: note,
    row: lastRowId === undefined ? "?" : number(lastRowId),
  });
}

/** What is wrong with a row, said of that row; `cites` is its citation. */
export function describeRowProblem(
  problem: RowProblem,
  cites: readonly string[],
  words: TreeWords,
  number: RowNumber,
): string {
  const [cited, other] = cites;
  const citedRow = cited === undefined ? "?" : number(cited);
  const otherRow = other === undefined ? "?" : number(other);

  switch (problem.type) {
    case "empty":
      return words(
        "This row is empty: write a sentence on it, or delete it.",
      );
    case "unreadable": {
      const error = problem.errors[0];
      return error === undefined
        ? words("This formula could not be read.")
        : words(
            error.message,
            error.params as Readonly<Record<string, string>> | undefined,
          );
    }
    case "root-mismatch":
      return words("This is not the sentence the exercise gives.");
    case "uncited":
      return words(
        "Say which row this row comes from: type that row's number in the margin.",
      );
    case "cites-differ":
      return words("The rows of one step must cite the same row.");
    case "cite-not-above":
      return words("Row {cited} is not above this row on its branch.", {
        cited: number(problem.cite),
      });
    case "no-rule-named":
      return words(
        "Name the rule this step uses: type it in the margin, after the row it develops.",
      );
    case "step-wrong":
      return other === undefined
        ? words("The rule named does not give this from row {cited}.", {
            cited: citedRow,
          })
        : words(
            "The rule named does not give this from rows {cited} and {other}.",
            { cited: citedRow, other: otherRow },
          );
    case "split-mixed":
      return words("The branches of a split must all come from one step.");
  }
}

/**
 * What is wrong with a branch's end, said of that branch. `name` spells an
 * instance a row still needs, which arrives as engine text.
 */
export function describeEndProblem(
  problem: EndProblem,
  words: TreeWords,
  number: RowNumber,
  name: (engine: string) => string = (engine) => engine,
): string {
  switch (problem.type) {
    case "closure-uncited":
      return words("Cite the rows the branch closes on.");
    case "closure-cite-off-branch":
      return words("A closure cites rows on its own branch.");
    case "open-contradiction": {
      const rows = problem.rows.map(number);
      const [first = "?", second = "?"] = rows;

      switch (rows.length) {
        case 1:
          return words(
            "Row {row} closes this branch, so it cannot be marked open.",
            { row: first },
          );
        case 2:
          return words(
            "Rows {first} and {second} close this branch, so it cannot be marked open.",
            { first, second },
          );
        default:
          return words(
            "Rows {rows} close this branch, so it cannot be marked open.",
            { rows: rows.join(", ") },
          );
      }
    }
    case "open-incomplete": {
      const missing = problem.missing[0];

      if (missing === undefined) {
        return words(
          "The tree is not finished: close every branch, or mark a complete open branch.",
        );
      }

      const row = number(missing.row);

      if (missing.substitution === true) {
        return words(
          "The identity on row {row} still needs substituting, one way or the other, into every atomic and negated atomic sentence on this branch.",
          { row },
        );
      }

      if (missing.names === undefined) {
        return words("Row {row} still needs developing on this branch.", {
          row,
        });
      }

      return missing.names.length === 0
        ? words("Row {row} still needs an instance on this branch.", { row })
        : words(
            "Row {row} still needs an instance for {names} on this branch.",
            { names: missing.names.map(name).join(", "), row },
          );
    }
    case "end-not-leaf":
      return words("Only the end of a branch can be closed or marked open.");
    case "closure-wrong":
      return words("The rows this closure cites do not close the branch.");
    case "open-not-offered":
      return words("This exercise asks for every branch to close.");
    case "open-unjudged":
      return words(
        "This system cannot say whether an open branch is complete.",
      );
    case "empty-branch":
      return words("This branch has no rows.");
  }
}

/** A problem with where it is: "Row 4: …", "The branch ending at row 7: …". */
function describeTreeProblem(
  problem: TreeProblem,
  tree: TableauDocument,
  words: TreeWords,
  number: RowNumber,
): string {
  const at = problem.at;

  if (at.type === "tree") {
    switch (at.problem.type) {
      case "root-missing":
        return words("The tree is missing a row of its root.");
      case "unverified":
        return words("A step or a closure in the tree does not check.");
      case "too-many-rows":
        return words("A tree may have at most {limit} rows.", {
          limit: String(at.problem.limit),
        });
      case "too-large":
        return words(
          "The tree is too large to check: its branches hold too much text.",
        );
    }
  }

  const index = new TableauIndex(tree);

  if (at.type === "row") {
    const cites = index.row(at.id)?.row.cites ?? [];

    return atRow(
      describeRowProblem(at.problem, cites, words, number),
      at.id,
      words,
      number,
    );
  }

  const rows = index.branchRows(at.id);

  return atBranchEnd(
    describeEndProblem(at.problem, words, number),
    rows[rows.length - 1]?.id,
    words,
    number,
  );
}

function rightVerdict(verdict: TruthTreeVerdict, words: TreeWords): string {
  switch (verdict) {
    case "valid":
      return words("Right: the tree closes, so the argument is valid.");
    case "invalid":
      return words(
        "Right: a complete open branch shows the argument is invalid.",
      );
    case "consistent":
      return words(
        "Right: a complete open branch shows the set is consistent.",
      );
    default:
      return words("Right: the tree closes, so the set is inconsistent.");
  }
}

/** Why the engine had no word on the tree, as the proof widgets say it. */
export function engineFailureText(
  reason: EngineFailure,
  words: TreeWords,
): string {
  return reason === "unavailable"
    ? words("Could not load the proof engine.")
    : words(
        "The proof engine couldn't read this proof — check for unexpected characters.",
      );
}

/**
 * The whole verdict in one sentence. With `detail` (full feedback) it names
 * the first problem in tree order; without it, only whether the tree is
 * right. `rules` are the rule each development names, which place its rows
 * and so give them their numbers.
 */
export function describeJudgement(
  judgement: TreeJudgement,
  tree: TableauDocument,
  rules: ReadonlyMap<string, string>,
  words: TreeWords,
  detail = true,
): string {
  if (judgement.ok && judgement.shows !== null) {
    return detail
      ? rightVerdict(judgement.shows, words)
      : words("The tree is right.");
  }

  // Only the engine could say, and its word is not to hand.
  if (judgement.problem?.type === "unconfirmed") {
    return "";
  }

  // Not a verdict but a malfunction, said under any feedback, as the proof
  // widgets say it.
  if (judgement.problem?.type === "engine-failed") {
    return engineFailureText(judgement.problem.reason, words);
  }

  if (!detail || judgement.problem === null) {
    return words("The tree is not right yet.");
  }

  const problem = judgement.problem;

  if (problem.type === "tree") {
    return describeTreeProblem(
      problem.problem,
      tree,
      words,
      rowNumbers(tree, rules),
    );
  }

  return problem.finish === "closed"
    ? words("The tree is not finished: close every branch.")
    : words(
        "The tree is not finished: close every branch, or mark a complete open branch.",
      );
}
