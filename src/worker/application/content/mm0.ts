/**
 * Compiling an `mm0` content revision: what "save" means for a theory an
 * instructor hosts, rather than for a lesson.
 *
 * A lesson compiles to a document. A theory compiles to a *verdict* plus a
 * summary — there is nothing to render, and the text a lesson eventually uses
 * is the source itself, frozen into that lesson's systems table
 * (`artifact.systems[name]`) when an `aufbau-mm0` block names this revision's
 * URL. So the job here is to refuse a file that
 * will not read, at the moment its author can still fix it, instead of letting
 * the failure surface days later inside somebody's proof exercise.
 *
 * **The check is `parseSpec`, and that is a real bound but not the engine's.**
 * The library reads the MM0 statement grammar and validates that the file is
 * coherent — notation tokens that conflict, dangling term names, elab rules
 * that cannot invert. What it does not do is prove anything: whether an axiom
 * is well typed, and whether the theory is consistent, are the Aufbau
 * compiler's business, and the compiler runs in the *browser* (see
 * `src/client/proof-compiler.ts`) rather than in the Worker. A file that
 * parses here and fails there reports at the proof widget — which is exactly
 * what already happens to MM0 written inline in an `aufbau-mm0` body, so this
 * adds no new class of surprise.
 *
 * Shares the markdown compiler's result shape and its diagnostic type on
 * purpose: `ContentService.createRevision` picks a branch and everything past
 * it — the failed-save error, the editor's list, the gutter markers — is the
 * one path that already exists. DOM-free and translator-free for the same
 * reason that compiler is: this module is bundled into the author's browser
 * for the live preview.
 */

import type { Diagnostic } from "@aufbau/syntax";
import { parseSpec, type Spec, SurfaceLanguage } from "@aufbau/syntax";
import { sentenceSort } from "../../logic/specs/roles";
import { type CompilerDiagnostic, diagnostic } from "./diagnostics";

/**
 * What a saved MM0 revision knows about itself.
 *
 * Deliberately a summary and not a re-encoding of the spec: the artifact is
 * what the revision page shows its author and what a later reader can ask
 * cheap questions of, while the authority on what the file *says* stays the
 * source text, which is what a lesson compiles against. Storing a parsed spec
 * would be storing a second copy that a library upgrade could silently make
 * disagree with the first.
 */
export interface CompiledTheoryArtifact {
  readonly artifactVersion: 1;
  /**
   * The names a proof can cite — the rules of the system, in declaration
   * order. The most useful single thing to show an author, because it is
   * precisely what their students will type.
   */
  readonly axioms: readonly string[];
  readonly kind: "mm0";
  /**
   * The sort student formulas are read at, when this file is also a *language*
   * — `@syntax role sentence`. Null means it is a proof theory only: usable as
   * a `src=`, but not something a formula can be written in.
   */
  readonly sentenceSort: string | null;
  readonly sorts: readonly string[];
  readonly terms: readonly string[];
}

export type CompileTheoryResult =
  | {
      readonly artifact: CompiledTheoryArtifact;
      readonly diagnostics: readonly CompilerDiagnostic[];
      readonly ok: true;
    }
  | {
      readonly diagnostics: readonly CompilerDiagnostic[];
      readonly ok: false;
    };

/**
 * The 1-based line an offset falls on. The library spans in UTF-16 offsets
 * because it parses formulas out of the middle of things; the editor's gutter
 * counts lines, and this is the whole of the conversion.
 */
export function lineAt(source: string, offset: number): number {
  let line = 1;

  for (let at = 0; at < offset && at < source.length; at += 1) {
    if (source[at] === "\n") {
      line += 1;
    }
  }

  return line;
}

