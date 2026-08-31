/**
 * Carnap's language specs: the id an author names with `system=`, and how each
 * becomes a {@link SurfaceLanguage} that parses what a student types and prints
 * it back.
 *
 * The *text* is not here. Every spec is an MM0 artifact in `../theories`, which
 * is the directory the route serves — so a language has a URL as well as an id,
 * and this module is only the reading end. `roles.ts` and `diagnostics.ts`
 * beside it are the rest of that end: what a constructor means, and how the
 * library's parse failures are said in Carnap's words.
 *
 * **One directory for the artifacts, not two.** A language and a proof system
 * are the same kind of file — forallx: Calgary is literally both, and
 * `carnap-prop` is a signature that has not been given rules — so sorting them
 * by whether they happen to have axioms would put two halves of one idea in two
 * places and give them somewhere to drift apart. It also means the reader here
 * has exactly one place to look.
 *
 * **Why one shared registry rather than one per exercise type.** A language is
 * cross-type: a model exercise and a translation set from the same course have
 * to agree on what `A` means, and before this each type carried its own
 * notation table and they did not. Splitting the specs by the type that happens
 * to read them first would preserve exactly that.
 *
 * Per-exercise languages authored in content are a separate matter: those
 * arrive as strings from the database and want none of this.
 */

import type { Diagnostic } from "@aufbau/syntax";
import { parseSpec, SurfaceLanguage } from "@aufbau/syntax";
import { theorySourceByFileName } from "../theories";

/**
 * Every language an author can name, by the id they write.
 *
 * **An id is its file's stem.** Keeping the two equal is what will let
 * `system=` take the URL a proof exercise's `theory` already takes, rather than
 * a second kind of name for the same artifact.
 */
const LANGUAGE_IDS: readonly string[] = [
  "carnap-prop",
  "forallx-calgary-2019",
  "forallx-magnus",
];

/**
 * The artifact an id names.
 *
 * A miss is a bug in this directory rather than anything a reader did — the
 * list above and the files are both ours and fixed at build time — so it throws
 * at module load, where it cannot be mistaken for an authoring error.
 */
function sourceFor(id: string): string {
  const source = theorySourceByFileName(`${id}.mm0`);

  if (source === null) {
    throw new Error(`no MM0 artifact ships as ${id}.mm0`);
  }

  return source;
}

/**
 * Every spec that ships, by the id an author names it with. The ids match the
 * incumbent `exercises/first-order/dialect.ts` where a language exists in both,
 * so content authored against `system=` kept working when the exercise types
 * swapped over.
 *
 * **A language and a proof system can be one file, and where they are, they
 * are.** forallx: Calgary's entry is the same text a proof exercise resolves
 * from `src="/theories/forallx-calgary-2019.mm0"`, so a model or translation
 * exercise and a Fitch proof set from that course cannot disagree about what
 * `A` means. What made that possible is the judgement sort: `⊢` builds one,
 * student input is read at `wff`, so a sequent cannot appear where a sentence
 * goes. See that file's header.
 */
export const LANGUAGE_SPEC_SOURCES: Readonly<Record<string, string>> =
  Object.fromEntries(LANGUAGE_IDS.map((id) => [id, sourceFor(id)]));

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

/**
 * The language an author named, or `null` if no such spec ships.
 *
 * A spec that fails to read is a bug in this directory rather than anything a
 * reader did, so it throws instead of degrading: the specs are ours, they are
 * fixed at build time, and `tests/language-specs.test.ts` reads every one of
 * them clean.
 */
export function languageById(id: string): SurfaceLanguage | null {
  const source = LANGUAGE_SPEC_SOURCES[id];

  if (source === undefined) {
    return null;
  }

  const read = readLanguage(source);

  if (read.language === null) {
    throw new Error(
      `language spec ${id} does not read: ${
        read.thrown ??
        read.errors.map((one) => `${one.id} (${one.message})`).join("; ")
      }`,
    );
  }

  return read.language;
}
