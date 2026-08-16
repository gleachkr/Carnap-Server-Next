import { placeholders, type Translator } from "../../i18n/translator";

/**
 * Every string the translation widget can show, in the viewer's language.
 *
 * One list for both sides of the boundary: the interactive element reads these
 * out of its hydration payload (see `ExerciseHydration.strings`), and the
 * server-rendered review wording reads the same map, so Check and the review
 * page speak identically.
 *
 * Keys are the English source text, which is what the client falls back to.
 * The literals must sit at the `i18n.t(...)` call sites: Lingui's extractor
 * reads string literals passed to a receiver *named* `i18n`, so hoisting one
 * into a constant would drop it from the catalog silently. A `{slot}` a
 * browser will fill needs `placeholders(...)` to survive this call.
 *
 * The first block is the shared formula parser's own sentences — here rather
 * than only in `diagnostic-strings.ts` because in this type the person typing
 * formulas is the *student*, in the browser, where no catalog ships.
 */
export function buildTranslationStrings(i18n: Translator) {
  return {
    // ——— The parser's sentences, verbatim from
    // `exercises/first-order/formula.ts`, so `t(error.message, params)` on the
    // element resolves every complaint it can raise.
    "Expected a formula.": i18n.t("Expected a formula."),
    "Expected a formula but found “{token}”.": i18n.t(
      "Expected a formula but found “{token}”.",
      placeholders("token"),
    ),
    "Expected a term but found “{token}”.": i18n.t(
      "Expected a term but found “{token}”.",
      placeholders("token"),
    ),
    "Expected a variable after the quantifier.": i18n.t(
      "Expected a variable after the quantifier.",
    ),
    "Expected “{bracket}”.": i18n.t(
      "Expected “{bracket}”.",
      placeholders("bracket"),
    ),
    "Expected “{operator}” after this term.": i18n.t(
      "Expected “{operator}” after this term.",
      placeholders("operator"),
    ),
    "Parentheses may only enclose a sentence joined by a two-place connective.":
      i18n.t(
        "Parentheses may only enclose a sentence joined by a two-place connective.",
      ),
    "Unexpected character “{character}”.": i18n.t(
      "Unexpected character “{character}”.",
      placeholders("character"),
    ),
    "Unexpected “{token}”.": i18n.t(
      "Unexpected “{token}”.",
      placeholders("token"),
    ),
    "“{name}” is a free variable; every formula must be a sentence.": i18n.t(
      "“{name}” is a free variable; every formula must be a sentence.",
      placeholders("name"),
    ),
    "“{operator}” cannot be chained; add parentheses to group it.": i18n.t(
      "“{operator}” cannot be chained; add parentheses to group it.",
      placeholders("operator"),
    ),

    // ——— The widget's own chrome.
    Check: i18n.t("Check"),
    // The live rendering under the input: what the student's ASCII parses as,
    // in logical symbols. Naming the relation ("reads as") rather than just
    // printing the formula keeps two near-identical strings apart for a
    // screen reader.
    "Reads as {formula}": i18n.t(
      "Reads as {formula}",
      placeholders("formula"),
    ),
    "Your translation": i18n.t("Your translation"),

    // ——— Verdicts. The equivalence pair and the exact pair are worded apart
    // because they answer different questions: one "does it say the same
    // thing", the other "is it the very formula".
    "This translation is logically equivalent to the intended answer.":
      i18n.t(
        "This translation is logically equivalent to the intended answer.",
      ),
    "This translation is not equivalent to the intended answer.": i18n.t(
      "This translation is not equivalent to the intended answer.",
    ),
    "This matches the intended answer.": i18n.t(
      "This matches the intended answer.",
    ),
    "This does not exactly match the intended answer.": i18n.t(
      "This does not exactly match the intended answer.",
    ),
    // A prop exercise answered in first-order clothing. Worded about the
    // submission, not the parse: the formula is well-formed, just not in this
    // exercise's language.
    "This exercise wants a propositional sentence: sentence letters and connectives only.":
      i18n.t(
        "This exercise wants a propositional sentence: sentence letters and connectives only.",
      ),

    // ——— The `tests=` sentences, Carnap's own for the normal forms and one
    // per counted feature (a translated language orders "you have N X" its
    // own way per noun, so the noun cannot be a slot).
    "This submission is not in Conjunctive Normal Form.": i18n.t(
      "This submission is not in Conjunctive Normal Form.",
    ),
    "This submission is not in Disjunctive Normal Form.": i18n.t(
      "This submission is not in Disjunctive Normal Form.",
    ),
    "This submission is not in Prenex Normal Form.": i18n.t(
      "This submission is not in Prenex Normal Form.",
    ),
    "You have {count} atomic sentences, but should have {max} at most.":
      i18n.t(
        "You have {count} atomic sentences, but should have {max} at most.",
        placeholders("count", "max"),
      ),
    "You have {count} biconditionals, but should have {max} at most.": i18n.t(
      "You have {count} biconditionals, but should have {max} at most.",
      placeholders("count", "max"),
    ),
    "You have {count} conditionals, but should have {max} at most.": i18n.t(
      "You have {count} conditionals, but should have {max} at most.",
      placeholders("count", "max"),
    ),
    "You have {count} conjunctions, but should have {max} at most.": i18n.t(
      "You have {count} conjunctions, but should have {max} at most.",
      placeholders("count", "max"),
    ),
    "You have {count} connectives, but should have {max} at most.": i18n.t(
      "You have {count} connectives, but should have {max} at most.",
      placeholders("count", "max"),
    ),
    "You have {count} disjunctions, but should have {max} at most.": i18n.t(
      "You have {count} disjunctions, but should have {max} at most.",
      placeholders("count", "max"),
    ),
    "You have {count} falsity constants, but should have {max} at most.":
      i18n.t(
        "You have {count} falsity constants, but should have {max} at most.",
        placeholders("count", "max"),
      ),
    "You have {count} negations, but should have {max} at most.": i18n.t(
      "You have {count} negations, but should have {max} at most.",
      placeholders("count", "max"),
    ),

    // ——— Failure modes of the machinery, not of the answer.
    "The equivalence checker could not load. Your work is safe; check again in a moment.":
      i18n.t(
        "The equivalence checker could not load. Your work is safe; check again in a moment.",
      ),
    // The `checksyntax` gate: why the submit button refused.
    "This answer does not parse, so it cannot be submitted on an exam.":
      i18n.t(
        "This answer does not parse, so it cannot be submitted on an exam.",
      ),
  };
}

/** Every string id the translation widget may ask for. */
export type TranslationStringId = keyof ReturnType<
  typeof buildTranslationStrings
>;

/**
 * A lookup with an English fallback — `t()` on the element, and the strings
 * map itself on the server. Passing this rather than a {@link Translator} is
 * what keeps the wording usable from the browser, where no i18n runtime and
 * no catalog ship.
 */
export type TranslationStrings = (
  id: TranslationStringId,
  values?: Readonly<Record<string, string>>,
) => string;
