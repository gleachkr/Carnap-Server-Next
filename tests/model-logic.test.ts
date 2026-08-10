import { describe, expect, test } from "bun:test";
import type { FirstOrderDialect } from "../src/worker/exercises/model/logic/dialect";
import {
  DEFAULT_DIALECT_ID,
  dialectById,
  FORALLX_CALGARY_2019,
  operatorSpellings,
} from "../src/worker/exercises/model/logic/dialect";
import type { Formula } from "../src/worker/exercises/model/logic/formula";
import {
  formulaToDisplay,
  formulaToString,
  parseFormula,
} from "../src/worker/exercises/model/logic/formula";

const CALGARY = FORALLX_CALGARY_2019;

function parse(
  source: string,
  dialect: FirstOrderDialect = CALGARY,
): Formula {
  const result = parseFormula(source, dialect);

  if (!result.ok) {
    throw new Error(
      `Expected '${source}' to parse: ${result.errors[0]?.message}`,
    );
  }

  return result.formula;
}

function failure(source: string, dialect: FirstOrderDialect = CALGARY) {
  const result = parseFormula(source, dialect);

  if (result.ok) {
    throw new Error(
      `Expected '${source}' to fail, got ${formulaToString(
        result.formula,
        dialect,
      )}`,
    );
  }

  const error = result.errors[0];

  if (error === undefined) {
    throw new Error(`Expected '${source}' to report an error.`);
  }

  return error;
}

/** Canonical source, for comparing readings without asserting on AST shape. */
function show(source: string, dialect: FirstOrderDialect = CALGARY): string {
  return formulaToString(parse(source, dialect), dialect);
}

/** The reader-facing form: logical symbols, as the original prints them. */
function display(
  source: string,
  dialect: FirstOrderDialect = CALGARY,
): string {
  return formulaToDisplay(parse(source, dialect), dialect);
}

describe("the dialect table", () => {
  test("the default dialect is registered under its id", () => {
    expect(dialectById(DEFAULT_DIALECT_ID)).toBe(CALGARY);
    expect(dialectById("firstOrder")).toBeNull();
  });

  test("operator spellings are offered longest first", () => {
    const spellings = operatorSpellings(CALGARY);
    const lengths = spellings.map((entry) => entry.text.length);

    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });

  test("every overlapping spelling resolves to the longer operator", () => {
    // `->` over `-`, `=>` over `=`, `<->` over `<>`, `!=` over `!?`: each pair
    // would silently mis-parse if the tokenizer took the shorter match.
    expect(show("P -> Q")).toBe("P -> Q");
    expect(show("-P")).toBe("~P");
    expect(show("a = b")).toBe("a = b");
    expect(show("P => Q")).toBe("P -> Q");
    expect(show("P <-> Q")).toBe("P <-> Q");
    expect(show("P <> Q")).toBe("P <-> Q");
    expect(show("a != b")).toBe("~a = b");
  });
});

describe("atoms and terms", () => {
  test("a bare predicate letter is a sentence letter", () => {
    expect(parse("P")).toEqual({ args: [], name: "P", type: "predicate" });
  });

  test("predicates take parenthesized arguments", () => {
    expect(parse("R(a,b)")).toEqual({
      args: [
        { name: "a", type: "constant" },
        { name: "b", type: "constant" },
      ],
      name: "R",
      type: "predicate",
    });
    // Subscripts reach variables too, and bind as one name.
    expect(parse("Ax_1R(x_1,a)")).toEqual({
      body: {
        args: [
          { name: "x_1", type: "variable" },
          { name: "a", type: "constant" },
        ],
        name: "R",
        type: "predicate",
      },
      type: "forall",
      variable: "x_1",
    });
  });

  test("a subscript needs digits, and joins the symbol's name", () => {
    expect(parse("F_12(a)")).toEqual({
      args: [{ name: "a", type: "constant" }],
      name: "F_12",
      type: "predicate",
    });
    // A lone underscore is not a subscript, so `F_` is `F` then a stray `_`.
    expect(failure("F_").message).toBe("Unexpected character “{character}”.");
  });

  test("a lowercase letter is a function only when arguments follow", () => {
    expect(parse("f(a) = b")).toEqual({
      left: {
        args: [{ name: "a", type: "constant" }],
        name: "f",
        type: "function",
      },
      right: { name: "b", type: "constant" },
      type: "identity",
    });
    // `f` is in both the constant and the function range; bare, it is a constant.
    expect(parse("f = b")).toEqual({
      left: { name: "f", type: "constant" },
      right: { name: "b", type: "constant" },
      type: "identity",
    });
  });

  test("functions nest", () => {
    expect(show("f(g(a),b) = c")).toBe("f(g(a),b) = c");
  });

  test("inequality is sugar for a negated identity", () => {
    expect(parse("a != b")).toEqual({
      operand: {
        left: { name: "a", type: "constant" },
        right: { name: "b", type: "constant" },
        type: "identity",
      },
      type: "not",
    });
    expect(parse("a ≠ b")).toEqual(parse("a != b"));
  });

  test("boolean constants are sentences", () => {
    expect(parse("⊥")).toEqual({ type: "falsum" });
    expect(parse("_|_")).toEqual({ type: "falsum" });
    expect(parse("!?")).toEqual({ type: "falsum" });
    expect(parse("⊤")).toEqual({ type: "verum" });
  });
});

