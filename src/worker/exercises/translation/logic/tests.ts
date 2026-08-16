/**
 * The extra conditions a translation can be required to meet, over and above
 * equivalence: Carnap's `tests=` attribute, same names, same meanings
 * (`Carnap-GHCJS/src/Lib/FormulaTests.hs`). Pure predicates over the parsed
 * {@link Formula}, run identically by the worker (to grade) and the client
 * (to word the local Check).
 *
 * One Carnap wrinkle kept deliberately: the documentation there spells the
 * negation counter `maxNot:` but the implementation only ever accepted
 * `maxNeg:` (the documentation's own example uses `maxNeg:0`). We accept
 * both.
 *
 * Counting follows Carnap's optics: a "connective" for `maxCon` is every
 * non-atomic subformula node — negations, binaries, quantifiers, and the
 * boolean constants — while an "atom" is a predicate application (a sentence
 * letter included) or an identity.
 */

import type { Formula } from "../../first-order";

export type CountedFeature =
  | "atoms"
  | "biconditionals"
  | "conditionals"
  | "conjunctions"
  | "connectives"
  | "disjunctions"
  | "falsums"
  | "negations";

export type TranslationTest =
  | { readonly kind: "cnf" }
  | { readonly kind: "dnf" }
  | { readonly kind: "pnf" }
  | {
      readonly kind: "count";
      readonly feature: CountedFeature;
      readonly max: number;
    };

/** A failed test; `count` is what the submission actually had, for the
 * "you have N, but should have M at most" sentence. */
export interface TranslationTestFailure {
  readonly test: TranslationTest;
  readonly count: number;
}

const COUNTER_TOKENS: ReadonlyMap<string, CountedFeature> = new Map([
  ["maxAnd", "conjunctions"],
  ["maxAtom", "atoms"],
  ["maxCon", "connectives"],
  ["maxFalse", "falsums"],
  ["maxIf", "conditionals"],
  ["maxIff", "biconditionals"],
  ["maxNeg", "negations"],
  ["maxNot", "negations"],
  ["maxOr", "disjunctions"],
]);

export interface ParsedTranslationTests {
  readonly tests: readonly TranslationTest[];
  /** Tokens no test answers to — the authoring layer's diagnostic. */
  readonly unknown: readonly string[];
}

/** Parse a space-separated `tests=` attribute value. */
export function parseTranslationTests(
  source: string,
): ParsedTranslationTests {
  const tests: TranslationTest[] = [];
  const unknown: string[] = [];
  for (const token of source.split(/\s+/u).filter((t) => t !== "")) {
    if (token === "CNF") {
      tests.push({ kind: "cnf" });
      continue;
    }
    if (token === "DNF") {
      tests.push({ kind: "dnf" });
      continue;
    }
    if (token === "PNF") {
      tests.push({ kind: "pnf" });
      continue;
    }
    const match = /^([A-Za-z]+):(\d+)$/u.exec(token);
    const feature =
      match === null ? undefined : COUNTER_TOKENS.get(match[1] ?? "");
    if (match === null || feature === undefined) {
      unknown.push(token);
      continue;
    }
    tests.push({ feature, kind: "count", max: Number(match[2]) });
  }
  return { tests, unknown };
}

function subformulas(formula: Formula): Formula[] {
  switch (formula.type) {
    case "predicate":
    case "identity":
    case "falsum":
    case "verum":
      return [formula];
    case "not":
      return [formula, ...subformulas(formula.operand)];
    case "and":
    case "or":
    case "if":
    case "iff":
      return [
        formula,
        ...subformulas(formula.left),
        ...subformulas(formula.right),
      ];
    case "forall":
    case "exists":
      return [formula, ...subformulas(formula.body)];
  }
}

function isAtom(formula: Formula): boolean {
  return formula.type === "predicate" || formula.type === "identity";
}

function countFeature(formula: Formula, feature: CountedFeature): number {
  const nodes = subformulas(formula);
  switch (feature) {
    case "atoms":
      return nodes.filter(isAtom).length;
    case "biconditionals":
      return nodes.filter((n) => n.type === "iff").length;
    case "conditionals":
      return nodes.filter((n) => n.type === "if").length;
    case "conjunctions":
      return nodes.filter((n) => n.type === "and").length;
    case "connectives":
      return nodes.filter((n) => !isAtom(n)).length;
    case "disjunctions":
      return nodes.filter((n) => n.type === "or").length;
    case "falsums":
      return nodes.filter((n) => n.type === "falsum").length;
    case "negations":
      return nodes.filter((n) => n.type === "not").length;
  }
}

function isLiteral(formula: Formula): boolean {
  return (
    isAtom(formula) || (formula.type === "not" && isAtom(formula.operand))
  );
}

function conjuncts(formula: Formula): Formula[] {
  return formula.type === "and"
    ? [...conjuncts(formula.left), ...conjuncts(formula.right)]
    : [formula];
}

function disjuncts(formula: Formula): Formula[] {
  return formula.type === "or"
    ? [...disjuncts(formula.left), ...disjuncts(formula.right)]
    : [formula];
}

function isCnf(formula: Formula): boolean {
  return conjuncts(formula).every((clause) =>
    disjuncts(clause).every(isLiteral),
  );
}

function isDnf(formula: Formula): boolean {
  return disjuncts(formula).every((clause) =>
    conjuncts(clause).every(isLiteral),
  );
}

function quantifierFree(formula: Formula): boolean {
  return !subformulas(formula).some(
    (n) => n.type === "forall" || n.type === "exists",
  );
}

function isPnf(formula: Formula): boolean {
  let matrix = formula;
  while (matrix.type === "forall" || matrix.type === "exists") {
    matrix = matrix.body;
  }
  return quantifierFree(matrix);
}

/** Run every test; the failures come back in the order the author listed
 * them, each with the offending count. Normal-form failures report `0`. */
export function runTranslationTests(
  formula: Formula,
  tests: readonly TranslationTest[],
): TranslationTestFailure[] {
  const failures: TranslationTestFailure[] = [];
  for (const test of tests) {
    switch (test.kind) {
      case "cnf":
        if (!isCnf(formula)) {
          failures.push({ count: 0, test });
        }
        break;
      case "dnf":
        if (!isDnf(formula)) {
          failures.push({ count: 0, test });
        }
        break;
      case "pnf":
        if (!isPnf(formula)) {
          failures.push({ count: 0, test });
        }
        break;
      case "count": {
        const count = countFeature(formula, test.feature);
        if (count > test.max) {
          failures.push({ count, test });
        }
        break;
      }
    }
  }
  return failures;
}
