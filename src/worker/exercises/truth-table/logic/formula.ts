/**
 * Formula syntax for the truth-table exercise type.
 *
 * The language is not written here. It is `logic/theories/carnap-prop.mm0`,
 * registered as a language by `logic/specs` — an
 * ordinary MM0 signature with `@syntax` annotations, read by `@aufbau/syntax`
 * — and this module only converts what that parser returns into the
 * {@link Formula} tree a table is built from, and writes one back out. The
 * spec is the same kind of artifact a proof exercise's `theory=` names, and
 * the same kind the model and translation types read; before it there were
 * two hand parsers here and next door, with no way to make a course's truth
 * tables and its models agree about what `A` means.
 *
 * This module is DOM-free and imported by BOTH the worker (to compile a table
 * and grade authoritatively) and the client element (for instant local
 * checking), so it must not reach for any platform globals. The spec arrives
 * as a text import: no fetch, and the same reading on both sides.
 *
 * Notation is Carnap's default `prop` system:
 *   - `~`    negation      (unary prefix)
 *   - `/\`   conjunction
 *   - `\/`   disjunction
 *   - `->`   conditional   (right-associative)
 *   - `<->`  biconditional
 * Sentence letters are a single Roman letter of either case. The hand parser
 * this replaced also read a bare-digit subscript (`P0`, `R12`); an MM0
 * signature is a finite vocabulary and cannot spell an unbounded one, and
 * Graham's call on 2026-08-24 was to accept the loss rather than hold the
 * unification for a library feature to restore it.
 *
 * Precedence, loosest to tightest: `<->` < `->` < `\/` < `/\` < `~`.
 * `/\`, `\/`, and `<->` are left-associative; `->` is right-associative.
 */

import type { SurfaceLanguage, Term as SurfaceTerm } from "@aufbau/syntax";
import { languageById, languageFromSource } from "../../../logic/specs";
import type { FormulaParseError } from "../../../logic/specs/diagnostics";
import { formulaParseErrors } from "../../../logic/specs/diagnostics";
import { hasQuantifiers, roleIndex } from "../../../logic/specs/roles";

export type BinaryConnective = "and" | "or" | "if" | "iff";

export type Formula =
  | { readonly type: "atom"; readonly name: string }
  | { readonly type: "not"; readonly operand: Formula }
  | {
      readonly type: BinaryConnective;
      readonly left: Formula;
      readonly right: Formula;
    };

export type ParseError = FormulaParseError;

export type ParseResult =
  | { readonly ok: true; readonly formula: Formula }
  | { readonly ok: false; readonly errors: readonly ParseError[] };

/**
 * What `system=` means on a truth table when the author does not write it.
 *
 * A default rather than the only possibility: a truth table is propositional,
 * but so is any number of textbooks' propositional notations, and there is no
 * reason this type alone should be unable to point at one. What it will not
 * take is a language with binders — see {@link truthTableLanguage}.
 */
export const PROP_LANGUAGE_ID = "carnap-prop";

/**
 * A spec node this module cannot read as a propositional formula.
 *
 * Only reachable through a spec that gives a constructor a role we have no
 * case for — an authoring mistake in the spec, not something a student
 * can type.
 */
class Unreadable extends Error {}

/** Built once; a language is tables, not data. */
function prop(): SurfaceLanguage {
  const found = languageById(PROP_LANGUAGE_ID);

  if (found === null) {
    throw new Error(`the ${PROP_LANGUAGE_ID} spec is no longer registered`);
  }

  return found;
}

function operand(
  node: SurfaceTerm | undefined,
  lang: SurfaceLanguage,
): Formula {
  if (node === undefined) {
    throw new Unreadable("a connective missing an argument");
  }

  return readFormula(node, lang);
}

/**
 * One parsed node as a formula, dispatched on its `@syntax role`. A
 * constructor with no role is a sentence letter — the whole open-ended half
 * of a propositional language.
 */
function readFormula(node: SurfaceTerm, lang: SurfaceLanguage): Formula {
  if (node.kind === "variable") {
    throw new Unreadable("a variable in a propositional language");
  }

  const role = roleIndex(lang).roleOf(node.term);

  switch (role) {
    case null:
      return { name: node.term, type: "atom" };
    case "negation":
      return { operand: operand(node.args[0], lang), type: "not" };
    case "conjunction":
      return {
        left: operand(node.args[0], lang),
        right: operand(node.args[1], lang),
        type: "and",
      };
    case "disjunction":
      return {
        left: operand(node.args[0], lang),
        right: operand(node.args[1], lang),
        type: "or",
      };
    case "conditional":
      return {
        left: operand(node.args[0], lang),
        right: operand(node.args[1], lang),
        type: "if",
      };
    case "biconditional":
      return {
        left: operand(node.args[0], lang),
        right: operand(node.args[1], lang),
        type: "iff",
      };
    default:
      throw new Unreadable(`a constructor with the role ${role}`);
  }
}

/**
 * Parse a single propositional formula, collecting every syntax error it has.
 *
 * The language is a parameter rather than this module's own, because a truth
 * table names one in `system=` like every other type that reads a formula. It
 * defaults to the shipped `carnap-prop` for the callers holding an artifact
 * compiled before the attribute existed.
 */
export function parseFormula(
  source: string,
  lang: SurfaceLanguage = prop(),
): ParseResult {
  const result = lang.parse(source);

  if (!result.ok) {
    return { errors: formulaParseErrors(result.diagnostics), ok: false };
  }

  try {
    return { formula: readFormula(result.term, lang), ok: true };
  } catch (error) {
    if (error instanceof Unreadable) {
      return {
        errors: [{ message: "This formula could not be read.", position: 0 }],
        ok: false,
      };
    }

    throw error;
  }
}

/**
 * Render a formula back to canonical `prop` source (fully parenthesized).
 *
 * The symbols are the spec's canonical spelling of each role — its
 * last-declared notation. `carnap-prop` declares nothing but ASCII, so this
 * is the ASCII a student types, and a compiled table stores exactly what it
 * always did. A spec that added `∧` as a later notation would change both
 * together, which is the point of reading them from one place.
 */
export function formulaToString(
  formula: Formula,
  lang: SurfaceLanguage = prop(),
): string {
  const index = roleIndex(lang);
  const of = (role: string, fallback: string): string =>
    index.spellingFor(role) ?? fallback;
  const spelling = {
    and: of("conjunction", "/\\"),
    if: of("conditional", "->"),
    iff: of("biconditional", "<->"),
    not: of("negation", "~"),
    or: of("disjunction", "\\/"),
  };

  const write = (part: Formula): string => {
    switch (part.type) {
      case "atom":
        return part.name;
      case "not":
        return `${spelling.not}${write(part.operand)}`;
      default:
        return `(${write(part.left)} ${spelling[part.type]} ${write(part.right)})`;
    }
  };

  return write(formula);
}

/**
 * The language a truth-table exercise is set in, or `null` where its stored
 * data no longer names one.
 *
 * The mirror of `first-order`'s reader, and refusing the opposite thing: a
 * language with binders is not one a truth table can be set in, because a
 * quantifier is a construct its columns have no cell for. `source` is the
 * language's own text, joined in from the document's systems table; `dialect`
 * and the absence of both fall back to what this type has always spoken.
 */
export function truthTableLanguage(data: {
  readonly dialect?: string;
  readonly source?: string;
}): SurfaceLanguage | null {
  const language =
    data.source === undefined
      ? languageById(data.dialect ?? PROP_LANGUAGE_ID)
      : languageFromSource(data.source);

  return language === null || hasQuantifiers(language) ? null : language;
}
