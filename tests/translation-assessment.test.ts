/**
 * The translation type's worker half, everywhere the engine is not needed:
 * directive compilation, answer normalization, and the grading paths that
 * resolve before a certificate is consulted. The certificate path itself is
 * exercised end-to-end in `translation-engine.test.ts`, which holds the wasm.
 */

import { describe, expect, test } from "bun:test";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type {
  AnswerEnvelope,
  ExerciseManifestItem,
} from "../src/worker/domain/content";
import { TranslationExerciseType } from "../src/worker/exercises/translation/assessment";
import type { TranslationAnswerData } from "../src/worker/exercises/translation/types";
import {
  isTranslationPublicData,
  TRANSLATION_ANSWER_KIND,
  TRANSLATION_SCHEMA_VERSION,
} from "../src/worker/exercises/translation/types";
import { passthroughTranslator } from "../src/worker/i18n/translator";

const REVIEW_CONTEXT = {
  audience: "student",
  i18n: passthroughTranslator,
} as const;

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

async function diagnosticCodes(source: string): Promise<string[]> {
  const compiled = await compileCarnapMarkdown(source);
  return compiled.ok ? [] : compiled.diagnostics.map((d) => d.code);
}

function envelope(data: TranslationAnswerData): AnswerEnvelope {
  return {
    data: data as never,
    kind: TRANSLATION_ANSWER_KIND,
    schemaVersion: TRANSLATION_SCHEMA_VERSION,
  };
}

async function statusFor(
  item: ExerciseManifestItem,
  data: TranslationAnswerData,
): Promise<string> {
  const type = new TranslationExerciseType();
  const normalized = type.normalizeAnswer(envelope(data), item);
  if (!normalized.ok) {
    throw new Error("normalization failed");
  }
  const evaluation = await type.evaluate(
    normalized.answer,
    item,
    {} as never,
  );
  return evaluation.status;
}

const PROP_EXERCISE = `::::translation{#t1 title="And" points="2"}
People danced and sang.

- P/\\Q
::::`;

describe("authoring", () => {
  test("compiles the prop default with solutions from bullets", async () => {
    const item = await manifestItem(PROP_EXERCISE);

    expect(item.kind).toBe("translation@1");
    if (!isTranslationPublicData(item.publicData)) {
      throw new Error("bad publicData");
    }
    expect(item.publicData.variant).toBe("prop");
    expect(item.publicData.solutions).toEqual(["P /\\ Q"]);
    expect(item.publicData.checksyntax).toBe(false);
    expect(item.publicData.tests).toEqual([]);
  });

  test("a bullet may carry Carnap's comma-separated alternates", async () => {
    const item =
      await manifestItem(`::::translation{#t1 variant="first-order"}
Jack jumped and was caught, or got away.

- (P /\\ Q) \\/ R, P /\\ (Q \\/ R)
- ExH(x,x)
::::`);

    if (!isTranslationPublicData(item.publicData)) {
      throw new Error("bad publicData");
    }
    // The split respects brackets: `H(x,x)` stays whole.
    expect(item.publicData.solutions).toHaveLength(3);
  });

  test("starter, tests, and options land in publicData", async () => {
    const item =
      await manifestItem(`::::translation{#t1 variant="first-order" tests="PNF maxNot:0" options="checksyntax" starter="For all x, x is fine"}
Everything is fine.

- AxF(x)
::::`);

    if (!isTranslationPublicData(item.publicData)) {
      throw new Error("bad publicData");
    }
    expect(item.publicData.starter).toBe("For all x, x is fine");
    expect(item.publicData.checksyntax).toBe(true);
    expect(item.publicData.tests).toEqual([
      { kind: "pnf" },
      { feature: "negations", kind: "count", max: 0 },
    ]);
  });

  test("nocheck is this type's spelling of feedback none", async () => {
    const item = await manifestItem(`::::translation{#t1 options="nocheck"}
Prose.

- P
::::`);

    expect(item.feedback).toBe("none");
  });

  test("rejects what it cannot grade, naming each problem", async () => {
    expect(
      await diagnosticCodes(`::::translation{#t1 variant="modal"}
Prose.

- P
::::`),
    ).toContain("unsupported_translation_variant");
    expect(
      await diagnosticCodes(`::::translation{#t1 tests="GNF"}
Prose.

- P
::::`),
    ).toContain("unknown_translation_test");
    expect(
      await diagnosticCodes(`::::translation{#t1 tests="PNF"}
Prose.

- P
::::`),
    ).toContain("pnf_needs_first_order");
    expect(
      await diagnosticCodes(`::::translation{#t1}
Prose.

- AxF(x)
::::`),
    ).toContain("non_propositional_solution");
    expect(
      await diagnosticCodes(`::::translation{#t1}
Prose with no solutions.
::::`),
    ).toContain("empty_translation_exercise");
    expect(
      await diagnosticCodes(`::::translation{#t1 options="strictGivens"}
Prose.

- P
::::`),
    ).toContain("unknown_translation_option");
  });
});

