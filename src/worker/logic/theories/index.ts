/**
 * Carnap's built-in proof theories: one `.mm0` file per system a course can set
 * proofs in, and the one place their text lives.
 *
 * A theory is an ordinary MM0 theory — sorts, terms, notations, and the axioms
 * that are the system's rules — which the Aufbau compiler and verifier read
 * directly. An `:::aufbau-mm0` block names one by its path instead of carrying
 * three hundred lines of MM0 in the lesson source.
 *
 * **A theory may also be a language.** `forallx-calgary-2019.mm0` carries
 * `@syntax` annotations and is registered by `../specs` under the language id
 * of the same stem, so `system=` on a model or translation exercise and `src=`
 * on a proof exercise's theory block name the same bytes and cannot disagree
 * about what `A` means. Two things follow for anyone reading these files. The annotations
 * are *not* the engine's — `compileAufbauMm0` strips them where it freezes a
 * theory, and anything else handing this text to the compiler must too. And a
 * file that plays both roles cannot spell its context separator `,`, because
 * the comma is the student's argument separator; it says so itself with
 * `@syntax role context-join`, which is what the proof types read.
 *
 * **Everything is named by a URL.** These paths are real: the route at
 * {@link THEORY_ROUTE_PREFIX} serves this same text, so an author can open one
 * and read the rule names and the commentary that ships with them. The
 * compiler, though, never goes over the wire for a built-in — it answers from
 * the module graph below. Same address, same bytes, no network, which is what
 * lets a theory resolve identically in the worker, in the browser preview
 * (`src/client/editor-preview.ts` runs this compiler too), and in tests that
 * call `compileCarnapMarkdown` with no server anywhere.
 *
 * That is the seam the rest of the namespace grows into: an instructor-hosted
 * theory will be a URL under `/content/`, answered by a store read rather than
 * a fetch, and a foreign origin is the branch after that. What a path *means*
 * does not change when a backing is added.
 *
 * **Why `.mm0` files rather than string constants** is the argument in
 * `../specs/index.ts`, and the shape is the same: the import attribute costs no
 * loader configuration under workerd, `bun build`, or `bun test` alike (see
 * `src/text-modules.d.ts`). Unlike a spec, a theory is not parsed here — it is
 * text handed to the engine — so there is nothing for this module to validate.
 * What proves these two good is that `scripts/forallx-verify.ts` and
 * `scripts/gentzen-verify.ts` compile real proofs against them through the real
 * compiler and verifier.
 */

import carnapProp from "./carnap-prop.mm0" with { type: "text" };
import forallxCalgary2019 from "./forallx-calgary-2019.mm0" with {
  type: "text",
};
import gentzenLk from "./gentzen-lk.mm0" with { type: "text" };

/** Every built-in artifact's URL begins here, which is what the route matches on. */
export const THEORY_ROUTE_PREFIX = "/theories/";

/**
 * Every theory that ships, by the file name its URL ends with. Keyed with the
 * extension because that is what both the route parameter and the tail of an
 * authored `src=` hand back — one string to compare, no stem to reconstruct.
 */
export const THEORY_SOURCES: Readonly<Record<string, string>> = {
  "carnap-prop.mm0": carnapProp,
  "forallx-calgary-2019.mm0": forallxCalgary2019,
  "gentzen-lk.mm0": gentzenLk,
};

/**
 * Every built-in path, in the form an author writes. What a diagnostic lists
 * when the one they wrote names nothing.
 */
export const BUILT_IN_THEORY_PATHS: readonly string[] = Object.keys(
  THEORY_SOURCES,
)
  .map((fileName) => `${THEORY_ROUTE_PREFIX}${fileName}`)
  .sort();

/** The theory a file name under the route prefix stands for, or `null`. */
export function theorySourceByFileName(fileName: string): string | null {
  return THEORY_SOURCES[fileName] ?? null;
}

/**
 * The theory an author's path names, or `null` when no built-in answers to it —
 * including when the path is not under {@link THEORY_ROUTE_PREFIX} at all, since
 * to this resolver those are the same miss. Callers distinguish a remote URL
 * from a mistyped path before asking; see the `aufbau-mm0` compiler.
 */
export function theoryByPath(path: string): string | null {
  if (!path.startsWith(THEORY_ROUTE_PREFIX)) {
    return null;
  }

  return theorySourceByFileName(path.slice(THEORY_ROUTE_PREFIX.length));
}
