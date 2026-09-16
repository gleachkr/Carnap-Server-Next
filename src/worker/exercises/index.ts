import type { ExerciseType } from "../exercise-kit/type";
import { AUFBAU_PROOF_EXERCISE } from "./aufbau-proof";
import { AUFBAU_PROOF_FITCH_EXERCISE } from "./aufbau-proof-fitch";
import { AUFBAU_PROOF_PRAWITZ_EXERCISE } from "./aufbau-proof-prawitz";
import { AUFBAU_PROOF_TREE_EXERCISE } from "./aufbau-proof-tree";
import { FREE_RESPONSE_EXERCISE } from "./free-response";
import { MODEL_EXERCISE } from "./model";
import { MULTIPLE_CHOICE_EXERCISE } from "./multiple-choice";
import { SHORT_ANSWER_EXERCISE } from "./short-answer";
import { TRANSLATION_EXERCISE } from "./translation";
import { TRUTH_TABLE_EXERCISE } from "./truth-table";

/**
 * Every exercise type, once, in the order they are registered.
 *
 * This list is the whole registration: `application/content/registry.ts`
 * builds its lookups from it, and nothing else enumerates the types. Adding a
 * type is a folder beside these exporting one {@link ExerciseType} from its
 * `index.ts`, and one line here. Directive names carry no site prefix — a
 * `carnap-` on the front of each would only repeat the name of the site the
 * author is already writing for. The `aufbau-` on the proof types is
 * different: it names the engine that checks them, which is a real
 * distinction.
 */
export const EXERCISE_TYPES: readonly ExerciseType[] = [
  MULTIPLE_CHOICE_EXERCISE,
  FREE_RESPONSE_EXERCISE,
  SHORT_ANSWER_EXERCISE,
  TRUTH_TABLE_EXERCISE,
  MODEL_EXERCISE,
  AUFBAU_PROOF_EXERCISE,
  AUFBAU_PROOF_TREE_EXERCISE,
  AUFBAU_PROOF_FITCH_EXERCISE,
  AUFBAU_PROOF_PRAWITZ_EXERCISE,
  TRANSLATION_EXERCISE,
];
