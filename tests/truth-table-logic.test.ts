import { describe, expect, test } from "bun:test";
import type { Formula } from "../src/worker/exercises/truth-table/logic";
import {
  buildTruthTable,
  collectAtoms,
  enumerateValuations,
  evaluate,
  formulaCells,
  formulaToString,
  isTautology,
  MAX_TABLE_ATOMS,
  parseFormula,
  subformulaColumns,
} from "../src/worker/exercises/truth-table/logic";
import { languageById, languageFromSource } from "../src/worker/logic/specs";

/**
 * A propositional language with one construct this type has no reading for,
 * and — the point of the fixture — no `@syntax role` on it.
 *
 * `hasQuantifiers` could never have refused this language: there is no binder
 * to find, and `box` announces nothing about itself. Only the reader, meeting
 * the node, can tell that a truth table has nowhere to put it.
 */
const MODAL_SPEC = `--| @syntax delimiter $ P Q ( ) ~ -> [] $
delimiter $ ( ) $;

provable sort wff;

term P: wff;
term Q: wff;

--| @syntax role negation
term not (p: wff): wff;
prefix not: $~$ prec 50;

--| @syntax role conditional
term imp (p q: wff): wff;
infixr imp: $->$ prec 30;

term box (p: wff): wff;
prefix box: $[]$ prec 50;
`;

/**
 * A course's own propositional language: conjunction spelled `&` rather than
 * `/\`, and five connectives `carnap-prop` does not ship.
 *
 * This is the whole point of naming all sixteen truth functions as roles —
 * none of these is declared anywhere in the server, and an instructor writing
 * an `aufbau-mm0` block gets columns for every one of them. `%` is a
 * projection, included because the degenerate six are readable too.
 */
