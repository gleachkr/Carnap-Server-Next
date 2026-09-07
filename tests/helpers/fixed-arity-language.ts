import type { SurfaceLanguage } from "@aufbau/syntax";

import { languageFromSource } from "../../src/worker/logic/specs";

/**
 * A small first-order language whose symbols come in every shape the model
 * and translation readers have to take in one tree walk: fixed-arity
 * predicates and functions spelled by name (`Red(a)`, `succ(a)`), an infix
 * function (`a + b`) and an infix predicate (`a < b`) declared as ordinary
 * two-binder terms with a notation, and a textbook's variadic letters (`F`,
 * `R(a,b)`, `f(a,b)`) over a `@syntax role argument-list` sort beside them.
 * `ι` is a description operator with no role: a binding term the readers
 * refuse rather than misread.
 *
 * Standalone rather than an extension of forallx because that spec makes
 * every letter a delimiter, so a multi-letter name could not be a chunk.
 */
export const FIXED_ARITY_SPEC_SOURCE = `--| @syntax delimiter $ ( ) , + < = ¬ ∧ → ∀ ∃ ι $
--| @syntax brackets ( )
--| @syntax lint closed-sentences
--| @syntax role sentence
provable sort wff;
--| @vars x y z
sort var;
--| @vars a b c
sort name;
sort tm;
--| @syntax role argument-list
sort seq;
term v2t (x: var): tm;
coercion v2t: var > tm;
term n2t (a: name): tm;
coercion n2t: name > tm;
term t2s (te: tm): seq;
coercion t2s: tm > seq;
--| @syntax elided
term snil: seq;
term scomma (sq tq: seq): seq;
infixl scomma: $,$ prec 10;
term F (sq: seq): wff;
term R (sq: seq): wff;
term f (sq: seq): tm;
term Red (x: tm): wff;
term Blue (x: tm): wff;
term succ (x: tm): tm;
term plus (x y: tm): tm;
infixl plus: $+$ prec 60;
term lt (x y: tm): wff;
infixl lt: $<$ prec 50;
--| @syntax role identity
term eq (x y: tm): wff;
infixl eq: $=$ prec 50;
--| @syntax role negation
term not (p: wff): wff;
prefix not: $¬$ prec 40;
--| @syntax role conjunction
term and (p q: wff): wff;
infixl and: $∧$ prec 30;
--| @syntax role conditional
term imp (p q: wff): wff;
infixr imp: $→$ prec 20;
--| @syntax role forall
term all {x: var} (p: wff x): wff;
prefix all: $∀$ prec 40;
--| @syntax role exists
term ex {x: var} (p: wff x): wff;
prefix ex: $∃$ prec 40;
term the {x: var} (p: wff x): tm;
prefix the: $ι$ prec max;
`;

/** The fixture read as a language, or a thrown error naming the fixture. */
export function fixedArityLanguage(
  source: string = FIXED_ARITY_SPEC_SOURCE,
): SurfaceLanguage {
  const language = languageFromSource(source);

  if (language === null) {
    throw new Error("the fixed-arity fixture does not read as a language");
  }

  return language;
}
