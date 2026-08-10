/**
 * What a set of formulas asks a model to interpret.
 *
 * The exercise's fields are not authored — they are read off the formulas, so
 * that `AxR(x,f(x))` asks for a domain, an extension for `R(_,_)` and a value
 * table for `f(_)`, and nothing else. This is the original's
 * `blankTerms`/`blankFuncTerms` plus the sort inside `appendInputs`, with the
 * DOM taken out (`CounterModel.hs:260-302`).
 *
 * A symbol's identity includes its **arity**, matching Carnap, which keys
 * relations by `(index, arity)`: `F(a)` and `F(a,b)` are two different
 * predicates and get two separate fields.
 */

import type { Formula, Term } from "./formula";

export type ModelFieldKind =
  | "domain"
  | "relation"
  | "proposition"
  | "constant"
  | "function";

export interface ModelField {
  /** 0 for the domain, a proposition, or a constant. */
  readonly arity: number;
  readonly kind: ModelFieldKind;
  /**
   * The field's label, which is also its key in a submitted answer and in an
   * exercise's givens: `Domain`, `F(_,_)`, `P`, `a`, `f(_)`. Carnap shows the
   * symbol with its terms blanked, and both the givens syntax and the "take
   * another look at" messages spell it this way, so there is one vocabulary.
   */
  readonly label: string;
  /** The bare symbol, without the blanks: `F`, `P`, `a`, `f`. */
  readonly symbol: string;
}

/** The label Carnap gives the domain field, and the key givens use for it. */
export const DOMAIN_FIELD_LABEL = "Domain";

export const DOMAIN_FIELD: ModelField = {
  arity: 0,
  kind: "domain",
  label: DOMAIN_FIELD_LABEL,
  symbol: DOMAIN_FIELD_LABEL,
};

/** `F` with arity 2 → `F(_,_)`; arity 0 → `F`. */
export function blankedLabel(symbol: string, arity: number): string {
  if (arity === 0) {
    return symbol;
  }

  return `${symbol}(${Array.from({ length: arity }, () => "_").join(",")})`;
}

/** A symbol's key in a model, distinguishing arities of the same letter. */
export function symbolKey(symbol: string, arity: number): string {
  return `${symbol}/${arity}`;
}

function collectFromTerm(term: Term, into: Map<string, ModelField>): void {
  if (term.type === "variable") {
    return;
  }

  if (term.type === "constant") {
    const key = symbolKey(term.name, 0);
    into.set(key, {
      arity: 0,
      kind: "constant",
      label: term.name,
      symbol: term.name,
    });
    return;
  }

  const key = symbolKey(term.name, term.args.length);
  into.set(key, {
    arity: term.args.length,
    kind: "function",
    label: blankedLabel(term.name, term.args.length),
    symbol: term.name,
  });

  for (const argument of term.args) {
    collectFromTerm(argument, into);
  }
}

function collectFromFormula(
  formula: Formula,
  into: Map<string, ModelField>,
): void {
  switch (formula.type) {
    case "predicate": {
      const arity = formula.args.length;
      into.set(symbolKey(formula.name, arity), {
        arity,
        kind: arity === 0 ? "proposition" : "relation",
        label: blankedLabel(formula.name, arity),
        symbol: formula.name,
      });

      for (const argument of formula.args) {
        collectFromTerm(argument, into);
      }

      return;
    }
    case "identity":
      collectFromTerm(formula.left, into);
      collectFromTerm(formula.right, into);
      return;
    case "falsum":
    case "verum":
      return;
    case "not":
      collectFromFormula(formula.operand, into);
      return;
    case "forall":
    case "exists":
      collectFromFormula(formula.body, into);
      return;
    default:
      collectFromFormula(formula.left, into);
      collectFromFormula(formula.right, into);
  }
}

/** The order the fields are shown in, which is Carnap's. */
const KIND_ORDER: readonly ModelFieldKind[] = [
  "domain",
  "relation",
  "proposition",
  "constant",
  "function",
];

/**
 * Every field the formulas need, domain first and then grouped by kind, each
 * group in label order — the sequence `prepareModelUI` builds by appending
 * relations, then propositions, then constants, then functions, sorting each
 * group by its label as it goes.
 */
export function modelSignature(
  formulas: readonly Formula[],
): readonly ModelField[] {
  const collected = new Map<string, ModelField>();

  for (const formula of formulas) {
    collectFromFormula(formula, collected);
  }

  const fields = [...collected.values()].sort((left, right) => {
    const byKind =
      KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);

    if (byKind !== 0) {
      return byKind;
    }

    // Code-unit order, not `localeCompare`. Carnap sorts on Haskell's `Ord
    // String`, which is this; and collation would put `F(_,_)` before `F(_)`
    // in a way that depends on the runtime's ICU data, while this order is
    // compiled into the exercise's stored field list and has to be stable.
    return left.label < right.label ? -1 : left.label > right.label ? 1 : 0;
  });

  return [DOMAIN_FIELD, ...fields];
}
