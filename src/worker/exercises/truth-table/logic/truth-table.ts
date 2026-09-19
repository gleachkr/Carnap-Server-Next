/**
 * Truth-table semantics: collect a formula's atoms, enumerate every
 * valuation, and evaluate a formula under one. The table itself — which
 * cells a formula has, and what each is worth — is `grading.ts`'s
 * `resolveTable` and `correctCells`, over the layout in `layout.ts`. DOM-free
 * — shared by the worker (compile + authoritative grade) and the client
 * element (local check).
 */

import { applyBinaryConnective } from "../../../logic/specs/connectives";
import type { Formula } from "./formula";

/**
 * The largest number of distinct atoms a table may contain. Guards against an
 * author accidentally requesting 2ⁿ rows for pathological n; 12 atoms is 4096
 * rows, already far past anything usable. Adjustable if a real problem needs
 * more.
 */
export const MAX_TABLE_ATOMS = 12;

function collectAtomsInto(formula: Formula, into: Set<string>): void {
  switch (formula.type) {
    case "atom":
      into.add(formula.name);
      return;
    // A truth constant is a column, never a reference column: there is nothing
    // to vary.
    case "verum":
    case "falsum":
      return;
    case "not":
      collectAtomsInto(formula.operand, into);
      return;
    default:
      collectAtomsInto(formula.left, into);
      collectAtomsInto(formula.right, into);
  }
}

/** The distinct atoms in one or more formulas, in canonical (sorted) order. */
export function collectAtoms(formulas: readonly Formula[]): string[] {
  const atoms = new Set<string>();

  for (const formula of formulas) {
    collectAtomsInto(formula, atoms);
  }

  // A plain string sort. The atoms are whatever the spec declares, and
  // `carnap-prop` declares 52 single letters — the numeric-aware comparator
  // that used to sit here existed for the hand parser's unbounded subscripts
  // (`P2` before `P10`), which an MM0 signature cannot spell.
  return [...atoms].sort();
}

/**
 * Every valuation of `atoms`, as rows of booleans aligned to `atoms`. Canonical
 * textbook order: the top row is all-true, the leftmost atom toggles slowest,
 * and the bottom row is all-false.
 */
export function enumerateValuations(atoms: readonly string[]): boolean[][] {
  const count = atoms.length;
  const rows: boolean[][] = [];

  for (let index = 0; index < 1 << count; index += 1) {
    const row: boolean[] = [];

    for (let position = 0; position < count; position += 1) {
      // Bit 0 → true, so index 0 is the all-true row.
      row.push(((index >> (count - 1 - position)) & 1) === 0);
    }

    rows.push(row);
  }

  return rows;
}

/** Evaluate a formula under a valuation mapping each atom to a truth value. */
export function evaluate(
  formula: Formula,
  valuation: ReadonlyMap<string, boolean>,
): boolean {
  switch (formula.type) {
    case "atom": {
      const value = valuation.get(formula.name);

      if (value === undefined) {
        throw new Error(`No valuation for atom '${formula.name}'.`);
      }

      return value;
    }
    case "verum":
      return true;
    case "falsum":
      return false;
    case "not":
      return !evaluate(formula.operand, valuation);
    default:
      return applyBinaryConnective(
        formula.type,
        evaluate(formula.left, valuation),
        evaluate(formula.right, valuation),
      );
  }
}
