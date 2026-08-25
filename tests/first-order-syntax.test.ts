import { describe, expect, test } from "bun:test";
import type { SurfaceLanguage } from "@aufbau/syntax";
import type { Formula } from "../src/worker/exercises/first-order";
import {
  DEFAULT_LANGUAGE_ID,
  firstOrderLanguage,
  formulaToString,
  parseFormula,
} from "../src/worker/exercises/first-order";

/**
 * What the model and translation types accept as a formula, and what they show
 * back.
 *
 * The language is `logic/theories/forallx-calgary-2019.mm0` — registered as a
 * spec under the same name, since that file is both — and the parser is
 * `@aufbau/syntax`; what is tested here is the pairing — that *this* spec, read
 * by *that* parser, is still the forallx of the 2019 Calgary edition, and that
 * a parse becomes the {@link Formula} tree the evaluators want. The library has
 * its own corpus for the parser itself.
 *
 * **Subscripted letters (`F_12`, `x_1`) are gone**, deliberately. The lexicon is
 * an MM0 signature, so the vocabulary is finite: 26 predicate letters and 18
 * function letters, no more. The hand parser this replaced lexed an unbounded
 * subscript, and Graham's call on 2026-08-24 was to accept the loss rather than
 * hold the unification for a library feature to restore it.
 */

const CALGARY = language(DEFAULT_LANGUAGE_ID);

function language(id: string): SurfaceLanguage {
  const found = firstOrderLanguage(id);

  if (found === null) {
    throw new Error(`no first-order language under the id ${id}`);
  }

  return found;
}

function parse(source: string, lang: SurfaceLanguage = CALGARY): Formula {
  const result = parseFormula(source, lang);

  if (!result.ok) {
    throw new Error(
      `Expected '${source}' to parse: ${result.errors[0]?.message}`,
    );
  }

  return result.formula;
}

function failure(source: string, lang: SurfaceLanguage = CALGARY) {
  const result = parseFormula(source, lang);

  if (result.ok) {
    throw new Error(
      `Expected '${source}' to fail, got ${formulaToString(
        result.formula,
        lang,
      )}`,
    );
  }

  const error = result.errors[0];

  if (error === undefined) {
    throw new Error(`Expected '${source}' to report an error.`);
  }

  return error;
}

/**
 * A formula written back out. There is one such form now: what a reader sees
 * *is* what a compiled exercise stores, because both are the spec's canonical
 * spelling of every symbol. The hand parser had two, and nothing but habit
 * kept the two tables agreeing.
 */
function show(source: string, lang: SurfaceLanguage = CALGARY): string {
  return formulaToString(parse(source, lang), lang);
}

