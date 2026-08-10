import type { Translator } from "../../i18n/translator";
import { buildProofEngineStrings } from "../proof-engine-strings";

/**
 * Interface text for the linear `.auf` proof widget: the shared proof-engine set
 * plus the name of its editor.
 */
export function buildAufbauProofStrings(i18n: Translator) {
  return {
    ...buildProofEngineStrings(i18n),
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
