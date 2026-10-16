/**
 * Whether an open branch is complete, and what each row's mark says, by the
 * theory's development criteria (gh #46, `./criteria.ts`).
 *
 * The evidence is the tree's own steps, as the engine has confirmed them:
 * a row is developed on a branch when a verified step on that branch cites it
 * by a rule whose criterion it meets, and a general row's instances are the
 * ones its steps' link theorems state. Only a theory that judges a branch by
 * its contents (`tree.completeness.contents`) is also asked whether a rule's
 * conclusions are on it already. Nothing here knows a calculus: the rules,
 * their focus patterns and what closes a branch are the theory's.
 *
 * DOM-free and free of i18n.
 */

import type { SurfaceLanguage, Term } from "@aufbau/syntax";
import type {
  TableauIndex,
  TableauNode,
  TableauRow,
} from "../../../../tableau/document";
import { roleIndex, sentenceSort } from "../../../logic/specs/roles";
import type { Missing, RowMark } from "../report";
import type {
  DevelopingStep,
  DevelopmentRule,
  TreeDevelopment,
} from "./criteria";
import { isVacuous, matchFocus, ruleMatches } from "./criteria";
import type { EmittedStep, TreeProof } from "./emit";
import type { Bindings } from "./patterns";
import {
  closedSubterms,
  conclude,
  instantiate,
  matchTerm,
  termKey,
} from "./patterns";
import type { RowSortReader } from "./rows";

export interface CompletenessInput {
  readonly index: TableauIndex;
  readonly reader: RowSortReader;
  readonly development: TreeDevelopment;
  readonly proof: TreeProof;
  /** Whether the engine confirmed a step; it has not seen one it refused. */
  readonly verified: (step: EmittedStep) => boolean;
  /** The instance the engine confirmed a row was written with, or null. */
  readonly instance: (rowId: string) => string | null;
}

/** What an open branch still needs, and what would close it. */
export interface BranchCompleteness {
  readonly missing: readonly Missing[];
  /** The rows that close it, in branch order, or null. */
  readonly contradiction: readonly string[] | null;
}

/** A row on a branch, read. */
interface ReadRow {
  readonly id: string;
  readonly term: Term;
}

/**
 * The criteria's rules by the constructor their focus is built on, so a row
 * is matched only against the rules that could apply to it.
 */
function rulesByHead(
  rules: readonly DevelopmentRule[],
): ReadonlyMap<string, readonly DevelopmentRule[]> {
  const byHead = new Map<string, DevelopmentRule[]>();

  for (const rule of rules) {
    const focus = rule.patterns.focus[0];

    if (rule.criterion === null || rule.patterns.focus.length !== 1) {
      continue;
    }

    const head = focus?.kind === "app" ? focus.term : "";
    byHead.set(head, [...(byHead.get(head) ?? []), rule]);
  }

  return byHead;
}

/** The rules whose single-row focus matches a row, with what they bound. */
function matching(
  language: SurfaceLanguage,
  byHead: ReadonlyMap<string, readonly DevelopmentRule[]>,
  term: Term,
) {
  const head = term.kind === "app" ? term.term : "";
  const candidates = [...(byHead.get(head) ?? []), ...(byHead.get("") ?? [])];

  return candidates.flatMap((rule) => {
    const bindings = matchFocus(language, rule, term);
    return bindings === null ? [] : [{ bindings, rule }];
  });
}

export class TreeCompleteness {
  private readonly byHead: ReadonlyMap<string, readonly DevelopmentRule[]>;
  /** The rules on a pair of rows that ask something (`pairs`). */
  private readonly pairRules: readonly DevelopmentRule[];
  private readonly language: SurfaceLanguage;
  /** Every written step, by the row it cites (one-row citations only). */
  private readonly citing = new Map<
    string,
    (EmittedStep & { dev: string })[]
  >();

  constructor(private readonly input: CompletenessInput) {
    this.language = input.reader.language;
    this.byHead = rulesByHead(input.development.rules);
    this.pairRules = input.development.rules.filter(
      (rule) => rule.criterion !== null && rule.patterns.focus.length === 2,
    );

    for (const [dev, step] of input.proof.steps) {
      const [cite] = step.cites;

      if (step.cites.length === 1 && cite !== undefined) {
        this.citing.set(cite, [
          ...(this.citing.get(cite) ?? []),
          { ...step, dev },
        ]);
      }
    }
  }