describe("grading without a certificate", () => {
  test("a verbatim solution is correct in every variant", async () => {
    const item = await manifestItem(PROP_EXERCISE);

    // Canonicalized, not string-matched: alternate spellings of the same
    // parse are the same answer.
    expect(await statusFor(item, { text: "P/\\Q" })).toBe("correct");
    expect(await statusFor(item, { text: "(P & Q)" })).toBe("correct");
  });

  test("unreadable and off-variant answers are incorrect, not errors", async () => {
    const item = await manifestItem(PROP_EXERCISE);

    expect(await statusFor(item, { text: "P /\\" })).toBe("incorrect");
    expect(await statusFor(item, { text: "AxF(x)" })).toBe("incorrect");
  });

  test("an equivalent answer without a certificate is incorrect", async () => {
    const item = await manifestItem(PROP_EXERCISE);

    expect(await statusFor(item, { text: "Q/\\P" })).toBe("incorrect");
  });

  test("the tests gate runs before equivalence", async () => {
    const item = await manifestItem(`::::translation{#t1 tests="maxNot:0"}
Prose.

- P/\\Q
::::`);

    // Right formula, but it arrives wearing two negations.
    expect(await statusFor(item, { text: "~~(P/\\Q)" })).toBe("incorrect");
  });

  test("exact refuses an equivalent that is not the formula", async () => {
    const item = await manifestItem(`::::translation{#t1 variant="exact"}
What is the missing premise?

- P
::::`);

    expect(await statusFor(item, { text: "P" })).toBe("correct");
    expect(await statusFor(item, { text: "~~P" })).toBe("incorrect");
  });

  test("a certificate for an out-of-range solution index is refused", async () => {
    const item = await manifestItem(PROP_EXERCISE);

    expect(
      await statusFor(item, {
        mmb: btoa("not a certificate"),
        solutionIndex: 7,
        text: "Q/\\P",
      }),
    ).toBe("incorrect");
  });
});

describe("review", () => {
  test("shows the submission in logical symbols, asserting nothing", async () => {
    const item = await manifestItem(PROP_EXERCISE);
    const type = new TranslationExerciseType();
    const normalized = type.normalizeAnswer(
      envelope({ text: "Q/\\P" }),
      item,
    );
    if (!normalized.ok) {
      throw new Error("normalization failed");
    }

    const review = type.reviewAnswer(normalized.answer, item, {
      ...REVIEW_CONTEXT,
    } as never);

    expect(review.summary).toBe("Translation");
    expect(review.details?.[0]?.value).toBe("Q ∧ P");
    expect(review.elementHtml).toContain("Q ∧ P");
    // No verdict wording in either direction: right is the evaluation's story.
    expect(review.elementHtml ?? "").not.toContain("equivalent");
  });
});
