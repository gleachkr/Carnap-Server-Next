import {
  diagnostic,
  htmlToText,
  isObject,
  isTextAnswerData,
  normalizeText,
  textAnswerReview,
} from "../../application/content/assessment-support";
import type { AssessmentExerciseType } from "../../application/content/registry";
import type {
  AnswerEnvelope,
  AnswerNormalizationResult,
  ExerciseAnswerReview,
  ExerciseManifestItem,
  ExerciseReviewContext,
  ManualGradingSpec,
  NormalizedAnswer,
} from "../../domain/content";
import type { JsonValue } from "../../domain/json";
import type {
  FreeResponseAnswerData,
  FreeResponsePrivateData,
} from "./types";
import {
  FREE_RESPONSE_ANSWER_KIND,
  FREE_RESPONSE_COMPONENT_METADATA,
  FREE_RESPONSE_KIND,
  FREE_RESPONSE_SCHEMA_VERSION,
} from "./types";

function isFreeResponsePrivateData(
  value: JsonValue,
): value is JsonValue & FreeResponsePrivateData {
  if (!isObject(value)) {
    return false;
  }

  return (
    value.rubricHtml === undefined || typeof value.rubricHtml === "string"
  );
}

export class FreeResponseExerciseType implements AssessmentExerciseType {
  readonly answerKind = FREE_RESPONSE_ANSWER_KIND;
  readonly capabilities = {
    supportsAutomaticEvaluation: false,
    supportsManualReview: true,
  };
  readonly component = {
    ...FREE_RESPONSE_COMPONENT_METADATA,
    capabilities: this.capabilities,
  };
  readonly kind = FREE_RESPONSE_KIND;
  readonly schemaVersion = FREE_RESPONSE_SCHEMA_VERSION;

  manualGradingSpec(declaration: ExerciseManifestItem): ManualGradingSpec {
    if (!isFreeResponsePrivateData(declaration.privateData)) {
      return {};
    }

    if (declaration.privateData.rubricHtml === undefined) {
      return {};
    }

    return {
      rubric: {
        criteria: [
          {
            description: htmlToText(declaration.privateData.rubricHtml),
            id: "response",
            maxPoints: declaration.nominalPoints,
          },
        ],
      },
    };
  }

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
            "invalid_response_text",
            "A text response is required.",
            ["data", "text"],
          ),
        ],
        ok: false,
        reason: "schema-invalid",
      };
    }

    const data: FreeResponseAnswerData = {
      text: normalizeText(envelope.data.text),
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

  reviewAnswer(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    context: ExerciseReviewContext,
  ): ExerciseAnswerReview {
    const review = textAnswerReview(answer, context.i18n);

    if (context.audience !== "instructor") {
      return review;
    }

    if (!isFreeResponsePrivateData(declaration.privateData)) {
      return review;
    }

    const rubricHtml = declaration.privateData.rubricHtml;

    if (rubricHtml === undefined) {
      return review;
    }

    return { ...review, rubricHtml };
  }
}
