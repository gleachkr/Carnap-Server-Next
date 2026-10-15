/**
 * Checking a truth tree: every row, every development, every branch end, and
 * whether the tree is done and what it shows.
 *
 * The browser runs this on every edit for live feedback, and the grader runs
 * it again on the submitted tree against the declared root. There is no
 * answer key: a tree is right when each row follows by its system's rules
 * from a row above it, each closure cites a sentence and its negation on its
 * branch, each ↑ is on a complete open branch, and the tree is done.
 *
 * **Developments.** A development is every row one step wrote (the rows of
 * one `dev`), all citing the row they develop. Its rows sit either at the
 * end of one node (a stack) or at the start of each child of one node (a
 * split). A development belongs to one branch: a step repeated on two
 * branches is two developments.
 *
 * **Identity** (when the system has it) adds a step that cites two rows: an
 * identity `a=b` and a row it rewrites, with every `a` made `b` or every `b`
 * made `a`. It is a development of neither row, so it ticks neither. An open
 * branch is complete once each identity is rewritten one way into its
 * literals (see `unsubstituted`).
 *
 * **Marks are computed**, never typed, and say what the student did rather
 * than whether it was right: a resolved row is ticked once every branch below
 * it develops it or is closed, and a general row lists the names it has been
 * instantiated for.
 *
 * DOM-free and free of i18n: the reasons are data, and each side words them.
 */

import type {
  TableauDocument,
  TableauNode,
  TableauRow,
} from "../../../../tableau/document";
import { TableauIndex } from "../../../../tableau/document";
import type { Formula, ParseError } from "../../../exercise-kit/formula";
import {
  complementary,
  isLiteral,
  namesIn,
  replaceName,
  sameFormula,
  substitute,
} from "../../../exercise-kit/formula";
import type { RowReader } from "./formulas";
import { usesIdentity } from "./formulas";
import type { Rule, RuleName } from "./rules";
import { ruleFor } from "./rules";
import type { TableauSystem } from "./system";

