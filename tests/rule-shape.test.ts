import { describe, expect, test } from "bun:test";

import {
  type RuleNaming,
  type RuleShapeStyle,
  ruleShapeReader,
  ruleShapeText,
} from "../src/worker/exercise-kit/proof/rule-shape";
import { THEORY_SOURCES } from "../src/worker/logic/theories";
import { FORALLX_THEORY_SOURCE } from "./helpers/forallx-theory";
import { MAGNUS_THEORY_SOURCE } from "./helpers/magnus-theory";

/**
 * The rule a proof line did not fit, printed from its own axiom in each
 * widget's idiom (gh #36): sequents for the tree and linear widgets, a
 * subproof for Fitch, a discharge for Prawitz. The metavariables are the
 * axiom's binder names until a theory can say how to print them. Read here
 * as text, which is how F8 says it; how it is drawn is the widgets' (the
 * Fitch DOM test).
 */

const shapeOf = (
  source: string | null | undefined,
  style: RuleShapeStyle,
  rule: string,
  naming?: RuleNaming,
): string | null => {
  const shape = ruleShapeReader(source, style, naming)(rule);
  return shape === null ? null : ruleShapeText(shape);
};

describe("ruleShapeReader", () => {
  test("gh #36: ∨E shows both subproofs ending in the conclusion", () => {
    expect(shapeOf(FORALLX_THEORY_SOURCE, "fitch", "or_elim")).toBe(
      "∨E: ph ∨ ps, ph … ch, ps … ch ∴ ch",
    );
    expect(shapeOf(FORALLX_THEORY_SOURCE, "prawitz", "or_elim")).toBe(
      "∨E: ph ∨ ps, [ph] … ch, [ps] … ch ∴ ch",
    );
    expect(shapeOf(FORALLX_THEORY_SOURCE, "sequent", "or_elim")).toBe(
      "∨E: ga ⊢ ph ∨ ps, de; ph ⊢ ch, si; ps ⊢ ch ∴ ga; de; si; ta ⊢ ch",
    );
  });

  test("a @fallback pair shows both sides, in declaration order", () => {
    // The engine reports the axiom carrying the alias and the fallback.
    expect(shapeOf(FORALLX_THEORY_SOURCE, "fitch", "and_elim_r")).toBe(
      "∧E: ph ∧ ps ∴ ph\n∧E: ph ∧ ps ∴ ps",
    );
  });

  test("a linear proof names each axiom as it cites it", () => {
    expect(
      shapeOf(FORALLX_THEORY_SOURCE, "sequent", "and_elim_r", "axiom"),
    ).toBe(
      "and_elim_l: ga ⊢ ph ∧ ps ∴ ga; de ⊢ ph\nand_elim_r: ga ⊢ ph ∧ ps ∴ ga; de ⊢ ps",
    );
  });

  test("one Fitch subproof supplies every premise that assumes its formula", () => {
    // Magnus's ¬I cites one range whose last two lines are ψ and ¬ψ; Prawitz
    // cites each premise on its own.
    expect(shapeOf(MAGNUS_THEORY_SOURCE, "fitch", "neg_intro")).toBe(
      "¬I: ph … ps … ¬ps ∴ ¬ph",
    );
    expect(shapeOf(MAGNUS_THEORY_SOURCE, "prawitz", "neg_intro")).toBe(
      "¬I: [ph] … ps, [ph] … ¬ps ∴ ¬ph",
    );
  });

  test("a Fitch subproof is marked as one, to be drawn as the editor's box", () => {
    const [line] =
      ruleShapeReader(FORALLX_THEORY_SOURCE, "fitch")("or_elim") ?? [];
    expect(line?.premises).toEqual([
      { subproof: false, text: "ph ∨ ps" },
      { subproof: true, text: "ph … ch" },
      { subproof: true, text: "ps … ch" },
    ]);
  });

  test("a rule with no premises is its conclusion alone", () => {
    expect(shapeOf(FORALLX_THEORY_SOURCE, "fitch", "eq_intro_nd")).toBe(
      "=I: te = te",
    );
  });

  test("nothing where the theory cannot say", () => {
    expect(shapeOf(FORALLX_THEORY_SOURCE, "fitch", "no_such_rule")).toBe(
      null,
    );
    // gentzen-lk declares no turnstile or context-join role.
    expect(shapeOf(THEORY_SOURCES["gentzen-lk.mm0"], "sequent", "cut")).toBe(
      null,
    );
    expect(shapeOf(null, "fitch", "or_elim")).toBe(null);
  });
});
