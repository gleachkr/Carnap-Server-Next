import { describe, expect, test } from "bun:test";
import type { Formula } from "../src/worker/exercises/truth-table/logic";
import {
  buildTruthTable,
  collectAtoms,
  enumerateValuations,
  evaluate,
  formulaToString,
  isTautology,
  MAX_TABLE_ATOMS,
  parseFormula,
  subformulaColumns,
} from "../src/worker/exercises/truth-table/logic";

function parse(source: string): Formula {
  const result = parseFormula(source);

  if (!result.ok) {
    throw new Error(
      `Expected '${source}' to parse: ${result.errors[0]?.message}`,
    );
  }

  return result.formula;
}

function evalWith(source: string, values: Record<string, boolean>): boolean {
  return evaluate(parse(source), new Map(Object.entries(values)));
}

function firstFormulaTable(source: string) {
  const result = buildTruthTable([source]);

  if (!result.ok) {
    throw new Error(`Expected '${source}' to build a table.`);
  }

  const formula = result.table.formulas[0];

  if (formula === undefined) {
    throw new Error(`Expected a formula table for '${source}'.`);
  }

  return formula;
}

describe("parseFormula", () => {
  test("parses a bare atom", () => {
    expect(parse("P")).toEqual({ name: "P", type: "atom" });
  });

  test("parses subscripted atoms", () => {
    expect(parse("P12")).toEqual({ name: "P12", type: "atom" });
  });

  test("parses negation as a prefix", () => {
    expect(parse("~P")).toEqual({
      operand: { name: "P", type: "atom" },
      type: "not",
    });
  });

  test("tolerates whitespace", () => {
    expect(formulaToString(parse("  P   /\\   Q "))).toBe("(P /\\ Q)");
  });

  test("binds ~ tighter than /\\", () => {
    // ~P /\ Q parses as (~P) /\ Q, not ~(P /\ Q).
    expect(formulaToString(parse("~P /\\ Q"))).toBe("(~P /\\ Q)");
  });

  test("binds /\\ tighter than \\/", () => {
    expect(formulaToString(parse("P \\/ Q /\\ R"))).toBe("(P \\/ (Q /\\ R))");
  });

  test("binds \\/ tighter than ->", () => {
    expect(formulaToString(parse("P -> Q \\/ R"))).toBe("(P -> (Q \\/ R))");
  });

  test("binds -> tighter than <->", () => {
    expect(formulaToString(parse("P <-> Q -> R"))).toBe("(P <-> (Q -> R))");
  });

  test("-> is right-associative", () => {
    expect(formulaToString(parse("P -> Q -> R"))).toBe("(P -> (Q -> R))");
  });

  test("/\\ is left-associative", () => {
    expect(formulaToString(parse("P /\\ Q /\\ R"))).toBe("((P /\\ Q) /\\ R)");
  });

  test("parentheses override precedence", () => {
    expect(formulaToString(parse("~(P /\\ Q)"))).toBe("~(P /\\ Q)");
    expect(formulaToString(parse("(P \\/ Q) /\\ R"))).toBe(
      "((P \\/ Q) /\\ R)",
    );
  });
});

describe("parseFormula errors", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["", "empty source"],
    ["P Q", "two atoms with no connective"],
    ["P /\\", "missing right operand"],
    ["/\\ P", "missing left operand"],
    ["(P", "unbalanced open paren"],
    ["P)", "trailing close paren"],
    ["P & Q", "unsupported connective character"],
    ["P - Q", "half-typed conditional"],
    ["P < Q", "half-typed biconditional"],
    ["P \\ Q", "half-typed disjunction"],
  ];

  for (const [source, why] of cases) {
    test(`rejects: ${why}`, () => {
      const result = parseFormula(source);
      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(typeof result.errors[0]?.position).toBe("number");
      }
    });
  }

  test("reports the offending position", () => {
    const result = parseFormula("P /\\ /\\");
    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.position).toBe(5);
    }
  });
});

describe("collectAtoms", () => {
  test("dedupes and sorts alphabetically", () => {
    expect(collectAtoms([parse("R /\\ P"), parse("Q \\/ P")])).toEqual([
      "P",
      "Q",
      "R",
    ]);
  });

  test("orders subscripts numerically, not lexically", () => {
    expect(collectAtoms([parse("P10 /\\ P2 /\\ P1")])).toEqual([
      "P1",
      "P2",
      "P10",
    ]);
  });
});

