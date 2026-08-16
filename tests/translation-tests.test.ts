/**
 * The `tests=` attribute checks — Carnap's names, Carnap's counting. These
 * are pure AST predicates; the engine battery next door is what needs wasm.
 */

import { describe, expect, test } from "bun:test";

import type { Formula } from "../src/worker/exercises/first-order";
import {
  FORALLX_CALGARY_2019,
  parseFormula,
} from "../src/worker/exercises/first-order";
import {
  parseTranslationTests,
  runTranslationTests,
} from "../src/worker/exercises/translation/logic/tests";

function parse(source: string): Formula {
  const result = parseFormula(source, FORALLX_CALGARY_2019);
  if (!result.ok) {
    throw new Error(`parse failed for ${source}`);
  }
  return result.formula;
}

function failures(source: string, tests: string): string[] {
  const parsed = parseTranslationTests(tests);
  expect(parsed.unknown).toEqual([]);
  return runTranslationTests(parse(source), parsed.tests).map((failure) =>
    failure.test.kind === "count"
      ? `${failure.test.feature}:${String(failure.count)}>${String(failure.test.max)}`
      : failure.test.kind,
  );
}

describe("parsing the tests attribute", () => {
  test("recognizes every Carnap token, including the maxNot alias", () => {
    const parsed = parseTranslationTests(
      "CNF DNF PNF maxCon:1 maxNot:2 maxNeg:2 maxAnd:3 maxIff:4 maxIf:5 maxOr:6 maxFalse:0 maxAtom:7",
    );
    expect(parsed.unknown).toEqual([]);
    expect(parsed.tests).toHaveLength(12);
  });

  test("hands back what it does not recognize", () => {
    const parsed = parseTranslationTests("CNF maxWat:3 GNF maxCon:x");
    expect(parsed.unknown).toEqual(["maxWat:3", "GNF", "maxCon:x"]);
    expect(parsed.tests).toEqual([{ kind: "cnf" }]);
  });
});

describe("normal forms", () => {
  test("CNF accepts clauses of literals and single literals", () => {
    expect(failures("(P\\/~Q)/\\(R\\/P)", "CNF")).toEqual([]);
    expect(failures("P", "CNF")).toEqual([]);
    expect(failures("~P", "CNF")).toEqual([]);
    expect(failures("P/\\Q/\\~R", "CNF")).toEqual([]);
  });

  test("CNF rejects a disjunction of conjunctions and buried arrows", () => {
    expect(failures("(P/\\Q)\\/R", "CNF")).toEqual(["cnf"]);
    expect(failures("(P->Q)/\\R", "CNF")).toEqual(["cnf"]);
    expect(failures("~(P\\/Q)", "CNF")).toEqual(["cnf"]);
  });

  test("DNF is the dual", () => {
    expect(failures("(P/\\~Q)\\/(R/\\P)", "DNF")).toEqual([]);
    expect(failures("(P\\/Q)/\\R", "DNF")).toEqual(["dnf"]);
  });

  test("PNF wants every quantifier out front", () => {
    expect(failures("AxEy(H(x,y)/\\F(x))", "PNF")).toEqual([]);
    expect(failures("Ax(F(x)->EyH(x,y))", "PNF")).toEqual(["pnf"]);
    expect(failures("P/\\Q", "PNF")).toEqual([]);
  });
});

describe("counting", () => {
  test("each connective counter sees only its own", () => {
    const source = "~(P/\\Q)->((R\\/P)<->Q)";
    expect(
      failures(source, "maxNeg:1 maxAnd:1 maxOr:1 maxIf:1 maxIff:1"),
    ).toEqual([]);
    expect(failures(source, "maxNeg:0")).toEqual(["negations:1>0"]);
    expect(failures(source, "maxIf:0")).toEqual(["conditionals:1>0"]);
  });

  test("maxCon counts every non-atomic node, quantifiers included", () => {
    // ~, /\, A: three non-atoms.
    expect(failures("~P/\\AxF(x)", "maxCon:3")).toEqual([]);
    expect(failures("~P/\\AxF(x)", "maxCon:2")).toEqual(["connectives:3>2"]);
  });

  test("atoms are predicates and identities; falsum counts separately", () => {
    expect(failures("F(a)/\\a=b", "maxAtom:2")).toEqual([]);
    expect(failures("F(a)/\\a=b", "maxAtom:1")).toEqual(["atoms:2>1"]);
    expect(failures("P\\/_|_", "maxFalse:0")).toEqual(["falsums:1>0"]);
    expect(failures("P\\/_|_", "maxAtom:1")).toEqual([]);
  });

  test("inequality sugar counts its hidden negation", () => {
    expect(failures("a!=b", "maxNeg:0")).toEqual(["negations:1>0"]);
  });

  test("failures come back in the order the author listed the tests", () => {
    expect(failures("P->Q", "CNF maxIf:0")).toEqual([
      "cnf",
      "conditionals:1>0",
    ]);
  });
});
