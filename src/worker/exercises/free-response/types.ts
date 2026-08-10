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