describe("enumerateValuations", () => {
  test("produces 2ⁿ rows in canonical order", () => {
    expect(enumerateValuations(["P", "Q"])).toEqual([
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ]);
  });

  test("is all-true on top and all-false on the bottom", () => {
    const rows = enumerateValuations(["P", "Q", "R"]);
    expect(rows.length).toBe(8);
    expect(rows[0]).toEqual([true, true, true]);
    expect(rows[7]).toEqual([false, false, false]);
  });

  test("a nullary table has a single empty row", () => {
    expect(enumerateValuations([])).toEqual([[]]);
  });
});

describe("evaluate", () => {
  test("negation", () => {
    expect(evalWith("~P", { P: true })).toBe(false);
    expect(evalWith("~P", { P: false })).toBe(true);
  });

  test("conjunction", () => {
    expect(evalWith("P /\\ Q", { P: true, Q: true })).toBe(true);
    expect(evalWith("P /\\ Q", { P: true, Q: false })).toBe(false);
  });

  test("disjunction", () => {
    expect(evalWith("P \\/ Q", { P: false, Q: false })).toBe(false);
    expect(evalWith("P \\/ Q", { P: true, Q: false })).toBe(true);
  });

  test("conditional is false only for true -> false", () => {
    expect(evalWith("P -> Q", { P: true, Q: false })).toBe(false);
    expect(evalWith("P -> Q", { P: false, Q: false })).toBe(true);
    expect(evalWith("P -> Q", { P: false, Q: true })).toBe(true);
    expect(evalWith("P -> Q", { P: true, Q: true })).toBe(true);
  });

  test("biconditional is true when sides agree", () => {
    expect(evalWith("P <-> Q", { P: true, Q: true })).toBe(true);
    expect(evalWith("P <-> Q", { P: true, Q: false })).toBe(false);
  });

  test("throws for a missing valuation", () => {
    expect(() => evaluate(parse("P"), new Map())).toThrow();
  });
});

describe("subformulaColumns", () => {
  test("one column per connective, atoms excluded", () => {
    const columns = subformulaColumns(parse("P -> (Q /\\ R)"));
    expect(columns.map((c) => formulaToString(c.formula))).toEqual([
      "(P -> (Q /\\ R))",
      "(Q /\\ R)",
    ]);
  });

  test("emits columns in left-to-right display order", () => {
    // For (A /\ B) -> C the /\ column is drawn before the -> column.
    const columns = subformulaColumns(parse("(A /\\ B) -> C"));
    expect(columns.map((c) => formulaToString(c.formula))).toEqual([
      "(A /\\ B)",
      "((A /\\ B) -> C)",
    ]);
  });

  test("flags the main connective at the root", () => {
    const columns = subformulaColumns(parse("(A /\\ B) -> C"));
    const main = columns.filter((c) => c.isMain);
    expect(main.length).toBe(1);
    expect(formulaToString(main[0]?.formula ?? parse("A"))).toBe(
      "((A /\\ B) -> C)",
    );
  });

  test("a bare atom has no columns", () => {
    expect(subformulaColumns(parse("P"))).toEqual([]);
  });
});

describe("buildTruthTable", () => {
  test("assembles atoms, valuations, and per-formula values", () => {
    const result = buildTruthTable(["P -> Q"]);
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.table.atoms).toEqual(["P", "Q"]);
      expect(result.table.valuations.length).toBe(4);

      const formula = result.table.formulas[0];
      expect(formula?.mainColumnIndex).toBe(0);
      // Rows: TT, TF, FT, FF -> P -> Q is T, F, T, T.
      expect(
        formula?.values.map((row) => row[formula.mainColumnIndex]),
      ).toEqual([true, false, true, true]);
    }
  });

  test("shares atom order across multiple formulas", () => {
    const result = buildTruthTable(["Q", "P /\\ Q"]);
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.table.atoms).toEqual(["P", "Q"]);
      expect(result.table.formulas.length).toBe(2);
      expect(result.table.valuations.length).toBe(4);
    }
  });

  test("reports parse errors per formula", () => {
    const result = buildTruthTable(["P -> Q", "P /\\"]);
    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]?.formulaIndex).toBe(1);
    }
  });

  test("rejects tables past the atom cap", () => {
    const atoms = Array.from({ length: MAX_TABLE_ATOMS + 1 }, (_, i) =>
      String.fromCharCode(65 + i),
    ).join(" /\\ ");
    const result = buildTruthTable([atoms]);
    expect(result.ok).toBe(false);
  });
});

describe("isTautology", () => {
  test("true for a validity like P -> P", () => {
    expect(isTautology(firstFormulaTable("P -> P"))).toBe(true);
  });

  test("false for a contingency", () => {
    expect(isTautology(firstFormulaTable("P /\\ Q"))).toBe(false);
  });

  test("false for a contradiction", () => {
    expect(isTautology(firstFormulaTable("P /\\ ~P"))).toBe(false);
  });
});
