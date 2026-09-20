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
 * A language an author declares in an `:::aufbau-mm0` block is read by the
 * same reader (`languageFromSource`) but is not registered here: it arrives as
 * text in the document, and `exercise-kit/systems` resolves it by name, block
 * before shipped id, into the document's own systems table.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import { theorySourceByFileName } from "../theories";
import { readLanguage } from "./read";

export { type LanguageRead, languageFromSource, readLanguage } from "./read";

/**
 * Every language an author can name, by the id they write.
 *
 * **An id is its file's stem.** Keeping the two equal is what lets one
 * `system=` name a shipped file by its stem and an `aufbau-mm0` block by its
 * name, and what lets a block's `src="/theories/<id>.mm0"` and a bare
 * `system="<id>"` mean the same bytes — one artifact, not two kinds of name.
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
 * Every spec that ships, by the id an author names it with. The ids kept the
 * spellings of the hand-written dialect table this replaced, so content
 * authored against `system=` kept working when the exercise types swapped
 * over.
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
