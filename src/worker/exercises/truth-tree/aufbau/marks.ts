/**
 * What each row's mark says, from the steps that develop it (gh #46): the
 * check mark the editor and the review draw beside a row, `✓` for a row done
 * with and the names a general row went to.
 *
 * Marks say what was done, right or not, and nothing about whether a branch
 * is complete: that is the engine's to say (`./ok.ts`). Nothing here knows a
 * calculus: which rule a row is developed by, and how its instances are
 * shown, are the theory's.
 *
 * DOM-free and free of i18n.
 */

import type { SurfaceLanguage, Term } from "@aufbau/syntax";
import type { TableauIndex, TableauRow } from "../../../../tableau/document";
import type { RowMark } from "../report";
import type { DevelopmentRule, TreeDevelopment } from "./criteria";
import { instanceShower, matchFocus } from "./criteria";
import type { EmittedStep, TreeProof } from "./emit";
import type { RowSortReader } from "./rows";

export interface MarksInput {
  readonly index: TableauIndex;
  readonly reader: RowSortReader;
  readonly development: TreeDevelopment;
  readonly proof: TreeProof;
  /** The instance the engine confirmed a row was written with, or null. */
  readonly instance: (rowId: string) => string | null;
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

/**
 * Each row's mark, from the steps that cite it. A row a rule uses once is
 * resolved once every branch below it develops it or is closed; a general
 * row lists the instances it took. A row that rules of both kinds apply to
 * (`𝕋 □A` in T: `□𝕋` and `T□`) is general, never resolved, since it is never
 * done with, and its names are every general rule's.
 */
export function treeMarks(input: MarksInput): Map<string, RowMark> {
  const { development, index, reader } = input;
  const language = reader.language;
  const byHead = rulesByHead(development.rules);
  // Every written step, by the row it cites (one-row citations only).
  const citing = new Map<string, EmittedStep[]>();

  for (const step of input.proof.steps.values()) {
    const [cite] = step.cites;

    if (step.cites.length === 1 && cite !== undefined) {
      citing.set(cite, [...(citing.get(cite) ?? []), step]);
    }
  }

  const read = (rows: readonly TableauRow[]) =>
    rows.flatMap((row) => {
      const result = reader.read(row.text);
      return result.ok ? [{ id: row.id, term: result.term }] : [];
    });
  const marks = new Map<string, RowMark>();

  for (const node of index.preorder()) {
    for (const row of read(node.rows)) {
      const done = citing.get(row.id) ?? [];

      if (done.length === 0) {
        continue;
      }

      const uses = matching(language, byHead, row.term).flatMap(
        ({ bindings, rule }) => {
          const kind = rule.criterion?.mark ?? null;
          return kind === null
            ? []
            : [
                {
                  kind,
                  shown: instanceShower(language, rule, bindings),
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
            const instance = input.instance(id);
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
