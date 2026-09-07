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
        "AS",
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
        "AS",
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
      "Ax(F(x)->G(x))   :AS",
      "t",
      "AS",
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
      "F(a) /\\   :AS",
      "t",
      "AS",
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
      "a -> b   :AS",
      "mp",
      "AS",
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
        "a ∨ b       :AS",
        "    a       :AS",
        "    b ∨ a   :or_intro_r 2",
        "    b       :AS",
        "    b ∨ a   :or_intro_l 4",
        "b ∨ a       :or_elim 1 2-3 4-5",
      ].join("\n"),
      "orcomm",
      "AS",
      "⊢",
    );

    expect(diagnostics).toEqual([]);
    expect(proofText).toBe(
      [
        "orcomm",
        "----",
        "l1: $ a ∨ b ⊢ a ∨ b $ by AS []",
        "l2: $ a ∨ b , a ⊢ a $ by AS []",
        "l3: $ a ∨ b , a ⊢ b ∨ a $ by or_intro_r [l2]",
        "l4: $ a ∨ b , b ⊢ b $ by AS []",
        "l5: $ a ∨ b , b ⊢ b ∨ a $ by or_intro_l [l4]",
        "l6: $ a ∨ b ⊢ b ∨ a $ by or_elim [l1, l3, l5]",
      ].join("\n"),
    );
  });

  test("top-level premises still share one context (not split into boxes)", () => {
    const { proofText } = fitchToAuf(
      ["a → b   :AS", "a       :AS", "b       :imp_elim 1 2"].join("\n"),
      "mp",
      "AS",
      "⊢",
    );

    expect(proofText).toContain("l1: $ a → b , a ⊢ a → b $ by AS []");
    expect(proofText).toContain("l3: $ a → b , a ⊢ b $ by imp_elim [l1, l2]");
  });

  test("assumptions before any derivation stay in one box (reiteration)", () => {
    const { proofText } = fitchToAuf(
      [
        "    a           :AS",
        "        b       :AS",
        "        a       :AS",
        "    b → a       :imp_intro 2-3",
        "a → (b → a)     :imp_intro 1-4",
      ].join("\n"),
      "kcomb",
      "AS",
      "⊢",
    );

    expect(proofText).toContain("l2: $ a , b ⊢ b $ by AS []");
    expect(proofText).toContain("l3: $ a , b ⊢ a $ by AS []");
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
        "∃ x (F x)          :AS",
        "∀ x (F x → G x)    :AS",
        "    F y            :AS",
        "    F y → G y      :all_elim 2",
        "    G y            :imp_elim 4 3",
        "    ∃ x (G x)      :ex_intro 5",
        "∃ x (G x)          :ex_elim 1 3-6",
      ].join("\n"),
      "exelim",
      "AS",
      "⊢",
    );

    expect(diagnostics).toEqual([]);
    expect(proofText).toBe(
      [
        "exelim",
        "----",
        "l1: $ ∃ x (F x) , ∀ x (F x → G x) ⊢ ∃ x (F x) $ by AS []",
        "l2: $ ∃ x (F x) , ∀ x (F x → G x) ⊢ ∀ x (F x → G x) $ by AS []",
        "l3: $ ∃ x (F x) , ∀ x (F x → G x) , F y ⊢ F y $ by AS []",
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
        "x = y       :AS",
        "F x         :AS",
        "F y         :eq_replace 1 2",
      ].join("\n"),
      "eqreplace",
      "AS",
      "⊢",
    );

    expect(proofText).toContain(
      "l3: $ x = y , F x ⊢ F y $ by eq_replace [l1, l2]",
    );
  });
});

describe("forallx: Calgary rule aliases", () => {
  test("the theory names each textbook citation, a paired one on its fallback axiom", () => {
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
    expect(readRule("AS")).toBe("AS");
    expect(readRule("PR")).toBe("AS");
    expect(readRule("R")).toBe("reit");
    // A pair's name lands on the axiom that carries the @fallback onto its
    // sibling; the engine, not the reader, decides which side a line wants.
    expect(readRule("∧E")).toBe("and_elim_r");
    expect(readRule("∨I")).toBe("or_intro_r");
    expect(readRule("↔E")).toBe("iff_elim_r");
    // A canonical name is not an alias; it stands, as does anything unknown.
    expect(readRule("and_intro")).toBe("and_intro");
    expect(readRule("and_elim_l")).toBe("and_elim_l");
    expect(readRule("∧X")).toBe("∧X");
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
      "AS",
      "⊢",
      ";",
      readSentence,
      citationShapes,
      readRule,
    );

    expect(diagnostics).toEqual([]);
    expect(formulaProblems).toEqual([]);
    expect(proofText).not.toMatch(/by [^A-Za-z_]/u);
    expect(proofText).toContain("by imp_elim [l1, l2]");
    expect(proofText).toContain("by neg_elim [l4, l6]");
    expect(proofText).toContain("by neg_intro [l7]");
  });

  test("the assumption rule's spellings are what the review page is handed", () => {
    // The assumption axiom carries the book's own name and one alias, the
    // tradition's other name for the same rule.
    expect(proofRuleSpellings(FORALLX_THEORY_SOURCE, "AS")).toEqual([
      "AS",
      "PR",
    ]);
    // Asked by alias, the same set, the asked spelling first.
    expect(proofRuleSpellings(FORALLX_THEORY_SOURCE, "PR")).toEqual([
      "PR",
      "AS",
    ]);
    // The unaliased side of a pair, its aliased sibling, and a name the
    // theory never mentions.
    expect(proofRuleSpellings(FORALLX_THEORY_SOURCE, "and_elim_l")).toEqual([
      "and_elim_l",
    ]);
    expect(proofRuleSpellings(FORALLX_THEORY_SOURCE, "and_elim_r")).toEqual([
      "and_elim_r",
      "∧E",
      "/\\E",
      "&E",
      "^E",
    ]);
    expect(proofRuleSpellings(null, "AS")).toEqual(["AS"]);
  });
});
