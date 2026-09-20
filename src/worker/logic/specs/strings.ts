/**
 * The formula parser's own sentences, for a widget that shows them to whoever
 * is typing.
 *
 * `logic/specs/diagnostics.ts` turns a `@aufbau/syntax` failure into an English
 * template plus its values; this is where those templates are declared to
 * Lingui so a browser can word one in the viewer's language. The two files are
 * one idea in two halves, and `tsc` holds them together: `SpecFormulaError`
 * types its message as {@link FormulaParserStringId}, so a sentence the wording
 * layer can produce and this builder does not declare will not compile. It
 * would otherwise have reached a student as untranslated English, which is the
 * one failure a string map cannot report.
 *
 * **One list for every type whose formulas a *student* types.** The authoring
 * compiler has its own copy in `application/content/diagnostic-strings.ts`,
 * which is right: those sentences are shown to an author in the revision
 * editor, alongside the compiler's own complaints, and the editor ships a
 * catalog. In the browser no catalog ships, so each widget carries the strings
 * it can say inside its hydration payload — and the translation exercise, the
 * three shaped proof types, and whatever comes next must all carry the *same*
 * ones.
 *
 * The literals sit at the `i18n.t(...)` call sites on purpose: Lingui's
 * extractor reads string literals passed to a receiver named `i18n`, so
 * hoisting one into a constant would drop it from the catalog with no warning.
 */

import { placeholders, type Translator } from "../../i18n/translator";

export function buildFormulaParserStrings(i18n: Translator) {
  return {
    "Expected a formula but found “{token}”.": i18n.t(
      "Expected a formula but found “{token}”.",
      placeholders("token"),
    ),
    "Expected a formula.": i18n.t("Expected a formula."),
    "Expected a variable after the quantifier.": i18n.t(
      "Expected a variable after the quantifier.",
    ),
    "Expected “{bracket}”.": i18n.t(
      "Expected “{bracket}”.",
      placeholders("bracket"),
    ),
    "Parentheses may only enclose a sentence joined by a two-place connective.":
      i18n.t(
        "Parentheses may only enclose a sentence joined by a two-place connective.",
      ),
    "This formula could not be read.": i18n.t(
      "This formula could not be read.",
    ),
    "This is a {actual} where a {expected} is needed.": i18n.t(
      "This is a {actual} where a {expected} is needed.",
      placeholders("actual", "expected"),
    ),
    "This is a {kind}, not a complete sentence.": i18n.t(
      "This is a {kind}, not a complete sentence.",
      placeholders("kind"),
    ),
    "Unexpected “{token}”.": i18n.t(
      "Unexpected “{token}”.",
      placeholders("token"),
    ),
    "“{construct}” is not something this exercise type can interpret.":
      i18n.t(
        "“{construct}” is not something this exercise type can interpret.",
        placeholders("construct"),
      ),
    "“{chunk}” is not part of this language.": i18n.t(
      "“{chunk}” is not part of this language.",
      placeholders("chunk"),
    ),
    "“{name}” is a free variable; every formula must be a sentence.": i18n.t(
      "“{name}” is a free variable; every formula must be a sentence.",
      placeholders("name"),
    ),
    "“{operator}” cannot be chained; add parentheses to group it.": i18n.t(
      "“{operator}” cannot be chained; add parentheses to group it.",
      placeholders("operator"),
    ),
    "“{inner}” and “{outer}” cannot be combined without parentheses.": i18n.t(
      "“{inner}” and “{outer}” cannot be combined without parentheses.",
      placeholders("inner", "outer"),
    ),
    "“{inner}” needs parentheses inside “{outer}”.": i18n.t(
      "“{inner}” needs parentheses inside “{outer}”.",
      placeholders("inner", "outer"),
    ),
    "“{token}” binds too loosely here; parenthesize it.": i18n.t(
      "“{token}” binds too loosely here; parenthesize it.",
      placeholders("token"),
    ),
  };
}

export type FormulaParserStringId = keyof ReturnType<
  typeof buildFormulaParserStrings
>;
