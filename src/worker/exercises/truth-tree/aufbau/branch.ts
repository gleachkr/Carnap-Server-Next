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

/**
 * The first rows, in branch order, that a closure rule closes the branch on:
 * one row, or two in either order.
 */
export function closing(
  language: SurfaceLanguage,
  development: TreeDevelopment,
  rows: readonly ReadRow[],
): readonly string[] | null {
  const closes = (terms: readonly Term[]): boolean =>
    development.closure.some(
      (patterns) => !ruleMatches(language, patterns, terms, []).next().done,
    );

  for (const [at, row] of rows.entries()) {
    if (closes([row.term])) {
      return [row.id];
    }

    for (const earlier of rows.slice(0, at)) {
      if (closes([earlier.term, row.term])) {
        return [earlier.id, row.id];
      }
    }
  }

  return null;
}

/** Whether a row closes a branch by itself, under the theory: `a≠a`. */
export function closesAlone(
  development: TreeDevelopment,
  reader: RowSortReader,
  text: string,
): boolean {
  const read = reader.read(text);

  return (
    read.ok &&
    closing(reader.language, development, [{ id: "", term: read.term }]) !==
      null
  );
}
