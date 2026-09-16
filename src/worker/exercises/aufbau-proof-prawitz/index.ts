import type { ExerciseType } from "../../exercise-kit/type";
import { AUFBAU_PROOF_PRAWITZ_ASSESSMENT } from "./assessment";
import { compileAufbauProofPrawitz } from "./authoring";
import { renderAufbauProofPrawitz } from "./read-only-view";
import { buildAufbauProofPrawitzStrings } from "./strings";
import {
  AUFBAU_PROOF_PRAWITZ_ANSWER_KIND,
  AUFBAU_PROOF_PRAWITZ_CAPABILITIES,
  AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA,
  AUFBAU_PROOF_PRAWITZ_KIND,
  AUFBAU_PROOF_PRAWITZ_SCHEMA_VERSION,
  aufbauProofPrawitzName,
} from "./types";

/** The `:::aufbau-proof-prawitz` exercise type, as `src/worker/exercises/index.ts` lists it. */
export const AUFBAU_PROOF_PRAWITZ_EXERCISE = {
  ...AUFBAU_PROOF_PRAWITZ_ASSESSMENT,
  answerKind: AUFBAU_PROOF_PRAWITZ_ANSWER_KIND,
  compile: compileAufbauProofPrawitz,
  component: {
    ...AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA,
    capabilities: AUFBAU_PROOF_PRAWITZ_CAPABILITIES,
  },
  directiveName: "aufbau-proof-prawitz",
  kind: AUFBAU_PROOF_PRAWITZ_KIND,
  name: aufbauProofPrawitzName,
  render: renderAufbauProofPrawitz,
  schemaVersion: AUFBAU_PROOF_PRAWITZ_SCHEMA_VERSION,
  strings: buildAufbauProofPrawitzStrings,
} satisfies ExerciseType;
