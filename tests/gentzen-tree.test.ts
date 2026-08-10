import { describe, expect, test } from "bun:test";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { flattenProofTree } from "../src/worker/exercises/aufbau-proof-tree/flatten";
import { isAufbauProofTreePublicData } from "../src/worker/exercises/aufbau-proof-tree/types";
import { GENTZEN_CASES } from "./helpers/gentzen-cases";
import { GENTZEN_DEMO_SOURCE } from "./helpers/gentzen-demo";
import { GENTZEN_STARTER_DEMO_SOURCE } from "./helpers/gentzen-starter-demo";

/**
 * The Gentzen classical sequent calculus (LK) exercised through the *tree* proof
 * type. An LK derivation is already a tree, so each {@link GENTZEN_CASES} node
 * carries a full sequent `Γ ==> Δ` and `flattenProofTree` copies it through — no
 * sequent-calculus-specific translation, the same way the Fitch type needs none
 * for natural deduction. These tests pin the part this repo owns: that each case
 * flattens to well-formed backward-referencing `.auf`, and that the demo lesson
 * compiles through the authoring pipeline. Whether the flattened proofs actually
 * verify against the real engine is the end-to-end check in
 * `bun run scripts/gentzen-verify.ts`, which compiles + verifies from source (so
 * nothing here freezes a compiler-specific MMB blob — MMB stability is the
 * engine's responsibility, not ours to pin).
 */

describe("Gentzen: classical sequent calculus (LK)", () => {
  test("every worked case flattens to backward-referencing .auf ending in the goal", () => {
    for (const testCase of GENTZEN_CASES) {
      const { proofText } = flattenProofTree(
        testCase.tree,
        testCase.goalName,
      );
      expect(proofText.startsWith(`${testCase.goalName}\n----\n`)).toBe(true);

      const body = proofText.split("\n----\n")[1] ?? "";
      const lines = body.split("\n");

      // The root node owns the last line: its sequent and rule close the proof.
      const last = lines.at(-1) ?? "";
      expect(last, testCase.name).toStartWith(
        `l${lines.length}: $ ${testCase.tree.formula} $ by ${testCase.tree.rule} [`,
      );

      // No forward references: every cited label precedes the line citing it.
      for (const [index, line] of lines.entries()) {
        const citations = line.match(/l(\d+)/g) ?? [];
        const own = index + 1;
        for (const citation of citations) {
          const cited = Number(citation.slice(1));
          if (cited !== own) {
            expect(cited, `${testCase.name}: ${line}`).toBeLessThan(own);
          }
        }
      }
    }
  });

  test("exists_mono flattens to the expected LK derivation", () => {
    const exists = GENTZEN_CASES.find((c) => c.goalName === "exists_mono");
    if (!exists) {
      throw new Error("exists_mono case missing");
    }
    const { proofText } = flattenProofTree(exists.tree, exists.goalName);

    expect(proofText).toBe(
      [
        "exists_mono",
        "----",
        "l1: $ P x ==> P x $ by ax []",
        "l2: $ Q x ==> Q x $ by ax []",
        "l3: $ P x , P x → Q x ==> Q x $ by imp_left [l1, l2]",
        "l4: $ ∀ y (P y → Q y) , P x ==> Q x $ by all_left [l3]",
        "l5: $ ∀ y (P y → Q y) , P x ==> ∃ z Q z $ by ex_right [l4]",
        "l6: $ ∀ y (P y → Q y) , ∃ x P x ==> ∃ z Q z $ by ex_left [l5]",
      ].join("\n"),
    );
  });

  test("a branching proof (∨-left) flattens both subtrees before the join", () => {
    const distrib = GENTZEN_CASES.find(
      (c) => c.goalName === "exists_or_distrib",
    );
    if (!distrib) {
      throw new Error("exists_or_distrib case missing");
    }
    const { proofText } = flattenProofTree(distrib.tree, distrib.goalName);

    // The two ∨-left branches (l4 and l8) are each fully derived before the
    // join line cites them in left-to-right order.
    expect(proofText).toContain(
      "l4: $ P x ==> (∃ y P y ∨ ∃ z Q z) $ by or_right [l3]",
    );
    expect(proofText).toContain(
      "l8: $ Q x ==> (∃ y P y ∨ ∃ z Q z) $ by or_right [l7]",
    );
    expect(proofText).toContain(
      "l9: $ P x ∨ Q x ==> (∃ y P y ∨ ∃ z Q z) $ by or_left [l4, l8]",
    );
  });

  test("the demo lesson compiles through the authoring pipeline", async () => {
    const compiled = await compileCarnapMarkdown(GENTZEN_DEMO_SOURCE);
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
      "forall_to_exists",
      "exists_mono",
      "forall_excluded_middle",
      "exists_or_distrib",
    ]);
  });

  test("the pre-populated demo lesson compiles, seeding every tree", async () => {
    const compiled = await compileCarnapMarkdown(GENTZEN_STARTER_DEMO_SOURCE);
    expect(
      compiled.diagnostics.map((entry) => entry.code),
      JSON.stringify(compiled.diagnostics),
    ).toEqual([]);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    // Every exercise ships a starter tree; the scaffold's `imp_left` node is the
    // one seeded incomplete (no premises) for the student to finish.
    const trees = compiled.artifact.manifest.filter((entry) =>
      isAufbauProofTreePublicData(entry.publicData),
    );
    expect(trees.map((entry) => entry.id)).toEqual([
      "starter_forall_to_exists",
      "starter_exists_mono",
      "starter_exists_or_distrib",
      "starter_permute_mono",
    ]);
    for (const entry of trees) {
      if (!isAufbauProofTreePublicData(entry.publicData)) {
        continue;
      }
      expect(entry.publicData.starterTree, entry.id).toBeDefined();
    }
    const scaffold = trees.find(
      (entry) => entry.id === "starter_exists_mono",
    );
    if (scaffold && isAufbauProofTreePublicData(scaffold.publicData)) {
      const impLeft =
        scaffold.publicData.starterTree?.premises[0]?.premises[0]
          ?.premises[0];
      expect(impLeft?.rule).toBe("imp_left");
      expect(impLeft?.premises).toEqual([]);
    }
  });
});
