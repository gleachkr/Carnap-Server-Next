/**
 * `system=` for the three types that read a formula and interpret it.
 *
 * The four proof types resolve the same attribute through the same resolver
 * (see `./theory.ts`); what those three need on top of it is a
 * *language*, and a default to fall back on. Before this existed each carried its
 * own copy of the resolution and could only name a global by id, while the
 * proof types could only name a document-local block. One attribute, one
 * resolution order, and a course that extends forallx with its own vocabulary
 * can set every kind of exercise in the result.
 *
 * **What a type asks of a language is now only its name.** This used to carry a
 * capability predicate too — model and translation demanded quantifiers, a
 * truth table demanded their absence — and both halves were wrong.
 *
 * The positive half refused a real exercise: propositional translation
 * (`R /\ C`) is week two of an intro course, and `system="carnap-prop"` on a
 * translation block was answered with "declares no quantifiers, which this
 * exercise type needs".
 *
 * The negative half was defeated by exactly the failure it existed for. It
 * refused a language whose binder carried `@syntax role forall`; a language
 * whose binder was *not* annotated passed, and was then read as an atom. It
 * stopped only the authors who had annotated correctly.
 *
 * Neither was load-bearing. Both formula readers end their role dispatch in a
 * refusal, which fires at compile time on the author's own formula and names
 * the construct rather than the file — see `truth-table/logic/formula.ts` and
 * `../formula/formula.ts`. A property of a *language* was never the right
 * thing to check, because the same node wants opposite readings in two types:
 * `F(a)` is structured for a model, which looks `a` up in an extension of `F`,
 * and opaque for a truth table, which gives it a column.
 *
 * What survives here is `system_unreadable`, which is a fact about the file
 * rather than about what an exercise wants from it.
 *
 * Kept out of the exercise barrels deliberately: those are imported by the
 * client elements, and the Markdown pipeline has no business in their bundles.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import {
  type CompilerDiagnostic,
  diagnostic,
} from "../../application/content/diagnostics";
import { languageFromSource } from "../../logic/specs";
import type { DirectiveBlock } from "../authoring";
import { builtInSystem, type SystemResolver } from "./theory";

/**
 * The language an exercise is written in, and the name it is stored under.
 *
 * Both travel together because they are stored apart: `publicData.system` holds
 * the name, the document's systems table holds one copy of the text, and the
 * join (`./join.ts`) puts them back together for every reader.
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

/**
 * What a type says about the language it is set in — now only what `system=`
 * means when the author writes none. This carried a capability predicate
 * once; the header says why it no longer does.
 */
export interface SystemDefault {
  readonly defaultId: string;
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
  fallback: SystemDefault,
): SystemLanguage {
  const named = block.attrs.system?.trim();
  const system =
    named === undefined || named === "" ? fallback.defaultId : named;
  const resolved = resolveSystem(system, block.line, diagnostics);
  const language =
    resolved === null ? null : languageFromSource(resolved.source);

  if (resolved !== null && language !== null) {
    return { language, source: resolved.source, system };
  }

  if (resolved !== null) {
    // The one thing left to say about a language as such. Whether this type can
    // do anything with the formulas written in it is asked of each formula, not
    // here; this is the case where there is no language to ask about at all.
    //
    // *Why* it does not read is said where it can be acted on — the block that
    // declares it, which reports the library's own complaint against the line
    // that caused it (`compileAufbauMm0`). Saying it twice, once per exercise
    // set in a broken block, would bury the one copy that has a line number.
    diagnostics.push(
      diagnostic(
        block.line,
        "system_unreadable",
        "The system “{name}” does not read as a language, so an exercise cannot be set in it. The reason is reported on the aufbau-mm0 block that declares it.",
        { params: { name: system } },
      ),
    );
  }

  return fallbackLanguage(fallback);
}

/**
 * The type's default system, which ships and therefore reads.
 *
 * Resolved as a shipped id directly, not through the resolver: the resolver
 * looks in the document first, and a document is free to declare a block
 * under the default's own name. If that block is the one that just failed,
 * asking the resolver again would hand it straight back — which is how a
 * broken `carnap-prop` block over a bare truth table used to throw here
 * instead of diagnosing. The default is what the type means when nobody
 * names anything, and only the site can say what that is.
 *
 * The throw that remains is a fact about the build, not about the document:
 * a type's default must be a system this server ships.
 */
function fallbackLanguage(fallback: SystemDefault): SystemLanguage {
  const resolved = builtInSystem(fallback.defaultId);
  const language =
    resolved === null ? null : languageFromSource(resolved.source);

  if (resolved === null || language === null) {
    throw new Error(`the ${fallback.defaultId} spec is no longer registered`);
  }

  return {
    language,
    source: resolved.source,
    system: fallback.defaultId,
  };
}
