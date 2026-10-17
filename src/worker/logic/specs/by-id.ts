/**
 * The languages exercise data names by id rather than carrying as text, read
 * without the theory registry.
 *
 * Exercise data carries its language as text (`source`, joined in from the
 * document's systems table) everywhere but two places: a truth table with no
 * `system=` reads `carnap-prop`, and a model or translation exercise compiled
 * before the systems table names its language by a bare `dialect` id. Those
 * are read in the browser too, so this module imports just those files. The
 * registry of every shipped language (`./index.ts`) imports the whole theory
 * directory, and a widget that reached it would carry every theory there in
 * its bundle: the Open Logic tableaux into a truth table's.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import carnapProp from "../theories/carnap-prop.mm0" with { type: "text" };
import forallxCalgary from "../theories/forallx-calgary.mm0" with {
  type: "text",
};
import { readLanguage } from "./read";

/** The named languages, by id: each its file's stem, as in `./index.ts`. */
export const NAMED_LANGUAGE_SOURCES: Readonly<Record<string, string>> = {
  "carnap-prop": carnapProp,
  "forallx-calgary": forallxCalgary,
};

/**
 * A shipped spec's language. One that fails to read is a bug in this
 * directory rather than anything a reader did, so it throws instead of
 * degrading: the specs are ours, fixed at build time, and
 * `tests/language-specs.test.ts` reads every one of them clean.
 */
export function shippedLanguage(id: string, source: string): SurfaceLanguage {
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

/** The language exercise data names by `id`, or `null` if none ships so. */
export function namedLanguage(id: string): SurfaceLanguage | null {
  const source = NAMED_LANGUAGE_SOURCES[id];

  return source === undefined ? null : shippedLanguage(id, source);
}
