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
 * The evidence is the student's own verified steps: the books are stricter
 * than a check of whether a rule would still add something in places (UBC's
 * conjunction is not developed because its conjuncts arrived some other way)
 * and more lenient in others. A theory that says otherwise
 * (`tree.completeness.contents`, `./theory.ts`) counts a row developed once
 * its rule's conclusions are on the branch, step or no step, as the Open
 * Logic Project defines a complete branch. It can only waive a step, never
 * ask for one.
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
import type { Missing } from "../report";
import type { Bindings, Metas } from "./patterns";
import {
  matchAll,
  matchTerm,
  occursFree,
  statementReader,
  substitutionOf,
  termKey,
} from "./patterns";
import type { TreeTheory } from "./theory";
import { TREE_ROLES } from "./theory";

/** The namespace a development role is in: `tree.development.general.te`. */
const DEVELOPMENT = "tree.development.";

/** A rule statement's terms, as patterns. */
export interface RulePatterns {
  /** The statement's name: the axiom. */
  readonly name: string;
  /** The rows the rule develops, at the row sort; one for most rules. */
  readonly focus: readonly Term[];
  /**
   * Rows the rule asks the branch to hold beside the ones it develops, which
   * the student does not cite: a witness, as `□𝕋`'s row at the prefix it goes
   * to witnesses that the prefix is used. Usually none.
   */
  readonly side: readonly Term[];
  /** The rows each premise writes onto its branch, beyond the branch. */
  readonly written: readonly (readonly Term[])[];
  /**
   * The check marks each premise writes beside them (`tree.mark`,
   * `tree.mark.instance`), which are not rows: no student types one.
   */
  readonly marks: readonly (readonly Term[])[];
  /** The branch metavariable: the rest of the branch (`ga`). */
  readonly branch: string;
  /** The statement's binders: its metavariables. */
  readonly metas: Metas;
  readonly binders: AssertStatement["binders"];
}

/** A general step's instance: which binder, and the row it is written in. */
export interface InstanceSlot {
  readonly binder: string;
  readonly sort: string;
  /**
   * The rows the rule writes that mention the binder: `{x / te} ph`. Most
   * rules write one; a branching rule writes its instance on every branch,
   * as `→𝕋` writes `τ 𝔽 A` on one and `τ 𝕋 B` on the other, and a rule may
   * write it more than once on a branch, as `→𝔽` writes `σ.n 𝕋 A` and
   * `σ.n 𝔽 B`.
   */
  readonly templates: readonly Term[];
  /**
   * What shows an instance: the binder itself, or, where its sort coerces
   * into no other (the step `n` of a prefix `σ.n`, which means nothing
   * alone), the argument of the template's row it is in (`σ.n`, or a whole
   * prefix `m` where the binder is one).
   */
  readonly shown: Term;
  /**
   * The metavariables of the templates that may mention a bound variable,
   * and which: where none does, the instance is vacuous (`∀x Fa`).
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
  /**
   * For a rule with side rows, the instances they find on the branch, by
   * engine text: the ones it must be used for (`□𝕋` at every prefix the
   * branch uses), in place of every term of the instance's sort. Null for a
   * rule without.
   */
  readonly witnessed: readonly string[] | null;
  /**
   * Where the theory judges by contents, each way the rule's conclusions are
   * on the branch already: the instance that way fixes, by engine text, or
   * null for a rule that counts none. Empty where it judges by steps.
   */
  readonly concluded: readonly (string | null)[];
  /**
   * For a rule on a pair of rows, set off by the row (`./complete.ts`
   * `paired`): whether some statement of it has its conclusions on the branch
   * for every row it pairs the row with. Null for a rule on one row.
   */
  readonly paired: boolean | null;
  /** Whether the row's instances are vacuous (`∀x Fa`); false without one. */
  readonly vacuous: boolean;
  /** An instance as a reader is shown it, by engine text (`InstanceSlot.shown`). */
  readonly shown: (instance: string) => string;
}

