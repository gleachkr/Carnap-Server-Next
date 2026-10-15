/**
 * Differential testing of the generic truth-tree checker against the UBC one
 * (gh #46, #440).
 *
 * A generator develops a root the way *forall x: UBC* does, rule by rule,
 * using the old checker's own rule derivation (`logic/rules.ts`), and can
 * inject one fault while it does: a step skipped, a wrong row, a wrong
 * citation, a step of the wrong shape, an old name for a new one, a branch
 * marked open that should close, a closure on the wrong rows, a branch left
 * unended. Each tree is then judged twice, by the old checker and by the
 * engine-backed judge as the browser runs it (compile, ask for instances,
 * compile again), and the two reports are projected onto what both say:
 * the verdict, which developments are wrong or unfinished, what each end
 * says, what an open branch is missing, and the marks.
 *
 * The margin names each step's rule as a student would type it, the book's
 * label; the old checker ignores it.
 */

import type { LoadedCompiler } from "@aufbau/compiler";
import type { TableauDocument } from "../../src/tableau/document";
import { TableauIndex } from "../../src/tableau/document";
import type { Formula } from "../../src/worker/exercise-kit/formula";
import {
  complementary,
  formulaToString,
  isLiteral,
  namesIn,
  replaceName,
  sameFormula,
  substitute,
} from "../../src/worker/exercise-kit/formula";
import {
  heldInstances,
  readTreeDiagnostics,
} from "../../src/worker/exercises/truth-tree/aufbau/emit";
import type { TreeEvidence } from "../../src/worker/exercises/truth-tree/aufbau/judge";
import type { ResolvedTree } from "../../src/worker/exercises/truth-tree/grading";
import {
  judgeTree,
  treeProofOf,
} from "../../src/worker/exercises/truth-tree/grading";
import type {
  Missing,
  RowProblem,
  TreeReport,
} from "../../src/worker/exercises/truth-tree/logic/check";
import { isIncomplete } from "../../src/worker/exercises/truth-tree/logic/check";
import type { RuleName } from "../../src/worker/exercises/truth-tree/logic/rules";
import { ruleFor } from "../../src/worker/exercises/truth-tree/logic/rules";
import { FORALLX_UBC } from "../../src/worker/exercises/truth-tree/logic/system";
import { TreeBuilder, UBC, ubcFormula } from "./truth-tree";

/** What the generator can get wrong, once. */
export type FaultKind =
  /** Leave a step unwritten, and carry on as if it were done. */
  | "skip"
  /** Write one of a step's rows negated (or un-negated). */
  | "wrong-row"
  /** Cite another row on the branch than the one developed. */
  | "wrong-cite"
  /** Write only the first row of a stack of two or more. */
  | "partial"
  /** Stack a split's branches, or split a stack. */
  | "shape"
  /** Instantiate `∃` or `¬∀` with a name already on the branch. */
  | "old-name"
  /** Mark open a branch that should close. */
  | "open-closed"
  /** Close a complete open branch, citing its first two rows. */
  | "bad-closure"
  /** Mark a branch open in place of its next step. */
  | "premature-open"
  /** Leave an identity's substitution unwritten (UBC §12.7). */
  | "skip-identity";

export const FAULT_KINDS: readonly FaultKind[] = [
  "skip",
  "wrong-row",
  "wrong-cite",
  "partial",
  "shape",
  "old-name",
  "open-closed",
  "bad-closure",
  "premature-open",
  "skip-identity",
];

export interface GenerateOptions {
  readonly fault?: { readonly kind: FaultKind; readonly at: number };
  /** Write a general row's instances in one step, up to five, or one each. */
  readonly multi?: boolean;
  /** Leave every branch unended: no ×, no ↑. */
  readonly unended?: boolean;
  /** The most rows on a branch; past it the branch is left unended. */
  readonly branchCap?: number;
  /**
   * The most rows in the tree; past it every branch still growing is left
   * unended. It is kept under the system's row cap, past which both
   * checkers refuse a tree unread and so agree without checking anything.
   */
  readonly treeCap?: number;
}

