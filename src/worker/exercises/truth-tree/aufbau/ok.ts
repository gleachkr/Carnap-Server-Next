/**
 * When a row is developed, as axioms the engine reads (gh #46, #469).
 *
 * `./criteria.ts` reads from a theory's rules what each row of an open
 * branch owes. This module states the same thing as axioms, so that the
 * engine, not Carnap, says whether a branch is complete. The judgements, over
 * a row ρ and a branch Γ:
 *
 * - `tree_ok ρ Γ`: ρ owes Γ nothing more, as far as it owes anything once;
 * - `tree_okat_<rule> ρ t Γ`: a general row ρ is developed by the rule at the
 *   term t;
 * - `tree_okwith_<rule> ρ σ Γ`: a general row ρ is developed by the rule for
 *   the side rows σ, for a rule owed an instance only where they are on the
 *   branch (`□𝕋`: `σ.n 𝕋 B` makes `σ 𝕋 □A` owe `σ.n 𝕋 A`). Which rows
 *   witness is Carnap's to find; whether the row is developed for them, the
 *   engine's;
 * - `tree_okpair_<statement> ρ π Γ`: a row ρ a rule on a pair of rows sets
 *   off (an identity `a = b`) is developed with the row π by that statement
 *   of the rule (one way round: every `b` made `a`). A row is developed by
 *   one statement for every row it pairs with, so the answer names the
 *   statement (`directions`), and the browser finds which by asking each.
 *
 * A general rule has a judgement of its own, since two may develop one row
 * for the same witness (`□𝕋` and `4□` in S5), and each is owed its own
 * conclusion.
 *
 * There is one axiom for each way a rule leaves its row developed:
 *
 * - by marks (`tree.mark`, `tree.mark.instance`, `./theory.ts`): a row is
 *   developed where its rule's mark is on the branch, whatever else is
 *   (`tree_ok ρ (ga ; ✓ ρ)`), and a general row at t where the mark beside
 *   its instance at t is (`tree_okat_tm ρ t (ga ; ✓ᵢ ρ ↦ ψ)`, ψ the rule's
 *   row at t);
 * - by contents, where the rules write no marks: a row is developed where the
 *   rows one premise writes are on the branch, so either branch of a split
 *   will do (`tree_ok (ph ∧ ps) (ga ; ph ; ps)`). A branch is a multiset, and
 *   holds `A` as often as it was written, so where two of a premise's rows
 *   can be one (`A ∧ A`), there is an axiom with one copy as well.
 *
 * A row no rule uses once owes nothing once: a general row
 * (`tree_ok (∀ x ph) ga`), an atom, a negated atom, an identity. Those rows
 * are found by complement: every shape of row the theory's constructors
 * build, less the shapes some once rule develops, has an axiom that asks
 * nothing of the branch. A row of a shape a once rule develops has only that
 * rule's axioms, even if a general rule develops it too (`𝕋 □A` in T owes
 * `T□` whatever `□𝕋` has done), so a rule whose axiom cannot be stated (a
 * premise writes no mark, in a theory that marks) leaves its rows
 * undeveloped, which a student sees, rather than developed, which nobody
 * would.
 *
 * Each judgement's axioms are chained by `@fallback`, so that one citation of
 * the chain's head tries them all.
 *
 * DOM-free and free of i18n.
 */

import type {
  AssertStatement,
  Binder,
  SurfaceLanguage,
  Term,
  TermInfo,
} from "@aufbau/syntax";
import { parseStatements, printTerm } from "@aufbau/syntax";
import { acuiOf, relationsOf } from "../../../logic/specs/annotations";
import type {
  DevelopmentRule,
  InstanceSlot,
  RulePatterns,
  TreeDevelopment,
} from "./criteria";
import { rulePatterns } from "./criteria";
import type { TreeTheory } from "./theory";

/** A judgement and the axiom to cite for it. */
export interface OkJudgement {
  /** The term: `tree_ok`, `tree_okat_tm`. */
  readonly term: string;
  /** The head of its chain of axioms. */
  readonly head: string;
}

