import type { ExerciseCapabilities } from "../../domain/exercises";
import type { JsonValue } from "../../domain/json";
import { isObject } from "../../exercise-kit/assessment";
import type { Translator } from "../../i18n/translator";

export interface FreeResponsePublicData {
  readonly promptHtml: string;
}

export interface FreeResponsePrivateData {
  readonly rubricHtml?: string;
}

export interface FreeResponseAnswerData {
  readonly text: string;
}

export const FREE_RESPONSE_KIND = "free-response@1";
export const FREE_RESPONSE_SCHEMA_VERSION = 1;
export const FREE_RESPONSE_ANSWER_KIND = "free-response-answer@1";
// No client bundle: a free response is a plain textarea the server renders into
// the submission form, which the exercise runtime reads as it would an
// element's answer. Not a no-JS path — answers are posted as JSON by the
// runtime alone (`submitAnswer` in `routes/assignments.ts`); there is simply
// nothing here for a bundle to enhance.
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

export function isFreeResponsePublicData(
  value: JsonValue,
): value is JsonValue & FreeResponsePublicData {
  return isObject(value) && typeof value.promptHtml === "string";
}