/**
 * One library complaint, as an author sees it — shared with the `aufbau-mm0`
 * block inside a lesson, which reads its composed source the same way and
 * reports at the author's own line.
 *
 * The library's own sentence is quoted rather than translated, which is the
 * one place this path is worse than the markdown compiler's. Carnap adopted
 * the library's *formula* sentences into its catalog because a student reads
 * those; a spec-validation sentence is read by the instructor writing the
 * spec, there are dozens of them, and they name MM0 machinery ("notation",
 * "precedence", "coercion") that has no plainer wording to be translated
 * into. The frame around it is translated, so the reader at least knows what
 * they are being told and where.
 *
 * **One id is worded rather than quoted.** `delimiter_unreachable_name` is
 * what an author gets for declaring an ordinary multi-character predicate —
 * `term Cube (sq: seq): wff;` against forallx, whose lexicon letters are all
 * delimiters — and the library cannot name the repair, because whether `Cube`
 * was meant to be one word is a fact about this spec rather than about MM0.
 * Carnap can say it, so it does: the whole complaint is otherwise a true
 * statement about segmentation that leaves the reader nowhere to go.
 */
export function libraryDiagnostic(
  line: number,
  one: Diagnostic,
): CompilerDiagnostic {
  if (one.id === "delimiter_unreachable_name") {
    return diagnostic(
      line,
      `mm0_${one.id}`,
      "This MM0 does not read: the delimiters split “{name}” into {chunks}, so nothing anyone types can be read as it. Declare it whole by adding a line reading: --| @syntax delimiter $ {name} $",
      {
        params: {
          chunks: one.params.chunks ?? "",
          name: one.params.name ?? "",
        },
        severity: one.severity,
      },
    );
  }

  return diagnostic(
    line,
    `mm0_${one.id}`,
    "This MM0 does not read: {reason}",
    {
      params: { reason: one.message },
      severity: one.severity,
    },
  );
}

function fromLibrary(source: string, one: Diagnostic): CompilerDiagnostic {
  return libraryDiagnostic(lineAt(source, one.span.start), one);
}

/** Everything the file declares, in the order it declares it. */
function summarize(
  spec: Spec,
  sentence: string | null,
): CompiledTheoryArtifact {
  const axioms: string[] = [];

  for (const statement of spec.statements) {
    if (statement.kind === "axiom") {
      axioms.push(statement.name);
    }
  }

  return {
    artifactVersion: 1,
    axioms,
    kind: "mm0",
    sentenceSort: sentence,
    sorts: [...spec.sorts.keys()],
    terms: [...spec.terms.keys()],
  };
}

/**
 * Read one MM0 artifact, and say what it is.
 *
 * Warnings do not fail the save — a spec that only warns is usable, and the
 * library says so itself — but they travel back so the editor can show them.
 */
export function compileTheorySource(source: string): CompileTheoryResult {
  const { spec, diagnostics } = parseSpec(source);
  const reported = diagnostics.map((one) => fromLibrary(source, one));
  const failed = reported.some((one) => one.severity === "error");

  // A file that declares nothing is not a theory, and `parseSpec` has no
  // opinion about it: an empty file is trivially coherent. Refusing it here
  // keeps an author from saving a blank revision and then wondering why the
  // lesson naming it compiles to a proof exercise with no rules in it.
  if (!failed && spec.sorts.size === 0 && spec.terms.size === 0) {
    reported.push(
      diagnostic(1, "empty_mm0", "An MM0 file must declare something."),
    );
  }

  if (reported.some((one) => one.severity === "error")) {
    return { diagnostics: reported, ok: false };
  }

  // Building the language is the last of the check rather than a convenience:
  // it is where the spec's tables are actually assembled, so a file that reads
  // as statements but cannot be turned into a parser fails here — with its
  // author present — instead of at `languageById`'s throw or in a widget.
  try {
    return {
      artifact: summarize(
        spec,
        sentenceSort(new SurfaceLanguage(spec)) ?? null,
      ),
      diagnostics: reported,
      ok: true,
    };
  } catch (error) {
    reported.push(
      diagnostic(1, "unusable_mm0", "This MM0 does not read: {reason}", {
        params: {
          reason: error instanceof Error ? error.message : "unknown",
        },
      }),
    );

    return { diagnostics: reported, ok: false };
  }
}
