/**
 * What a theory must declare to be a tree calculus, found by role (gh #46).
 *
 * Nothing in Carnap names a calculus's terms: the theory a `system=` names
 * says which of its terms and axioms play each part, and this module reads
 * them. A theory that does not say is reported part by part, so an author sees
 * the whole list at once.
 *
 * DOM-free: the compiler reads it at lesson compile, the browser and the
 * worker when they write a tree down.
 */

import type { AppTerm, SurfaceLanguage } from "@aufbau/syntax";
import { printTerm } from "@aufbau/syntax";
import { acuiOf } from "../../../logic/specs/annotations";
import {
  roleIndex,
  sentenceSort,
  sortsWithRole,
} from "../../../logic/specs/roles";

/**
 * A tree calculus's plumbing:
 *
 * - `tree.branch` and `tree.row` — the sorts of a branch and of a row on it,
 *   with a coercion from the one to the other, so that a row is a branch;
 * - `tree.closes` — the term for "this branch closes", of a branch; the
 *   `context-join` term joins branches;
 * - `tree.focus` — the term for "this branch closes by a step on these rows",
 *   taking the branch and the cited rows, both of the branch sort;
 * - `tree.unfocus` — the axiom from a focused step to its branch;
 * - `tree.closure` — the rule a closed branch's × cites by;
 * - `tree.assert` — the term that says a sentence is true, for a calculus
 *   whose rows are signed (a Smullyan `T φ`), so that `𝕋 t = t` is read as
 *   true on any branch. Where a row is a sentence, it asserts itself;
 * - `tree.mark` and `tree.mark.instance` — a check mark, which a rule writes
 *   on the branch beside its rows and the student never types: `✓ ρ` for the
 *   row ρ the step cites, and `✓ᵢ ρ ↦ ψ` beside each row ψ a step writes
 *   from ρ, for a rule a row owes once per instance. Each is a term of the
 *   branch sort, so a mark is on a branch exactly where a step put it there.
 */
export interface TreeTheory {
  readonly closes: string;
  readonly focus: string;
  readonly unfocus: string;
  readonly closure: string;
  readonly join: string;
  /**
   * The empty branch, the join's `@acui` unit (`_`): what a rule that cites
   * no row focuses on, as Cut does. Null where the join declares no unit.
   */
  readonly empty: { readonly term: string; readonly engine: string } | null;
  /** The sort a row is written at (`tree.row`). */
  readonly rowSort: string;
  /** The sort of a branch (`tree.branch`). */
  readonly branchSort: string;
  /**
   * Whether an open branch is complete by what is on it, not by what was done
   * to it: a row is developed once its rule's conclusions are on the branch,
   * however they got there (the Open Logic Project's definition). So it is
   * where the rules write no check marks; where they do, a row is developed
   * where its mark is, as UBC checks rows off.
   */
  readonly byContents: boolean;
  /** The check mark a step writes for the row it cites (`tree.mark`). */
  readonly mark: string | null;
  /** The mark a step writes beside each instance it writes (`tree.mark.instance`). */
  readonly markInstance: string | null;
}

/** The roles a tree theory is read by. */
export type TreeRole =
  | "tree.closes"
  | "tree.focus"
  | "tree.unfocus"
  | "tree.closure"
  | "tree.assert"
  | "tree.row"
  | "tree.branch"
  | "context-join";

/**
 * Every `tree.` role Carnap reads, but the development ones
 * (`./criteria.ts`): a theory naming another has misspelt one.
 */
export const TREE_ROLES: ReadonlySet<string> = new Set([
  "tree.row",
  "tree.branch",
  "tree.closes",
  "tree.focus",
  "tree.unfocus",
  "tree.closure",
  "tree.assert",
  "tree.substitution",
  "tree.mark",
  "tree.mark.instance",
]);

/** What a theory is missing to be a tree theory. */
export type TreeTheoryProblem =
  | { readonly type: "missing-role"; readonly role: TreeRole }
  /** A sort role on more than one sort. */
  | {
      readonly type: "several-sorts";
      readonly role: "tree.row" | "tree.branch";
      readonly sorts: readonly string[];
    }
  /** The term with `role` is not over the branch sort. */
  | {
      readonly type: "not-branch";
      readonly role: "tree.closes" | "context-join";
      readonly term: string;
      readonly branch: string;
    }
  /** No coercion makes a row a branch. */
  | {
      readonly type: "no-coercion";
      readonly row: string;
      readonly branch: string;
    };