/** One kind of development criterion, as a role names it. */
export interface DevelopmentCriterion {
  readonly kind: string;
  /** The one-word flags it takes (`tree.development.nonempty`). */
  readonly flags: readonly string[];
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
  | { readonly type: "pair-focus" }
  | { readonly type: "no-template"; readonly binder: string }
  | { readonly type: "unknown-flag"; readonly flag: string };

const KINDS: readonly DevelopmentCriterion[] = [
  {
    flags: [],
    kind: "once",
    mark: "resolved",
    missing: ({ concluded, row, steps }) =>
      steps.length > 0 || concluded.length > 0 ? null : { row },
    read: (args, flags, rule) => {
      if (args.length > 1) {
        return { expected: "once[.binder]", type: "bad-arguments" };
      }

      return singleRow(rule) ?? instanceOf(args[0] ?? null, flags, rule);
    },
  },
  {
    flags: ["nonempty"],
    kind: "general",
    mark: "general",
    missing: ({
      concluded,
      row,
      rule,
      shown,
      steps,
      terms,
      vacuous,
      witnessed,
    }) => {
      const slot = rule.instance;
      const used = steps.length > 0 || concluded.length > 0;

      if (vacuous || slot === null) {
        return used ? null : { names: [], row };
      }

      const all = witnessed ?? terms(slot.sort);

      if (all.length === 0) {
        return rule.flags.has("nonempty") && !used
          ? { names: [], row }
          : null;
      }

      const seen = new Set([
        ...steps.flatMap((step) => step.instances),
        ...concluded,
      ]);
      const needed = all.filter((term) => !seen.has(term));

      return needed.length === 0 ? null : { names: needed.map(shown), row };
    },
    read: (args, flags, rule) => {
      if (args.length !== 1) {
        return { expected: "general.binder", type: "bad-arguments" };
      }

      return singleRow(rule) ?? instanceOf(args[0] as string, flags, rule);
    },
  },
  {
    // A rule on a pair of rows, set off by the first: the identity rule on
    // `a = b` and a row with `a` in it. The row is developed once one
    // statement of the rule has its conclusions on the branch for every row
    // there it pairs with, whether a step wrote them or not, since a step
    // cites the pair and the other row is not the row's to cite. One
    // statement for all: UBC's identity is substituted one way round, every
    // `a` made `b` or every `b` made `a`. Flag `literals`: only atomic and
    // negated atomic rows pair. The missing entry is worded as an identity's
    // substitution, the one rule written so.
    flags: ["literals"],
    kind: "pairs",
    mark: null,
    missing: ({ paired, row }) =>
      paired === false ? { row, substitution: true } : null,
    read: (args, flags, rule) => {
      if (args.length > 0) {
        return { expected: "pairs", type: "bad-arguments" };
      }

      return rule.focus.length === 2
        ? instanceOf(null, flags)
        : { type: "pair-focus" };
    },
  },
  {
    flags: [],
    kind: "none",
    mark: null,
    missing: () => null,
    read: (args, flags) =>
      args.length > 0
        ? { expected: "none", type: "bad-arguments" }
        : instanceOf(null, flags),
  },
];

/** Every criterion a theory may name, by kind. */
export const CRITERIA: ReadonlyMap<string, DevelopmentCriterion> = new Map(
  KINDS.map((criterion) => [criterion.kind, criterion]),
);

function singleRow(rule: RulePatterns): CriterionProblem | null {
  return rule.focus.length === 1 ? null : { type: "single-row-focus" };
}

/** Every flag some criterion takes. */
const FLAGS: ReadonlySet<string> = new Set(
  KINDS.flatMap((each) => each.flags),
);

/** A criterion's reading: its instance binder, checked, and its flags. */
function instanceOf(
  binder: string | null,
  flags: ReadonlySet<string>,
  rule?: RulePatterns,
):
  | { readonly instance: string | null; readonly flags: ReadonlySet<string> }
  | CriterionProblem {
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
   * The chain's axioms as patterns, in order: one rule stated more than one
   * way, as `□𝕋` is for a witness of either sign.
   */
  readonly variants: readonly RulePatterns[];
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
  /** Whether a row is developed by its conclusions being on the branch. */
  readonly byContents: boolean;
  readonly problems: readonly {
    /** The rule, or for a role on a term, the term. */
    readonly rule: string;
    readonly problem: DevelopmentProblem;
  }[];
}

/** What is wrong with a theory's development, beyond one rule's roles. */
export type DevelopmentProblem =
  | CriterionProblem
  /** A rule counts instances, and the judgement sort has no modus ponens. */
  | { readonly type: "no-relation" }
  /** A step's rule whose rows the patterns cannot read: never owed. */
  | { readonly type: "unreadable" }
  /** A `tree.` role Carnap does not know, as a misspelt one is. */
  | { readonly type: "unknown-role"; readonly role: string }
  /** The `tree.substitution` term is not `{x / te} ph`-shaped. */
  | { readonly type: "bad-substitution" };

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
  const problems: TreeDevelopment["problems"][number][] = [];
  const closureChain = chainOf(theory.closure);
  let annotated = false;

