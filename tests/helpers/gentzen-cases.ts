import type { ProofTreeNode } from "../../src/worker/exercises/aufbau-proof-tree/types";

/**
 * One worked proof *tree* per family of rules in the {@link ./gentzen-theory}
 * classical sequent calculus (LK): the structural rules (identity, weakening,
 * cut), every connective's left/right pair, and the four quantifier rules. Each
 * tree is transcribed from gleachkr/Aufbau's `tests/proof_cases/gentzen.auf`
 * (the upstream, engine-verified linear proofs) by reading the citations back
 * into the tree they flatten from — plus one small `imp_self` added here so the
 * `imp_right` rule is exercised too.
 *
 * Because an LK derivation *is* a tree, each node carries its full sequent
 * `Γ ==> Δ` and `flattenProofTree` copies it through unchanged: the tree-proof
 * type needs no sequent-calculus-specific code, exactly as the Fitch type needs
 * none for natural deduction. Shared by the translation test (which asserts the
 * flattened `.auf` shape) and `scripts/gentzen-verify.ts` (which compiles +
 * verifies every case against the real engine).
 */
export interface GentzenCase {
  /** Human label naming the rules the case exercises. */
  readonly name: string;
  /** The frozen goal declaration appended to the theory. */
  readonly theoremDecl: string;
  readonly goalName: string;
  /** The root of the proof tree proving the goal sequent. */
  readonly tree: ProofTreeNode;
}

/** Build a derived (non-hypothesis) proof-tree node. */
function node(
  id: string,
  formula: string,
  rule: string,
  premises: ProofTreeNode[] = [],
): ProofTreeNode {
  return { formula, id, premises, rule };
}

