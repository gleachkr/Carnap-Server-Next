import { describe, expect, test } from "bun:test";

import { ruleCitationShapes } from "../src/worker/exercises/aufbau-proof-fitch/citations";
import { fitchToAuf } from "../src/worker/exercises/aufbau-proof-fitch/translate";
import { THEORY_SOURCES } from "../src/worker/logic/theories";
import { FORALLX_THEORY_SOURCE } from "./helpers/forallx-theory";
import { MAGNUS_THEORY_SOURCE } from "./helpers/magnus-theory";

/**
 * Citation shapes inferred from rule signatures — the table Carnap's Haskell
 * declared by hand as `indirectInference`, derived here from each rule's own
 * premises (see `aufbau-proof-fitch/citations.ts`).
 *
 * The first half pins the *classification* over the shipped theories: it must
 * reproduce Carnap's hand table exactly, which for these systems means
 * `PolyProof` shapes everywhere except Magnus's reductios (`TypedProof 1 2` —
 * one range whose subproof ends with both premises) and the two `∃E`s
 * (`TypedProof 1 1`). The second half pins what the translator *does* with a
 * multi-premise slot, including every way of citing it wrongly.
 */

const slotsOf = (source: string, rule: string) => {
  const shape = ruleCitationShapes(source).get(rule);

  return shape === undefined
    ? undefined
    : {
        premiseCount: shape.premiseCount,
        slots: shape.slots.map(
          (slot) => `${slot.kind}[${slot.premises.join(",")}]`,
        ),
      };
};

describe("ruleCitationShapes — classification", () => {
  test("Magnus's reductios draw both premises from one subproof", () => {
    for (const rule of ["neg_intro", "neg_elim"]) {
      expect(slotsOf(MAGNUS_THEORY_SOURCE, rule), rule).toEqual({
        premiseCount: 2,
        slots: ["range[0,1]"],
      });
    }
  });

  test("premises assuming different formulas are separate subproofs", () => {
    // ↔I assumes φ in one premise and ψ in the other: two ranges, exactly the
    // citation the exercise has always taken, engaged nowhere (slot count
    // equals premise count, so the plain lowering keeps handling it).
    expect(slotsOf(MAGNUS_THEORY_SOURCE, "iff_intro")).toEqual({
      premiseCount: 2,
      slots: ["range[0]", "range[1]"],
    });
  });

  test("a premise assuming nothing is an ordinary line", () => {
    expect(slotsOf(MAGNUS_THEORY_SOURCE, "imp_elim")).toEqual({
      premiseCount: 2,
      slots: ["line[0]", "line[1]"],
    });
    // ∀I restricts its context but assumes nothing — a line, not a box.
    expect(slotsOf(MAGNUS_THEORY_SOURCE, "all_intro")).toEqual({
      premiseCount: 1,
      slots: ["line[0]"],
    });
  });

  test("∃E mixes a line and a subproof, in premise order", () => {
    for (const source of [MAGNUS_THEORY_SOURCE, FORALLX_THEORY_SOURCE]) {
      expect(slotsOf(source, "ex_elim")).toEqual({
        premiseCount: 2,
        slots: ["line[0]", "range[1]"],
      });
    }
  });

  test("Calgary's ∨E is a line and two subproofs; its ¬I is one box to ⊥", () => {
    expect(slotsOf(FORALLX_THEORY_SOURCE, "or_elim")).toEqual({
      premiseCount: 3,
      slots: ["line[0]", "range[1]", "range[2]"],
    });
    expect(slotsOf(FORALLX_THEORY_SOURCE, "neg_intro")).toEqual({
      premiseCount: 1,
      slots: ["range[0]"],
    });
  });

  test("a theory that names no sequent structure gets the empty table", () => {
    // gentzen-lk declares no @syntax at all, so it is not a language and no
    // rule classifies — which is the safe answer: every citation keeps the
    // plain lowering it has today.
    expect(ruleCitationShapes(THEORY_SOURCES["gentzen-lk.mm0"]).size).toBe(0);
    expect(ruleCitationShapes(null).size).toBe(0);
  });
});

describe("fitchToAuf — grouped range lowering", () => {
  const shapes = ruleCitationShapes(MAGNUS_THEORY_SOURCE);

  const translate = (lines: readonly string[]) =>
    fitchToAuf(lines.join("\n"), "g", "ax", "⊢", ";", undefined, shapes);

  test("one range supplies a reductio's last two lines, in premise order", () => {
    const { proofText, diagnostics } = translate([
      "p           :ax",
      "    ~p      :ax",
      "    p       :reit 1",
      "    ~p      :reit 2",
      "~~p         :neg_intro 2-4",
    ]);

    expect(diagnostics).toEqual([]);
    expect(proofText).toContain("by neg_intro [l3, l4]");
  });

  test("a subproof too short for the pair says so", () => {
    const { diagnostics } = translate([
      "p           :ax",
      "    ~p      :ax",
      "    p       :reit 1",
      "~~p         :neg_intro 2-3",
    ]);

    expect(diagnostics.map((d) => d.code)).toContain("range_too_short");
    expect(
      diagnostics.find((d) => d.code === "range_too_short")?.params,
    ).toEqual({ lines: "2" });
  });

  test("a line ref where the rule wants a subproof says so", () => {
    const { diagnostics } = translate([
      "p           :ax",
      "    ~p      :ax",
      "    p       :reit 1",
      "    ~p      :reit 2",
      "~~p         :neg_intro 4",
    ]);

    expect(diagnostics.map((d) => d.code)).toContain("range_expected");
  });

  test("the pair must end the cited box itself, not a nested one", () => {
    // The second-to-last line of the cited range sits in a nested box, so the
    // subproof does not end with two lines of its own — only its last one.
    const { diagnostics } = translate([
      "p            :ax",
      "    ~p       :ax",
      "        q    :ax",
      "        q    :reit 3",
      "    ~p       :reit 2",
      "~~p          :neg_intro 2-5",
    ]);

    expect(diagnostics.map((d) => d.code)).toContain(
      "range_tail_depth_mismatch",
    );
  });

  test("a ref count matching neither spelling stays the compiler's complaint", () => {
    const { proofText, diagnostics } = translate([
      "p           :ax",
      "    ~p      :ax",
      "    p       :reit 1",
      "    ~p      :reit 2",
      "~~p         :neg_intro 2-3 2-4 2-4",
    ]);

    // No structural diagnostic: three refs lower ref-per-ref as they always
    // did, and the engine's arity check owns the refusal.
    expect(diagnostics).toEqual([]);
    expect(proofText).toContain("by neg_intro [l3, l4, l4]");
  });

  test("rules without a multi-premise slot are untouched by the table", () => {
    // ↔I with two ranges and →E with two lines lower exactly as they would
    // with no table at all.
    const lines = [
      "    p            :ax",
      "    p            :reit 1",
      "p -> p           :imp_intro 1-2",
      "p                :ax",
      "p                :imp_elim 3 4",
    ];
    const bare = fitchToAuf(lines.join("\n"), "g", "ax", "⊢", ";");
    const shaped = translate(lines);

    expect(shaped.proofText).toBe(bare.proofText);
    expect(shaped.diagnostics).toEqual([]);
  });
});
