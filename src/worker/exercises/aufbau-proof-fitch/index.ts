import type { ExerciseType } from "../../exercise-kit/type";
import { AUFBAU_PROOF_FITCH_ASSESSMENT } from "./assessment";
import { compileAufbauProofFitch } from "./authoring";
import { renderAufbauProofFitch } from "./read-only-view";
import { buildAufbauProofFitchStrings } from "./strings";
import {
  AUFBAU_PROOF_FITCH_ANSWER_KIND,
  AUFBAU_PROOF_FITCH_CAPABILITIES,
  AUFBAU_PROOF_FITCH_COMPONENT_METADATA,
  AUFBAU_PROOF_FITCH_KIND,
  AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
  aufbauProofFitchName,
} from "./types";

/** The `:::aufbau-proof-fitch` exercise type, as `src/worker/exercises/index.ts` lists it. */
export const AUFBAU_PROOF_FITCH_EXERCISE = {
  ...AUFBAU_PROOF_FITCH_ASSESSMENT,
  answerKind: AUFBAU_PROOF_FITCH_ANSWER_KIND,
  compile: compileAufbauProofFitch,
  component: {
    ...AUFBAU_PROOF_FITCH_COMPONENT_METADATA,
    capabilities: AUFBAU_PROOF_FITCH_CAPABILITIES,
  },
  directiveName: "aufbau-proof-fitch",
  kind: AUFBAU_PROOF_FITCH_KIND,
  name: aufbauProofFitchName,
  // The starter body is proof text, not markdown; see `ExerciseType.rawBody`.
  rawBody: true,
  render: renderAufbauProofFitch,
  schemaVersion: AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
  strings: buildAufbauProofFitchStrings,
} satisfies ExerciseType;