/** What is wrong with a row. */
export type RowProblem =
  | { readonly type: "empty" }
  | { readonly type: "unreadable"; readonly errors: readonly ParseError[] }
  /** Uses `=`, which this system has no rules for. */
  | { readonly type: "identity" }
  /** A root row that is not the one the exercise gives. */
  | { readonly type: "root-mismatch" }
  | { readonly type: "uncited" }
  /**
   * Cites more than one row, where a development cites one (and a
   * substitution by an identity, two).
   */
  | { readonly type: "cites-several" }
  /** The rows of one development cite different rows. */
  | { readonly type: "cites-differ" }
  /** Cites a row that is not above it on its branch. */
  | { readonly type: "cite-not-above"; readonly cite: string }
  /** Cites a row that does not read, so nothing can be said about this one. */
  | { readonly type: "cite-unreadable"; readonly cite: string }
  /** Cites a row with no rule: a literal. */
  | { readonly type: "no-rule" }
  /** Cites an identity alone; a substitution also cites the row it rewrites. */
  | { readonly type: "identity-alone" }
  /** Cites two rows, and neither is an identity between names. */
  | { readonly type: "no-identity" }
  /** Not the row `into` rewritten by the identity on `identity`. */
  | {
      readonly type: "not-substitution";
      readonly identity: string;
      readonly into: string;
    }
  /** Not a row the cited row's rule writes. */
  | { readonly type: "not-from-rule" }
  /** The rule splits, and this development stacks (or splits too few ways). */
  | { readonly type: "should-split"; readonly branches: number }
  | { readonly type: "should-stack" }
  /** The development is missing rows the rule writes. */
  | { readonly type: "incomplete" }
  /** A row the rule writes once, written again. */
  | { readonly type: "extra" }
  /** The branches hold the rule's rows, but not one branch's rows per branch. */
  | { readonly type: "wrong-branches" }
  | { readonly type: "not-instance" }
  | { readonly type: "name-not-new"; readonly name: string }
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
    case "cites-several":
    case "cites-differ":
    case "cite-not-above":
    case "cite-unreadable":
    case "no-rule":
    case "identity-alone":
    case "no-identity":
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
  | { readonly type: "closure-not-contradiction" }
  /** Closes on one row, which does not say that something is not itself. */
  | { readonly type: "closure-not-self-non-identity" }
  /**
   * Marked open, but a sentence and its negation are both on it, or a row
   * `a≠a` is: the rows that close it.
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

/** A row still to be developed on a branch, and for which names. */
export interface Missing {
  readonly row: string;
  /** For a general row: the names it still needs; empty for "any one". */
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
  /** Not ended yet. `complete` says whether it could be marked open. */
  | {
      readonly type: "unfinished";
      readonly complete: boolean;
      /** The rows that would close it, as in `open-contradiction`. */
      readonly contradiction: readonly string[] | null;
      readonly missing: readonly Missing[];
    };

export type RowMark =
  | { readonly type: "resolved"; readonly names: readonly string[] }
  | { readonly type: "general"; readonly names: readonly string[] };

/** What a development's margin says: the row it cites and the rule's name. */
export interface Justification {
  readonly cites: readonly string[];
  /** `null` where the cited row has no rule, or does not read. */
  readonly rule: RuleName | null;
}

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
  /** The engine did not confirm the tree's steps and closures. */
  | { readonly type: "unverified" };

export interface TreeReport {
  readonly rows: ReadonlyMap<string, RowProblem>;
  readonly ends: ReadonlyMap<string, EndProblem>;
  readonly branches: ReadonlyMap<string, BranchState>;
  readonly marks: ReadonlyMap<string, RowMark>;
  /** By row id: every row of a development carries its development's note. */
  readonly justifications: ReadonlyMap<string, Justification>;
  /** Every problem in tree order: rows, then the node's end, node by node. */
  readonly problems: readonly TreeProblem[];
  /** Every branch closed, by a right closure. */
  readonly closed: boolean;
  /** Some branch rightly marked open and complete. */
  readonly open: boolean;
  /** Done, by the system's `finished`. */
  readonly finished: boolean;
}

interface Development {
  readonly id: string;
  readonly rows: readonly TableauRow[];
  /** The rows grouped by node, in node order. */
  readonly groups: readonly (readonly TableauRow[])[];
}

interface DevelopmentResult {
  readonly cited: string | null;
  readonly right: boolean;
  /** A quantifier step's instances: each name, or `null` for a vacuous one. */
  readonly instances?: readonly (string | null)[];
}

/** Every way to pair `count` items with `count` slots. */
function permutations(count: number): number[][] {
  if (count <= 1) {
    return [[0].slice(0, count)];
  }

  return permutations(count - 1).flatMap((rest) =>
    Array.from({ length: count }, (_, at) => [
      ...rest.slice(0, at),
      count - 1,
      ...rest.slice(at),
    ]),
  );
}

/** Whether two lists hold the same formulas, counting repeats, in any order. */
function sameMultiset(
  rows: readonly Formula[],
  expected: readonly Formula[],
): boolean {
  if (rows.length !== expected.length) {
    return false;
  }

  const left = [...expected];

  return rows.every((row) => {
    const at = left.findIndex((candidate) => sameFormula(candidate, row));

    if (at < 0) {
      return false;
    }

    left.splice(at, 1);
    return true;
  });
}

/** The two names of an identity between names, `a=b`, or `null`. */
function nameIdentity(
  formula: Formula,
): { readonly left: string; readonly right: string } | null {
  return formula.type === "identity" &&
    formula.left.type === "constant" &&
    formula.right.type === "constant"
    ? { left: formula.left.name, right: formula.right.name }
    : null;
}

/** Whether a formula says that something is itself: `a=a`. */
function isSelfIdentity(formula: Formula): boolean {
  return (
    formula.type === "identity" &&
    sameFormula(formula, { ...formula, right: formula.left })
  );
}

/** Whether a formula says that something is not itself: `a≠a`. */
function isSelfNonIdentity(formula: Formula): boolean {
  return formula.type === "not" && isSelfIdentity(formula.operand);
}

/** Whether a row closes a branch by itself, under a system: `a≠a`. */
export function closesAlone(
  formula: Formula,
  system: TableauSystem,
): boolean {
  return (
    system.closure.includes("self-non-identity") && isSelfNonIdentity(formula)
  );
}

/**
 * What the identity rule writes from `identity` and `into`: `into` with every
 * occurrence of one of the identity's names made the other, for each name
 * `into` mentions. Nothing, if `identity` is not an identity between names.
 */
function substitutions(identity: Formula, into: Formula): Formula[] {
  const names = nameIdentity(identity);

  if (names === null) {
    return [];
  }

  const mentioned = namesIn(into);
  const written: Formula[] = [];

  if (mentioned.includes(names.left)) {
    written.push(replaceName(into, names.left, names.right));
  }

  if (mentioned.includes(names.right)) {
    written.push(replaceName(into, names.right, names.left));
  }

  return written;
}

/** The name a row instantiates a quantifier's body with, if it is an instance. */
function instanceName(
  row: Formula,
  variable: string,
  body: Formula,
  negated: boolean,
): { readonly name: string | null } | null {
  let target = row;

  if (negated) {
    if (row.type !== "not") {
      return null;
    }

    target = row.operand;
  }

  for (const name of namesIn(target)) {
    if (
      sameFormula(
        substitute(body, variable, { name, type: "constant" }),
        target,
      )
    ) {
      return { name };
    }
  }

  // A vacuous quantifier's instance is its body, for any name.
  return sameFormula(body, target) ? { name: null } : null;
}

export interface CheckInput {
  /** The root the exercise declares, in order. */
  readonly root: readonly Formula[];
  readonly tree: TableauDocument;
  readonly reader: RowReader;
  readonly system: TableauSystem;
}

export function checkTree(input: CheckInput): TreeReport {
  const { reader, root, system, tree } = input;
  const index = new TableauIndex(tree);
  const order = index.preorder();
  const rowProblems = new Map<string, RowProblem>();
  const endProblems = new Map<string, EndProblem>();
  const treeProblems: TreeLevelProblem[] = [];
  const formulas = new Map<string, Formula>();
  const justifications = new Map<string, Justification>();
  const rootRows = new Set<string>();

  const rowCount = order.reduce((sum, node) => sum + node.rows.length, 0);

  // A tree past the cap is not read: every row costs a parse.
  if (rowCount > system.rowCap) {
    return {
      branches: new Map(),
      closed: false,
      ends: new Map(),
      finished: false,
      justifications: new Map(),
      marks: new Map(),
      open: false,
      problems: [
        {
          at: {
            problem: { limit: system.rowCap, type: "too-many-rows" },
            type: "tree",
          },
        },
      ],
      rows: new Map(),
    };
  }

  const flag = (rowId: string, problem: RowProblem): void => {
    if (!rowProblems.has(rowId)) {
      rowProblems.set(rowId, problem);
    }
  };

  // Every row's formula, once.
  for (const node of order) {
    for (const row of node.rows) {
      if (row.text.trim() === "") {
        flag(row.id, { type: "empty" });
        continue;
      }

      const read = reader.read(row.text);

      if (!read.ok) {
        flag(row.id, { errors: read.errors, type: "unreadable" });
        continue;
      }

      formulas.set(row.id, read.formula);

      if (system.identity === undefined && usesIdentity(read.formula)) {
        flag(row.id, { type: "identity" });
      }
    }
  }

  // The root node starts with the declared root, one row per sentence.
  const rootNode = index.root;

  if (rootNode === null || rootNode.rows.length < root.length) {
    treeProblems.push({ type: "root-missing" });
  }

  for (const [at, expected] of root.entries()) {
    const row = rootNode?.rows[at];

    if (row === undefined) {
      break;
    }

    rootRows.add(row.id);
    const formula = formulas.get(row.id);

    if (
      row.cites.length > 0 ||
      formula === undefined ||
      !sameFormula(formula, expected)
    ) {
      rowProblems.set(row.id, { type: "root-mismatch" });
    }
  }

  // Group the developed rows into developments.
  const developments = new Map<string, TableauRow[]>();

  for (const node of order) {
    for (const row of node.rows) {
      if (rootRows.has(row.id)) {
        continue;
      }

      const list = developments.get(row.dev) ?? [];
      list.push(row);
      developments.set(row.dev, list);
    }
  }

  const results = new Map<string, DevelopmentResult>();

  for (const [id, rows] of developments) {
    const groups: TableauRow[][] = [];
    let last: string | null = null;

    for (const row of rows) {
      const node = index.row(row.id)?.node.id ?? null;

      if (node !== last) {
        groups.push([]);
        last = node;
      }

      groups[groups.length - 1]?.push(row);
    }

    results.set(
      id,
      checkDevelopment(
        { groups, id, rows },
        {
          flag,
          formulas,
          index,
          justifications,
          system,
        },
      ),
    );
  }

  // A split's branches all start with rows of one development.
  for (const node of order) {
    const children = index.children(node.id);

    if (children.length === 0) {
      continue;
    }

    const devs = new Set(children.map((child) => child.rows[0]?.dev));

    if (devs.size > 1 || children.length === 1) {
      for (const child of children) {
        const first = child.rows[0];

        if (first !== undefined) {
          flag(first.id, { type: "split-mixed" });
        }
      }
    }
  }

  // Which developments are right, and on which branch each one lies.
  const rightDevelopments = [...developments]
    .filter(([id]) => results.get(id)?.right === true)
    .map(([id, rows]) => ({ id, result: results.get(id), rows }));

  const branches = new Map<string, BranchState>();
  const leaves = index.leaves();

  for (const leaf of leaves) {
    const branchRows = index.branchRows(leaf.id);
    const onBranch = new Set(branchRows.map((row) => row.id));
    const contradiction = findContradiction(branchRows, formulas, system);
    const missing = missingOn(
      branchRows,
      onBranch,
      formulas,
      rightDevelopments,
      system,
    );

    if (leaf.rows.length === 0 && leaf.parent !== null) {
      endProblems.set(leaf.id, { type: "empty-branch" });
    }

    if (leaf.end === undefined) {
      branches.set(leaf.id, {
        complete: missing.length === 0 && contradiction === null,
        contradiction,
        missing,
        type: "unfinished",
      });
      continue;
    }

    if (leaf.end.type === "closed") {
      const problem = checkClosure(
        leaf.end.cites,
        onBranch,
        formulas,
        system,
      );

      if (problem !== null) {
        endProblems.set(leaf.id, problem);
      }

      branches.set(leaf.id, { right: problem === null, type: "closed" });
      continue;
    }

    const problem: EndProblem | null =
      contradiction !== null
        ? { rows: contradiction, type: "open-contradiction" }
        : missing.length > 0
          ? { missing, type: "open-incomplete" }
          : null;

    if (problem !== null) {
      endProblems.set(leaf.id, problem);
    }

    branches.set(leaf.id, { right: problem === null, type: "open" });
  }

  for (const node of order) {
    if (node.end !== undefined && index.children(node.id).length > 0) {
      endProblems.set(node.id, { type: "end-not-leaf" });
    }
  }

  const states = leaves.map((leaf) => branches.get(leaf.id));
  const closed =
    leaves.length > 0 &&
    states.every((state) => state?.type === "closed" && state.right);
  const openBranch = states.some(
    (state) =>
      (state?.type === "open" && state.right) ||
      (system.openMark === "optional" &&
        state?.type === "unfinished" &&
        state.complete),
  );
  const everyEnded = states.every(
    (state) =>
      (state?.type === "closed" && state.right) ||
      (state?.type === "open" && state.right) ||
      (system.openMark === "optional" &&
        state?.type === "unfinished" &&
        state.complete),
  );
  const finished =
    closed ||
    (system.finished === "closed-or-one-complete-open"
      ? openBranch
      : everyEnded);

  const problems: TreeProblem[] = treeProblems.map((problem) => ({
    at: { problem, type: "tree" },
  }));

  for (const node of order) {
    for (const row of node.rows) {
      const problem = rowProblems.get(row.id);

      if (problem !== undefined) {
        problems.push({ at: { id: row.id, problem, type: "row" } });
      }
    }

    const problem = endProblems.get(node.id);

    if (problem !== undefined) {
      problems.push({ at: { id: node.id, problem, type: "end" } });
    }
  }

  return {
    branches,
    closed,
    ends: endProblems,
    finished,
    justifications,
    marks: computeMarks(
      index,
      order,
      formulas,
      developments,
      results,
      system,
    ),
    open: openBranch,
    problems,
    rows: rowProblems,
  };
}

interface DevelopmentContext {
  readonly flag: (rowId: string, problem: RowProblem) => void;
  readonly formulas: ReadonlyMap<string, Formula>;
  readonly index: TableauIndex;
  readonly justifications: Map<string, Justification>;
  readonly system: TableauSystem;
}

function checkDevelopment(
  development: Development,
  context: DevelopmentContext,
): DevelopmentResult {
  const { flag, formulas, index, justifications, system } = context;
  const { groups, rows } = development;
  const first = rows[0];

  if (first === undefined) {
    return { cited: null, right: false };
  }

  const cites = first.cites;
  const substitution = cites.length === 2 && system.identity !== undefined;
  const citedId = cites.length === 1 ? (cites[0] ?? null) : null;
  const citedFormula = citedId === null ? undefined : formulas.get(citedId);
  const rule: Rule =
    citedFormula === undefined
      ? { type: "none" }
      : ruleFor(citedFormula, system);
  const identityCited = cites.some((cite) => {
    const formula = formulas.get(cite);
    return formula !== undefined && nameIdentity(formula) !== null;
  });
  const ruleName: RuleName | null = substitution
    ? identityCited
      ? { head: { type: "identity" }, negated: false }
      : null
    : rule.type === "none"
      ? null
      : rule.name;

  for (const row of rows) {
    justifications.set(row.id, { cites: row.cites, rule: ruleName });
  }

  let right = true;
  const fail = (row: TableauRow, problem: RowProblem): void => {
    flag(row.id, problem);
    right = false;
  };

  for (const row of rows) {
    if (
      row.cites.length !== cites.length ||
      row.cites.some((cite, at) => cite !== cites[at])
    ) {
      fail(row, { type: "cites-differ" });
    }
  }

  // A step is cited once, beside its first row, so that row is the one
  // missing it.
  if (cites.length === 0) {
    fail(first, { type: "uncited" });

    return { cited: null, right: false };
  }

  if (citedId === null && !substitution) {
    fail(first, { type: "cites-several" });
    return { cited: null, right: false };
  }

  for (const row of rows) {
    const above = index.rowsAbove(row.id);
    const off = cites.find((cite) => !above.some((each) => each.id === cite));

    if (off !== undefined) {
      fail(row, { cite: off, type: "cite-not-above" });
    }
  }

  if (!right) {
    return { cited: citedId, right: false };
  }

  if (citedId === null) {
    return checkSubstitution(
      development,
      cites,
      identityCited,
      formulas,
      fail,
    );
  }

  // A step over several nodes is a split: its rows open every branch below
  // one node, and nothing else does.
  if (groups.length > 1) {
    const nodes = groups.map((group) =>
      group[0] === undefined ? null : (index.row(group[0].id)?.node ?? null),
    );
    const parent = nodes[0]?.parent ?? null;
    const shaped =
      parent !== null &&
      index.children(parent).length === groups.length &&
      nodes.every(
        (node) =>
          node !== null &&
          node.parent === parent &&
          node.rows[0]?.dev === development.id,
      );

    if (!shaped) {
      fail(first, { type: "split-mixed" });
      return { cited: citedId, right: false };
    }
  }

  if (citedFormula === undefined) {
    fail(first, { cite: citedId, type: "cite-unreadable" });
    return { cited: citedId, right: false };
  }

  if (rule.type === "none") {
    fail(
      first,
      system.identity !== undefined && nameIdentity(citedFormula) !== null
        ? { type: "identity-alone" }
        : { type: "no-rule" },
    );
    return { cited: citedId, right: false };
  }

  // A row that does not read is reported as such; the shape of its step
  // cannot be judged without it.
  const read = rows.map((row) => formulas.get(row.id));

  if (read.some((formula) => formula === undefined)) {
    return { cited: citedId, right: false };
  }

  const groupFormulas = groups.map((group) =>
    group.map((row) => formulas.get(row.id) as Formula),
  );

  if (rule.type === "quantifier") {
    if (groups.length > 1) {
      fail(first, { type: "should-stack" });
      return { cited: citedId, right: false };
    }

    // A resolved row is developed by one instance. A general row may take
    // several at once, one per name, as the book sometimes writes them.
    const general = rule.rule.mark === "general";
    const instances: (string | null)[] = [];

    for (const [at, row] of rows.entries()) {
      if (at > 0 && !general) {
        fail(row, { type: "extra" });
        continue;
      }

      const found = instanceName(
        read[at] as Formula,
        rule.variable,
        rule.body,
        rule.rule.yields === "negated-instance",
      );

      if (found === null) {
        fail(row, { type: "not-instance" });
        continue;
      }

      if (instances.includes(found.name)) {
        fail(row, { type: "extra" });
        continue;
      }

      instances.push(found.name);

      if (rule.rule.instance === "new" && found.name !== null) {
        const name = found.name;
        const earlier =
          system.newName === "branch"
            ? index.rowsAbove(row.id)
            : index.document.nodes.flatMap((node) =>
                node.rows.filter((other) => other.id !== row.id),
              );
        const used = earlier.some((other) => {
          const formula = formulas.get(other.id);
          return formula !== undefined && namesIn(formula).includes(name);
        });

        if (used) {
          fail(row, { name, type: "name-not-new" });
        }
      }
    }

    return { cited: citedId, instances, right };
  }

  const expected = rule.branches;

  if (expected.length === 1 && groups.length > 1) {
    fail(first, { type: "should-stack" });
    return { cited: citedId, right: false };
  }

  if (expected.length > 1 && groups.length !== expected.length) {
    fail(first, { branches: expected.length, type: "should-split" });
    return { cited: citedId, right: false };
  }

  const orders =
    system.branchOrder === "any"
      ? permutations(expected.length)
      : [expected.map((_, at) => at)];
  const matches = orders.some((order) =>
    groupFormulas.every((group, at) =>
      sameMultiset(group, expected[order[at] ?? at] ?? []),
    ),
  );

  if (matches) {
    return { cited: citedId, right };
  }

  // Say what is wrong as narrowly as possible: a row the rule never writes,
  // then a row written twice, then a step that stops short.
  const every = expected.flat();

  for (const [at, row] of rows.entries()) {
    if (!every.some((formula) => sameFormula(formula, read[at] as Formula))) {
      fail(row, { type: "not-from-rule" });
    }
  }

  if (!right) {
    return { cited: citedId, right: false };
  }

  for (const [at, group] of groups.entries()) {
    const formulasHere = groupFormulas[at] ?? [];

    for (const [position, row] of group.entries()) {
      const formula = formulasHere[position] as Formula;
      const repeats = formulasHere
        .slice(0, position)
        .some((other) => sameFormula(other, formula));

      if (repeats) {
        fail(row, { type: "extra" });
      }
    }
  }

  if (!right) {
    return { cited: citedId, right: false };
  }

  const fitsWithin = orders.some((order) =>
    groupFormulas.every((group, at) =>
      group.every((formula) =>
        (expected[order[at] ?? at] ?? []).some((candidate) =>
          sameFormula(candidate, formula),
        ),
      ),
    ),
  );
  const lastRow = rows[rows.length - 1] ?? first;

  fail(
    lastRow,
    fitsWithin ? { type: "incomplete" } : { type: "wrong-branches" },
  );

  return { cited: citedId, right: false };
}

/**
 * A substitution by an identity: one row, or more (each a different
 * rewriting), stacked, each one of the cited rows rewritten by the other.
 */
function checkSubstitution(
  development: Development,
  cites: readonly string[],
  identityCited: boolean,
  formulas: ReadonlyMap<string, Formula>,
  fail: (row: TableauRow, problem: RowProblem) => void,
): DevelopmentResult {
  const { groups, rows } = development;
  const first = rows[0] as TableauRow;
  const [left, right] = cites.map((cite) => formulas.get(cite));

  if (left === undefined || right === undefined) {
    fail(first, {
      cite: (left === undefined ? cites[0] : cites[1]) ?? "",
      type: "cite-unreadable",
    });
    return { cited: null, right: false };
  }

  if (!identityCited) {
    fail(first, { type: "no-identity" });
    return { cited: null, right: false };
  }

  if (groups.length > 1) {
    fail(first, { type: "should-stack" });
    return { cited: null, right: false };
  }

  const written = [
    ...substitutions(left, right),
    ...substitutions(right, left),
  ];
  let ok = true;

  for (const [at, row] of rows.entries()) {
    const formula = formulas.get(row.id);

    if (formula === undefined) {
      ok = false;
      continue;
    }

    if (!written.some((candidate) => sameFormula(candidate, formula))) {
      const at = cites.findIndex((cite) => {
        const cited = formulas.get(cite);
        return cited !== undefined && nameIdentity(cited) !== null;
      });
      fail(row, {
        identity: cites[at] ?? "",
        into: cites[1 - at] ?? "",
        type: "not-substitution",
      });
      ok = false;
      continue;
    }

    const repeats = rows.slice(0, at).some((other) => {
      const earlier = formulas.get(other.id);
      return earlier !== undefined && sameFormula(earlier, formula);
    });

    if (repeats) {
      fail(row, { type: "extra" });
      ok = false;
    }
  }

  return { cited: null, right: ok };
}

function checkClosure(
  cites: readonly string[],
  onBranch: ReadonlySet<string>,
  formulas: ReadonlyMap<string, Formula>,
  system: TableauSystem,
): EndProblem | null {
  if (cites.length === 0 && system.closureCitation === "optional") {
    return null;
  }

  const alone =
    cites.length === 1 && system.closure.includes("self-non-identity");

  if (cites.length !== 2 && !alone) {
    return { type: "closure-uncited" };
  }

  if (cites.some((cite) => !onBranch.has(cite))) {
    return { type: "closure-cite-off-branch" };
  }

  const [left, right] = cites.map((cite) => formulas.get(cite));

  if (alone) {
    return left !== undefined && closesAlone(left, system)
      ? null
      : { type: "closure-not-self-non-identity" };
  }

  return left !== undefined &&
    right !== undefined &&
    complementary(left, right)
    ? null
    : { type: "closure-not-contradiction" };
}

/** The first rows, in branch order, that close a branch, or `null`. */
function findContradiction(
  rows: readonly TableauRow[],
  formulas: ReadonlyMap<string, Formula>,
  system: TableauSystem,
): readonly string[] | null {
  for (const [at, row] of rows.entries()) {
    const formula = formulas.get(row.id);

    if (formula === undefined) {
      continue;
    }

    if (closesAlone(formula, system)) {
      return [row.id];
    }

    for (const other of rows.slice(0, at)) {
      const earlier = formulas.get(other.id);

      if (earlier !== undefined && complementary(earlier, formula)) {
        return [other.id, row.id];
      }
    }
  }

  return null;
}

/** The rows a branch has yet to develop before it is complete. */
function missingOn(
  rows: readonly TableauRow[],
  onBranch: ReadonlySet<string>,
  formulas: ReadonlyMap<string, Formula>,
  developments: readonly {
    readonly id: string;
    readonly result: DevelopmentResult | undefined;
    readonly rows: readonly TableauRow[];
  }[],
  system: TableauSystem,
): Missing[] {
  const names = new Set<string>();

  for (const row of rows) {
    const formula = formulas.get(row.id);

    if (formula !== undefined) {
      for (const name of namesIn(formula)) {
        names.add(name);
      }
    }
  }

  const here = developments.filter((development) =>
    development.rows.some((row) => onBranch.has(row.id)),
  );
  const missing: Missing[] = [];

  for (const row of rows) {
    const formula = formulas.get(row.id);

    if (formula === undefined) {
      continue;
    }

    const rule = ruleFor(formula, system);

    if (rule.type === "none") {
      continue;
    }

    const developed = here.filter(
      (development) => development.result?.cited === row.id,
    );

    if (rule.type === "branches" || rule.rule.mark === "resolved") {
      if (developed.length === 0) {
        missing.push({ row: row.id });
      }

      continue;
    }

    const instances = developed.flatMap(
      (development) => development.result?.instances ?? [],
    );
    const vacuous = instances.some((name) => name === null);

    if (names.size === 0) {
      if (
        system.completion.noNames === "one-instance" &&
        developed.length === 0
      ) {
        missing.push({ names: [], row: row.id });
      }

      continue;
    }

    const needed = vacuous
      ? []
      : [...names].filter((name) => !instances.includes(name));

    if (needed.length > 0) {
      missing.push({ names: needed, row: row.id });
    }
  }

  if (system.identity !== undefined) {
    missing.push(...unsubstituted(rows, formulas));
  }

  return missing;
}

/**
 * The identities on a branch not yet substituted into its literals: `a=b` is
 * done when every atomic or negated atomic sentence on the branch that
 * mentions `a` has its rewriting with `b` on the branch too, or every one
 * mentioning `b` has its rewriting with `a` (UBC §12.7).
 *
 * A rewriting that says something is itself (`b=b`, from `a=b` or `b=a`) is
 * not needed: it is true in every model, so it can neither close a branch nor
 * change the model read off one. The book's own solutions leave them out
 * (the `Dxy` tree of the §12 exercises is complete with `d=e` and neither
 * `d=d` nor `e=e`); `a≠a` is still needed, and is what closes a branch.
 */
function unsubstituted(
  rows: readonly TableauRow[],
  formulas: ReadonlyMap<string, Formula>,
): Missing[] {
  const onBranch = rows
    .map((row) => formulas.get(row.id))
    .filter((formula): formula is Formula => formula !== undefined);
  const literals = onBranch.filter(isLiteral);
  const done = (from: string, to: string): boolean =>
    literals
      .filter((literal) => namesIn(literal).includes(from))
      .every((literal) => {
        const rewritten = replaceName(literal, from, to);
        return (
          isSelfIdentity(rewritten) ||
          onBranch.some((formula) => sameFormula(formula, rewritten))
        );
      });
  const missing: Missing[] = [];

  for (const row of rows) {
    const formula = formulas.get(row.id);
    const names = formula === undefined ? null : nameIdentity(formula);

    if (
      names !== null &&
      names.left !== names.right &&
      !done(names.left, names.right) &&
      !done(names.right, names.left)
    ) {
      missing.push({ row: row.id, substitution: true });
    }
  }

  return missing;
}

function computeMarks(
  index: TableauIndex,
  order: readonly TableauNode[],
  formulas: ReadonlyMap<string, Formula>,
  developments: ReadonlyMap<string, readonly TableauRow[]>,
  results: ReadonlyMap<string, DevelopmentResult>,
  system: TableauSystem,
): Map<string, RowMark> {
  const marks = new Map<string, RowMark>();
  // Every development citing a row, whether right or not: marks say what
  // was done.
  const citing = new Map<
    string,
    { rows: readonly TableauRow[]; names: readonly string[] }[]
  >();

  for (const [id, rows] of developments) {
    const first = rows[0];
    const cited = first?.cites.length === 1 ? first.cites[0] : undefined;

    if (cited === undefined) {
      continue;
    }

    const list = citing.get(cited) ?? [];
    const names = (results.get(id)?.instances ?? []).filter(
      (name): name is string => name !== null,
    );
    list.push({ names, rows });
    citing.set(cited, list);
  }

  for (const node of order) {
    for (const row of node.rows) {
      const formula = formulas.get(row.id);
      const done = citing.get(row.id) ?? [];

      if (formula === undefined || done.length === 0) {
        continue;
      }

      const rule = ruleFor(formula, system);

      if (rule.type === "none") {
        continue;
      }

      const names = [
        ...new Set(done.flatMap((development) => development.names)),
      ];

      if (rule.type === "quantifier" && rule.rule.mark === "general") {
        marks.set(row.id, { names, type: "general" });
        continue;
      }

      const below = index.leaves(node.id);
      const everywhere = below.every(
        (leaf) =>
          leaf.end?.type === "closed" ||
          done.some((development) =>
            development.rows.some((each) =>
              index.isAtOrBelow(leaf.id, index.row(each.id)?.node.id ?? ""),
            ),
          ),
      );

      if (everywhere) {
        marks.set(row.id, { names, type: "resolved" });
      }
    }
  }

  return marks;
}