describe("quantifiers", () => {
  test("A and E bind the variable that follows them", () => {
    expect(parse("AxF(x)")).toEqual({
      body: {
        args: [{ name: "x", type: "variable" }],
        name: "F",
        type: "predicate",
      },
      type: "forall",
      variable: "x",
    });
    expect(parse("ExF(x)").type).toBe("exists");
  });

  test("the ASCII and unicode quantifier glyphs agree", () => {
    for (const source of ["∀xF(x)", "@xF(x)"]) {
      expect(parse(source)).toEqual(parse("AxF(x)"));
    }

    for (const source of ["∃xF(x)", "3xF(x)"]) {
      expect(parse(source)).toEqual(parse("ExF(x)"));
    }
  });

  test("a quantifier letter with no variable after it is a sentence letter", () => {
    // `A` and `E` are also predicate letters. The disambiguation is whether a
    // variable follows, which is how Carnap's ordered alternatives resolve it.
    expect(parse("A")).toEqual({ args: [], name: "A", type: "predicate" });
    expect(show("A /\\ E")).toBe("A /\\ E");
    expect(parse("A_1(b)")).toEqual({
      args: [{ name: "b", type: "constant" }],
      name: "A_1",
      type: "predicate",
    });
    // `E(x)` is the predicate E — parentheses mean arguments, not a quantifier.
    // No brackets around the body: it is an atom, and this dialect brackets
    // only two-place compounds.
    expect(parse("ExE(x)")).toEqual({
      body: {
        args: [{ name: "x", type: "variable" }],
        name: "E",
        type: "predicate",
      },
      type: "exists",
      variable: "x",
    });
  });

  test("a quantifier's scope is the primary that follows it, not the rest", () => {
    // The forallx reading: `AxF(x) -> G(a)` is a conditional whose antecedent is
    // quantified, NOT a quantified conditional.
    const parsed = parse("AxF(x) -> G(a)");

    expect(parsed.type).toBe("if");
    // Printing back adds no brackets around the quantified antecedent, because
    // this dialect would reject them — and it does not need them, since the
    // quantifier could not have reached past `F(x)` anyway.
    expect(show("AxF(x) -> G(a)")).toBe("AxF(x) -> G(a)");
    expect(show("Ax(F(x) -> G(a))")).toBe("Ax(F(x) -> G(a))");
  });

  test("quantifiers and negations stack without parentheses", () => {
    expect(show("AxEy~R(x,y)")).toBe("AxEy~R(x,y)");
    expect(show("~~P")).toBe("~~P");
    expect(show("~AxF(x)")).toBe("~AxF(x)");
  });

  test("negation scopes over a primary only", () => {
    expect(show("~P /\\ Q")).toBe("~P /\\ Q");
    expect(parse("~P /\\ Q").type).toBe("and");
  });

  test("a variable must follow the quantifier symbol", () => {
    // `Aa` — `a` is a constant, not a variable, so this is not a quantifier at
    // all: it lexes as the sentence letter A followed by a stray term.
    expect(failure("AaF(a)").message).toBe("Unexpected “{token}”.");
    expect(failure("∀aF(a)").message).toBe(
      "Expected a variable after the quantifier.",
    );
  });
});

describe("free variables", () => {
  test("an unbound variable is rejected, with its own position", () => {
    const error = failure("F(x)");

    expect(error.message).toBe(
      "“{name}” is a free variable; every formula must be a sentence.",
    );
    expect(error.params).toEqual({ name: "x" });
    expect(error.position).toBe(2);
  });

  test("a variable is free outside the quantifier that binds it", () => {
    expect(() => parse("AxF(x) /\\ G(x)")).toThrow();
    expect(show("AxF(x) /\\ AxG(x)")).toBe("AxF(x) /\\ AxG(x)");
  });

  test("a dialect that permits open formulas accepts them", () => {
    // Guarding the flag itself: the evaluator has no universal-closure step, so
    // nothing may set this false until that lands.
    const open: FirstOrderDialect = {
      ...CALGARY,
      requiresClosedFormulas: false,
    };

    expect(parse("F(x)", open)).toEqual({
      args: [{ name: "x", type: "variable" }],
      name: "F",
      type: "predicate",
    });
  });
});