export interface OkAxioms {
  /** The declarations, to append to the theory once `@syntax` is stripped. */
  readonly text: string;
  readonly ok: OkJudgement;
  /** By general rule, for each whose axioms could be stated. */
  readonly general: ReadonlyMap<string, OkJudgement>;
  /** By statement of a rule on a pair of rows (`tree_okpair_<statement>`). */
  readonly pairs: ReadonlyMap<string, OkJudgement>;
  readonly problems: readonly {
    /** The rule, or for a judgement's `@congr`, its term. */
    readonly rule: string;
    readonly problem: OkProblem;
  }[];
}

/** Why part of a theory's development could not be stated. */
export type OkProblem =
  /** A premise of the rule writes no mark, in a theory that marks. */
  | { readonly type: "unmarked" }
  /**
   * A row of the rule's is developed by a name its premise writes, which the
   * engine finds only through the rule's `@view`, and the rule has none, or
   * one that does not read.
   */
  | { readonly type: "no-view" }
  /** A sort a judgement takes has no `@relation`, so it has no `@congr`. */
  | { readonly type: "no-relation"; readonly sort: string };

/** The judgements' names, before any clash with the theory's is avoided. */
const OK = "tree_ok";
const OKAT = "tree_okat";
const OKWITH = "tree_okwith";
const OKPAIR = "tree_okpair";

const cache = new WeakMap<SurfaceLanguage, OkAxioms | null>();

/**
 * A tree theory's development as axioms, read once per language. Null where
 * its `closes` term has no branch to judge.
 */
export function okAxioms(
  language: SurfaceLanguage,
  theory: TreeTheory,
  development: TreeDevelopment,
): OkAxioms | null {
  if (!cache.has(language)) {
    cache.set(language, generate(language, theory, development));
  }

  return cache.get(language) ?? null;
}

/**
 * Whether a general rule is owed its instance only where its side rows are on
 * the branch: every statement of it has some.
 */
export function atWitnesses(rule: DevelopmentRule): boolean {
  return (
    rule.criterion?.kind === "general" &&
    rule.instance !== null &&
    rule.variants.every((variant) => variant.side.length > 0)
  );
}

/** A binder of a generated axiom. */
interface Decl {
  readonly name: string;
  readonly sort: string;
  readonly binds: boolean;
  /** For a regular binder, the bound ones it may mention. */
  readonly deps: readonly string[];
}

/** A generated axiom, before it is named and chained. */
interface Draft {
  /** What it is for, as a comment above it. */
  readonly comment: string;
  readonly binders: readonly Decl[];
  readonly conclusion: string;
  /** Its `@view` and `@recover` annotations, if it needs them. */
  readonly annotations: readonly string[];
}

/** A premise's rows with two made one, and the renaming that did it. */
interface Merged {
  readonly names: ReadonlyMap<string, string>;
  readonly parts: readonly Term[];
}

/** A row's shape: a constructor and the shapes of its arguments, or anything. */
type Shape =
  | { readonly kind: "any" }
  | {
      readonly kind: "app";
      readonly term: string;
      readonly args: readonly Shape[];
    };

const ANY: Shape = { kind: "any" };

