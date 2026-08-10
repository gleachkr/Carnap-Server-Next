import { describe, expect, test } from "bun:test";

import { flattenProofTree } from "../src/worker/exercises/aufbau-proof-tree/flatten";
import { parseProofTree } from "../src/worker/exercises/aufbau-proof-tree/parse";
import type { ProofTreeNode } from "../src/worker/exercises/aufbau-proof-tree/types";
import { GENTZEN_CASES } from "./helpers/gentzen-cases";

/** Structural view of a tree with the ephemeral `id`s dropped. */
function shape(node: ProofTreeNode): unknown {
  return {
    formula: node.formula,
    hyp: node.hyp,
    premises: node.premises.map(shape),
    rule: node.rule,
  };
}

/** The `.auf` body only — parseProofTree takes the proof lines, not the header. */
function bodyOf(proofText: string): string {
  return proofText.split("\n----\n")[1] ?? "";
}

describe("parseProofTree — inverse of flattenProofTree", () => {
  test("round-trips every Gentzen case (flatten then parse recovers the tree)", () => {
    for (const testCase of GENTZEN_CASES) {
      const { proofText } = flattenProofTree(
        testCase.tree,
        testCase.goalName,
      );
      const parsed = parseProofTree(bodyOf(proofText));

      expect(parsed.ok, testCase.name).toBe(true);
      if (!parsed.ok) {
        continue;
      }
      expect(shape(parsed.tree), testCase.name).toEqual(shape(testCase.tree));
    }
  });

  test("builds the nested structure from citations", () => {
    const parsed = parseProofTree(
      [
        "l1: $ a $ by ax []",
        "l2: $ a → b $ by ax []",
        "l3: $ b $ by imp_elim [l1, l2]",
      ].join("\n"),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(shape(parsed.tree)).toEqual({
      formula: "b",
      hyp: undefined,
      premises: [
        { formula: "a", hyp: undefined, premises: [], rule: "ax" },
        { formula: "a → b", hyp: undefined, premises: [], rule: "ax" },
      ],
      rule: "imp_elim",
    });
  });

  test("a `#n` citation becomes a hypothesis leaf", () => {
    const parsed = parseProofTree(
      ["l1: $ p → q $ by ax []", "l2: $ q $ by imp_elim [#1, l1]"].join("\n"),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.tree.premises[0]?.hyp).toBe(1);
    expect(parsed.tree.premises[0]?.premises).toEqual([]);
  });

  test("a line cited twice is rejected as a graph, not a tree", () => {
    const parsed = parseProofTree(
      [
        "l1: $ a $ by ax []",
        "l2: $ b $ by r [l1]",
        "l3: $ c $ by r [l1]",
        "l4: $ d $ by r [l2, l3]",
      ].join("\n"),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.issue.code).toBe("proof_is_not_a_tree");
  });

  test("an unknown citation is rejected", () => {
    const parsed = parseProofTree(
      ["l1: $ a $ by ax []", "l2: $ b $ by r [l9]"].join("\n"),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue.code).toBe("unknown_proof_reference");
    }
  });

  test("more than one uncited line is rejected (no single root)", () => {
    const parsed = parseProofTree(
      ["l1: $ a $ by ax []", "l2: $ b $ by ax []"].join("\n"),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue.code).toBe("proof_has_multiple_roots");
    }
  });

  test("a malformed line is rejected with its offset", () => {
    const parsed = parseProofTree(
      ["l1: $ a $ by ax []", "this is not a proof line"].join("\n"),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue.code).toBe("malformed_proof_line");
      expect(parsed.issue.bodyLine).toBe(1);
    }
  });

  test("a duplicate label is rejected", () => {
    const parsed = parseProofTree(
      ["l1: $ a $ by ax []", "l1: $ b $ by ax []"].join("\n"),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue.code).toBe("duplicate_proof_label");
    }
  });

  test("blank lines and comments are ignored", () => {
    const parsed = parseProofTree(
      ["-- a worked leaf", "", "l1: $ a $ by ax []", ""].join("\n"),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(shape(parsed.tree)).toEqual({
        formula: "a",
        hyp: undefined,
        premises: [],
        rule: "ax",
      });
    }
  });
});
