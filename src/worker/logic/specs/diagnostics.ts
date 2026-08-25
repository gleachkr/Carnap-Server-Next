/**
 * A `@aufbau/syntax` parse failure, worded for whoever wrote the formula.
 *
 * The library reports structured diagnostics — a stable id, its parameters,
 * and a source span — precisely so a consumer can reword and translate them,
 * and this is where Carnap does. Most of its sentences are already ours:
 * "Expected a formula.", "Unexpected “{token}”.", "Expected “{bracket}”." and
 * the rest were written to match the hand parser these replace, so the
 * mapping below is mostly an identity that `tsc` gets to check.
 *
 * Two are reworded rather than adopted. The library says "This has sort wff
 * where seq is needed", which is true and useless to a student: `seq` is an
 * artifact of the encoding that makes one letter cover `P` and `P(a,b)`, and
 * nobody typing `F(P)` has any reason to have heard of it. {@link SORT_WORDS}
 * turns the spec's sort names into the words a logic student already has —
 * and it lives here, not in the library, because the sorts belong to Carnap's
 * specs rather than to the parser.
 */

import type { Diagnostic } from "@aufbau/syntax";
import type { DiagnosticMessageId } from "../../application/content/diagnostic-strings";
import type { TranslatableMessage } from "../../i18n/translator";

/**
 * One reason a formula would not parse, addressed to whoever wrote it.
 *
 * The prose is an unfilled English template plus its values rather than a
 * finished sentence: the authoring compiler quotes these inside its own
 * `invalid_formula` diagnostic, and the revision editor words both together in
 * the viewer's language. Neither this module nor the compiler has a translator.
 */
export interface FormulaParseError extends TranslatableMessage {
  readonly message: DiagnosticMessageId;
  /** Zero-based character offset into the source where the problem was found. */
  readonly position: number;
}

/**
 * What a sort is called in front of a student.
 *
 * `seq` reads as "term" on purpose. A sort mismatch against a sequence only
 * ever arises where a letter's arguments go, so what the writer actually put
 * in the wrong place is a term; naming the sequence would describe the
 * encoding rather than the mistake.
 */
const SORT_WORDS: Readonly<Record<string, string>> = {
  seq: "term",
  tm: "term",
  var: "variable",
  wff: "sentence",
};

function word(sort: string | undefined): string {
  return sort === undefined ? "expression" : (SORT_WORDS[sort] ?? sort);
}

/**
 * How each library diagnostic is said. A missing entry is not a crash: an id
 * we have never seen still reaches the writer, just without its detail — see
 * {@link UNREADABLE}. Adding a library version can add ids, and a formula that
 * refuses to parse for an unsayable reason is the worst possible time to throw.
 */
const SAID: Readonly<
  Record<
    string,
    (params: Readonly<Record<string, string>>) => TranslatableMessage & {
      readonly message: DiagnosticMessageId;
    }
  >
> = {
  chain_refused: (params) => ({
    message: "“{operator}” cannot be chained; add parentheses to group it.",
    params: { operator: params.operator ?? "" },
  }),
  expected_bracket: (params) => ({
    message: "Expected “{bracket}”.",
    params: { bracket: params.bracket ?? "" },
  }),
  expected_formula: () => ({ message: "Expected a formula." }),
  expected_formula_found: (params) => ({
    message: "Expected a formula but found “{token}”.",
    params: { token: params.token ?? "" },
  }),
  expected_variable: () => ({
    message: "Expected a variable after the quantifier.",
  }),
  free_variable: (params) => ({
    message: "“{name}” is a free variable; every formula must be a sentence.",
    params: { name: params.name ?? "" },
  }),
  group_binary_only: () => ({
    message:
      "Parentheses may only enclose a sentence joined by a two-place connective.",
  }),
  needs_parentheses: (params) => ({
    message: "“{token}” binds too loosely here; parenthesize it.",
    params: { token: params.token ?? "" },
  }),
  sort_mismatch: (params) => ({
    message: "This is a {actual} where a {expected} is needed.",
    params: { actual: word(params.actual), expected: word(params.expected) },
  }),
  term_not_sentence: (params) => ({
    message: "This is a {kind}, not a complete sentence.",
    params: { kind: word(params.actual) },
  }),
  unexpected_token: (params) => ({
    message: "Unexpected “{token}”.",
    params: { token: params.token ?? "" },
  }),
  unrecognized_chunk: (params) => ({
    message: "“{chunk}” is not part of this language.",
    params: { chunk: params.chunk ?? "" },
  }),
};

const UNREADABLE: DiagnosticMessageId = "This formula could not be read.";

/** One library diagnostic, said in Carnap's words and placed in the source. */
export function formulaParseError(diagnostic: Diagnostic): FormulaParseError {
  const say = SAID[diagnostic.id];

  if (say === undefined) {
    return { message: UNREADABLE, position: diagnostic.span.start };
  }

  return { ...say(diagnostic.params), position: diagnostic.span.start };
}

/**
 * Every error in a parse result, worded. Warnings are dropped: they describe
 * a reading the parser went ahead with, and a formula that parsed is not a
 * formula anyone needs to be told about.
 */
export function formulaParseErrors(
  diagnostics: readonly Diagnostic[],
): readonly FormulaParseError[] {
  return diagnostics
    .filter((one) => one.severity === "error")
    .map(formulaParseError);
}
