import type { LoadedCompiler } from "@aufbau/compiler";

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
