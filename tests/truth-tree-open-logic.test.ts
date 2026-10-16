import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../src/worker/domain/content";
import { withSystemText } from "../src/worker/exercise-kit/systems/join";
import type { ResolvedTree } from "../src/worker/exercises/truth-tree/grading";
import { resolveTruthTree } from "../src/worker/exercises/truth-tree/grading";
import type { TreeReport } from "../src/worker/exercises/truth-tree/report";
import type { TruthTreePublicData } from "../src/worker/exercises/truth-tree/types";
import { engine, judgeAsBrowser, TreeBuilder } from "./helpers/truth-tree";

/**
 * The Open Logic Project's first-order signed tableaux
 * (`open-logic-tableaux.mm0`), through the truth-tree exercise as the
 * browser judges it: rows are signed formulas, typed `T:`/`F:` or `𝕋`/`𝔽`,
 * and margins name the book's rules (`∧𝕋`, typed `∧T` or `&T`).
 */

async function exercise(
  root: string,
  finish = "closed",
): Promise<{ resolved: ResolvedTree; mm0: string }> {
  const result = await compileCarnapMarkdown(
    `::::truth-tree{#t system="open-logic-tableaux" finish="${finish}"}\nShow it.\n\n${root}\n::::`,
  );

  if (!result.ok) {
    throw new Error(result.diagnostics.map((d) => d.code).join(", "));
  }

  const raw = result.artifact.manifest[0] as ExerciseManifestItem;
  const publicData = withSystemText(
    raw.publicData,
    result.artifact.systems,
  ) as unknown as TruthTreePublicData;
  const resolved = resolveTruthTree(publicData);

  if (resolved === null || publicData.mm0 === undefined) {
    throw new Error("the exercise does not resolve");
  }

  return { mm0: publicData.mm0, resolved };
}

async function judge(root: string, tree: TreeBuilder): Promise<TreeReport> {
  const { mm0, resolved } = await exercise(root);
  return judgeAsBrowser(await engine(), resolved, mm0, tree.answer());
}

/** Each problem as `row|end id: type`, in tree order. */
function problems(report: TreeReport): string[] {
  return report.problems.map(({ at }) =>
    at.type === "tree"
      ? `tree: ${at.problem.type}`
      : `${at.type} ${at.id}: ${at.problem.type}`,
  );
}

