import { placeholders, type Translator } from "../../i18n/translator";

/**
 * Every string the model widget can show, in the viewer's language.
 *
 * One list for both sides of the boundary: the interactive element reads these
 * out of its hydration payload (see `ExerciseHydration.strings`), and the
 * server-rendered review view reads the same map directly, so a student who
 * pressed Check before submitting reads back the identical verdict.
 *
 * Keys are the English source text, which is what the client falls back to. The
 * literals must sit at the `i18n.t(...)` call sites: Lingui's extractor reads
 * string literals passed to a receiver *named* `i18n`, so hoisting one into a
 * constant would drop it from the catalog silently. A `{slot}` a browser will
 * fill needs `placeholders(...)` to survive this call.
 *
 * Dependency-free apart from the {@link Translator} type, because
 * `read-only-view.ts` reaches this module and is compiled into the browser
 * preview bundle.
 */
export function buildModelStrings(i18n: Translator) {
  return {
    "A domain may have at most {max} elements.": i18n.t(
      "A domain may have at most {max} elements.",
      placeholders("max"),
    ),
    Check: i18n.t("Check"),
    /** The heading over a function symbol's generated value table. */
    "Choose a value for every argument.": i18n.t(
      "Choose a value for every argument.",
    ),
    "Could not read the value of {field}.": i18n.t(
      "Could not read the value of {field}.",
      placeholders("field"),
    ),
    Domain: i18n.t("Domain"),
    // Carnap's `equiv` failure, which is a property of the set rather than of
    // any one formula, so no formulas are named.
    "Every formula has the same truth value in this model, so it is not a counterexample to equivalence.":
      i18n.t(
        "Every formula has the same truth value in this model, so it is not a counterexample to equivalence.",
      ),
    False: i18n.t("False"),
    // Reachable only through authored givens: a student's value table has a row
    // per argument tuple, so it cannot leave one out or fill one twice.
    "In this model {field} has more than one value for {argument}.": i18n.t(
      "In this model {field} has more than one value for {argument}.",
      placeholders("argument", "field"),
    ),
    "In this model {field} has no value for {argument}.": i18n.t(
      "In this model {field} has no value for {argument}.",
      placeholders("argument", "field"),
    ),
    // The four "take another look" sentences, which are Carnap's own. Which
    // nouns appear depends on the variant: a validity exercise talks about
    // premises and conclusions, the others about formulas and constraints.
    "Not all conclusions are false in this model. Take another look at: {formulas}.":
      i18n.t(
        "Not all conclusions are false in this model. Take another look at: {formulas}.",
        placeholders("formulas"),
      ),
    "Not all conclusions are true in this model. Take another look at: {formulas}.":
      i18n.t(
        "Not all conclusions are true in this model. Take another look at: {formulas}.",
        placeholders("formulas"),
      ),
    "Not all formulas are false in this model. Take another look at: {formulas}.":
      i18n.t(
        "Not all formulas are false in this model. Take another look at: {formulas}.",
        placeholders("formulas"),
      ),
    "Not all formulas are true in this model. Take another look at: {formulas}.":
      i18n.t(
        "Not all formulas are true in this model. Take another look at: {formulas}.",
        placeholders("formulas"),
      ),
    "Not all of this problem's constraints hold in this model. Take another look at: {formulas}.":
      i18n.t(
        "Not all of this problem's constraints hold in this model. Take another look at: {formulas}.",
        placeholders("formulas"),
      ),
    "Not all premises are true in this model. Take another look at: {formulas}.":
      i18n.t(
        "Not all premises are true in this model. Take another look at: {formulas}.",
        placeholders("formulas"),
      ),
    // The accessible name of the `⚠` a field grows while its contents will not
    // read. The glyph alone is not a name.
    "This value cannot be read.": i18n.t("This value cannot be read."),
    "This domain gives {field} too many arguments to fill in.": i18n.t(
      "This domain gives {field} too many arguments to fill in.",
      placeholders("field"),
    ),
    // Carnap says only "Success!"; saying what succeeded is worth the words,
    // because a model exercise has many right answers and a student may not be
    // sure which property theirs turned out to have.
    "This model does everything the exercise asks.": i18n.t(
      "This model does everything the exercise asks.",
    ),
    "The domain cannot be empty.": i18n.t("The domain cannot be empty."),
    "The domain must be a comma-separated list of numbers.": i18n.t(
      "The domain must be a comma-separated list of numbers.",
    ),
    "The extension of {field} is not contained in the domain.": i18n.t(
      "The extension of {field} is not contained in the domain.",
      placeholders("field"),
    ),
    True: i18n.t("True"),
    // One field's accessible name. `F(_,_)` on its own says nothing about what
    // to type into it, and the blanks are not read aloud usefully.
    "{field}: the tuples in its extension": i18n.t(
      "{field}: the tuples in its extension",
      placeholders("field"),
    ),
    "{field}: which element it names": i18n.t(
      "{field}: which element it names",
      placeholders("field"),
    ),
    "{field}: its truth value": i18n.t(
      "{field}: its truth value",
      placeholders("field"),
    ),
    "{field} of {argument}": i18n.t(
      "{field} of {argument}",
      placeholders("argument", "field"),
    ),
  };
}

/** Every string id the model widget may ask for. */
export type ModelStringId = keyof ReturnType<typeof buildModelStrings>;

/**
 * A lookup with an English fallback — `t()` on the element, and the strings map
 * itself on the server. Passing this rather than a {@link Translator} is what
 * keeps the verdict wording usable from the browser, where no i18n runtime and
 * no catalog ship.
 */
export type ModelStrings = (
  id: ModelStringId,
  values?: Readonly<Record<string, string>>,
) => string;
