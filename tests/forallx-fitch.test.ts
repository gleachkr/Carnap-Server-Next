import { describe, expect, test } from "bun:test";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { fitchToAuf } from "../src/worker/exercises/aufbau-proof-fitch/translate";
import { FORALLX_CASES } from "./helpers/forallx-cases";
import { FORALLX_DEMO_SOURCE } from "./helpers/forallx-demo";

/**
 * The forallx: Calgary theory (full first-order fragment) and its Fitch encoding.
 * Every primitive rule — the TFL connectives plus identity (=I/=E) and the four
 * quantifier rules (∀I/∀E/∃I/∃E) — has a worked case in {@link FORALLX_CASES}.
 * These tests pin the *translation* (the part this repo owns): that each case
 * lowers to well-formed `.auf` with no structural diagnostics, and that the demo
 * lesson compiles through the authoring pipeline. Whether the translated proofs
 * actually verify against the real engine is an end-to-end check kept in
 * `bun run scripts/forallx-verify.ts` — it compiles + verifies from source each
 * run, so nothing here freezes a compiler-specific MMB blob (MMB stability is the
 * engine's responsibility, not ours to pin).
 */

describe("forallx: Calgary theory", () => {
  test("every worked case translates without structural diagnostics", () => {
    for (const testCase of FORALLX_CASES) {
      const { diagnostics } = fitchToAuf(
        testCase.fitch,
        testCase.goalName,
        "ax",
        "⊢",
      );
      expect(diagnostics, testCase.name).toEqual([]);
    }
  });

  test("the demo lesson compiles through the authoring pipeline", async () => {
    const compiled = await compileCarnapMarkdown(FORALLX_DEMO_SOURCE);
    expect(
      compiled.diagnostics.map((entry) => entry.code),
      JSON.stringify(compiled.diagnostics),
    ).toEqual([]);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    const ids = compiled.artifact.manifest.map((entry) => entry.id);
    expect(ids).toEqual([
      "mp",
      "andcomm",
      "orcomm",
      "dne",
      "unimp",
      "exelim",
    ]);
  });
});

describe("fitchToAuf — sibling subproofs", () => {
  test("two subproofs at one level each discharge only their own assumption", () => {
    const { proofText, diagnostics } = fitchToAuf(
      [
        "a ∨ b       :ax",
        "    a       :ax",
        "    b ∨ a   :or_intro_r 2",
        "    b       :ax",
        "    b ∨ a   :or_intro_l 4",
        "b ∨ a       :or_elim 1 2-3 4-5",
      ].join("\n"),
      "orcomm",
      "ax",
      "⊢",
    );

    expect(diagnostics).toEqual([]);
    expect(proofText).toBe(
      [
        "orcomm",
        "----",
        "l1: $ a ∨ b ⊢ a ∨ b $ by ax []",
        "l2: $ a ∨ b , a ⊢ a $ by ax []",
        "l3: $ a ∨ b , a ⊢ b ∨ a $ by or_intro_r [l2]",
        "l4: $ a ∨ b , b ⊢ b $ by ax []",
        "l5: $ a ∨ b , b ⊢ b ∨ a $ by or_intro_l [l4]",
        "l6: $ a ∨ b ⊢ b ∨ a $ by or_elim [l1, l3, l5]",
      ].join("\n"),
    );
  });

  test("top-level premises still share one context (not split into boxes)", () => {
    const { proofText } = fitchToAuf(
      ["a → b   :ax", "a       :ax", "b       :imp_elim 1 2"].join("\n"),
      "mp",
      "ax",
      "⊢",
    );

    expect(proofText).toContain("l1: $ a → b , a ⊢ a → b $ by ax []");
    expect(proofText).toContain("l3: $ a → b , a ⊢ b $ by imp_elim [l1, l2]");
  });

  test("assumptions before any derivation stay in one box (reiteration)", () => {
    const { proofText } = fitchToAuf(
      [
        "    a           :ax",
        "        b       :ax",
        "        a       :ax",
        "    b → a       :imp_intro 2-3",
        "a → (b → a)     :imp_intro 1-4",
      ].join("\n"),
      "kcomb",
      "ax",
      "⊢",
    );

    expect(proofText).toContain("l2: $ a , b ⊢ b $ by ax []");
    expect(proofText).toContain("l3: $ a , b ⊢ a $ by ax []");
  });
});

describe("fitchToAuf — first-order rules", () => {
  test("∃-elimination cites the ∃ line and the subproof, discharging the witness", () => {
    // ∃E is structurally a one-branch ∨E: the witness assumption `F y` opens a
    // subproof that the closing line discharges by scope-closure, so l7's context
    // no longer carries `F y`. The eigenvariable freshness of `y` is the engine's
    // job (via the raw binder types); the translator only emits the shape.
    const { proofText, diagnostics } = fitchToAuf(
      [
        "∃ x (F x)          :ax",
        "∀ x (F x → G x)    :ax",
        "    F y            :ax",
        "    F y → G y      :all_elim 2",
        "    G y            :imp_elim 4 3",
        "    ∃ x (G x)      :ex_intro 5",
        "∃ x (G x)          :ex_elim 1 3-6",
      ].join("\n"),
      "exelim",
      "ax",
      "⊢",
    );

    expect(diagnostics).toEqual([]);
    expect(proofText).toBe(
      [
        "exelim",
        "----",
        "l1: $ ∃ x (F x) , ∀ x (F x → G x) ⊢ ∃ x (F x) $ by ax []",
        "l2: $ ∃ x (F x) , ∀ x (F x → G x) ⊢ ∀ x (F x → G x) $ by ax []",
        "l3: $ ∃ x (F x) , ∀ x (F x → G x) , F y ⊢ F y $ by ax []",
        "l4: $ ∃ x (F x) , ∀ x (F x → G x) , F y ⊢ F y → G y $ by all_elim [l2]",
        "l5: $ ∃ x (F x) , ∀ x (F x → G x) , F y ⊢ G y $ by imp_elim [l4, l3]",
        "l6: $ ∃ x (F x) , ∀ x (F x → G x) , F y ⊢ ∃ x (G x) $ by ex_intro [l5]",
        "l7: $ ∃ x (F x) , ∀ x (F x → G x) ⊢ ∃ x (G x) $ by ex_elim [l1, l6]",
      ].join("\n"),
    );
  });

  test("=-elimination cites the identity and the source formula (Leibniz)", () => {
    const { proofText } = fitchToAuf(
      [
        "x = y       :ax",
        "F x         :ax",
        "F y         :eq_replace 1 2",
      ].join("\n"),
      "eqreplace",
      "ax",
      "⊢",
    );

    expect(proofText).toContain(
      "l3: $ x = y , F x ⊢ F y $ by eq_replace [l1, l2]",
    );
  });
});
