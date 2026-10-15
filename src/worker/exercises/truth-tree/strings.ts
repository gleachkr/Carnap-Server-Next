import { buildCopySourceStrings } from "../../exercise-kit/copy-source-strings";
import { buildExerciseHelpStrings } from "../../exercise-kit/help-strings";
import { buildProofEngineStrings } from "../../exercise-kit/proof/engine-strings";
import { placeholders, type Translator } from "../../i18n/translator";
import { buildFormulaParserStrings } from "../../logic/specs/strings";

/**
 * Every string the truth-tree widget can show, in the viewer's language: its
 * chrome, what is wrong with a row or a branch, the verdicts, and what each
 * edit announces.
 *
 * One list for both sides of the boundary. The element reads these out of its
 * hydration payload, and the server-rendered review reads the same map, so a
 * student who pressed Check before submitting reads back the identical
 * verdict. Keys are the English source text; the literals sit at the
 * `i18n.t(...)` call sites because Lingui's extractor reads only literals
 * passed to a receiver named `i18n`, and a slot the browser fills needs
 * `placeholders(...)` to survive the call.
 *
 * Dependency-free apart from the {@link Translator} type and the parser's own
 * sentences, because `read-only-view.ts` reaches this module and is compiled
 * into the browser preview bundle.
 */
