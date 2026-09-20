import { buildProofEngineStrings } from "../../exercise-kit/proof/engine-strings";
import type { Translator } from "../../i18n/translator";

/**
 * Interface text for the linear `.auf` proof widget: the shared proof-engine
 * set, the goal row's label, the editor's fallback for a diagnostic the engine
 * sent without a message, and the name of the editor itself.
 */
export function buildAufbauProofStrings(i18n: Translator) {
  return {
    ...buildProofEngineStrings(i18n),
    /** Fallback when a compiler diagnostic arrives with no readable message. */
    "Problem in the proof.": i18n.t("Problem in the proof."),
    /** Label on the goal row, before the sequent the student must derive. */
    Prove: i18n.t("Prove"),
    /**
     * Accessible name of the editor itself. CodeMirror's editable surface is a
     * `role="textbox"` with no name, so a student tabbing into the proof would
     * otherwise be told only "edit text, multiline".
     */
    "Proof editor": i18n.t("Proof editor"),
  };
}

export type AufbauProofStringId = keyof ReturnType<
  typeof buildAufbauProofStrings
>;
