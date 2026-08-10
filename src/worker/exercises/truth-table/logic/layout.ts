/**
 * Display layout for a written-out formula: the ordered run of parentheses and
 * fillable cells (one per atom occurrence and one per connective), as a truth
 * table draws it left to right. DOM-free — the worker SSRs the grid from it and
 * the client element reads cell coordinates back against the same order, so both
 * sides must derive the layout from this one function.
 *
 * Parenthesization mirrors {@link formulaToString} but drops the redundant
 * outermost parens: a binary sub-formula is wrapped only when it is nested.
 */

import type { BinaryConnective, Formula } from "./formula";

export type CellRole = "atom" | "connective";

/** A fillable position under the written-out formula. */
export interface CellSegment {
  readonly kind: "cell";
  readonly role: CellRole;
  /** The display token: the atom name, or the connective symbol. */
  readonly text: string;
  /** The sub-formula this cell evaluates (an atom node or a connective node). */
  readonly formula: Formula;
  /** True only for the cell under the formula's main connective. */
  readonly isMain: boolean;
}

export type FormulaSegment =
  | { readonly kind: "paren"; readonly text: "(" | ")" }
  | CellSegment;

const CONNECTIVE_SYMBOL: Record<BinaryConnective | "not", string> = {
  and: "/\\",
  if: "->",
  iff: "<->",
  not: "~",
  or: "\\/",
};

function emit(
  node: Formula,
  root: Formula,
  isRoot: boolean,
  out: FormulaSegment[],
): void {
  switch (node.type) {
    case "atom":
      out.push({
        formula: node,
        isMain: false,
        kind: "cell",
        role: "atom",
        text: node.name,
      });
      return;
    case "not":
      out.push({
        formula: node,
        isMain: node === root,
        kind: "cell",
        role: "connective",
        text: CONNECTIVE_SYMBOL.not,
      });
      // A negation's operand is parenthesized only when it is binary.
      emit(node.operand, root, false, out);
      return;
    default: {
      if (!isRoot) {
        out.push({ kind: "paren", text: "(" });
      }

      emit(node.left, root, false, out);
      out.push({
        formula: node,
        isMain: node === root,
        kind: "cell",
        role: "connective",
        text: CONNECTIVE_SYMBOL[node.type],
      });
      emit(node.right, root, false, out);

      if (!isRoot) {
        out.push({ kind: "paren", text: ")" });
      }
    }
  }
}

/** The full parenthesis-and-cell run for a written-out formula. */
export function formulaLayout(formula: Formula): FormulaSegment[] {
  const segments: FormulaSegment[] = [];
  emit(formula, formula, true, segments);
  return segments;
}

/** Just the fillable cells of a formula, in left-to-right display order. */
export function formulaCells(formula: Formula): CellSegment[] {
  return formulaLayout(formula).filter(
    (segment): segment is CellSegment => segment.kind === "cell",
  );
}
