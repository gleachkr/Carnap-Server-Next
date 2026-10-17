import { describe, expect, test } from "bun:test";
import type { TreeReport } from "../src/worker/exercises/truth-tree/report";
import {
  assumptions,
  closesEverywhere,
  flipped,
  write,
} from "./helpers/olp-corpus";
import type { OlpTableau } from "./helpers/olp-first-order-tableaux";
import { OLP_FIRST_ORDER_TABLEAUX } from "./helpers/olp-first-order-tableaux";
import { judgeAsBrowser, problems, treeExercise } from "./helpers/truth-tree";

/**
 * Every worked tableau of the Open Logic Project's first-order chapter,
 * written as a student would write it in `open-logic-tableaux` and judged as
 * the browser judges it (`./helpers/olp-corpus.ts`).
 */

/**
 * The book's trees with a step wrong: one on purpose (its ∃𝕋 constant is not
 * new, to show why it must be), and one by a slip in the source, which
 * labels the two `∧𝕋` rows below `𝕋 A ∧ B` `→𝕋` (`\TRule{\True}{\lif}[2]`).
 */
const WRONG: ReadonlySet<string> = new Set([
  "tableaux/quantifier-rules.tex #1",
  "proof-systems/tableaux.tex #1",
]);

/** The book's tree as a student writes it, judged, and its written rows. */
async function judge(tableau: OlpTableau): Promise<{
  readonly report: TreeReport;
  readonly written: readonly string[];
}> {
  const root = assumptions(tableau.tree);
  const exercise = await treeExercise(
    root.map((row) => row.row),
    {
      system: "open-logic-tableaux",
    },
  );
  const { tree, written } = write(exercise.resolved, root);
  return { report: await judgeAsBrowser(exercise, tree), written };
}

describe("the Open Logic Project's first-order tableaux", () => {
  for (const tableau of OLP_FIRST_ORDER_TABLEAUX) {
    test(tableau.from, async () => {
      const judged = await judge(tableau);

      if (WRONG.has(tableau.from)) {
        expect(problems(judged.report).join("\n")).toContain("step-wrong");
        return;
      }

      expect(problems(judged.report)).toEqual([]);
      expect(judged.report.closed).toBe(closesEverywhere(tableau.tree));
    }, 60_000);
  }
});

describe("a book tableau with one row signed wrong is refused", () => {
  for (const tableau of OLP_FIRST_ORDER_TABLEAUX) {
    if (WRONG.has(tableau.from)) {
      continue;
    }

    test(tableau.from, async () => {
      for (let n = 0; ; n += 1) {
        const tree = flipped(tableau.tree, n);

        if (tree === null) {
          break;
        }

        const judged = await judge({ from: tableau.from, tree });

        // Refused at the step that wrote it, whatever else follows.
        expect(problems(judged.report)).toContain(
          `row ${judged.written[n]}: step-wrong`,
        );
      }
    }, 120_000);
  }
});
