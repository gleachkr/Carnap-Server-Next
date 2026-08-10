import { describe, expect, test } from "bun:test";

import { prawitzToAuf } from "../src/worker/exercises/aufbau-proof-prawitz/translate";
import type { PrawitzProofNode } from "../src/worker/exercises/aufbau-proof-prawitz/types";
import { PRAWITZ_CASES } from "./helpers/prawitz-cases";

/**
 * The crux of the Prawitz type: discharge labels → dependency sequent contexts
 * (each line's context is exactly the undischarged assumptions above it, never
 * anything from a sibling branch — a side-branch import would spuriously trip
 * eigenvariable side conditions). Each `.auf` pinned here is one the real
 * `@aufbau` compiler + verifier accepts against the forallx theory (re-checked
 * on demand by `scripts/prawitz-verify.ts`), so these assertions pin the
 * translator to output the engine actually verifies.
 */

let uid = 0;

function node(
  input: Omit<PrawitzProofNode, "id" | "premises"> & {
    premises?: readonly PrawitzProofNode[];
  },
): PrawitzProofNode {
  uid += 1;
  return { id: `n${uid}`, premises: [], ...input };
}

const leaf = (formula: string, label?: string): PrawitzProofNode =>
  node({ formula, rule: "ax", ...(label === undefined ? {} : { label }) });

function caseByName(name: string) {
  const found = PRAWITZ_CASES.find((entry) => entry.name.startsWith(name));
  if (found === undefined) {
    throw new Error(`no prawitz case '${name}'`);
  }
  return found;
}

function translate(name: string): string {
  const c = caseByName(name);
  const result = prawitzToAuf(c.root, c.goalName, "ax", "⊢");
  expect(result.diagnostics).toEqual([]);
  return result.proofText;
}

describe("prawitzToAuf — engine-verified shapes", () => {
  test("single-assumption discharge collapses to the empty context `_`", () => {
    expect(translate("self")).toBe(
      [
        "self",
        "----",
        "l1: $ a ⊢ a $ by ax []",
        "l2: $ _ ⊢ a → a $ by imp_intro [l1]",
      ].join("\n"),
    );
  });

  test("each leaf depends only on itself; the rule line joins them", () => {
    expect(translate("mp")).toBe(
      [
        "mp",
        "----",
        "l1: $ a → b ⊢ a → b $ by ax []",
        "l2: $ a ⊢ a $ by ax []",
        "l3: $ a → b , a ⊢ b $ by imp_elim [l1, l2]",
      ].join("\n"),
    );
  });

  test("∨E: each branch's assumption is scoped to its own subtree and dropped at the discharge node", () => {
    expect(translate("orcomm")).toBe(
      [
        "orcomm",
        "----",
        "l1: $ a ∨ b ⊢ a ∨ b $ by ax []",
        "l2: $ a ⊢ a $ by ax []",
        "l3: $ a ⊢ b ∨ a $ by or_intro_r [l2]",
        "l4: $ b ⊢ b $ by ax []",
        "l5: $ b ⊢ b ∨ a $ by or_intro_l [l4]",
        "l6: $ a ∨ b ⊢ b ∨ a $ by or_elim [l1, l3, l5]",
      ].join("\n"),
    );
  });

  test("¬I: the labeled assumption joins at the rule line and is shed on discharge", () => {
    expect(translate("dni")).toBe(
      [
        "dni",
        "----",
        "l1: $ a ⊢ a $ by ax []",
        "l2: $ ¬ a ⊢ ¬ a $ by ax []",
        "l3: $ a , ¬ a ⊢ ⊥ $ by neg_elim [l1, l2]",
        "l4: $ a ⊢ ¬ ¬ a $ by neg_intro [l3]",
      ].join("\n"),
    );
  });

  test("the K combinator: an assumption used only to be conjoined away still discharges", () => {
    expect(translate("kcomb")).toBe(
      [
        "kcomb",
        "----",
        "l1: $ b ⊢ b $ by ax []",
        "l2: $ a ⊢ a $ by ax []",
        "l3: $ b , a ⊢ b ∧ a $ by and_intro [l1, l2]",
        "l4: $ b , a ⊢ a $ by and_elim_r [l3]",
        "l5: $ a ⊢ b → a $ by imp_intro [l4]",
      ].join("\n"),
    );
  });

  test("∃E: the eigenvariable branch carries the witness assumption; the root sheds it", () => {
    expect(translate("exelim")).toBe(
      [
        "exelim",
        "----",
        "l1: $ ∃ x (F x) ⊢ ∃ x (F x) $ by ax []",
        "l2: $ ∀ x (F x → G x) ⊢ ∀ x (F x → G x) $ by ax []",
        "l3: $ ∀ x (F x → G x) ⊢ F y → G y $ by all_elim [l2]",
        "l4: $ F y ⊢ F y $ by ax []",
        "l5: $ ∀ x (F x → G x) , F y ⊢ G y $ by imp_elim [l3, l4]",
        "l6: $ ∀ x (F x → G x) , F y ⊢ ∃ x (G x) $ by ex_intro [l5]",
        "l7: $ ∃ x (F x) , ∀ x (F x → G x) ⊢ ∃ x (G x) $ by ex_elim [l1, l6]",
      ].join("\n"),
    );
  });

  test("∀I: a side branch naming the eigenvariable stays out of the ∀I line's context", () => {
    expect(translate("eigenpollute")).toBe(
      [
        "eigenpollute",
        "----",
        "l1: $ ∀ x (F x) ⊢ ∀ x (F x) $ by ax []",
        "l2: $ ∀ x (F x) ⊢ F u $ by all_elim [l1]",
        "l3: $ ∀ x (F x) ⊢ ∀ x (F x) $ by all_intro [l2]",
        "l4: $ G u ⊢ G u $ by ax []",
        "l5: $ ∀ x (F x) , G u ⊢ (∀ x (F x)) ∧ G u $ by and_intro [l3, l4]",
      ].join("\n"),
    );
  });

  test("every worked case translates without structural diagnostics", () => {
    for (const c of PRAWITZ_CASES) {
      const result = prawitzToAuf(c.root, c.goalName, "ax", "⊢");
      expect(result.diagnostics).toEqual([]);
    }
  });
});

