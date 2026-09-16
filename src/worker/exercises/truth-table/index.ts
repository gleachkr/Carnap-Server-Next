import type { ExerciseType } from "../../exercise-kit/type";
import { TRUTH_TABLE_ASSESSMENT } from "./assessment";
import { compileTruthTable } from "./authoring";
import { renderTruthTable } from "./read-only-view";
import { buildTruthTableStrings } from "./strings";
import {
  TRUTH_TABLE_ANSWER_KIND,
  TRUTH_TABLE_CAPABILITIES,
  TRUTH_TABLE_COMPONENT_METADATA,
  TRUTH_TABLE_KIND,
  TRUTH_TABLE_SCHEMA_VERSION,
  truthTableName,
} from "./types";

/** The `:::truth-table` exercise type, as `src/worker/exercises/index.ts` lists it. */
export const TRUTH_TABLE_EXERCISE = {
  ...TRUTH_TABLE_ASSESSMENT,
  answerKind: TRUTH_TABLE_ANSWER_KIND,
  compile: compileTruthTable,
  component: {
    ...TRUTH_TABLE_COMPONENT_METADATA,
    capabilities: TRUTH_TABLE_CAPABILITIES,
  },
  directiveName: "truth-table",
  kind: TRUTH_TABLE_KIND,
  name: truthTableName,
  render: renderTruthTable,
  schemaVersion: TRUTH_TABLE_SCHEMA_VERSION,
  strings: buildTruthTableStrings,
} satisfies ExerciseType;
