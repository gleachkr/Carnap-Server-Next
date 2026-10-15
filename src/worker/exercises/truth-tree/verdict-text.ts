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
import { layoutTableau } from "../../../tableau/layout";
import type { MessageResolver } from "../../i18n/translator";
import type { TreeJudgement } from "./grading";
import type { EndProblem, RowProblem, TreeProblem } from "./logic/check";
import type { TruthTreeVerdict } from "./types";

export type TreeWords = MessageResolver;

/** A row's number as a reader sees it, or `?` for a row that is not there. */
export type RowNumber = (rowId: string) => string;

/** The row numbers of a tree, from its layout. */
export function rowNumbers(tree: TableauDocument): RowNumber {
  const layout = layoutTableau(tree);

  return (rowId) => {
    const line = layout.rows.get(rowId)?.line;
    return line === undefined ? "?" : String(line);
  };
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
    case "identity":
      return words("These trees have no rules for identity.");
    case "root-mismatch":
      return words("This is not the sentence the exercise gives.");
    case "uncited":
      return words(
        "Say which row this row comes from: type that row's number in the margin.",
      );
    case "cites-several":
      return words(
        "Cite just one row, the one this row comes from, or two for a substitution by an identity.",
      );
    case "cites-differ":
      return words("The rows of one step must cite the same row.");
    case "cite-not-above":
      return words("Row {cited} is not above this row on its branch.", {
        cited: number(problem.cite),
      });
    case "cite-unreadable":
      return words("Row {cited} does not read, so it cannot be developed.", {
        cited: number(problem.cite),
      });
    case "no-rule":
      return words(
        "Row {cited} has no rule: it is atomic, or the negation of an atomic sentence.",
        { cited: citedRow },
      );
    case "identity-alone":
      return words(
        "Row {cited} is an identity: cite it together with the row it rewrites.",
        { cited: citedRow },
      );
    case "no-identity":
      return words(
        "A row citing two rows substitutes by an identity, and neither row {cited} nor row {other} is one.",
        { cited: citedRow, other: otherRow },
      );
    case "not-substitution":
      return words(
        "Rewriting row {into} by the identity on row {identity} does not give this sentence.",
        { identity: number(problem.identity), into: number(problem.into) },
      );
    case "not-from-rule":
      return words("The rule for row {cited} does not write this sentence.", {
        cited: citedRow,
      });
    case "should-split":
      return words(
        "The rule for row {cited} splits the branch into {branches} branches.",
        { branches: String(problem.branches), cited: citedRow },
      );
    case "should-stack":
      return words("The rule for row {cited} does not split the branch.", {
        cited: citedRow,
      });
    case "incomplete":
      return words(
        "This step is missing a row: the rule for row {cited} writes more.",
        {
          cited: citedRow,
        },
      );
    case "extra":
      return words("This row repeats one its step already wrote.");
    case "wrong-branches":
      return words(
        "These branches are not the ones the rule for row {cited} writes.",
        { cited: citedRow },
      );
    case "not-instance":
      return words("This is not an instance of row {cited}.", {
        cited: citedRow,
      });
    case "name-not-new":
      return words(
        "{name} is already on this branch, and row {cited} needs a new name.",
        { cited: citedRow, name: problem.name },
      );
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
    default:
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
      return words("Cite the two rows the branch closes on.");
    case "closure-cite-off-branch":
      return words("A closure cites rows on its own branch.");
    case "closure-not-contradiction":
      return words(
        "The rows a closure cites must be a sentence and its negation.",
      );
    case "closure-not-self-non-identity":
      return words(
        "A branch closes on one row only if that row says something is not identical to itself.",
      );
    case "open-contradiction": {
      const [first, second] = problem.rows;

      return second === undefined
        ? words(
            "Row {row} says something is not identical to itself, so this branch closes.",
            { row: first === undefined ? "?" : number(first) },
          )
        : words(
            "Rows {first} and {second} are a sentence and its negation, so this branch closes.",
            {
              first: first === undefined ? "?" : number(first),
              second: number(second),
            },
          );
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
    default:
      return words("This branch has no rows.");
  }
}

/** A problem with where it is: "Row 4: …", "The branch ending at row 7: …". */
export function describeTreeProblem(
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
      default:
        return words("A tree may have at most {limit} rows.", {
          limit: String(at.problem.limit),
        });
    }
  }

  const index = new TableauIndex(tree);

  if (at.type === "row") {
    const cites = index.row(at.id)?.row.cites ?? [];

    return words("Row {row}: {problem}", {
      problem: describeRowProblem(at.problem, cites, words, number),
      row: number(at.id),
    });
  }

  const rows = index.branchRows(at.id);
  const last = rows[rows.length - 1];

  return words("The branch ending at row {row}: {problem}", {
    problem: describeEndProblem(at.problem, words, number),
    row: last === undefined ? "?" : number(last.id),
  });
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

/**
 * The whole verdict in one sentence. With `detail` (full feedback) it names
 * the first problem in tree order; without it, only whether the tree is
 * right.
 */
export function describeJudgement(
  judgement: TreeJudgement,
  tree: TableauDocument,
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

  if (!detail || judgement.problem === null) {
    return words("The tree is not right yet.");
  }

  const problem = judgement.problem;

  if (problem.type === "tree") {
    return describeTreeProblem(
      problem.problem,
      tree,
      words,
      rowNumbers(tree),
    );
  }

  return problem.finish === "closed"
    ? words("The tree is not finished: close every branch.")
    : words(
        "The tree is not finished: close every branch, or mark a complete open branch.",
      );
}
