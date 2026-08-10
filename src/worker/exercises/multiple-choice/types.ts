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
