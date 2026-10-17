/**
 * What a truth tree's judgement says: each row's problem, each branch end's,
 * each branch's state, each row's mark, and whether the tree is done.
 *
 * `aufbau/judge.ts` makes the report from the tree's structure and the
 * engine's word on it; the browser draws it on each edit, and the grader
 * reads its verdict from the same report made again on the server.
 *
 * **Marks are computed**, never typed, and say what the student did rather
 * than whether it was right: a resolved row is ticked once every branch below
 * it develops it or is closed, and a general row lists the instances it has
 * been developed for.
 *
 * DOM-free and free of i18n: the reasons are data, and each side words them.
 */

import type { ParseError } from "../../exercise-kit/formula";

/** What is wrong with a row. */
export type RowProblem =
  | { readonly type: "empty" }
  | { readonly type: "unreadable"; readonly errors: readonly ParseError[] }
  /** A root row that is not the one the exercise gives. */
  | { readonly type: "root-mismatch" }
  | { readonly type: "uncited" }
  /** The rows of one development cite different rows. */
  | { readonly type: "cites-differ" }
  /** Cites a row that is not above it on its branch. */
  | { readonly type: "cite-not-above"; readonly cite: string }
  /** A split's branches came from different steps. */
  | { readonly type: "split-mixed" }
  /** The step names no rule (gh #46). */
  | { readonly type: "no-rule-named" }
  /**
   * The engine refused the step: it is not what the rule it names gives from
   * the rows it cites (gh #46). `rule` is the axiom the engine tried.
   */
  | { readonly type: "step-wrong"; readonly rule: string | null };

/**
 * Whether a row's problem is with its citation, the margin's business,
 * rather than with the sentence on it.
 */
export function isCitationProblem(problem: RowProblem): boolean {
  switch (problem.type) {
    case "uncited":
    case "cites-differ":
    case "cite-not-above":
      return true;
    default:
      return false;
  }
}

/**
 * Whether a row's problem is only that something is not written yet: an
 * empty row, a missing citation. Incomplete, not wrong, so not drawn as
 * wrong; the tree is still not done until they are filled.
 */
export function isIncomplete(problem: RowProblem): boolean {
  return (
    problem.type === "empty" ||
    problem.type === "uncited" ||
    problem.type === "no-rule-named"
  );
}

/** What is wrong with a branch's end, or with a node's shape. */
export type EndProblem =
  | { readonly type: "closure-uncited" }
  | { readonly type: "closure-cite-off-branch" }
  /**
   * Marked open, but a closure rule closes it on these rows: UBC's sentence
   * and its negation, or `a≠a` alone.
   */
  | {
      readonly type: "open-contradiction";
      readonly rows: readonly string[];
    }
  /** Marked open, but not every row on it is developed. */
  | { readonly type: "open-incomplete"; readonly missing: readonly Missing[] }
  /** An end mark on a node with branches below it. */
  | { readonly type: "end-not-leaf" }
  /** A branch with no rows. */
  | { readonly type: "empty-branch" }
  /** The engine refused the closure: its rows do not close the branch. */
  | { readonly type: "closure-wrong" }
  /** Marked open, where the exercise asks every branch to close. */
  | { readonly type: "open-not-offered" }
  /** Marked open, and nothing can say whether it is complete. */
  | { readonly type: "open-unjudged" };

/** A row still to be developed on a branch, and for which instances. */
export interface Missing {
  readonly row: string;
  /** For a general row: the instances it still needs; empty for "any one". */
  readonly names?: readonly string[];
  /**
   * For an identity: it is not yet substituted, in either direction, into
   * every atomic and negated atomic sentence on the branch.
   */
  readonly substitution?: true;
}

export type BranchState =
  | { readonly type: "closed"; readonly right: boolean }
  | { readonly type: "open"; readonly right: boolean }
  /** Not ended yet. */
  | { readonly type: "unfinished" };

export type RowMark =
  | { readonly type: "resolved"; readonly names: readonly string[] }
  | { readonly type: "general"; readonly names: readonly string[] };

export interface TreeProblem {
  /** The row, node or branch the problem is on, in tree order. */
  readonly at:
    | {
        readonly type: "row";
        readonly id: string;
        readonly problem: RowProblem;
      }
    | {
        readonly type: "end";
        readonly id: string;
        readonly problem: EndProblem;
      }
    | { readonly type: "tree"; readonly problem: TreeLevelProblem };
}

export type TreeLevelProblem =
  | { readonly type: "root-missing" }
  | { readonly type: "too-many-rows"; readonly limit: number }
  /** Its theorems would state more than the text cap: too long to check. */
  | { readonly type: "too-large" }
  /** The engine did not confirm the tree's steps and closures. */
  | { readonly type: "unverified" };

export interface TreeReport {
  readonly rows: ReadonlyMap<string, RowProblem>;
  readonly ends: ReadonlyMap<string, EndProblem>;
  readonly branches: ReadonlyMap<string, BranchState>;
  readonly marks: ReadonlyMap<string, RowMark>;
  /** Every problem in tree order: rows, then the node's end, node by node. */
  readonly problems: readonly TreeProblem[];
  /** Every branch closed, by a right closure. */
  readonly closed: boolean;
  /** Some branch rightly marked open and complete. */
  readonly open: boolean;
  /** Done, by the exercise's `finish`. */
  readonly finished: boolean;
  /**
   * What `finished` would be were every step and closure written confirmed
   * by the engine: a tree without its word is unconfirmed, not unfinished.
   */
  readonly finishedIfConfirmed: boolean;
}
