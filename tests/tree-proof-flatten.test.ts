import { describe, expect, test } from "bun:test";

import { flattenProofTree } from "../src/worker/exercises/aufbau-proof-tree/flatten";
import type { ProofTreeNode } from "../src/worker/exercises/aufbau-proof-tree/types";

function node(
  id: string,
  formula: string,
  rule: string,
  premises: ProofTreeNode[] = [],
): ProofTreeNode {
  return { formula, id, premises, rule };
}

describe("flattenProofTree", () => {
  test("a leaf becomes a single line with an empty citation list", () => {
    const { proofText, lineSpans } = flattenProofTree(
      node("root", "top", "top_i"),
      "thm_top",
    );

    expect(proofText).toBe("thm_top\n----\nl1: $ top $ by top_i []");
    expect(lineSpans).toEqual([{ from: 13, nodeId: "root", to: 36 }]);
    // The span really points at the generated line.
    expect(proofText.slice(13, 36)).toBe("l1: $ top $ by top_i []");
  });

  test("postorder: children are labelled before the parent that cites them", () => {
    const tree = node("r", "b", "mp", [
      node("p1", "a", "ax"),
      node("p2", "a -> b", "ax"),
    ]);
    const { proofText } = flattenProofTree(tree, "thm");

    expect(proofText).toBe(
      [
        "thm",
        "----",
        "l1: $ a $ by ax []",
        "l2: $ a -> b $ by ax []",
        "l3: $ b $ by mp [l1, l2]",
      ].join("\n"),
    );
  });

  test("premise order is preserved (rules are order-sensitive)", () => {
    const tree = node("r", "q & p", "and_intro", [
      node("p1", "q", "and_er"),
      node("p2", "p", "and_el"),
    ]);
    const { proofText } = flattenProofTree(tree, "thm");
    const body = proofText.split("\n----\n")[1] ?? "";

    // l1 = q (first child), l2 = p (second) -> cited [l1, l2] in that order.
    expect(body).toContain("l3: $ q & p $ by and_intro [l1, l2]");
  });

  test("a hyp leaf contributes '#n' and emits no line of its own", () => {
    const tree: ProofTreeNode = {
      formula: "q",
      id: "r",
      premises: [
        { formula: "p", hyp: 1, id: "h", premises: [], rule: "" },
        node("p2", "p -> q", "ax"),
      ],
      rule: "mp",
    };
    const { proofText, lineSpans } = flattenProofTree(tree, "thm");

    expect(proofText).toBe(
      [
        "thm",
        "----",
        "l1: $ p -> q $ by ax []",
        "l2: $ q $ by mp [#1, l1]",
      ].join("\n"),
    );
    // Only the two derived nodes own lines; the hyp leaf owns none.
    expect(lineSpans.map((span) => span.nodeId)).toEqual(["p2", "r"]);
  });

  test("every line span exactly covers its generated line", () => {
    const tree = node("r", "b", "mp", [
      node("p1", "a", "ax"),
      node("p2", "a -> b", "ax"),
    ]);
    const { proofText, lineSpans } = flattenProofTree(tree, "thm");

    for (const span of lineSpans) {
      const line = proofText.slice(span.from, span.to);
      expect(line.startsWith("l")).toBe(true);
      expect(line).not.toContain("\n");
    }
  });
});
