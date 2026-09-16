import type { Translator } from "../i18n/translator";

/**
 * The chrome around a widget's usage instructions: the button that opens them,
 * and the dialog's own furniture.
 *
 * Every interactive widget that explains itself explains itself the same way —
 * a `(?)` at the head of the exercise's action bar opening a modal with a
 * paragraph or two and a table of
 * keys — so this text is written once and spread into each widget's own map,
 * the way {@link buildProofEngineStrings} handles the text the proof widgets
 * share. The instructions themselves are per widget; only the frame is here.
 *
 * The literals sit at the `i18n.t(...)` call sites because Lingui's extractor
 * reads string literals passed to a receiver *named* `i18n`.
 */
export function buildExerciseHelpStrings(i18n: Translator) {
  return {
    /** Accessible name of the `(?)` button, and its tooltip. The glyph itself
     *  is drawn in the client and is not text a translator sees. */
    "Usage and keyboard shortcuts": i18n.t("Usage and keyboard shortcuts"),
    /** Accessible name of the dialog's dismiss button; it shows a × glyph. */
    "Close help": i18n.t("Close help"),
    /** Heading over the key table, below the prose. */
    Keyboard: i18n.t("Keyboard"),
  };
}

export type ExerciseHelpStringId = keyof ReturnType<
  typeof buildExerciseHelpStrings
>;
