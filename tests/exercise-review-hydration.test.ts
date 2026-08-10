import { describe, expect, test } from "bun:test";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { renderAufbauProofReview } from "../src/worker/exercises/aufbau-proof/read-only-view";
import { buildAufbauProofStrings } from "../src/worker/exercises/aufbau-proof/strings";
import { renderAufbauProofFitchReview } from "../src/worker/exercises/aufbau-proof-fitch/read-only-view";
import { buildAufbauProofFitchStrings } from "../src/worker/exercises/aufbau-proof-fitch/strings";
import { renderAufbauProofTreeReview } from "../src/worker/exercises/aufbau-proof-tree/read-only-view";
import { buildAufbauProofTreeStrings } from "../src/worker/exercises/aufbau-proof-tree/strings";
import type { ExerciseHydration } from "../src/worker/exercises/hydration";
import { EXERCISE_HYDRATION_VERSION } from "../src/worker/exercises/hydration";
import { isTruthTablePublicData } from "../src/worker/exercises/truth-table/grading";
import { renderTruthTableReview } from "../src/worker/exercises/truth-table/read-only-view";
import { buildTruthTableStrings } from "../src/worker/exercises/truth-table/strings";
import type { TruthTablePublicData } from "../src/worker/exercises/truth-table/types";
import { i18nFor } from "../src/worker/i18n";

/**
 * A read-only review is a *rendered widget*, not a picture of one: the Fitch
 * review really does upgrade and run client code, and the others may. So the
 * review markup has to carry the same hydration payload the answering path
 * carries — including `strings`, resolved for the viewer's locale.
 *
 * Nothing on the review path calls `t()` yet, which is exactly why this is
 * tested rather than observed: the first review-mode message would otherwise
 * render in English inside an otherwise translated page, silently.
 */

const REVIEW_LOCALE = "de";

const i18n = i18nFor(REVIEW_LOCALE);

/** The one payload the review markup embeds for its element. */
function hydrationPayload(html: string): ExerciseHydration {
  const match =
    /<script type="application\/json" data-exercise-hydration>(.*?)<\/script>/s.exec(
      html,
    );

  if (match?.[1] === undefined) {
    throw new Error(`no hydration script in review markup: ${html}`);
  }

  return JSON.parse(match[1]) as ExerciseHydration;
}

async function truthTablePublicData(): Promise<TruthTablePublicData> {
  const compiled = await compileCarnapMarkdown(
    "::::truth-table{#tt1 points=1}\n- (P -> P)\n::::",
  );

  if (!compiled.ok) {
    throw new Error("compile failed");
  }

  const node = compiled.artifact.document.nodes.find(
    (candidate) => candidate.kind === "exercise",
  );

  if (node?.kind !== "exercise" || !isTruthTablePublicData(node.publicData)) {
    throw new Error("no truth-table exercise compiled");
  }

  return node.publicData;
}

/**
 * Each widget that shows text of its own, paired with the builder that is the
 * single source of the ids its element may look up. Comparing the payload
 * against the builder is what makes a newly added string fail here rather than
 * fall back to English in review.
 */
const CASES = [
  {
    build: buildAufbauProofStrings,
    name: "aufbau-proof",
    render: async () =>
      renderAufbauProofReview(
        { exerciseId: "p1", proofText: "goal\n----\nax\n" },
        i18n,
      ),
  },
  {
    build: buildAufbauProofFitchStrings,
    name: "aufbau-proof-fitch",
    render: async () =>
      renderAufbauProofFitchReview(
        {
          assumptionRule: "ax",
          exerciseId: "f1",
          fitchText: "  P :ax\n  P :r 1\n",
        },
        i18n,
      ),
  },
  {
    build: buildAufbauProofTreeStrings,
    name: "aufbau-proof-tree",
    render: async () =>
      renderAufbauProofTreeReview(
        {
          exerciseId: "t1",
          tree: { formula: "P", hyp: 1, id: "n1", premises: [], rule: "" },
        },
        i18n,
      ),
  },
  {
    build: buildTruthTableStrings,
    name: "truth-table",
    render: async () =>
      renderTruthTableReview(
        await truthTablePublicData(),
        { answer: { cells: [], reference: [] }, exerciseId: "tt1" },
        i18n,
      ),
  },
] as const;

describe("review-mode hydration", () => {
  for (const { build, name, render } of CASES) {
    test(`${name} review carries a review-mode payload`, async () => {
      const payload = hydrationPayload(await render());

      expect(payload.mode).toBe("review");
      expect(payload.version).toBe(EXERCISE_HYDRATION_VERSION);
      expect(payload.priorAnswer).toBeNull();
    });

    test(`${name} review carries its strings in the viewer's language`, async () => {
      const payload = hydrationPayload(await render());
      const expected = build(i18n);

      expect(payload.strings).toEqual(expected);
      // The payload would also "match" if the locale silently fell back to
      // English, which is the failure this whole channel exists to prevent.
      expect(
        Object.entries(expected).filter(([id, text]) => text !== id).length,
      ).toBeGreaterThan(0);
    });
  }
});
