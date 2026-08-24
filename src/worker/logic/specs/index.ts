/**
 * Carnap's language specs: one `.mm0` file per surface language a course can
 * teach, and the one place their text lives.
 *
 * A spec is an ordinary MM0 theory plus `@syntax` annotations, read by
 * `@aufbau/syntax` into a {@link SurfaceLanguage} that parses what a student
 * types and prints it back. The library publishes code and no specs at all —
 * a spec encodes a *textbook's* conventions, which is this program's subject
 * matter rather than the parser's — so the specs it ships are examples, and
 * these are ours.
 *
 * **Why one shared directory rather than one per exercise type.** A language
 * is cross-type: a truth table and a model exercise set from the same course
 * have to agree on what `A` means, and today they do not — `A` is an atom in
 * one and the universal quantifier in the other, because each type carries its
 * own notation table. Splitting the specs by the type that happens to read
 * them first would preserve exactly that.
 *
 * **Why `.mm0` files rather than string constants.** The specs are MM0, and a
 * file with the right extension gets syntax highlighting, an LSP, and the
 * engine's own tooling; a template literal gets none of that. It costs no
 * build configuration: the import attribute is honoured by workerd, by
 * `bun build` for the client bundle, and by `bun test` alike, with no loader
 * rule anywhere (see `src/text-modules.d.ts`). Note that this is *not* the
 * shape of `exercises/aufbau-proof/verifier.ts`, whose `.wasm` import hands
 * back a different kind of value per runtime; a text import is a string in all
 * three.
 *
 * Per-exercise languages authored in content are a separate matter: those
 * arrive as strings from the database and want none of this.
 */

import { parseSpec, SurfaceLanguage } from "@aufbau/syntax";
import carnapProp from "./carnap-prop.mm0" with { type: "text" };
import forallxCalgary2019 from "./forallx-calgary-2019.mm0" with {
  type: "text",
};

/**
 * Every spec that ships, by the id an author names it with. The ids match the
 * incumbent `exercises/first-order/dialect.ts` where a language exists in
 * both, so content authored against `system=` keeps working when the exercise
 * types swap over.
 */
export const LANGUAGE_SPEC_SOURCES: Readonly<Record<string, string>> = {
  "carnap-prop": carnapProp,
  "forallx-calgary-2019": forallxCalgary2019,
};

/** Reading a spec builds tables; every caller shares one per language. */
const languages = new Map<string, SurfaceLanguage>();

/**
 * The language an author named, or `null` if no such spec ships.
 *
 * A spec that fails to read is a bug in this directory rather than anything a
 * reader did, so it throws instead of degrading: the specs are ours, they are
 * fixed at build time, and `tests/language-specs.test.ts` reads every one of
 * them clean.
 */
export function languageById(id: string): SurfaceLanguage | null {
  const cached = languages.get(id);

  if (cached !== undefined) {
    return cached;
  }

  const source = LANGUAGE_SPEC_SOURCES[id];

  if (source === undefined) {
    return null;
  }

  const { spec, diagnostics } = parseSpec(source);
  const errors = diagnostics.filter((one) => one.severity === "error");

  if (errors.length > 0) {
    throw new Error(
      `language spec ${id} does not read: ${errors
        .map((one) => `${one.id} (${one.message})`)
        .join("; ")}`,
    );
  }

  const language = new SurfaceLanguage(spec);
  languages.set(id, language);

  return language;
}
