/**
 * `system=` on a truth table.
 *
 * Everything but the requirement is `../system-attribute.ts`; what is here is
 * the requirement, which is the *absence* of quantifiers, and the sentence that
 * says so. A truth table is propositional — a binder is a construct its columns
 * have no cell for — but "propositional" is a property of a language and not
 * the name of one file, so any notation that has connectives and no binders can
 * be named here.
 *
 * Until this existed the type spoke `carnap-prop` and nothing else, for no
 * reason beyond nobody having written the attribute.
 */

import type {
  CompilerDiagnostic,
  DirectiveBlock,
} from "../../application/content/authoring-toolkit";
import { diagnostic } from "../../application/content/authoring-toolkit";
import { hasQuantifiers } from "../../logic/specs/roles";
import type { SystemResolver } from "../aufbau-proof/authoring";
import type { SystemLanguage } from "../system-attribute";
import { parseSystemAttribute } from "../system-attribute";
import { PROP_LANGUAGE_ID } from "./logic";

/** The language this block's `system=` names, with any refusal reported. */
export function parseSystem(
  block: DirectiveBlock,
  resolveSystem: SystemResolver,
  diagnostics: CompilerDiagnostic[],
): SystemLanguage {
  return parseSystemAttribute(block, resolveSystem, diagnostics, {
    accepts: (language) => !hasQuantifiers(language),
    defaultId: PROP_LANGUAGE_ID,
    refuse: (name, line) =>
      diagnostic(
        line,
        "system_not_propositional",
        "The system “{name}” has quantifiers, and a truth table is propositional — there is no column for a binder.",
        { params: { name } },
      ),
  });
}
