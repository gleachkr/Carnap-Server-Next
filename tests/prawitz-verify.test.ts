import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { renderCompiledContent } from "../src/worker/application/content/renderer";
import type {
  AnswerEnvelope,
  ExerciseManifestItem,
  NormalizedAnswer,
} from "../src/worker/domain/content";
import type { JsonValue } from "../src/worker/domain/json";
import { AUFBAU_PROOF_PRAWITZ_EXERCISE } from "../src/worker/exercises/aufbau-proof-prawitz";
import {
  AUFBAU_PROOF_PRAWITZ_ANSWER_KIND,
  AUFBAU_PROOF_PRAWITZ_SCHEMA_VERSION,
  type PrawitzProofNode,
} from "../src/worker/exercises/aufbau-proof-prawitz/types";
import { i18nFor } from "../src/worker/i18n";
import { passthroughTranslator } from "../src/worker/i18n/translator";
import { FITCH_THEORY_BLOCK } from "./helpers/fitch-theory";

/** Review text is resolved for a viewer, so a review needs a translator. */
const REVIEW_CONTEXT = {
  audience: "student",
  i18n: passthroughTranslator,
} as const;

/**
 * The worker's side of the Prawitz type, on the Fitch suite's model: the
 * same `prop` theory and the same `mp` goal, proved as a two-leaf tree
 *
 *     a → b   a
 *     ───────── imp_elim
 *         b
 *
 * which `prawitzToAuf` translates to
 *   l1: $ a → b ⊢ a → b $ by ax []
 *   l2: $ a ⊢ a $ by ax []
 *   l3: $ a → b , a ⊢ b $ by imp_elim [l1, l2]
 * — dependency contexts, not the Fitch translator's ambient ones — and the
 * real `@aufbau` compiler turns into the MMB below against the frozen theory
 * + goal. The worker verifies the certificate here against the same frozen
 * mm0; the tree and its text are what is stored, and are never graded.
 */
const GOOD_MMB_BASE64 =
  "TU0wQgECAAAIAAAAGAAAACwAAABsAAAA+AUAAAAAAABoCQAAAAAAAAQAAAACAAAAMAEAAAIAAABIAQAAAgAAAGABAAACAAAAeAEAAAAAAQCQAQAAAgABAJgBAAABAAEAsAEAAAIAAADAAQAAAQAAANgBAAADAAAA6AEAAAIAAAAYAgAAAgAAADgCAAABAAAAWAIAAAMAAABoAgAAAgAAAJgCAAADAAAAuAIAAAIAAADoAgAAAQAAAAgDAAABAAAAGAMAAAQAAAAwAwAAAgAAAHADAAAEAAAAkAMAAAQAAADQAwAABAAAABAEAAACAAAAUAQAAAMAAABwBAAABAAAAJgEAAAFAAAA2AQAAAUAAAAgBQAABAAAAGgFAAAEAAAAoAUAAAIAAADYBQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAIyMgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAjJyAjZwAnIBcgI2cAIycgEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAJyATI2cAIycgEAAAAAAAAAAAAAAAAAAAAAAAAAAAByATYyNnACMnIBAAAAAAAAAAAAAAAAAAFwAzIyAAAAAAAAAAAAAAABAAAAAAAAAAEAAAAAAAAAAXADMnICNnADcgFyAjZwAzJyAQAAAAAAAAAAAAAAAAABAAAAAAAAAAFwA3IBMjZwAzJyAQAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAABcANwBXAFMnIBcgJwBTJwBXIBcgIAAAAAAAAAAAAAAAEAAAAAAAAAAXADcAUycgFwBXIBMgAAAAAAAAAAAAAAAXADcAUyMjIAAAAAAAAAAAFwA3AFcAQyMgAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAFwA3AFMnICcAVyAXIDNnADcgJyAzZwAzJyAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABwA3AG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";

const SOURCE = `${FITCH_THEORY_BLOCK}

:::aufbau-proof-prawitz{system="prop" id="mp1" points="2"}
Prove modus ponens.

theorem mp (a b: wff): $ (a → b) , a ⊢ b $
:::`;

const TREE: PrawitzProofNode = {
  formula: "b",
  id: "root",
  premises: [
    { formula: "a → b", id: "l", premises: [], rule: "ax" },
    { formula: "a", id: "r", premises: [], rule: "ax" },
  ],
  rule: "imp_elim",
};

const PROOF_TEXT = [
  "mp",
  "----",
  "l1: $ a → b ⊢ a → b $ by ax []",
  "l2: $ a ⊢ a $ by ax []",
  "l3: $ a → b , a ⊢ b $ by imp_elim [l1, l2]",
].join("\n");

const type = AUFBAU_PROOF_PRAWITZ_EXERCISE;

