/**
 * Finite models and satisfaction — the port of
 * `Carnap/src/Carnap/Languages/PureFirstOrder/Semantics.hs`.
 *
 * Carnap builds a model out of *functions* (`relation :: Arity -> Int -> ret`)
 * and updates it by wrapping each one in a closure that shadows a single
 * symbol. Here it is plain data, keyed by symbol and arity, which is the same
 * model with the currying taken out.
 *
 * Domain elements are naturals, as in the original, and identity is numeric
 * equality on them (`satisfies m TermEq = \t1 t2 -> Form (t1 == t2)`). Nothing
 * here is dialect-specific: a formula is a formula once parsed.
 */

import type { Formula, Term } from "../../first-order";
import { tupleKey } from "./fields";
import { symbolKey } from "./signature";

export interface FiniteModel {
  /** Non-empty, without repeats. Quantifiers range over exactly this. */
  readonly domain: readonly number[];
  /** Constant symbol → the element it names. */
  readonly constants: ReadonlyMap<string, number>;
  /** {@link symbolKey} → argument tuple key → the element it maps to. */
  readonly functions: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Sentence letter → its truth value. */
  readonly propositions: ReadonlyMap<string, boolean>;
  /** {@link symbolKey} → the tuples in the extension. */
  readonly relations: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The value of a term under an assignment to the variables.
 *
 * An unbound variable throws: every shipping dialect requires closed formulas,
 * so reaching this means a formula got past the parser that should not have.
 * Carnap answers the same way — "it doesn't make sense to ask for the semantic
 * value of an unbound variable" — and both are internal-error paths, not
 * anything a student can provoke.
 *
 * A constant or function value the model does not carry falls back to the first
 * domain element. A complete model has all of them, and every caller validates
 * before evaluating; the fallback keeps evaluation total for a model still being
 * filled in, and keeps the value inside the domain, which Carnap's `Term 0`
 * default does not.
 */
export function evaluateTerm(
  term: Term,
  model: FiniteModel,
  assignment: ReadonlyMap<string, number>,
): number {
  const fallback = model.domain[0] ?? 0;

  switch (term.type) {
    case "variable": {
      const value = assignment.get(term.name);

      if (value === undefined) {
        throw new Error(`No assignment for variable '${term.name}'.`);
      }

      return value;
    }
    case "constant":
      return model.constants.get(term.name) ?? fallback;
    default: {
      const args = term.args.map((argument) =>
        evaluateTerm(argument, model, assignment),
      );

      return (
        model.functions
          .get(symbolKey(term.name, term.args.length))
          ?.get(tupleKey(args)) ?? fallback
      );
    }
  }
}

/** Whether the model satisfies the formula under an assignment. */
export function satisfies(
  formula: Formula,
  model: FiniteModel,
  assignment: ReadonlyMap<string, number> = new Map(),
): boolean {
  switch (formula.type) {
    case "predicate": {
      const key = symbolKey(formula.name, formula.args.length);

      if (formula.args.length === 0) {
        return model.propositions.get(formula.name) ?? false;
      }

      const tuple = formula.args.map((argument) =>
        evaluateTerm(argument, model, assignment),
      );

      return model.relations.get(key)?.has(tupleKey(tuple)) ?? false;
    }
    case "identity":
      return (
        evaluateTerm(formula.left, model, assignment) ===
        evaluateTerm(formula.right, model, assignment)
      );
    case "falsum":
      return false;
    case "verum":
      return true;
    case "not":
      return !satisfies(formula.operand, model, assignment);
    case "and":
      return (
        satisfies(formula.left, model, assignment) &&
        satisfies(formula.right, model, assignment)
      );
    case "or":
      return (
        satisfies(formula.left, model, assignment) ||
        satisfies(formula.right, model, assignment)
      );
    case "if":
      return (
        !satisfies(formula.left, model, assignment) ||
        satisfies(formula.right, model, assignment)
      );
    case "iff":
      return (
        satisfies(formula.left, model, assignment) ===
        satisfies(formula.right, model, assignment)
      );
    default: {
      const extended = new Map(assignment);
      const holds = (element: number): boolean => {
        extended.set(formula.variable, element);
        return satisfies(formula.body, model, extended);
      };

      return formula.type === "forall"
        ? model.domain.every(holds)
        : model.domain.some(holds);
    }
  }
}
