import type { ExerciseType } from "../../exercise-kit/type";
import { SHORT_ANSWER_ASSESSMENT } from "./assessment";
import { compileShortAnswer } from "./authoring";
import { renderShortAnswer } from "./read-only-view";
import {
  SHORT_ANSWER_ANSWER_KIND,
  SHORT_ANSWER_CAPABILITIES,
  SHORT_ANSWER_COMPONENT_METADATA,
  SHORT_ANSWER_KIND,
  SHORT_ANSWER_SCHEMA_VERSION,
  shortAnswerName,
} from "./types";

/** The `:::short-answer` exercise type, as `src/worker/exercises/index.ts` lists it. */
export const SHORT_ANSWER_EXERCISE = {
  ...SHORT_ANSWER_ASSESSMENT,
  answerKind: SHORT_ANSWER_ANSWER_KIND,
  compile: compileShortAnswer,
  component: {
    ...SHORT_ANSWER_COMPONENT_METADATA,
    capabilities: SHORT_ANSWER_CAPABILITIES,
  },
  directiveName: "short-answer",
  kind: SHORT_ANSWER_KIND,
  name: shortAnswerName,
  render: renderShortAnswer,
  schemaVersion: SHORT_ANSWER_SCHEMA_VERSION,
} satisfies ExerciseType;
