import type {
  AnswerEnvelope,
  AnswerNormalizationResult,
  ExerciseAnswerReview,
  ExerciseManifestItem,
  ExerciseReviewContext,
  NormalizedAnswer,
} from "../../domain/content";
import type { JsonValue } from "../../domain/json";
import {
  diagnostic,
  isObject,
  isTextAnswerData,
  normalizeText,
  textAnswerReview,
} from "../../exercise-kit/assessment";
import type { ExerciseAssessment } from "../../exercise-kit/type";
import type {
  FreeResponseAnswerData,
  FreeResponsePrivateData,
} from "./types";
import {
  FREE_RESPONSE_ANSWER_KIND,
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

export const FREE_RESPONSE_ASSESSMENT = {
  normalizeAnswer(envelope: AnswerEnvelope): AnswerNormalizationResult {
    if (envelope.kind !== FREE_RESPONSE_ANSWER_KIND) {
      return {
        diagnostics: [
          diagnostic(
            "wrong_answer_kind",
            `Expected answer kind ${FREE_RESPONSE_ANSWER_KIND}.`,
            ["kind"],
          ),
        ],
        ok: false,
        reason: "wrong-kind",
      };
    }

    if (envelope.schemaVersion !== FREE_RESPONSE_SCHEMA_VERSION) {
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
        kind: FREE_RESPONSE_ANSWER_KIND,
        schemaVersion: FREE_RESPONSE_SCHEMA_VERSION,
      },
      ok: true,
    };
  },

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
  },
} satisfies ExerciseAssessment;
