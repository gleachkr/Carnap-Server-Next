import { describe, expect, test } from "bun:test";
import { markText } from "../src/worker/exercises/truth-tree/labels";
import type {
  RowMark,
  TreeReport,
} from "../src/worker/exercises/truth-tree/report";
import { theorySourceByFileName } from "../src/worker/logic/theories";
import {
  certifyAnswer,
  judgeAsBrowser,
  lessonTree,
  problems,
  section,
  TreeBuilder,
  treeExercise,
} from "./helpers/truth-tree";

/**
 * The Open Logic Project's prefixed tableaux for intuitionistic logic
 * (`open-logic-intuitionistic.mm0`, `intuitionistic-logic/tableaux`): `→𝕋`
 * and `¬𝕋` go to any used prefix that extends their row's, `σ` itself among
 * them, which is `σ . ρ` with prefixes a list and `ρ` possibly empty; and a
 * branch closes on `σ 𝕋 A` with `σ . ρ 𝔽 A`, not the other way round.
 */

function exercise(root: readonly string[], finish = "closed") {
  return treeExercise(root, { finish, system: "open-logic-intuitionistic" });
}

async function judge(
  root: readonly string[],
  tree: TreeBuilder,
): Promise<TreeReport> {
  return judgeAsBrowser(await exercise(root), tree);
}

