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

import type { Scope, SurfaceLanguage, Term } from "@aufbau/syntax";
import { printTerm, UnprintableTermError } from "@aufbau/syntax";
import type { TableauRow } from "../../../../tableau/document";
import type { ParseError } from "../../../exercise-kit/formula";
import { formulaParseErrors } from "../../../logic/specs/diagnostics";
import type { TreeTheory } from "./theory";

/** The most distinct texts a reader remembers before it starts again. */
const CACHE_LIMIT = 2000;

/** A row read: its engine text and term, or why it does not read. */
export type RowRead =
  | { readonly ok: true; readonly engine: string; readonly term: Term }
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
          ? {
              engine: printTerm(language, parsed.term, "engine"),
              ok: true,
              term: parsed.term,
            }
          : { errors: formulaParseErrors(parsed.diagnostics), ok: false };
        cache.set(key, result);
      }

      return result;
    },
    sort,
  };
}

/**
 * Engine text read at a sort, with a theorem's binders in scope where it is
 * given; null where it does not read. Without the spec's lints, which are
 * conventions about what a person may type.
 */
export function readEngine(
  language: SurfaceLanguage,
  text: string,
  sort: string,
  scope?: Scope,
): Term | null {
  const read = language.parse(text.trim(), {
    lints: false,
    mode: "engine",
    sort,
    ...(scope === undefined ? {} : { scope }),
  });

  return read.ok ? read.term : null;
}

/**
 * A term as a reader is shown it; null for what engine text can spell and
 * display text cannot (an elided term).
 */
export function displayText(
  language: SurfaceLanguage,
  term: Term,
): string | null {
  try {
    return printTerm(language, term, "display");
  } catch (error) {
    if (error instanceof UnprintableTermError) {
      return null;
    }

    throw error;
  }
}

/**
 * Whether a row is the root row the exercise declares: `expected`, read at
 * the row sort, and citing nothing.
 */
export function isDeclaredRoot(
  reader: RowSortReader,
  row: TableauRow | undefined,
  expected: string,
): boolean {
  if (row === undefined || row.cites.length > 0) {
    return false;
  }

  const read = reader.read(row.text);
  return read.ok && read.engine === expected;
}

/** A row's engine text as a reader is shown it, or `null` if it does not read. */
export function displayRow(
  engine: string,
  language: SurfaceLanguage,
  sort: string,
): string | null {
  const term = readEngine(language, engine, sort);
  return term === null ? null : displayText(language, term);
}

/**
 * A member of a branch, as engine text, with the development that wrote it
 * and the row it is, or is the mark beside; null for the mark of the row a
 * development cites.
 */
export interface Member {
  readonly text: string;
  readonly dev: string;
  readonly row: string | null;
}

/** A branch of rows, as engine text: joined, or the empty branch. */
export function branchText(
  theory: TreeTheory,
  rows: readonly string[],
): string {
  return rows.length === 0 && theory.empty !== null
    ? theory.empty.engine
    : rows.map((row) => `(${row})`).join(` ${theory.join} `);
}

/**
 * Every token of engine text, for finding the names and variables in it.
 * Splitting is sound on what the engine printer writes, which sets every
 * token apart by a space or a bracket (a question's bindings by commas too);
 * the statements it is asked of are built from printed rows, too many and
 * too long to read back as terms.
 */
export function engineTokens(engine: string): string[] {
  return engine.split(/[\s(),]+/u).filter((token) => token.length > 0);
}