export interface GeneratedTree {
  readonly builder: TreeBuilder;
  /** Whether the fault was injected (or there was none to inject). */
  readonly faulted: boolean;
  /** Whether some branch hit a cap. */
  readonly capped: boolean;
  /** How many steps were written: fault positions range over these. */
  readonly steps: number;
}

/**
 * A wrong quantifier step on a long branch exhausts the compiler's memory
 * (design/aufbau-issues-2026-10-15, issue 1), so a fault on one is injected
 * only on a branch this short.
 */
const QUANTIFIER_FAULT_ROWS = 5;

const NAMES = "abcdefghijklmnopqrst".split("");

/** The book's margin label for a rule, as the theory aliases it. */
export function ruleLabel(name: RuleName): string {
  const head = name.head;
  const not = name.negated ? "¬" : "";

  switch (head.type) {
    case "binary": {
      const symbol: Partial<Record<string, string>> = {
        and: "∧",
        if: "→",
        iff: "↔",
        or: "∨",
      };
      return `${not}${symbol[head.connective] ?? head.connective}`;
    }
    case "not":
      return "¬¬";
    case "forall":
      return `${not}∀`;
    case "exists":
      return `${not}∃`;
    case "identity":
      return "=";
  }
}

interface Row {
  readonly id: string;
  readonly formula: Formula;
}

interface Branch {
  readonly node: string;
  readonly rows: readonly Row[];
  /** Rows a once-only rule has developed (or the generator gave up on). */
  readonly resolved: ReadonlySet<string>;
  /** General rows' instances so far, by row. */
  readonly general: ReadonlyMap<string, ReadonlySet<string>>;
  /** Identities whose substitution was skipped on purpose. */
  readonly skipped: ReadonlySet<string>;
}

const text = (formula: Formula): string => formulaToString(formula, UBC);
const negate = (formula: Formula): Formula =>
  formula.type === "not"
    ? formula.operand
    : { operand: formula, type: "not" };
const constant = (name: string) => ({ name, type: "constant" as const });

function isSelfNonIdentity(formula: Formula): boolean {
  return (
    formula.type === "not" &&
    formula.operand.type === "identity" &&
    sameFormula(formula.operand, {
      ...formula.operand,
      right: formula.operand.left,
    })
  );
}

function isSelfIdentity(formula: Formula): boolean {
  return (
    formula.type === "identity" &&
    sameFormula(formula, { ...formula, right: formula.left })
  );
}

/** The first rows, in branch order, that close a branch, as `closing` finds them. */
function closure(rows: readonly Row[]): string[] | null {
  for (const [at, row] of rows.entries()) {
    if (isSelfNonIdentity(row.formula)) {
      return [row.id];
    }

    for (const earlier of rows.slice(0, at)) {
      if (complementary(earlier.formula, row.formula)) {
        return [earlier.id, row.id];
      }
    }
  }

  return null;
}

function branchNames(rows: readonly Row[]): string[] {
  return [...new Set(rows.flatMap((row) => namesIn(row.formula)))];
}

/** An identity between two different names, as `[left, right]`. */
function nameIdentity(formula: Formula): [string, string] | null {
  return formula.type === "identity" &&
    formula.left.type === "constant" &&
    formula.right.type === "constant" &&
    formula.left.name !== formula.right.name
    ? [formula.left.name, formula.right.name]
    : null;
}

/**
 * Develop `root` to the end, as UBC's procedure does: close a branch as soon
 * as it can, then resolve the stacking rules, the new-name rules and the
 * splitting rules in that order, instantiate every general row for every
 * name, and substitute every identity into every literal, in one direction.
 */
