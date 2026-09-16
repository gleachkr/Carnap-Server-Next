import type { ExerciseType } from "../../exercise-kit/type";
import { AUFBAU_PROOF_TREE_ASSESSMENT } from "./assessment";
import { compileAufbauProofTree } from "./authoring";
import { renderAufbauProofTree } from "./read-only-view";
import { buildAufbauProofTreeStrings } from "./strings";
import {
  AUFBAU_PROOF_TREE_ANSWER_KIND,
  AUFBAU_PROOF_TREE_CAPABILITIES,
  AUFBAU_PROOF_TREE_COMPONENT_METADATA,
  AUFBAU_PROOF_TREE_KIND,
  AUFBAU_PROOF_TREE_SCHEMA_VERSION,
  aufbauProofTreeName,
} from "./types";

/** The `:::aufbau-proof-tree` exercise type, as `src/worker/exercises/index.ts` lists it. */
export const AUFBAU_PROOF_TREE_EXERCISE = {
  ...AUFBAU_PROOF_TREE_ASSESSMENT,
  answerKind: AUFBAU_PROOF_TREE_ANSWER_KIND,
  compile: compileAufbauProofTree,
  component: {
    ...AUFBAU_PROOF_TREE_COMPONENT_METADATA,
    capabilities: AUFBAU_PROOF_TREE_CAPABILITIES,
  },
  directiveName: "aufbau-proof-tree",
  kind: AUFBAU_PROOF_TREE_KIND,
  name: aufbauProofTreeName,
  render: renderAufbauProofTree,
  schemaVersion: AUFBAU_PROOF_TREE_SCHEMA_VERSION,
  strings: buildAufbauProofTreeStrings,
} satisfies ExerciseType;
