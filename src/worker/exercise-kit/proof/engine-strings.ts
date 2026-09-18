import type { Translator } from "../../i18n/translator";

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
 * Note what is *not* here: the compiler's own diagnostics. Those are translated
 * upstream, not by us — `@aufbau/compiler` carries its own catalogs and picks
 * one from the locale `client/proof-compiler.ts` hands it, so a language Aufbau
 * has not translated reaches the student's editor gutter in English however
 * complete our own catalog is. These are our wrappers around it.
 */
export function buildProofEngineStrings(i18n: Translator) {
  return {
    /**
     * Why the Submit button did nothing, under `allow-sorry` outside an exam.
     * Not a verdict, so it shows whatever the feedback setting says.
     */
    "A proof with lines admitted with sorry! cannot be submitted.": i18n.t(
      "A proof with lines admitted with sorry! cannot be submitted.",
    ),
    "Could not load the proof engine.": i18n.t(
      "Could not load the proof engine.",
    ),
    /**
     * The status line under `allow-sorry` when the only problems left are the
     * admissions themselves — on an exam, where the proof may be handed in as
     * it stands. Detail, so `full` feedback only.
     */
    "Every other line checks; lines admitted with sorry! do not score.":
      i18n.t(
        "Every other line checks; lines admitted with sorry! do not score.",
      ),
    /** The same status outside an exam, where the widget holds the proof back. */
    "Every other line checks; a proof with lines admitted with sorry! cannot be submitted.":
      i18n.t(
        "Every other line checks; a proof with lines admitted with sorry! cannot be submitted.",
      ),
    /**
     * A playground's mark when the proof has a last line but the theory
     * cannot say which of its tokens are variables, so no goal can be
     * declared for it (see `./playground.ts`).
     */
    "Could not work out what the last line states.": i18n.t(
      "Could not work out what the last line states.",
    ),
    /** Fallback when a compiler diagnostic arrives with no readable message. */
    "Problem in the proof.": i18n.t("Problem in the proof."),
    /** Label on the goal row, before the sequent the student must derive. */
    Prove: i18n.t("Prove"),
    /** The same row in a playground, before the sequent the proof derives. */
    Proves: i18n.t("Proves"),
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
