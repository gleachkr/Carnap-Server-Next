/**
 * When a row is developed on a branch, as the theory says (gh #46).
 *
 * A book calls an open branch complete by what has been done on it: every
 * row a rule applies to resolved, every general row instantiated for each
 * name on the branch, and so on. Which is which is the theory's to say, by a
 * rule's `@syntax role tree.development.<kind>[.<arg>…]`, and what each kind
 * asks is a {@link DevelopmentCriterion} in {@link CRITERIA}: a new kind is
 * one entry there, not a change to the judge.
 *
 * The evidence is the student's own verified steps, never a check of whether
 * a rule would still add something: the books are stricter than that in
 * places (a conjunction is not developed because its conjuncts arrived some
 * other way) and more lenient in others.
 *
 * A rule a step can name is a chain: the axiom the student's name resolves
 * to and every axiom it falls back on (`@fallback`), which state the same
 * rule in other orders or for more instances. Its roles are on the axiom the
 * name resolves to.
 *
 * DOM-free and free of i18n: the problems are data, and the author's
 * diagnostics word them.
 */

import type { AssertStatement, SurfaceLanguage, Term } from "@aufbau/syntax";
import { roleIndex } from "../../../logic/specs/roles";
import type { Missing } from "../logic/check";
import type { Bindings } from "./patterns";
import { matchTerm, occursFree } from "./patterns";
import type { TreeTheory } from "./theory";

/** The namespace a development role is in: `tree.development.general.te`. */
const DEVELOPMENT = "tree.development.";

/** A rule statement's terms, as patterns. */
export interface RulePatterns {
  /** The rows the rule develops, at the row sort; one for most rules. */
  readonly focus: readonly Term[];
  /** The rows each premise writes onto its branch, beyond the branch. */
  readonly written: readonly (readonly Term[])[];
  /** The statement's binders: its metavariables. */
  readonly metas: ReadonlySet<string>;
  readonly binders: AssertStatement["binders"];
}

/** A general step's instance: which binder, and the row it is written in. */
export interface InstanceSlot {
  readonly binder: string;
  readonly sort: string;
  /** The premise row that mentions the binder: `{x / te} ph`. */
  readonly template: Term;
  /**
   * The metavariables of the template that may mention a bound variable, and
   * which: where none does, the instance is vacuous (`∀x Fa`).
   */
  readonly dependents: readonly {
    readonly meta: string;
    readonly on: string;
  }[];
}

/** A step citing a row by its rule, on the branch at hand. */
export interface DevelopingStep {
  readonly dev: string;
  /**
   * The instance each row of the step was written with, by the engine's
   * word, in the step's order; null where none is confirmed.
   */
  readonly instances: readonly (string | null)[];
}

/** What a criterion reads to say whether a row is developed on a branch. */
export interface ObligationInput {
  readonly row: string;
  readonly rule: DevelopmentRule;
  /** The verified steps on the branch that develop the row by this rule. */
  readonly steps: readonly DevelopingStep[];
  /** The closed terms of a sort on the branch, by engine text. */
  readonly terms: (sort: string) => readonly string[];
  /** Whether the row's instances are vacuous (`∀x Fa`); false without one. */
  readonly vacuous: boolean;
}

/** One kind of development criterion, as a role names it. */
export interface DevelopmentCriterion {
  readonly kind: string;
  /**
   * The role's arguments and the rule's flags read against the rule, or what
   * is wrong with them. `instance` is the binder whose instance each written
   * row confirms (by a link theorem), if the criterion counts instances.
   */
  readonly read: (
    args: readonly string[],
    flags: ReadonlySet<string>,
    rule: RulePatterns,
  ) =>
    | {
        readonly instance: string | null;
        readonly flags: ReadonlySet<string>;
      }
    | CriterionProblem;
  /** What a matching row still needs on a branch; null once developed. */
  readonly missing: (input: ObligationInput) => Missing | null;
  /** What a row's mark says: that it is resolved, or the names it took. */
  readonly mark: "resolved" | "general" | null;
}

