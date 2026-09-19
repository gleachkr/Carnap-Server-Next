/**
 * Reading a spec's *text* as a language, memoized on the text.
 *
 * The reading end of `./index.ts`, on its own so the proof widgets — which
 * read the theory they hydrate with, in the browser — can share it without
 * pulling the shipped catalogue (every `.mm0` in `../theories`, as text) into
 * their bundles.
 */

import type { Diagnostic } from "@aufbau/syntax";
import { parseSpec, SurfaceLanguage } from "@aufbau/syntax";

/**
 * Reading a spec builds tables; every caller shares one per language.
 *
 * Keyed by *source*, not by id, because an id is no longer the only way to
 * name a language: a document that declares its own `:::aufbau-mm0` block and
 * sets a model exercise in it arrives here with text and no id at all. The
 * shipped specs are entered under their own text too, so the two namespaces
 * share one table and forallx named by id and forallx named by a block are
 * literally the same object.
 */
const reads = new Map<string, LanguageRead>();

/**
 * What reading a spec's text produced: the language, or what was wrong with it.
 *
 * The failures travel with the language because the caller that has to *say*
 * something is not the caller that wanted the parser. An author's block gets
 * one diagnostic per error, at their own line; an exercise set in that block
 * gets a sentence saying there is no language here at all. Both come out of the
 * same read, which is why it is memoized as a whole rather than thrown away
 * down to its `null`.
 */
export interface LanguageRead {
  /**
   * Every error the library reported, and only the errors: a warning describes
   * a reading it went ahead with, and a spec that only warns still reads. Empty
   * when the language was built.
   */
  readonly errors: readonly Diagnostic[];
  readonly language: SurfaceLanguage | null;
  /**
   * What `SurfaceLanguage` threw, for a file that read as statements and still
   * could not be assembled into a parser. Null whenever `errors` is the answer.
   */
  readonly thrown: string | null;
}

/**
 * Read a spec's *text*, keeping both the language and the reason there is none.
 *
 * `null` rather than a throw, unlike {@link languageById}: this text may be an
 * author's, and an author's mistake is a diagnostic on their revision, not a
 * 500 on somebody's lesson. The compiler is what turns the `null` into the
 * diagnostic; by the time a stored exercise reaches this, a `null` means an
 * artifact authored against a version of the language that no longer reads.
 */
export function readLanguage(source: string): LanguageRead {
  const cached = reads.get(source);

  if (cached !== undefined) {
    return cached;
  }

  let read: LanguageRead;

  try {
    const { spec, diagnostics } = parseSpec(source);
    const errors = diagnostics.filter((one) => one.severity === "error");

    read =
      errors.length === 0
        ? { errors, language: new SurfaceLanguage(spec), thrown: null }
        : { errors, language: null, thrown: null };
  } catch (error) {
    read = {
      errors: [],
      language: null,
      thrown: error instanceof Error ? error.message : "unknown",
    };
  }

  reads.set(source, read);

  return read;
}

/**
 * The language a spec's *text* describes, or `null` where it does not read as
 * one. {@link readLanguage} for callers that have to say why not.
 */
export function languageFromSource(source: string): SurfaceLanguage | null {
  return readLanguage(source).language;
}
