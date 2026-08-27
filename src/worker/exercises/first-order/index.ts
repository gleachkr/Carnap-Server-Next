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
import { languageById, languageFromSource } from "../../logic/specs";

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
 * The language an exercise is set in, or `null` where its stored data no longer
 * names one.
 *
 * `null` means there is no language here at all — no `source`, no `dialect`, or
 * text that does not read as a spec. It does not mean "a language these types
 * refuse": there is no such thing now. A capability predicate used to sit here
 * demanding quantifiers, which made `carnap-prop` unusable for propositional
 * translation, and a language whose binder carried no `@syntax role` satisfied
 * it anyway. Whether a *formula* uses something these types cannot evaluate is
 * asked of that formula, by `./formula.ts`, which can also name the construct.
 *
 * Two shapes arrive here, and the newer one is the reason this takes a payload
 * rather than a name. `source` is the language's own text, joined in from the
 * document's systems table (see `exercises/systems.ts`) — which is what lets an
 * author set a model exercise in a language they declared themselves. `dialect`
 * is the older shape, a bare id resolved from the specs that ship, and it is
 * read for every artifact compiled before the table existed.
 */
export function firstOrderLanguageFor(data: {
  readonly dialect?: string;
  readonly source?: string;
}): SurfaceLanguage | null {
  return data.source === undefined
    ? data.dialect === undefined
      ? null
      : languageById(data.dialect)
    : languageFromSource(data.source);
}