  for (const name of spec.rules.keys()) {
    if (
      fallenBackOn.has(name) ||
      closureChain.includes(name) ||
      name === theory.unfocus
    ) {
      continue;
    }

    const patterns = patternsOf(name);
    const statement = statements.get(name);

    if (patterns === null) {
      // Not a step, unless it concludes a focused branch: then a student
      // can name it, and nothing here can say when a row is owed it.
      if (statement !== undefined && isStep(language, theory, statement)) {
        problems.push({ problem: { type: "unreadable" }, rule: name });
      }

      continue;
    }

    const chain = chainOf(name);
    const variants = chain.flatMap((axiom) => {
      const each = patternsOf(axiom);
      return each === null ? [] : [[axiom, each] as const];
    });
    // The roles of every axiom the rule falls back on are the rule's too, so
    // a role means the same wherever in the chain it is written.
    const roles = [
      ...new Set(
        chain.flatMap((axiom) => spec.rules.get(axiom)?.roles ?? []),
      ),
    ]
      .filter((role) => role.startsWith(DEVELOPMENT))
      .map((role) => role.slice(DEVELOPMENT.length).split("."));
    // A kind with its arguments, or a one-word flag; anything else is a
    // kind the registry does not have.
    const kinds = roles.filter(([kind]) => CRITERIA.has(kind ?? ""));
    const others = roles.filter(([kind]) => !CRITERIA.has(kind ?? ""));
    const unknown = others.find(
      (parts) => parts.length > 1 || !FLAGS.has(parts[0] ?? ""),
    );
    const flags = new Set(others.map(([flag]) => flag ?? ""));
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
      const stray = [...flags].find((flag) => !chosen.flags.includes(flag));
      const reading: ReturnType<DevelopmentCriterion["read"]> =
        stray === undefined
          ? chosen.read(args, flags, patterns)
          : { flag: stray, type: "unknown-flag" };

      if ("type" in reading) {
        fail(reading);
      } else if (reading.instance === null) {
        criterion = chosen;
      } else {
        const binder = reading.instance;
        // Each statement's instance is found under the binder's name, so
        // every one must have it.
        const without = variants.find(([, each]) => !each.metas.has(binder));
        instance = instanceSlot(language, patterns, binder);

        if (without !== undefined) {
          instance = null;
          problems.push({
            problem: { binder, type: "unknown-binder" },
            rule: without[0],
          });
        } else if (instance === null) {
          fail({ binder, type: "no-template" });
        } else {
          criterion = chosen;
        }
      }
    }

    const rule: DevelopmentRule = {
      chain: new Set(chain),
      criterion,
      flags,
      instance,
      name,
      patterns,
      variants: variants.map(([, each]) => each),
    };