describe("precedence and association", () => {
  test("conjunction and disjunction share one rung, left-associatively", () => {
    // Not a precedence claim: in forallx neither binds tighter than the other,
    // so the grouping is purely positional. Our propositional `prop` parser
    // reads the second of these the other way, which is why the model type has
    // its own parser rather than reusing that one.
    expect(show("P /\\ Q \\/ R")).toBe("(P /\\ Q) \\/ R");
    expect(show("P \\/ Q /\\ R")).toBe("(P \\/ Q) /\\ R");
    expect(show("P /\\ Q /\\ R")).toBe("(P /\\ Q) /\\ R");
  });

  test("negation binds tighter than any two-place connective", () => {
    expect(show("~P \\/ Q")).toBe("~P \\/ Q");
    expect(parse("~P \\/ Q").type).toBe("or");
  });

  test("a conditional binds looser than conjunction", () => {
    expect(show("P /\\ Q -> R")).toBe("(P /\\ Q) -> R");
  });

  test("conditionals and biconditionals refuse to chain", () => {
    const error = failure("P -> Q -> R");

    expect(error.message).toBe(
      "“{operator}” cannot be chained; add parentheses to group it.",
    );
    expect(error.params).toEqual({ operator: "->" });
    expect(show("P -> (Q -> R)")).toBe("P -> (Q -> R)");
    expect(failure("P <-> Q <-> R").params).toEqual({ operator: "<->" });
    // The two share a rung, so mixing them does not chain either.
    expect(failure("P -> Q <-> R").params).toEqual({ operator: "<->" });
  });
});

describe("parenthesization", () => {
  test("brackets may enclose a two-place compound", () => {
    expect(show("(P /\\ Q)")).toBe("P /\\ Q");
    expect(show("[P /\\ Q]")).toBe("P /\\ Q");
  });

  test("brackets around anything else are a mistake, not noise", () => {
    // forallx's convention, and Carnap's `zachDispatch` guard. Each of these is
    // accepted by most other systems.
    for (const source of ["(P)", "(~P)", "(AxF(x))", "(a = b)", "(⊥)"]) {
      expect(failure(source).message).toBe(
        "Parentheses may only enclose a sentence joined by a two-place connective.",
      );
    }
  });

  test("the mistake is reported at the opening bracket", () => {
    expect(failure("P /\\ (Q)").position).toBe(5);
  });

  test("a group must close with the bracket that opened it", () => {
    const error = failure("(P /\\ Q]");

    expect(error.message).toBe("Expected “{bracket}”.");
    expect(error.params).toEqual({ bracket: ")" });
  });

  test("argument lists are not subject to the binary-only rule", () => {
    expect(show("R(a,b)")).toBe("R(a,b)");
    expect(show("Ax(R(x,a) -> F(x))")).toBe("Ax(R(x,a) -> F(x))");
  });
});

describe("round-tripping", () => {
  test("canonical source parses back to the same formula", () => {
    for (const source of [
      "AxF(x)",
      "Ax(F(x) -> G(x))",
      "AxAyf(x,y) = f(y,x)",
      "AxEyR(x,y)",
      "ExEy~x = y",
      "~Ex(F(x) /\\ ~G(x))",
      "(P /\\ Q) \\/ R",
      "P -> (Q -> R)",
      "Ex(F(x) /\\ x != a)",
      "⊥ \\/ ⊤",
    ]) {
      const once = show(source);

      expect(show(once)).toBe(once);
    }
  });

  test("the manual's own examples parse, in Calgary spelling", () => {
    // From `Carnap-Manual/modelchecker.qmd`. The manual writes them in Carnap's
    // default `firstOrder` system, which is more permissive than Calgary in two
    // ways an author porting content will meet immediately: `not` for `~`, and
    // brackets around an identity or a negation, which forallx does not allow
    // (only a two-place compound may be bracketed).
    const asWritten = ["AxAy(f(x,y) = f(y,x))", "ExEy(not x = y)"];
    const inCalgary = [
      "AxF(x)",
      "ExG(x)",
      "AxAyf(x,y) = f(y,x)",
      "AxEyF(x,y)",
      "ExAyF(y,x)",
      "ExEy~x = y",
      "AxAyF(x,y)",
    ];

    for (const source of asWritten) {
      expect(parseFormula(source, CALGARY).ok).toBe(false);
    }

    for (const source of inCalgary) {
      expect(parseFormula(source, CALGARY).ok).toBe(true);
    }
  });
});

