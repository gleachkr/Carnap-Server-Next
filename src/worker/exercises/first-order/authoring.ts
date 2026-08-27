/**
 * `system=` for the two types that read a formula and *evaluate* it.
 *
 * The proof types resolve the same attribute through the same resolver (see
 * `aufbau-proof/authoring.ts`), and that is the point of this module existing
 * rather than each type carrying its own copy: before it, `model` and
 * `translation` had near-identical `parseLanguage` functions that could only
 * name a global by id, while the proof types could only name a document-local
 * block. One attribute, one resolution order, and a course that extends forallx
 * with its own vocabulary can set every kind of exercise in the result.
 *
 * Kept out of `./index.ts` deliberately: that barrel is imported by the client
 * elements, and the authoring toolkit has no business in their bundles.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import type {
  CompilerDiagnostic,
  DirectiveBlock,
} from "../../application/content/authoring-toolkit";
import { diagnostic } from "../../application/content/authoring-toolkit";
import { languageFromSource } from "../../logic/specs";
import type { SystemResolver } from "../aufbau-proof/authoring";
import { DEFAULT_LANGUAGE_ID, quantifies } from "./index";

/**
 * The language an exercise is written in, and the name it is stored under.
 *
 * Both travel together because they are stored apart: `publicData.system` holds
 * the name, the document's systems table holds one copy of the text, and the
 * join (`exercises/systems.ts`) puts them back together for every reader.
 */
export interface ResolvedLanguage {
  readonly language: SurfaceLanguage;
  readonly system: string;
}

/**
 * The language this block's `system=` names, with anything wrong already
 * reported.
 *
 * Never `null`: a failure falls back to the default so the rest of the block
 * still compiles and the author gets every complaint at once rather than the
 * first. The diagnostics are errors, so the save refuses either way — the
 * fallback buys a better list, not a lenient one.
 */
export function parseSystem(
  block: DirectiveBlock,
  resolveSystem: SystemResolver,
  diagnostics: CompilerDiagnostic[],
): ResolvedLanguage {
  const named = block.attrs.system?.trim();
  const system =
    named === undefined || named === "" ? DEFAULT_LANGUAGE_ID : named;
  const resolved = resolveSystem(system, block.line, diagnostics);
  const language =
    resolved === null ? null : languageFromSource(resolved.source);

  if (language !== null && quantifies(language)) {
    return { language, system };
  }

  if (resolved !== null) {
    // It resolved and it is not one of these: say which half is missing, not
    // which files are on a list. An author who declared their own language can
    // act on "no quantifiers"; "must be one of: forallx-calgary-2019" told them
    // to abandon it.
    diagnostics.push(
      diagnostic(
        block.line,
        "system_not_first_order",
        "The system “{name}” declares no quantifiers (@syntax role forall and exists), which this exercise type needs.",
        { params: { name: system } },
      ),
    );
  }

  return fallbackLanguage(resolveSystem, block, diagnostics);
}

/** The default system, which ships and therefore reads. */
function fallbackLanguage(
  resolveSystem: SystemResolver,
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): ResolvedLanguage {
  const resolved = resolveSystem(
    DEFAULT_LANGUAGE_ID,
    block.line,
    diagnostics,
  );
  const language =
    resolved === null ? null : languageFromSource(resolved.source);

  if (language === null) {
    throw new Error(
      `the ${DEFAULT_LANGUAGE_ID} spec is no longer registered`,
    );
  }

  return { language, system: DEFAULT_LANGUAGE_ID };
}
