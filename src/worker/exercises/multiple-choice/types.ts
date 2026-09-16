import type { MultipleChoicePublicData } from "../../domain/content";
import type { JsonValue } from "../../domain/json";

export type {
  MultipleChoiceAnswerData,
  MultipleChoiceMode,
  MultipleChoiceOptionPublicData,
  MultipleChoicePrivateData,
  MultipleChoicePublicData,
} from "../../domain/content";

export const MULTIPLE_CHOICE_KIND = "multiple-choice@1";
export const MULTIPLE_CHOICE_SCHEMA_VERSION = 1;
export const MULTIPLE_CHOICE_ANSWER_KIND = "multiple-choice-answer@1";
export const MULTIPLE_CHOICE_COMPONENT_METADATA = {
  assetId: "carnap-multiple-choice-v1",
  clientModule: true,
  component: "carnap-multiple-choice",
  componentVersion: "1",
} as const;

function isObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMultipleChoicePublicData(
  value: JsonValue,
): value is JsonValue & MultipleChoicePublicData {
  if (!isObject(value)) {
    return false;
  }

  const options = value.options;

  return (
    (value.mode === "single" || value.mode === "multiple") &&
    typeof value.promptHtml === "string" &&
    Array.isArray(options) &&
    options.every(
      (option) =>
        isObject(option) &&
        typeof option.id === "string" &&
        typeof option.html === "string",
    )
  );
}