describe("errors an author will actually hit", () => {
  test("an empty formula reports rather than throwing", () => {
    expect(failure("").message).toBe("Expected a formula.");
    expect(failure("   ").message).toBe("Expected a formula.");
  });

  test("an unclosed argument list names the bracket it wanted", () => {
    expect(failure("F(a").message).toBe("Expected “{bracket}”.");
  });

  test("a missing operand is reported at the end of the source", () => {
    const error = failure("P /\\");

    expect(error.message).toBe("Expected a formula.");
    expect(error.position).toBe(4);
  });

  test("a term where a formula belongs asks for the identity sign", () => {
    expect(failure("a").message).toBe(
      "Expected “{operator}” after this term.",
    );
  });

  test("an unknown character is named", () => {
    const error = failure("P # Q");

    expect(error.message).toBe("Unexpected character “{character}”.");
    expect(error.params).toEqual({ character: "#" });
    expect(error.position).toBe(2);
  });

  test("the dropped spellings fail rather than mis-parsing", () => {
    // The English word operators collide with the constant and function letters,
    // so they are not accepted; `^n` arity annotations are not either.
    for (const source of ["P and Q", "P or Q", "not P", "F^2(a,b)"]) {
      expect(parseFormula(source, CALGARY).ok).toBe(false);
    }
  });

  test("a juxtaposed-predicate dialect fails loudly rather than mis-parsing", () => {
    const juxtaposed: FirstOrderDialect = {
      ...CALGARY,
      predicatesTakeParens: false,
    };

    expect(parseFormula("Fx", juxtaposed).ok).toBe(false);
  });
});

describe("how a formula is shown to a reader", () => {
  /**
   * Every expectation here was taken from the original rather than reasoned out:
   * the combinator structure of Carnap's parser and the `Schematizable`
   * instances it prints through were replicated in Haskell and run (GHC, parsec
   * 3.1.16), and these are its outputs. The display symbols are fixed in Carnap
   * — every system shares them — and `dropOuterParens` is the rewriter the 2019
   * Calgary systems put on top.
   */
  test("connectives and quantifiers are logical symbols, not ascii", () => {
    expect(display("~~P")).toBe("¬¬P");
    expect(display("P <-> Q")).toBe("P ↔ Q");
    expect(display("AxEy~R(x,y)")).toBe("∀x∃y¬R(x,y)");
    expect(display("⊥ \\/ ⊤")).toBe("⊥ ∨ ⊤");
  });

  test("every binary compound is parenthesized, except the outermost", () => {
    // `schematize` brackets every binary; `dropOuterParens` takes off the one
    // redundant pair that leaves around the whole formula, and only that one.
    expect(display("P /\\ Q")).toBe("P ∧ Q");
    expect(display("P /\\ Q \\/ R")).toBe("(P ∧ Q) ∨ R");
    expect(display("AxF(x) -> G(a)")).toBe("∀xF(x) → G(a)");
    expect(display("Ax(F(x) -> G(x))")).toBe("∀x(F(x) → G(x))");
    expect(display("~(P /\\ Q)")).toBe("¬(P ∧ Q)");
  });

  test("a quantifier or a negation is written straight onto what follows", () => {
    expect(display("AxAyf(x,y) = f(y,x)")).toBe("∀x∀yf(x,y)=f(y,x)");
    expect(display("ExEy~x = y")).toBe("∃x∃y¬x=y");
  });

  test("identity closes up and inequality is a negated identity", () => {
    expect(display("a = b")).toBe("a=b");
    expect(display("a != b")).toBe("¬a=b");
  });

  test("predicates keep their parentheses; a sentence letter has none", () => {
    expect(display("R(a,b)")).toBe("R(a,b)");
    expect(display("P")).toBe("P");
    expect(display("F_12(a)")).toBe("F_12(a)");
  });

  test("the display form is itself legal input", () => {
    // Not a coincidence: forallx brackets exactly the compounds its own
    // parenthesization rule permits brackets around, so printing and reading
    // agree. It also means a displayed formula round-trips.
    for (const source of [
      "P /\\ Q \\/ R",
      "Ax(F(x) -> G(x))",
      "~(P /\\ Q)",
      "AxAyf(x,y) = f(y,x)",
      "ExEy~x = y",
      "a != b",
    ]) {
      const shown = display(source);

      expect(parseFormula(shown, CALGARY).ok, shown).toBe(true);
      expect(display(shown)).toBe(shown);
    }
  });
});
