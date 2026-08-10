import { placeholders, type Translator } from "../../i18n/translator";
import { buildExerciseHelpStrings } from "../help-strings";
import { buildProofEngineStrings } from "../proof-engine-strings";

/**
 * Interface text for the Prawitz-proof widget: the shared proof-engine set, the
 * shared help-dialog frame, plus the forest workspace's own toolbar, field
 * names, the translator's structural diagnostics, and the usage instructions
 * behind its `(?)`.
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
 * paragraph this replaced made easy.
 */
export function buildAufbauProofPrawitzStrings(i18n: Translator) {
  return {
    ...buildProofEngineStrings(i18n),
    ...buildExerciseHelpStrings(i18n),
    "Add assumption above": i18n.t("Add assumption above"),
    "Add assumption above (h)": i18n.t("Add assumption above (h)"),
    "Add premise above": i18n.t("Add premise above"),
    "Add premise above (p)": i18n.t("Add premise above (p)"),
    /** The primary top-down gesture: selected roots become the premises. */
    "Apply rule below": i18n.t("Apply rule below"),
    "Apply rule below (b)": i18n.t("Apply rule below (b)"),
    /** Structural diagnostic: `assumption_with_premises`. */
    "An assumption can't have premises.": i18n.t(
      "An assumption can't have premises.",
    ),
    Delete: i18n.t(
      "Delete (proof line)",
      {},
      {
        comment:
          "Disambiguating id; only the word Delete is shown. Removes one node of the proof.",
        message: "Delete",
      },
    ),
    /** Tooltip naming the Delete button's key, like `Undo (Ctrl-Z)`. */
    "Delete (Del)": i18n.t("Delete (Del)"),
    /** Accessible name of an assumption leaf's label field (`[A]¹`). */
    "Discharge label": i18n.t("Discharge label"),
    /** Accessible name of a rule node's discharged-labels field. */
    "Discharged labels": i18n.t("Discharged labels"),
    /** Accessible name of a line's formula field. */
    Formula: i18n.t(
      "Formula (proof line)",
      {},
      {
        comment:
          "Disambiguating id; only the word Formula is shown. Names a proof line's formula text field.",
        message: "Formula",
      },
    ),
    "New assumption": i18n.t("New assumption"),
    "New assumption (a)": i18n.t("New assumption (a)"),
    /** Fallback on a node whose compiler diagnostic has no readable message. */
    "Problem here.": i18n.t("Problem here."),
    /** Accessible name of the workspace; it is a `role="tree"` and needs one. */
    "Prawitz proof workspace": i18n.t("Prawitz proof workspace"),
    /** The Select chip once ticked: this tree's position in the premise order.
     *  The placeholder has to survive this call for the browser to fill it. */
    "Premise {order}": i18n.t("Premise {order}", placeholders("order"), {
      comment:
        "Chip under a selected proof tree; {order} is its 1-based position in the premise order.",
    }),
    Redo: i18n.t("Redo"),
    "Redo (Ctrl-Y)": i18n.t("Redo (Ctrl-Y)"),
    /** Accessible name of a derived line's rule field. */
    Rule: i18n.t(
      "Rule (proof line)",
      {},
      {
        comment:
          "Disambiguating id; only the word Rule is shown. Names a proof line's inference-rule text field.",
        message: "Rule",
      },
    ),
    Select: i18n.t(
      "Select (proof tree)",
      {},
      {
        comment:
          "Disambiguating id; only the word Select is shown. Chip that adds a proof tree to the premise selection.",
        message: "Select",
      },
    ),
    /** Help: the first orientation paragraph. */
    "Every proof starts from assumptions. New assumption puts one in the workspace; the goal is a single tree whose bottom line is what you were asked to prove.":
      i18n.t(
        "Every proof starts from assumptions. New assumption puts one in the workspace; the goal is a single tree whose bottom line is what you were asked to prove.",
      ),
    /** Help: the second orientation paragraph — the workspace's core gesture. */
    "To apply a rule, tick the dot under each premise in the order the rule takes them, then Apply rule below. The ticked trees become the premises of one new line.":
      i18n.t(
        "To apply a rule, tick the dot under each premise in the order the rule takes them, then Apply rule below. The ticked trees become the premises of one new line.",
      ),
    /** Help: the third orientation paragraph — discharge. */
    "To discharge an assumption, give it a label and write the same label on the rule that discharges it. Both boxes appear on a line once it is selected.":
      i18n.t(
        "To discharge an assumption, give it a label and write the same label on the rule that discharges it. Both boxes appear on a line once it is selected.",
      ),
    /** Help: one per key row, in the order the table lists them. */
    "Move between lines, leaving the ticks alone": i18n.t(
      "Move between lines, leaving the ticks alone",
    ),
    "Tick or untick the line": i18n.t("Tick or untick the line"),
    "Edit the line's formula": i18n.t("Edit the line's formula"),
    "Edit the line's rule": i18n.t("Edit the line's rule"),
    "Edit the assumption's label": i18n.t("Edit the assumption's label"),
    "Edit the rule's discharge marks": i18n.t(
      "Edit the rule's discharge marks",
    ),
    "Leave the field and go back to the line": i18n.t(
      "Leave the field and go back to the line",
    ),
    "Delete the line and everything above it": i18n.t(
      "Delete the line and everything above it",
    ),
    "Open this help": i18n.t("Open this help"),
    /** Structural diagnostic: `discharge_formula_mismatch`. */
    "The assumptions discharged together here must share one formula.":
      i18n.t(
        "The assumptions discharged together here must share one formula.",
      ),
    /** Structural diagnostic: `discharge_without_leaf`. */
    "This discharge mark doesn't match any assumption above it.": i18n.t(
      "This discharge mark doesn't match any assumption above it.",
    ),
    Undo: i18n.t("Undo"),
    "Undo (Ctrl-Z)": i18n.t("Undo (Ctrl-Z)"),
    /** Help: the dialog's heading, and its accessible name. */
    "Using the Prawitz proof editor": i18n.t(
      "Using the Prawitz proof editor",
    ),
  };
}

export type AufbauProofPrawitzStringId = keyof ReturnType<
  typeof buildAufbauProofPrawitzStrings
>;
