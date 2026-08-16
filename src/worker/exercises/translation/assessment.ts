import {
  diagnostic,
  isObject,
} from "../../application/content/assessment-support";
import type { AssessmentExerciseType } from "../../application/content/registry";
import type {
  AnswerEnvelope,
  AnswerNormalizationResult,
  AutomaticEvaluation,
  EvaluationContext,
  ExerciseAnswerReview,
  ExerciseManifestItem,
  ExerciseReviewContext,
  NormalizedAnswer,
} from "../../domain/content";
import type { JsonValue } from "../../domain/json";
import { verifyMmb } from "../aufbau-proof/verifier";
import type { Formula } from "../first-order";
import {
  dialectById,
  formulaToDisplay,
  formulaToString,
  parseFormula,
} from "../first-order";
import { buildEquivalenceCheck } from "./logic/mm0";
import { runTranslationTests } from "./logic/tests";
import { isPropositional } from "./logic/variant";
import { renderTranslationReview } from "./read-only-view";
import type { TranslationAnswerData, TranslationPublicData } from "./types";
import {
  isTranslationAnswerData,
  isTranslationPublicData,
  TRANSLATION_ANSWER_KIND,
  TRANSLATION_COMPONENT_METADATA,
  TRANSLATION_KIND,
  TRANSLATION_SCHEMA_VERSION,
} from "./types";

const TRANSLATION_EVALUATOR_VERSION = "translation-evaluator@1";

/** Generous caps so a real answer passes but a submission can't be unbounded. */
const MAX_TEXT_LENGTH = 2_048;
const MAX_MMB_BASE64_LENGTH = 262_144;

