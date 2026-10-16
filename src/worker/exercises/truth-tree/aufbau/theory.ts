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
import { printTerm, UnprintableTermError } from "@aufbau/syntax";
import { roleIndex, sentenceSort } from "../../../logic/specs/roles";
import { statementReader } from "./patterns";

/**
 * A tree calculus's plumbing:
 *
 * - `tree.closes` — the term for "this branch closes"; its one argument's sort
 *   is the branch sort, joined by the `context-join` term;
 * - `tree.focus` — the term for "this branch closes by a step on these rows",
 *   taking the branch and the cited rows, both of the branch sort;
 * - `tree.unfocus` — the axiom from a focused step to its branch;
 * - `tree.closure` — the rule a closed branch's × cites by;
 * - `tree.assert` and `tree.deny` — how the root says a sentence is true, and
 *   is not (a Smullyan `T φ` and `F φ`). Where a row is a sentence, a sentence
 *   asserts itself, and the language's negation denies it;
 * - `tree.root` — where the root says it, for a calculus whose rows are
 *   somewhere as well as signed (a prefixed tableau's `1`): a term with no
 *   arguments, filling an assert or deny term's argument of its sort;
 * - `tree.completeness.contents` — on any term, that the theory calls an open
 *   branch complete by what is on it, not by what was done to it: a row is
 *   developed once its rule's conclusions are on the branch, however they got
 *   there (the Open Logic Project's definition). Without it a row is developed
 *   by a step that cites it, as UBC checks rows off;
 * - `tree.mark` and `tree.mark.instance` — a check mark, which a rule writes
 *   on the branch beside its rows and the student never types: `✓ ρ` for the
 *   row ρ the step cites, and `✓ ρ ψ` beside each row ψ a step writes from ρ,
 *   for a rule a row owes once per instance. Each is a term of the branch
 *   sort, so a mark is on a branch exactly where a step put it there.
 *
 * A row is read at the one sort with a coercion into the branch sort.
 */
export interface TreeTheory {
  readonly closes: string;
  readonly focus: string;
  readonly unfocus: string;
  /**
   * The binder of `tree.unfocus` that stands for the branch less its cited
   * rows, where the axiom splits the branch so (`focus (ga ; de) at de`):
   * `ga`. Null where it does not, as under an idempotent join, whose
   * `unfocus` takes the whole branch (`focus ga at de > closes ga ; de`).
   */
  readonly unfocusRest: string | null;
  readonly closure: string;
  readonly join: string;
  /**
   * The empty branch, the join's `@acui` unit (`_`): what a rule that cites
   * no row focuses on, as Cut does. Null where the join declares no unit.
   */
  readonly empty: { readonly term: string; readonly engine: string } | null;
  readonly rowSort: string;
  /** The term that asserts a sentence as a row; null where it is the row. */
  readonly assert: string | null;
  /**
   * The term that denies a sentence as a row, or null if the theory has none,
   * in which case it cannot test an argument.
   */
  readonly deny: string | null;
  /** The term the root's rows are at, if they are at anything (`tree.root`). */
  readonly root: string | null;
  /** Whether completeness is by the branch's contents (`tree.completeness.contents`). */
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
  | "context-join";

/**
 * Every `tree.` role Carnap reads, but the development ones
 * (`./criteria.ts`): a theory naming another has misspelt one.
 */
export const TREE_ROLES: ReadonlySet<string> = new Set([
  "tree.closes",
  "tree.focus",
  "tree.unfocus",
  "tree.closure",
  "tree.assert",
  "tree.deny",
  "tree.root",
  "tree.completeness.contents",
  "tree.substitution",
  "tree.mark",
  "tree.mark.instance",
]);

/** What a theory is missing to be a tree theory. */
export type TreeTheoryProblem =
  | { readonly type: "missing-role"; readonly role: TreeRole }
  /** No sort, or more than one, coerces into the branch sort. */
  | { readonly type: "row-sort"; readonly candidates: readonly string[] };

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
  const problems: TreeTheoryProblem[] = [];
  const need = (value: string | null, role: TreeRole): void => {
    if (value === null) {
      problems.push({ role, type: "missing-role" });
    }
  };

  need(closes, "tree.closes");
  need(focus, "tree.focus");
  need(unfocus, "tree.unfocus");
  need(closure, "tree.closure");
  need(join, "context-join");

  const binder =
    closes === null ? undefined : language.spec.terms.get(closes)?.binders[0];
  const branchSort =
    binder !== undefined && "sort" in binder.type ? binder.type.sort : null;
  const candidates =
    branchSort === null
      ? []
      : language.spec.coercions
          .filter((coercion) => coercion.to === branchSort)
          .map((coercion) => coercion.from);

  if (branchSort !== null && candidates.length !== 1) {
    problems.push({ candidates, type: "row-sort" });
  }

  const rowSort = candidates.length === 1 ? (candidates[0] as string) : null;
  const rowsAreSentences =
    rowSort !== null && rowSort === sentenceSort(language);
  const assert = roles.termFor("tree.assert");
  const deny =
    roles.termFor("tree.deny") ??
    (rowsAreSentences ? roles.termFor("negation") : null);

