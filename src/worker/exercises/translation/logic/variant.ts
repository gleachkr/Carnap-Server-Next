/**
 * The `prop` variant's language restriction: sentence letters, connectives,
 * and the boolean constants — nothing with terms in it. One predicate over
 * both sides of the boundary (authoring rejects a first-order *solution*;
 * grading and the widget's check reject a first-order *submission*), so a
 * prop exercise cannot be answered in a language its theory has no laws for.
 */

import type { Formula } from "../../../exercise-kit/formula";

export function isPropositional(formula: Formula): boolean {
  switch (formula.type) {
    case "predicate":
      return formula.args.length === 0;
    case "identity":
      return false;
    case "falsum":
    case "verum":
      return true;
    case "not":
      return isPropositional(formula.operand);
    case "forall":
    case "exists":
      return false;
    // Every binary connective is propositional whatever its operands are made
    // of — what makes a formula first-order is terms, and a connective has
    // none.
    default:
      return isPropositional(formula.left) && isPropositional(formula.right);
  }
}