export const GENTZEN_CASES: readonly GentzenCase[] = [
  {
    name: "exists_mono (ax, imp_left, all_left, ex_right, ex_left)",
    theoremDecl:
      "theorem exists_mono {x y z: obj}: $ ∀ y (P y → Q y) , ∃ x P x ==> ∃ z Q z $;",
    goalName: "exists_mono",
    tree: node("n6", "∀ y (P y → Q y) , ∃ x P x ==> ∃ z Q z", "ex_left", [
      node("n5", "∀ y (P y → Q y) , P x ==> ∃ z Q z", "ex_right", [
        node("n4", "∀ y (P y → Q y) , P x ==> Q x", "all_left", [
          node("n3", "P x , P x → Q x ==> Q x", "imp_left", [
            node("n1", "P x ==> P x", "ax"),
            node("n2", "Q x ==> Q x", "ax"),
          ]),
        ]),
      ]),
    ]),
  },
  {
    name: "forall_mono (all_right, all_left ×2, imp_left)",
    theoremDecl:
      "theorem forall_mono {x y z: obj}: $ ∀ x (P x → Q x) , ∀ y P y ==> ∀ z Q z $;",
    goalName: "forall_mono",
    tree: node("n6", "∀ x (P x → Q x) , ∀ y P y ==> ∀ z Q z", "all_right", [
      node("n5", "∀ x (P x → Q x) , ∀ y P y ==> Q z", "all_left", [
        node("n4", "∀ x (P x → Q x) , P z ==> Q z", "all_left", [
          node("n3", "P z , P z → Q z ==> Q z", "imp_left", [
            node("n1", "P z ==> P z", "ax"),
            node("n2", "Q z ==> Q z", "ax"),
          ]),
        ]),
      ]),
    ]),
  },
  {
    name: "forall_to_exists (all_left, ex_right)",
    theoremDecl:
      "theorem forall_to_exists {x y: obj}: $ ∀ x P x ==> ∃ y P y $;",
    goalName: "forall_to_exists",
    tree: node("n3", "∀ x P x ==> ∃ y P y", "ex_right", [
      node("n2", "∀ x P x ==> P z", "all_left", [
        node("n1", "P z ==> P z", "ax"),
      ]),
    ]),
  },
  {
    name: "forall_not_to_not_exists (not_left, not_right, all_left, ex_left)",
    theoremDecl:
      "theorem forall_not_to_not_exists {x y: obj}: $ ∀ x (¬ P x) ==> ¬ (∃ y P y) $;",
    goalName: "forall_not_to_not_exists",
    tree: node("n5", "∀ x (¬ P x) ==> ¬ (∃ y P y)", "not_right", [
      node("n4", "∀ x (¬ P x) , ∃ y P y ==> _", "ex_left", [
        node("n3", "∀ x (¬ P x) , P y ==> _", "all_left", [
          node("n2", "P y , ¬ P y ==> _", "not_left", [
            node("n1", "P y ==> P y", "ax"),
          ]),
        ]),
      ]),
    ]),
  },
  {
    name: "not_exists_to_forall_not (ex_right, not_left, not_right, all_right)",
    theoremDecl:
      "theorem not_exists_to_forall_not {x y: obj}: $ ¬ (∃ x P x) ==> ∀ y (¬ P y) $;",
    goalName: "not_exists_to_forall_not",
    tree: node("n5", "¬ (∃ x P x) ==> ∀ y (¬ P y)", "all_right", [
      node("n4", "¬ (∃ x P x) ==> ¬ P y", "not_right", [
        node("n3", "P y , ¬ (∃ x P x) ==> _", "not_left", [
          node("n2", "P y ==> ∃ x P x", "ex_right", [
            node("n1", "P y ==> P y", "ax"),
          ]),
        ]),
      ]),
    ]),
  },
  {
    name: "exists_or_distrib (weak_right, or_right, or_left, ex_right, ex_left)",
    theoremDecl:
      "theorem exists_or_distrib {x y z: obj}: $ ∃ x (P x ∨ Q x) ==> (∃ y P y ∨ ∃ z Q z) $;",
    goalName: "exists_or_distrib",
    tree: node("n10", "∃ x (P x ∨ Q x) ==> (∃ y P y ∨ ∃ z Q z)", "ex_left", [
      node("n9", "P x ∨ Q x ==> (∃ y P y ∨ ∃ z Q z)", "or_left", [
        node("n4", "P x ==> (∃ y P y ∨ ∃ z Q z)", "or_right", [
          node("n3", "P x ==> ∃ y P y , ∃ z Q z", "weak_right", [
            node("n2", "P x ==> ∃ y P y", "ex_right", [
              node("n1", "P x ==> P x", "ax"),
            ]),
          ]),
        ]),
        node("n8", "Q x ==> (∃ y P y ∨ ∃ z Q z)", "or_right", [
          node("n7", "Q x ==> ∃ y P y , ∃ z Q z", "weak_right", [
            node("n6", "Q x ==> ∃ z Q z", "ex_right", [
              node("n5", "Q x ==> Q x", "ax"),
            ]),
          ]),
        ]),
      ]),
    ]),
  },
  {
    name: "forall_excluded_middle (not_right, or_right, all_right)",
    theoremDecl:
      "theorem forall_excluded_middle {x: obj}: $ emp ==> ∀ x (P x ∨ ¬ P x) $;",
    goalName: "forall_excluded_middle",
    tree: node("n4", "_ ==> ∀ x (P x ∨ ¬ P x)", "all_right", [
      node("n3", "_ ==> P x ∨ ¬ P x", "or_right", [
        node("n2", "_ ==> P x , ¬ P x", "not_right", [
          node("n1", "P x ==> P x", "ax"),
        ]),
      ]),
    ]),
  },
  {
    name: "forall_exists_permute_mono (weak_left, and_left, and_right, cut)",
    theoremDecl:
      "theorem forall_exists_permute_mono {u v x y: obj}: $ ∀ u ∃ v (P u ∧ Q v) ==> ∃ y ∀ x (P x ∧ Q y) $;",
    goalName: "forall_exists_permute_mono",
    // Root is `cut [b6, c9]`; c9 in turn is `cut [a6, c7]`. The a-, b- and
    // c-blocks below mirror the labelled blocks in gentzen.auf.
    tree: node("c10", "∀ u ∃ v (P u ∧ Q v) ==> ∃ y ∀ x (P x ∧ Q y)", "cut", [
      // b-block: ∀u∃v(Pu∧Qv) ==> ∃z Q z
      node("b6", "∀ u ∃ v (P u ∧ Q v) ==> ∃ z Q z", "all_left", [
        node("b5", "∃ v (P x ∧ Q v) ==> ∃ z Q z", "ex_left", [
          node("b4", "P x ∧ Q v ==> ∃ z Q z", "ex_right", [
            node("b3", "P x ∧ Q v ==> Q v", "and_left", [
              node("b2", "P x , Q v ==> Q v", "weak_left", [
                node("b1", "Q v ==> Q v", "ax"),
              ]),
            ]),
          ]),
        ]),
      ]),
      node(
        "c9",
        "∀ u ∃ v (P u ∧ Q v) , ∃ z Q z ==> ∃ y ∀ x (P x ∧ Q y)",
        "ex_left",
        [
          node(
            "c8",
            "∀ u ∃ v (P u ∧ Q v) , Q z ==> ∃ y ∀ x (P x ∧ Q y)",
            "cut",
            [
              // a-block: ∀u∃v(Pu∧Qv) ==> ∀z P z
              node("a6", "∀ u ∃ v (P u ∧ Q v) ==> ∀ z P z", "all_right", [
                node("a5", "∀ u ∃ v (P u ∧ Q v) ==> P z", "all_left", [
                  node("a4", "∃ v (P z ∧ Q v) ==> P z", "ex_left", [
                    node("a3", "P z ∧ Q v ==> P z", "and_left", [
                      node("a2", "P z , Q v ==> P z", "weak_left", [
                        node("a1", "P z ==> P z", "ax"),
                      ]),
                    ]),
                  ]),
                ]),
              ]),
              // c-block above the inner cut
              node(
                "c7",
                "∀ z P z , Q z ==> ∃ y ∀ x (P x ∧ Q y)",
                "ex_right",
                [
                  node(
                    "c6",
                    "∀ z P z , Q z ==> ∀ x (P x ∧ Q z)",
                    "all_right",
                    [
                      node("c5", "∀ z P z , Q z ==> P x ∧ Q z", "and_right", [
                        node("c3", "∀ z P z , Q z ==> P x", "weak_left", [
                          node("c2", "∀ z P z ==> P x", "all_left", [
                            node("c1", "P x ==> P x", "ax"),
                          ]),
                        ]),
                        node("c4", "∀ z P z , Q z ==> Q z", "weak_left", [
                          node("c4a", "Q z ==> Q z", "ax"),
                        ]),
                      ]),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ]),
  },
  {
    name: "imp_self (imp_right)",
    theoremDecl: "theorem imp_self {x: obj}: $ emp ==> (P x → P x) $;",
    goalName: "imp_self",
    tree: node("n2", "_ ==> (P x → P x)", "imp_right", [
      node("n1", "P x ==> P x", "ax"),
    ]),
  },
];
