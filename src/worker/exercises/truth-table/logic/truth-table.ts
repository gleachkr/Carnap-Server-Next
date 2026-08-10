/**
 * Truth-table semantics for the `prop` system: collect a formula's atoms,
 * enumerate every valuation, evaluate sub-formulas, and assemble the full key
 * table an author's formulas define. DOM-free — shared by the worker (compile +
 * authoritative grade) and the client element (local check).
 */

import type { Formula, ParseError } from "./formula";
import { parseFormula } from "./formula";

/**
 * The largest number of distinct atoms a table may contain. Guards against an
 * author accidentally requesting 2ⁿ rows for pathological n; 12 atoms is 4096
 * rows, already far past anything usable. Adjustable if a real problem needs
 * more.
 */
export const MAX_TABLE_ATOMS = 12;

/** One column under a written-out formula: the sub-formula it evaluates. */
export interface FormulaColumn {
  readonly formula: Formula;
  /** True for the column under the formula's main connective (its root). */
  readonly isMain: boolean;
}

/** The compiled key for a single author formula. */
export interface FormulaTable {
  readonly source: string;
  readonly formula: Formula;
  /** Sub-formula columns in left-to-right display order. */
  readonly columns: readonly FormulaColumn[];
  /** Index into {@link columns} of the main connective's column. */
  readonly mainColumnIndex: number;
  /** `values[rowIndex][columnIndex]` — the correct value for each cell. */
  readonly values: readonly (readonly boolean[])[];
}

/** The full key table for an ordered list of author formulas. */
export interface TruthTable {
  /** Distinct atoms across every formula, in canonical order. */
  readonly atoms: readonly string[];
  /** `valuations[rowIndex][atomIndex]` — the reference-column value. */
  readonly valuations: readonly (readonly boolean[])[];
  readonly formulas: readonly FormulaTable[];
}

export interface TruthTableBuildError {
  readonly formulaIndex: number;
  readonly source: string;
  readonly error: ParseError;
}

export type TruthTableResult =
  | { readonly ok: true; readonly table: TruthTable }
  | { readonly ok: false; readonly errors: readonly TruthTableBuildError[] };

/** Split an atom into its letter stem and numeric subscript for ordering. */
function atomOrderKey(atom: string): { stem: string; subscript: number } {
  const match = /^([A-Za-z]+)([0-9]*)$/.exec(atom);

  if (match === null) {
    return { stem: atom, subscript: -1 };
  }

  const digits = match[2] ?? "";
  return {
    stem: match[1] ?? atom,
    subscript: digits === "" ? -1 : Number(digits),
  };
}

function compareAtoms(a: string, b: string): number {
  const left = atomOrderKey(a);
  const right = atomOrderKey(b);

  if (left.stem !== right.stem) {
    return left.stem < right.stem ? -1 : 1;
  }

  return left.subscript - right.subscript;
}

function collectAtomsInto(formula: Formula, into: Set<string>): void {
  switch (formula.type) {
    case "atom":
      into.add(formula.name);
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

  return [...atoms].sort(compareAtoms);
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
    case "not":
      return !evaluate(formula.operand, valuation);
    case "and":
      return (
        evaluate(formula.left, valuation) &&
        evaluate(formula.right, valuation)
      );
    case "or":
      return (
        evaluate(formula.left, valuation) ||
        evaluate(formula.right, valuation)
      );
    case "if":
      return (
        !evaluate(formula.left, valuation) ||
        evaluate(formula.right, valuation)
      );
    case "iff":
      return (
        evaluate(formula.left, valuation) ===
        evaluate(formula.right, valuation)
      );
  }
}

function collectColumnsInto(
  formula: Formula,
  root: Formula,
  into: FormulaColumn[],
): void {
  switch (formula.type) {
    case "atom":
      // Atom occurrences are reference columns, not sub-formula columns.
      return;
    case "not":
      // Prefix connective: its column precedes the operand's columns.
      into.push({ formula, isMain: formula === root });
      collectColumnsInto(formula.operand, root, into);
      return;
    default:
      // Infix connective: left operand, this column, then right operand.
      collectColumnsInto(formula.left, root, into);
      into.push({ formula, isMain: formula === root });
      collectColumnsInto(formula.right, root, into);
  }
}

/**
 * The sub-formula columns for a formula, in left-to-right display order (an
 * in-order walk emitting a column for every connective). The main connective's
 * column is flagged rather than positioned, since it sits mid-formula.
 */
export function subformulaColumns(formula: Formula): FormulaColumn[] {
  const columns: FormulaColumn[] = [];
  collectColumnsInto(formula, formula, columns);
  return columns;
}

function valuationMap(
  atoms: readonly string[],
  row: readonly boolean[],
): Map<string, boolean> {
  const map = new Map<string, boolean>();

  for (const [index, atom] of atoms.entries()) {
    map.set(atom, row[index] ?? false);
  }

  return map;
}

function buildFormulaTable(
  source: string,
  formula: Formula,
  atoms: readonly string[],
  valuations: readonly (readonly boolean[])[],
): FormulaTable {
  const columns = subformulaColumns(formula);
  const mainColumnIndex = columns.findIndex((column) => column.isMain);
  const values = valuations.map((row) => {
    const map = valuationMap(atoms, row);
    return columns.map((column) => evaluate(column.formula, map));
  });

  return { columns, formula, mainColumnIndex, source, values };
}

/**
 * Parse each source formula and assemble the full key table. Returns every
 * per-formula parse error together, so an author sees all bad formulas at once.
 */
export function buildTruthTable(
  sources: readonly string[],
): TruthTableResult {
  const parsed: Formula[] = [];
  const errors: TruthTableBuildError[] = [];

  for (const [index, source] of sources.entries()) {
    const result = parseFormula(source);

    if (result.ok) {
      parsed.push(result.formula);
    } else {
      for (const error of result.errors) {
        errors.push({ error, formulaIndex: index, source });
      }
    }
  }

  if (errors.length > 0) {
    return { errors, ok: false };
  }

  const atoms = collectAtoms(parsed);

  if (atoms.length > MAX_TABLE_ATOMS) {
    return {
      errors: [
        {
          error: {
            message:
              "A truth table may use at most {max} atoms; found {found}.",
            params: { found: atoms.length, max: MAX_TABLE_ATOMS },
            position: 0,
          },
          formulaIndex: 0,
          source: sources[0] ?? "",
        },
      ],
      ok: false,
    };
  }

  const valuations = enumerateValuations(atoms);
  const formulas = parsed.map((formula, index) =>
    buildFormulaTable(sources[index] ?? "", formula, atoms, valuations),
  );

  return { ok: true, table: { atoms, formulas, valuations } };
}

/** Whether a formula's main connective is true under every valuation. */
export function isTautology(table: FormulaTable): boolean {
  return table.values.every((row) => row[table.mainColumnIndex] === true);
}