  private read(rows: readonly TableauRow[]): ReadRow[] {
    return rows.flatMap((row) => {
      const read = this.input.reader.read(row.text);
      return read.ok ? [{ id: row.id, term: read.term }] : [];
    });
  }

  /** What the branch ending at `leaf` still needs, and what closes it. */
  branch(leaf: TableauNode): BranchCompleteness {
    const { development, index } = this.input;
    const rows = this.read(index.branchRows(leaf.id));
    const onBranch = new Set(rows.map((row) => row.id));
    const terms = new Map<string, readonly string[]>();
    const termsOf = (sort: string): readonly string[] => {
      let found = terms.get(sort);

      if (found === undefined) {
        const all = rows.flatMap((row) =>
          closedSubterms(this.language, row.term, sort),
        );
        found = all.filter((term, at) => all.indexOf(term) === at);
        terms.set(sort, found);
      }

      return found;
    };
    const missing: Missing[] = [];

    for (const row of rows) {
      for (const { bindings, rule } of matching(
        this.language,
        this.byHead,
        row.term,
      )) {
        const steps: DevelopingStep[] = (this.citing.get(row.id) ?? [])
          .filter(
            (step) =>
              development.byAxiom.get(step.rule) === rule &&
              step.rows.some((id) => onBranch.has(id)) &&
              this.input.verified(step),
          )
          .map((step) => ({
            dev: step.dev,
            instances: step.rows
              .filter((id) => onBranch.has(id))
              .map((id) => this.input.instance(id)),
          }));
        const needs = rule.criterion?.missing({
          row: row.id,
          rule,
          steps,
          terms: termsOf,
          paired: null,
          vacuous:
            rule.instance !== null && isVacuous(rule.instance, bindings),
          shown: shower(this.language, rule, bindings),
          witnessed: witnessed(this.language, rule, row.term, rows),
          concluded: development.byContents
            ? concluded(this.language, rule, row.term, rows)
            : [],
        });

        if (needs != null) {
          missing.push(needs);
        }
      }
    }

    if (this.pairRules.length > 0) {
      const branch: PairBranch = {
        keys: new Set(rows.map((row) => termKey(this.language, row.term))),
        literals: rows.filter((row) => isLiteral(this.language, row.term)),
        rows,
      };

      for (const rule of this.pairRules) {
        for (const row of rows) {
          const result = paired(this.language, rule, row, branch);
          const needs =
            result === null
              ? null
              : rule.criterion?.missing({
                  concluded: [],
                  paired: result,
                  row: row.id,
                  rule,
                  shown: (instance) => instance,
                  steps: [],
                  terms: termsOf,
                  vacuous: false,
                  witnessed: null,
                });

          if (needs != null) {
            missing.push(needs);
          }
        }
      }
    }

    return {
      contradiction: closing(this.language, development, rows),
      missing,
    };
  }

  /**
   * Each row's mark, from the steps that develop it, right or not: marks say
   * what was done. A row a rule uses once is resolved once every branch below
   * it develops it or is closed; a general row lists the instances it took.
   * A row that rules of both kinds apply to (`𝕋 □A` in T: `□𝕋` and `T□`) is
   * general, never resolved, since it is never done with, and its names are
   * every general rule's.
   */
  marks(): Map<string, RowMark> {
    const { development, index } = this.input;
    const marks = new Map<string, RowMark>();

    for (const node of index.preorder()) {
      for (const row of this.read(node.rows)) {
        const done = this.citing.get(row.id) ?? [];

        if (done.length === 0) {
          continue;
        }

        const uses = matching(this.language, this.byHead, row.term).flatMap(
          ({ bindings, rule }) => {
            const kind = rule.criterion?.mark ?? null;
            return kind === null
              ? []
              : [
                  {
                    kind,
                    shown: shower(this.language, rule, bindings),
                    steps: done.filter(
                      (step) => development.byAxiom.get(step.rule) === rule,
                    ),
                  },
                ];
          },
        );
        const namesOf = (use: (typeof uses)[number]): string[] =>
          use.steps.flatMap((step) =>
            step.rows.flatMap((id) => {
              const instance = this.input.instance(id);
              return instance === null ? [] : [use.shown(instance)];
            }),
          );
        const general = uses.filter((use) => use.kind === "general");

        if (general.length > 0) {
          if (general.some((use) => use.steps.length > 0)) {
            marks.set(row.id, {
              names: [...new Set(general.flatMap(namesOf))],
              type: "general",
            });
          }

          continue;
        }

        const once = uses.find((use) => use.steps.length > 0);

        if (once === undefined) {
          continue;
        }

        const everywhere = index
          .leaves(node.id)
          .every(
            (leaf) =>
              leaf.end?.type === "closed" ||
              once.steps.some((step) =>
                step.rows.some((id) =>
                  index.isAtOrBelow(leaf.id, index.row(id)?.node.id ?? ""),
                ),
              ),
          );

        if (everywhere) {
          marks.set(row.id, {
            names: [...new Set(namesOf(once))],
            type: "resolved",
          });
        }
      }
    }

    return marks;
  }
}