function generate(
  language: SurfaceLanguage,
  theory: TreeTheory,
  development: TreeDevelopment,
): OkAxioms | null {
  const { spec } = language;
  const closes = spec.terms.get(theory.closes);
  const branchBinder = closes?.binders[0];
  const judgementSort = closes?.returnSort;
  const branchSort =
    branchBinder !== undefined && "sort" in branchBinder.type
      ? branchBinder.type.sort
      : null;

  if (judgementSort === undefined || branchSort === null) {
    return null;
  }

  const reserved = reservedNames(language);
  const fresh = (base: string, taken: ReadonlySet<string>): string => {
    let name = base;

    for (let n = 2; reserved.has(name) || taken.has(name); n += 1) {
      name = `${base}${n}`;
    }

    return name;
  };
  const used = new Set<string>();
  const global = (base: string): string => {
    const name = fresh(base, used);
    used.add(name);
    return name;
  };
  const print = (term: Term): string => printTerm(language, term, "engine");
  const problems: OkAxioms["problems"][number][] = [];

  /** A branch: the rest of it, joined with the rows and marks it must hold. */
  const branchText = (rest: string, parts: readonly Term[]): string =>
    [rest, ...parts.map((part) => `(${print(part)})`)].join(
      ` ${theory.join} `,
    );

  /**
   * The binders of a rule's statement that a generated one mentions, bound
   * first. Each regular binder may mention every bound one: the rule's
   * freshness (`ga` may not mention the new name) is about writing a row,
   * and a row already written owes nothing to it. With `own`, each keeps the
   * rule's dependencies instead, where they say what the rule reads off a
   * row: `ph: wff x a` in `{x / b} ph` is the row with every `b` made `x`.
   */
  const declsOf = (
    binders: readonly Binder[],
    mentioned: ReadonlySet<string>,
    own = false,
  ): Decl[] => {
    const kept = binders.filter(
      (binder) => "sort" in binder.type && mentioned.has(binder.name),
    );
    const bound = kept.filter((binder) => binder.binds);
    const regular = kept.filter((binder) => !binder.binds);
    const names = bound.map((binder) => binder.name);

    return [...bound, ...regular].map((binder) => ({
      binds: binder.binds,
      deps: binder.binds
        ? []
        : own && "sort" in binder.type
          ? binder.type.dependencies.filter((name) => names.includes(name))
          : names,
      name: binder.name,
      sort: "sort" in binder.type ? binder.type.sort : "",
    }));
  };

  /**
   * A judgement of a rule's row, at `args` (each a term, or rows joined), on
   * the rest of the branch and `parts`, with the metavariables `names`
   * renames renamed.
   */
  const stated = (
    judgement: string,
    patterns: RulePatterns,
    args: readonly (readonly Term[])[],
    parts: readonly Term[],
    names: ReadonlyMap<string, string> = new Map(),
  ): { conclusion: string; mentioned: Set<string> } => {
    const heads = [[patterns.focus[0] as Term], ...args].map((arg) =>
      arg.map((term) => renamed(term, names)),
    );
    const terms = [...heads.flat(), ...parts];
    const mentioned = new Set([
      patterns.branch,
      ...terms.flatMap(variablesIn),
    ]);
    const conclusion = `${judgement} ${heads
      .map(
        (arg) =>
          `(${arg.map((term) => print(term)).join(`) ${theory.join} (`)})`,
      )
      .join(" ")} (${branchText(patterns.branch, parts)})`;

    return { conclusion, mentioned };
  };

  const ok = global(OK);
  const okDrafts: Draft[] = [];
  /** The general rules' judgements, each named before it is drafted. */
  const generals: {
    readonly rule: DevelopmentRule;
    readonly term: string;
    readonly at: readonly [string, string];
    readonly drafts: readonly Draft[];
  }[] = [];
  /** The pair rules' judgements, by statement. */
  const pairs: {
    readonly variant: string;
    readonly term: string;
    readonly drafts: readonly Draft[];
  }[] = [];
  const freeDrafts: Draft[] = [];
  const covered: Term[] = [];

  /** The rows and marks premise `at` of a rule must leave on the branch. */
  function onceParts(patterns: RulePatterns, at: number): Term[] | null {
    if (theory.byContents) {
      return [...patterns.side, ...(patterns.written[at] ?? [])];
    }

    const marks = patterns.marks[at] ?? [];
    return marks.length === 0 ? null : [...marks];
  }

  /** A once rule's axioms, one per premise of each statement of it. */
  function onceDrafts(rule: DevelopmentRule): Draft[] | null {
    const drafts: Draft[] = [];

    for (const patterns of rule.variants) {
      const axiom = patterns.name;

      for (let premise = 0; premise < patterns.written.length; premise += 1) {
        const parts = onceParts(patterns, premise);

        if (parts === null) {
          return null;
        }

        const view = viewFor(axiom, patterns, parts, premise);

        if (view === "unstated") {
          problems.push({ problem: { type: "no-view" }, rule: axiom });
          continue;
        }

        for (const each of view === null
          ? merged(patterns, parts)
          : [{ names: new Map(), parts }]) {
          const { conclusion, mentioned } = stated(
            ok,
            patterns,
            [],
            each.parts,
            each.names,
          );
          drafts.push({
            annotations: view ?? [],
            binders: declsOf(patterns.binders, mentioned),
            comment: `by ${axiom}`,
            conclusion,
          });
        }
      }
    }

    return drafts;
  }

  /**
   * A rule on a pair of rows, a judgement for each statement of it, since a
   * row it sets off is developed by one statement for every row it pairs
   * with (UBC's identity, one way round): one axiom per premise, by the rows
   * the premise writes, whether or not the theory writes marks, since no
   * step need write them (a row already on the branch will do).
   */
  function pairDrafts(rule: DevelopmentRule): void {
    for (const patterns of rule.variants) {
      const second = patterns.focus[1];

      if (patterns.focus.length !== 2 || second === undefined) {
        continue;
      }

      const term = global(`${OKPAIR}_${patterns.name}`);
      const drafts = patterns.written.map((written): Draft => {
        const { conclusion, mentioned } = stated(
          term,
          patterns,
          [[second]],
          [...patterns.side, ...written],
        );

        return {
          annotations: [],
          binders: declsOf(patterns.binders, mentioned, true),
          comment: `by ${patterns.name}`,
          conclusion,
        };
      });

      pairs.push({ drafts, term, variant: patterns.name });
    }
  }

  /**
   * A general rule's axioms at its instance, or for its side rows where it
   * has them, one per premise of each statement.
   */
  function generalDrafts(
    rule: DevelopmentRule,
    slot: InstanceSlot,
    term: string,
  ): Draft[] | null {
    const side = atWitnesses(rule);
    const drafts: Draft[] = [];

    for (const patterns of rule.variants) {
      const axiom = patterns.name;
      const instance = patterns.binders.find(
        (binder) => binder.name === slot.binder,
      );

      if (instance === undefined || !("sort" in instance.type)) {
        continue;
      }

      const variable: Term = {
        binder: false,
        grouped: false,
        kind: "variable",
        name: slot.binder,
        sort: instance.type.sort,
        span: { end: 0, start: 0 },
      };

      for (let premise = 0; premise < patterns.written.length; premise += 1) {
        const parts = theory.byContents
          ? [
              ...(side ? [] : patterns.side),
              ...(patterns.written[premise] ?? []).filter((row) =>
                variablesIn(row).includes(slot.binder),
              ),
            ]
          : (patterns.marks[premise] ?? []).filter(
              (mark) =>
                mark.kind === "app" &&
                mark.term === theory.markInstance &&
                variablesIn(mark).includes(slot.binder),
            );

        if (parts.length === 0) {
          return null;
        }

        const { conclusion, mentioned } = stated(
          term,
          patterns,
          [side ? patterns.side : [variable]],
          parts,
        );
        drafts.push({
          annotations: [],
          binders: declsOf(patterns.binders, mentioned),
          comment: `by ${axiom}`,
          conclusion,
        });
      }
    }

    return drafts;
  }

  /**
   * The rule's `@view`, restated for the axiom from premise `premise`, where
   * the axiom needs one: a binder the rule recovers (`@recover a ps ph x`)
   * that is in the rows the axiom asks for and not in its row, which the
   * engine cannot find without it. Null where it needs none, and
   * `"unstated"` where it needs one the rule has not, or that does not read.
   */
  function viewFor(
    axiom: string,
    patterns: RulePatterns,
    parts: readonly Term[],
    premise: number,
  ): string[] | null | "unstated" {
    const annotations = spec.rules.get(axiom)?.foreignAnnotations ?? [];
    const lines = annotations.map((each) => each.text.trim());
    const recovers = lines.filter((line) => line.startsWith("@recover "));
    const own = new Set(variablesIn(patterns.focus[0] as Term));
    const asked = new Set(parts.flatMap(variablesIn));
    const needed = recovers.filter((line) => {
      const target = line.split(/\s+/u)[1] ?? "";
      return asked.has(target) && !own.has(target);
    });
    const view = lines.find((line) => line.startsWith("@view "));

    if (needed.length === 0) {
      return null;
    }

    if (view === undefined) {
      return "unstated";
    }

    const statement = parseStatements(
      `axiom view ${view.slice("@view ".length)};`,
    ).statements[0];
    const viewed =
      statement?.kind === "axiom"
        ? rulePatterns(language, theory, statement as AssertStatement)
        : null;
    const viewParts = viewed === null ? null : onceParts(viewed, premise);

    if (viewed === null || viewParts === null) {
      return "unstated";
    }

    const { conclusion, mentioned } = stated(ok, viewed, [], viewParts);

    // What the view recovers, and from what, are its binders too.
    for (const line of needed) {
      for (const name of line.split(/\s+/u).slice(1)) {
        mentioned.add(name);
      }
    }

    return [
      `@view ${binderText(declsOf(viewed.binders, mentioned))}: $ ${conclusion} $`,
      ...needed,
    ];
  }

  /**
   * A premise's rows, and the same with any two that can be one row made one
   * (`ph ; ps` as `ph`, for `A ∧ A`), each way they can be, with the
   * renaming that makes them one.
   */
  function merged(patterns: RulePatterns, parts: readonly Term[]): Merged[] {
    const first: Merged = { names: new Map(), parts };

    if (!theory.byContents) {
      return [first];
    }

    const found: Merged[] = [];
    const seen = new Set<string>();
    const queue: Merged[] = [first];

    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const key = next.parts.map(print).join(" ; ");

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      found.push(next);

      for (const [i, left] of next.parts.entries()) {
        for (const [j, right] of next.parts.entries()) {
          const names =
            j > i ? renaming(left, right, patterns.binders) : null;

          if (names !== null) {
            queue.push({
              names: new Map([
                ...[...next.names].map(
                  ([from, to]) => [from, names.get(to) ?? to] as const,
                ),
                ...names,
              ]),
              parts: next.parts
                .filter((_, at) => at !== j)
                .map((part) => renamed(part, names)),
            });
          }
        }
      }
    }

    return found;
  }

  for (const rule of development.rules) {
    const kind = rule.criterion?.kind;

    if (kind === "pairs") {
      pairDrafts(rule);
      continue;
    }

    if (rule.patterns.focus.length !== 1 || kind === undefined) {
      continue;
    }

    if (kind === "once") {
      for (const variant of rule.variants) {
        if (variant.focus.length === 1) {
          covered.push(variant.focus[0] as Term);
        }
      }

      const drafts = onceDrafts(rule);

      if (drafts === null) {
        problems.push({ problem: { type: "unmarked" }, rule: rule.name });
      } else {
        okDrafts.push(...drafts);
      }
    }

    if (kind === "general" && rule.instance !== null) {
      // The side rows at the branch sort, as rows joined.
      const side = atWitnesses(rule);
      const term = global(`${side ? OKWITH : OKAT}_${rule.name}`);
      const drafts = generalDrafts(rule, rule.instance, term);

      if (drafts === null) {
        problems.push({ problem: { type: "unmarked" }, rule: rule.name });
      } else {
        generals.push({
          at: side ? ["si", branchSort] : ["te", rule.instance.sort],
          drafts,
          rule,
          term,
        });
      }
    }
  }

  // The rows no rule develops: every shape the constructors build, less
  // the shapes rules develop, each asking nothing of the branch.
  const constructors = constructorsBySort(language);
  const shapes = complement(
    covered.map((term) => [shapeOf(term, constructors)]),
    [theory.rowSort],
    constructors,
  );

  for (const [shape] of shapes) {
    const decls: Decl[] = [];
    const taken = new Set<string>();
    const declare = (decl: Omit<Decl, "name"> & { base: string }): string => {
      const name = fresh(decl.base, taken);
      taken.add(name);
      decls.push({
        binds: decl.binds,
        deps: decl.deps,
        name,
        sort: decl.sort,
      });
      return name;
    };
    const row = realize(
      language,
      shape as Shape,
      theory.rowSort,
      "ph",
      [],
      declare,
    );
    const bound = decls.filter((decl) => decl.binds).map((decl) => decl.name);
    const rest = declare({
      base: "ga",
      binds: false,
      deps: bound,
      sort: branchSort,
    });
    freeDrafts.push({
      annotations: [],
      binders: [
        ...decls.filter((decl) => decl.binds),
        ...decls.filter((decl) => !decl.binds),
      ],
      comment: "no rule develops it",
      conclusion: `${ok} (${print(row)}) ${rest}`,
    });
  }

  // The judgements, their congruences, and their chains.
  const relations = relationsOf(language);
  const text: string[] = [
    "-- When a row is developed: generated from the rules (Carnap, gh #46).",
  ];
  /** A judgement of a row, at `at` (a name and its sort), on a branch. */
  const judgement = (
    term: string,
    at: readonly [string, string] | null,
    drafts: readonly Draft[],
  ): OkJudgement | null => {
    if (drafts.length === 0) {
      return null;
    }

    // The row at the branch sort, a branch of one row, so that the congruence
    // asks no relation of the row sort.
    const sorts = [branchSort, ...(at === null ? [] : [at[1]]), branchSort];
    const taken = new Set<string>();
    const local = (base: string): string => {
      const name = fresh(base, taken);
      taken.add(name);
      return name;
    };
    const names = ["ph", ...(at === null ? [] : [at[0]]), "ga"].map(local);
    text.push(
      `term ${term} ${sorts.map((sort, at) => `(${names[at]}: ${sort})`).join(" ")}: ${judgementSort};`,
    );

    const missing = [...sorts, judgementSort].find(
      (sort) => !relations.has(sort),
    );

    if (missing === undefined) {
      const left = names.map((name) => local(`${name}l`));
      const right = names.map((name) => local(`${name}r`));
      const premises = sorts.map(
        (sort, at) =>
          `$ ${relations.get(sort)?.term} ${left[at]} ${right[at]} $ > `,
      );
      text.push(
        "--| @congr",
        `axiom ${global(`${term}_congr`)} ${sorts
          .map((sort, at) => `(${left[at]} ${right[at]}: ${sort})`)
          .join(" ")}: ${premises.join("")}$ ${
          relations.get(judgementSort)?.term
        } (${term} ${left.join(" ")}) (${term} ${right.join(" ")}) $;`,
      );
    } else {
      problems.push({
        problem: { sort: missing, type: "no-relation" },
        rule: term,
      });
    }

    // Tried in order: the head first, so declared last.
    const unique = drafts.filter(
      (draft, at) =>
        drafts.findIndex((each) => each.conclusion === draft.conclusion) ===
        at,
    );
    let previous: string | null = null;

    for (const [at, draft] of [...unique].reverse().entries()) {
      const name = global(`${term}_${at + 1}`);
      text.push(
        `-- ${draft.comment}`,
        ...draft.annotations.map((line) => `--| ${line}`),
        ...(previous === null ? [] : [`--| @fallback ${previous}`]),
        `axiom ${name} ${binderText(draft.binders)}: $ ${draft.conclusion} $;`,
      );
      previous = name;
    }

    return { head: previous as string, term };
  };

  const okJudgement = judgement(ok, null, [...okDrafts, ...freeDrafts]);
  const general = new Map<string, OkJudgement>();

  if (okJudgement === null) {
    return null;
  }

  for (const { at, drafts, rule, term } of generals) {
    const each = judgement(term, at, drafts);

    if (each !== null) {
      general.set(rule.name, each);
    }
  }

  // The partner at the branch sort too.
  const paired = new Map<string, OkJudgement>();

  for (const { drafts, term, variant } of pairs) {
    const each = judgement(term, ["ps", branchSort], drafts);

    if (each !== null) {
      paired.set(variant, each);
    }
  }

  return {
    general,
    pairs: paired,
    ok: okJudgement,
    problems,
    text: `${text.join("\n")}\n`,
  };
}

