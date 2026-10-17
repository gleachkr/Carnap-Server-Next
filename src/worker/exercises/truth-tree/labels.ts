/**
 * What a tree shows beside its rows, as text: the names a mark lists.
 *
 * Names are spelled by the language, so a UBC tree's marks read `✓a₁` and
 * `\a,b`, in the book's own glyphs, and a modal tree's `\1.1,1.2`. (The margin's rule is the student's, as
 * typed: see `annotations.ts`.)
 *
 * DOM-free and free of i18n.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import { individualSorts } from "../../logic/specs/roles";
import { displayText, readEngine } from "./aufbau/rows";
import type { RowMark } from "./report";

/**
 * An instance as the language shows it: `a₁` for the identifier `a1`, `1.1`
 * for the prefix `1 . wa`. Read at the individual sort first, then at any
 * sort that reads it; as it is if none does.
 */
export function displayName(name: string, language: SurfaceLanguage): string {
  const sorts = [
    ...new Set([...individualSorts(language), ...language.spec.sorts.keys()]),
  ];

  for (const sort of sorts) {
    const term = readEngine(language, name, sort);

    if (term !== null) {
      return displayText(language, term) ?? name;
    }
  }

  return name;
}

/** A row's computed mark: `✓`, `✓a`, or `\a,b`. */
export function markText(mark: RowMark, language: SurfaceLanguage): string {
  const names = mark.names.map((name) => displayName(name, language));

  return mark.type === "resolved"
    ? `✓${names.join(",")}`
    : `\\${names.join(",")}`;
}
