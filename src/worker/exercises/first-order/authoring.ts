/**
 * `system=` for the two types that read a formula and evaluate it over a
 * domain — the model and the translation.
 *
 * Everything but the requirement is `../system-attribute.ts`; what is here is
 * the requirement, which is quantification, and the sentence that says so.
 */

import type {
  CompilerDiagnostic,
  DirectiveBlock,
} from "../../application/content/authoring-toolkit";
import { diagnostic } from "../../application/content/authoring-toolkit";
import type { SystemLanguage } from "../system-attribute";
import { parseSystemAttribute } from "../system-attribute";
import { DEFAULT_LANGUAGE_ID, quantifies } from "./index";

/** The language this block's `system=` names, with any refusal reported. */
export function parseSystem(
  block: DirectiveBlock,
  resolveSystem: Parameters<typeof parseSystemAttribute>[1],
  diagnostics: CompilerDiagnostic[],
): SystemLanguage {
  return parseSystemAttribute(block, resolveSystem, diagnostics, {
    accepts: quantifies,
    defaultId: DEFAULT_LANGUAGE_ID,
    refuse: (name, line) =>
      diagnostic(
        line,
        "system_not_first_order",
        "The system “{name}” declares no quantifiers (@syntax role forall and exists), which this exercise type needs.",
        { params: { name } },
      ),
  });
}