/** Binders as MM0 writes them. */
function binderText(binders: readonly Decl[]): string {
  return binders
    .map((binder) =>
      binder.binds
        ? `{${binder.name}: ${binder.sort}}`
        : `(${binder.name}: ${[binder.sort, ...binder.deps].join(" ")})`,
    )
    .join(" ");
}

/** Every name a generated binder must not take: the theory's own. */
function reservedNames(language: SurfaceLanguage): ReadonlySet<string> {
  const { spec } = language;
  const names = new Set<string>([
    ...spec.terms.keys(),
    ...spec.rules.keys(),
    ...spec.sorts.keys(),
  ]);

  for (const notation of spec.notations) {
    if (notation.form === "simple") {
      names.add(notation.token);
    } else {
      for (const literal of notation.literals) {
        if (literal.kind === "constant") {
          names.add(literal.token);
        }
      }
    }
  }

  return names;
}

/** Every variable in a term, binding occurrences too, in order. */
function variablesIn(term: Term): string[] {
  return term.kind === "variable"
    ? [term.name]
    : term.args.flatMap(variablesIn);
}

/**
 * How `b` is `a` with its metavariables renamed, as a map from `b`'s names
 * to `a`'s: the same constructors, and regular metavariables of one sort and
 * dependencies where they differ. Null where it is not.
 */