/** Why a rule's development roles do not read. */
export type CriterionProblem =
  | { readonly type: "unknown-kind"; readonly kind: string }
  | { readonly type: "several-kinds" }
  | { readonly type: "bad-arguments"; readonly expected: string }
  | { readonly type: "unknown-binder"; readonly binder: string }
  | { readonly type: "single-row-focus" }
  | { readonly type: "no-template"; readonly binder: string }
  | { readonly type: "unknown-flag"; readonly flag: string };

const KINDS: readonly DevelopmentCriterion[] = [
  {
    kind: "once",
    mark: "resolved",
    missing: ({ row, steps }) => (steps.length > 0 ? null : { row }),
    read: (args, flags, rule) => {
      if (args.length > 1) {
        return { expected: "once[.binder]", type: "bad-arguments" };
      }

      return singleRow(rule) ?? instanceOf(args[0] ?? null, flags, [], rule);
    },
  },
  {
    kind: "general",
    mark: "general",
    missing: ({ row, rule, steps, terms, vacuous }) => {
      const slot = rule.instance;

      if (vacuous || slot === null) {
        return steps.length > 0 ? null : { names: [], row };
      }

      const all = terms(slot.sort);

      if (all.length === 0) {
        return rule.flags.has("nonempty") && steps.length === 0
          ? { names: [], row }
          : null;
      }

      const seen = new Set(steps.flatMap((step) => step.instances));
      const needed = all.filter((term) => !seen.has(term));

      return needed.length === 0 ? null : { names: needed, row };
    },
    read: (args, flags, rule) => {
      if (args.length !== 1) {
        return { expected: "general.binder", type: "bad-arguments" };
      }

      return (
        singleRow(rule) ??
        instanceOf(args[0] as string, flags, ["nonempty"], rule)
      );
    },
  },
  {
    kind: "none",
    mark: null,
    missing: () => null,
    read: (args, flags) =>
      args.length > 0
        ? { expected: "none", type: "bad-arguments" }
        : instanceOf(null, flags, []),
  },
];

/** Every criterion a theory may name, by kind. */
export const CRITERIA: ReadonlyMap<string, DevelopmentCriterion> = new Map(
  KINDS.map((criterion) => [criterion.kind, criterion]),
);

function singleRow(rule: RulePatterns): CriterionProblem | null {
  return rule.focus.length === 1 ? null : { type: "single-row-focus" };
}

/** A criterion's reading: its instance binder, checked, and its flags. */
function instanceOf(
  binder: string | null,
  flags: ReadonlySet<string>,
  allowed: readonly string[],
  rule?: RulePatterns,
):
  | { readonly instance: string | null; readonly flags: ReadonlySet<string> }
  | CriterionProblem {
  for (const flag of flags) {
    if (!allowed.includes(flag)) {
      return { flag, type: "unknown-flag" };
    }
  }

  if (binder !== null && rule !== undefined && !rule.metas.has(binder)) {
    return { binder, type: "unknown-binder" };
  }

  return { flags, instance: binder };
}

/** A rule a step can name, and what developing a row by it asks. */
export interface DevelopmentRule {
  /** The axiom a student's name for it resolves to. */
  readonly name: string;
  /** It and every axiom it falls back on. */
  readonly chain: ReadonlySet<string>;
  readonly patterns: RulePatterns;
  /**
   * How many rows each axiom of the chain writes on each branch, sorted: a
   * step must write one of these. The engine cannot tell, because a branch
   * is a set and a row already on it is not written again (`A ∧ B` with `B`
   * above gives `Γ ; A ; B`, which is `Γ ; A`).
   */
  readonly shapes: readonly (readonly number[])[];
  /** Null where its roles do not read: an author's diagnostic. */
  readonly criterion: DevelopmentCriterion | null;
  readonly flags: ReadonlySet<string>;
  /** Where each written row's instance is, if the criterion counts them. */
  readonly instance: InstanceSlot | null;
}

/** How the engine is shown a row is an instance: the judgement relation. */
export interface JudgementRelation {
  /** `jj ⟚ jj`. */
  readonly refl: string;
  /** From `jj ⟚ kk` and `jj`, `kk`. */
  readonly mp: string;
}

