import { describe, expect, test } from "bun:test";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { fitchToAuf } from "../src/worker/exercises/aufbau-proof-fitch/translate";
import { MAGNUS_CASES } from "./helpers/magnus-cases";
import { magnusExercise } from "./helpers/magnus-theory";

/**
 * The forallx (P.D. Magnus) theory and its Fitch encoding. Every basic rule of
 * systems SL and QL has a worked case in {@link MAGNUS_CASES}. As with its
 * Calgary sibling, these tests pin the *translation* — the part this repo owns
 * — while whether the translated proofs verify against the real engine is the
 * end-to-end check in `bun run scripts/magnus-verify.ts`, which compiles and
 * verifies from source each run rather than freezing an MMB blob.
 *
 * The two Magnus-specific shapes get a test of their own below: a line written
 * in the book's juxtaposed notation reaching the compiler as an argument
 * sequence, and a reductio citing one subproof at each of its two
 * contradictory lines.
 */

describe("forallx (Magnus) theory", () => {
  test("every worked case translates without structural diagnostics", () => {
    for (const testCase of MAGNUS_CASES) {
      const { diagnostics } = fitchToAuf(
        testCase.fitch,
        testCase.goalName,
        "ax",
        "⊢",
        ";",
      );
      expect(diagnostics, testCase.name).toEqual([]);
    }
  });

  test("every worked case's lines read in the theory's own language", () => {
    for (const testCase of MAGNUS_CASES) {
      const { readSentence } = magnusExercise(
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

  test("a juxtaposed line reaches the compiler as an argument sequence", () => {
    const { readSentence } = magnusExercise(
      "t",
      "theorem t {x: var} {a: name}: $ ∀ x (F(x) → G(x)) ⊢ ∀ x (F(x) → G(x)) $;",
    );
    const { proofText, formulaProblems } = fitchToAuf(
      "@x(Fx -> Gx)   :ax",
      "t",
      "ax",
      "⊢",
      ";",
      readSentence,
    );

    expect(formulaProblems).toEqual([]);
    expect(proofText).toContain("(∀ x ((F (x)) → (G (x))))");
  });

  test("a reductio cites one subproof at each of its contradictory lines", () => {
    // Magnus's ¬I has no ⊥ to collapse its two premises into one, so the
    // citation names the subproof twice — once ending at ψ, once at ¬ψ — and
    // both refs lower to lines whose context still carries the assumption
    // being discharged. This is the one citation shape a student arriving
    // from Calgary has to learn, so it is pinned rather than left to the
    // verify script.
    const { proofText, diagnostics } = fitchToAuf(
      [
        "p           :ax",
        "    ~p      :ax",
        "    p       :reit 1",
        "    ~p      :reit 2",
        "~~p         :neg_intro 2-3 2-4",
      ].join("\n"),
      "dni",
      "ax",
      "⊢",
      ";",
    );

    expect(diagnostics).toEqual([]);
    expect(proofText).toBe(
      [
        "dni",
        "----",
        "l1: $ p ⊢ p $ by ax []",
        "l2: $ p ; ~p ⊢ ~p $ by ax []",
        "l3: $ p ; ~p ⊢ p $ by reit [l1]",
        "l4: $ p ; ~p ⊢ ~p $ by reit [l2]",
        "l5: $ p ⊢ ~~p $ by neg_intro [l3, l4]",
      ].join("\n"),
    );
  });

  test("a lesson names the shipped id with no block, and freezes the artifact", async () => {
    // The path an author actually takes: `system=` misses every block in the
    // document, falls through to the ids this site ships, and finds the file
    // — which is only true because it is registered in both `THEORY_SOURCES`
    // and the spec table, the second being what makes the lines readable.
    const compiled = await compileCarnapMarkdown(
      `:::aufbau-proof-fitch{system="forallx-magnus" id="mp"}
Take the conditional apart.

theorem mp (p q: wff): $ (p → q) ; p ⊢ q $
----
p -> q  :ax
p       :ax
q       :imp_elim 1 2
:::
`,
    );

    // Errors only: this goal is a rule schema, so it warns that `p` and `q`
    // shadow the theory's names, which is the warning doing its job.
    expect(
      compiled.diagnostics
        .filter((entry) => entry.severity === "error")
        .map((entry) => entry.code),
      JSON.stringify(compiled.diagnostics),
    ).toEqual([]);
    expect(compiled.ok).toBe(true);

    if (!compiled.ok) {
      return;
    }

    expect(Object.keys(compiled.artifact.systems ?? {})).toEqual([
      "forallx-magnus",
    ]);
  });
});
