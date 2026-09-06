import { describe, expect, test } from "bun:test";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import {
  proofRuleReader,
  proofRuleSpellings,
} from "../src/worker/exercises/aufbau-proof/formulas";
import { fitchToAuf } from "../src/worker/exercises/aufbau-proof-fitch/translate";
import { FORALLX_CASES } from "./helpers/forallx-cases";
import { FORALLX_DEMO_SOURCE } from "./helpers/forallx-demo";
import {
  FORALLX_THEORY_SOURCE,
  forallxExercise,
} from "./helpers/forallx-theory";

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

  test("every worked case's lines read in the theory's own language", () => {
    // Read as the widget reads them: through what the authoring compiler
    // would have frozen for that goal, and in that goal's own binders — so a
    // schematic case (`theorem mp (a b: wff)`, whose `a` and `b` the theory's
    // lexicon does not know) is exercised on the same surface path as the
    // rest, which since #253 is every one of them.
    for (const testCase of FORALLX_CASES) {
      const { readSentence } = forallxExercise(
        testCase.goalName,
        testCase.theoremDecl,
      );
      const { formulaProblems } = fitchToAuf(
        testCase.fitch,
        testCase.goalName,
        "ax",
        "⊢",
        ";",
        readSentence,
      );
      expect(
        formulaProblems.map((one) => one.error.message),
        testCase.name,
      ).toEqual([]);
    }
  });

  test("a line typed in textbook notation reaches the compiler as engine text", () => {
    const { readSentence } = forallxExercise(
      "t",
      "theorem t {x: var} {a: name}: $ ∀ x (F(x) → G(x)) ⊢ ∀ x (F(x) → G(x)) $;",
    );
    const { proofText, formulaProblems } = fitchToAuf(
      "Ax(F(x)->G(x))   :ax",
      "t",
      "ax",
      "⊢",
      ";",
      readSentence,
    );

    expect(formulaProblems).toEqual([]);
    expect(proofText).toContain("(∀ x ((F (x)) → (G (x))))");
  });

  test("a formula the language refuses is named where it broke", () => {
    const { readSentence } = forallxExercise(
      "t",
      "theorem t {a: name}: $ F(a) ⊢ F(a) $;",
    );
    const { formulaProblems } = fitchToAuf(
      "F(a) /\\   :ax",
      "t",
      "ax",
      "⊢",
      ";",
      readSentence,
    );

    expect(formulaProblems).toHaveLength(1);
    expect(formulaProblems[0]?.sourceLine).toBe(0);
    expect(formulaProblems[0]?.error.message).toBe("Expected a formula.");
  });

  test("a schematic goal reads its lines in its own binders", () => {
    // `a` is a name in this theory's lexicon and a wff metavariable in this
    // goal. A global-vocabulary parse would take the lexicon's answer, so
    // before #253 the exercise was frozen without a language and the line
    // passed through as written. Now the goal's binders shadow the lexicon
    // and the line is read — textbook spelling and all.
    const { readSentence } = forallxExercise(
      "mp",
      "theorem mp (a b: wff): $ (a → b) ; a ⊢ b $;",
    );
    const { formulaProblems, proofText } = fitchToAuf(
      "a -> b   :ax",
      "mp",
      "ax",
      "⊢",
      ";",
      readSentence,
    );

    expect(formulaProblems).toEqual([]);
    expect(proofText).toContain("$ (a → b) ⊢ (a → b) $");
  });

  test("the demo lesson compiles through the authoring pipeline", async () => {
    const compiled = await compileCarnapMarkdown(FORALLX_DEMO_SOURCE);
    // Errors only. Every goal in these lessons is a rule schema, so each one
    // warns that its metavariables shadow the theory's letters (#254) — which
    // is the warning doing its job, not the lesson being broken.
    expect(
      compiled.diagnostics
        .filter((entry) => entry.severity === "error")
        .map((entry) => entry.code),
      JSON.stringify(compiled.diagnostics),
    ).toEqual([]);
    expect(compiled.ok).toBe(true);
    expect(
      [
        ...new Set(
          compiled.diagnostics.map((entry) =>
            entry.code.replace(/_[^_]+$/, ""),
          ),
        ),
      ].filter((code) => code !== "goal_binder_shadows"),
      "only binder-shadowing warnings are expected here",
    ).toEqual([]);
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
      "typing",
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

describe("forallx: Calgary rule aliases", () => {
  test("the theory names each one-rule textbook citation, and no paired one", () => {
    const readRule = proofRuleReader(FORALLX_THEORY_SOURCE);

    expect(readRule("∧I")).toBe("and_intro");
    expect(readRule("/\\I")).toBe("and_intro");
    expect(readRule("→E")).toBe("imp_elim");
    expect(readRule("->E")).toBe("imp_elim");
    expect(readRule("¬I")).toBe("neg_intro");
    expect(readRule("X")).toBe("explosion");
    expect(readRule("IP")).toBe("ip");
    expect(readRule("=E")).toBe("eq_replace");
    expect(readRule("∀I")).toBe("all_intro");
    expect(readRule("∃E")).toBe("ex_elim");
    expect(readRule("AS")).toBe("ax");
    expect(readRule("R")).toBe("reit");
    // A canonical name is not an alias; it stands, as does anything unknown.
    expect(readRule("and_intro")).toBe("and_intro");
    expect(readRule("∧E")).toBe("∧E");
    expect(readRule("∨I")).toBe("∨I");
  });

  test("the aliased case lowers to the axiom names", () => {
    const aliased = FORALLX_CASES.find((one) => one.goalName === "aliased");
    if (aliased === undefined) {
      throw new Error("the aliased case is gone");
    }
    const { citationShapes, readRule, readSentence } = forallxExercise(
      aliased.goalName,
      aliased.theoremDecl,
    );
    const { diagnostics, formulaProblems, proofText } = fitchToAuf(
      aliased.fitch,
      aliased.goalName,
      "ax",
      "⊢",
      ";",
      readSentence,
      citationShapes,
      readRule,
    );

    expect(diagnostics).toEqual([]);
    expect(formulaProblems).toEqual([]);
    expect(proofText).not.toMatch(/by [^a-z_]/u);
    expect(proofText).toContain("by imp_elim [l1, l2]");
    expect(proofText).toContain("by neg_elim [l4, l6]");
    expect(proofText).toContain("by neg_intro [l7]");
  });

  test("the assumption rule's spellings are what the review page is handed", () => {
    expect(proofRuleSpellings(FORALLX_THEORY_SOURCE, "ax")).toEqual([
      "ax",
      "AS",
    ]);
    // Asked by alias, the same set, the asked spelling first.
    expect(proofRuleSpellings(FORALLX_THEORY_SOURCE, "AS")).toEqual([
      "AS",
      "ax",
    ]);
    // A rule with no alias, and a name the theory never mentions.
    expect(proofRuleSpellings(FORALLX_THEORY_SOURCE, "and_elim_l")).toEqual([
      "and_elim_l",
    ]);
    expect(proofRuleSpellings(null, "ax")).toEqual(["ax"]);
  });
});