    rules.push(rule);
  }

  const closure = closureChain.flatMap((name) => {
    const patterns = patternsOf(name);
    return patterns === null ? [] : [patterns];
  });
  const relation = judgementRelation(language, theory);
  const substitution = roleIndex(language).termFor("tree.substitution");

  if (substitution !== null && substitutionOf(language) === null) {
    problems.push({
      problem: { type: "bad-substitution" },
      rule: substitution,
    });
  }

  for (const [owner, role] of treeRoles(language)) {
    if (!role.startsWith(DEVELOPMENT) && !TREE_ROLES.has(role)) {
      problems.push({ problem: { role, type: "unknown-role" }, rule: owner });
    }
  }

  if (relation === null) {
    for (const rule of rules) {
      if (rule.instance !== null) {
        problems.push({ problem: { type: "no-relation" }, rule: rule.name });
      }
    }
  }

  // The rules as they are used, so that a rule looked up by its axiom is
  // the very one in `rules`.
  const used = relation === null ? rules.map(withoutInstance) : rules;
  const byAxiom = new Map(
    used.flatMap((rule) => [...rule.chain].map((axiom) => [axiom, rule])),
  );

  return {
    annotated,
    byAxiom,
    byContents: theory.byContents,
    closure,
    problems,
    relation,
    rules: used,
  };
}

/** A rule whose instances cannot be confirmed asks only that it be used. */
function withoutInstance(rule: DevelopmentRule): DevelopmentRule {
  return rule.instance === null ? rule : { ...rule, instance: null };
}

/** Every `tree.` role in a theory, with the term or rule that carries it. */
function treeRoles(language: SurfaceLanguage): [string, string][] {
  const found: [string, string][] = [];

  for (const table of [language.spec.terms, language.spec.rules]) {
    for (const [name, info] of table) {
      for (const role of info.roles) {
        if (role.startsWith("tree.")) {
          found.push([name, role]);
        }
      }
    }
  }

  return found;
}

/** Whether a statement concludes a focused branch: a step's rule. */
function isStep(
  language: SurfaceLanguage,
  theory: TreeTheory,
  statement: AssertStatement,
): boolean {
  const judgement = language.spec.terms.get(theory.closes)?.returnSort;
  const conclusion =
    judgement === undefined
      ? null
      : statementReader(
          language,
          statement,
          judgement,
        )(statement.conclusion.text);

  return conclusion?.kind === "app" && conclusion.term === theory.focus;
}

/**
 * A rule statement read as patterns: `focus (ga ; side) at (Δ)` for its
 * conclusion, `closes (ga ; side ; rows)` for each premise. Null for a rule
 * whose conclusion is not a focused branch, or whose rows are not plain rows.
 */
export function rulePatterns(
  language: SurfaceLanguage,
  theory: TreeTheory,
  statement: AssertStatement,
): RulePatterns | null {
  const judgement = language.spec.terms.get(theory.closes)?.returnSort;

  if (judgement === undefined) {
    return null;
  }

  const parse = statementReader(language, statement, judgement);
  const conclusion = parse(statement.conclusion.text);

  if (
    conclusion?.kind !== "app" ||
    conclusion.term !== theory.focus ||
    conclusion.args.length !== 2
  ) {
    return null;
  }

  const [focused, cited] = conclusion.args as [Term, Term];
  const branch = branchVariable(language, focused);
  // A rule that cites no row, as Cut does, focuses on the empty branch.
  const focus = rowsOf(language, theory, cited, null);
  const side =
    branch === null ? null : rowsOf(language, theory, focused, branch);

  if (focus === null || side === null || branch?.kind !== "variable") {
    return null;
  }

  const sideKeys = new Set(side.map((row) => termKey(language, row)));

  const written: Term[][] = [];
  const marks: Term[][] = [];

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

    const marked: Term[] = [];
    const rows = rowsOf(
      language,
      theory,
      premise.args[0] as Term,
      branch,
      marked,
    );

    if (rows === null) {
      return null;
    }

    // The side rows are on the branch below too; they are not written.
    written.push(rows.filter((row) => !sideKeys.has(termKey(language, row))));
    marks.push(marked);
  }

  return {
    binders: statement.binders,
    branch: branch.name,
    focus,
    marks,
    metas: new Map(
      statement.binders
        .filter((binder) => "sort" in binder.type)
        .map((binder) => [binder.name, binder.binds]),
    ),
    name: statement.name,
    side,
    written,
  };
}