describe("the language registry", () => {
  test("the default language is one of ours; a stray id is not", () => {
    expect(firstOrderLanguage(DEFAULT_LANGUAGE_ID)).not.toBeNull();
    expect(firstOrderLanguage("firstOrder")).toBeNull();
  });

  test("a spec that ships but does not quantify is refused here", () => {
    // `carnap-prop` reads fine as a language — it is the truth-table type's —
    // and is still not something a model exercise may be set in.
    expect(firstOrderLanguage("carnap-prop")).toBeNull();
  });

  test("every overlapping spelling resolves to the longer operator", () => {
    // `->` over `-`, `=>` over `=`, `<->` over `<>`, `!=` over `!?`: each pair
    // would silently mis-parse if segmentation took the shorter match.
    expect(show("P -> Q")).toBe("P → Q");
    expect(show("-P")).toBe("¬P");
    expect(show("a = b")).toBe("a=b");
    expect(show("P => Q")).toBe("P → Q");
    expect(show("P <-> Q")).toBe("P ↔ Q");
    expect(show("P <> Q")).toBe("P ↔ Q");
    expect(show("a != b")).toBe("¬a=b");
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
    expect(parse("AxR(x,a)")).toEqual({
      body: {
        args: [
          { name: "x", type: "variable" },
          { name: "a", type: "constant" },
        ],
        name: "R",
        type: "predicate",
      },
      type: "forall",
      variable: "x",
    });
  });

  test("a subscript is no longer part of the lexicon", () => {
    // The casualty named at the top of this file. `_` is not a token of the
    // language at all, so it is reported as what it is rather than mis-read.
    const error = failure("F_1(a)");

    expect(error.message).toBe("“{chunk}” is not part of this language.");
    expect(error.params).toEqual({ chunk: "_1" });
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
    // One declaration covers both: bare, with the argument sequence elided,
    // `f` is a constant.
    expect(parse("f = b")).toEqual({
      left: { name: "f", type: "constant" },
      right: { name: "b", type: "constant" },
      type: "identity",
    });
  });

  test("functions nest", () => {
    expect(show("f(g(a),b) = c")).toBe("f(g(a),b)=c");
  });

  test("s and t are variables, and only variables", () => {
    // The one divergence the spec's header left open: the hand parser's table
    // listed `s` and `t` in the function letters *and* the variable letters, so
    // `s(x)` parsed. A letter is a `@vars` pool member or a declared term, not
    // both, and the pool is what forallx's own text says it is.
    expect(parse("AsF(s)")).toEqual({
      body: {
        args: [{ name: "s", type: "variable" }],
        name: "F",
        type: "predicate",
      },
      type: "forall",
      variable: "s",
    });
    expect(parseFormula("s(x) = a", CALGARY).ok).toBe(false);
  });

  test("inequality is sugar for a negated identity", () => {
    // `≠` is a `def` in the spec, and unfolding it here is what keeps the
    // formula tree free of a node whose only content is the shorter spelling.
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
    // `A` and `E` are also predicate letters, and the parser resolves the
    // ambiguity by backtracking — notation first, letter second.
    expect(parse("A")).toEqual({ args: [], name: "A", type: "predicate" });
    expect(show("A /\\ E")).toBe("A ∧ E");
    // `E(x)` is the predicate E — parentheses mean arguments, not a quantifier.
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
    expect(parse("AxF(x) -> G(a)").type).toBe("if");
    expect(show("AxF(x) -> G(a)")).toBe("∀xF(x) → G(a)");
    expect(show("Ax(F(x) -> G(a))")).toBe("∀x(F(x) → G(a))");
  });

  test("quantifiers and negations stack without parentheses", () => {
    expect(show("AxEy~R(x,y)")).toBe("∀x∃y¬R(x,y)");
    expect(show("~~P")).toBe("¬¬P");
    expect(show("~AxF(x)")).toBe("¬∀xF(x)");
  });

  test("negation scopes over a primary only", () => {
    expect(show("~P /\\ Q")).toBe("¬P ∧ Q");
    expect(parse("~P /\\ Q").type).toBe("and");
  });

  test("a variable must follow the quantifier symbol", () => {
    // `a` is a name, not a variable.
    for (const source of ["∀aF(a)", "@aF(a)"]) {
      expect(failure(source).message).toBe(
        "Expected a variable after the quantifier.",
      );
    }
  });

  test("the ASCII quantifier `A` says less, because it is also a letter", () => {
    // `A` is a predicate letter *and* forallx's ASCII ∀, and one file cannot
    // declare it as both — MM0 gives a math token one meaning, and the term
    // `A` has to stay writable in the theory's own congruence axioms. So the
    // notation comes off and an elaboration rule puts the spelling back:
    // `A` followed by a variable becomes `∀`, and `A` followed by anything
    // else stays the letter. `Aa` is therefore the sentence letter `A` with a
    // stray name after it, which is what this says — a real cost of the
    // convergence, and the reason `∀`/`@` are worth teaching alongside it.
    expect(failure("AaF(a)")).toEqual({
      message: "Unexpected “{token}”.",
      params: { token: "a" },
      position: 1,
    });
    expect(show("AxF(x)")).toBe("∀xF(x)");
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
    expect(show("AxF(x) /\\ AxG(x)")).toBe("∀xF(x) ∧ ∀xG(x)");
  });
});

describe("precedence and association", () => {
  test("conjunction and disjunction share one rung, left-associatively", () => {
    // Not a precedence claim: in forallx neither binds tighter than the other,
    // so the grouping is purely positional. `carnap-prop` reads the second of
    // these the other way, which is why they are two specs.
    expect(show("P /\\ Q \\/ R")).toBe("(P ∧ Q) ∨ R");
    expect(show("P \\/ Q /\\ R")).toBe("(P ∨ Q) ∧ R");
    expect(show("P /\\ Q /\\ R")).toBe("(P ∧ Q) ∧ R");
  });

  test("negation binds tighter than any two-place connective", () => {
    expect(show("~P \\/ Q")).toBe("¬P ∨ Q");
    expect(parse("~P \\/ Q").type).toBe("or");
  });

  test("a conditional binds looser than conjunction", () => {
    expect(show("P /\\ Q -> R")).toBe("(P ∧ Q) → R");
  });

  test("conditionals and biconditionals refuse to chain", () => {
    const error = failure("P -> Q -> R");

    expect(error.message).toBe(
      "“{operator}” cannot be chained; add parentheses to group it.",
    );
    expect(error.params).toEqual({ operator: "->" });
    expect(show("P -> (Q -> R)")).toBe("P → (Q → R)");
    expect(failure("P <-> Q <-> R").params).toEqual({ operator: "<->" });
    // The two share a rung, so mixing them does not chain either.
    expect(failure("P -> Q <-> R").params).toEqual({ operator: "<->" });
  });
});

