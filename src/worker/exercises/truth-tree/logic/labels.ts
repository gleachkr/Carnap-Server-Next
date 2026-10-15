/**
 * What a tree shows beside its rows, as text: the names a mark lists.
 *
 * Names are spelled by the language, so a UBC tree's marks read `✓a₁` and
 * `\a,b`, in the book's own glyphs. (The margin's rule is the student's, as
 * typed: see `annotations.ts`.)
 *
 * DOM-free and free of i18n.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import { printTerm } from "@aufbau/syntax";
import { individualSorts } from "../../../logic/specs/roles";
import type { RowMark } from "./check";

/** A name as the language shows it: `a₁` for the identifier `a1`. */
function displayName(name: string, language: SurfaceLanguage): string {
  const sort = individualSorts(language)[0];

  if (sort === undefined) {
    return name;
  }

  const read = language.parse(name, { lints: false, mode: "engine", sort });

  if (!read.ok) {
    return name;
  }

  try {
    return printTerm(language, read.term, "display");
  } catch {
    return name;
  }
}

/** A row's computed mark: `✓`, `✓a`, or `\a,b`. */
export function markText(mark: RowMark, language: SurfaceLanguage): string {
  const names = mark.names.map((name) => displayName(name, language));

  return mark.type === "resolved"
    ? `✓${names.join(",")}`
    : `\\${names.join(",")}`;
}