/** A theory's development rules, and what is wrong with them. */
export interface TreeDevelopment {
  readonly rules: readonly DevelopmentRule[];
  /** By every axiom of every chain, the rule it belongs to. */
  readonly byAxiom: ReadonlyMap<string, DevelopmentRule>;
  /** The closure rule's chain, as patterns: what closes a branch. */
  readonly closure: readonly RulePatterns[];
  readonly relation: JudgementRelation | null;
  /** Whether any rule carries a development role. */
  readonly annotated: boolean;
  readonly problems: readonly {
    readonly rule: string;
    readonly problem: CriterionProblem | { readonly type: "no-relation" };
  }[];
}

const cache = new WeakMap<SurfaceLanguage, TreeDevelopment>();

/** A tree theory's development rules, read once per language. */
export function readTreeDevelopment(
  language: SurfaceLanguage,
  theory: TreeTheory,
): TreeDevelopment {
  const cached = cache.get(language);

  if (cached !== undefined) {
    return cached;
  }

  const read = readDevelopment(language, theory);
  cache.set(language, read);

  return read;
}

function readDevelopment(
  language: SurfaceLanguage,
  theory: TreeTheory,
): TreeDevelopment {
  const { spec } = language;
  const statements = new Map<string, AssertStatement>();

  for (const statement of spec.statements) {
    if (statement.kind === "axiom" || statement.kind === "theorem") {
      statements.set(statement.name, statement);
    }
  }

  const chainOf = (name: string): string[] => {
    const chain: string[] = [];
    let next: string | null = name;

    while (next !== null && !chain.includes(next)) {
      chain.push(next);
      next = spec.rules.get(next)?.fallback ?? null;
    }

    return chain;
  };
  const fallenBackOn = new Set(
    [...spec.rules.values()].flatMap((info) =>
      info.fallback === null ? [] : [info.fallback],
    ),
  );
  const patternsOf = (name: string): RulePatterns | null => {
    const statement = statements.get(name);
    return statement === undefined
      ? null
      : rulePatterns(language, theory, statement);
  };

  const rules: DevelopmentRule[] = [];
  const byAxiom = new Map<string, DevelopmentRule>();
  const problems: TreeDevelopment["problems"][number][] = [];
  const closureChain = chainOf(theory.closure);
  let annotated = false;

  for (const [name, info] of spec.rules) {
    if (
      fallenBackOn.has(name) ||
      closureChain.includes(name) ||
      name === theory.unfocus
    ) {
      continue;
    }

    const patterns = patternsOf(name);

    if (patterns === null) {
      continue; // not a step: its conclusion is not a focused branch
    }

    const roles = info.roles
      .filter((role) => role.startsWith(DEVELOPMENT))
      .map((role) => role.slice(DEVELOPMENT.length).split("."));
    // A kind with its arguments, or a one-word flag; anything else is a
    // kind the registry does not have.
    const kinds = roles.filter(([kind]) => CRITERIA.has(kind ?? ""));
    const others = roles.filter(([kind]) => !CRITERIA.has(kind ?? ""));
    const unknown = others.find((parts) => parts.length > 1);
    const flags = new Set(
      others
        .filter((parts) => parts.length === 1)
        .map(([flag]) => flag ?? ""),
    );
    const fail = (problem: CriterionProblem): void => {
      problems.push({ problem, rule: name });
    };

    annotated ||= roles.length > 0;

    let criterion: DevelopmentCriterion | null = null;
    let instance: InstanceSlot | null = null;

    if (unknown !== undefined) {
      fail({ kind: unknown[0] ?? "", type: "unknown-kind" });
    } else if (kinds.length > 1) {
      fail({ type: "several-kinds" });
    } else {
      // Unannotated, a rule on one row is used once; one on several asks
      // nothing.
      const [kind, ...args] = kinds[0] ?? [
        patterns.focus.length === 1 ? "once" : "none",
      ];
      const chosen = CRITERIA.get(kind ?? "") as DevelopmentCriterion;
      const reading = chosen.read(args, flags, patterns);

      if ("type" in reading) {
        fail(reading);
      } else if (reading.instance === null) {
        criterion = chosen;
      } else {
        instance = instanceSlot(patterns, reading.instance);

        if (instance === null) {
          fail({ binder: reading.instance, type: "no-template" });
        } else {
          criterion = chosen;
        }
      }
    }

    const chain = chainOf(name);
    const rule: DevelopmentRule = {
      chain: new Set(chain),
      criterion,
      flags,
      instance,
      name,
      patterns,
      shapes: chain.flatMap((axiom) => {
        const each = patternsOf(axiom);
        return each === null ? [] : [rowShape(each.written)];
      }),
    };

    rules.push(rule);

    for (const axiom of rule.chain) {
      byAxiom.set(axiom, rule);
    }
  }

  const relation = judgementRelation(language, theory);

  if (relation === null) {
    for (const rule of rules) {
      if (rule.instance !== null) {
        problems.push({ problem: { type: "no-relation" }, rule: rule.name });
      }
    }
  }

  return {
    annotated,
    byAxiom,
    closure: closureChain.flatMap((name) => {
      const patterns = patternsOf(name);
      return patterns === null ? [] : [patterns];
    }),
    problems,
    relation,
    rules: relation === null ? rules.map(withoutInstance) : rules,
  };
}