  if (assert === null && rowSort !== null && !rowsAreSentences) {
    problems.push({ role: "tree.assert", type: "missing-role" });
  }

  if (problems.length > 0) {
    return problems;
  }

  return {
    assert,
    byContents: roles.termFor("tree.completeness.contents") !== null,
    closes: closes as string,
    closure: closure as string,
    deny,
    empty: emptyBranch(language, roles.termFor("context-join")),
    focus: focus as string,
    join: join as string,
    mark: roles.termFor("tree.mark"),
    markInstance: roles.termFor("tree.mark.instance"),
    root: roles.termFor("tree.root"),
    rowSort: rowSort as string,
    unfocus: unfocus as string,
    unfocusRest: restOf(
      language,
      unfocus as string,
      closes as string,
      focus as string,
      roles.termFor("context-join"),
    ),
  };
}

/**
 * The binder `ga` of an `unfocus` whose one hypothesis is `focus (ga ; de)
 * at de`, either way round the join; null for any other shape.
 */
function restOf(
  language: SurfaceLanguage,
  unfocus: string,
  closes: string,
  focus: string,
  join: string | null,
): string | null {
  const statement = language.spec.statements.find(
    (each) =>
      (each.kind === "axiom" || each.kind === "theorem") &&
      each.name === unfocus,
  );
  const judgement = language.spec.terms.get(closes)?.returnSort;
  const [hypothesis, ...more] =
    statement?.kind === "axiom" || statement?.kind === "theorem"
      ? statement.hypotheses
      : [];

  if (
    statement === undefined ||
    (statement.kind !== "axiom" && statement.kind !== "theorem") ||
    judgement === undefined ||
    hypothesis === undefined ||
    "sort" in hypothesis ||
    more.length > 0
  ) {
    return null;
  }

  const read = statementReader(
    language,
    statement,
    judgement,
  )(hypothesis.text);
  const [branch, cited] =
    read?.kind === "app" && read.term === focus ? read.args : [];

  if (
    branch?.kind !== "app" ||
    branch.term !== join ||
    cited?.kind !== "variable"
  ) {
    return null;
  }

  const [left, right] = branch.args;

  if (left?.kind !== "variable" || right?.kind !== "variable") {
    return null;
  }

  return right.name === cited.name
    ? left.name
    : left.name === cited.name
      ? right.name
      : null;
}

/**
 * The unit the join's `@acui` annotation names (`@acui assoc comm unit
 * idem`), as a term and as engine text; null if it names none.
 */
function emptyBranch(
  language: SurfaceLanguage,
  join: string | null,
): TreeTheory["empty"] {
  const statement = language.spec.statements.find(
    (each) => each.kind === "term" && each.name === join,
  );
  const acui = statement?.annotations
    .map((annotation) => annotation.text.trim().split(/\s+/u))
    .find((words) => words[0] === "@acui");
  const unit = acui?.[3];
  const info = unit === undefined ? undefined : language.spec.terms.get(unit);

  if (unit === undefined || info === undefined) {
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
 * A root row as engine text at the row sort: the sentence (engine text)
 * asserted, or denied, at the theory's root where its rows are somewhere.
 * Null if the theory cannot say it — it has no denial, or no root of a sort
 * its assert or deny term asks for — or the result does not read.
 */
export function rootRow(
  language: SurfaceLanguage,
  theory: TreeTheory,
  sentence: string,
  polarity: "assert" | "deny",
): string | null {
  const term = polarity === "assert" ? theory.assert : theory.deny;

  if (polarity === "deny" && term === null) {
    return null;
  }

  const text =
    term === null ? sentence : applied(language, theory, term, sentence);

  if (text === null) {
    return null;
  }

  const parsed = language.parse(text, {
    lints: false,
    mode: "engine",
    sort: theory.rowSort,
  });

  if (!parsed.ok) {
    return null;
  }

  try {
    return printTerm(language, parsed.term, "engine");
  } catch (error) {
    if (error instanceof UnprintableTermError) {
      return null;
    }

    throw error;
  }
}

/**
 * An assert or deny term applied: the sentence at its sentence-sort argument,
 * the theory's root at any other. Null if it has an argument neither fills.
 */
function applied(
  language: SurfaceLanguage,
  theory: TreeTheory,
  term: string,
  sentence: string,
): string | null {
  const sentences = sentenceSort(language);
  const rootSort =
    theory.root === null
      ? null
      : (language.spec.terms.get(theory.root)?.returnSort ?? null);
  const args = (language.spec.terms.get(term)?.binders ?? []).map(
    (binder) => {
      const sort = "sort" in binder.type ? binder.type.sort : null;

      if (sort === sentences) {
        return `(${sentence})`;
      }

      return sort !== null && sort === rootSort ? `(${theory.root})` : null;
    },
  );

  return args.some((arg) => arg === null)
    ? null
    : `${term} ${args.join(" ")}`;
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
  const aliases = language.spec.ruleAliases;
  const axiom = aliases.get(typed.trim());

  if (axiom === undefined) {
    return null;
  }

  for (const [alias, named] of aliases) {
    if (named === axiom) {
      return alias;
    }
  }

  return null;
}
