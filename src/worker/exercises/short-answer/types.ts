import type { ExerciseCapabilities } from "../../domain/exercises";
import type { JsonValue } from "../../domain/json";
import { isObject } from "../../exercise-kit/assessment";
import type { Translator } from "../../i18n/translator";

export interface ShortAnswerPublicData {
  readonly promptHtml: string;
}

export interface ShortAnswerPrivateData {
  readonly acceptedAnswers: readonly string[];
  readonly caseSensitive: boolean;
}

export interface ShortAnswerAnswerData {
  readonly text: string;
}

export const SHORT_ANSWER_KIND = "short-answer@1";
export const SHORT_ANSWER_SCHEMA_VERSION = 1;
export const SHORT_ANSWER_ANSWER_KIND = "short-answer-answer@1";
// No client bundle: a short answer is a plain text input the server renders into
// the submission form, which the exercise runtime reads as it would an
// element's answer. Not a no-JS path — answers are posted as JSON by the
// runtime alone (`submitAnswer` in `routes/assignments.ts`); there is simply
// nothing here for a bundle to enhance.
export const SHORT_ANSWER_COMPONENT_METADATA = {
  assetId: "carnap-short-answer-v1",
  clientModule: false,
  component: "carnap-short-answer",
  componentVersion: "1",
} as const;

/** What grading can do for this type; declared once, copied onto each manifest item. */
export const SHORT_ANSWER_CAPABILITIES: ExerciseCapabilities = {
  supportsAutomaticEvaluation: true,
  supportsManualReview: true,
};

/** The generic group name for an untitled exercise of this type. */
export function shortAnswerName(i18n: Translator): string {
  return i18n.t("Short-answer question");
}

export function isShortAnswerPublicData(
  value: JsonValue,
): value is JsonValue & ShortAnswerPublicData {
  return isObject(value) && typeof value.promptHtml === "string";
}