/** The theory's tree plumbing, or everything it lacks. */
export function readTreeTheory(
  language: SurfaceLanguage,
): TreeTheory | readonly TreeTheoryProblem[] {
  const roles = roleIndex(language);
  const closes = roles.termFor("tree.closes");
  const focus = roles.termFor("tree.focus");
  const unfocus = roles.ruleFor("tree.unfocus");
  const closure = roles.ruleFor("tree.closure");
  const join = roles.spellingFor("context-join");
  const joinTerm = roles.termFor("context-join");
  const problems: TreeTheoryProblem[] = [];
  const need = (value: string | null, role: TreeRole): void => {
    if (value === null) {
      problems.push({ role, type: "missing-role" });
    }
  };

  // A sort role on several sorts is reported as that, and read as none.
  const sortFor = (role: "tree.row" | "tree.branch"): string | null => {
    const sorts = sortsWithRole(language, role);

    if (sorts.length > 1) {
      problems.push({ role, sorts, type: "several-sorts" });
    } else if (sorts.length === 0) {
      problems.push({ role, type: "missing-role" });
    }

    return sorts.length === 1 ? (sorts[0] as string) : null;
  };
  const rowSort = sortFor("tree.row");
  const branchSort = sortFor("tree.branch");

  need(closes, "tree.closes");
  need(focus, "tree.focus");
  need(unfocus, "tree.unfocus");
  need(closure, "tree.closure");
  need(join, "context-join");

  if (branchSort !== null) {
    const binder =
      closes === null
        ? undefined
        : language.spec.terms.get(closes)?.binders[0];
    const closesOver =
      binder !== undefined && "sort" in binder.type ? binder.type.sort : null;

    if (closes !== null && closesOver !== branchSort) {
      problems.push({
        branch: branchSort,
        role: "tree.closes",
        term: closes,
        type: "not-branch",
      });
    }

    if (
      joinTerm !== null &&
      language.spec.terms.get(joinTerm)?.returnSort !== branchSort
    ) {
      problems.push({
        branch: branchSort,
        role: "context-join",
        term: joinTerm,
        type: "not-branch",
      });
    }

    if (
      rowSort !== null &&
      !language.spec.coercions.some(
        (coercion) => coercion.from === rowSort && coercion.to === branchSort,
      )
    ) {
      problems.push({
        branch: branchSort,
        row: rowSort,
        type: "no-coercion",
      });
    }
  }

  const rowsAreSentences =
    rowSort !== null && rowSort === sentenceSort(language);

  // Signed rows need their assertion named, which `./branch.ts` reads.
  if (
    roles.termFor("tree.assert") === null &&
    rowSort !== null &&
    !rowsAreSentences
  ) {
    problems.push({ role: "tree.assert", type: "missing-role" });
  }

  if (problems.length > 0) {
    return problems;
  }

  return {
    branchSort: branchSort as string,
    byContents:
      roles.termFor("tree.mark") === null &&
      roles.termFor("tree.mark.instance") === null,
    closes: closes as string,
    closure: closure as string,
    empty: emptyBranch(language, joinTerm),
    focus: focus as string,
    join: join as string,
    mark: roles.termFor("tree.mark"),
    markInstance: roles.termFor("tree.mark.instance"),
    rowSort: rowSort as string,
    unfocus: unfocus as string,
  };
}

/**
 * The unit the join's `@acui` annotation names (`@acui assoc comm unit
 * idem`), as a term and as engine text; null if it names none.
 */
function emptyBranch(
  language: SurfaceLanguage,
  join: string | null,
): TreeTheory["empty"] {
  const unit =
    join === null ? null : (acuiOf(language).get(join)?.unit ?? null);
  const info = unit === null ? undefined : language.spec.terms.get(unit);

  if (unit === null || info === undefined) {
    return null;
  }

  const term: AppTerm = {
    args: [],
    fixity: null,
    grouped: false,
    kind: "app",
    prec: null,
    sort: info.returnSort,
    span: { end: 0, start: 0 },
    term: unit,
    token: null,
  };

  return { engine: printTerm(language, term, "engine"), term: unit };
}

/** Whether a read is a theory or the list of what it lacks. */
export function isTreeTheory(
  read: TreeTheory | readonly TreeTheoryProblem[],
): read is TreeTheory {
  return "closes" in read;
}

/**
 * The rule a step's margin names, spelled as the theory first spells it
 * (`\/` is written `∨`), or null if the theory has no rule by that name.
 *
 * A student types the book's margin label, which is an `@syntax alias`; the
 * first alias an axiom declares is the book's own.
 */
export function ruleSpelling(
  language: SurfaceLanguage,
  typed: string,
): string | null {
  const axiom = language.spec.ruleAliases.get(typed.trim());

  return axiom === undefined
    ? null
    : (language.spec.rules.get(axiom)?.aliases[0] ?? null);
}

/** An axiom as the book names it: its first alias, or its own name. */
export function axiomSpelling(
  language: SurfaceLanguage,
  axiom: string,
): string {
  return language.spec.rules.get(axiom)?.aliases[0] ?? axiom;
}