describe("open-logic-intuitionistic", () => {
  // The header says so: a change to K's prefix table, rows, tree system or
  // rules for ∧ and ∨ is a change to this file too. The prefixes themselves
  // are lists here, and are not K's.
  test("shares K's prefix table, rows, tree system and ∧ ∨ rules word for word", () => {
    // Each part: where it starts, and where it ends here and in K.
    const shared: readonly [string, string, string][] = [
      [
        "--| @syntax delimiter $ T: F: 𝕋 𝔽 $",
        "--| @syntax role falsum",
        "--| @syntax role biconditional",
      ],
      ["--| @syntax role falsum", "-- ## Prefixes", "--| @syntax role verum"],
      [
        "-- ## Prefixed signed formulas\n--\n-- The sign",
        "-- ## Prefixes as lists",
        "-- ## Closure",
      ],
      [
        "--| @syntax alias ∧𝕋",
        "\n-- ## Negation and the conditional",
        "axiom tb_t_imp_l",
      ],
    ];

    for (const [start, end, endInK] of shared) {
      expect(section("open-logic-intuitionistic.mm0", start, end)).toBe(
        section("open-logic-modal-k.mm0", start, endInK),
      );
    }
  });

  // A step `1` deep in a prefix once read as the root's first world, so
  // `1.1.1.1` shared its last step with `1.1` and was never new.
  test("→𝔽 three times reaches a new prefix each time", async () => {
    const tree = new TreeBuilder(["1 F: B → (C → (D → (E → E)))"]);
    const [, one] = tree.stack(
      "n0",
      "r1",
      ["1.1 T: B", "1.1 F: C → (D → (E → E))"],
      "->F",
    );
    const [, two] = tree.stack(
      "n0",
      one as string,
      ["1.1.1 T: C", "1.1.1 F: D → (E → E)"],
      "->F",
    );
    tree.stack(
      "n0",
      two as string,
      ["1.1.1.1 T: D", "1.1.1.1 F: E → E"],
      "->F",
    );

    expect(
      problems(await judge(["1 𝔽 B → (C → (D → (E → E)))"], tree)),
    ).toEqual([]);
  }, 60_000);

  test("root rows are read with their prefix and sign", async () => {
    const { resolved } = await exercise(["1 𝕋 A → B", "1 𝔽 ¬A ∨ B"]);

    expect(resolved.root).toEqual(["((1) 𝕋 (A → B))", "((1) 𝔽 ((¬ A) ∨ B))"]);
  });

  // proofs.tex, its one worked tableau, with the book's citations of row 4
  // for ∧𝔽 read as row 7, the row it develops (an erratum).
  test("the book's tableau for (A ∧ B) → C ⊢ A → (B → C)", async () => {
    const tree = new TreeBuilder(["1 T: (A ∧ B) → C", "1 F: A → (B → C)"]);
    const [a, bc] = tree.stack(
      "n0",
      "r2",
      ["1.1 T: A", "1.1 F: B → C"],
      "→F",
    );
    const [b, c] = tree.stack(
      "n0",
      bc as string,
      ["1.1.1 T: B", "1.1.1 F: C"],
      "→F",
    );
    const imp = tree.split(
      "n0",
      "r1",
      [["1.1.1 F: A ∧ B"], ["1.1.1 T: C"]],
      "→T",
    );
    const and = tree.split(
      imp.nodes[0],
      imp.rows[0][0] as string,
      [["1.1.1 F: A"], ["1.1.1 F: B"]],
      "∧F",
    );
    // 𝕋 A at 1.1 and 𝔽 A at 1.1.1, which extends it.
    tree.close(and.nodes[0], a as string, and.rows[0][0] as string);
    tree.close(and.nodes[1], b as string, and.rows[1][0] as string);
    tree.close(imp.nodes[1], imp.rows[1][0] as string, c as string);
    const report = await judge(["1 𝕋 (A ∧ B) → C", "1 𝔽 A → (B → C)"], tree);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);

  // proofs.tex, the problems after it.
  test("⊢ A → (B → A): 𝕋 at 1.1 closes with 𝔽 at 1.1.1", async () => {
    const tree = new TreeBuilder(["1 F: A → (B → A)"]);
    const [a, ba] = tree.stack(
      "n0",
      "r1",
      ["1.1 T: A", "1.1 F: B → A"],
      "->F",
    );
    const [, fa] = tree.stack(
      "n0",
      ba as string,
      ["1.1.1 T: B", "1.1.1 F: A"],
      "->F",
    );
    tree.close("n0", a as string, fa as string);
    const report = await judge(["1 𝔽 A → (B → A)"], tree);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);

  test("⊢ ¬(A ∧ ¬A): ¬𝕋 at its own prefix", async () => {
    const tree = new TreeBuilder(["1 F: ¬(A ∧ ¬A)"]);
    const [and] = tree.stack("n0", "r1", ["1.1 T: A ∧ ¬A"], "¬F");
    const [a, na] = tree.stack(
      "n0",
      and as string,
      ["1.1 T: A", "1.1 T: ¬A"],
      "∧T",
    );
    const [fa] = tree.stack("n0", na as string, ["1.1 F: A"], "¬T");
    tree.close("n0", a as string, fa as string);
    const report = await judge(["1 𝔽 ¬(A ∧ ¬A)"], tree);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);

  test("¬A ∨ ¬B ⊢ ¬(A ∧ B): ¬𝕋 at 1 goes to 1.1", async () => {
    const tree = new TreeBuilder(["1 T: ¬A ∨ ¬B", "1 F: ¬(A ∧ B)"]);
    const [and] = tree.stack("n0", "r2", ["1.1 T: A ∧ B"], "¬F");
    const [a, b] = tree.stack(
      "n0",
      and as string,
      ["1.1 T: A", "1.1 T: B"],
      "∧T",
    );
    const or = tree.split("n0", "r1", [["1 T: ¬A"], ["1 T: ¬B"]], "∨T");
    const [fa] = tree.stack(
      or.nodes[0],
      or.rows[0][0] as string,
      ["1.1 F: A"],
      "¬T",
    );
    const [fb] = tree.stack(
      or.nodes[1],
      or.rows[1][0] as string,
      ["1.1 F: B"],
      "¬T",
    );
    tree.close(or.nodes[0], a as string, fa as string);
    tree.close(or.nodes[1], b as string, fb as string);
    const report = await judge(["1 𝕋 ¬A ∨ ¬B", "1 𝔽 ¬(A ∧ B)"], tree);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);

  test("A → (B → C) ⊢ (A ∧ B) → C: →𝕋 at 1 to 1.1, either way round", async () => {
    const tree = new TreeBuilder(["1 T: A → (B → C)", "1 F: (A ∧ B) → C"]);
    const [and, c] = tree.stack(
      "n0",
      "r2",
      ["1.1 T: A ∧ B", "1.1 F: C"],
      "→F",
    );
    const [a, b] = tree.stack(
      "n0",
      and as string,
      ["1.1 T: A", "1.1 T: B"],
      "∧T",
    );
    // The 𝕋 branch first, this time.
    const outer = tree.split(
      "n0",
      "r1",
      [["1.1 T: B → C"], ["1.1 F: A"]],
      "→T",
    );
    tree.close(outer.nodes[1], a as string, outer.rows[1][0] as string);
    const inner = tree.split(
      outer.nodes[0],
      outer.rows[0][0] as string,
      [["1.1 F: B"], ["1.1 T: C"]],
      "→T",
    );
    tree.close(inner.nodes[0], b as string, inner.rows[0][0] as string);
    tree.close(inner.nodes[1], inner.rows[1][0] as string, c as string);
    const report = await judge(["1 𝕋 A → (B → C)", "1 𝔽 (A ∧ B) → C"], tree);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);

  test("⊥ ⊢ A: 𝕋 ⊥ closes a branch alone", async () => {
    const tree = new TreeBuilder(["1 T: ⊥", "1 F: A"]);
    tree.close("n0", "r1");
    const report = await judge(["1 𝕋 ⊥", "1 𝔽 A"], tree);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);
});

describe("what intuitionistic logic does not prove", () => {
  // The excluded middle closes classically, on 𝔽 A at 1 and 𝕋 A at 1.1,
  // which is the other way round.
  test("⊢ A ∨ ¬A: 𝔽 at 1 and 𝕋 at 1.1 do not close", async () => {
    const tree = new TreeBuilder(["1 F: A ∨ ¬A"]);
    const [fa, fna] = tree.stack("n0", "r1", ["1 F: A", "1 F: ¬A"], "∨F");
    const [ta] = tree.stack("n0", fna as string, ["1.1 T: A"], "¬F");
    tree.close("n0", fa as string, ta as string);
    const report = await judge(["1 𝔽 A ∨ ¬A"], tree);

    expect(problems(report)).toEqual(["end n0: closure-wrong"]);
    expect(report.closed).toBe(false);
  }, 60_000);

  test("→𝕋 goes neither to a prefix σ does not reach nor back to 1", async () => {
    const tree = new TreeBuilder(["1 T: ¬(D → E)", "1 F: (A → B) → C"]);
    const [imp] = tree.stack("n0", "r2", ["1.1 T: A → B", "1.1 F: C"], "→F");
    const [de] = tree.stack("n0", "r1", ["1 F: D → E"], "¬T");
    tree.stack("n0", de as string, ["1.2 T: D", "1.2 F: E"], "→F");
    const sibling = tree.split(
      "n0",
      imp as string,
      [["1.2 F: A"], ["1.2 T: B"]],
      "→T",
    );
    const back = tree.split(
      sibling.nodes[0],
      imp as string,
      [["1 F: A"], ["1 T: B"]],
      "→T",
    );
    const report = await judge(["1 𝕋 ¬(D → E)", "1 𝔽 (A → B) → C"], tree);

    expect(problems(report)).toContain(
      `row ${sibling.rows[0][0]}: step-wrong`,
    );
    expect(problems(report)).toContain(`row ${back.rows[0][0]}: step-wrong`);
  }, 60_000);

  test("→𝕋 to an extension not yet on the branch is refused", async () => {
    const tree = new TreeBuilder(["1 T: A → B", "1 F: B"]);
    const imp = tree.split("n0", "r1", [["1.1 F: A"], ["1.1 T: B"]], "→T");
    const report = await judge(["1 𝕋 A → B", "1 𝔽 B"], tree);

    expect(problems(report)).toContain(`row ${imp.rows[0][0]}: step-wrong`);
  }, 60_000);

  test("→𝔽 to a prefix already used is refused", async () => {
    const tree = new TreeBuilder(["1 T: ¬(C → D)", "1 F: A → B"]);
    tree.stack("n0", "r2", ["1.1 T: A", "1.1 F: B"], "→F");
    const [cd] = tree.stack("n0", "r1", ["1 F: C → D"], "¬T");
    const [again] = tree.stack(
      "n0",
      cd as string,
      ["1.1 T: C", "1.1 F: D"],
      "→F",
    );
    const report = await judge(["1 𝕋 ¬(C → D)", "1 𝔽 A → B"], tree);

    expect(problems(report)).toContain(`row ${again}: step-wrong`);
  }, 60_000);
});

/** A tree certified and judged, with `build`'s open leaf left open. */
async function certified(
  root: readonly string[],
  build: (tree: TreeBuilder) => string,
) {
  const asked = await exercise(root, "one-open");
  const tree = new TreeBuilder(asked.resolved.rootText);
  const open = build(tree);
  tree.open(open);
  const answer = await certifyAnswer(asked.publicData, tree.answer());

  return {
    certified: answer.mmb !== undefined,
    open,
    report: await judgeAsBrowser(asked, tree),
    resolved: asked.resolved,
  };
}

/**
 * `A → B ⊢ C → D` up to `→𝕋` at 1.1, and if `both`, at 1 as well, below its
 * 𝔽 branch.
 */
function countermodel(both: boolean) {
  return certified(["1 𝕋 A → B", "1 𝔽 C → D"], (tree) => {
    tree.stack(tree.rootNode, "r2", ["1.1 T: C", "1.1 F: D"], "→F");
    const there = tree.split(
      tree.rootNode,
      "r1",
      [["1.1 F: A"], ["1.1 T: B"]],
      "→T",
    );

    return both
      ? tree.split(there.nodes[0], "r1", [["1 F: A"], ["1 T: B"]], "→T")
          .nodes[0]
      : there.nodes[0];
  });
}

describe("an open branch in intuitionistic logic", () => {
  test("is complete with →𝕋 at every prefix that extends its row's", async () => {
    const { certified, open, report, resolved } = await countermodel(true);

    expect(report.ends.get(open)).toBeUndefined();
    expect(certified).toBe(true);
    expect(
      markText(report.marks.get("r1") as RowMark, resolved.language),
    ).toBe("\\1.1,1");
  }, 60_000);

  test("is incomplete while →𝕋 skips its own prefix", async () => {
    const { certified, open, report } = await countermodel(false);

    expect(report.ends.get(open)).toEqual({
      missing: [{ names: ["1"], row: "r1" }],
      type: "open-incomplete",
    });
    expect(certified).toBe(false);
  }, 60_000);

  test("owes →𝕋 nothing at a prefix its row's extends", async () => {
    let imp = "";
    const { open, report, resolved } = await certified(
      ["1 𝔽 (A → B) → C"],
      (tree) => {
        imp = tree.stack(
          tree.rootNode,
          "r1",
          ["1.1 T: A → B", "1.1 F: C"],
          "→F",
        )[0] as string;

        return tree.split(
          tree.rootNode,
          imp,
          [["1.1 F: A"], ["1.1 T: B"]],
          "→T",
        ).nodes[0];
      },
    );

    expect(report.ends.get(open)).toBeUndefined();
    expect(
      markText(report.marks.get(imp) as RowMark, resolved.language),
    ).toBe("\\1.1");
  }, 60_000);

  // 1.1.1 is `(1 . wa) . waa`, which `σ . ρ` with σ = 1 matches only as a
  // list.
  test("owes →𝕋 at every prefix that extends its row's, however deep", async () => {
    const { open, report } = await certified(
      ["1 𝕋 A → B", "1 𝔽 C → (D → E)"],
      (tree) => {
        const [, de] = tree.stack(
          tree.rootNode,
          "r2",
          ["1.1 T: C", "1.1 F: D → E"],
          "→F",
        );
        tree.stack(
          tree.rootNode,
          de as string,
          ["1.1.1 T: D", "1.1.1 F: E"],
          "→F",
        );

        return tree.split(
          tree.rootNode,
          "r1",
          [["1.1.1 F: A"], ["1.1.1 T: B"]],
          "→T",
        ).nodes[0];
      },
    );

    expect(report.ends.get(open)).toEqual({
      missing: [{ names: ["1", "((1) . wa)"], row: "r1" }],
      type: "open-incomplete",
    });
  }, 60_000);

  // `σ . ρ` against `1 . wa` is tried with σ empty first; with the 𝔽 row
  // matched first, the 𝕋 row then needs σ to be `1`, and has it.
  test("closes with the closure's rows written the other way round", async () => {
    const source = (
      theorySourceByFileName("open-logic-intuitionistic.mm0") ?? ""
    ).replace(
      "$ focus ga at (si 𝕋 ph ; si . rh 𝔽 ph) $",
      "$ focus ga at (si . rh 𝔽 ph ; si 𝕋 ph) $",
    );
    expect(source).toContain("(si . rh 𝔽 ph ; si 𝕋 ph)");
    const swapped = await lessonTree(
      `:::aufbau-mm0{name="swapped"}\n${source}\n:::\n\n::::truth-tree{#t system="swapped" finish="one-open"}\nShow it.\n\n- 1 𝕋 A\n- 1 𝔽 B → A\n::::`,
    );
    const tree = new TreeBuilder(swapped.resolved.rootText);
    const [, fa] = tree.stack(
      tree.rootNode,
      "r2",
      ["1.1 T: B", "1.1 F: A"],
      "→F",
    );
    tree.open(tree.rootNode);
    const report = await judgeAsBrowser(swapped, tree);

    expect(report.ends.get(tree.rootNode)).toEqual({
      rows: ["r1", fa as string],
      type: "open-contradiction",
    });
  }, 60_000);

  // The excluded middle's branch: 𝔽 A at 1 and 𝕋 A at 1.1 do not close it,
  // so it is a countermodel, A true at 1.1 and not at 1.
  test("with 𝔽 A at 1 and 𝕋 A at 1.1 is not closable", async () => {
    const { open, report } = await certified(["1 𝔽 A ∨ ¬A"], (tree) => {
      const [, fna] = tree.stack(
        tree.rootNode,
        "r1",
        ["1 F: A", "1 F: ¬A"],
        "∨F",
      );
      tree.stack(tree.rootNode, fna as string, ["1.1 T: A"], "¬F");
      return tree.rootNode;
    });

    expect(report.ends.get(open)).toBeUndefined();
  }, 60_000);
});
