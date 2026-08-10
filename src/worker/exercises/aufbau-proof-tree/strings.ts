import type { Translator } from "../../i18n/translator";
import { buildExerciseHelpStrings } from "../help-strings";
import { buildProofEngineStrings } from "../proof-engine-strings";

/**
 * Interface text for the tree-proof widget: the shared proof-engine set, the
 * shared help-dialog frame, plus the editor's own toolbar, per-node problem
 * marker, and the usage instructions behind its `(?)`.
 *
 * The toolbar's tooltips name their shortcuts (`Undo (Ctrl-Z)`) as one message
 * rather than a label plus an appended key, because a translator may well want
 * the key elsewhere in the phrase — and because the shortcut itself is not
 * translated, only its framing.
 *
 * The help text is one message per paragraph and one per key row, not a single
 * block: the client's `t()` substitutes but does not format, so a table has to
 * be assembled from parts anyway — and a translator who receives each row beside
 * the key it explains cannot leave the two disagreeing, which the one long
 * sentence this replaced made easy.
 */
export function buildAufbauProofTreeStrings(i18n: Translator) {
  return {
    ...buildProofEngineStrings(i18n),
    ...buildExerciseHelpStrings(i18n),
    /** Help: what `p` does. */
    "Add a hypothesis above the line": i18n.t(
      "Add a hypothesis above the line",
    ),
    /** Help: what `h` does. */
    "Add a premise above the line": i18n.t("Add a premise above the line"),
    "Add hypothesis": i18n.t("Add hypothesis"),
    "Add premise": i18n.t("Add premise"),
    Delete: i18n.t(
      "Delete (proof line)",
      {},
      {
        comment:
          "Disambiguating id; only the word Delete is shown. Removes one line of the proof tree.",
        message: "Delete",
      },
    ),
    /** Help: what Delete does. */
    "Delete the line and everything above it": i18n.t(
      "Delete the line and everything above it",
    ),
    /** Help: what Enter does. */
    "Edit the line's formula": i18n.t("Edit the line's formula"),
    /** Help: what `r` does. */
    "Edit the line's rule": i18n.t("Edit the line's rule"),
    /** Help: what Esc does. */
    "Leave the field and go back to the line": i18n.t(
      "Leave the field and go back to the line",
    ),
    /** Help: what the arrow keys do. */
    "Move between lines": i18n.t("Move between lines"),
    /** Help: what `?` does. */
    "Open this help": i18n.t("Open this help"),
    /** Fallback on a node whose compiler diagnostic has no readable message. */
    "Problem here.": i18n.t("Problem here."),
    /**
     * Accessible name of the tree itself. The canvas is a `role="tree"`, and a
     * tree with no name tells a reader nothing about what it holds.
     */
    "Proof tree": i18n.t("Proof tree"),
    Redo: i18n.t("Redo"),
    "Redo (Ctrl-Y)": i18n.t("Redo (Ctrl-Y)"),
    /** Help: the third orientation paragraph. */
    "The mark beside the Submit button shows whether the proof checks; hover it to read the problem.":
      i18n.t(
        "The mark beside the Submit button shows whether the proof checks; hover it to read the problem.",
      ),
    /** Help: the first orientation paragraph. */
    "The goal sits at the bottom. Click any line to select it, then Add premise to grow the proof upward.":
      i18n.t(
        "The goal sits at the bottom. Click any line to select it, then Add premise to grow the proof upward.",
      ),
    /** Help: the second orientation paragraph. */
    "Type the rule that justifies each inference in the field beneath its line. Add hypothesis makes a leaf that discharges against a rule below it.":
      i18n.t(
        "Type the rule that justifies each inference in the field beneath its line. Add hypothesis makes a leaf that discharges against a rule below it.",
      ),
    Undo: i18n.t("Undo"),
    "Undo (Ctrl-Z)": i18n.t("Undo (Ctrl-Z)"),
    /** Help: the dialog's heading, and its accessible name. */
    "Using the proof tree editor": i18n.t("Using the proof tree editor"),
  };
}

export type AufbauProofTreeStringId = keyof ReturnType<
  typeof buildAufbauProofTreeStrings
>;