const EXTENDED_SPEC = `--| @syntax delimiter $ P Q R ( ) ~ & | ! + % ⊤ ⊥ $
delimiter $ ( ) $;

provable sort wff;

term P: wff;
term Q: wff;
term R: wff;

--| @syntax role negation
term not (p: wff): wff;
prefix not: $~$ prec 50;

--| @syntax role conjunction
term and (p q: wff): wff;
infixl and: $&$ prec 40;

--| @syntax role nand
term nand (p q: wff): wff;
infixl nand: $|$ prec 40;

--| @syntax role nor
term nor (p q: wff): wff;
infixl nor: $!$ prec 40;

--| @syntax role exclusive-disjunction
term xor (p q: wff): wff;
infixl xor: $+$ prec 40;

--| @syntax role left-projection
term proj (p q: wff): wff;
infixl proj: $%$ prec 40;

--| @syntax role verum
term top: wff;
notation top: wff = ($⊤$:max);

--| @syntax role falsum
term bot: wff;
notation bot: wff = ($⊥$:max);
`;

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

  test("a subscripted atom is no longer part of the lexicon", () => {
    // The hand parser read `P12`; the vocabulary is now an MM0 signature, so
    // it is 52 single letters and nothing else. Deliberate, 2026-08-24.
    const result = parseFormula("P12");

    expect(result.ok).toBe(false);
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

describe("atoms over a language whose letters take arguments", () => {
  // `carnap-prop` spells a letter `term P: wff;`, which is the unusual
  // encoding. forallx spells one `term F (sq: seq): wff;` at the `@syntax
  // elided` empty sequence, so one declaration covers `F`, `F(a)` and
  // `R(a,b)` — and a truth table set over such a language has to tell those
  // three apart. Keying a column by the constructor name gave all of them the
  // column `F`.
  const registered = languageById("forallx-calgary-2019");

  if (registered === null) {
    throw new Error("no forallx spec registered");
  }

  // Rebound rather than narrowed in place: `atom` below is a hoisted function
  // declaration, so `tsc` cannot assume the check above ran before it.
  const forallx = registered;

  function atom(source: string): string {
    const result = parseFormula(source, forallx);

    if (!result.ok || result.formula.type !== "atom") {
      throw new Error(`Expected '${source}' to read as one atom.`);
    }

    return result.formula.name;
  }

  test("a letter at the elided empty sequence prints as the bare letter", () => {
    expect(atom("F")).toBe("F");
  });

  test("a letter applied to terms keeps them, so arguments make columns", () => {
    expect(atom("F(a)")).toBe("F(a)");
    expect(atom("F(b)")).toBe("F(b)");
    expect(atom("R(a,b)")).toBe("R(a,b)");
  });

  test("the atoms of a formula are as many as its distinct predications", () => {
    const result = parseFormula("F(a) /\\ ~F(b)", forallx);

    expect(result.ok).toBe(true);

    if (result.ok) {
      // The regression this guards. Under the old keying both sides were the
      // column `F`, so this contradicted itself and no valuation satisfied it.
      expect(collectAtoms([result.formula])).toEqual(["F(a)", "F(b)"]);
    }
  });

  test("a binder is refused where it stands, and names itself", () => {
    const result = parseFormula("Ax F(x)", forallx);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.params?.construct).toBe("∀");
    }
  });

  test("a declared role with no reading is refused, identity included", () => {
    // The `default` arm is a whitelist, not a blacklist with identity on it.
    // Letting `=` through as an opaque column would put `a ≠ b` — a `def` that
    // parses without unfolding — in a column of its own, free to be true
    // alongside `~(a = b)`.
    const result = parseFormula("a = b", forallx);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.params?.construct).toBe("=");
    }
  });

  test("a roleless constructor over a sentence is refused, not made an atom", () => {
    // The case no capability gate could catch: an author's modal operator with
    // no `@syntax role` has no `forall` to be recognized by, and reading it as
    // an atom would discard `P -> Q` and leave a trivially satisfiable table.
    const modal = languageFromSource(MODAL_SPEC);

    if (modal === null) {
      throw new Error("the modal fixture does not read as a language");
    }

    const result = parseFormula("[]P", modal);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.params?.construct).toBe("[]");
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

  test("uppercase sorts before lowercase, as the letters do", () => {
    expect(collectAtoms([parse("q /\\ P /\\ p")])).toEqual(["P", "p", "q"]);
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

describe("connectives past the five carnap-prop declares", () => {
  const registered = languageFromSource(EXTENDED_SPEC);

  if (registered === null) {
    throw new Error("the extended fixture does not read as a language");
  }

  // Rebound rather than narrowed in place: the helpers below are hoisted
  // function declarations, so `tsc` cannot assume the check above ran first.
  const extended = registered;

  function evalIn(source: string, values: Record<string, boolean>): boolean {
    const result = parseFormula(source, extended);

    if (!result.ok) {
      throw new Error(
        `Expected '${source}' to parse: ${result.errors[0]?.message}`,
      );
    }

    return evaluate(result.formula, new Map(Object.entries(values)));
  }

  const T = { P: true, Q: true };
  const TF = { P: true, Q: false };
  const FT = { P: false, Q: true };
  const F = { P: false, Q: false };

  test("nand is false only when both are true", () => {
    expect([T, TF, FT, F].map((v) => evalIn("P | Q", v))).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });

  test("nor is true only when both are false", () => {
    expect([T, TF, FT, F].map((v) => evalIn("P ! Q", v))).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  test("exclusive disjunction is the negated biconditional", () => {
    expect([T, TF, FT, F].map((v) => evalIn("P + Q", v))).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  test("a projection ignores the operand it projects away", () => {
    expect([T, TF, FT, F].map((v) => evalIn("P % Q", v))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  test("the truth constants are constant", () => {
    expect(evalIn("⊤", F)).toBe(true);
    expect(evalIn("⊥", T)).toBe(false);
  });

  test("a truth constant is a column, never a reference column", () => {
    // Nothing varies, so there is no atom to enumerate — but the student
    // still writes its value under the symbol, which means a column of its
    // own rather than the silence an atom occurrence gets.
    const result = buildTruthTable(["P & ⊥"], extended);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.table.atoms).toEqual(["P"]);
      expect(
        result.table.formulas[0]?.columns.map(
          (column) => column.formula.type,
        ),
      ).toEqual(["and", "falsum"]);
      expect(result.table.formulas[0]?.values).toEqual([
        [false, false],
        [false, false],
      ]);
    }
  });

  test("cells are drawn in the spec's spelling, not carnap-prop's", () => {
    // The bug this closes: symbols were a hardcoded ASCII table in
    // `layout.ts`, so a course spelling conjunction `&` had its formula
    // *stored* as `(P & Q)` and *drawn* as `(P /\ Q)`. A connective the
    // author declared themselves had no spelling here at all.
    const result = parseFormula("~(P & Q) | R", extended);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(
        formulaCells(result.formula, extended).map((c) => c.text),
      ).toEqual(["~", "P", "&", "Q", "|", "R"]);
    }
  });
});
