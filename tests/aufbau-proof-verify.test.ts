import { describe, expect, test } from "bun:test";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type {
  AnswerEnvelope,
  ExerciseManifestItem,
  NormalizedAnswer,
} from "../src/worker/domain/content";
import { AufbauProofExerciseType } from "../src/worker/exercises/aufbau-proof/assessment";
import {
  AUFBAU_PROOF_ANSWER_KIND,
  AUFBAU_PROOF_SCHEMA_VERSION,
} from "../src/worker/exercises/aufbau-proof/types";
import { passthroughTranslator } from "../src/worker/i18n/translator";

/** Review text is resolved for a viewer, so a review needs a translator. */
const REVIEW_CONTEXT = {
  audience: "student",
  i18n: passthroughTranslator,
} as const;

/**
 * A real MMB certificate proving `theorem thm_top: $ top $;` against the theory
 * below, generated once with @aufbau/compiler (Stage 0 roundtrip) and committed
 * so the grader is exercised without the 4.5 MB compiler. If the frozen mm0 ever
 * changes shape, regenerate this pair.
 */
const GOOD_MMB_BASE64 =
  "TU0wQgEBAAABAAAAAgAAACwAAAA0AAAAWgAAAAAAAABoAAAAAAAAAAQAAAAAAAAASAAAAAAAAABQAAAAAAAAAFgAAAAAAAAAAAAAAAAAAAAwAAAAAAAAADAARAJFAkIEEQBGBREVAAADAAAAAAAAAE5hbWUAAAAAoAAAAAAAAABWYXJOAAAAAOAAAAAAAAAASHlwTgAAAAD4AAAAAAAAAFoAAAAAAAAACAEAAAAAAABcAAAAAAAAAAwBAAAAAAAAXgAAAAAAAAAQAQAAAAAAAGIAAAAAAAAAFgEAAAAAAAAgAQAAAAAAACgBAAAAAAAAMAEAAAAAAAA4AQAAAAAAAEABAAAAAAAAd2ZmAHRvcAB0b3BfaQB0aG1fdG9wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

const THEORY = `:::aufbau-mm0{name="prop"}
provable sort wff;
term top: wff;
axiom top_i: $ top $;
:::`;

function proofDirective(id: string, goalName: string, points = 1): string {
  return `${THEORY}

:::aufbau-proof{theory="prop" id="${id}" points="${points}"}
theorem ${goalName}: $ top $
----
l1: $ top $ by top_i []
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

function answerEnvelope(
  mmbBase64: string,
  proofText = "l1: $ top $ by top_i []",
): AnswerEnvelope {
  return {
    data: { mmb: mmbBase64, proofText },
    kind: AUFBAU_PROOF_ANSWER_KIND,
    schemaVersion: AUFBAU_PROOF_SCHEMA_VERSION,
  };
}

function normalizedAnswer(mmbBase64: string): NormalizedAnswer {
  return {
    data: { mmb: mmbBase64, proofText: "l1: $ top $ by top_i []" },
    kind: AUFBAU_PROOF_ANSWER_KIND,
    schemaVersion: AUFBAU_PROOF_SCHEMA_VERSION,
  };
}

/** Flip one byte of a base64-encoded blob and re-encode. */
function tamperBase64(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const middle = Math.floor(bytes.length / 2);
  bytes[middle] = (bytes[middle] ?? 0) ^ 0xff;
  let out = "";
  for (const byte of bytes) {
    out += String.fromCharCode(byte);
  }
  return btoa(out);
}

const handler = new AufbauProofExerciseType();
const context = { now: "2026-07-16T00:00:00.000Z" };

describe("aufbau-proof verification", () => {
  test("a valid MMB proving the frozen goal grades correct", async () => {
    const item = await manifestItem(proofDirective("p1", "thm_top", 2));
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

  test("a tampered certificate does not verify", async () => {
    const item = await manifestItem(proofDirective("p1", "thm_top"));
    const result = await handler.evaluate(
      normalizedAnswer(tamperBase64(GOOD_MMB_BASE64)),
      item,
      context,
    );
    expect(result.status).not.toBe("correct");
    expect(result.awardedScore).toBe(0);
  });

  test("a certificate is bound to the goal statement, not just its name", async () => {
    // The certificate proves `$ top $`. This exercise's goal is `$ top -> top $`
    // — the same certificate must not satisfy a genuinely different statement.
    const item = await manifestItem(`:::aufbau-mm0{name="imp"}
delimiter $ ( ) $;
provable sort wff;
term top: wff;
term imp (a b: wff): wff; infixr imp: $->$ prec 25;
axiom top_i: $ top $;
:::

:::aufbau-proof{theory="imp" id="p2"}
theorem g: $ top -> top $
----
l1: $ top $ by top_i []
:::`);
    const result = await handler.evaluate(
      normalizedAnswer(GOOD_MMB_BASE64),
      item,
      context,
    );
    expect(result.status).not.toBe("correct");
    expect(result.awardedScore).toBe(0);
  });

  test("well-formed base64 that is not an MMB does not crash grading", async () => {
    const item = await manifestItem(proofDirective("p1", "thm_top"));
    const result = await handler.evaluate(
      normalizedAnswer(btoa("not a real mmb payload at all")),
      item,
      context,
    );
    expect(result.status).not.toBe("correct");
    expect(result.awardedScore).toBe(0);
  });

  test("normalizeAnswer rejects a wrong answer kind", async () => {
    const item = await manifestItem(proofDirective("p1", "thm_top"));
    const result = handler.normalizeAnswer(
      { ...answerEnvelope(GOOD_MMB_BASE64), kind: "truth-table-answer@1" },
      item,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("wrong-kind");
    }
  });

  test("normalizeAnswer rejects malformed data (missing mmb)", async () => {
    const item = await manifestItem(proofDirective("p1", "thm_top"));
    const result = handler.normalizeAnswer(
      {
        data: { proofText: "l1: $ top $ by top_i []" },
        kind: AUFBAU_PROOF_ANSWER_KIND,
        schemaVersion: AUFBAU_PROOF_SCHEMA_VERSION,
      },
      item,
    );
    expect(result.ok).toBe(false);
  });

  test("normalizeAnswer rejects an over-large certificate", async () => {
    const item = await manifestItem(proofDirective("p1", "thm_top"));
    const result = handler.normalizeAnswer(
      answerEnvelope("A".repeat(300_000)),
      item,
    );
    expect(result.ok).toBe(false);
  });

  test("reviewAnswer surfaces the submitted proof source", async () => {
    const item = await manifestItem(proofDirective("p1", "thm_top"));
    const review = handler.reviewAnswer(
      normalizedAnswer(GOOD_MMB_BASE64),
      item,
      REVIEW_CONTEXT,
    );
    expect(review.elementHtml).toContain("l1: $ top $ by top_i []");
    expect(review.elementHtml).toContain("data-review");
  });
});