describe("prawitzToAuf — per-leaf context tracking", () => {
  test("discharging one label keeps a same-formula assumption under another label", () => {
    const c = caseByName("twolabels");
    const result = prawitzToAuf(c.root, c.goalName, "ax", "⊢");

    // The inner imp_intro discharged label 2, but label 1's `a` must survive:
    // ACUI idempotence collapses the printed duplicates, and only the outer
    // discharge empties the context.
    const inner = c.root.premises[0];
    expect(inner).toBeDefined();
    expect(result.contexts.get(inner?.id ?? "")).toEqual(["a"]);
    expect(result.contexts.get(c.root.id)).toEqual([]);
  });

  test("lineSpans slice proofText to exactly each node's line", () => {
    const c = caseByName("orcomm");
    const result = prawitzToAuf(c.root, c.goalName, "ax", "⊢");

    expect(result.lineSpans).toHaveLength(6);
    for (const span of result.lineSpans) {
      const line = result.proofText.slice(span.from, span.to);
      expect(line.startsWith("l")).toBe(true);
      expect(line.includes("\n")).toBe(false);
    }
    // The last span belongs to the root (postorder: parent after children).
    expect(result.lineSpans[result.lineSpans.length - 1]?.nodeId).toBe(
      c.root.id,
    );
  });
});

describe("prawitzToAuf — structural diagnostics", () => {
  test("a discharge mark no assumption answers to is reported", () => {
    const root = node({
      formula: "b → a",
      rule: "imp_intro",
      discharge: ["1"],
      premises: [leaf("a")],
    });
    const result = prawitzToAuf(root, "kcombv", "ax", "⊢");

    expect(result.diagnostics).toEqual([
      {
        code: "discharge_without_leaf",
        nodeId: root.id,
        params: { label: "1" },
      },
    ]);
    // Best-effort proofText is still produced for the compiler to weigh in on.
    expect(result.proofText).toContain("imp_intro");
  });

  test("an outer mark shadowed by an inner discharge of the same label is reported", () => {
    const inner = node({
      formula: "a → a",
      rule: "imp_intro",
      discharge: ["1"],
      premises: [leaf("a", "1")],
    });
    const outer = node({
      formula: "(a → a) ∧ (a → a)",
      rule: "and_intro",
      discharge: ["1"],
      premises: [inner, node({ formula: "a → a", rule: "reit" })],
    });
    const result = prawitzToAuf(outer, "shadowed", "ax", "⊢");

    expect(result.diagnostics).toEqual([
      {
        code: "discharge_without_leaf",
        nodeId: outer.id,
        params: { label: "1" },
      },
    ]);
  });

  test("one mark discharging assumptions of differing formulas is reported", () => {
    const root = node({
      formula: "⊥",
      rule: "neg_elim",
      discharge: ["1"],
      premises: [leaf("a", "1"), leaf("¬ a", "1")],
    });
    const result = prawitzToAuf(root, "mixed", "ax", "⊢");

    expect(result.diagnostics).toEqual([
      {
        code: "discharge_formula_mismatch",
        nodeId: root.id,
        params: { label: "1" },
      },
    ]);
  });

  test("an assumption with premises is reported", () => {
    const bad = node({
      formula: "a",
      rule: "ax",
      premises: [leaf("a")],
    });
    const result = prawitzToAuf(bad, "badleaf", "ax", "⊢");

    expect(result.diagnostics).toEqual([
      { code: "assumption_with_premises", nodeId: bad.id },
    ]);
  });
});
