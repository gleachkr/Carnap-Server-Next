import { buildProofEditorStrings } from "../../exercise-kit/proof/editor-strings";
import { buildProofEngineStrings } from "../../exercise-kit/proof/engine-strings";
import type { Translator } from "../../i18n/translator";

/**
 * Interface text for the linear `.auf` proof widget: the shared proof-engine
 * set, the problem keys it shares with the Fitch editor, the goal row's label, the editor's fallback for a diagnostic the engine
 * sent without a message, and the name of the editor itself.
 */
export function buildAufbauProofStrings(i18n: Translator) {
  return {
    ...buildProofEngineStrings(i18n),
    ...buildProofEditorStrings(i18n),
    /** Fallback when a compiler diagnostic arrives with no readable message. */
    "Error in the proof.": i18n.t("Error in the proof."),
    /** Label on the goal row, before the sequent the student must derive. */
    Prove: i18n.t("Prove"),
    /**
     * Accessible name of the editor itself. CodeMirror's editable surface is a
     * `role="textbox"` with no name, so a student tabbing into the proof would
     * otherwise be told only "edit text, multiline".
     */
    "Proof editor": i18n.t("Proof editor"),
    /** Help: the dialog's heading, and its accessible name. */
    "Using the proof editor": i18n.t("Using the proof editor"),
    /** Help: the first orientation paragraph — what a line looks like. */
    "Write one step per line: a label, the formula between dollar signs, then by, the rule's name, and the lines it cites in brackets, as in l3: $ q $ by mp [l1, l2]. Cite the goal's hypotheses as #1, #2, and so on.":
      i18n.t(
        "Write one step per line: a label, the formula between dollar signs, then by, the rule's name, and the lines it cites in brackets, as in l3: $ q $ by mp [l1, l2]. Cite the goal's hypotheses as #1, #2, and so on.",
      ),
  };
}

export type AufbauProofStringId = keyof ReturnType<
  typeof buildAufbauProofStrings
>;
