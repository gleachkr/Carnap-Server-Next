import {
  diagnostic,
  isObject,
  isStringArray,
  isTextAnswerData,
  normalizeText,
  textAnswerReview,
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
import type { ShortAnswerAnswerData, ShortAnswerPrivateData } from "./types";
import {
  SHORT_ANSWER_ANSWER_KIND,
  SHORT_ANSWER_COMPONENT_METADATA,
  SHORT_ANSWER_KIND,
  SHORT_ANSWER_SCHEMA_VERSION,
} from "./types";

const SHORT_ANSWER_EVALUATOR_VERSION = "short-answer-evaluator@1";

function isShortAnswerPrivateData(
  value: JsonValue,
): value is JsonValue & ShortAnswerPrivateData {
  if (!isObject(value)) {
    return false;
  }

  return (
    isStringArray(value.acceptedAnswers ?? null) &&
    typeof value.caseSensitive === "boolean"
  );
}

function shortAnswerAnswerData(
  answer: NormalizedAnswer,
): ShortAnswerAnswerData {
  return answer.data as unknown as ShortAnswerAnswerData;
}

export class ShortAnswerExerciseType implements AssessmentExerciseType {
  readonly answerKind = SHORT_ANSWER_ANSWER_KIND;
  readonly capabilities = {
    supportsAutomaticEvaluation: true,
    supportsManualReview: true,
  };
  readonly component = {
    ...SHORT_ANSWER_COMPONENT_METADATA,
    capabilities: this.capabilities,
  };
  readonly kind = SHORT_ANSWER_KIND;
  readonly schemaVersion = SHORT_ANSWER_SCHEMA_VERSION;

  normalizeAnswer(envelope: AnswerEnvelope): AnswerNormalizationResult {
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

    if (!isTextAnswerData(envelope.data)) {
      return {
        diagnostics: [
          diagnostic(
            "invalid_answer_text",
            "A short-answer text value is required.",
            ["data", "text"],
          ),
        ],
        ok: false,
        reason: "schema-invalid",
      };
    }

    const data: ShortAnswerAnswerData = {
      text: normalizeText(envelope.data.text).trim(),
    };

    return {
      answer: {
        data: data as unknown as JsonValue,
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
    if (!isShortAnswerPrivateData(declaration.privateData)) {
      return {
        awardedScore: 0,
        declarationHash: declaration.declarationHash,
        evaluatorVersion: SHORT_ANSWER_EVALUATOR_VERSION,
        feedback: {
          diagnostics: [
            {
              code: "invalid_declaration_private_data",
            },
          ],
        },
        kind: "automatic",
        nominalMaxScore: declaration.nominalPoints,
        status: "error",
      };
    }

    const privateData = declaration.privateData;
    const data = shortAnswerAnswerData(answer);
    // Locale-invariant on purpose: `toLocaleLowerCase` folds by the *runtime's*
    // locale, so the same answer could be graded differently depending on where
    // the evaluator ran (Turkish folds "I" to "ı", not "i"). A grade must not
    // depend on that, and the author's accepted answers are compared against
    // the student's text under one fixed rule.
    const value = privateData.caseSensitive
      ? data.text
      : data.text.toLowerCase();
    const accepted = privateData.acceptedAnswers.map((item) =>
      privateData.caseSensitive ? item : item.toLowerCase(),
    );
    const correct = accepted.includes(value);

    return {
      awardedScore: correct ? declaration.nominalPoints : 0,
      declarationHash: declaration.declarationHash,
      evaluatorVersion: SHORT_ANSWER_EVALUATOR_VERSION,
      feedback: { text: data.text },
      kind: "automatic",
      nominalMaxScore: declaration.nominalPoints,
      status: correct ? "correct" : "incorrect",
    };
  }

  reviewAnswer(
    answer: NormalizedAnswer,
    _declaration: ExerciseManifestItem,
    context: ExerciseReviewContext,
  ): ExerciseAnswerReview {
    return textAnswerReview(answer, context.i18n);
  }
}
