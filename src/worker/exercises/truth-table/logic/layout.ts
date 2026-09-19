/**
 * Display layout for a written-out formula: the ordered run of parentheses and
 * fillable cells (one per atom occurrence and one per connective), as a truth
 * table draws it left to right. DOM-free — the worker SSRs the grid from it and
 * the client element reads cell coordinates back against the same order, so both
 * sides must derive the layout from this one function.
 *
 * Parenthesization mirrors {@link formulaToString} but drops the redundant
 * outermost parens: a binary sub-formula is wrapped only when it is nested.
 *
 * Symbols come from the spec, through the same {@link connectiveSpellings} the
 * printer uses. They were a hardcoded ASCII table here until 2026-08-27, which
 * meant a table set in forallx stored `(P ∧ Q)` and drew `(P /\ Q)`, and meant
 * a connective an author declared themselves had no spelling at all to draw.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import type { Formula, Spellings } from "./formula";
import { connectiveSpellings } from "./formula";

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

function emit(
  node: Formula,
  root: Formula,
  isRoot: boolean,
  spelling: Spellings,
  out: FormulaSegment[],
): void {
  const cell = (text: string): void => {
    out.push({
      formula: node,
      isMain: node === root,
      kind: "cell",
      role: "connective",
      text,
    });
  };

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
    // `⊤` and `⊥` take no operands and are still connectives: a column of
    // constant Ts under the symbol, which is what a student is being asked to
    // notice about them.
    case "verum":
      cell(spelling.verum);
      return;
    case "falsum":
      cell(spelling.falsum);
      return;
    case "not":
      cell(spelling.not);
      // A negation's operand is parenthesized only when it is binary.
      emit(node.operand, root, false, spelling, out);
      return;
    default: {
      if (!isRoot) {
        out.push({ kind: "paren", text: "(" });
      }

      emit(node.left, root, false, spelling, out);
      cell(spelling.binary[node.type]);
      emit(node.right, root, false, spelling, out);

      if (!isRoot) {
        out.push({ kind: "paren", text: ")" });
      }
    }
  }
}

/** The full parenthesis-and-cell run for a written-out formula. */
export function formulaLayout(
  formula: Formula,
  lang: SurfaceLanguage,
): FormulaSegment[] {
  const segments: FormulaSegment[] = [];
  emit(formula, formula, true, connectiveSpellings(lang), segments);
  return segments;
}