export function generate(
  root: readonly string[],
  options: GenerateOptions = {},
): GeneratedTree {
  const builder = new TreeBuilder(root);
  const cap = options.branchCap ?? 24;
  const treeCap = options.treeCap ?? 120;
  const treeRows = (): number =>
    builder.tree.nodes.reduce((sum, node) => sum + node.rows.length, 0);
  const fault = options.fault;
  let steps = 0;
  let faulted = fault === undefined;
  let capped = false;
  /** Whether the step being written is the one to get wrong. */
  const due = (applicable: boolean): boolean => {
    if (faulted || fault === undefined || !applicable || steps < fault.at) {
      return false;
    }

    faulted = true;
    return true;
  };

  const grow = (branch: Branch): void => {
    const { node, rows } = branch;
    const end = (kind: "open" | "close", cites: readonly string[] = []) => {
      if (options.unended) {
        return;
      }

      if (kind === "open") {
        builder.open(node);
      } else {
        builder.close(node, ...cites);
      }
    };

    if (rows.length > cap || treeRows() > treeCap) {
      capped = true;
      return;
    }

    const closes = closure(rows);

    if (closes !== null) {
      end(due(fault?.kind === "open-closed") ? "open" : "close", closes);
      return;
    }

    if (due(fault?.kind === "premature-open")) {
      end("open");
      return;
    }

    steps += 1;

    const resolve = (row: Row): Branch => ({
      ...branch,
      resolved: new Set([...branch.resolved, row.id]),
    });
    const quantifierFaultable = rows.length <= QUANTIFIER_FAULT_ROWS;

    // The once-only rules: stacks, then new names, then splits.
    const pending = rows.filter((row) => !branch.resolved.has(row.id));
    const stacking = pending.find((row) => {
      const rule = ruleFor(row.formula, FORALLX_UBC);
      return rule.type === "branches" && rule.branches.length === 1;
    });
    const naming = pending.find((row) => {
      const rule = ruleFor(row.formula, FORALLX_UBC);
      return rule.type === "quantifier" && rule.rule.instance === "new";
    });
    const splitting = pending.find((row) => {
      const rule = ruleFor(row.formula, FORALLX_UBC);
      return rule.type === "branches" && rule.branches.length > 1;
    });
    const once = stacking ?? naming ?? splitting;

    if (once !== undefined) {
      const rule = ruleFor(once.formula, FORALLX_UBC);
      const next = resolve(once);

      if (rule.type === "branches") {
        writeBranches(next, once, rule.name, rule.branches);
      } else if (rule.type === "quantifier") {
        const names = branchNames(rows);
        const fresh = NAMES.find((name) => !names.includes(name)) ?? "z";
        const old = due(
          fault?.kind === "old-name" &&
            names.length > 0 &&
            quantifierFaultable,
        );
        const instance = substitute(
          rule.body,
          rule.variable,
          constant(old ? (names[0] as string) : fresh),
        );
        const written =
          rule.rule.yields === "negated-instance"
            ? negate(instance)
            : instance;
        writeStack(
          next,
          once,
          ruleLabel(rule.name),
          [written],
          quantifierFaultable,
        );
      }

      return;
    }

    // The general rules: an instance for every name, one on a nameless branch.
    const names = branchNames(rows);

    for (const row of rows) {
      const rule = ruleFor(row.formula, FORALLX_UBC);

      if (rule.type !== "quantifier" || rule.rule.instance !== "any") {
        continue;
      }

      const done = branch.general.get(row.id) ?? new Set<string>();
      const wanted = names.length === 0 ? ["a"] : names;
      const todo = wanted.filter((name) => !done.has(name));

      if (todo.length === 0) {
        continue;
      }

      const taking = options.multi ? todo.slice(0, 5) : todo.slice(0, 1);
      const written = taking.map((name) => {
        const instance = substitute(rule.body, rule.variable, constant(name));
        return rule.rule.yields === "negated-instance"
          ? negate(instance)
          : instance;
      });
      const next: Branch = {
        ...branch,
        general: new Map([
          ...branch.general,
          [row.id, new Set([...done, ...taking])],
        ]),
      };
      writeStack(
        next,
        row,
        ruleLabel(rule.name),
        written,
        quantifierFaultable,
      );
      return;
    }

    // Identity: substitute each `a=b` into every literal, one way round.
    for (const row of rows) {
      const names = nameIdentity(row.formula);

      if (names === null || branch.skipped.has(row.id)) {
        continue;
      }

      const [from, to] = names;
      const literal = rows.find((other) => {
        if (other.id === row.id || !isLiteral(other.formula)) {
          return false;
        }

        if (!namesIn(other.formula).includes(from)) {
          return false;
        }

        const rewritten = replaceName(other.formula, from, to);
        return (
          !isSelfIdentity(rewritten) &&
          !rows.some((each) => sameFormula(each.formula, rewritten))
        );
      });

      if (literal === undefined) {
        continue;
      }

      if (due(fault?.kind === "skip-identity")) {
        grow({ ...branch, skipped: new Set([...branch.skipped, row.id]) });
        return;
      }

      const rewritten = replaceName(literal.formula, from, to);
      const [id] = builder.stack(
        node,
        [row.id, literal.id],
        [text(rewritten)],
        "=",
      );
      grow({
        ...branch,
        rows: [...rows, { formula: rewritten, id: id as string }],
      });
      return;
    }

    // Nothing left to do: a complete open branch.
    steps -= 1;

    if (due(fault?.kind === "bad-closure" && rows.length >= 2)) {
      end("close", [rows[0]?.id as string, rows[1]?.id as string]);
      return;
    }

    end("open");
  };

  /** Write a stack, getting it wrong if the fault is due here. */
  const writeStack = (
    branch: Branch,
    cited: Row,
    label: string,
    formulas: readonly Formula[],
    faultable = true,
  ): void => {
    let written = [...formulas];
    let cite = cited.id;
    let shape: "stack" | "split" = "stack";

    if (due(fault?.kind === "skip" && faultable)) {
      grow(branch);
      return;
    }

    if (due(fault?.kind === "wrong-row" && faultable)) {
      written = written.map((formula, at) =>
        at === written.length - 1 ? negate(formula) : formula,
      );
    } else if (due(fault?.kind === "partial" && written.length >= 2)) {
      written = written.slice(0, 1);
    } else if (
      due(fault?.kind === "shape" && written.length >= 2 && faultable)
    ) {
      shape = "split";
    } else {
      const other = branch.rows.find(
        (row) =>
          row.id !== cited.id && !sameFormula(row.formula, cited.formula),
      );

      if (
        due(fault?.kind === "wrong-cite" && other !== undefined && faultable)
      ) {
        cite = other?.id as string;
      }
    }

    if (shape === "split") {
      const made = builder.split(
        branch.node,
        cite,
        written.map((formula) => [text(formula)]),
        label,
      );

      for (const [at, child] of made.nodes.entries()) {
        grow({
          ...branch,
          node: child,
          rows: [
            ...branch.rows,
            {
              formula: written[at] as Formula,
              id: made.rows[at]?.[0] as string,
            },
          ],
        });
      }
      return;
    }

    const ids = builder.stack(branch.node, cite, written.map(text), label);
    grow({
      ...branch,
      rows: [
        ...branch.rows,
        ...written.map((formula, at) => ({ formula, id: ids[at] as string })),
      ],
    });
  };

  /** Write a rule's branches: a stack for one, a split for several. */
  const writeBranches = (
    branch: Branch,
    cited: Row,
    name: RuleName,
    branches: readonly (readonly Formula[])[],
  ): void => {
    const label = ruleLabel(name);

    if (branches.length === 1) {
      writeStack(branch, cited, label, branches[0] as readonly Formula[]);
      return;
    }

    if (due(fault?.kind === "skip")) {
      grow(branch);
      return;
    }

    let written = branches.map((formulas) => [...formulas]);
    let cite = cited.id;

    if (due(fault?.kind === "shape")) {
      writeStack(branch, cited, label, written.flat(), false);
      return;
    }

    if (due(fault?.kind === "wrong-row")) {
      written = written.map((formulas, at) =>
        at === 0
          ? [negate(formulas[0] as Formula), ...formulas.slice(1)]
          : formulas,
      );
    } else if (
      due(
        fault?.kind === "partial" && written.some((each) => each.length >= 2),
      )
    ) {
      written = written.map((formulas) => formulas.slice(0, 1));
    } else {
      const other = branch.rows.find(
        (row) =>
          row.id !== cited.id && !sameFormula(row.formula, cited.formula),
      );

      if (due(fault?.kind === "wrong-cite" && other !== undefined)) {
        cite = other?.id as string;
      }
    }

    const made = builder.split(
      branch.node,
      cite,
      written.map((formulas) => formulas.map(text)),
      label,
    );

    for (const [at, child] of made.nodes.entries()) {
      const formulas = written[at] as Formula[];
      grow({
        ...branch,
        node: child,
        rows: [
          ...branch.rows,
          ...formulas.map((formula, row) => ({
            formula,
            id: made.rows[at]?.[row] as string,
          })),
        ],
      });
    }
  };

  grow({
    general: new Map(),
    node: builder.rootNode,
    resolved: new Set(),
    rows: root.map((each, at) => ({
      formula: ubcFormula(each),
      id: builder.root[at] as string,
    })),
    skipped: new Set(),
  });

  return { builder, capped, faulted, steps };
}

