import { describe, expect, test } from "bun:test";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { ruleCitationShapes } from "../src/worker/exercises/aufbau-proof-fitch/citations";
import { fitchToAuf } from "../src/worker/exercises/aufbau-proof-fitch/translate";
import { MAGNUS_CASES } from "./helpers/magnus-cases";
import {
  MAGNUS_THEORY_SOURCE,
  magnusExercise,
} from "./helpers/magnus-theory";

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
 * sequence, and a reductio whose two premises come from one cited subproof —
 * in the book's single-range spelling and in the explicit one-ref-per-premise
 * spelling, which lower to the same `.auf`.
 */

describe("forallx (Magnus) theory", () => {
  test("every worked case translates without structural diagnostics", () => {
    const citationShapes = ruleCitationShapes(MAGNUS_THEORY_SOURCE);

    for (const testCase of MAGNUS_CASES) {
      const { diagnostics } = fitchToAuf(
        testCase.fitch,
        testCase.goalName,
        "AS",
        "⊢",
        ";",
        undefined,
        citationShapes,
      );
      expect(diagnostics, testCase.name).toEqual([]);
    }
  });

  test("every worked case's lines read in the theory's own language", () => {
    for (const testCase of MAGNUS_CASES) {
      const { citationShapes, readSentence } = magnusExercise(
        testCase.goalName,
        testCase.theoremDecl,
        testCase.system,
      );
      const { formulaProblems } = fitchToAuf(
        testCase.fitch,
        testCase.goalName,
        "AS",
        "⊢",
        ";",
        readSentence,
        citationShapes,
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
      "@x(Fx -> Gx)   :AS",
      "t",
      "AS",
      "⊢",
      ";",
      readSentence,
    );

    expect(formulaProblems).toEqual([]);
    expect(proofText).toContain("(∀ x ((F (x)) → (G (x))))");
  });

  test("a reductio's two spellings lower to the same proof", () => {
    // Magnus's ¬I has no ⊥ to collapse its two premises into one. The book
    // cites one subproof ending with the contradictory pair — `neg_intro 2-4`
    // — and the citation table derived from the rule's own signature is what
    // lets that one range supply both premises, as the box's last two lines
    // in premise order. The explicit spelling, one ref per premise naming the
    // subproof twice, lowers to the byte-identical `.auf`; both stay legal,
    // told apart by their ref count. Pinned rather than left to the verify
    // script because this is the shape students actually type.
    const fitch = (citation: string): string =>
      [
        "p           :AS",
        "    ~p      :AS",
        "    p       :reit 1",
        "    ~p      :reit 2",
        `~~p         :neg_intro ${citation}`,
      ].join("\n");
    const citationShapes = ruleCitationShapes(MAGNUS_THEORY_SOURCE);
    const lowered = [
      "dni",
      "----",
      "l1: $ p ⊢ p $ by AS []",
      "l2: $ p ; ~p ⊢ ~p $ by AS []",
      "l3: $ p ; ~p ⊢ p $ by reit [l1]",
      "l4: $ p ; ~p ⊢ ~p $ by reit [l2]",
      "l5: $ p ⊢ ~~p $ by neg_intro [l3, l4]",
    ].join("\n");

    for (const citation of ["2-4", "2-3 2-4"]) {
      const { proofText, diagnostics } = fitchToAuf(
        fitch(citation),
        "dni",
        "AS",
        "⊢",
        ";",
        undefined,
        citationShapes,
      );

      expect(diagnostics, citation).toEqual([]);
      expect(proofText, citation).toBe(lowered);
    }
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
p -> q  :AS
p       :AS
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