/**
 * The branch metavariable of a rule's focused branch: the one variable in
 * `ga` or `ga ; side`. Null if there is not exactly one.
 */
function branchVariable(language: SurfaceLanguage, term: Term): Term | null {
  const join = roleIndex(language).termFor("context-join");
  const found: Term[] = [];
  const walk = (node: Term): void => {
    if (node.kind === "variable") {
      found.push(node);
    } else if (node.term === join) {
      node.args.forEach(walk);
    }
  };

  walk(term);

  return found.length === 1 ? (found[0] as Term) : null;
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
  marks?: Term[],
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

    if (
      marks !== undefined &&
      node.kind === "app" &&
      (node.term === theory.mark || node.term === theory.markInstance)
    ) {
      marks.push(node);
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
 * Where a rule writes its instance: the rows of its premises that mention the
 * binder. Null if a premise writes none.
 */
function instanceSlot(
  language: SurfaceLanguage,
  patterns: RulePatterns,
  binder: string,
): InstanceSlot | null {
  const premises = patterns.written.map((rows) =>
    rows.filter((row) => mentions(row, binder)),
  );
  const templates = premises.flat();
  const template = templates[0];
  const declared = patterns.binders.find((each) => each.name === binder);

  if (
    premises.length === 0 ||
    premises.some((rows) => rows.length === 0) ||
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
    "sort" in each.type && templates.some((row) => mentions(row, each.name))
      ? each.type.dependencies
          .filter((on) => bound.has(on))
          .map((on) => ({ meta: each.name, on }))
      : [],
  );

  const sort = declared.type.sort;
  const alone = language.spec.coercions.some(
    (coercion) => coercion.from === sort,
  );
  const variable = occurrence(template, binder);

  if (variable === null) {
    return null;
  }

  const argument =
    template.kind === "app"
      ? template.args.find((each) => mentions(each, binder))
      : undefined;

  return {
    binder,
    dependents,
    shown: alone ? variable : (argument ?? variable),
    sort,
    templates,
  };
}

/**
 * The template a written row is an instance of: the one whose shape it has,
 * its instance left open; the first where none does, as a row written by a
 * substitution (`{x / te} ph`) matches none in a theory that does not name
 * its substitution.
 */
export function templateFor(
  language: SurfaceLanguage,
  rule: DevelopmentRule,
  slot: InstanceSlot,
  bindings: Bindings,
  row: Term,
): Term {
  const [first] = slot.templates;

  if (slot.templates.length === 1) {
    return first as Term;
  }

  return (
    slot.templates.find(
      (template) =>
        matchTerm(language, template, row, rule.patterns.metas, bindings) !==
        null,
    ) ?? (first as Term)
  );
}

/** The first occurrence of a variable in a term. */
function occurrence(term: Term, name: string): Term | null {
  if (term.kind === "variable") {
    return term.name === name ? term : null;
  }

  for (const argument of term.args) {
    const found = occurrence(argument, name);

    if (found !== null) {
      return found;
    }
  }

  return null;
}

/** Whether a term mentions a variable anywhere. */
function mentions(term: Term, name: string): boolean {
  return term.kind === "variable"
    ? term.name === name
    : term.args.some((argument) => mentions(argument, name));
}

/**
 * Whether a row a rule matched gives vacuous instances: `∀x Fa`. Never for a
 * template that has the instance itself, not by a substitution (`σ.n 𝕋 A`):
 * each instance is its own row.
 */
export function isVacuous(slot: InstanceSlot, bindings: Bindings): boolean {
  return (
    slot.dependents.length > 0 &&
    slot.dependents.every(({ meta, on }) => {
      const value = bindings.get(meta);
      const variable = bindings.get(on);

      return (
        value === undefined ||
        variable?.kind !== "variable" ||
        !occursFree(value, variable.name)
      );
    })
  );
}

/** Patterns to match against rows: side rows, or a premise's rows. */
export interface PatternGroup {
  readonly patterns: readonly Term[];
  readonly rows: readonly Term[];
}

/**
 * Each way a statement of a rule matches: its focus the rows `focus`, in some
 * order, and each group's patterns some of the group's rows, with what that
 * bound.
 */
export function* ruleMatches(
  language: SurfaceLanguage,
  patterns: RulePatterns,
  focus: readonly Term[],
  groups: readonly PatternGroup[],
): Generator<Bindings> {
  if (patterns.focus.length !== focus.length) {
    return;
  }

  const wanted = groups.flatMap((group) =>
    group.patterns.map((pattern) => ({ pattern, rows: group.rows })),
  );
  const extend = function* (
    bindings: Bindings,
    at: number,
  ): Generator<Bindings> {
    const next = wanted[at];

    if (next === undefined) {
      yield bindings;
      return;
    }

    for (const row of next.rows) {
      for (const found of matchAll(
        language,
        next.pattern,
        row,
        patterns.metas,
        bindings,
      )) {
        yield* extend(found, at + 1);
      }
    }
  };
  const focused = function* (
    order: readonly Term[],
    at: number,
    bindings: Bindings,
  ): Generator<Bindings> {
    const pattern = patterns.focus[at];

    if (pattern === undefined) {
      yield* extend(bindings, 0);
      return;
    }

    for (const found of matchAll(
      language,
      pattern,
      order[at] as Term,
      patterns.metas,
      bindings,
    )) {
      yield* focused(order, at + 1, found);
    }
  };

  for (const order of permutations(focus)) {
    yield* focused(order, 0, new Map());
  }
}

/** Every order of some items; one order for one item or none. */
function permutations<T>(items: readonly T[]): readonly (readonly T[])[] {
  if (items.length <= 1) {
    return [items];
  }

  return items.flatMap((item, at) =>
    permutations([...items.slice(0, at), ...items.slice(at + 1)]).map(
      (rest) => [item, ...rest],
    ),
  );
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
  const relation =
    sort === undefined ? undefined : relationsOf(language).get(sort);

  return relation === undefined || relation.mp === null
    ? null
    : { mp: relation.mp, refl: relation.refl };
}

/** A sort's equivalence, as its `@relation` names it. */
export interface SortRelation {
  /** The relation's term: `ctx_eq`, `⟚`'s `jeq`. */
  readonly term: string;
  readonly refl: string;
  /** Its modus ponens, where it names one (`_` where not). */
  readonly mp: string | null;
}

/**
 * Every sort's `@relation <sort> <term> <refl> <trans> <sym> <mp>`, by sort:
 * the equivalence the engine reasons modulo.
 */
export function relationsOf(
  language: SurfaceLanguage,
): ReadonlyMap<string, SortRelation> {
  const relations = new Map<string, SortRelation>();

  for (const info of language.spec.rules.values()) {
    for (const annotation of info.foreignAnnotations) {
      const [head, sort, term, refl, , , mp] = annotation.text
        .trim()
        .split(/\s+/u);

      if (
        head === "@relation" &&
        sort !== undefined &&
        term !== undefined &&
        refl !== undefined &&
        !relations.has(sort)
      ) {
        relations.set(sort, {
          mp: mp === undefined || mp === "_" ? null : mp,
          refl,
          term,
        });
      }
    }
  }

  return relations;
}
