/**
 * The shared first-order syntax core: the formula tree the model and the
 * translation both evaluate, and the reader that builds it from a language
 * spec. Both types read formulas through this barrel; everything semantic
 * (finite models, equivalence theories) stays with the type that owns it.
 *
 * Every module here is DOM-free and free of any i18n import, because the client
 * elements import the same code the worker grades with.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import { languageById } from "../../logic/specs";

export type {
  BinaryConnective,
  Formula,
  ParseError,
  ParseResult,
  Term,
} from "./formula";
export {
  formulaToString,
  parseFormula,
  splitFormulaList,
  termToString,
} from "./formula";

export const DEFAULT_LANGUAGE_ID = "forallx-calgary-2019";

/**
 * The languages an author may name in `system=`.
 *
 * Not every spec in `logic/specs/` qualifies. These two types quantify, form
 * identities and interpret predicates, so a spec they can be set in has to
 * declare the roles that means — `carnap-prop` ships beside forallx and has
 * none of them. Widening this is a matter of adding an id once a spec earns
 * it, which is what keeps a nonsense pairing from reaching a student as an
 * evaluator crash rather than as an authoring diagnostic.
 */
export const FIRST_ORDER_LANGUAGE_IDS: readonly string[] = [
  DEFAULT_LANGUAGE_ID,
];

/** The language an author named, or `null` if it is not one of ours. */
export function firstOrderLanguage(id: string): SurfaceLanguage | null {
  return FIRST_ORDER_LANGUAGE_IDS.includes(id) ? languageById(id) : null;
}
