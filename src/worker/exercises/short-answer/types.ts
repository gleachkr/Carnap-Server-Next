import type { ShortAnswerPublicData } from "../../domain/content";
import type { ExerciseCapabilities } from "../../domain/exercises";
import type { JsonValue } from "../../domain/json";
import type { Translator } from "../../i18n/translator";

export type {
  ShortAnswerAnswerData,
  ShortAnswerPrivateData,
  ShortAnswerPublicData,
} from "../../domain/content";

export const SHORT_ANSWER_KIND = "short-answer@1";
export const SHORT_ANSWER_SCHEMA_VERSION = 1;
export const SHORT_ANSWER_ANSWER_KIND = "short-answer-answer@1";
// No client bundle: a short answer is a plain text input the server renders into
// the submission form, usable with JavaScript off.
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

function isObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isShortAnswerPublicData(
  value: JsonValue,
): value is JsonValue & ShortAnswerPublicData {
  return isObject(value) && typeof value.promptHtml === "string";
}
