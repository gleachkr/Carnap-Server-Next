/**
 * What a binary `@syntax role` *means*: the truth function it computes.
 *
 * `roles.ts` beside this reads a role off a constructor and says how it is
 * spelled; it stops there, because a role is just a name. This module is the
 * other half for the sentential ones — the table that says `nand` denotes
 * ¬(p∧q), and the union of node types the two formula readers share.
 *
 * **All sixteen, not the five a textbook opens with.** There are exactly
 * sixteen binary truth functions, and which subset a course takes as primitive
 * is a textbook's choice rather than ours: Quine teaches the Sheffer stroke,
 * plenty of intro books do exclusive disjunction, and a digital-logic course
 * wants NAND and NOR before anything else. Naming all sixteen means an
 * instructor extends `carnap-prop` in an `aufbau-mm0` block with whatever
 * their book uses and the truth table and the model both read it, with no
 * change here. The six degenerate ones (the projections, their negations, and
 * the two constant functions) are named for the same reason the other ten are:
 * the list of readable roles is closed, and a hole in it is a construct that
 * gets refused for no reason anyone can act on.
 *
 * The role vocabulary is Carnap's, not the library's — `@aufbau/syntax`
 * records roles and interprets none of them. Adding one here is what makes it
 * writable in a spec.
 *
 * DOM-free and free of i18n, like everything the client elements import.
 */

/**
 * A binary connective, as the two formula trees name it.
 *
 * The four a spec has always been able to declare keep their short names,
 * which are spelled through half the codebase; the twelve added later are
 * named by their role, so there is one string to remember rather than two. The
 * mapping is {@link CONNECTIVE_ROLES}, and it is the only place the two
 * conventions meet.
 */
export type BinaryConnective =
  | "and"
  | "or"
  | "if"
  | "iff"
  | "nand"
  | "nor"
  | "xor"
  | "converse-conditional"
  | "non-conditional"
  | "converse-non-conditional"
  | "left-projection"
  | "right-projection"
  | "negated-left-projection"
  | "negated-right-projection"
  | "binary-verum"
  | "binary-falsum";

/**
 * The `@syntax role` each connective is declared under.
 *
 * `exclusive-disjunction` rather than `xor` keeps the register of the roles
 * that were here first (`conjunction`, `biconditional`); `nand` and `nor` are
 * the names every author would actually reach for, and `alternative denial`
 * and `joint denial` would not have been.
 */
const CONNECTIVE_ROLES: Record<BinaryConnective, string> = {
  and: "conjunction",
  "binary-falsum": "binary-falsum",
  "binary-verum": "binary-verum",
  "converse-conditional": "converse-conditional",
  "converse-non-conditional": "converse-non-conditional",
  if: "conditional",
  iff: "biconditional",
  "left-projection": "left-projection",
  nand: "nand",
  "negated-left-projection": "negated-left-projection",
  "negated-right-projection": "negated-right-projection",
  "non-conditional": "non-conditional",
  nor: "nor",
  or: "disjunction",
  "right-projection": "right-projection",
  xor: "exclusive-disjunction",
};

/** Every binary connective, so a caller can build a table over all of them. */
export const BINARY_CONNECTIVES = Object.keys(
  CONNECTIVE_ROLES,
) as readonly BinaryConnective[];

const ROLE_CONNECTIVES = new Map<string, BinaryConnective>(
  BINARY_CONNECTIVES.map((connective) => [
    CONNECTIVE_ROLES[connective],
    connective,
  ]),
);

/** The connective a role denotes, or `null` if the role is not a binary one. */
export function binaryConnectiveForRole(
  role: string,
): BinaryConnective | null {
  return ROLE_CONNECTIVES.get(role) ?? null;
}

/** The `@syntax role` a connective is declared under. */
export function roleForBinaryConnective(
  connective: BinaryConnective,
): string {
  return CONNECTIVE_ROLES[connective];
}

/**
 * The truth function itself, and the whole of what a connective *is* here.
 *
 * Written out rather than derived from a four-bit table because this is the
 * definition a reader checks against, and `!left && right` says which function
 * it is where `0b0100` does not.
 */
const TRUTH_FUNCTIONS: Record<
  BinaryConnective,
  (left: boolean, right: boolean) => boolean
> = {
  and: (left, right) => left && right,
  "binary-falsum": () => false,
  "binary-verum": () => true,
  // q → p. Not the conditional with its operands swapped at the call site:
  // which operand is which is what a truth table's columns are about.
  "converse-conditional": (left, right) => left || !right,
  "converse-non-conditional": (left, right) => !left && right,
  if: (left, right) => !left || right,
  iff: (left, right) => left === right,
  "left-projection": (left) => left,
  nand: (left, right) => !(left && right),
  "negated-left-projection": (left) => !left,
  "negated-right-projection": (_left, right) => !right,
  "non-conditional": (left, right) => left && !right,
  nor: (left, right) => !(left || right),
  or: (left, right) => left || right,
  "right-projection": (_left, right) => right,
  xor: (left, right) => left !== right,
};

/** Apply a connective to the values of its operands. */
export function applyBinaryConnective(
  connective: BinaryConnective,
  left: boolean,
  right: boolean,
): boolean {
  return TRUTH_FUNCTIONS[connective](left, right);
}

/**
 * What a connective is written as when the spec declares its role but gives
 * the constructor no notation to report.
 *
 * Unreachable for anything an author can actually write — a connective with no
 * notation cannot be typed, so no formula can contain one — and here so that a
 * printer emits a symbol rather than `undefined`. The glyphs are the standard
 * ones; the six degenerate functions have no standard glyph and are written as
 * the equivalent a reader can decode.
 */
export const DEFAULT_BINARY_SPELLING: Record<BinaryConnective, string> = {
  and: "∧",
  "binary-falsum": "⊥",
  "binary-verum": "⊤",
  "converse-conditional": "←",
  "converse-non-conditional": "↚",
  if: "→",
  iff: "↔",
  "left-projection": "π₁",
  nand: "↑",
  "negated-left-projection": "¬π₁",
  "negated-right-projection": "¬π₂",
  "non-conditional": "↛",
  nor: "↓",
  or: "∨",
  "right-projection": "π₂",
  xor: "⊻",
};