/** What both checkers say about a tree, in terms they share. */
export interface Projection {
  /**
   * What the tree shows, where that can be seen: only a tree with no
   * problems shows anything (`treeVerdict` is read only when the judgement is
   * ok). The two checkers differ on a faulty tree's flags, and that is not a
   * difference anyone sees: the old one finds a rightly open branch beside a
   * wrong step elsewhere, and the generic one wants the whole tree confirmed.
   */
  readonly verdict: string;
  /** By development (`root:<row>` for a root row): `wrong` or `incomplete`. */
  readonly developments: Readonly<Record<string, string>>;
  /** By node: the end's problem, closure problems as one. */
  readonly ends: Readonly<Record<string, string>>;
  /** By leaf: an unended branch's completeness and what it is missing. */
  readonly unended: Readonly<Record<string, string>>;
  readonly marks: Readonly<Record<string, string>>;
}

function missingText(missing: readonly Missing[]): string {
  return missing
    .map(
      (each) =>
        `${each.row}${each.names === undefined ? "" : `[${[...each.names].sort().join(",")}]`}${each.substitution ? "=" : ""}`,
    )
    .sort()
    .join(" ");
}

function endText(
  problem: { readonly type: string } & Record<string, unknown>,
): string {
  switch (problem.type) {
    case "closure-not-contradiction":
    case "closure-not-self-non-identity":
    case "closure-wrong":
      return "closure-wrong";
    case "open-incomplete":
      return `open-incomplete ${missingText(problem.missing as readonly Missing[])}`;
    case "open-contradiction":
      return `open-contradiction ${[...(problem.rows as readonly string[])].sort().join(" ")}`;
    default:
      return problem.type;
  }
}

