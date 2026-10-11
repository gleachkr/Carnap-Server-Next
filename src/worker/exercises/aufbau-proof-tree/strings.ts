import { buildCopySourceStrings } from "../../exercise-kit/copy-source-strings";
import { buildExerciseHelpStrings } from "../../exercise-kit/help-strings";
import { buildProofEngineStrings } from "../../exercise-kit/proof/engine-strings";
import { placeholders, type Translator } from "../../i18n/translator";
import { buildFormulaParserStrings } from "../../logic/specs/strings";

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
    // A node's formula is read in the theory's language before it reaches
    // the compiler, so the parser's complaints are the widget's to say.
    ...buildFormulaParserStrings(i18n),
    ...buildProofEngineStrings(i18n),
    ...buildExerciseHelpStrings(i18n),
    ...buildCopySourceStrings(i18n),
    /** Help: what `p` does. */
    "Add a hypothesis above the line": i18n.t(
      "Add a hypothesis above the line",
    ),
    /** Help: what `h` does. */
    "Add a premise above the line": i18n.t("Add a premise above the line"),
    "Add hypothesis": i18n.t("Add hypothesis"),
    /** Tooltip naming the button's key, like `Undo (Ctrl-Z)`. */
    "Add hypothesis (h)": i18n.t("Add hypothesis (h)"),
    "Add premise": i18n.t("Add premise"),
    /** Tooltip naming the button's key, like `Undo (Ctrl-Z)`. */
    "Add premise (p)": i18n.t("Add premise (p)"),
    Delete: i18n.t(
      "Delete (proof line)",
      {},
      {
        comment:
          "Disambiguating id; only the word Delete is shown. Removes one line of the proof tree.",
        message: "Delete",
      },
    ),
    /** Tooltip naming the Delete button's key, like `Undo (Ctrl-Z)`. */
    "Delete (Del)": i18n.t("Delete (Del)"),
    /** Accessible name of a hypothesis leaf's select, where the goal offers a
     *  choice of hypotheses to cite. */
    "Cited hypothesis": i18n.t("Cited hypothesis"),
    /** Help: what Delete does. */
    "Delete the line and everything above it": i18n.t(
      "Delete the line and everything above it",
    ),
    /** Help: what Enter does. */
    "Edit the line's formula": i18n.t("Edit the line's formula"),
    /** Accessible name of a line's formula field. */
    Formula: i18n.t(
      "Formula (proof line)",
      {},
      {
        comment:
          "Disambiguating id; only the word Formula is shown. Names the formula text field of a line in the proof tree.",
        message: "Formula",
      },
    ),
    /** Help: what F8 does. */
    "Go to the next error": i18n.t("Go to the next error"),
    /** Help: what Shift-F8 does. */
    "Go to the previous error": i18n.t("Go to the previous error"),
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
    "Error here.": i18n.t("Error here."),
    /** Problem line: which of the proof's problems it holds. Both values are numbers. */
    "{index} of {count}": i18n.t(
      "{index} of {count}",
      placeholders("index", "count"),
      {
        comment:
          "Beside an error shown below a proof: it is error {index} of the {count} errors in the proof, counted in the order F8 visits them.",
      },
    ),
    /**
     * Accessible name of the tree itself. The canvas is a `role="tree"`, and a
     * tree with no name tells a reader nothing about what it holds.
     */
    "Proof tree": i18n.t("Proof tree"),
    Redo: i18n.t("Redo"),
    "Redo (Ctrl-Y)": i18n.t("Redo (Ctrl-Y)"),
    /** Accessible name of a line's rule field. */
    Rule: i18n.t(
      "Rule (proof line)",
      {},
      {
        comment:
          "Disambiguating id; only the word Rule is shown. Names the inference-rule text field under a line in the proof tree.",
        message: "Rule",
      },
    ),
    /** Help: the third orientation paragraph. */
    "The mark beside the Submit button shows whether the proof checks. A line with an error is underlined. Hover it to read what is wrong, or press F8 to go to it: the error then stays below the proof while you fix it.":
      i18n.t(
        "The mark beside the Submit button shows whether the proof checks. A line with an error is underlined. Hover it to read what is wrong, or press F8 to go to it: the error then stays below the proof while you fix it.",
      ),
    /** Help: the first orientation paragraph. */
    "The goal sits at the bottom. Click any line to select it, then Add premise to grow the proof upward.":
      i18n.t(
        "The goal sits at the bottom. Click any line to select it, then Add premise to grow the proof upward.",
      ),
    /** On a hypothesis leaf citing past the goal's last hypothesis: a starter
     *  or restored tree whose goal changed under it. */
    "The goal has no hypothesis #{n}": i18n.t(
      "The goal has no hypothesis #{n}",
      placeholders("n"),
      {
        comment:
          "Error on a proof-tree leaf citing hypothesis number {n} of a goal that has fewer.",
      },
    ),
    /** Help: the second orientation paragraph. */
    "Type the rule that justifies each inference in the field beneath its line. Add hypothesis makes a leaf that cites one of the goal's hypotheses.":
      i18n.t(
        "Type the rule that justifies each inference in the field beneath its line. Add hypothesis makes a leaf that cites one of the goal's hypotheses.",
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
