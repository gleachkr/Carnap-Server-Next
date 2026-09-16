import type { ShortAnswerPublicData } from "../../domain/content";
import type { JsonValue } from "../../domain/json";

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

function isObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isShortAnswerPublicData(
  value: JsonValue,
): value is JsonValue & ShortAnswerPublicData {
  return isObject(value) && typeof value.promptHtml === "string";
}