function renaming(
  a: Term,
  b: Term,
  binders: readonly Binder[],
): ReadonlyMap<string, string> | null {
  const declared = new Map(binders.map((binder) => [binder.name, binder]));
  const names = new Map<string, string>();
  const same = (left: Binder | undefined, right: Binder | undefined) =>
    left !== undefined &&
    right !== undefined &&
    !left.binds &&
    !right.binds &&
    "sort" in left.type &&
    "sort" in right.type &&
    left.type.sort === right.type.sort &&
    left.type.dependencies.join(" ") === right.type.dependencies.join(" ");
  const walk = (left: Term, right: Term): boolean => {
    if (left.kind === "variable" && right.kind === "variable") {
      const known = names.get(right.name);

      if (known !== undefined) {
        return known === left.name;
      }

      if (
        left.name !== right.name &&
        !same(declared.get(left.name), declared.get(right.name))
      ) {
        return false;
      }

      names.set(right.name, left.name);
      return true;
    }

    return (
      left.kind === "app" &&
      right.kind === "app" &&
      left.term === right.term &&
      left.args.length === right.args.length &&
      left.args.every((argument, at) =>
        walk(argument, right.args[at] as Term),
      )
    );
  };

  return walk(a, b) ? names : null;
}

/** A term with its variables renamed. */
function renamed(term: Term, names: ReadonlyMap<string, string>): Term {
  if (term.kind === "variable") {
    return { ...term, name: names.get(term.name) ?? term.name };
  }

  return { ...term, args: term.args.map((each) => renamed(each, names)) };
}

