import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "@aufbau/syntax";
import { languageById } from "../src/worker/logic/specs";
import {
  formulaParseError,
  formulaParseErrors,
} from "../src/worker/logic/specs/diagnostics";
import { roleIndex } from "../src/worker/logic/specs/roles";

/**
 * The two pieces every semantic exercise type reads a spec through: what a
 * constructor means, and what a refusal says.
 *
 * The refusal cases run the *real* parser rather than hand-built diagnostics
 * wherever they can, because the thing worth pinning is not that a mapping
 * table maps — it is that the ids the library actually emits are ids we have
 * words for. A hand-built diagnostic proves only that the table was typed out.
 */

function language(id: string) {
  const found = languageById(id);

  if (found === null) {
    throw new Error(`no spec ships under the id ${id}`);
  }

  return found;
}

function errorsFor(id: string, source: string) {
  const result = language(id).parse(source);

  if (result.ok) {
    throw new Error(`expected '${source}' to be refused under ${id}`);
  }

  return formulaParseErrors(result.diagnostics);
}

describe("roles", () => {
  const forallx = language("forallx-calgary-2019");
  const prop = language("carnap-prop");

  test("a constructor's role is read off the spec", () => {
    const index = roleIndex(forallx);

    expect(index.roleOf("and")).toBe("conjunction");
    expect(index.roleOf("all")).toBe("forall");
    expect(index.roleOf("neq")).toBe("inequality");
    expect(index.termFor("biconditional")).toBe("iff");
  });

  test("a lexicon letter and a coercion have no role", () => {
    const index = roleIndex(forallx);

    expect(index.roleOf("F")).toBeNull();
    expect(index.roleOf("v2t")).toBeNull();
    expect(index.roleOf("scomma")).toBeNull();
  });

  test("a role the spec omits is null, not a throw", () => {
    expect(roleIndex(prop).termFor("forall")).toBeNull();
    expect(roleIndex(prop).spellingFor("forall")).toBeNull();
  });

  test("the spelling is the spec's last word, which is the glyph", () => {
    const index = roleIndex(forallx);

    // The spec lists `/\ ^ & ∧` and `- ~ ¬`, ASCII first and the display
    // glyph last, so the canonical spelling is the glyph. This is the table
    // that used to be hardcoded twice over — once as DISPLAY_SYMBOLS in the
    // parser, once as the dialect record's spelling lists.
    expect(index.spellingFor("conjunction")).toBe("∧");
    expect(index.spellingFor("negation")).toBe("¬");
    expect(index.spellingFor("conditional")).toBe("→");
    expect(index.spellingFor("forall")).toBe("∀");
    expect(index.spellingFor("inequality")).toBe("≠");
    expect(index.spellingFor("identity")).toBe("=");
  });

  test("a general notation reports its constant", () => {
    // `notation bot: wff = ($⊥$:max);` — nothing infix to read a token off.
    expect(roleIndex(forallx).spellingFor("falsum")).toBe("⊥");
    expect(roleIndex(forallx).spellingFor("verum")).toBe("⊤");
  });

  test("carnap-prop declares only ASCII, so that is its canonical form", () => {
    const index = roleIndex(prop);

    expect(index.spellingFor("conjunction")).toBe("/\\");
    expect(index.spellingFor("negation")).toBe("~");
    expect(index.spellingFor("biconditional")).toBe("<->");
    expect(index.roleOf("P")).toBeNull();
  });

  test("the index is built once per language", () => {
    expect(roleIndex(forallx)).toBe(roleIndex(forallx));
  });
});

describe("parse errors", () => {
  test("the sentences the library shares with us pass straight through", () => {
    expect(errorsFor("forallx-calgary-2019", "(P")).toEqual([
      {
        message: "Expected “{bracket}”.",
        params: { bracket: ")" },
        position: 2,
      },
    ]);
    expect(errorsFor("forallx-calgary-2019", "P /\\")).toEqual([
      { message: "Expected a formula.", position: 4 },
    ]);
    expect(errorsFor("forallx-calgary-2019", "P Q")).toEqual([
      {
        message: "Unexpected “{token}”.",
        params: { token: "Q" },
        position: 2,
      },
    ]);
  });

  test("forallx's two refusal conventions are said as such", () => {
    expect(errorsFor("forallx-calgary-2019", "P -> Q -> R")).toEqual([
      {
        message:
          "“{operator}” cannot be chained; add parentheses to group it.",
        params: { operator: "->" },
        position: 5,
      },
    ]);
    expect(errorsFor("forallx-calgary-2019", "P /\\ (Q)")).toEqual([
      {
        message:
          "Parentheses may only enclose a sentence joined by a two-place connective.",
        position: 5,
      },
    ]);
  });

  test("an unbound variable names itself", () => {
    expect(errorsFor("forallx-calgary-2019", "F(x)")).toEqual([
      {
        message:
          "“{name}” is a free variable; every formula must be a sentence.",
        params: { name: "x" },
        position: 2,
      },
    ]);
  });

  test("a sort mismatch is said in words a student has", () => {
    // The library says "This has sort wff where seq is needed", which is true
    // and unusable: `seq` is the encoding that makes one letter cover `P` and
    // `P(a,b)`, and nobody typing `F(P)` has heard of it.
    expect(errorsFor("forallx-calgary-2019", "F(P)")).toEqual([
      {
        message: "This is a {actual} where a {expected} is needed.",
        params: { actual: "sentence", expected: "term" },
        position: 2,
      },
    ]);
    expect(errorsFor("forallx-calgary-2019", "a")).toEqual([
      {
        message: "This is a {kind}, not a complete sentence.",
        params: { kind: "term" },
        position: 0,
      },
    ]);
  });

  test("a chunk outside the language is quoted back", () => {
    expect(errorsFor("carnap-prop", "P & Q")).toEqual([
      {
        message: "“{chunk}” is not part of this language.",
        params: { chunk: "&" },
        position: 2,
      },
    ]);
  });

  test("an id we have no words for still reaches the writer", () => {
    const unknown: Diagnostic = {
      id: "some_future_diagnostic",
      message: "Something new.",
      params: { detail: "x" },
      severity: "error",
      span: { end: 4, start: 3 },
    };

    expect(formulaParseError(unknown)).toEqual({
      message: "This formula could not be read.",
      position: 3,
    });
  });

  test("warnings are not errors", () => {
    const warning: Diagnostic = {
      id: "expected_formula",
      message: "Expected a formula.",
      params: {},
      severity: "warning",
      span: { end: 1, start: 0 },
    };

    expect(formulaParseErrors([warning])).toEqual([]);
  });
});
