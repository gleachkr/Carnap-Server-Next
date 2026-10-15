/**
 * Whether an open branch is complete, and what each row's mark says, by the
 * theory's development criteria (gh #46, `./criteria.ts`).
 *
 * The evidence is the tree's own steps, as the engine has confirmed them:
 * a row is developed on a branch when a verified step on that branch cites it
 * by a rule whose criterion it meets, and a general row's instances are the
 * ones its steps' link theorems state. Nothing here asks whether a rule
 * would still add a row, and nothing here knows a calculus: the rules, their
 * focus patterns and what closes a branch are the theory's.
 *
 * DOM-free and free of i18n.
 */

import type { SurfaceLanguage, Term } from "@aufbau/syntax";
import type {
  TableauIndex,
  TableauNode,
  TableauRow,
} from "../../../../tableau/document";
import type { Missing, RowMark } from "../logic/check";
import type {
  DevelopingStep,
  DevelopmentRule,
  RulePatterns,
  TreeDevelopment,
} from "./criteria";
import { isVacuous, matchFocus } from "./criteria";
import type { EmittedStep, TreeProof } from "./emit";
import { closedSubterms, matchTerm } from "./patterns";
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
  private readonly language: SurfaceLanguage;
  /** Every written step, by the row it cites (one-row citations only). */
  private readonly citing = new Map<
    string,
    (EmittedStep & { dev: string })[]
  >();

  constructor(private readonly input: CompletenessInput) {
    this.language = input.reader.language;
    this.byHead = rulesByHead(input.development.rules);

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
          vacuous:
            rule.instance !== null && isVacuous(rule.instance, bindings),
        });

        if (needs != null) {
          missing.push(needs);
        }
      }
    }

    return {
      contradiction: closing(this.language, development.closure, rows),
      missing,
    };
  }

  /**
   * Each row's mark, from the steps that develop it, right or not: marks say
   * what was done. A row a rule uses once is resolved once every branch below
   * it develops it or is closed; a general row lists the instances it took.
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

        for (const { rule } of matching(
          this.language,
          this.byHead,
          row.term,
        )) {
          const kind = rule.criterion?.mark ?? null;
          const steps = done.filter(
            (step) => development.byAxiom.get(step.rule) === rule,
          );

          if (kind === null || steps.length === 0) {
            continue;
          }

          const names = [
            ...new Set(
              steps.flatMap((step) =>
                step.rows.flatMap((id) => {
                  const instance = this.input.instance(id);
                  return instance === null ? [] : [instance];
                }),
              ),
            ),
          ];

          if (kind === "general") {
            marks.set(row.id, { names, type: "general" });
            break;
          }

          const everywhere = index
            .leaves(node.id)
            .every(
              (leaf) =>
                leaf.end?.type === "closed" ||
                steps.some((step) =>
                  step.rows.some((id) =>
                    index.isAtOrBelow(leaf.id, index.row(id)?.node.id ?? ""),
                  ),
                ),
            );

          if (everywhere) {
            marks.set(row.id, { names, type: "resolved" });
          }

          break;
        }
      }
    }

    return marks;
  }
}

/**
 * The first rows, in branch order, that a closure rule closes the branch on:
 * one row, or two in either order.
 */
function closing(
  language: SurfaceLanguage,
  closure: readonly RulePatterns[],
  rows: readonly ReadRow[],
): readonly string[] | null {
  const closes = (terms: readonly Term[]): boolean =>
    closure.some(
      (patterns) =>
        patterns.focus.length === terms.length &&
        orders(terms).some((order) => {
          let bindings: ReturnType<typeof matchTerm> = new Map();

          for (const [at, pattern] of patterns.focus.entries()) {
            bindings =
              bindings === null
                ? null
                : matchTerm(
                    language,
                    pattern,
                    order[at] as Term,
                    patterns.metas,
                    bindings,
                  );
          }

          return bindings !== null;
        }),
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

/** Both orders of two terms; one term as it is. */
function orders(terms: readonly Term[]): readonly (readonly Term[])[] {
  return terms.length === 2 ? [terms, [...terms].reverse()] : [terms];
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
    closing(reader.language, development.closure, [
      { id: "", term: read.term },
    ]) !== null
  );
}
