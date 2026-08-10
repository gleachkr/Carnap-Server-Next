import type { Translator } from "../i18n/translator";
import { buildAufbauProofStrings } from "./aufbau-proof/strings";
import { AUFBAU_PROOF_COMPONENT_METADATA } from "./aufbau-proof/types";
import { buildAufbauProofFitchStrings } from "./aufbau-proof-fitch/strings";
import { AUFBAU_PROOF_FITCH_COMPONENT_METADATA } from "./aufbau-proof-fitch/types";
import { buildAufbauProofPrawitzStrings } from "./aufbau-proof-prawitz/strings";
import { AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA } from "./aufbau-proof-prawitz/types";
import { buildAufbauProofTreeStrings } from "./aufbau-proof-tree/strings";
import { AUFBAU_PROOF_TREE_COMPONENT_METADATA } from "./aufbau-proof-tree/types";
import { buildModelStrings } from "./model/strings";
import { MODEL_COMPONENT_METADATA } from "./model/types";
import { buildTruthTableStrings } from "./truth-table/strings";
import { TRUTH_TABLE_COMPONENT_METADATA } from "./truth-table/types";

/**
 * Which widget's strings go into a hydration payload, by client asset id.
 *
 * Keyed by asset id rather than exercise kind because these strings belong to
 * the *element* that shows them — the same keying the component registry uses to
 * decide which bundle a document loads. Types with no interactive text (free
 * response, short answer, multiple choice) are simply absent.
 */
const BUILDERS: Readonly<
  Record<string, (i18n: Translator) => Readonly<Record<string, string>>>
> = {
  [AUFBAU_PROOF_COMPONENT_METADATA.assetId]: buildAufbauProofStrings,
  [AUFBAU_PROOF_FITCH_COMPONENT_METADATA.assetId]:
    buildAufbauProofFitchStrings,
  [AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA.assetId]:
    buildAufbauProofPrawitzStrings,
  [AUFBAU_PROOF_TREE_COMPONENT_METADATA.assetId]: buildAufbauProofTreeStrings,
  [MODEL_COMPONENT_METADATA.assetId]: buildModelStrings,
  [TRUTH_TABLE_COMPONENT_METADATA.assetId]: buildTruthTableStrings,
};

/**
 * Every asset id {@link exerciseStrings} has text for.
 *
 * For the one caller that cannot ask per exercise: the revision editor ships its
 * preview bundle a strings payload when the page is served, and the *next*
 * keystroke can add an exercise of any type. So that payload carries every
 * widget's text, and this is the list it walks.
 */
export const EXERCISE_STRING_ASSET_IDS: readonly string[] =
  Object.keys(BUILDERS);

/**
 * The widget's own interface text in the viewer's language, for
 * {@link ExerciseHydration.strings}. Empty for a type whose element shows no
 * text of its own — the map is a lookup with an English fallback, so an absent
 * entry costs nothing.
 *
 * Free of any catalog import (it takes the {@link Translator} the caller already
 * holds), because both hydration build sites reach it and one of them —
 * `exerciseHydrationForArtifact` — is compiled into the browser preview bundle.
 */
export function exerciseStrings(
  assetId: string,
  i18n: Translator,
): Readonly<Record<string, string>> {
  return BUILDERS[assetId]?.(i18n) ?? {};
}
