/**
 * `system=` for the two types that read a formula and evaluate it over a
 * domain — the model and the translation.
 *
 * Everything is `../systems/attribute.ts`; what is here is the default, which is
 * forallx. There is no requirement beyond that any more: these types used to
 * demand quantifiers, which refused propositional translation — an exercise
 * every intro course sets — for a capability its formulas never reach for. What
 * a formula uses is now asked of the formula, in `./formula.ts`.
 */

import type {
  CompilerDiagnostic,
  DirectiveBlock,
} from "../../application/content/authoring-toolkit";
import type { SystemLanguage } from "../systems/attribute";
import { parseSystemAttribute } from "../systems/attribute";
import { DEFAULT_LANGUAGE_ID } from "./index";

/** The language this block's `system=` names, with any refusal reported. */
export function parseSystem(
  block: DirectiveBlock,
  resolveSystem: Parameters<typeof parseSystemAttribute>[1],
  diagnostics: CompilerDiagnostic[],
): SystemLanguage {
  return parseSystemAttribute(block, resolveSystem, diagnostics, {
    defaultId: DEFAULT_LANGUAGE_ID,
  });
}
