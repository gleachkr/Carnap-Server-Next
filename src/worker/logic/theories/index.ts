/**
 * Carnap's built-in proof theories: one `.mm0` file per system a course can set
 * proofs in, and the one place their text lives.
 *
 * A theory is an ordinary MM0 theory — sorts, terms, notations, and the axioms
 * that are the system's rules — which the Aufbau compiler and verifier read
 * directly. An `:::aufbau-mm0` block names one by its path instead of carrying
 * three hundred lines of MM0 in the lesson source.
 *
 * **A theory may also be a language.** Both forallx files —
 * `forallx-calgary-2019.mm0` and `forallx-magnus.mm0` — carry
 * `@syntax` annotations and are registered by `../specs` under the language id
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
 * That is the seam the rest of the namespace grew into. **There are two
 * backings now.** A built-in answers from the module graph above; an
 * instructor-hosted theory is a URL under `/content/` (see
 * {@link hostedTheoryPath}) answered by a store read in the Worker and by a
 * same-origin fetch in the author's browser — which is how one address means
 * one thing in both places. A foreign origin is the branch after that, and is
 * still refused. What a path *means* did not change when the second backing
 * was added, and that is the property the namespace exists for.
 *
 * **Why `.mm0` files rather than string constants** is the argument in
 * `../specs/index.ts`, and the shape is the same: the import attribute costs no
 * loader configuration under workerd, `bun build`, or `bun test` alike (see
 * `src/text-modules.d.ts`). Unlike a spec, a theory is not parsed here — it is
 * text handed to the engine — so there is nothing for this module to validate.
 * What proves these good is that `scripts/forallx-verify.ts`,
 * `scripts/magnus-verify.ts` and `scripts/gentzen-verify.ts` compile real
 * proofs against them through the real compiler and verifier.
 */

import carnapProp from "./carnap-prop.mm0" with { type: "text" };
import forallxCalgary2019 from "./forallx-calgary-2019.mm0" with {
  type: "text",
};
import forallxMagnus from "./forallx-magnus.mm0" with { type: "text" };
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
  "forallx-magnus.mm0": forallxMagnus,
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

/**
 * The same artifacts by the *id* an exercise's `system=` names them with, which
 * is each file's stem.
 *
 * Two ways of naming one thing, and deliberately so. `src=` on a theory block
 * takes an address, because an address is a thing this site serves and a person
 * can open; `system=` on an exercise takes a name in scope, and the names in
 * scope are the blocks a document declares plus these. Keeping the id equal to
 * the stem is what stops those being two vocabularies for the same file — the
 * point `../specs` has made since it was written.
 */
export const BUILT_IN_SYSTEM_IDS: readonly string[] = Object.keys(
  THEORY_SOURCES,
)
  .map((fileName) => fileName.replace(/\.mm0$/, ""))
  .sort();

/**
 * How a caller answers for the paths this module cannot: an instructor-hosted
 * theory, whose bytes live in the database rather than in the module graph.
 *
 * `null` is the only failure, and that is a decision rather than a shortcut.
 * "No such revision", "that revision belongs to somebody else" and "that item
 * is a lesson, not a theory" are one miss, because telling them apart would
 * make `src=` an oracle for the existence of other people's revision ids.
 *
 * Async because one implementation reads a database and the other fetches;
 * built-ins never go through it, so the common lesson still compiles with no
 * server anywhere.
 */
export type TheoryResolver = (path: string) => Promise<string | null>;

/**
 * The other backing: where a theory an instructor *hosts* lives.
 *
 * A revision, never an item, and that is the whole safety property. A lesson
 * freezes the theory text when it compiles, so what a `src=` names has to stay
 * the thing that was frozen — an author revising their theory must not silently
 * repoint somebody's saved lesson at rules it was never checked against. A
 * revision is immutable, so naming one is immutable by construction rather than
 * by anybody remembering. There is deliberately no "latest" spelling.
 *
 * These two functions are the only place the shape of that path is written
 * down. Three readers have to agree on it — the route that serves the bytes,
 * the Worker resolver that reads them out of the database at compile time, and
 * the author's browser, which fetches the same URL to compile the live preview.
 */
export const HOSTED_THEORY_PREFIX = "/content/revisions/";

/**
 * Ends in `.mm0` so the address says what it is, and so it reads like the
 * built-in paths beside it in an authored line.
 */
export const HOSTED_THEORY_SUFFIX = "/theory.mm0";

/** Where the MM0 of a given content revision is served. */
export function hostedTheoryPath(revisionId: string): string {
  return `${HOSTED_THEORY_PREFIX}${revisionId}${HOSTED_THEORY_SUFFIX}`;
}

/**
 * The revision a hosted-theory path names, or `null` when the path is not one.
 *
 * Rejects an empty id and one carrying a `/` of its own, so that a resolver
 * cannot be talked into reading some other route's parameter as a revision id.
 */
export function hostedTheoryRevisionId(path: string): string | null {
  if (
    !path.startsWith(HOSTED_THEORY_PREFIX) ||
    !path.endsWith(HOSTED_THEORY_SUFFIX)
  ) {
    return null;
  }

  const id = path.slice(
    HOSTED_THEORY_PREFIX.length,
    path.length - HOSTED_THEORY_SUFFIX.length,
  );

  return id.length === 0 || id.includes("/") ? null : id;
}

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
