/**
 * Worked Prawitz-tree proofs over the forallx: Calgary theory — one per
 * discharge-bearing rule family, plus the structural corner cases the Stage 0
 * spike established (same label on several leaf occurrences, the same formula
 * assumed under two labels, eigenvariable rules riding through the
 * theory-agnostic translator). Shared by the translation test suite (which pins
 * the emitted `.auf`) and `scripts/prawitz-verify.ts` (which compiles + verifies
 * each against the real engine).
 */

import type { PrawitzProofNode } from "../../src/worker/exercises/aufbau-proof-prawitz/types";

export interface PrawitzCase {
  /** Human label naming the rules the case exercises. */
  readonly name: string;
  /** The frozen goal declaration appended to the theory. */
  readonly theoremDecl: string;
  readonly goalName: string;
  readonly root: PrawitzProofNode;
}

let uid = 0;

function node(
  input: Omit<PrawitzProofNode, "id" | "premises"> & {
    premises?: readonly PrawitzProofNode[];
  },
): PrawitzProofNode {
  uid += 1;
  return { id: `c${uid}`, premises: [], ...input };
}

const leaf = (formula: string, label?: string): PrawitzProofNode =>
  node({ formula, rule: "ax", ...(label === undefined ? {} : { label }) });

export const PRAWITZ_CASES: readonly PrawitzCase[] = [
  {
    name: "self (→I, one discharge)",
    theoremDecl: "theorem self (a: wff): $ _ ⊢ a → a $;",
    goalName: "self",
    root: node({
      formula: "a → a",
      rule: "imp_intro",
      discharge: ["1"],
      premises: [leaf("a", "1")],
    }),
  },
  {
    name: "mp (→E, two undischarged leaves)",
    theoremDecl: "theorem mp (a b: wff): $ (a → b) , a ⊢ b $;",
    goalName: "mp",
    root: node({
      formula: "b",
      rule: "imp_elim",
      premises: [leaf("a → b"), leaf("a")],
    }),
  },
  {
    name: "kcomb (→I; the unused assumption enters via ∧I/∧E)",
    theoremDecl: "theorem kcomb (a b: wff): $ a ⊢ b → a $;",
    goalName: "kcomb",
    root: node({
      formula: "b → a",
      rule: "imp_intro",
      discharge: ["1"],
      premises: [
        node({
          formula: "a",
          rule: "and_elim_r",
          premises: [
            node({
              formula: "b ∧ a",
              rule: "and_intro",
              premises: [leaf("b", "1"), leaf("a")],
            }),
          ],
        }),
      ],
    }),
  },
  {
    name: "orcomm (∨E, two discharge branches)",
    theoremDecl: "theorem orcomm (a b: wff): $ a ∨ b ⊢ b ∨ a $;",
    goalName: "orcomm",
    root: node({
      formula: "b ∨ a",
      rule: "or_elim",
      discharge: ["1", "2"],
      premises: [
        leaf("a ∨ b"),
        node({
          formula: "b ∨ a",
          rule: "or_intro_r",
          premises: [leaf("a", "1")],
        }),
        node({
          formula: "b ∨ a",
          rule: "or_intro_l",
          premises: [leaf("b", "2")],
        }),
      ],
    }),
  },
  {
    name: "dni (¬I)",
    theoremDecl: "theorem dni (a: wff): $ a ⊢ ¬ ¬ a $;",
    goalName: "dni",
    root: node({
      formula: "¬ ¬ a",
      rule: "neg_intro",
      discharge: ["1"],
      premises: [
        node({
          formula: "⊥",
          rule: "neg_elim",
          premises: [leaf("a"), leaf("¬ a", "1")],
        }),
      ],
    }),
  },
  {
    name: "dne (IP)",
    theoremDecl: "theorem dne (a: wff): $ ¬ ¬ a ⊢ a $;",
    goalName: "dne",
    root: node({
      formula: "a",
      rule: "ip",
      discharge: ["1"],
      premises: [
        node({
          formula: "⊥",
          rule: "neg_elim",
          premises: [leaf("¬ a", "1"), leaf("¬ ¬ a")],
        }),
      ],
    }),
  },
  {
    name: "andcommbicon (↔I; one label on two leaf occurrences)",
    theoremDecl:
      "theorem andcommbicon (a b: wff): $ _ ⊢ (a ∧ b) ↔ (b ∧ a) $;",
    goalName: "andcommbicon",
    root: node({
      formula: "(a ∧ b) ↔ (b ∧ a)",
      rule: "iff_intro",
      discharge: ["1", "2"],
      premises: [
        node({
          formula: "b ∧ a",
          rule: "and_intro",
          premises: [
            node({
              formula: "b",
              rule: "and_elim_r",
              premises: [leaf("a ∧ b", "1")],
            }),
            node({
              formula: "a",
              rule: "and_elim_l",
              premises: [leaf("a ∧ b", "1")],
            }),
          ],
        }),
        node({
          formula: "a ∧ b",
          rule: "and_intro",
          premises: [
            node({
              formula: "a",
              rule: "and_elim_r",
              premises: [leaf("b ∧ a", "2")],
            }),
            node({
              formula: "b",
              rule: "and_elim_l",
              premises: [leaf("b ∧ a", "2")],
            }),
          ],
        }),
      ],
    }),
  },
  {
    name: "twolabels (same formula under two labels; inner discharge)",
    theoremDecl: "theorem twolabels (a: wff): $ _ ⊢ a → (a → (a ∧ a)) $;",
    goalName: "twolabels",
    root: node({
      formula: "a → (a → (a ∧ a))",
      rule: "imp_intro",
      discharge: ["1"],
      premises: [
        node({
          formula: "a → (a ∧ a)",
          rule: "imp_intro",
          discharge: ["2"],
          premises: [
            node({
              formula: "a ∧ a",
              rule: "and_intro",
              premises: [leaf("a", "1"), leaf("a", "2")],
            }),
          ],
        }),
      ],
    }),
  },
  {
    name: "unidist (∀I eigenvariable, no discharge)",
    theoremDecl: "theorem unidist {x: tm}: $ ∀ x (F x ∧ G x) ⊢ ∀ x (F x) $;",
    goalName: "unidist",
    root: node({
      formula: "∀ x (F x)",
      rule: "all_intro",
      premises: [
        node({
          formula: "F x",
          rule: "and_elim_l",
          premises: [
            node({
              formula: "F x ∧ G x",
              rule: "all_elim",
              premises: [leaf("∀ x (F x ∧ G x)")],
            }),
          ],
        }),
      ],
    }),
  },
  {
    name: "exelim (∃E eigenvariable + discharge)",
    theoremDecl:
      "theorem exelim {x y: tm}: $ ∃ x (F x) , ∀ x (F x → G x) ⊢ ∃ x (G x) $;",
    goalName: "exelim",
    root: node({
      formula: "∃ x (G x)",
      rule: "ex_elim",
      discharge: ["1"],
      premises: [
        leaf("∃ x (F x)"),
        node({
          formula: "∃ x (G x)",
          rule: "ex_intro",
          premises: [
            node({
              formula: "G y",
              rule: "imp_elim",
              premises: [
                node({
                  formula: "F y → G y",
                  rule: "all_elim",
                  premises: [leaf("∀ x (F x → G x)")],
                }),
                leaf("F y", "1"),
              ],
            }),
          ],
        }),
      ],
    }),
  },
  {
    // The reason contexts are dependency sets and not ambient: G u mentions the
    // ∀I's eigenvariable but lives in the OTHER branch, so it must not enter
    // the ∀I line's context — an ambient translation imports it and spuriously
    // trips all_intro's "context may not depend on the eigenvariable" proviso.
    name: "eigenpollute (∀I beside a premise naming its eigenvariable)",
    theoremDecl:
      "theorem eigenpollute {x u: tm}: $ ∀ x (F x) , G u ⊢ (∀ x (F x)) ∧ G u $;",
    goalName: "eigenpollute",
    root: node({
      formula: "(∀ x (F x)) ∧ G u",
      rule: "and_intro",
      premises: [
        node({
          formula: "∀ x (F x)",
          rule: "all_intro",
          premises: [
            node({
              formula: "F u",
              rule: "all_elim",
              premises: [leaf("∀ x (F x)")],
            }),
          ],
        }),
        leaf("G u"),
      ],
    }),
  },
];