describe("parenthesization", () => {
  test("brackets may enclose a two-place compound", () => {
    expect(show("(P /\\ Q)")).toBe("P ∧ Q");
    expect(show("[P /\\ Q]")).toBe("P ∧ Q");
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
    expect(show("Ax(R(x,a) -> F(x))")).toBe("∀x(R(x,a) → F(x))");
  });
});

describe("round-tripping", () => {
  test("what is stored parses back to the same formula", () => {
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

      expect(parseFormula(once, CALGARY).ok, once).toBe(true);
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

  test("a term where a formula belongs says so in words", () => {
    // The library says "this has sort tm"; `logic/specs/diagnostics.ts` is
    // where that becomes a sentence about terms and sentences.
    const error = failure("a");

    expect(error.message).toBe("This is a {kind}, not a complete sentence.");
    expect(error.params).toEqual({ kind: "term" });
  });

  test("a sentence where a term belongs says so too", () => {
    expect(failure("F(P)").params).toEqual({
      actual: "sentence",
      expected: "term",
    });
  });

  test("an unknown character is named", () => {
    const error = failure("P # Q");

    expect(error.message).toBe("“{chunk}” is not part of this language.");
    expect(error.params).toEqual({ chunk: "#" });
    expect(error.position).toBe(2);
  });

  test("the dropped spellings fail rather than mis-parsing", () => {
    // The English word operators collide with the constant and function letters,
    // so they are not accepted; `^n` arity annotations are not either.
    for (const source of ["P and Q", "P or Q", "not P", "F^2(a,b)"]) {
      expect(parseFormula(source, CALGARY).ok, source).toBe(false);
    }
  });

  test("juxtaposed predicates are the other edition, and fail loudly", () => {
    // `Fab` is pre-2019 forallx. Reading it would need that book's spec, which
    // declares the juxtaposition rather than inheriting it by accident.
    expect(parseFormula("Fab", CALGARY).ok).toBe(false);
  });
});

describe("how a formula is written back out", () => {
  /**
   * Every expectation here was taken from the original rather than reasoned out:
   * the combinator structure of Carnap's parser and the `Schematizable`
   * instances it prints through were replicated in Haskell and run (GHC, parsec
   * 3.1.16), and these are its outputs. What used to be a hardcoded symbol table
   * is now the spec's last-declared notation for each role, and `dropOuterParens`
   * is `@syntax display drop-outer-parens` in the same file.
   */
  test("connectives and quantifiers are logical symbols, not ascii", () => {
    expect(show("~~P")).toBe("¬¬P");
    expect(show("P <-> Q")).toBe("P ↔ Q");
    expect(show("AxEy~R(x,y)")).toBe("∀x∃y¬R(x,y)");
    expect(show("⊥ \\/ ⊤")).toBe("⊥ ∨ ⊤");
  });

  test("every binary compound is parenthesized, except the outermost", () => {
    expect(show("P /\\ Q")).toBe("P ∧ Q");
    expect(show("P /\\ Q \\/ R")).toBe("(P ∧ Q) ∨ R");
    expect(show("AxF(x) -> G(a)")).toBe("∀xF(x) → G(a)");
    expect(show("Ax(F(x) -> G(x))")).toBe("∀x(F(x) → G(x))");
    expect(show("~(P /\\ Q)")).toBe("¬(P ∧ Q)");
  });

  test("a quantifier or a negation is written straight onto what follows", () => {
    expect(show("AxAyf(x,y) = f(y,x)")).toBe("∀x∀yf(x,y)=f(y,x)");
    expect(show("ExEy~x = y")).toBe("∃x∃y¬x=y");
  });

  test("identity closes up and inequality is a negated identity", () => {
    expect(show("a = b")).toBe("a=b");
    expect(show("a != b")).toBe("¬a=b");
  });

  test("predicates keep their parentheses; a sentence letter has none", () => {
    expect(show("R(a,b)")).toBe("R(a,b)");
    expect(show("P")).toBe("P");
  });
});
