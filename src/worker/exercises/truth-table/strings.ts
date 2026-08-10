import { placeholders, type Translator } from "../../i18n/translator";

/**
 * Every string the truth-table widget can show, in the viewer's language.
 *
 * One list for both sides of the boundary: the interactive element reads these
 * out of its hydration payload (see `ExerciseHydration.strings`), and the
 * server-rendered review view reads the same map directly. That is deliberate —
 * the answering and review paths describe the same verdicts, and when each spelt
 * them out separately they drifted ("doesn't" here, "does not" there). Sharing
 * the map makes a single catalog entry serve both, so a translator sees one
 * sentence and cannot make them disagree.
 *
 * Keys are the English source text, which is what the client falls back to. The
 * literals must sit at the `i18n.t(...)` call sites: Lingui's extractor reads
 * string literals passed to a receiver *named* `i18n`, so hoisting one into a
 * constant would drop it from the catalog silently.
 *
 * Dependency-free apart from the {@link Translator} type, because
 * `read-only-view.ts` reaches this module and is compiled into the browser
 * preview bundle.
 */
export function buildTruthTableStrings(i18n: Translator) {
  return {
    "All cells correct.": i18n.t("All cells correct."),
    // The grid's own instructions, visually hidden: the cells are a single tab
    // stop and move under the arrow keys, which a sighted reader infers from the
    // shape of the thing and a screen-reader user cannot.
    "Arrow keys move between cells. Space or Enter changes one.": i18n.t(
      "Arrow keys move between cells. Space or Enter changes one.",
    ),
    "Cancel counterexample": i18n.t("Cancel counterexample"),
    Check: i18n.t("Check"),
    "Choose a row, then fill it in.": i18n.t(
      "Choose a row, then fill it in.",
    ),
    // The count is computed in the browser, where there is no plural selector,
    // so the number stays a bare value instead of inflecting a noun — and the
    // placeholders have to survive this call for the browser to fill them.
    "Correct cells: {count} of {total}": i18n.t(
      "Correct cells: {count} of {total}",
      placeholders("count", "total"),
    ),
    // The visually-hidden verdict on one reviewed cell. Its own id, rather than
    // the bare word, because "Correct" also labels the *key* on a reviewed
    // multiple-choice option, and a language may well distinguish the two.
    Correct: i18n.t(
      "Correct (truth-table cell)",
      {},
      {
        comment:
          "Disambiguating id; only the word Correct is shown. The verdict on a single cell of a marked truth table.",
        message: "Correct",
      },
    ),
    "Find counterexample": i18n.t("Find counterexample"),
    // One cell's accessible name. Without it a cell is a button called "T" — or,
    // when `nodash` blanks the glyph, a button with no name at all — and nothing
    // says which row or column it sits in. The row number is 1-based, counting
    // the all-true row as row 1, the way the grid reads on screen. Filled in the
    // browser too, because the value changes on every click.
    "{column}, row {row}: {value}": i18n.t(
      "{column}, row {row}: {value}",
      placeholders("column", "row", "value"),
    ),
    // The same name for a `partial` table, whose one row is not any particular
    // row of the full table — picking the valuation is the exercise, so there is
    // no row number to give.
    "{column}: {value}": i18n.t(
      "{column}: {value}",
      placeholders("column", "value"),
    ),
    // The value as a word rather than the author's `trueMark`/`falseMark` glyph,
    // which may be anything — "1"/"0", ✓/✗ — and reads as nothing aloud.
    //
    // Plain ids, not disambiguated ones, because these three are the case where
    // the two rules this file lives under pull against each other: a
    // `message:`-carrying id would no longer *be* its own English text, and the
    // client's `strings[id] ?? id` fallback would put "blank (truth-table cell
    // value)" into an aria-label. The context a translator needs goes in the
    // comment instead, where it costs nothing.
    blank: i18n.t(
      "blank",
      {},
      {
        comment:
          "An unfilled truth-table cell, spoken as part of the cell's accessible name: “Q, row 3: blank”. Lowercase, mid-sentence.",
      },
    ),
    false: i18n.t(
      "false",
      {},
      {
        comment:
          "A truth-table cell's value, spoken as part of the cell's accessible name: “Q, row 3: false”. Lowercase, mid-sentence.",
      },
    ),
    true: i18n.t(
      "true",
      {},
      {
        comment:
          "A truth-table cell's value, spoken as part of the cell's accessible name: “Q, row 3: true”. Lowercase, mid-sentence.",
      },
    ),
    // The column headed `⊢` in a validity table: the one the student marks F on a
    // counterexample row and T everywhere else. Its header is a glyph, so it
    // needs a word to serve as a column name.
    Turnstile: i18n.t("Turnstile"),
    Incorrect: i18n.t(
      "Incorrect (truth-table cell)",
      {},
      {
        comment:
          "Disambiguating id; only the word Incorrect is shown. The verdict on a single cell of a marked truth table.",
        message: "Incorrect",
      },
    ),
    "Not a valid counterexample yet.": i18n.t(
      "Not a valid counterexample yet.",
    ),
    "Not a valid counterexample.": i18n.t("Not a valid counterexample."),
    "Not correct yet.": i18n.t("Not correct yet."),
    "Pick one row where every formula is false, then fill it in.": i18n.t(
      "Pick one row where every formula is false, then fill it in.",
    ),
    "Pick one row where every formula is true, then fill it in.": i18n.t(
      "Pick one row where every formula is true, then fill it in.",
    ),
    "Pick one row where every premise is true and every conclusion is true, then fill it in.":
      i18n.t(
        "Pick one row where every premise is true and every conclusion is true, then fill it in.",
      ),
    "Pick one row where every premise is true and the conclusion is false, then fill it in.":
      i18n.t(
        "Pick one row where every premise is true and the conclusion is false, then fill it in.",
      ),
    "Pick one row where every premise is true and the conclusions disagree, then fill it in.":
      i18n.t(
        "Pick one row where every premise is true and the conclusions disagree, then fill it in.",
      ),
    "Pick one row where the formulas disagree, then fill it in.": i18n.t(
      "Pick one row where the formulas disagree, then fill it in.",
    ),
    "That row is correct.": i18n.t("That row is correct."),
    "That's a valid counterexample.": i18n.t(
      "That's a valid counterexample.",
    ),
    "There's an error somewhere.": i18n.t("There's an error somewhere."),
    "This row is a counterexample, but it isn't filled in correctly.": i18n.t(
      "This row is a counterexample, but it isn't filled in correctly.",
    ),
    "This row is filled in correctly, but it doesn't satisfy the given conditions.":
      i18n.t(
        "This row is filled in correctly, but it doesn't satisfy the given conditions.",
      ),
    "This row isn't a counterexample.": i18n.t(
      "This row isn't a counterexample.",
    ),
    "This row isn't filled in correctly yet.": i18n.t(
      "This row isn't filled in correctly yet.",
    ),
    "Valid counterexample.": i18n.t("Valid counterexample."),
  };
}

export type TruthTableStrings = ReturnType<typeof buildTruthTableStrings>;

/**
 * The ids the truth-table element may pass to `t()`. Derived from the builder
 * rather than listed separately, so the client's lookups and the server's map
 * cannot drift apart.
 */
export type TruthTableStringId = keyof TruthTableStrings;