export function buildTruthTreeStrings(i18n: Translator) {
  return {
    // ——— The parser's sentences: a student types every row.
    ...buildFormulaParserStrings(i18n),
    ...buildExerciseHelpStrings(i18n),
    ...buildCopySourceStrings(i18n),
    // The engine's, since the tree is compiled as a proof is (gh #46).
    ...buildProofEngineStrings(i18n),

    // ——— Chrome.
    "Truth tree": i18n.t("Truth tree"),
    Check: i18n.t("Check"),
    Stack: i18n.t("Stack"),
    Split: i18n.t(
      "Split (truth-tree rows)",
      {},
      {
        comment:
          "Disambiguating id; only the word Split is shown. Beside Stack: the step's rows branch the tree rather than extend the branch. Not the editor's split view.",
        message: "Split",
      },
    ),
    "Add row": i18n.t("Add row"),
    Close: i18n.t("Close"),
    "Mark open": i18n.t("Mark open"),
    Delete: i18n.t("Delete"),
    Undo: i18n.t("Undo"),
    Redo: i18n.t("Redo"),
    "Cites row": i18n.t("Cites row"),
    "Rule used": i18n.t("Rule used"),
    "Mark the rows that close this branch": i18n.t(
      "Mark the rows that close this branch",
    ),
    "Row {row} marked.": i18n.t("Row {row} marked.", placeholders("row")),
    "Close the branch on row {row}": i18n.t(
      "Close the branch on row {row}",
      placeholders("row"),
    ),
    "Row {row} unmarked.": i18n.t("Row {row} unmarked.", placeholders("row")),
    "Closing put away.": i18n.t("Closing put away."),
    Cancel: i18n.t("Cancel"),
    "Row {row}: {text}": i18n.t(
      "Row {row}: {text}",
      placeholders("row", "text"),
    ),
    "Row {row}: {text}, from rows {cited} and {other}, {rule}": i18n.t(
      "Row {row}: {text}, from rows {cited} and {other}, {rule}",
      placeholders("cited", "other", "row", "rule", "text"),
    ),
    "Row {row}: {text}, from row {cited}, {rule}": i18n.t(
      "Row {row}: {text}, from row {cited}, {rule}",
      placeholders("cited", "row", "rule", "text"),
    ),
    "Row {row}: {text}, from rows {cited} and {other}, no rule named": i18n.t(
      "Row {row}: {text}, from rows {cited} and {other}, no rule named",
      placeholders("cited", "other", "row", "text"),
    ),
    "Row {row}: {text}, from row {cited}, no rule named": i18n.t(
      "Row {row}: {text}, from row {cited}, no rule named",
      placeholders("cited", "row", "text"),
    ),
    "Row {row}: {text}, not yet cited": i18n.t(
      "Row {row}: {text}, not yet cited",
      placeholders("row", "text"),
    ),
    "Empty row": i18n.t("Empty row"),
    "Branch {position} of {count}": i18n.t(
      "Branch {position} of {count}",
      placeholders("count", "position"),
    ),
    "Branch closed on rows {first} and {second}": i18n.t(
      "Branch closed on rows {first} and {second}",
      placeholders("first", "second"),
    ),
    "Branch closed on row {row}": i18n.t(
      "Branch closed on row {row}",
      placeholders("row"),
    ),
    "Branch closed": i18n.t("Branch closed"),
    "Branch marked open and complete": i18n.t(
      "Branch marked open and complete",
    ),

    "Tree actions": i18n.t("Tree actions"),
    "Sentence on row {row}": i18n.t(
      "Sentence on row {row}",
      placeholders("row"),
    ),
    "Citation of row {row}, not yet written": i18n.t(
      "Citation of row {row}, not yet written",
      placeholders("row"),
    ),
    "Citation of row {row}: {cites}": i18n.t(
      "Citation of row {row}: {cites}",
      placeholders("cites", "row"),
    ),
    "Rule of row {row}, not yet named": i18n.t(
      "Rule of row {row}, not yet named",
      placeholders("row"),
    ),
    "Rule of row {row}: {rule}": i18n.t(
      "Rule of row {row}: {rule}",
      placeholders("row", "rule"),
    ),

    // ——— What an edit announces, and why one was refused.
    "New row {row}.": i18n.t("New row {row}.", placeholders("row")),
    "Split below row {row}: two new branches.": i18n.t(
      "Split below row {row}: two new branches.",
      placeholders("row"),
    ),
    "Branch reopened.": i18n.t("Branch reopened."),
    "Row deleted.": i18n.t("Row deleted."),
    "Split taken back.": i18n.t("Split taken back."),
    "Undone.": i18n.t("Undone."),
    "Redone.": i18n.t("Redone."),
    "Row {row} now cites row {cited}.": i18n.t(
      "Row {row} now cites row {cited}.",
      placeholders("cited", "row"),
    ),
    "Row {row} now cites rows {cited} and {other}.": i18n.t(
      "Row {row} now cites rows {cited} and {other}.",
      placeholders("cited", "other", "row"),
    ),
    "Row {row} no longer cites a row.": i18n.t(
      "Row {row} no longer cites a row.",
      placeholders("row"),
    ),
    "Row {row} now names the rule {rule}.": i18n.t(
      "Row {row} now names the rule {rule}.",
      placeholders("row", "rule"),
    ),
    "Row {row} no longer names a rule.": i18n.t(
      "Row {row} no longer names a rule.",
      placeholders("row"),
    ),
    "Move to the end of a branch first.": i18n.t(
      "Move to the end of a branch first.",
    ),
    "This branch is already ended. Reopen it to add to it.": i18n.t(
      "This branch is already ended. Reopen it to add to it.",
    ),
    "The root's rows are given, and cannot be changed.": i18n.t(
      "The root's rows are given, and cannot be changed.",
    ),
    "Type row numbers, such as 3.": i18n.t("Type row numbers, such as 3."),
    "Name the rule this step uses: type it in the margin, after the row it develops.":
      i18n.t(
        "Name the rule this step uses: type it in the margin, after the row it develops.",
      ),
    "The rule named does not give this from row {cited}.": i18n.t(
      "The rule named does not give this from row {cited}.",
      placeholders("cited"),
    ),
    "The rule named does not give this from rows {cited} and {other}.":
      i18n.t(
        "The rule named does not give this from rows {cited} and {other}.",
        placeholders("cited", "other"),
      ),
    "The rows this closure cites do not close the branch.": i18n.t(
      "The rows this closure cites do not close the branch.",
    ),
    "This exercise asks for every branch to close.": i18n.t(
      "This exercise asks for every branch to close.",
    ),
    "This system cannot say whether an open branch is complete.": i18n.t(
      "This system cannot say whether an open branch is complete.",
    ),
    "A step or a closure in the tree does not check.": i18n.t(
      "A step or a closure in the tree does not check.",
    ),
    "The tree is not finished: close every branch.": i18n.t(
      "The tree is not finished: close every branch.",
    ),
    "This system has no rule called “{rule}”.": i18n.t(
      "This system has no rule called “{rule}”.",
      placeholders("rule"),
    ),

    // ——— The (?) dialog.
    "Using the tree editor": i18n.t("Using the tree editor"),
    "Move to a row with the arrow keys or by clicking it; each action works on the row or branch there.":
      i18n.t(
        "Move to a row with the arrow keys or by clicking it; each action works on the row or branch there.",
      ),
    "Write each step's rows, choosing whether they stack on the branch or split it, and type the row they develop and the rule they use in the margin.":
      i18n.t(
        "Write each step's rows, choosing whether they stack on the branch or split it, and type the row they develop and the rule they use in the margin.",
      ),
    "Close a branch on a sentence and its negation, citing both rows. The tree is done when every branch is closed.":
      i18n.t(
        "Close a branch on a sentence and its negation, citing both rows. The tree is done when every branch is closed.",
      ),
    "Close a branch on a sentence and its negation, citing both rows, and mark each complete open branch ↑. The tree is done when every branch is closed or marked open.":
      i18n.t(
        "Close a branch on a sentence and its negation, citing both rows, and mark each complete open branch ↑. The tree is done when every branch is closed or marked open.",
      ),
    "Close a branch on a sentence and its negation, citing both rows, and mark a complete open branch ↑. The tree is done when every branch is closed, or one is marked open.":
      i18n.t(
        "Close a branch on a sentence and its negation, citing both rows, and mark a complete open branch ↑. The tree is done when every branch is closed, or one is marked open.",
      ),
    "Move between rows": i18n.t("Move between rows"),
    "Write the row's sentence": i18n.t("Write the row's sentence"),
    "Type the row it develops; Alt-C also works while writing the row":
      i18n.t(
        "Type the row it develops; Alt-C also works while writing the row",
      ),
    "Type the rule it uses; Alt-J also works while writing the row": i18n.t(
      "Type the rule it uses; Alt-J also works while writing the row",
    ),
    "From the end of a line, go on to its citation, then its rule; Delete clears either":
      i18n.t(
        "From the end of a line, go on to its citation, then its rule; Delete clears either",
      ),
    "From the citation being typed, go on to the rule": i18n.t(
      "From the citation being typed, go on to the rule",
    ),
    "Add a row at the end of the branch": i18n.t(
      "Add a row at the end of the branch",
    ),
    "Split the branch in two": i18n.t("Split the branch in two"),
    "Add a row to this step": i18n.t("Add a row to this step"),
    "Close the branch": i18n.t("Close the branch"),
    "Mark a row the branch closes on, once closing": i18n.t(
      "Mark a row the branch closes on, once closing",
    ),
    "Mark the branch open and complete": i18n.t(
      "Mark the branch open and complete",
    ),
    "Delete the row or take back its split; on an end mark, reopen the branch":
      i18n.t(
        "Delete the row or take back its split; on an end mark, reopen the branch",
      ),
    "Undo or redo": i18n.t("Undo or redo"),

    // ——— What is wrong with a row. Each is said of the row it is on.
    "This row is empty: write a sentence on it, or delete it.": i18n.t(
      "This row is empty: write a sentence on it, or delete it.",
    ),
    "These trees have no rules for identity.": i18n.t(
      "These trees have no rules for identity.",
    ),
    "This is not the sentence the exercise gives.": i18n.t(
      "This is not the sentence the exercise gives.",
    ),
    "Say which row this row comes from: type that row's number in the margin.":
      i18n.t(
        "Say which row this row comes from: type that row's number in the margin.",
      ),
    "Cite just one row, the one this row comes from, or two for a substitution by an identity.":
      i18n.t(
        "Cite just one row, the one this row comes from, or two for a substitution by an identity.",
      ),
    "The rows of one step must cite the same row.": i18n.t(
      "The rows of one step must cite the same row.",
    ),
    "Row {cited} is not above this row on its branch.": i18n.t(
      "Row {cited} is not above this row on its branch.",
      placeholders("cited"),
    ),
    "Row {cited} does not read, so it cannot be developed.": i18n.t(
      "Row {cited} does not read, so it cannot be developed.",
      placeholders("cited"),
    ),
    "Row {cited} has no rule: it is atomic, or the negation of an atomic sentence.":
      i18n.t(
        "Row {cited} has no rule: it is atomic, or the negation of an atomic sentence.",
        placeholders("cited"),
      ),
    "Row {cited} is an identity: cite it together with the row it rewrites.":
      i18n.t(
        "Row {cited} is an identity: cite it together with the row it rewrites.",
        placeholders("cited"),
      ),
    "A row citing two rows substitutes by an identity, and neither row {cited} nor row {other} is one.":
      i18n.t(
        "A row citing two rows substitutes by an identity, and neither row {cited} nor row {other} is one.",
        placeholders("cited", "other"),
      ),
    "Rewriting row {into} by the identity on row {identity} does not give this sentence.":
      i18n.t(
        "Rewriting row {into} by the identity on row {identity} does not give this sentence.",
        placeholders("identity", "into"),
      ),
    "The rule for row {cited} does not write this sentence.": i18n.t(
      "The rule for row {cited} does not write this sentence.",
      placeholders("cited"),
    ),
    "The rule for row {cited} splits the branch into {branches} branches.":
      i18n.t(
        "The rule for row {cited} splits the branch into {branches} branches.",
        placeholders("branches", "cited"),
      ),
    "The rule for row {cited} does not split the branch.": i18n.t(
      "The rule for row {cited} does not split the branch.",
      placeholders("cited"),
    ),
    "This step is missing a row: the rule for row {cited} writes more.":
      i18n.t(
        "This step is missing a row: the rule for row {cited} writes more.",
        placeholders("cited"),
      ),
    "This row repeats one its step already wrote.": i18n.t(
      "This row repeats one its step already wrote.",
    ),
    "These branches are not the ones the rule for row {cited} writes.":
      i18n.t(
        "These branches are not the ones the rule for row {cited} writes.",
        placeholders("cited"),
      ),
    "This is not an instance of row {cited}.": i18n.t(
      "This is not an instance of row {cited}.",
      placeholders("cited"),
    ),
    "{name} is already on this branch, and row {cited} needs a new name.":
      i18n.t(
        "{name} is already on this branch, and row {cited} needs a new name.",
        placeholders("cited", "name"),
      ),
    "The branches of a split must all come from one step.": i18n.t(
      "The branches of a split must all come from one step.",
    ),

    // ——— What is wrong with a branch's end.
    "Cite the two rows the branch closes on.": i18n.t(
      "Cite the two rows the branch closes on.",
    ),
    "A closure cites rows on its own branch.": i18n.t(
      "A closure cites rows on its own branch.",
    ),
    "The rows a closure cites must be a sentence and its negation.": i18n.t(
      "The rows a closure cites must be a sentence and its negation.",
    ),
    "A branch closes on one row only if that row says something is not identical to itself.":
      i18n.t(
        "A branch closes on one row only if that row says something is not identical to itself.",
      ),
    "Row {row} says something is not identical to itself, so this branch closes.":
      i18n.t(
        "Row {row} says something is not identical to itself, so this branch closes.",
        placeholders("row"),
      ),
    "The identity on row {row} still needs substituting, one way or the other, into every atomic and negated atomic sentence on this branch.":
      i18n.t(
        "The identity on row {row} still needs substituting, one way or the other, into every atomic and negated atomic sentence on this branch.",
        placeholders("row"),
      ),
    "Rows {first} and {second} are a sentence and its negation, so this branch closes.":
      i18n.t(
        "Rows {first} and {second} are a sentence and its negation, so this branch closes.",
        placeholders("first", "second"),
      ),
    "Row {row} still needs developing on this branch.": i18n.t(
      "Row {row} still needs developing on this branch.",
      placeholders("row"),
    ),
    "Row {row} still needs an instance on this branch.": i18n.t(
      "Row {row} still needs an instance on this branch.",
      placeholders("row"),
    ),
    "Row {row} still needs an instance for {names} on this branch.": i18n.t(
      "Row {row} still needs an instance for {names} on this branch.",
      placeholders("names", "row"),
    ),
    "Only the end of a branch can be closed or marked open.": i18n.t(
      "Only the end of a branch can be closed or marked open.",
    ),
    "This branch has no rows.": i18n.t("This branch has no rows."),

    // ——— Where a problem is, for the Check line and the review.
    "Row {row}: {problem}": i18n.t(
      "Row {row}: {problem}",
      placeholders("problem", "row"),
    ),
    "The branch ending at row {row}: {problem}": i18n.t(
      "The branch ending at row {row}: {problem}",
      placeholders("problem", "row"),
    ),
    "The tree is missing a row of its root.": i18n.t(
      "The tree is missing a row of its root.",
    ),
    "A tree may have at most {limit} rows.": i18n.t(
      "A tree may have at most {limit} rows.",
      placeholders("limit"),
    ),

    // ——— Verdicts.
    "The tree is not finished: close every branch, or mark a complete open branch.":
      i18n.t(
        "The tree is not finished: close every branch, or mark a complete open branch.",
      ),
    "The tree is right.": i18n.t("The tree is right."),
    "The tree is not right yet.": i18n.t("The tree is not right yet."),
    "Right: the tree closes, so the argument is valid.": i18n.t(
      "Right: the tree closes, so the argument is valid.",
    ),
    "Right: a complete open branch shows the argument is invalid.": i18n.t(
      "Right: a complete open branch shows the argument is invalid.",
    ),
    "Right: a complete open branch shows the set is consistent.": i18n.t(
      "Right: a complete open branch shows the set is consistent.",
    ),
    "Right: the tree closes, so the set is inconsistent.": i18n.t(
      "Right: the tree closes, so the set is inconsistent.",
    ),
  };
}

/** Every string id the truth-tree widget may ask for. */
export type TruthTreeStringId = keyof ReturnType<
  typeof buildTruthTreeStrings
>;