/**
 * The terms that build each sort's values, which a row's shape is made of:
 * not a definition (a row in one is a row in its definiens), not the
 * theory's substitution (the engine computes it away), and none for a sort
 * built by a list, whose terms are equal however they are bracketed.
 */
function constructorsBySort(
  language: SurfaceLanguage,
): ReadonlyMap<string, readonly TermInfo[]> {
  const bySort = new Map<string, TermInfo[]>();
  const lists = new Set(
    [...acuiOf(language).values()].map((each) => each.sort),
  );

  for (const info of language.spec.terms.values()) {
    if (
      info.isDef ||
      info.roles.includes("tree.substitution") ||
      lists.has(info.returnSort)
    ) {
      continue;
    }

    bySort.set(info.returnSort, [
      ...(bySort.get(info.returnSort) ?? []),
      info,
    ]);
  }

  return bySort;
}

/**
 * A rule's focus as a shape: its metavariables stand for anything. So does
 * a term no constructor is (a definition), which a shape cannot see into:
 * every row it might be is then a rule's, and undeveloped without it.
 */
function shapeOf(
  term: Term,
  constructors: ReadonlyMap<string, readonly TermInfo[]>,
): Shape {
  if (
    term.kind === "variable" ||
    !(constructors.get(term.sort) ?? []).some(
      (info) => info.name === term.term,
    )
  ) {
    return ANY;
  }

  return {
    args: term.args.map((each) => shapeOf(each, constructors)),
    kind: "app",
    term: term.term,
  };
}

