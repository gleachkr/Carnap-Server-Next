import { placeholders, type Translator } from "../../i18n/translator";

/**
 * Every sentence the Carnap Markdown compiler can say to an author, in the
 * viewer's language.
 *
 * One module for all of them rather than one per exercise type, because unlike
 * widget text (which the server resolves per exercise and pushes into that
 * exercise's hydration payload) diagnostics all funnel into a single display —
 * the list under the revision editor — and a single union type. The compiler is
 * a leaf that the per-type `authoring.ts` files depend on, so its message ids
 * cannot be assembled by dispatch from the types that emit them.
 *
 * The mechanism is the same one the widgets use: keys are the English source
 * text, so a lookup that misses degrades to readable English, and
 * {@link DiagnosticMessageId} is derived from this map — `tsc` rejects a
 * `diagnostic(...)` whose sentence is not listed here, in either direction.
 *
 * Two conventions the compiler's messages need in particular:
 *
 * - The values are *unfilled* templates. A diagnostic knows which attribute or
 *   formula it is about only at compile time, so `placeholders(...)` keeps the
 *   `{slots}` intact through `i18n.t` for `resolveMessage` to fill later.
 * - A placeholder is quoted typographically (`“{name}”`), never with ASCII
 *   apostrophes: `'{name}'` is ICU's *escape* for a literal `{name}`, which
 *   eats the quotes and stops the brace being a placeholder at all. An
 *   apostrophe anywhere else (`':|-:'`, `'auto'`, `'.'`) is left alone by ICU
 *   and stays as the author typed it in the source it describes.
 *
 * Dependency-free apart from the {@link Translator} type: `authoring-toolkit.ts`
 * imports the id type from here, and it is compiled into the browser preview
 * bundle.
 */
