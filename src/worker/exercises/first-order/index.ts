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
import { roleIndex } from "../../logic/specs/roles";

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
 * Whether a language is one these two types can be set in.
 *
 * Not every spec qualifies, and the question is a *capability* rather than a
 * membership: these types quantify, so a language with no quantifiers is one
 * whose formulas they can parse and never evaluate. `carnap-prop` ships beside
 * forallx and is exactly that — a propositional signature that has not been
 * given binders.
 *
 * This used to be an allowlist of ids, which had two problems and one of them
 * was fatal. It could not answer for a language an author declared in their own
 * document, because such a language has no id to be on a list; and the reason
 * it gave — "must be one of: forallx-calgary-2019" — told an author which
 * *file* to name rather than what their own was missing.
 *
 * Identity is not required. A spec that declares no `=` simply never yields an
 * identity node, which every reader here already handles; refusing it would
 * refuse a perfectly ordinary predicate language.
 */
export function quantifies(language: SurfaceLanguage): boolean {
  const roles = roleIndex(language);

  return roles.termFor("forall") !== null && roles.termFor("exists") !== null;
}

/**
 * The language an exercise is set in, or `null` where its stored data no longer
 * names one.
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
  const language =
    data.source === undefined
      ? data.dialect === undefined
        ? null
        : languageById(data.dialect)
      : languageFromSource(data.source);

  return language === null || !quantifies(language) ? null : language;
}
