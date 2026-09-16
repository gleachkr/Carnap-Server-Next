/**
 * `system=` on a truth table.
 *
 * Everything is `exercise-kit/systems/attribute.ts`; what is here is the default, which is
 * `carnap-prop`. Until `system=` existed this type spoke that language and
 * nothing else, for no reason beyond nobody having written the attribute.
 *
 * There is no requirement beyond the default. This used to demand the *absence*
 * of quantifiers, which caught a binder only when its spec had annotated it —
 * an unannotated one sailed past and was read as an atom — and refused, on the
 * strength of one binder, languages whose propositional fragment makes a
 * perfectly good table. A construct a table has no column for is now refused
 * where it is written, by `./logic/formula.ts`, which can also name it.
 */

import type {
  CompilerDiagnostic,
  DirectiveBlock,
} from "../../application/content/authoring-toolkit";
import type { SystemLanguage } from "../../exercise-kit/systems/attribute";
import { parseSystemAttribute } from "../../exercise-kit/systems/attribute";
import type { SystemResolver } from "../../exercise-kit/systems/theory";
import { PROP_LANGUAGE_ID } from "./logic";

/** The language this block's `system=` names, with any refusal reported. */
export function parseSystem(
  block: DirectiveBlock,
  resolveSystem: SystemResolver,
  diagnostics: CompilerDiagnostic[],
): SystemLanguage {
  return parseSystemAttribute(block, resolveSystem, diagnostics, {
    defaultId: PROP_LANGUAGE_ID,
  });
}
