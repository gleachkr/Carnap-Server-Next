import type { ExerciseCapabilities } from "../../domain/exercises";
import type { JsonValue } from "../../domain/json";
import { isObject } from "../../exercise-kit/assessment";
import type { Translator } from "../../i18n/translator";

export type MultipleChoiceMode = "single" | "multiple";

export interface MultipleChoiceOptionPublicData {
  readonly html: string;
  readonly id: string;
}

export interface MultipleChoicePublicData {
  readonly mode: MultipleChoiceMode;
  readonly options: readonly MultipleChoiceOptionPublicData[];
  readonly promptHtml: string;
}

export interface MultipleChoicePrivateData {
  readonly correctOptionIds: readonly string[];
  readonly mode: MultipleChoiceMode;
}

export interface MultipleChoiceAnswerData {
  readonly selectedOptionIds: readonly string[];
}

export const MULTIPLE_CHOICE_KIND = "multiple-choice@1";
export const MULTIPLE_CHOICE_SCHEMA_VERSION = 1;
export const MULTIPLE_CHOICE_ANSWER_KIND = "multiple-choice-answer@1";
export const MULTIPLE_CHOICE_COMPONENT_METADATA = {
  assetId: "carnap-multiple-choice-v1",
  clientModule: true,
  component: "carnap-multiple-choice",
  componentVersion: "1",
} as const;

/** What grading can do for this type; declared once, copied onto each manifest item. */
export const MULTIPLE_CHOICE_CAPABILITIES: ExerciseCapabilities = {
  supportsAutomaticEvaluation: true,
  supportsManualReview: true,
};

/** The generic group name for an untitled exercise of this type. */
export function multipleChoiceName(i18n: Translator): string {
  return i18n.t("Multiple-choice question");
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