/**
 * Every shape of a vector of values of `sorts` that matches none of `rows`,
 * as few shapes as split the constructors no further than the rows do
 * (Maranget's complement of a pattern matrix).
 */
function complement(
  rows: readonly (readonly Shape[])[],
  sorts: readonly string[],
  constructors: ReadonlyMap<string, readonly TermInfo[]>,
): Shape[][] {
  const [sort, ...restSorts] = sorts;

  if (sort === undefined) {
    return rows.length === 0 ? [[]] : [];
  }

  if (rows.length === 0) {
    return [sorts.map(() => ANY)];
  }

  const built = constructors.get(sort) ?? [];

  if (
    built.length === 0 ||
    rows.every((row) => (row[0] as Shape).kind === "any")
  ) {
    return complement(
      rows.map((row) => row.slice(1)),
      restSorts,
      constructors,
    ).map((rest) => [ANY, ...rest]);
  }

  const out: Shape[][] = [];

  for (const info of built) {
    const arity = info.binders.length;
    const argSorts = info.binders.map((binder) =>
      "sort" in binder.type ? binder.type.sort : "",
    );
    const specialized = rows.flatMap((row) => {
      const head = row[0] as Shape;

      if (head.kind === "any") {
        return [[...argSorts.map(() => ANY), ...row.slice(1)]];
      }

      return head.term === info.name ? [[...head.args, ...row.slice(1)]] : [];
    });

    for (const vector of complement(
      specialized,
      [...argSorts, ...restSorts],
      constructors,
    )) {
      out.push([
        { args: vector.slice(0, arity), kind: "app", term: info.name },
        ...vector.slice(arity),
      ]);
    }
  }

  return out;
}

