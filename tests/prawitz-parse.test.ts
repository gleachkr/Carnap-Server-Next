import { describe, expect, test } from "bun:test";

import {
  parsePrawitzStarter,
  serializePrawitzStarter,
} from "../src/worker/exercises/aufbau-proof-prawitz/parse";
import type { PrawitzProofNode } from "../src/worker/exercises/aufbau-proof-prawitz/types";

/** Strip the ephemeral node ids so trees compare structurally. */
function shape(node: PrawitzProofNode): unknown {
  return {
    ...(node.discharge === undefined ? {} : { discharge: node.discharge }),
    formula: node.formula,
    ...(node.label === undefined ? {} : { label: node.label }),
    premises: node.premises.map(shape),
    rule: node.rule,
  };
}

function parsed(body: string, sequentSymbol = "⊢") {
  const result = parsePrawitzStarter(body, "ax", sequentSymbol);
  if (!result.ok) {
    throw new Error(`unexpected issue: ${result.issue.code}`);
  }
  return result;
}

function issueCode(body: string, sequentSymbol = "⊢"): string {
  const result = parsePrawitzStarter(body, "ax", sequentSymbol);
  if (result.ok) {
    throw new Error("expected an issue");
  }
  return result.issue.code;
}

describe("parsePrawitzStarter", () => {
  test("sequent lines with label comments become a labeled, discharging tree", () => {
    const result = parsed(
      [
        "a1: $ a ⊢ a $ by ax [] -- label:1",
        "c1: $ _ ⊢ a → a $ by imp_intro [a1] -- label:1",
      ].join("\n"),
    );

    expect(shape(result.tree)).toEqual({
      discharge: ["1"],
      formula: "a → a",
      premises: [{ formula: "a", label: "1", premises: [], rule: "ax" }],
      rule: "imp_intro",
    });
    expect(result.bodyLineByLabel.get("a1")).toBe(0);
    expect(result.bodyLineByLabel.get("c1")).toBe(1);
  });

  test("the context left of the sequent is discarded; `--` inside the formula survives", () => {
    const result = parsed(
      [
        "l1: $ a → b , a ⊢ b $ by imp_elim [l2, l3]",
        "l2: $ a → b ⊢ a → b $ by ax []",
        "l3: $ _ ⊢ a -- b $ by ax []",
      ].join("\n"),
    );

    expect(shape(result.tree)).toEqual({
      formula: "b",
      premises: [
        { formula: "a → b", premises: [], rule: "ax" },
        { formula: "a -- b", premises: [], rule: "ax" },
      ],
      rule: "imp_elim",
    });
  });

  test("the sequent symbol is the exercise's, not hardcoded", () => {
    const result = parsed("l1: $ G |- top $ by top_i []", "|-");
    expect(shape(result.tree)).toEqual({
      formula: "top",
      premises: [],
      rule: "top_i",
    });
  });

  test("a rule line's label comment lists several discharge marks", () => {
    const result = parsed(
      [
        "a1: $ a ⊢ a $ by ax [] -- label:1",
        "a2: $ a ⊢ a $ by ax [] -- label:2",
        "c1: $ a , a ⊢ a ∧ a $ by and_intro [a1, a2]",
        "c2: $ _ ⊢ a → (a ∧ a) $ by imp_intro [c1] -- label:1, 2",
      ].join("\n"),
    );
    expect(shape(result.tree)).toMatchObject({ discharge: ["1", "2"] });
  });

  test("ordinary comments — whole-line and trailing — stay inert", () => {
    const result = parsed(
      [
        "-- the leaf",
        "a1: $ a ⊢ a $ by ax [] -- an unused assumption",
        "c1: $ a ⊢ a → a $ by imp_intro [a1] -- label:1",
      ].join("\n"),
    );
    const leaf = result.tree.premises[0];
    expect(leaf?.label).toBeUndefined();
    expect(result.tree.discharge).toEqual(["1"]);
  });

  test("a whole-line label comment is refused rather than silently dropped", () => {
    expect(
      issueCode(["a1: $ a ⊢ a $ by ax []", "-- label:1"].join("\n")),
    ).toBe("misplaced_label_comment");
  });

  test("a label comment naming nothing is refused", () => {
    expect(issueCode("a1: $ a ⊢ a $ by ax [] -- label:")).toBe(
      "empty_label_comment",
    );
  });

  test("an assumption line refuses a list of labels", () => {
    expect(issueCode("a1: $ a ⊢ a $ by ax [] -- label:1, 2")).toBe(
      "assumption_label_list",
    );
  });

  test("a line without the sequent symbol is refused — starters are full sequents", () => {
    expect(issueCode("a1: $ a $ by ax []")).toBe("starter_line_not_sequent");
    // The symbol checked is the exercise's, not a hardcoded turnstile.
    expect(issueCode("a1: $ a ⊢ a $ by ax []", "|-")).toBe(
      "starter_line_not_sequent",
    );
  });

  test("hypothesis citations are refused — every leaf is an assumption line", () => {
    expect(issueCode("l1: $ b $ by imp_elim [#1, #2]")).toBe(
      "hyp_ref_in_prawitz_starter",
    );
  });

  test("the tree parser's structural policing still applies", () => {
    expect(issueCode("just prose")).toBe("malformed_proof_line");
    expect(
      issueCode(
        [
          "a1: $ a ⊢ a $ by ax []",
          "c1: $ a ⊢ a ∧ a $ by and_intro [a1, a1]",
        ].join("\n"),
      ),
    ).toBe("proof_is_not_a_tree");
  });
});

describe("serializePrawitzStarter", () => {
  // The kcomb shape: discharge, an unused-but-conjoined assumption, and an
  // unlabeled standing premise — everything the notation can carry.
  const tree: PrawitzProofNode = {
    discharge: ["1"],
    formula: "b → a",
    id: "r",
    premises: [
      {
        formula: "a",
        id: "e",
        premises: [
          {
            formula: "b ∧ a",
            id: "i",
            premises: [
              { formula: "b", id: "x", label: "1", premises: [], rule: "ax" },
              { formula: "a", id: "y", premises: [], rule: "ax" },
            ],
            rule: "and_intro",
          },
        ],
        rule: "and_elim_r",
      },
    ],
    rule: "imp_intro",
  };

  test("emits the translator's compilable .auf, label comments at both ends of a discharge", () => {
    expect(serializePrawitzStarter(tree, "ax", "⊢")).toBe(
      [
        "l1: $ b ⊢ b $ by ax [] -- label:1",
        "l2: $ a ⊢ a $ by ax []",
        "l3: $ b , a ⊢ b ∧ a $ by and_intro [l1, l2]",
        "l4: $ b , a ⊢ a $ by and_elim_r [l3]",
        "l5: $ a ⊢ b → a $ by imp_intro [l4] -- label:1",
      ].join("\n"),
    );
  });

  test("serialize ∘ parse is the identity on the tree's shape", () => {
    const result = parsed(serializePrawitzStarter(tree, "ax", "⊢"));
    expect(shape(result.tree)).toEqual(shape(tree));
  });
});
