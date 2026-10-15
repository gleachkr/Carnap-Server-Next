/**
 * Reading a tree's rows at the theory's row sort, and writing them back.
 *
 * A row is whatever the tree theory's row sort reads: a sentence for UBC, a
 * signed sentence for a Smullyan tableau. Every row is read on every check,
 * and the browser checks on every edit, so the reader remembers what it has
 * read, by text.
 *
 * DOM-free and free of i18n.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import { printTerm, UnprintableTermError } from "@aufbau/syntax";
import type { ParseError } from "../../../exercise-kit/formula";
import { formulaParseErrors } from "../../../logic/specs/diagnostics";

/** The most distinct texts a reader remembers before it starts again. */
const CACHE_LIMIT = 2000;

/** A row read: its engine text, or why it does not read. */
export type RowRead =
  | { readonly ok: true; readonly engine: string }
  | { readonly ok: false; readonly errors: readonly ParseError[] };

export interface RowSortReader {
  readonly language: SurfaceLanguage;
  readonly sort: string;
  /** A row as the student typed it. */
  read(text: string): RowRead;
}

/** A reader for one language's rows that remembers what it has read. */
export function rowSortReader(
  language: SurfaceLanguage,
  sort: string,
): RowSortReader {
  const cache = new Map<string, RowRead>();

  return {
    language,
    read(text: string): RowRead {
      const key = text.trim();
      let result = cache.get(key);

      if (result === undefined) {
        if (cache.size >= CACHE_LIMIT) {
          cache.clear();
        }

        const parsed = language.parse(key, { sort });
        result = parsed.ok
          ? { engine: printTerm(language, parsed.term, "engine"), ok: true }
          : { errors: formulaParseErrors(parsed.diagnostics), ok: false };
        cache.set(key, result);
      }

      return result;
    },
    sort,
  };
}

/** A row's engine text as a reader is shown it, or `null` if it does not read. */
export function displayRow(
  engine: string,
  language: SurfaceLanguage,
  sort: string,
): string | null {
  const parsed = language.parse(engine, {
    lints: false,
    mode: "engine",
    sort,
  });

  if (!parsed.ok) {
    return null;
  }

  try {
    return printTerm(language, parsed.term, "display");
  } catch (error) {
    if (error instanceof UnprintableTermError) {
      return null;
    }

    throw error;
  }
}