function rowClass(problem: RowProblem): string {
  return isIncomplete(problem) ? "incomplete" : "wrong";
}

/**
 * A report as both checkers can be compared on it. A development is keyed by
 * its id and the rule its margin names, `t4 (∧)`.
 */
export function project(
  tree: TableauDocument,
  report: TreeReport,
  rules: Readonly<Record<string, string>> = {},
): Projection {
  const index = new TableauIndex(tree);
  const developments: Record<string, string> = {};

  for (const [rowId, problem] of report.rows) {
    const row = index.row(rowId)?.row;
    const key =
      row === undefined || row.dev === "root"
        ? `root:${rowId}`
        : `${row.dev} (${rules[row.dev] ?? ""})`;
    const kind = rowClass(problem);

    // A development is wrong if any of its rows is.
    if (developments[key] !== "wrong") {
      developments[key] = kind;
    }
  }

  const ends: Record<string, string> = {};

  for (const [nodeId, problem] of report.ends) {
    ends[nodeId] = endText(problem as never);
  }

  const unended: Record<string, string> = {};

  for (const [leaf, state] of report.branches) {
    if (state.type === "unfinished") {
      unended[leaf] =
        `${state.complete ? "complete" : "incomplete"}; missing ${missingText(state.missing)}; closes ${state.contradiction === null ? "-" : [...state.contradiction].sort().join(" ")}`;
    }
  }

  const marks: Record<string, string> = {};

  for (const [rowId, mark] of report.marks) {
    marks[rowId] = `${mark.type} ${[...mark.names].sort().join(",")}`;
  }

  return {
    developments,
    ends,
    marks,
    unended,
    verdict:
      report.problems.length > 0
        ? "has problems"
        : `closed ${report.closed}, open ${report.open}, finished ${report.finished}`,
  };
}

