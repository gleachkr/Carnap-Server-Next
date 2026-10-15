/**
 * Reading a tree's rows, and writing formulas back for display.
 *
 * Every row of a tree is parsed on every check, and the browser checks on
 * every edit, so the reader caches by text: a row is parsed once for each
 * distinct thing typed in it. That matters for a language like `forallx-ubc`,
 * whose subscripted names cost each parse a pass per elab rule.
 *
 * Display text comes from `@aufbau/syntax`'s own printer, not the kit's
 * `formulaToString`, because the printer is what applies a language's
 * invertible elab rules: it writes `a₁` for the name `a1` and `a≠b` for
 * `¬a=b`, as the book does.
 *
 * DOM-free and free of i18n.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import { printTerm, UnprintableTermError } from "@aufbau/syntax";
import type { Formula, ParseResult } from "../../../exercise-kit/formula";
import { formulaToString, parseFormula } from "../../../exercise-kit/formula";
import { sentenceSort } from "../../../logic/specs/roles";

/** The most distinct texts a reader remembers before it starts again. */
const CACHE_LIMIT = 2000;

export interface RowReader {
  readonly language: SurfaceLanguage;
  read(text: string): ParseResult;
}

/** A parser for one language that remembers what it has read. */
export function rowReader(language: SurfaceLanguage): RowReader {
  const cache = new Map<string, ParseResult>();

  return {
    language,
    read(text: string): ParseResult {
      const key = text.trim();
      let result = cache.get(key);

      if (result === undefined) {
        if (cache.size >= CACHE_LIMIT) {
          cache.clear();
        }

        result = parseFormula(key, language);
        cache.set(key, result);
      }

      return result;
    },
  };
}

/** Stored engine text as a reader is shown it, or `null` if it does not read. */
export function displayEngine(
  engine: string,
  language: SurfaceLanguage,
): string | null {
  const sort = sentenceSort(language);
  const result = language.parse(engine, {
    lints: false,
    mode: "engine",
    ...(sort === undefined ? {} : { sort }),
  });

  if (!result.ok) {
    return null;
  }

  try {
    return printTerm(language, result.term, "display");
  } catch (error) {
    if (error instanceof UnprintableTermError) {
      return null;
    }

    throw error;
  }
}

/**
 * A formula the checker built (a root's negated conclusion) as engine text,
 * or `null` if the language cannot say it.
 *
 * Written out with the kit's printer and read back, since only a parse knows
 * the language's engine spelling. That printer brackets every binary
 * compound, which every language here reads.
 */
export function engineText(
  formula: Formula,
  language: SurfaceLanguage,
): string | null {
  const read = parseFormula(formulaToString(formula, language), language);
  return read.ok ? read.engine : null;
}

/** Whether a formula says anything with identity. */
export function usesIdentity(formula: Formula): boolean {
  switch (formula.type) {
    case "identity":
      return true;
    case "predicate":
    case "falsum":
    case "verum":
      return false;
    case "not":
      return usesIdentity(formula.operand);
    case "forall":
    case "exists":
      return usesIdentity(formula.body);
    default:
      return usesIdentity(formula.left) || usesIdentity(formula.right);
  }
}