/**
 * A shape as a term, declaring a binder for each part of it that is anything:
 * a bound one at a binding slot (`∀ x`), else a regular one that may mention
 * the bound ones around it.
 */
function realize(
  language: SurfaceLanguage,
  shape: Shape,
  sort: string,
  base: string,
  scope: readonly string[],
  declare: (decl: Omit<Decl, "name"> & { base: string }) => string,
): Term {
  const span = { end: 0, start: 0 };

  if (shape.kind === "any") {
    return {
      binder: false,
      grouped: false,
      kind: "variable",
      name: declare({ base, binds: false, deps: scope, sort }),
      sort,
      span,
    };
  }

  const info = language.spec.terms.get(shape.term) as TermInfo;
  const local = new Map<string, string>();
  const args = info.binders.map((binder, at): Term => {
    const argSort = "sort" in binder.type ? binder.type.sort : "";

    if (binder.binds) {
      const name = declare({
        base: binder.name,
        binds: true,
        deps: [],
        sort: argSort,
      });
      local.set(binder.name, name);
      return {
        binder: true,
        grouped: false,
        kind: "variable",
        name,
        sort: argSort,
        span,
      };
    }

    const deps =
      "sort" in binder.type
        ? binder.type.dependencies.flatMap((on) => {
            const name = local.get(on);
            return name === undefined ? [] : [name];
          })
        : [];

    return realize(
      language,
      shape.args[at] ?? ANY,
      argSort,
      binder.name,
      [...scope, ...deps],
      declare,
    );
  });

  return {
    args,
    fixity: null,
    grouped: false,
    kind: "app",
    prec: null,
    sort: info.returnSort,
    span,
    term: shape.term,
    token: null,
  };
}