/** How many rows each branch holds, sorted: branches may come in any order. */
export function rowShape(
  branches: readonly (readonly unknown[])[],
): readonly number[] {
  return branches.map((rows) => rows.length).sort((a, b) => a - b);
}

/** A rule whose instances cannot be confirmed asks only that it be used. */
function withoutInstance(rule: DevelopmentRule): DevelopmentRule {
  return rule.instance === null ? rule : { ...rule, instance: null };
}

/**
 * A rule statement read as patterns: `focus ga at (Δ)` for its conclusion,
 * `closes (ga ; rows)` for each premise. Null for a rule whose conclusion is
 * not a focused branch, or whose rows are not plain rows.
 */
export function rulePatterns(
  language: SurfaceLanguage,
  theory: TreeTheory,
  statement: AssertStatement,
): RulePatterns | null {
  const scope = new Map<string, string>();

  for (const binder of statement.binders) {
    if ("sort" in binder.type) {
      scope.set(binder.name, binder.type.sort);
    }
  }

  const judgement = language.spec.terms.get(theory.closes)?.returnSort;

  if (judgement === undefined) {
    return null;
  }

  const parse = (text: string): Term | null => {
    try {
      const read = language.parse(text.trim(), {
        lints: false,
        mode: "engine",
        scope,
        sort: judgement,
      });
      return read.ok ? read.term : null;
    } catch {
      return null;
    }
  };

  const conclusion = parse(statement.conclusion.text);

  if (
    conclusion?.kind !== "app" ||
    conclusion.term !== theory.focus ||
    conclusion.args.length !== 2
  ) {
    return null;
  }

  const [branch, cited] = conclusion.args as [Term, Term];
  // A rule that cites no row, as Cut does, focuses on the empty branch.
  const focus = rowsOf(language, theory, cited, null);

  if (focus === null) {
    return null;
  }

  const written: Term[][] = [];

  for (const hypothesis of statement.hypotheses) {
    if ("sort" in hypothesis) {
      return null;
    }

    const premise = parse(hypothesis.text);

    if (
      premise?.kind !== "app" ||
      premise.term !== theory.closes ||
      premise.args.length !== 1
    ) {
      return null;
    }

    const rows = rowsOf(language, theory, premise.args[0] as Term, branch);

    if (rows === null) {
      return null;
    }

    written.push(rows);
  }

  return {
    binders: statement.binders,
    focus,
    metas: new Set(scope.keys()),
    written,
  };
}

/**
 * A branch term's rows, flattened over the join, each unwrapped from its
 * coercion into the branch sort; `branch`, the rule's own branch
 * metavariable, and the empty branch are left out. Null if anything else is
 * in it.
 */
