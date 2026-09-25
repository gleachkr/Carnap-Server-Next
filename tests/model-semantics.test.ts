import { describe, expect, test } from "bun:test";
import type { SurfaceLanguage } from "@aufbau/syntax";
import type {
  FiniteModel,
  Formula,
  ModelInput,
  ModelTarget,
  ModelTask,
} from "../src/worker/exercises/model/logic";
import {
  checkModel,
  DEFAULT_LANGUAGE_ID,
  DOMAIN_FIELD_LABEL,
  firstOrderLanguageFor,
  formatFunctionTable,
  formulaToString,
  functionTableLayout,
  MAX_DOMAIN_SIZE,
  modelSignature,
  parseDomain,
  parseFormula,
  parseFunctionTable,
  parseNatural,
  parseTupleList,
  readModel,
  satisfies,
  tupleKey,
  tuplesOver,
} from "../src/worker/exercises/model/logic";
import { theorySourceByFileName } from "../src/worker/logic/theories";
import {
  FIXED_ARITY_SPEC_SOURCE,
  fixedArityLanguage,
} from "./helpers/fixed-arity-language";

/** The forallx spec, resolved once — a language is tables, not data. */
function calgary(): SurfaceLanguage {
  const found = firstOrderLanguageFor({ dialect: DEFAULT_LANGUAGE_ID });

  if (found === null) {
    throw new Error(`no first-order language under ${DEFAULT_LANGUAGE_ID}`);
  }

  return found;
}

const CALGARY = calgary();

function parse(source: string): Formula {
  const result = parseFormula(source, CALGARY);

  if (!result.ok) {
    throw new Error(
      `Expected '${source}' to parse: ${result.errors[0]?.message}`,
    );
  }

  return result.formula;
}

/** The empty interpretation over a one-element domain. */
function bareModel(): FiniteModel {
  return {
    constants: new Map(),
    domain: [0],
    functions: new Map(),
    propositions: new Map(),
    relations: new Map(),
  };
}

/** Read a model against the signature the formulas themselves imply. */
function readFor(
  sources: readonly string[],
  input: ModelInput,
): ReturnType<typeof readModel> {
  return readModel(modelSignature(sources.map(parse), CALGARY), input);
}

function holds(source: string, input: ModelInput): boolean {
  const read = readFor([source], input);

  if (!read.ok) {
    throw new Error(`Expected the model to read: ${read.problem.kind}`);
  }

  return satisfies(parse(source), read.model);
}

function task(
  targeted: readonly string[],
  target: ModelTarget,
  required: readonly string[] = [],
): ModelTask {
  return {
    required: required.map(parse),
    target,
    targeted: targeted.map(parse),
  };
}