export function buildDiagnosticStrings(i18n: Translator) {
  return {
    // Shared directive machinery (`authoring-toolkit.ts`).
    "Exercise IDs must be 1 to 64 characters long and contain no spaces.":
      i18n.t(
        "Exercise IDs must be 1 to 64 characters long and contain no spaces.",
      ),
    "Exercise points must be a positive number no greater than 1000.": i18n.t(
      "Exercise points must be a positive number no greater than 1000.",
    ),
    "The check and feedback attributes say the same thing; keep feedback and drop check.":
      i18n.t(
        "The check and feedback attributes say the same thing; keep feedback and drop check.",
      ),
    "The feedback attribute must be full, terse, or none.": i18n.t(
      "The feedback attribute must be full, terse, or none.",
    ),
    "The {name} attribute is required.": i18n.t(
      "The {name} attribute is required.",
      placeholders("name"),
    ),
    "The {name} attribute must be true or false.": i18n.t(
      "The {name} attribute must be true or false.",
      placeholders("name"),
    ),
    "Unknown attribute “{name}”. This directive accepts: {accepted}.": i18n.t(
      "Unknown attribute “{name}”. This directive accepts: {accepted}.",
      placeholders("accepted", "name"),
    ),

    // The document dialect itself (`compiler.ts`).
    "A theory named “{name}” is already declared.": i18n.t(
      "A theory named “{name}” is already declared.",
      placeholders("name"),
    ),
    "Directive attributes must use standard directive syntax.": i18n.t(
      "Directive attributes must use standard directive syntax.",
    ),
    "Directive {name} is not supported here.": i18n.t(
      "Directive {name} is not supported here.",
      placeholders("name"),
    ),
    "Directive {name} is not supported.": i18n.t(
      "Directive {name} is not supported.",
      placeholders("name"),
    ),
    "Exercise ID {id} is used more than once.": i18n.t(
      "Exercise ID {id} is used more than once.",
      placeholders("id"),
    ),
    "Item links must look like item:<content-item-id>.": i18n.t(
      "Item links must look like item:<content-item-id>.",
    ),
    "Raw HTML is not allowed in carnap-markdown-v1.": i18n.t(
      "Raw HTML is not allowed in carnap-markdown-v1.",
    ),
    "The style directive does not support the {attribute} attribute.": i18n.t(
      "The style directive does not support the {attribute} attribute.",
      placeholders("attribute"),
    ),
    "The style src must be an https URL or a site-relative path.": i18n.t(
      "The style src must be an https URL or a site-relative path.",
    ),
    // `{detail}` is MathJax's own complaint — "Undefined control sequence
    // \oops", "Missing open brace for superscript" — and stays English, like
    // every other message this compiler produces.
    "This formula could not be typeset: {detail}": i18n.t(
      "This formula could not be typeset: {detail}",
      placeholders("detail"),
    ),

    // Multiple choice.
    "A multiple-choice exercise requires at least two options.": i18n.t(
      "A multiple-choice exercise requires at least two options.",
    ),
    "Multiple-choice mode must be single or multiple.": i18n.t(
      "Multiple-choice mode must be single or multiple.",
    ),
    "Multiple-select exercises must have at least one correct option.":
      i18n.t(
        "Multiple-select exercises must have at least one correct option.",
      ),
    "Only option lines may appear after the first option.": i18n.t(
      "Only option lines may appear after the first option.",
    ),
    "Option ID {id} is used more than once in this exercise.": i18n.t(
      "Option ID {id} is used more than once in this exercise.",
      placeholders("id"),
    ),
    "Option IDs must start with a letter and use letters, numbers, underscores, or hyphens.":
      i18n.t(
        "Option IDs must start with a letter and use letters, numbers, underscores, or hyphens.",
      ),
    "Option labels cannot be empty.": i18n.t(
      "Option labels cannot be empty.",
    ),
    "Single-select exercises must have exactly one correct option.": i18n.t(
      "Single-select exercises must have exactly one correct option.",
    ),

    // Short answer.
    "A short-answer exercise needs at least one accepted answer.": i18n.t(
      "A short-answer exercise needs at least one accepted answer.",
    ),
    "A short-answer exercise requires answer or answers.": i18n.t(
      "A short-answer exercise requires answer or answers.",
    ),

    // Truth tables, including the formula parser they share with grading.
    "A given cell must be T, F, or '.'.": i18n.t(
      "A given cell must be T, F, or '.'.",
    ),
    "A given row needs {expected} '|'-separated segments (reference plus one per formula); found {found}.":
      i18n.t(
        "A given row needs {expected} '|'-separated segments (reference plus one per formula); found {found}.",
        placeholders("expected", "found"),
      ),
    "A truth table may use at most {max} atoms; found {found}.": i18n.t(
      "A truth table may use at most {max} atoms; found {found}.",
      placeholders("found", "max"),
    ),
    "A truth table may use at most {max} atoms; this one uses {found}.":
      i18n.t(
        "A truth table may use at most {max} atoms; this one uses {found}.",
        placeholders("found", "max"),
      ),
    "A truth-table exercise requires at least one formula.": i18n.t(
      "A truth-table exercise requires at least one formula.",
    ),
    "A validity exercise has only a given grid after its sequent line.":
      i18n.t(
        "A validity exercise has only a given grid after its sequent line.",
      ),
    "A validity exercise needs a sequent with the ':|-:' turnstile, e.g. 'P, P -> Q :|-: Q'.":
      i18n.t(
        "A validity exercise needs a sequent with the ':|-:' turnstile, e.g. 'P, P -> Q :|-: Q'.",
      ),
    "A validity sequent must contain exactly one ':|-:' turnstile.": i18n.t(
      "A validity sequent must contain exactly one ':|-:' turnstile.",
    ),
    "A validity sequent needs at least one conclusion after the ':|-:' turnstile.":
      i18n.t(
        "A validity sequent needs at least one conclusion after the ':|-:' turnstile.",
      ),
    "A validity sequent needs at least one premise before the ':|-:' turnstile.":
      i18n.t(
        "A validity sequent needs at least one premise before the ':|-:' turnstile.",
      ),
    "Could not parse formula “{formula}”: {detail}": i18n.t(
      "Could not parse formula “{formula}”: {detail}",
      placeholders("detail", "formula"),
    ),
    "Expected ')'.": i18n.t("Expected ')'."),
    "Expected '->' (conditional).": i18n.t("Expected '->' (conditional)."),
    "Expected '/\\' (conjunction).": i18n.t("Expected '/\\' (conjunction)."),
    "Expected '<->' (biconditional).": i18n.t(
      "Expected '<->' (biconditional).",
    ),
    "Expected '\\/' (disjunction).": i18n.t("Expected '\\/' (disjunction)."),
    "Expected a formula but found “{token}”.": i18n.t(
      "Expected a formula but found “{token}”.",
      placeholders("token"),
    ),
    "Expected a formula.": i18n.t("Expected a formula."),
    "Formula {index} needs {expected} cell tokens; found {found}.": i18n.t(
      "Formula {index} needs {expected} cell tokens; found {found}.",
      placeholders("expected", "found", "index"),
    ),
    "Only formula list items or a given grid may appear after the first formula.":
      i18n.t(
        "Only formula list items or a given grid may appear after the first formula.",
      ),
    "The check attribute must be cells, terse, or off.": i18n.t(
      "The check attribute must be cells, terse, or off.",
    ),
    "The counterexample-to attribute must be validity, tautology, equivalence, inconsistency, or contradiction.":
      i18n.t(
        "The counterexample-to attribute must be validity, tautology, equivalence, inconsistency, or contradiction.",
      ),
    "The fill attribute must be all, connectives, or main.": i18n.t(
      "The fill attribute must be all, connectives, or main.",
    ),
    "The grading attribute must be all-or-nothing or partial.": i18n.t(
      "The grading attribute must be all-or-nothing or partial.",
    ),
    "The reference segment needs {expected} tokens (one per atom); found {found}.":
      i18n.t(
        "The reference segment needs {expected} tokens (one per atom); found {found}.",
        placeholders("expected", "found"),
      ),
    "The variant attribute must be simple, validity, or partial.": i18n.t(
      "The variant attribute must be simple, validity, or partial.",
    ),
    "The {attribute} attribute must be a glyph of 1 to {max} characters.":
      i18n.t(
        "The {attribute} attribute must be a glyph of 1 to {max} characters.",
        placeholders("attribute", "max"),
      ),
    "These options leave no cells for the student to fill.": i18n.t(
      "These options leave no cells for the student to fill.",
    ),
    "This given assigns {pinned} to a cell whose computed value is {expected}.":
      i18n.t(
        "This given assigns {pinned} to a cell whose computed value is {expected}.",
        placeholders("expected", "pinned"),
      ),
    "Unexpected character “{character}”.": i18n.t(
      "Unexpected character “{character}”.",
      placeholders("character"),
    ),
    "Unexpected “{token}”.": i18n.t(
      "Unexpected “{token}”.",
      placeholders("token"),
    ),
    "Unknown truth-table option “{option}”.": i18n.t(
      "Unknown truth-table option “{option}”.",
      placeholders("option"),
    ),
    // The clause after the colon in "Could not parse formula …" when the parser
    // reported no error of its own.
    "syntax error": i18n.t("syntax error"),

    // The model directive (`model/authoring.ts`). It shares the sequent
    // sentences and `counterexample-to` with the truth table above, since both
    // spell an argument `premises :|-: conclusions` and both take Carnap's
    // counterexample vocabulary.
    "A constraint exercise has only givens after its constraint line.":
      i18n.t(
        "A constraint exercise has only givens after its constraint line.",
      ),
    "A constraint exercise needs a '- constraints : formulas' list item, e.g. '- ExEy~x = y : AxAyF(x,y)'.":
      i18n.t(
        "A constraint exercise needs a '- constraints : formulas' list item, e.g. '- ExEy~x = y : AxAyF(x,y)'.",
      ),
    "A constraint exercise needs at least one constraint before the ':'.":
      i18n.t(
        "A constraint exercise needs at least one constraint before the ':'.",
      ),
    "A given is written '| Field : value'.": i18n.t(
      "A given is written '| Field : value'.",
    ),
    "A model exercise requires at least one formula.": i18n.t(
      "A model exercise requires at least one formula.",
    ),
    "A validity exercise has only givens after its sequent line.": i18n.t(
      "A validity exercise has only givens after its sequent line.",
    ),
    "A validity exercise needs a sequent with the ':|-:' turnstile, e.g. 'AxEyR(x,y) :|-: ExAyR(y,x)'.":
      i18n.t(
        "A validity exercise needs a sequent with the ':|-:' turnstile, e.g. 'AxEyR(x,y) :|-: ExAyR(y,x)'.",
      ),
    "Only formula list items or givens may appear after the first formula.":
      i18n.t(
        "Only formula list items or givens may appear after the first formula.",
      ),
    "The check attribute must be on or off.": i18n.t(
      "The check attribute must be on or off.",
    ),
    "The system attribute must name a notation system this server knows: {systems}.":
      i18n.t(
        "The system attribute must name a notation system this server knows: {systems}.",
        placeholders("systems"),
      ),
    "The variant attribute must be simple, validity, or constraint.": i18n.t(
      "The variant attribute must be simple, validity, or constraint.",
    ),
    "There is already a given for “{field}”.": i18n.t(
      "There is already a given for “{field}”.",
      placeholders("field"),
    ),
    "This exercise has no field called “{field}”.": i18n.t(
      "This exercise has no field called “{field}”.",
      placeholders("field"),
    ),
    "Unknown model option “{option}”.": i18n.t(
      "Unknown model option “{option}”.",
      placeholders("option"),
    ),
    "“{value}” is not something “{field}” can contain.": i18n.t(
      "“{value}” is not something “{field}” can contain.",
      placeholders("field", "value"),
    ),

    // The translation directive (`translation/authoring.ts`). It shares the
    // system sentence and the formula-parse sentence with the model above.
    "A translation exercise requires at least one solution formula.": i18n.t(
      "A translation exercise requires at least one solution formula.",
    ),
    "Only solution list items may appear after the first solution.": i18n.t(
      "Only solution list items may appear after the first solution.",
    ),
    "The PNF test applies only to first-order translations.": i18n.t(
      "The PNF test applies only to first-order translations.",
    ),
    "The variant attribute must be prop, first-order, or exact.": i18n.t(
      "The variant attribute must be prop, first-order, or exact.",
    ),
    "Unknown translation option “{option}”.": i18n.t(
      "Unknown translation option “{option}”.",
      placeholders("option"),
    ),
    "Unknown translation test “{test}”.": i18n.t(
      "Unknown translation test “{test}”.",
      placeholders("test"),
    ),
    "“{formula}” is not propositional; a prop translation uses sentence letters and connectives only.":
      i18n.t(
        "“{formula}” is not propositional; a prop translation uses sentence letters and connectives only.",
        placeholders("formula"),
      ),

    // The shared first-order parser (`exercises/first-order/formula.ts`).
    // It shares "Expected a formula.", "Expected a formula but found …",
    // "Unexpected character …" and "Unexpected …" with the propositional parser
    // above; these are the sentences only a first-order dialect can produce.
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
    "“{name}” is a free variable; every formula must be a sentence.": i18n.t(
      "“{name}” is a free variable; every formula must be a sentence.",
      placeholders("name"),
    ),
    "“{operator}” cannot be chained; add parentheses to group it.": i18n.t(
      "“{operator}” cannot be chained; add parentheses to group it.",
      placeholders("operator"),
    ),

    // The three proof types, whose theory and goal headers are shared.
    "A proof exercise needs a 'theorem <name>: $ … $' line declaring the goal.":
      i18n.t(
        "A proof exercise needs a 'theorem <name>: $ … $' line declaring the goal.",
      ),
    "An aufbau-mm0 block needs MM0 source in its body.": i18n.t(
      "An aufbau-mm0 block needs MM0 source in its body.",
    ),
    "An aufbau-mm0 src attribute is not supported yet; write the MM0 inline.":
      i18n.t(
        "An aufbau-mm0 src attribute is not supported yet; write the MM0 inline.",
      ),
    "No aufbau-mm0 theory named “{name}” is declared before this proof.":
      i18n.t(
        "No aufbau-mm0 theory named “{name}” is declared before this proof.",
        placeholders("name"),
      ),
    "The goal header must be followed by a '----' underline, then the proof body.":
      i18n.t(
        "The goal header must be followed by a '----' underline, then the proof body.",
      ),
    "The goal header must state the goal formula inside '$ … $'.": i18n.t(
      "The goal header must state the goal formula inside '$ … $'.",
    ),
    "Unknown proof option “{option}”. Supported options are 'auto' and 'complete'.":
      i18n.t(
        "Unknown proof option “{option}”. Supported options are 'auto' and 'complete'.",
        placeholders("option"),
      ),

    // The starter-tree parser (`aufbau-proof-tree/parse.ts`).
    "Could not parse “{line}”. Each starter line must read '<label>: $ <formula> $ by <rule> [<refs>]'.":
      i18n.t(
        "Could not parse “{line}”. Each starter line must read '<label>: $ <formula> $ by <rule> [<refs>]'.",
        placeholders("line"),
      ),
    "Line “{label}” cites “{reference}”, which is not a line above it.":
      i18n.t(
        "Line “{label}” cites “{reference}”, which is not a line above it.",
        placeholders("label", "reference"),
      ),
    "Line “{label}” is cited more than once, so this proof is a graph, not a tree. The tree editor needs each line used by at most one other line; duplicate the shared derivation into each branch.":
      i18n.t(
        "Line “{label}” is cited more than once, so this proof is a graph, not a tree. The tree editor needs each line used by at most one other line; duplicate the shared derivation into each branch.",
        placeholders("label"),
      ),
    "Line “{label}” is not connected to the root of the proof; every line must feed into the conclusion.":
      i18n.t(
        "Line “{label}” is not connected to the root of the proof; every line must feed into the conclusion.",
        placeholders("label"),
      ),
    "Line “{label}” is part of a citation cycle.": i18n.t(
      "Line “{label}” is part of a citation cycle.",
      placeholders("label"),
    ),
    "More than one line is uncited ({labels}); a proof tree must end at a single root.":
      i18n.t(
        "More than one line is uncited ({labels}); a proof tree must end at a single root.",
        placeholders("labels"),
      ),
    "No line is left uncited, so there is no root to prove the goal (the lines cite each other in a cycle).":
      i18n.t(
        "No line is left uncited, so there is no root to prove the goal (the lines cite each other in a cycle).",
      ),
    "The label “{label}” is defined more than once.": i18n.t(
      "The label “{label}” is defined more than once.",
      placeholders("label"),
    ),
    "The starter proof has no lines.": i18n.t(
      "The starter proof has no lines.",
    ),
    "There is no root line.": i18n.t("There is no root line."),

    // The Prawitz starter parser and structural checks
    // (`aufbau-proof-prawitz/parse.ts`, `authoring.ts`).
    "A “-- label:” comment must sit at the end of the proof line it marks, not on its own line.":
      i18n.t(
        "A “-- label:” comment must sit at the end of the proof line it marks, not on its own line.",
      ),
    "This “-- label:” comment names no label.": i18n.t(
      "This “-- label:” comment names no label.",
    ),
    "Starter line “{line}” must be a full sequent — its formula has no “{symbol}”.":
      i18n.t(
        "Starter line “{line}” must be a full sequent — its formula has no “{symbol}”.",
        placeholders("line", "symbol"),
      ),
    "A Prawitz proof has no “#n” hypothesis leaves — write each premise as its own assumption line.":
      i18n.t(
        "A Prawitz proof has no “#n” hypothesis leaves — write each premise as its own assumption line.",
      ),
    "An assumption carries a single discharge label; “{payload}” reads as a list.":
      i18n.t(
        "An assumption carries a single discharge label; “{payload}” reads as a list.",
        placeholders("payload"),
      ),
    "In the starter, the discharge mark “{label}” on line “{line}” doesn't match any assumption above it.":
      i18n.t(
        "In the starter, the discharge mark “{label}” on line “{line}” doesn't match any assumption above it.",
        placeholders("label", "line"),
      ),
    "In the starter, the assumptions discharged by mark “{label}” on line “{line}” must share one formula.":
      i18n.t(
        "In the starter, the assumptions discharged by mark “{label}” on line “{line}” must share one formula.",
        placeholders("label", "line"),
      ),
    "In the starter, assumption line “{line}” can't have premises.": i18n.t(
      "In the starter, assumption line “{line}” can't have premises.",
      placeholders("line"),
    ),
  };
}

export type DiagnosticStrings = ReturnType<typeof buildDiagnosticStrings>;

/**
 * The sentences a compiler diagnostic may carry. Derived from the builder so a
 * diagnostic cannot be worded in a way no catalog entry covers, and an entry
 * cannot go stale after the diagnostic that used it is reworded.
 */
export type DiagnosticMessageId = keyof DiagnosticStrings;
