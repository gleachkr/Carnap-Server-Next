import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../src/worker/domain/content";
import { withSystemText } from "../src/worker/exercise-kit/systems/join";
import type { ResolvedTree } from "../src/worker/exercises/truth-tree/grading";
import { resolveTruthTree } from "../src/worker/exercises/truth-tree/grading";
import type { TreeReport } from "../src/worker/exercises/truth-tree/report";
import type { TruthTreePublicData } from "../src/worker/exercises/truth-tree/types";
import {
  assumptions,
  closesEverywhere,
  flipped,
  problems,
  question,
  write,
} from "./helpers/olp-corpus";
import type { OlpTableau } from "./helpers/olp-first-order-tableaux";
import { OLP_FIRST_ORDER_TABLEAUX } from "./helpers/olp-first-order-tableaux";
import { engine, judgeAsBrowser } from "./helpers/truth-tree";

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

async function exercise(body: string): Promise<{
  resolved: ResolvedTree;
  mm0: string;
}> {
  const result = await compileCarnapMarkdown(
    `::::truth-tree{#t system="open-logic-tableaux"}\nShow it.\n\n${body}\n::::`,
  );

  if (!result.ok) {
    throw new Error(
      result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
    );
  }

  const raw = result.artifact.manifest[0] as ExerciseManifestItem;
  const publicData = withSystemText(
    raw.publicData,
    result.artifact.systems,
  ) as unknown as TruthTreePublicData;
  const resolved = resolveTruthTree(publicData);

  if (resolved === null || publicData.mm0 === undefined) {
    throw new Error("the exercise does not resolve");
  }

  return { mm0: publicData.mm0, resolved };
}

async function judge(
  tableau: OlpTableau,
): Promise<{ report: TreeReport } | null> {
  const root = assumptions(tableau.tree);
  const asked = question(root);

  if (asked === null) {
    return null;
  }

  const { mm0, resolved } = await exercise(asked.body);
  const { tree } = write(resolved, root, asked.order);
  return {
    report: judgeAsBrowser(await engine(), resolved, mm0, tree.answer()),
  };
}

describe("the Open Logic Project's first-order tableaux", () => {
  for (const tableau of OLP_FIRST_ORDER_TABLEAUX) {
    test(tableau.from, async () => {
      const judged = await judge(tableau);

      if (judged === null) {
        throw new Error("its assumptions are no exercise");
      }

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
      const refused: string[] = [];

      for (let n = 0; ; n += 1) {
        const tree = flipped(tableau.tree, n);

        if (tree === null) {
          break;
        }

        let judged: { report: TreeReport } | null;

        try {
          judged = await judge({ from: tableau.from, tree });
        } catch {
          // The book's closure has no pair to close on: refused all the same.
          refused.push(`row ${n}`);
          continue;
        }

        if (judged !== null && problems(judged.report).length > 0) {
          refused.push(`row ${n}`);
        }

        expect(refused).toContain(`row ${n}`);
      }
    }, 120_000);
  }
});