/**
 * The generic checker's report on a tree, as the browser makes it: one
 * compile asking every candidate instance, the instances that held, and a
 * second compile for the certificate where the derivation changed.
 */
export function judgeAsBrowser(
  compiler: LoadedCompiler,
  resolved: ResolvedTree,
  mm0: string,
  answer: {
    readonly nodes: TableauDocument["nodes"];
    readonly rules: Readonly<Record<string, string>>;
  },
): TreeReport {
  const slots = treeProofOf(resolved, answer, new Map()).slots;
  const asking = treeProofOf(resolved, answer, slots);
  let evidence: TreeEvidence = {
    certified: false,
    errors: [],
    kind: "compiled",
  };
  let submitted: typeof answer & { instances?: Record<string, string> } =
    answer;

  if (asking.goal !== null && asking.proof !== null) {
    const asked = compiler.compile(`${mm0}\n${asking.goal}\n`, asking.proof);
    const errors = readTreeDiagnostics(
      asked.ok ? [] : asked.diagnostics,
      asking,
    );
    const held = heldInstances(asking, errors);
    submitted =
      held.size === 0
        ? answer
        : { ...answer, instances: Object.fromEntries(held) };
    const stepErrors = errors.filter(
      (error) => error.subject?.type !== "link",
    );
    let certified = stepErrors.length === 0 && asked.ok === true;
    const final = treeProofOf(resolved, submitted);

    if (
      stepErrors.length === 0 &&
      final.goal !== null &&
      final.proof !== null &&
      (final.goal !== asking.goal || final.proof !== asking.proof)
    ) {
      const run = compiler.compile(`${mm0}\n${final.goal}\n`, final.proof);
      certified = run.ok === true;
    }

    evidence = { certified, errors: stepErrors, kind: "compiled" };
  }

  return judgeTree(resolved, submitted, evidence).report;
}

/** One field on which the two checkers differ. */
export interface Difference {
  readonly field: "verdict" | "development" | "end" | "unended" | "mark";
  readonly key: string;
  readonly old: string | null;
  readonly generic: string | null;
}

export function describe(difference: Difference): string {
  return `${difference.field} ${difference.key}: old ${JSON.stringify(difference.old)}, generic ${JSON.stringify(difference.generic)}`;
}

/** Where two projections differ, field by field; empty when they agree. */
export function differences(
  old: Projection,
  generic: Projection,
): Difference[] {
  const found: Difference[] = [];
  const compare = (
    field: Difference["field"],
    a: Readonly<Record<string, string>>,
    b: Readonly<Record<string, string>>,
  ) => {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const left = a[key] ?? null;
      const right = b[key] ?? null;

      if (left !== right) {
        found.push({ field, generic: right, key, old: left });
      }
    }
  };

  compare("verdict", { tree: old.verdict }, { tree: generic.verdict });
  compare("development", old.developments, generic.developments);
  compare("end", old.ends, generic.ends);
  compare("unended", old.unended, generic.unended);
  compare("mark", old.marks, generic.marks);

  return found;
}

/**
 * The differences the generic checker is known to have, by name, each with
 * why it is not (yet) a fault. Anything else is.
 */
export const KNOWN_DIFFERENCES = {
  /**
   * A row a step cites by another row's rule: the old checker marks it as
   * developed (with no names, for a general row), the generic one marks rows
   * only by the rule they develop by. Either way the step is wrong.
   */
  "mark-from-a-wrong-rule": (all: readonly Difference[]) =>
    all.filter(
      (each) =>
        each.field === "mark" &&
        each.generic === null &&
        each.old === "general ",
    ),
} as const;

/** The differences no known difference explains. */
export function unexplained(all: readonly Difference[]): Difference[] {
  const explained = new Set(
    Object.values(KNOWN_DIFFERENCES).flatMap((known) => known(all)),
  );
  const rest = all.filter((each) => !explained.has(each));

  // The verdict follows from the rest: where every other difference is a
  // known one, so is the verdict's.
  return rest.every((each) => each.field === "verdict") && explained.size > 0
    ? []
    : rest;
}
