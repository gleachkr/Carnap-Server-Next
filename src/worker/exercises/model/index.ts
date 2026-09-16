import type { ExerciseType } from "../../exercise-kit/type";
import { MODEL_ASSESSMENT } from "./assessment";
import { compileModel } from "./authoring";
import { renderModel } from "./read-only-view";
import { buildModelStrings } from "./strings";
import {
  MODEL_ANSWER_KIND,
  MODEL_CAPABILITIES,
  MODEL_COMPONENT_METADATA,
  MODEL_KIND,
  MODEL_SCHEMA_VERSION,
  modelName,
} from "./types";

/** The `:::model` exercise type, as `src/worker/exercises/index.ts` lists it. */
export const MODEL_EXERCISE = {
  ...MODEL_ASSESSMENT,
  answerKind: MODEL_ANSWER_KIND,
  compile: compileModel,
  component: {
    ...MODEL_COMPONENT_METADATA,
    capabilities: MODEL_CAPABILITIES,
  },
  directiveName: "model",
  kind: MODEL_KIND,
  name: modelName,
  render: renderModel,
  schemaVersion: MODEL_SCHEMA_VERSION,
  strings: buildModelStrings,
} satisfies ExerciseType;
