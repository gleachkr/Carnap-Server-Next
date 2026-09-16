import type { FreeResponsePublicData } from "../../domain/content";
import type { ExerciseCapabilities } from "../../domain/exercises";
import type { JsonValue } from "../../domain/json";
import type { Translator } from "../../i18n/translator";

export type {
  FreeResponseAnswerData,
  FreeResponsePrivateData,
  FreeResponsePublicData,
} from "../../domain/content";

export const FREE_RESPONSE_KIND = "free-response@1";
export const FREE_RESPONSE_SCHEMA_VERSION = 1;
export const FREE_RESPONSE_ANSWER_KIND = "free-response-answer@1";
// No client bundle: a free response is a plain textarea the server renders into
// the submission form, usable with JavaScript off.
export const FREE_RESPONSE_COMPONENT_METADATA = {
  assetId: "carnap-free-response-v1",
  clientModule: false,
  component: "carnap-free-response",
  componentVersion: "1",
} as const;

/** What grading can do for this type; declared once, copied onto each manifest item. */
export const FREE_RESPONSE_CAPABILITIES: ExerciseCapabilities = {
  supportsAutomaticEvaluation: false,
  supportsManualReview: true,
};

/** The generic group name for an untitled exercise of this type. */
export function freeResponseName(i18n: Translator): string {
  return i18n.t("Free-response question");
}

function isObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFreeResponsePublicData(
  value: JsonValue,
): value is JsonValue & FreeResponsePublicData {
  return isObject(value) && typeof value.promptHtml === "string";
}