async function declarationFor(): Promise<ExerciseManifestItem> {
  const compiled = await compileCarnapMarkdown(SOURCE);
  if (!compiled.ok) {
    throw new Error(
      `compile failed: ${compiled.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }
  const item = compiled.artifact.manifest.find((entry) => entry.id === "mp1");
  if (item === undefined) {
    throw new Error("no mp1 exercise");
  }
  return item;
}

/** The answer as stored: the tree and its text, no certificate. */
function answerData(): { proofText: string; tree: PrawitzProofNode } {
  return { proofText: PROOF_TEXT, tree: TREE };
}

function normalizedAnswer(): NormalizedAnswer {
  return {
    data: answerData() as unknown as JsonValue,
    kind: AUFBAU_PROOF_PRAWITZ_ANSWER_KIND,
    schemaVersion: AUFBAU_PROOF_PRAWITZ_SCHEMA_VERSION,
  };
}

/** The evaluator sees the certificate beside the answer, never inside it. */
function certificateBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function envelope(data: unknown): AnswerEnvelope {
  return {
    data: data as AnswerEnvelope["data"],
    kind: AUFBAU_PROOF_PRAWITZ_ANSWER_KIND,
    schemaVersion: AUFBAU_PROOF_PRAWITZ_SCHEMA_VERSION,
  };
}

const NOW = "1970-01-01T00:00:00.000Z";

describe("aufbau-proof-prawitz assessment", () => {
  test("a verifying certificate for the translated tree scores full marks", async () => {
    const declaration = await declarationFor();
    const evaluation = await type.evaluate(normalizedAnswer(), declaration, {
      certificate: certificateBytes(GOOD_MMB_BASE64),
      now: NOW,
    });
    expect(evaluation.status).toBe("correct");
    expect(evaluation.awardedScore).toBe(2);
    expect(evaluation.feedback).toEqual({ verified: true });
  });

  test("the stored answer is the tree and its text; the certificate is read beside them", async () => {
    const declaration = await declarationFor();
    const result = type.normalizeAnswer(
      envelope({ ...answerData(), mmb: GOOD_MMB_BASE64 }),
      declaration,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.answer.data).toEqual(answerData() as unknown as JsonValue);
    expect(result.answer.kind).toBe(AUFBAU_PROOF_PRAWITZ_ANSWER_KIND);
    expect(result.certificate).toEqual(certificateBytes(GOOD_MMB_BASE64));
  });

  test("a certificate that does not verify scores zero", async () => {
    const declaration = await declarationFor();
    // Valid base64 but not a real MMB — the verifier errors, no credit.
    const evaluation = await type.evaluate(normalizedAnswer(), declaration, {
      certificate: certificateBytes(btoa("not an mmb")),
      now: NOW,
    });
    expect(evaluation.awardedScore).toBe(0);
    expect(
      evaluation.status === "incorrect" || evaluation.status === "error",
    ).toBe(true);
  });

  test("a certificate for a different goal does not verify against this one", async () => {
    const compiled = await compileCarnapMarkdown(
      `${FITCH_THEORY_BLOCK}

:::aufbau-proof-prawitz{system="prop" id="k1"}
Prove it.

theorem k (a b: wff): $ a ⊢ b → a $
:::`,
    );
    if (!compiled.ok) {
      throw new Error("compile failed");
    }
    const other = compiled.artifact.manifest[0] as ExerciseManifestItem;
    const evaluation = await type.evaluate(normalizedAnswer(), other, {
      certificate: certificateBytes(GOOD_MMB_BASE64),
      now: NOW,
    });
    expect(evaluation.status).not.toBe("correct");
    expect(evaluation.awardedScore).toBe(0);
  });

  test("an answer with no certificate beside it is invalid, not wrong", async () => {
    const declaration = await declarationFor();
    const evaluation = await type.evaluate(normalizedAnswer(), declaration, {
      now: NOW,
    });
    expect(evaluation.status).toBe("invalid");
    expect(evaluation.awardedScore).toBe(0);
  });

  test("a wrong answer kind is rejected", async () => {
    const declaration = await declarationFor();
    const result = type.normalizeAnswer(
      { ...envelope({ ...answerData(), mmb: "" }), kind: "something-else" },
      declaration,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("wrong-kind");
    }
  });

  test("malformed answer data is rejected", async () => {
    const declaration = await declarationFor();
    for (const data of [
      { mmb: "not-base-64!!!" },
      // A tree, but no text.
      { mmb: GOOD_MMB_BASE64, tree: TREE },
      // Text, but a tree with no root.
      { mmb: GOOD_MMB_BASE64, proofText: PROOF_TEXT, tree: {} },
      // A well-formed answer whose certificate is not base64.
      { ...answerData(), mmb: "not-base-64!!!" },
    ]) {
      const result = type.normalizeAnswer(envelope(data), declaration);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("malformed");
      }
    }
  });

  test("review renders the submitted tree read-only", async () => {
    const declaration = await declarationFor();
    const review = type.reviewAnswer(
      normalizedAnswer(),
      declaration,
      REVIEW_CONTEXT,
    );
    expect(review.summary).toBe("Prawitz proof");
    expect(review.details).toEqual([{ label: "Proof", value: "b" }]);
    expect(review.elementHtml).toContain("<carnap-aufbau-proof-prawitz ");
    expect(review.elementHtml).toContain("data-review");
    expect(review.elementHtml).toContain("a → b");
    expect(review.elementHtml).toContain("imp_elim");
    // The bundle loads on review pages so the element upgrades to the
    // read-only forest.
    expect(review.elementHtml).toContain(
      "/assets/components/carnap-aufbau-proof-prawitz-v1.js",
    );
  });
});

describe("aufbau-proof-prawitz rendering", () => {
  test("the compiled exercise renders its element with the prompt", async () => {
    const compiled = await compileCarnapMarkdown(SOURCE);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    const html = renderCompiledContent(compiled.artifact, i18nFor("en"));
    expect(html).toContain("<carnap-aufbau-proof-prawitz ");
    expect(html).toContain("Prove modus ponens.");
  });
});