/**
 * How a rule's instances at a row are shown, by engine text: as they are, or
 * in the term the rule shows them in (`σ.n` for a step `n`), with the row's
 * bindings filled in.
 */
function shower(
  language: SurfaceLanguage,
  rule: DevelopmentRule,
  bindings: Bindings,
): (instance: string) => string {
  const slot = rule.instance;

  if (slot === null || slot.shown.kind === "variable") {
    return (instance) => instance;
  }

  return (instance) => {
    const read = language.parse(instance, {
      lints: false,
      mode: "engine",
      sort: slot.sort,
    });

    if (!read.ok) {
      return instance;
    }

    const filled = instantiate(
      slot.shown,
      new Map([...bindings, [slot.binder, read.term]]),
    );

    return termKey(language, filled) ?? instance;
  };
}

/** A rule's instance in some bindings, by engine text; null if unbound. */
function instanceIn(
  language: SurfaceLanguage,
  rule: DevelopmentRule,
  bindings: Bindings,
): string | null {
  const value =
    rule.instance === null ? undefined : bindings.get(rule.instance.binder);
  return value === undefined ? null : termKey(language, value);
}

/**
 * The instances a rule with side rows must be used for at a row: for each of
 * its statements that names side rows, each way they match rows of the branch
 * once its focus matches the row, the instance that fixes. Null for a rule
 * without side rows, or that counts no instance.
 */
function witnessed(
  language: SurfaceLanguage,
  rule: DevelopmentRule,
  focus: Term,
  rows: readonly ReadRow[],
): readonly string[] | null {
  const variants = rule.variants.filter((each) => each.side.length > 0);

  if (rule.instance === null || variants.length === 0) {
    return null;
  }

  const found = new Set<string>();
  const terms = rows.map((row) => row.term);

  for (const patterns of variants) {
    for (const bindings of ruleMatches(
      language,
      patterns,
      [focus],
      [{ patterns: patterns.side, rows: terms }],
    )) {
      const key = instanceIn(language, rule, bindings);

      if (key !== null) {
        found.add(key);
      }
    }
  }

  return [...found];
}

/**
 * Each way a rule's conclusions are on the branch already at a row, for a
 * theory that judges by contents: some statement of the rule whose focus
 * matches the row, whose side rows and one premise's rows all match rows of
 * the branch. The instance that fixes, or null for a rule that counts none;
 * an instance is listed once. A row written by a substitution
 * (`{x / te} ph`) matches through it where the theory names its
 * substitution (`tree.substitution`), and only literally where it does not,
 * which can miss a conclusion and ask for a step the book would not.
 */
function concluded(
  language: SurfaceLanguage,
  rule: DevelopmentRule,
  focus: Term,
  rows: readonly ReadRow[],
): readonly (string | null)[] {
  const found = new Set<string | null>();
  const terms = rows.map((row) => row.term);

  for (const patterns of rule.variants) {
    for (const written of patterns.written) {
      for (const bindings of ruleMatches(
        language,
        patterns,
        [focus],
        [{ patterns: [...patterns.side, ...written], rows: terms }],
      )) {
        found.add(instanceIn(language, rule, bindings));
      }
    }
  }

  return [...found];
}

/** A branch as `paired` reads it, built once per branch. */
interface PairBranch {
  readonly rows: readonly ReadRow[];
  /** Its rows' engine text. */
  readonly keys: ReadonlySet<string | null>;
  /** Its atomic and negated atomic rows. */
  readonly literals: readonly ReadRow[];
}

