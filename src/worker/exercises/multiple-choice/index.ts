import type { ExerciseType } from "../../exercise-kit/type";
import { MULTIPLE_CHOICE_ASSESSMENT } from "./assessment";
import { compileMultipleChoice } from "./authoring";
import { renderMultipleChoice } from "./read-only-view";
import {
  MULTIPLE_CHOICE_ANSWER_KIND,
  MULTIPLE_CHOICE_CAPABILITIES,
  MULTIPLE_CHOICE_COMPONENT_METADATA,
  MULTIPLE_CHOICE_KIND,
  MULTIPLE_CHOICE_SCHEMA_VERSION,
  multipleChoiceName,
} from "./types";

/** The `:::multiple-choice` exercise type, as `src/worker/exercises/index.ts` lists it. */
export const MULTIPLE_CHOICE_EXERCISE = {
  ...MULTIPLE_CHOICE_ASSESSMENT,
  answerKind: MULTIPLE_CHOICE_ANSWER_KIND,
  compile: compileMultipleChoice,
  component: {
    ...MULTIPLE_CHOICE_COMPONENT_METADATA,
    capabilities: MULTIPLE_CHOICE_CAPABILITIES,
  },
  directiveName: "multiple-choice",
  kind: MULTIPLE_CHOICE_KIND,
  name: multipleChoiceName,
  render: renderMultipleChoice,
  schemaVersion: MULTIPLE_CHOICE_SCHEMA_VERSION,
} satisfies ExerciseType;
