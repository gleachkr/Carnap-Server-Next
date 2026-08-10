import type { Translator } from "../i18n/translator";

/**
 * The text the three proof widgets — linear `.auf`, Fitch, and tree — all show,
 * because they all drive the same WASM compiler.
 *
 * The verdict itself is not here: it is the shared correctness mark in the
 * action bar, which the server renders with the names for all four of its
 * states on it, so no widget carries text for it.
 *
 * Shared rather than repeated so a translator sees each sentence once. Each
 * widget's own `strings.ts` spreads this into its map, so the ids stay identical
 * across the three and the catalog holds one entry apiece.
 *
 * Note what is *not* here: the compiler's own diagnostics. `@aufbau/compiler`
 * exposes no locale option, so its prose reaches the student's editor gutter in
 * English regardless. These are our wrappers around it.
 */
export function buildProofEngineStrings(i18n: Translator) {
  return {
    "Could not load the proof engine.": i18n.t(
      "Could not load the proof engine.",
    ),
    /** Fallback when a compiler diagnostic arrives with no readable message. */
    "Problem in the proof.": i18n.t("Problem in the proof."),
    /** Label on the goal row, before the sequent the student must derive. */
    Prove: i18n.t("Prove"),
    /**
     * Accessible name of the read-only editor a marked proof is shown in. A
     * CodeMirror view has role `textbox` and no name of its own, so without this a
     * reviewer meets an unlabelled text box.
     */
    "Submitted proof": i18n.t("Submitted proof"),
    "The proof engine couldn't read this proof — check for unexpected characters.":
      i18n.t(
        "The proof engine couldn't read this proof — check for unexpected characters.",
      ),
  };
}
