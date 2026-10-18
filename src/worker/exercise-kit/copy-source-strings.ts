import type { Translator } from "../i18n/translator";

/**
 * A widget's work as directive source: the author preview's "Copy as source"
 * button (see `mountCopySource` in the client), and the Ctrl-? dialog that
 * shows the same text on any form (`mountShowSource`). Spread into the map of
 * each widget that offers them, the way {@link buildExerciseHelpStrings} is.
 *
 * The literals sit at the `i18n.t(...)` call sites because Lingui's extractor
 * reads string literals passed to a receiver *named* `i18n`.
 */
export function buildCopySourceStrings(i18n: Translator) {
  return {
    /** A preview-only button: copies the author's edited work as directive
     *  source, to paste into the exercise. */
    "Copy as source": i18n.t("Copy as source"),
    /** Said once the copy has landed on the clipboard: on the action bar for
     *  the preview's button, in the dialog for its Copy. */
    "Copied.": i18n.t("Copied."),
    /** The Ctrl-? dialog's heading. */
    "Your work as source": i18n.t("Your work as source"),
    /** Accessible name of the dialog's dismiss button, drawn as ×; the
     *  proof editors' problem panel says the same. */
    Close: i18n.t("Close"),
    /** The dialog's button that puts the text on the clipboard. */
    Copy: i18n.t("Copy"),
    /** The Ctrl-? row in each widget's key table. */
    "Show your work as source": i18n.t("Show your work as source"),
  };
}

/** Every string id the copy and show-source helpers say. */
export type CopySourceStringId = keyof ReturnType<
  typeof buildCopySourceStrings
>;
