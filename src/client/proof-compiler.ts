import type { CompileResult, LoadedCompiler } from "@aufbau/compiler";

/**
 * The one Aufbau compiler a page gets, and the one place its language is chosen.
 *
 * Five callers want a compiler — the four proof widgets and the author preview —
 * and they all want the *same* one. The wasm is ~5 MB; the browser caches the
 * download, but a page holding a linear proof and a Fitch proof used to
 * instantiate two modules because each widget memoized its own.
 *
 * Sharing it is also what makes the locale answerable. `set_locale` is a
 * property of the instance rather than of a compile, so two holders wanting
 * different languages would leave whichever loaded first in charge; with one
 * instance the question has one answer.
 */

const COMPILER_WASM_URL = "/assets/aufbau-compiler.wasm";

let compilerPromise: Promise<LoadedCompiler> | null = null;

/**
 * The language the engine words its diagnostics in: the document's own, which
 * the server set from the viewer's locale — `layout.tsx` for app pages,
 * `content-document.tsx` for the frame an exercise renders inside.
 *
 * Read off the document rather than out of an exercise's hydration payload
 * because the instance is per page and the payload is per exercise: two
 * exercises on one page must not be able to disagree about this, and reading the
 * document is what makes that unrepresentable rather than merely unlikely.
 *
 * A tag the engine has no catalog for leaves it in English rather than failing —
 * upstream's rule, not ours, and the one that decides what our `en-XA`
 * pseudolocale gets. That is the right answer for a pseudolocale: its job is to
 * show which text we have not translated, and the compiler's prose is not ours.
 *
 * Exported so a test can check the answer without instantiating five megabytes
 * of wasm to read one string back out of it.
 */
export function proofCompilerLocale(): string | undefined {
  const lang = document.documentElement.lang.trim();

  return lang === "" ? undefined : lang;
}

/**
 * Load the compiler, instantiating it at most once per page.
 *
 * A failed load is deliberately *not* remembered: the import is lazy, so the
 * first attempt happens on the first edit, and a network blip there would
 * otherwise leave the widget unable to compile for the rest of the session.
 * Callers report the failure to the reader and try again on the next edit.
 */
export function loadProofCompiler(): Promise<LoadedCompiler> {
  if (compilerPromise === null) {
    const locale = proofCompilerLocale();

    compilerPromise = import("@aufbau/compiler")
      .then((module) =>
        // Spread rather than `locale: proofCompilerLocale()`, because under
        // `exactOptionalPropertyTypes` an explicit `undefined` is not the same
        // as an absent key — and absent is what "let the engine keep its
        // default" means here.
        module.loadCompiler({
          ...(locale === undefined ? {} : { locale }),
          wasmUrl: COMPILER_WASM_URL,
        }),
      )
      .catch((error: unknown) => {
        compilerPromise = null;

        throw error;
      });
  }

  return compilerPromise;
}

/**
 * One diagnostic of a compile, as the widgets read it: the engine's record
 * with the fields they use typed, and everything else left where it was.
 */
export interface CompileDiagnostic {
  /** The engine's own code for the diagnostic (`SorryLine`, `MissingBinder`…). */
  readonly error?: string;
  readonly message?: string;
  readonly severity: "error" | "info" | "warning";
  /** UTF-8 byte offsets into the proof text the engine was handed. */
  readonly spanEnd?: number;
  readonly spanStart?: number;
}

/**
 * What a compile established, read the way a proof exercise needs to read it.
 *
 * `certificate` is the MMB when — and only when — it proves the goal: a
 * compile that admits a line with `sorry!` still returns `ok` and an MMB, but
 * that MMB carries a `Sorry` instruction the verifier refuses, so handing it to
 * the server would only turn a green mark here into a red one there. A student
 * proof never scores with an admitted line, whatever the exercise allows.
 *
 * What the student is *told* about one is the exercise's call. By default an
 * admitted line is a problem at that line, and the engine's warning is
 * promoted to say so; `admitted` stays false, because to that exercise the
 * line is an error like any other and gets an error's treatment. With
 * `allowSorry` the warning stays a warning, listed in `problems` with its
 * severity intact, and `admitted` says the proof is one of those: every line
 * checks except the ones the student has admitted. (The engine reports
 * admissions only on a compile with no errors, so `admitted` never
 * accompanies an error.)
 *
 * Every other warning is dropped. Since `@aufbau/compiler@0.0.9` a clean
 * compile carries its warnings, and the ones the engine has are not about the
 * student's proof: `AmbiguousAcuiMatch` says the hidden context binders of a
 * slack sequent rule could be split more than one way (they can; any split
 * proves the line), and the `Unused…`/`Unknown…` family is about the theory
 * and goal, which the instructor wrote. Underlining a correct line for either
 * is noise the student cannot act on.
 */
export interface CompileVerdict {
  /** Whether the proof stands only by admitting lines with `sorry!`, where
   *  the exercise allows it. */
  readonly admitted: boolean;
  readonly certificate: Uint8Array | null;
  /** The diagnostics a student should see, errors first as the engine lists them. */
  readonly problems: readonly CompileDiagnostic[];
}

export interface CompileReadOptions {
  /** The exercise's `allow-sorry`: an admitted line is a warning, not an error. */
  readonly allowSorry?: boolean;
}

const ADMITTED_LINE = "SorryLine";

export function readCompileResult(
  result: CompileResult,
  options: CompileReadOptions = {},
): CompileVerdict {
  const problems: CompileDiagnostic[] = [];
  let admitted = false;

  if (Array.isArray(result.diagnostics)) {
    for (const item of result.diagnostics) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const record = item as {
        readonly error?: unknown;
        readonly message?: unknown;
        readonly severity?: unknown;
        readonly spanEnd?: unknown;
        readonly spanStart?: unknown;
      };
      const isAdmission = record.error === ADMITTED_LINE;

      if (record.severity === "warning" && !isAdmission) {
        continue;
      }
      let severity: CompileDiagnostic["severity"] = "error";
      if (isAdmission) {
        admitted = true;
        severity = options.allowSorry === true ? "warning" : "error";
      } else if (record.severity === "info") {
        severity = "info";
      }

      problems.push({
        ...(typeof record.error === "string" ? { error: record.error } : {}),
        ...(typeof record.message === "string"
          ? { message: record.message }
          : {}),
        severity,
        ...(typeof record.spanEnd === "number"
          ? { spanEnd: record.spanEnd }
          : {}),
        ...(typeof record.spanStart === "number"
          ? { spanStart: record.spanStart }
          : {}),
      });
    }
  }

  const certificate =
    result.ok === true && result.mmbBytes !== undefined && !admitted
      ? result.mmbBytes
      : null;

  return {
    admitted: admitted && options.allowSorry === true,
    certificate,
    problems,
  };
}