function translationAnswerData(
  answer: NormalizedAnswer,
): TranslationAnswerData {
  return answer.data as unknown as TranslationAnswerData;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * The student's submission as the grader sees it: parsed in the exercise's
 * dialect, restricted to the variant's language. `null` is "this cannot be
 * correct", never "this cannot be graded".
 */
function readSubmission(
  publicData: TranslationPublicData,
  text: string,
): Formula | null {
  const dialect = dialectById(publicData.dialect);

  if (dialect === null) {
    return null;
  }

  const parsed = parseFormula(text, dialect);

  if (!parsed.ok) {
    return null;
  }

  if (publicData.variant === "prop" && !isPropositional(parsed.formula)) {
    return null;
  }

  return parsed.formula;
}

export class TranslationExerciseType implements AssessmentExerciseType {
  readonly answerKind = TRANSLATION_ANSWER_KIND;
  readonly capabilities = {
    supportsAutomaticEvaluation: true,
    supportsManualReview: true,
  };
  readonly component = {
    ...TRANSLATION_COMPONENT_METADATA,
    capabilities: this.capabilities,
  };
  readonly kind = TRANSLATION_KIND;
  readonly schemaVersion = TRANSLATION_SCHEMA_VERSION;

  normalizeAnswer(
    envelope: AnswerEnvelope,
    _declaration: ExerciseManifestItem,
  ): AnswerNormalizationResult {
    if (envelope.kind !== this.answerKind) {
      return {
        diagnostics: [
          diagnostic(
            "wrong_answer_kind",
            `Expected answer kind ${this.answerKind}.`,
            ["kind"],
          ),
        ],
        ok: false,
        reason: "wrong-kind",
      };
    }

    if (envelope.schemaVersion !== this.schemaVersion) {
      return {
        diagnostics: [
          diagnostic(
            "unsupported_answer_schema_version",
            "The answer schema version is not supported.",
            ["schemaVersion"],
          ),
        ],
        ok: false,
        reason: "schema-invalid",
      };
    }

    if (!isObject(envelope.data) || !isTranslationAnswerData(envelope.data)) {
      return {
        diagnostics: [
          diagnostic(
            "malformed_answer_data",
            "A translation answer needs a text string, and optionally a base64 mmb with the solution index it certifies.",
            ["data"],
          ),
        ],
        ok: false,
        reason: "malformed",
      };
    }

    const data = envelope.data;

    if (
      data.text.length > MAX_TEXT_LENGTH ||
      (data.mmb !== undefined &&
        (data.mmb.length > MAX_MMB_BASE64_LENGTH ||
          decodeBase64(data.mmb) === null))
    ) {
      return {
        diagnostics: [
          diagnostic(
            "malformed_answer_data",
            "The answer or its certificate is malformed or too large.",
            ["data"],
          ),
        ],
        ok: false,
        reason: "malformed",
      };
    }

    // A certificate names the solution it certifies; one without the other is
    // noise the widget never produces, so drop the pair rather than the answer.
    const certified =
      data.mmb !== undefined && data.solutionIndex !== undefined;

    return {
      answer: {
        data: {
          text: data.text,
          ...(certified
            ? { mmb: data.mmb, solutionIndex: data.solutionIndex }
            : {}),
        } as unknown as JsonValue,
        kind: this.answerKind,
        schemaVersion: this.schemaVersion,
      },
      ok: true,
    };
  }

  async evaluate(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    _context: EvaluationContext,
  ): Promise<AutomaticEvaluation> {
    const base = {
      declarationHash: declaration.declarationHash,
      evaluatorVersion: TRANSLATION_EVALUATOR_VERSION,
      kind: "automatic" as const,
      nominalMaxScore: declaration.nominalPoints,
    };

    if (!isTranslationPublicData(declaration.publicData)) {
      return {
        ...base,
        awardedScore: 0,
        feedback: {
          diagnostics: [{ code: "invalid_declaration_public_data" }],
        },
        status: "error",
      };
    }

    const publicData = declaration.publicData;
    const data = translationAnswerData(answer);
    const incorrect = (reason: string): AutomaticEvaluation => ({
      ...base,
      awardedScore: 0,
      feedback: { reason },
      status: "incorrect",
    });

    const formula = readSubmission(publicData, data.text);

    if (formula === null) {
      return incorrect("unreadable");
    }

    const dialect = dialectById(publicData.dialect);

    if (dialect === null) {
      return { ...base, awardedScore: 0, status: "error" };
    }

    if (runTranslationTests(formula, publicData.tests).length > 0) {
      return incorrect("failed-tests");
    }

    const canonical = formulaToString(formula, dialect);
    const correct = (): AutomaticEvaluation => ({
      ...base,
      awardedScore: declaration.nominalPoints,
      status: "correct",
    });

    // Typing a solution verbatim (canonically) is correct in every variant,
    // and for `exact` it is the whole question.
    if (publicData.solutions.includes(canonical)) {
      return correct();
    }

    if (publicData.variant === "exact") {
      return incorrect("not-the-answer");
    }

    // Equivalence: the certificate is the graded input, verified against an
    // mm0 rebuilt here from our own parse of both sides — never against
    // anything the client sent beyond the formula text and the MMB bytes.
    const solutionSource =
      data.solutionIndex === undefined
        ? undefined
        : publicData.solutions[data.solutionIndex];
    const mmb = data.mmb === undefined ? null : decodeBase64(data.mmb);

    if (solutionSource === undefined || mmb === null) {
      return incorrect("no-certificate");
    }

    const solution = parseFormula(solutionSource, dialect);

    if (!solution.ok) {
      return { ...base, awardedScore: 0, status: "error" };
    }

    const sources = buildEquivalenceCheck(formula, solution.formula);
    const result = await verifyMmb(sources.mm0, mmb);

    if (result.errored) {
      return {
        ...base,
        awardedScore: 0,
        feedback: { verified: false },
        status: "error",
      };
    }

    return result.ok ? correct() : incorrect("not-equivalent");
  }

  reviewAnswer(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    context: ExerciseReviewContext,
  ): ExerciseAnswerReview {
    const i18n = context.i18n;
    const data = translationAnswerData(answer);

    if (!isTranslationPublicData(declaration.publicData)) {
      return { summary: i18n.t("Translation") };
    }

    // Show what was submitted, in logical symbols where it parses and as
    // typed where it does not. Whether it was *right* is the recorded
    // evaluation's story: equivalence cannot be recomputed here (the check
    // runs a search this page has no engine for), so unlike the model this
    // review asserts nothing the seal would need to hide.
    const dialect = dialectById(declaration.publicData.dialect);
    const parsed = dialect === null ? null : parseFormula(data.text, dialect);
    const display =
      dialect !== null && parsed?.ok
        ? formulaToDisplay(parsed.formula, dialect)
        : data.text;

    return {
      details: [{ label: i18n.t("Answer"), value: display }],
      elementHtml: renderTranslationReview(
        { display, exerciseId: declaration.id, text: data.text },
        i18n,
      ),
      summary: i18n.t("Translation"),
    };
  }
}
