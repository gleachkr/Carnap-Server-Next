import type { ExerciseType } from "../../exercise-kit/type";
import { FREE_RESPONSE_ASSESSMENT } from "./assessment";
import { compileFreeResponse } from "./authoring";
import { renderFreeResponse } from "./read-only-view";
import {
  FREE_RESPONSE_ANSWER_KIND,
  FREE_RESPONSE_CAPABILITIES,
  FREE_RESPONSE_COMPONENT_METADATA,
  FREE_RESPONSE_KIND,
  FREE_RESPONSE_SCHEMA_VERSION,
  freeResponseName,
} from "./types";

/** The `:::free-response` exercise type, as `src/worker/exercises/index.ts` lists it. */
export const FREE_RESPONSE_EXERCISE = {
  ...FREE_RESPONSE_ASSESSMENT,
  answerKind: FREE_RESPONSE_ANSWER_KIND,
  compile: compileFreeResponse,
  component: {
    ...FREE_RESPONSE_COMPONENT_METADATA,
    capabilities: FREE_RESPONSE_CAPABILITIES,
  },
  directiveName: "free-response",
  kind: FREE_RESPONSE_KIND,
  name: freeResponseName,
  render: renderFreeResponse,
  schemaVersion: FREE_RESPONSE_SCHEMA_VERSION,
} satisfies ExerciseType;
