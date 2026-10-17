import { describe, expect, test } from "bun:test";
import type { TreeReport } from "../src/worker/exercises/truth-tree/report";
import {
  assumptions,
  closesEverywhere,
  flipped,
  question,
  write,
} from "./helpers/olp-corpus";
import type {
  OlpTableau,
  OlpTableauRow,
} from "./helpers/olp-first-order-tableaux";
import { OLP_MODAL_K_TABLEAUX } from "./helpers/olp-modal-k-tableaux";
import { judgeAsBrowser, problems, treeExercise } from "./helpers/truth-tree";

/**
 * Every worked tableau of the Open Logic Project's tableaux for K, written
 * as a student would write it in `open-logic-modal-k` and judged as the
 * browser judges it (`./helpers/olp-corpus.ts`).
 */

/**
 * The book's trees with a step wrong, and which (the written rows, in
 * preorder): `rules-for-K` shows why `□𝕋` and `◇𝔽` want a prefix already
 * used (#1–#3) and `□𝔽` and `◇𝕋` a new one (#4–#6), each by a tree that
 * would close without the restriction. Two also have a slip in a label,
 * corrected in {@link SLIPS}.
 */
const WRONG: ReadonlyMap<string, readonly number[]> = new Map([
  ["rules-for-K.tex #1", [0]],
  ["rules-for-K.tex #2", [0, 3]],
  ["rules-for-K.tex #3", [0]],
  ["rules-for-K.tex #4", [0, 2]],
  ["rules-for-K.tex #5", [2]],
  ["rules-for-K.tex #6", [1]],
]);

/**
 * The labels the book has wrong, by written row, and what the step is: #2's
 * last step (`\TRule{\True}{\lnot}[5]`) develops `𝔽 ¬A`, and #4's first
 * (`\TRule{\True}{\Box}[2]`) develops `𝔽 □A`.
 */
const SLIPS: ReadonlyMap<string, ReadonlyMap<number, string>> = new Map([
  ["rules-for-K.tex #2", new Map([[3, "¬𝔽"]])],
  ["rules-for-K.tex #4", new Map([[0, "□𝔽"]])],
]);

/** The tree with the written rows' rules in `rules` put in their place. */
function relabelled(
  tree: OlpTableauRow,
  rules: ReadonlyMap<number, string>,
): OlpTableauRow {
  let seen = 0;
  const walk = (row: OlpTableauRow): OlpTableauRow => {
    const by = row.by === undefined ? undefined : rules.get(seen);

    if (row.by !== undefined) {
      seen += 1;
    }

    return {
      ...row,
      ...(by === undefined ? {} : { by }),
      ...(row.children === undefined
        ? {}
        : { children: row.children.map(walk) }),
    };
  };

  return walk(tree);
}

/**
 * The book's tree as a student writes it, judged. With `open`, each branch
 * the book leaves open is marked open, and the exercise offers that.
 */
async function judge(
  tableau: OlpTableau,
  open = false,
): Promise<{
  readonly report: TreeReport;
  readonly written: readonly string[];
} | null> {
  const root = assumptions(tableau.tree);
  const asked = question(root);

  if (asked === null) {
    return null;
  }

  const exercise = await treeExercise(asked.body, {
    finish: open ? "one-open" : "closed",
    system: "open-logic-modal-k",
  });
  const { tree, written } = write(exercise.resolved, root, asked.order);

  if (open) {
    const parents = new Set(tree.tree.nodes.map((node) => node.parent));

    for (const node of tree.tree.nodes) {
      if (!parents.has(node.id) && node.end === undefined) {
        tree.open(node.id);
      }
    }
  }

  return {
    report: await judgeAsBrowser(exercise, tree),
    written,
  };
}

describe("the Open Logic Project's tableaux for K", () => {
  for (const tableau of OLP_MODAL_K_TABLEAUX) {
    test(tableau.from, async () => {
      const judged = await judge(tableau);

      if (judged === null) {
        throw new Error("its assumptions are no exercise");
      }

      const wrong = WRONG.get(tableau.from);

      if (wrong !== undefined) {
        expect(problems(judged.report)).toEqual(
          wrong.map((at) => `row ${judged.written[at]}: step-wrong`),
        );
        return;
      }

      expect(problems(judged.report)).toEqual([]);
      expect(judged.report.closed).toBe(closesEverywhere(tableau.tree));
    }, 60_000);
  }

  for (const [from, rules] of SLIPS) {
    test(`${from}, its labels corrected, is wrong only where the book means`, async () => {
      const book = OLP_MODAL_K_TABLEAUX.find(
        (tableau) => tableau.from === from,
      ) as OlpTableau;
      const judged = await judge({
        from,
        tree: relabelled(book.tree, rules),
      });
      const meant = (WRONG.get(from) ?? []).filter((at) => !rules.has(at));

      expect(problems(judged?.report as TreeReport)).toEqual(
        meant.map((at) => `row ${judged?.written[at]}: step-wrong`),
      );
    }, 60_000);
  }
});

// countermodels.tex: the book reads a model off each open branch, which it
// has developed until complete.
describe("a book tableau for K left open", () => {
  for (const tableau of OLP_MODAL_K_TABLEAUX) {
    if (closesEverywhere(tableau.tree) || WRONG.has(tableau.from)) {
      continue;
    }

    test(`${tableau.from} is complete where the book leaves it open`, async () => {
      const judged = await judge(tableau, true);

      expect(problems(judged?.report as TreeReport)).toEqual([]);
      expect(judged?.report.open).toBe(true);
    }, 60_000);
  }
});

describe("a book tableau for K with one row signed wrong is refused", () => {
  for (const tableau of OLP_MODAL_K_TABLEAUX) {
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
        expect(problems(judged?.report as TreeReport)).toContain(
          `row ${judged?.written[n]}: step-wrong`,
        );
      }
    }, 120_000);
  }
});
