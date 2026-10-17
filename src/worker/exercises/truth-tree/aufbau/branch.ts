/**
 * What Carnap reads off a branch's rows itself, by the language's roles
 * (gh #46): which rows close it, which are literals (atomic or negated
 * atomic), which say `t = t`.
 *
 * Whether a branch marked open is complete is the engine's to say
 * (`./ok.ts`). That it is not closed is not: a certificate proves what holds,
 * and no theorem says a closure rule fails, so the rows that would close it
 * are found here, on the browser and on the server alike.
 *
 * DOM-free and free of i18n.
 */

import type { SurfaceLanguage, Term } from "@aufbau/syntax";
import { roleIndex, sentenceSort } from "../../../logic/specs/roles";
import type { TreeDevelopment } from "./criteria";
import { ruleMatches } from "./criteria";
import { termKey } from "./patterns";
import type { RowSortReader } from "./rows";

/** A row on a branch, read. */
export interface ReadRow {
  readonly id: string;
  readonly term: Term;
}

/**
 * A row's sentence: the row, where rows are sentences, or the argument at the
 * sentence sort of a signed row (`𝕋 A`). Null where it has none.
 */
function sentenceIn(language: SurfaceLanguage, row: Term): Term | null {
  const sort = sentenceSort(language);

  if (row.sort === sort) {
    return row;
  }

  return row.kind === "app"
    ? (row.args.find((argument) => argument.sort === sort) ?? null)
    : null;
}

/** The core roles of an atomic sentence's constructor; null is a predicate. */
const ATOMIC_ROLES: ReadonlySet<string | null> = new Set([
  null,
  "identity",
  "inequality",
  "falsum",
  "verum",
]);

/** Whether a row's sentence is atomic or a negated atomic one, by its roles. */
export function isLiteral(language: SurfaceLanguage, row: Term): boolean {
  const roles = roleIndex(language);
  const atomic = (term: Term | undefined): boolean =>
    term !== undefined &&
    (term.kind === "variable" || ATOMIC_ROLES.has(roles.roleOf(term.term)));
  const sentence = sentenceIn(language, row);

  return (
    sentence !== null &&
    (atomic(sentence) ||
      (sentence.kind === "app" &&
        roles.roleOf(sentence.term) === "negation" &&
        atomic(sentence.args[0])))
  );
}

/**
 * Whether a row says `t = t`, by the identity role: the sentence itself, or
 * a row asserting it (`𝕋 t = t`, by `tree.assert`). Denied, it closes the
 * branch instead.
 */
export function isSelfIdentity(
  language: SurfaceLanguage,
  row: Term,
): boolean {
  const roles = roleIndex(language);
  const sentence =
    row.sort === sentenceSort(language)
      ? row
      : row.kind === "app" && row.term === roles.termFor("tree.assert")
        ? sentenceIn(language, row)
        : null;
  const [left, right] = sentence?.kind === "app" ? sentence.args : [];

  return (
    sentence?.kind === "app" &&
    roles.roleOf(sentence.term) === "identity" &&
    left !== undefined &&
    right !== undefined &&
    termKey(language, left) === termKey(language, right)
  );
}

/** Whether a closure rule closes a branch on these rows, in any order. */
function closesOn(
  language: SurfaceLanguage,
  development: TreeDevelopment,
  terms: readonly Term[],
): boolean {
  return development.closure.some(
    (patterns) => !ruleMatches(language, patterns, terms, []).next().done,
  );
}

/**
 * How many rows each closure rule cites, fewest first: `[1, 2]` for UBC,
 * whose `×` cites a sentence and its negation, or `a≠a` alone.
 */
export function closureArities(
  development: TreeDevelopment,
): readonly number[] {
  return [
    ...new Set(development.closure.map((patterns) => patterns.focus.length)),
  ].sort((a, b) => a - b);
}

/**
 * The first rows, in branch order, that a closure rule closes the branch on:
 * as many as the rule cites, in any order. The first is the set whose last
 * row comes earliest, and of those the one a rule citing fewer rows closes.
 */
export function closing(
  language: SurfaceLanguage,
  development: TreeDevelopment,
  rows: readonly ReadRow[],
): readonly string[] | null {
  const arities = closureArities(development);
  // The rows before `before` taken `count` at a time, in branch order.
  const choose = function* (
    before: number,
    count: number,
  ): Generator<readonly ReadRow[]> {
    if (count === 0) {
      yield [];
      return;
    }

    for (let at = count - 1; at < before; at += 1) {
      for (const chosen of choose(at, count - 1)) {
        yield [...chosen, rows[at] as ReadRow];
      }
    }
  };

  for (const [at, row] of rows.entries()) {
    for (const arity of arities) {
      for (const earlier of choose(at, arity - 1)) {
        const chosen = [...earlier, row];

        if (
          closesOn(
            language,
            development,
            chosen.map((each) => each.term),
          )
        ) {
          return chosen.map((each) => each.id);
        }
      }
    }
  }

  return null;
}

/**
 * Whether these rows, as typed, close a branch by a closure rule, in any
 * order: a sentence and its negation, or `a≠a` alone, under UBC.
 */
export function closesBranch(
  development: TreeDevelopment,
  reader: RowSortReader,
  texts: readonly string[],
): boolean {
  const terms: Term[] = [];

  for (const text of texts) {
    const read = reader.read(text);

    if (!read.ok) {
      return false;
    }

    terms.push(read.term);
  }

  return closesOn(reader.language, development, terms);
}
