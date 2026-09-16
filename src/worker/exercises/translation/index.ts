import type { ExerciseType } from "../../exercise-kit/type";
import { TRANSLATION_ASSESSMENT } from "./assessment";
import { compileTranslation } from "./authoring";
import { renderTranslation } from "./read-only-view";
import { buildTranslationStrings } from "./strings";
import {
  TRANSLATION_ANSWER_KIND,
  TRANSLATION_CAPABILITIES,
  TRANSLATION_COMPONENT_METADATA,
  TRANSLATION_KIND,
  TRANSLATION_SCHEMA_VERSION,
  translationName,
} from "./types";

/** The `:::translation` exercise type, as `src/worker/exercises/index.ts` lists it. */
export const TRANSLATION_EXERCISE = {
  ...TRANSLATION_ASSESSMENT,
  answerKind: TRANSLATION_ANSWER_KIND,
  compile: compileTranslation,
  component: {
    ...TRANSLATION_COMPONENT_METADATA,
    capabilities: TRANSLATION_CAPABILITIES,
  },
  directiveName: "translation",
  kind: TRANSLATION_KIND,
  name: translationName,
  render: renderTranslation,
  schemaVersion: TRANSLATION_SCHEMA_VERSION,
  strings: buildTranslationStrings,
} satisfies ExerciseType;