describe("open-logic-tableaux", () => {
  test("an argument's root asserts the premises and denies the conclusion", async () => {
    const { resolved } = await exercise("A ∧ B :|-: A");

    expect(resolved.root).toEqual([
      "(𝕋 ((A (snil)) ∧ (B (snil))))",
      "(𝔽 (A (snil)))",
    ]);
  });

  test("a closed tableau, rows and rules in either spelling", async () => {
    const tree = new TreeBuilder(["F: (A ∧ B) → A"]);
    const [t, f] = tree.stack("n0", "r1", ["𝕋 A ∧ B", "𝔽 A"], "→𝔽");
    const [a] = tree.stack("n0", t as string, ["T: A", "T: B"], "&T");
    tree.close("n0", a as string, f as string);
    const report = await judge(":|-: (A ∧ B) → A", tree);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);

  test("a rule that splits may write its branches in either order", async () => {
    const tree = new TreeBuilder(["T: A ∨ B", "F: B ∨ A"]);
    const [fb, fa] = tree.stack("n0", "r2", ["F: B", "F: A"], "∨F");
    const { nodes, rows } = tree.split(
      "n0",
      "r1",
      [["T: B"], ["T: A"]],
      "∨T",
    );
    tree.close(nodes[0], rows[0][0] as string, fb as string);
    tree.close(nodes[1], rows[1][0] as string, fa as string);
    const report = await judge("A ∨ B :|-: B ∨ A", tree);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);

  test("a rule for the other sign is refused", async () => {
    const tree = new TreeBuilder(["F: A ∧ B"]);
    const [row] = tree.stack("n0", "r1", ["F: A", "F: B"], "∧T");
    const report = await judge(":|-: A ∧ B", tree);

    expect(problems(report)).toContain(`row ${row}: step-wrong`);
  }, 60_000);

  test("a rule's conclusions are written as it writes them, even one already on the branch", async () => {
    const tree = new TreeBuilder(["T: A ∧ B", "T: B", "F: A"]);
    const [first, second] = tree.stack("n0", "r1", ["T: A", "T: A"], "∧T");
    tree.close("n0", first as string, "r3");
    const report = await judge("A ∧ B, B :|-: A", tree);

    expect(problems(report)).toContain(`row ${second}: step-wrong`);

    const right = new TreeBuilder(["T: A ∧ B", "T: B", "F: A"]);
    const [a] = right.stack("n0", "r1", ["T: A", "T: B"], "∧T");
    right.close("n0", a as string, "r3");

    expect(problems(await judge("A ∧ B, B :|-: A", right))).toEqual([]);
  }, 60_000);

  test("a branch closes on one formula with both signs, not one sign twice", async () => {
    const tree = new TreeBuilder(["T: A", "T: ¬A"]);
    const [f] = tree.stack("n0", "r2", ["F: A"], "¬T");
    tree.close("n0", "r1", f as string);
    expect(problems(await judge("- A\n- ¬A", tree))).toEqual([]);

    const wrong = new TreeBuilder(["T: A", "T: ¬A"]);
    wrong.close("n0", "r1", "r1");
    expect(problems(await judge("- A\n- ¬A", wrong))).toContain(
      "end n0: closure-wrong",
    );
  }, 60_000);

  // proving-things-quant.tex, the last stage of its fifteenth tableau.
  test("the book's tableau for ∀xA(x), ∀xA(x) → ∃yB(y), ¬∃yB(y)", async () => {
    const tree = new TreeBuilder([
      "𝕋 ∀x A(x)",
      "𝕋 ∀x A(x) → ∃y B(y)",
      "𝕋 ¬∃y B(y)",
    ]);
    const [four] = tree.stack("n0", "r3", ["𝔽 ∃y B(y)"], "¬𝕋");
    const { nodes, rows } = tree.split(
      "n0",
      "r2",
      [["𝔽 ∀x A(x)"], ["𝕋 ∃y B(y)"]],
      "→𝕋",
    );
    const [left, right] = nodes;
    const [fb] = tree.stack(left, rows[0][0] as string, ["𝔽 A(b)"], "∀𝔽");
    const [tb] = tree.stack(left, "r1", ["𝕋 A(b)"], "∀𝕋");
    tree.close(left, tb as string, fb as string);
    const [tc] = tree.stack(right, rows[1][0] as string, ["𝕋 B(c)"], "∃𝕋");
    const [fc] = tree.stack(right, four as string, ["𝔽 B(c)"], "∃𝔽");
    tree.close(right, tc as string, fc as string);
    const report = await judge(
      "- ∀x A(x)\n- ∀x A(x) → ∃y B(y)\n- ¬∃y B(y)",
      tree,
    );

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);

  test("a new constant must be new to the branch", async () => {
    const tree = new TreeBuilder(["T: A(a)", "F: ∀x A(x)"]);
    const [row] = tree.stack("n0", "r2", ["F: A(a)"], "∀F");
    tree.close("n0", "r1", row as string);
    const report = await judge("A(a) :|-: ∀x A(x)", tree);

    expect(problems(report)).toContain(`row ${row}: step-wrong`);
    expect(report.closed).toBe(false);
  }, 60_000);

  test("Cut cites no row, and splits a branch on any formula", async () => {
    const tree = new TreeBuilder(["T: A → B", "T: ¬A → B", "F: B"]);
    const cut = tree.split("n0", null, [["T: A"], ["F: A"]], "Cut");
    const [yes, no] = cut.nodes;
    const left = tree.split(yes, "r1", [["F: A"], ["T: B"]], "→T");
    tree.close(
      left.nodes[0],
      cut.rows[0][0] as string,
      left.rows[0][0] as string,
    );
    tree.close(left.nodes[1], left.rows[1][0] as string, "r3");
    const right = tree.split(no, "r2", [["F: ¬A"], ["T: B"]], "→T");
    const [a] = tree.stack(
      right.nodes[0],
      right.rows[0][0] as string,
      ["T: A"],
      "¬F",
    );
    tree.close(right.nodes[0], a as string, cut.rows[1][0] as string);
    tree.close(right.nodes[1], right.rows[1][0] as string, "r3");
    const report = await judge("A → B, ¬A → B :|-: B", tree);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);

  test("a rule that cites a row, left uncited, is unfinished", async () => {
    const tree = new TreeBuilder(["T: A ∧ B", "F: A"]);
    const [row] = tree.stack("n0", null, ["T: A", "T: B"], "∧T");
    tree.close("n0", row as string, "r2");
    const report = await judge("A ∧ B :|-: A", tree);

    expect(problems(report)).toContain(`row ${row}: uncited`);
  }, 60_000);

  // identity.tex: Leibniz's law, symmetry, and transitivity.
  test("=𝕋 rewrites t₁ as t₂ in a row, from an identity", async () => {
    const tree = new TreeBuilder(["T: s = t", "T: A(s)", "F: A(t)"]);
    const [row] = tree.stack("n0", ["r1", "r2"], ["T: A(t)"], "=T");
    tree.close("n0", row as string, "r3");
    const report = await judge("s = t, A(s) :|-: A(t)", tree);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);

  test("= writes t = t citing nothing, and =𝕋 rewrites some occurrences", async () => {
    const tree = new TreeBuilder(["T: s₁ = s₂", "F: s₂ = s₁"]);
    const [refl] = tree.stack("n0", null, ["T: s₁ = s₁"], "=");
    const [row] = tree.stack(
      "n0",
      ["r1", refl as string],
      ["T: s₂ = s₁"],
      "=T",
    );
    tree.close("n0", row as string, "r2");
    const report = await judge("s₁ = s₂ :|-: s₂ = s₁", tree);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);

  test("=𝕋 rewrites one way only", async () => {
    const tree = new TreeBuilder(["T: s = t", "T: A(t)", "F: A(s)"]);
    const [row] = tree.stack("n0", ["r1", "r2"], ["T: A(s)"], "=T");
    const report = await judge("s = t, A(t) :|-: A(s)", tree);

    expect(problems(report)).toContain(`row ${row}: step-wrong`);
  }, 60_000);
});

// The chapter defines no complete open branch; the theory judges one by its
// contents, as the modal chapters do, and sees a quantifier rule's instance
// through the substitution it is written by (`tree.substitution`).
describe("an open branch, by its contents", () => {
  async function open(...members: string[]): Promise<TreeReport> {
    const { mm0, resolved } = await exercise(
      members.map((each) => `- ${each}`).join("\n"),
      "one-open",
    );
    const tree = new TreeBuilder(resolved.rootText);
    tree.open(tree.rootNode);

    return judgeAsBrowser(await engine(), resolved, mm0, tree.answer());
  }

  test("owes a ∀𝕋 instance not on it", async () => {
    const report = await open("∀x A(x)", "B(a)");

    expect(report.ends.get("n0")).toEqual({
      missing: [{ names: ["a"], row: "r1" }],
      type: "open-incomplete",
    });
  }, 60_000);

  test("owes none already on it, however it got there", async () => {
    const report = await open("∀x A(x)", "A(a)");

    expect(problems(report)).toEqual([]);
    expect(report.ends.get("n0")).toBeUndefined();
  }, 60_000);
});
