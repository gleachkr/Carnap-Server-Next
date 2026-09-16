import type { ExerciseType } from "../../exercise-kit/type";
import { AUFBAU_PROOF_ASSESSMENT } from "./assessment";
import { compileAufbauProof } from "./authoring";
import { renderAufbauProof } from "./read-only-view";
import { buildAufbauProofStrings } from "./strings";
import {
  AUFBAU_PROOF_ANSWER_KIND,
  AUFBAU_PROOF_CAPABILITIES,
  AUFBAU_PROOF_COMPONENT_METADATA,
  AUFBAU_PROOF_KIND,
  AUFBAU_PROOF_SCHEMA_VERSION,
  aufbauProofName,
} from "./types";

/** The `:::aufbau-proof` exercise type, as `src/worker/exercises/index.ts` lists it. */
export const AUFBAU_PROOF_EXERCISE = {
  ...AUFBAU_PROOF_ASSESSMENT,
  answerKind: AUFBAU_PROOF_ANSWER_KIND,
  compile: compileAufbauProof,
  component: {
    ...AUFBAU_PROOF_COMPONENT_METADATA,
    capabilities: AUFBAU_PROOF_CAPABILITIES,
  },
  directiveName: "aufbau-proof",
  kind: AUFBAU_PROOF_KIND,
  name: aufbauProofName,
  render: renderAufbauProof,
  schemaVersion: AUFBAU_PROOF_SCHEMA_VERSION,
  strings: buildAufbauProofStrings,
} satisfies ExerciseType;