function rowsOf(
  language: SurfaceLanguage,
  theory: TreeTheory,
  term: Term,
  branch: Term | null,
): Term[] | null {
  const joinTerm = language.spec.terms.get(theory.closes)?.binders[0];
  const branchSort =
    joinTerm !== undefined && "sort" in joinTerm.type
      ? joinTerm.type.sort
      : null;
  const coercions = new Set(
    language.spec.coercions
      .filter(
        (coercion) =>
          coercion.to === branchSort && coercion.from === theory.rowSort,
      )
      .map((coercion) => coercion.name),
  );
  const join = roleIndex(language).termFor("context-join");
  const rows: Term[] = [];
  const walk = (node: Term): boolean => {
    if (node.kind === "app" && node.term === join) {
      return node.args.every(walk);
    }

    if (
      node.kind === "app" &&
      node.term === theory.empty?.term &&
      node.args.length === 0
    ) {
      return true;
    }

    if (
      branch !== null &&
      node.kind === "variable" &&
      branch.kind === "variable" &&
      node.name === branch.name
    ) {
      return true;
    }

    if (node.kind === "app" && coercions.has(node.term)) {
      const row = node.args[0];

      if (row === undefined) {
        return false;
      }

      rows.push(row);
      return true;
    }

    return false;
  };

  return walk(term) ? rows : null;
}

/**
 * Where a rule writes its instance: the one row of its one premise that
 * mentions the binder. Null if there is not exactly one.
 */
function instanceSlot(
  patterns: RulePatterns,
  binder: string,
): InstanceSlot | null {
  const [premise, ...others] = patterns.written;
  const rows = (premise ?? []).filter((row) => mentions(row, binder));
  const template = rows[0];
  const declared = patterns.binders.find((each) => each.name === binder);

  if (
    others.length > 0 ||
    rows.length !== 1 ||
    template === undefined ||
    declared === undefined ||
    !("sort" in declared.type)
  ) {
    return null;
  }

  const bound = new Set(
    patterns.binders.filter((each) => each.binds).map((each) => each.name),
  );
  const dependents = patterns.binders.flatMap((each) =>
    "sort" in each.type && mentions(template, each.name)
      ? each.type.dependencies
          .filter((on) => bound.has(on))
          .map((on) => ({ meta: each.name, on }))
      : [],
  );

  return { binder, dependents, sort: declared.type.sort, template };
}

/** Whether a term mentions a variable anywhere. */
function mentions(term: Term, name: string): boolean {
  return term.kind === "variable"
    ? term.name === name
    : term.args.some((argument) => mentions(argument, name));
}

/** Whether a row a rule matched gives vacuous instances: `∀x Fa`. */
export function isVacuous(slot: InstanceSlot, bindings: Bindings): boolean {
  return slot.dependents.every(({ meta, on }) => {
    const value = bindings.get(meta);
    const variable = bindings.get(on);

    return (
      value === undefined ||
      variable?.kind !== "variable" ||
      !occursFree(value, variable.name)
    );
  });
}

/** The bindings of a single-row rule's focus against a row; null if none. */
export function matchFocus(
  language: SurfaceLanguage,
  rule: DevelopmentRule,
  row: Term,
): Bindings | null {
  const [focus] = rule.patterns.focus;

  return rule.patterns.focus.length === 1 && focus !== undefined
    ? matchTerm(language, focus, row, rule.patterns.metas)
    : null;
}

/** The judgement sort's `@relation`, where it names a modus ponens. */
function judgementRelation(
  language: SurfaceLanguage,
  theory: TreeTheory,
): JudgementRelation | null {
  const sort = language.spec.terms.get(theory.closes)?.returnSort;

  for (const info of language.spec.rules.values()) {
    for (const annotation of info.foreignAnnotations) {
      const [head, of, , refl, , , mp] = annotation.text.trim().split(/\s+/u);

      if (
        head === "@relation" &&
        of === sort &&
        refl !== undefined &&
        mp !== undefined &&
        mp !== "_"
      ) {
        return { mp, refl };
      }
    }
  }

  return null;
}