/**
 * Whether a rule on a pair of rows is done with at a row that sets it off,
 * by the branch's contents: some statement of the rule whose first focus row
 * matches the row, and whose conclusions are on the branch for every other
 * row its second matches. Each premise is a way to have them: one premise's
 * rows, all on the branch. A conclusion that is a self-identity (`b = b`)
 * is waived, being true on any branch. Null where no statement's first focus
 * row matches the row.
 */
function paired(
  language: SurfaceLanguage,
  rule: DevelopmentRule,
  row: ReadRow,
  { keys, literals, rows }: PairBranch,
): boolean | null {
  const partners = (rule.flags.has("literals") ? literals : rows).filter(
    (each) => each.id !== row.id,
  );
  const holds = (written: Term): boolean => {
    const key = termKey(language, written);
    return (
      (key !== null && keys.has(key)) || isSelfIdentity(language, written)
    );
  };
  let applies = false;

  for (const patterns of rule.variants) {
    const [first, second] = patterns.focus;
    const start =
      first === undefined || second === undefined
        ? null
        : matchTerm(language, first, row.term, patterns.metas);

    if (start === null || second === undefined) {
      continue;
    }

    applies = true;

    const done = partners.every((partner) => {
      const bindings = matchTerm(
        language,
        second,
        partner.term,
        patterns.metas,
        start,
      );

      return (
        bindings === null ||
        patterns.written.some((premise) =>
          premise.every((each) => holds(conclude(language, each, bindings))),
        )
      );
    });

    if (done) {
      return true;
    }
  }

  return applies ? false : null;
}

/**
 * A row's sentence: the row, where rows are sentences, or the argument at the
 * sentence sort of a signed row (`𝕋 A`). Null where it has none.
 */
function sentenceIn(language: SurfaceLanguage, row: Term): Term | null {
  const sort = sentenceSort(language);

  if (row.sort === sort) {
    return row;
  }

  return row.kind === "app"
    ? (row.args.find((argument) => argument.sort === sort) ?? null)
    : null;
}

/** The core roles of an atomic sentence's constructor; null is a predicate. */
const ATOMIC_ROLES: ReadonlySet<string | null> = new Set([
  null,
  "identity",
  "inequality",
  "falsum",
  "verum",
]);

/** Whether a row's sentence is atomic or a negated atomic one, by its roles. */
function isLiteral(language: SurfaceLanguage, row: Term): boolean {
  const roles = roleIndex(language);
  const atomic = (term: Term | undefined): boolean =>
    term !== undefined &&
    (term.kind === "variable" || ATOMIC_ROLES.has(roles.roleOf(term.term)));
  const sentence = sentenceIn(language, row);

  return (
    sentence !== null &&
    (atomic(sentence) ||
      (sentence.kind === "app" &&
        roles.roleOf(sentence.term) === "negation" &&
        atomic(sentence.args[0])))
  );
}

/** Whether a row is a sentence `t = t`, by the identity role. */
function isSelfIdentity(language: SurfaceLanguage, row: Term): boolean {
  const [left, right] = row.kind === "app" ? row.args : [];

  return (
    row.sort === sentenceSort(language) &&
    row.kind === "app" &&
    roleIndex(language).roleOf(row.term) === "identity" &&
    left !== undefined &&
    right !== undefined &&
    termKey(language, left) === termKey(language, right)
  );
}

/**
 * The first rows, in branch order, that a closure rule closes the branch on:
 * one row, or two in either order.
 */
function closing(
  language: SurfaceLanguage,
  development: TreeDevelopment,
  rows: readonly ReadRow[],
): readonly string[] | null {
  const closes = (terms: readonly Term[]): boolean =>
    development.closure.some(
      (patterns) => !ruleMatches(language, patterns, terms, []).next().done,
    );

  for (const [at, row] of rows.entries()) {
    if (closes([row.term])) {
      return [row.id];
    }

    for (const earlier of rows.slice(0, at)) {
      if (closes([earlier.term, row.term])) {
        return [earlier.id, row.id];
      }
    }
  }

  return null;
}

/** Whether a row closes a branch by itself, under the theory: `a≠a`. */
export function closesAlone(
  development: TreeDevelopment,
  reader: RowSortReader,
  text: string,
): boolean {
  const read = reader.read(text);

  return (
    read.ok &&
    closing(reader.language, development, [{ id: "", term: read.term }]) !==
      null
  );
}
