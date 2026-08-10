import { describe, expect, test } from "bun:test";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type {
  AnswerEnvelope,
  ExerciseManifestItem,
  NormalizedAnswer,
} from "../src/worker/domain/content";
import type { JsonValue } from "../src/worker/domain/json";
import { AufbauProofTreeExerciseType } from "../src/worker/exercises/aufbau-proof-tree/assessment";
import { flattenProofTree } from "../src/worker/exercises/aufbau-proof-tree/flatten";
import type { ProofTreeNode } from "../src/worker/exercises/aufbau-proof-tree/types";
import {
  AUFBAU_PROOF_TREE_ANSWER_KIND,
  AUFBAU_PROOF_TREE_SCHEMA_VERSION,
} from "../src/worker/exercises/aufbau-proof-tree/types";
import { passthroughTranslator } from "../src/worker/i18n/translator";

/** Review text is resolved for a viewer, so a review needs a translator. */
const REVIEW_CONTEXT = {
  audience: "student",
  i18n: passthroughTranslator,
} as const;

/**
 * The single-node tree { top by top_i } flattens to `l1: $ top $ by top_i []`
 * against the `prop` theory — the exact `.auf` and frozen mm0 as the linear
 * proof fixture — so its committed MMB certificate verifies here too. Grading
 * checks the certificate against our frozen mm0, never the student's tree.
 */
const GOOD_MMB_BASE64 =
  "TU0wQgEBAAABAAAAAgAAACwAAAA0AAAAWgAAAAAAAABoAAAAAAAAAAQAAAAAAAAASAAAAAAAAABQAAAAAAAAAFgAAAAAAAAAAAAAAAAAAAAwAAAAAAAAADAARAJFAkIEEQBGBREVAAADAAAAAAAAAE5hbWUAAAAAoAAAAAAAAABWYXJOAAAAAOAAAAAAAAAASHlwTgAAAAD4AAAAAAAAAFoAAAAAAAAACAEAAAAAAABcAAAAAAAAAAwBAAAAAAAAXgAAAAAAAAAQAQAAAAAAAGIAAAAAAAAAFgEAAAAAAAAgAQAAAAAAACgBAAAAAAAAMAEAAAAAAAA4AQAAAAAAAEABAAAAAAAAd2ZmAHRvcAB0b3BfaQB0aG1fdG9wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

const THEORY = `:::aufbau-mm0{name="prop"}
provable sort wff;
term top: wff;
axiom top_i: $ top $;
:::`;

const GOAL_TREE: ProofTreeNode = {
  formula: "top",
  id: "root",
  premises: [],
  rule: "top_i",
};

function treeDirective(id: string, goalName: string, points = 1): string {
  return `${THEORY}

:::aufbau-proof-tree{theory="prop" id="${id}" points="${points}"}
theorem ${goalName}: $ top $
:::`;
}

async function manifestItem(source: string): Promise<ExerciseManifestItem> {
  const compiled = await compileCarnapMarkdown(source);
  if (!compiled.ok) {
    throw new Error(
      `compile failed: ${compiled.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }
  const item = compiled.artifact.manifest[0];
  if (item === undefined) {
    throw new Error("no manifest item");
  }
  return item;
}

function answerData(
  mmbBase64: string,
  tree: ProofTreeNode = GOAL_TREE,
): JsonValue {
  return {
    mmb: mmbBase64,
    proofText: flattenProofTree(tree, "thm_top").proofText,
    tree,
  } as unknown as JsonValue;
}

function answerEnvelope(mmbBase64: string): AnswerEnvelope {
  return {
    data: answerData(mmbBase64),
    kind: AUFBAU_PROOF_TREE_ANSWER_KIND,
    schemaVersion: AUFBAU_PROOF_TREE_SCHEMA_VERSION,
  };
}

function normalizedAnswer(mmbBase64: string): NormalizedAnswer {
  return {
    data: answerData(mmbBase64),
    kind: AUFBAU_PROOF_TREE_ANSWER_KIND,
    schemaVersion: AUFBAU_PROOF_TREE_SCHEMA_VERSION,
  };
}

const handler = new AufbauProofTreeExerciseType();
const context = { now: "2026-07-18T00:00:00.000Z" };

describe("aufbau-proof-tree verification", () => {
  test("a valid MMB from a flattened tree grades correct", async () => {
    const item = await manifestItem(treeDirective("t1", "thm_top", 2));
    const normalized = handler.normalizeAnswer(
      answerEnvelope(GOOD_MMB_BASE64),
      item,
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      return;
    }

    const result = await handler.evaluate(normalized.answer, item, context);
    expect(result.status).toBe("correct");
    expect(result.awardedScore).toBe(2);
    expect(result.feedback).toEqual({ verified: true });
  });

  test("well-formed base64 that is not an MMB does not verify", async () => {
    const item = await manifestItem(treeDirective("t1", "thm_top"));
    const result = await handler.evaluate(
      normalizedAnswer(btoa("not a real mmb payload at all")),
      item,
      context,
    );
    expect(result.status).not.toBe("correct");
    expect(result.awardedScore).toBe(0);
  });

  test("normalizeAnswer rejects a wrong answer kind", async () => {
    const item = await manifestItem(treeDirective("t1", "thm_top"));
    const result = handler.normalizeAnswer(
      { ...answerEnvelope(GOOD_MMB_BASE64), kind: "aufbau-proof-answer@1" },
      item,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("wrong-kind");
    }
  });

  test("normalizeAnswer rejects data with no tree", async () => {
    const item = await manifestItem(treeDirective("t1", "thm_top"));
    const result = handler.normalizeAnswer(
      {
        data: { mmb: GOOD_MMB_BASE64, proofText: "thm_top\n----\n" },
        kind: AUFBAU_PROOF_TREE_ANSWER_KIND,
        schemaVersion: AUFBAU_PROOF_TREE_SCHEMA_VERSION,
      },
      item,
    );
    expect(result.ok).toBe(false);
  });

  test("reviewAnswer draws the submitted tree via ProofML", async () => {
    const item = await manifestItem(treeDirective("t1", "thm_top"));
    const review = handler.reviewAnswer(
      normalizedAnswer(GOOD_MMB_BASE64),
      item,
      REVIEW_CONTEXT,
    );
    expect(review.elementHtml).toContain("data-review");
    expect(review.elementHtml).toContain(
      "<proof-tree><proof-proposition>top</proof-proposition>",
    );
    expect(review.elementHtml).toContain(
      "<proof-inference>top_i</proof-inference>",
    );
  });
});
