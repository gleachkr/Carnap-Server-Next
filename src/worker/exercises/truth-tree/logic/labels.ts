/**
 * What a tree shows beside its rows, as text: the rule a margin names, the
 * names a mark lists, and a row's number with its rule.
 *
 * Everything is spelled by the language, so a UBC tree's margin reads `1 ∨`
 * and `2 ¬&`, its marks `✓a₁` and `\a,b`, in the book's own glyphs.
 *
 * DOM-free and free of i18n.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import { printTerm } from "@aufbau/syntax";
import { roleForBinaryConnective } from "../../../logic/specs/connectives";
import { individualSorts, roleIndex } from "../../../logic/specs/roles";
import type { Justification, RowMark } from "./check";
import type { RuleName } from "./rules";

/**
 * A rule's name in the margin: `∨`, `¬∨`, `¬¬`, `∀`, `¬∃`, `=`.
 *
 * Each symbol is the language's spelling of its role, or, for a constructor
 * with no notation, its name: such a term is typed by name, as MM0 applies
 * it (`not P`), so the margin reads `3 not`, and a name is spaced from its
 * neighbour (`not and`). A rule is named for a row the language read, so a
 * constructor plays each role in the name.
 */
export function ruleLabel(name: RuleName, language: SurfaceLanguage): string {
  const index = roleIndex(language);
  const spell = (role: string): { text: string; named: boolean } => {
    const spelling = index.spellingFor(role);

    if (spelling !== null) {
      return { named: false, text: spelling };
    }

    const term = index.termFor(role);

    if (term === null) {
      throw new Error(`The language has no ${role}.`);
    }

    return { named: true, text: term };
  };
  const head = spell(
    name.head.type === "binary"
      ? roleForBinaryConnective(name.head.connective)
      : name.head.type === "not"
        ? "negation"
        : name.head.type,
  );

  if (!name.negated) {
    return head.text;
  }

  const not = spell("negation");

  return `${not.text}${not.named || head.named ? " " : ""}${head.text}`;
}

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

/**
 * A development's margin note: the cited row's number and the rule's name,
 * or `?` for a rule the cited row does not have. `null` for an uncited row.
 */
export function marginText(
  justification: Justification | undefined,
  number: (rowId: string) => string,
  language: SurfaceLanguage,
): string | null {
  if (justification === undefined || justification.cites.length === 0) {
    return null;
  }

  const cited = justification.cites.map(number).join(", ");

  return justification.rule === null
    ? `${cited} ?`
    : `${cited} ${ruleLabel(justification.rule, language)}`;
}