describe("field syntax", () => {
  test("a domain is naturals, with a trailing comma allowed", () => {
    expect(parseDomain("0,1,2")).toEqual({ ok: true, value: [0, 1, 2] });
    expect(parseDomain(" 0 , 1 , ")).toEqual({ ok: true, value: [0, 1] });
    expect(parseDomain("7")).toEqual({ ok: true, value: [7] });
  });

  test("a repeated domain element is collapsed, not counted twice", () => {
    // Quantifiers range over the list, so a duplicate would evaluate an element
    // twice — harmless for truth, but it would make the domain size wrong.
    expect(parseDomain("0,0,1")).toEqual({ ok: true, value: [0, 1] });
  });

  test("a domain of anything but naturals does not read", () => {
    for (const text of ["a", "0,x", "-1", "0..2", ","]) {
      expect(parseDomain(text).ok).toBe(false);
    }
  });

  test("tuples may be bracketed three ways, and 1-tuples bare", () => {
    expect(parseTupleList("[0,0],[1,0]", 2)).toEqual({
      ok: true,
      value: [
        [0, 0],
        [1, 0],
      ],
    });
    expect(parseTupleList("<1,1>", 2)).toEqual({ ok: true, value: [[1, 1]] });
    expect(parseTupleList("(0,1)", 2)).toEqual({ ok: true, value: [[0, 1]] });
    expect(parseTupleList("0,1,2", 1)).toEqual({
      ok: true,
      value: [[0], [1], [2]],
    });
    expect(parseTupleList("[0],[2]", 1)).toEqual({
      ok: true,
      value: [[0], [2]],
    });
  });

  test("an empty field is the empty extension", () => {
    expect(parseTupleList("", 2)).toEqual({ ok: true, value: [] });
    expect(parseTupleList("   ", 1)).toEqual({ ok: true, value: [] });
  });

  test("a tuple of the wrong length does not read", () => {
    expect(parseTupleList("[0,0]", 1).ok).toBe(false);
    expect(parseTupleList("[0]", 2).ok).toBe(false);
    expect(parseTupleList("0", 2).ok).toBe(false);
  });

  test("a function row pairs arguments with a value after a semicolon", () => {
    expect(parseFunctionTable("[0,0;1],[0,1;2]", 2)).toEqual({
      ok: true,
      value: [
        { args: [0, 0], value: 1 },
        { args: [0, 1], value: 2 },
      ],
    });
    expect(parseFunctionTable("[0;1]", 1)).toEqual({
      ok: true,
      value: [{ args: [0], value: 1 }],
    });
  });

  test("a function row must be bracketed and must have its semicolon", () => {
    expect(parseFunctionTable("0;1", 1).ok).toBe(false);
    expect(parseFunctionTable("[0,1]", 1).ok).toBe(false);
  });

  test("formatting a function table round-trips through the parser", () => {
    const rows = [
      { args: [0, 0], value: 1 },
      { args: [1, 0], value: 0 },
    ];
    const text = formatFunctionTable(rows);

    expect(text).toBe("[0,0;1],[1,0;0]");
    expect(parseFunctionTable(text, 2)).toEqual({ ok: true, value: rows });
  });

  test("a constant is one natural and nothing else", () => {
    expect(parseNatural(" 2 ")).toEqual({ ok: true, value: 2 });
    expect(parseNatural("2,3").ok).toBe(false);
    expect(parseNatural("").ok).toBe(false);
  });

  test("argument tuples enumerate in odometer order", () => {
    expect(tuplesOver([0, 1], 2)).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    expect(tuplesOver([0, 1, 2], 1)).toEqual([[0], [1], [2]]);
    expect(tuplesOver([0], 0)).toEqual([[]]);
  });

  test("an enumeration too large to fill is refused, not truncated", () => {
    expect(tuplesOver([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 3)).toBeNull();
  });

  test("a value table puts the last argument across the columns", () => {
    const binary = functionTableLayout([0, 1], 2);

    expect(binary?.columns).toEqual([0, 1]);
    expect(binary?.rows.map((row) => row.label)).toEqual(["0,_", "1,_"]);
    expect(binary?.rows.map((row) => row.cells)).toEqual([
      [
        [0, 0],
        [0, 1],
      ],
      [
        [1, 0],
        [1, 1],
      ],
    ]);
  });

  test("a unary function is one line of values under its arguments", () => {
    const unary = functionTableLayout([0, 1, 2], 1);

    expect(unary?.columns).toEqual([0, 1, 2]);
    expect(unary?.rows.length).toBe(1);
    expect(unary?.rows[0]?.cells).toEqual([[0], [1], [2]]);
    // Nothing is fixed down the side, so there is no header column to fix it
    // in: a blank label beside a blank corner reads as something withheld.
    expect(unary?.rowHeaders).toBe(false);
    expect(unary?.rows[0]?.label).toBe("");
    expect(functionTableLayout([0, 1], 2)?.rowHeaders).toBe(true);
  });

  test("reading a value table off the page gives odometer order", () => {
    // What lets the rendered table be serialized straight down the DOM: the
    // string a widget records has to be the one the parser reads back.
    const layout = functionTableLayout([0, 1, 2], 3);

    expect(layout?.rows.flatMap((row) => row.cells.map(tupleKey))).toEqual(
      (tuplesOver([0, 1, 2], 3) ?? []).map(tupleKey),
    );
  });

  test("a value table too large to fill is refused, like the enumeration", () => {
    expect(
      functionTableLayout([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 3),
    ).toBeNull();
  });
});

describe("the signature a formula implies", () => {
  test("the domain comes first, then relations, propositions, constants, functions", () => {
    // Carnap's own order (`prepareModelUI`), each group sorted by its label.
    const signature = modelSignature(
      ["Ex(R(x,a) /\\ P)", "F(b)", "AxG(f(x)) \\/ Q"].map(parse),
      CALGARY,
    );

    expect(signature.map((field) => field.label)).toEqual([
      DOMAIN_FIELD_LABEL,
      "F(_)",
      "G(_)",
      "R(_,_)",
      "P",
      "Q",
      "a",
      "b",
      "f(_)",
    ]);
  });

  test("a symbol's arity is part of its identity", () => {
    // Carnap keys relations by (index, arity), so these are two predicates.
    const signature = modelSignature(["F(a) /\\ F(a,b)"].map(parse), CALGARY);

    expect(signature.map((field) => field.label)).toEqual([
      DOMAIN_FIELD_LABEL,
      "F(_)",
      "F(_,_)",
      "a",
      "b",
    ]);
  });

  test("a bare predicate letter asks for a truth value, not an extension", () => {
    const signature = modelSignature(["P"].map(parse), CALGARY);

    expect(signature[1]).toEqual({
      arity: 0,
      kind: "proposition",
      label: "P",
      symbol: "P",
    });
  });

  test("terms nested in functions and identities are collected", () => {
    const signature = modelSignature(["f(g(a),b) = c"].map(parse), CALGARY);

    expect(signature.map((field) => field.label)).toEqual([
      DOMAIN_FIELD_LABEL,
      "a",
      "b",
      "c",
      "f(_,_)",
      "g(_)",
    ]);
  });

  test("bound variables ask for nothing", () => {
    expect(
      modelSignature(["AxEyR(x,y)"].map(parse), CALGARY).map((f) => f.label),
    ).toEqual([DOMAIN_FIELD_LABEL, "R(_,_)"]);
  });
});

describe("satisfaction", () => {
  test("a quantifier ranges over exactly the domain", () => {
    expect(
      holds("AxF(x)", { domain: "0,1", fields: { "F(_)": "0,1" } }),
    ).toBe(true);
    expect(holds("AxF(x)", { domain: "0,1", fields: { "F(_)": "0" } })).toBe(
      false,
    );
    expect(holds("ExF(x)", { domain: "0,1", fields: { "F(_)": "1" } })).toBe(
      true,
    );
    expect(holds("ExF(x)", { domain: "0,1", fields: { "F(_)": "" } })).toBe(
      false,
    );
  });

  test("widening the domain can falsify a universal claim", () => {
    const fields = { "F(_)": "0" };

    expect(holds("AxF(x)", { domain: "0", fields })).toBe(true);
    expect(holds("AxF(x)", { domain: "0,1", fields })).toBe(false);
  });

  test("relations are tuple membership, in order", () => {
    const input = { domain: "0,1", fields: { "R(_,_)": "[0,1]" } };

    expect(holds("ExEyR(x,y)", input)).toBe(true);
    expect(holds("AxAy(R(x,y) -> R(y,x))", input)).toBe(false);
  });

  test("identity is identity of domain elements", () => {
    expect(
      holds("a = b", { domain: "0,1", fields: { a: "0", b: "0" } }),
    ).toBe(true);
    expect(
      holds("a = b", { domain: "0,1", fields: { a: "0", b: "1" } }),
    ).toBe(false);
    expect(holds("ExEy~x = y", { domain: "0,1", fields: {} })).toBe(true);
    expect(holds("ExEy~x = y", { domain: "0", fields: {} })).toBe(false);
  });

  test("a sentence letter takes its truth value from its own field", () => {
    expect(holds("P", { domain: "0", fields: { P: "True" } })).toBe(true);
    expect(holds("P", { domain: "0", fields: { P: "False" } })).toBe(false);
  });

  test("functions are applied, and nest", () => {
    const input = {
      domain: "0,1",
      fields: { "f(_)": "[0;1],[1;0]", "F(_)": "1" },
    };

    expect(holds("AxF(f(x))", input)).toBe(false);
    expect(holds("ExF(f(x))", input)).toBe(true);
    expect(
      holds("Axf(f(x)) = x", {
        domain: "0,1",
        fields: { "f(_)": "[0;1],[1;0]" },
      }),
    ).toBe(true);
  });

  test("the manual's commutativity example is decided correctly", () => {
    const source = "AxAyf(x,y) = f(y,x)";
    const commutative = {
      domain: "0,1",
      fields: { "f(_,_)": "[0,0;0],[0,1;1],[1,0;1],[1,1;0]" },
    };
    const notCommutative = {
      domain: "0,1",
      fields: { "f(_,_)": "[0,0;0],[0,1;0],[1,0;1],[1,1;0]" },
    };

    expect(holds(source, commutative)).toBe(true);
    expect(holds(source, notCommutative)).toBe(false);
  });

  test("boolean constants are constant", () => {
    expect(holds("⊥", { domain: "0", fields: {} })).toBe(false);
    expect(holds("⊤", { domain: "0", fields: {} })).toBe(true);
  });

  test("an unbound variable is an internal error, not a wrong answer", () => {
    // Unreachable through the parser, which requires closed formulas; the throw
    // is what keeps a future dialect from silently evaluating garbage.
    const bare: Formula = {
      args: [{ name: "x", type: "variable" }],
      name: "F",
      type: "predicate",
    };

    expect(() => satisfies(bare, bareModel())).toThrow(
      "No assignment for variable 'x'.",
    );
  });
});

describe("reading a submitted model", () => {
  test("an empty domain is refused before anything else is looked at", () => {
    const read = readFor(["AxF(x)"], { domain: "  ", fields: {} });

    expect(read.ok).toBe(false);
    expect(read.ok === false && read.problem.kind).toBe("domain-empty");
  });

  test("a domain that does not read is reported with its offset", () => {
    const read = readFor(["P"], { domain: "0,x", fields: { P: "True" } });

    expect(read.ok === false && read.problem).toEqual({
      kind: "domain-unreadable",
      position: 2,
    });
  });

  test("a domain past the limit is refused rather than rendered", () => {
    const oversized = Array.from(
      { length: MAX_DOMAIN_SIZE + 1 },
      (_, i) => i,
    );
    const read = readFor(["AxF(x)"], {
      domain: oversized.join(","),
      fields: { "F(_)": "" },
    });

    expect(read.ok === false && read.problem).toEqual({
      kind: "domain-too-large",
      max: MAX_DOMAIN_SIZE,
    });
  });

  test("an extension must lie inside the domain", () => {
    const read = readFor(["AxF(x)"], {
      domain: "0,1",
      fields: { "F(_)": "0,2" },
    });

    expect(read.ok === false && read.problem).toEqual({
      field: "F(_)",
      kind: "field-outside-domain",
    });
  });

  test("a constant must name an element of the domain", () => {
    const read = readFor(["F(a)"], {
      domain: "0,1",
      fields: { a: "5", "F(_)": "0" },
    });

    expect(read.ok === false && read.problem).toEqual({
      field: "a",
      kind: "field-outside-domain",
    });
  });

  test("a proposition field must say True or False", () => {
    const read = readFor(["P"], { domain: "0", fields: { P: "maybe" } });

    expect(read.ok === false && read.problem.kind).toBe("field-unreadable");
  });

  test("a function must have a value for every argument tuple", () => {
    const read = readFor(["Axf(x) = x"], {
      domain: "0,1",
      fields: { "f(_)": "[0;0]" },
    });

    expect(read.ok === false && read.problem).toEqual({
      argument: "1",
      field: "f(_)",
      kind: "function-incomplete",
    });
  });

  test("a function may not give one argument two values", () => {
    const read = readFor(["Axf(x) = x"], {
      domain: "0,1",
      fields: { "f(_)": "[0;0],[0;1],[1;1]" },
    });

    expect(read.ok === false && read.problem).toEqual({
      argument: "0",
      field: "f(_)",
      kind: "function-ambiguous",
    });
  });

  test("a missing field reads as blank rather than throwing", () => {
    // The relation is unfilled, so its extension is empty and `AxF(x)` is false
    // on a non-empty domain — a legitimate model, not a malformed one.
    const read = readFor(["AxF(x)"], { domain: "0", fields: {} });

    expect(read.ok).toBe(true);
  });
});

describe("judging a task", () => {
  test("a simple exercise wants every formula true", () => {
    const input = { domain: "0,1", fields: { "F(_)": "0,1", "G(_)": "0" } };
    const verdict = checkModel(
      modelSignature(["AxF(x)", "ExG(x)"].map(parse), CALGARY),
      task(["AxF(x)", "ExG(x)"], "all-true"),
      input,
    );

    expect(verdict.ok).toBe(true);
  });

  test("the formulas that came out wrong are named by index", () => {
    const sources = ["AxF(x)", "ExG(x)"];
    const verdict = checkModel(
      modelSignature(sources.map(parse), CALGARY),
      task(sources, "all-true"),
      { domain: "0,1", fields: { "F(_)": "0", "G(_)": "0" } },
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.targetMissed).toBe(true);
    expect(verdict.targetOffenders).toEqual([0]);
  });

  test("a validity exercise needs the premises true and the conclusions false", () => {
    const sources = ["AxEyR(x,y)", "ExAyR(y,x)"];
    const signature = modelSignature(sources.map(parse), CALGARY);
    const invalidity = task([sources[1] ?? ""], "all-false", [
      sources[0] ?? "",
    ]);

    // A two-element cycle: every x has a witness, but no single x is everyone's.
    const counterexample = {
      domain: "0,1",
      fields: { "R(_,_)": "[0,1],[1,0]" },
    };
    // The full relation makes the conclusion true, so it witnesses nothing.
    const notACounterexample = {
      domain: "0,1",
      fields: { "R(_,_)": "[0,0],[0,1],[1,0],[1,1]" },
    };

    expect(checkModel(signature, invalidity, counterexample).ok).toBe(true);

    const failed = checkModel(signature, invalidity, notACounterexample);

    expect(failed.ok).toBe(false);
    expect(failed.requiredFalse).toEqual([]);
    expect(failed.targetOffenders).toEqual([0]);
  });

  test("a false premise and a missed target are reported together", () => {
    // Carnap says both at once — "not all conclusions are false in this model,
    // and not all premises are true" — so the verdict carries both.
    const signature = modelSignature(["P", "Q"].map(parse), CALGARY);
    const verdict = checkModel(signature, task(["Q"], "all-false", ["P"]), {
      domain: "0",
      fields: { P: "False", Q: "True" },
    });

    expect(verdict.requiredFalse).toEqual([0]);
    expect(verdict.targetMissed).toBe(true);
    expect(verdict.targetOffenders).toEqual([0]);
  });

  test("a constraint exercise needs the constraints true as well", () => {
    const signature = modelSignature(
      ["ExEy~x = y", "AxAyF(x,y)"].map(parse),
      CALGARY,
    );
    const constrained = task(["AxAyF(x,y)"], "all-true", ["ExEy~x = y"]);

    // A one-element domain would make the universal claim true for free, which
    // is the point of the constraint.
    const cheating = { domain: "0", fields: { "F(_,_)": "[0,0]" } };
    const honest = {
      domain: "0,1",
      fields: { "F(_,_)": "[0,0],[0,1],[1,0],[1,1]" },
    };

    expect(
      checkModel(signature, constrained, cheating).requiredFalse,
    ).toEqual([0]);
    expect(checkModel(signature, constrained, honest).ok).toBe(true);
  });

  test("a counterexample to equivalence needs the formulas to disagree", () => {
    const sources = ["AxF(x)", "ExF(x)"];
    const signature = modelSignature(sources.map(parse), CALGARY);
    const equivalence = task(sources, "not-all-equal");

    const disagree = { domain: "0,1", fields: { "F(_)": "0" } };
    const bothTrue = { domain: "0,1", fields: { "F(_)": "0,1" } };
    const bothFalse = { domain: "0,1", fields: { "F(_)": "" } };

    expect(checkModel(signature, equivalence, disagree).ok).toBe(true);

    for (const agreeing of [bothTrue, bothFalse]) {
      const verdict = checkModel(signature, equivalence, agreeing);

      expect(verdict.ok).toBe(false);
      expect(verdict.targetMissed).toBe(true);
      // No one formula is at fault — the set agreeing is the failure.
      expect(verdict.targetOffenders).toEqual([]);
    }
  });

  test("an unreadable model is not evaluated at all", () => {
    const verdict = checkModel(
      modelSignature(["AxF(x)"].map(parse), CALGARY),
      task(["AxF(x)"], "all-true"),
      { domain: "", fields: {} },
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.problem?.kind).toBe("domain-empty");
    expect(verdict.targetMissed).toBe(false);
    expect(verdict.targetOffenders).toEqual([]);
  });
});

describe("a connective the course declares itself", () => {
  // What an instructor actually writes is an `:::aufbau-mm0` block with
  // `src="/theories/forallx-calgary-2019.mm0"` and their own constructor after
  // it; this is the same two texts joined. The point of the fixture is that
  // nothing in the server declares `↑` — the role is read, the notation is the
  // course's.
  const EXTENSION = `
--| @syntax delimiter $ ↑ $
--| @syntax role nand
term nand (ph ps: wff): wff;
infixl nand: $↑$ prec 30;
`;

  const base = theorySourceByFileName(`${DEFAULT_LANGUAGE_ID}.mm0`);

  if (base === null) {
    throw new Error(`no source for ${DEFAULT_LANGUAGE_ID}`);
  }

  const registered = firstOrderLanguageFor({
    source: `${base}${EXTENSION}`,
  });

  if (registered === null) {
    throw new Error("the extended fixture does not read as a language");
  }

  // Rebound rather than narrowed in place: the helpers below are hoisted
  // function declarations, so `tsc` cannot assume the check above ran first.
  const extended = registered;

  function parseExtended(source: string): Formula {
    const result = parseFormula(source, extended);

    if (!result.ok) {
      throw new Error(
        `Expected '${source}' to parse: ${result.errors[0]?.message}`,
      );
    }

    return result.formula;
  }

  function holdsIn(source: string, input: ModelInput): boolean {
    const formula = parseExtended(source);
    const read = readModel(modelSignature([formula], CALGARY), input);

    if (!read.ok) {
      throw new Error(`Expected the model to read: ${read.problem.kind}`);
    }

    return satisfies(formula, read.model);
  }

  test("a stroke is evaluated, not refused", () => {
    expect(
      holdsIn("P ↑ Q", { domain: "0", fields: { P: "false", Q: "true" } }),
    ).toBe(true);
    expect(
      holdsIn("P ↑ Q", { domain: "0", fields: { P: "true", Q: "true" } }),
    ).toBe(false);
  });

  test("it composes with the quantifiers like any other connective", () => {
    // ∀x(F(x) ↑ F(x)) is ∀x¬F(x): true exactly when the extension is empty.
    expect(
      holdsIn("Ax(F(x) ↑ F(x))", { domain: "0,1", fields: { "F(_)": "" } }),
    ).toBe(true);
    expect(
      holdsIn("Ax(F(x) ↑ F(x))", { domain: "0,1", fields: { "F(_)": "0" } }),
    ).toBe(false);
  });

  test("it prints back in the course's own spelling", () => {
    expect(formulaToString(parseExtended("F(a) ↑ G(b)"), extended)).toBe(
      "F(a) ↑ G(b)",
    );
  });
});

describe("symbols of fixed arity", () => {
  /**
   * A model is keyed by constructor name and arity, whatever the notation, and
   * *labelled* through the notation: `a + b` asks for a value table headed
   * `_+_`, and `Red(a)` for an extension under `Red(_)`, exactly as a textbook
   * letter would.
   */
  const FIXED = fixedArityLanguage();

  function parseFixed(source: string): Formula {
    const result = parseFormula(source, FIXED);

    if (!result.ok) {
      throw new Error(
        `Expected '${source}' to parse: ${result.errors[0]?.message}`,
      );
    }

    return result.formula;
  }

  test("the fields a mixed atom implies, in the usual order", () => {
    const signature = modelSignature(
      ["a + b < succ(c) ∧ Red(a)", "R(f(a), b)"].map(parseFixed),
      FIXED,
    );

    expect(signature.map((field) => field.label)).toEqual([
      DOMAIN_FIELD_LABEL,
      "R(_,_)",
      "Red(_)",
      "_<_",
      "a",
      "b",
      "c",
      "_+_",
      "f(_)",
      "succ(_)",
    ]);
  });

  test("an infix function is evaluated through its two-argument table", () => {
    const sources = ["a + b = succ(c)", "Red(a + b)", "a < b"];
    const read = readModel(modelSignature(sources.map(parseFixed), FIXED), {
      domain: "0,1",
      fields: {
        a: "0",
        b: "1",
        c: "0",
        "Red(_)": "1",
        "_+_": "[0,0;0],[0,1;1],[1,0;1],[1,1;0]",
        "_<_": "[0,1]",
        "succ(_)": "[0;1],[1;0]",
      },
    });

    if (!read.ok) {
      throw new Error(`Expected the model to read: ${read.problem.kind}`);
    }

    // 0 + 1 = 1 = succ(0); Red holds of 1; 0 < 1.
    for (const source of sources) {
      expect(satisfies(parseFixed(source), read.model)).toBe(true);
    }
    // 1 + 1 = 0 ≠ succ(0).
    expect(satisfies(parseFixed("b + b = succ(c)"), read.model)).toBe(false);
  });
});

describe("free variables", () => {
  /**
   * A language without `closed-sentences` reads `Red(x)` with `x` free, and
   * the formula is evaluated at an assignment: each free variable is a field,
   * filled in like a constant, whose value is where evaluation starts.
   */
  const OPEN = fixedArityLanguage(
    FIXED_ARITY_SPEC_SOURCE.replace(
      "--| @syntax lint closed-sentences\n",
      "",
    ),
  );

  function parseOpen(source: string): Formula {
    const result = parseFormula(source, OPEN);

    if (!result.ok) {
      throw new Error(
        `Expected '${source}' to parse: ${result.errors[0]?.message}`,
      );
    }

    return result.formula;
  }

  function openTask(targeted: readonly string[]): ModelTask {
    return {
      required: [],
      target: "all-true",
      targeted: targeted.map(parseOpen),
    };
  }

  test("a free variable is a field after the constants", () => {
    const signature = modelSignature(
      ["Red(a) ∧ R(y, x)", "succ(z) = b"].map(parseOpen),
      OPEN,
    );

    expect(
      signature.map((field) => [field.label, field.kind] as const),
    ).toEqual([
      [DOMAIN_FIELD_LABEL, "domain"],
      ["R(_,_)", "relation"],
      ["Red(_)", "relation"],
      ["a", "constant"],
      ["b", "constant"],
      ["x", "variable"],
      ["y", "variable"],
      ["z", "variable"],
      ["succ(_)", "function"],
    ]);
  });

  test("only a free occurrence asks for a value", () => {
    const labels = (source: string): string[] =>
      modelSignature([parseOpen(source)], OPEN).map((field) => field.label);

    expect(labels("∀x Red(x)")).toEqual([DOMAIN_FIELD_LABEL, "Red(_)"]);
    // The same variable both bound and free: the free occurrence is a field.
    expect(labels("Red(x) ∧ ∃x Blue(x)")).toEqual([
      DOMAIN_FIELD_LABEL,
      "Blue(_)",
      "Red(_)",
      "x",
    ]);
  });

  test("the formula is evaluated at the assignment", () => {
    const signature = modelSignature([parseOpen("Red(x)")], OPEN);
    const at = (x: string) =>
      checkModel(signature, openTask(["Red(x)"]), {
        domain: "0,1",
        fields: { "Red(_)": "1", x },
      }).ok;

    expect(at("1")).toBe(true);
    expect(at("0")).toBe(false);
  });

  test("a quantifier rebinds what the assignment gave", () => {
    const source = "Red(x) ∧ ∀x Blue(x)";
    const signature = modelSignature([parseOpen(source)], OPEN);
    const holdsWith = (blue: string) =>
      checkModel(signature, openTask([source]), {
        domain: "0,1",
        fields: { "Blue(_)": blue, "Red(_)": "0", x: "0" },
      }).ok;

    expect(holdsWith("0,1")).toBe(true);
    // Blue(0) alone would do if the bound x kept the assignment's value.
    expect(holdsWith("0")).toBe(false);
  });

  test("a variable's value is read and bounded like a constant's", () => {
    const signature = modelSignature([parseOpen("Red(x)")], OPEN);
    const problem = (x: string) =>
      readModel(signature, { domain: "0,1", fields: { "Red(_)": "", x } });

    expect(problem("2")).toEqual({
      ok: false,
      problem: { field: "x", kind: "field-outside-domain" },
    });
    expect(problem("one")).toMatchObject({
      ok: false,
      problem: { field: "x", kind: "field-unreadable" },
    });

    const read = problem("1");

    if (!read.ok) {
      throw new Error(`Expected the model to read: ${read.problem.kind}`);
    }

    expect(read.assignment).toEqual(new Map([["x", 1]]));
    expect(read.model.constants.size).toBe(0);
  });
});
