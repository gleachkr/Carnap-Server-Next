/**
 * `system=` for the three types that read a formula and interpret it.
 *
 * The four proof types resolve the same attribute through the same resolver
 * (see `aufbau-proof/authoring.ts`); what those three need on top of it is a
 * *language*, and a requirement about it. Before this existed each carried its
 * own copy of the resolution and could only name a global by id, while the
 * proof types could only name a document-local block. One attribute, one
 * resolution order, and a course that extends forallx with its own vocabulary
 * can set every kind of exercise in the result.
 *
 * The requirement is per type and is the reason this takes a callback rather
 * than a flag: a model or translation exercise needs quantifiers and a truth
 * table needs their absence, and each says so in its own words. Passing the
 * refusal in as a function is also what keeps `tsc` checking the sentence
 * against `diagnostic-strings.ts` at the site that writes it.
 *
 * Kept out of the exercise barrels deliberately: those are imported by the
 * client elements, and the authoring toolkit has no business in their bundles.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import type {
  CompilerDiagnostic,
  DirectiveBlock,
} from "../application/content/authoring-toolkit";
import { languageFromSource } from "../logic/specs";
import type { SystemResolver } from "./aufbau-proof/authoring";

/**
 * The language an exercise is written in, and the name it is stored under.
 *
 * Both travel together because they are stored apart: `publicData.system` holds
 * the name, the document's systems table holds one copy of the text, and the
 * join (`exercises/systems.ts`) puts them back together for every reader.
 */
export interface SystemLanguage {
  readonly language: SurfaceLanguage;
  /**
   * The system's MM0 as written — what the join will put back into
   * `publicData.source` on every read, and what a type needs at compile time
   * for anything that reads a formula the way a reader will.
   */
  readonly source: string;
  readonly system: string;
}

/** What a type asks of the language it is set in. */
export interface SystemRequirement {
  /** Whether this type can be set in the language at all. */
  readonly accepts: (language: SurfaceLanguage) => boolean;
  /** What `system=` means when the author does not write it. */
  readonly defaultId: string;
  /** How this type says no, in its own words. */
  readonly refuse: (name: string, line: number) => CompilerDiagnostic;
}

/**
 * The language this block's `system=` names, with anything wrong already
 * reported.
 *
 * Never `null`: a failure falls back to the type's default so the rest of the
 * block still compiles and the author gets every complaint at once rather than
 * the first. The diagnostics are errors, so the save refuses either way — the
 * fallback buys a better list, not a lenient one.
 */
export function parseSystemAttribute(
  block: DirectiveBlock,
  resolveSystem: SystemResolver,
  diagnostics: CompilerDiagnostic[],
  requirement: SystemRequirement,
): SystemLanguage {
  const named = block.attrs.system?.trim();
  const system =
    named === undefined || named === "" ? requirement.defaultId : named;
  const resolved = resolveSystem(system, block.line, diagnostics);
  const language =
    resolved === null ? null : languageFromSource(resolved.source);

  if (
    resolved !== null &&
    language !== null &&
    requirement.accepts(language)
  ) {
    return { language, source: resolved.source, system };
  }

  if (resolved !== null) {
    // It resolved and it is not one of these. Saying which half is missing is
    // the whole gain over the allowlist this replaced: an author who declared
    // their own language can act on "no quantifiers", while "must be one of:
    // forallx-calgary-2019" told them to abandon it.
    diagnostics.push(requirement.refuse(system, block.line));
  }

  return fallbackLanguage(resolveSystem, block, diagnostics, requirement);
}

/** The type's default system, which ships and therefore reads. */
function fallbackLanguage(
  resolveSystem: SystemResolver,
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
  requirement: SystemRequirement,
): SystemLanguage {
  const resolved = resolveSystem(
    requirement.defaultId,
    block.line,
    diagnostics,
  );
  const language =
    resolved === null ? null : languageFromSource(resolved.source);

  if (resolved === null || language === null) {
    throw new Error(
      `the ${requirement.defaultId} spec is no longer registered`,
    );
  }

  return {
    language,
    source: resolved.source,
    system: requirement.defaultId,
  };
}
