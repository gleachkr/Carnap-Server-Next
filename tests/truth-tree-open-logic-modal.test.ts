import { describe, expect, test } from "bun:test";
import { displayRow } from "../src/worker/exercises/truth-tree/aufbau/rows";
import type { ResolvedTree } from "../src/worker/exercises/truth-tree/grading";
import { markText } from "../src/worker/exercises/truth-tree/labels";
import type {
  RowMark,
  TreeReport,
} from "../src/worker/exercises/truth-tree/report";
import {
  certifyAnswer,
  gradeAnswer,
  judgeAsBrowser,
  judgeAsServer,
  problems,
  TreeBuilder,
  treeExercise,
} from "./helpers/truth-tree";

/**
 * The Open Logic Project's prefixed tableaux for K
 * (`open-logic-modal-k.mm0`), through the truth-tree exercise as the browser
 * judges it: a row is a prefix and a signed formula, `1.1 𝕋 A`, typed
 * `1.1 T: A`, and margins name the book's rules (`□𝕋`, typed `[]T`).
 */

function exercise(root: string, finish = "closed") {
  return treeExercise(root, { finish, system: "open-logic-modal-k" });
}

async function judge(root: string, tree: TreeBuilder): Promise<TreeReport> {
  return judgeAsBrowser(await exercise(root), tree);
}

describe("open-logic-modal-k", () => {
  test("an argument's root is at prefix 1", async () => {
    const { resolved } = await exercise("□A :|-: ◇A");

    expect(resolved.root).toEqual(["((1) 𝕋 (□ A))", "((1) 𝔽 (◇ A))"]);
  });

  // The prefix table, four steps wide and three deep below 1: each prefix
  // its own world, read with its own last step and printed back as typed.
  test("reads every prefix in the table as its own world, and prints it back", async () => {
    const { resolved } = await exercise("- A");
    const letters = "abcd";
    const paths: number[][] = [];

    for (let a = 1; a <= 4; a += 1) {
      paths.push([a]);

      for (let b = 1; b <= 4; b += 1) {
        paths.push([a, b]);

        for (let c = 1; c <= 4; c += 1) {
          paths.push([a, b, c]);
        }
      }
    }

    for (const path of paths) {
      const prefix = `1.${path.join(".")}`;
      const read = resolved.reader.read(`${prefix} T: A`);
      const steps = path.map(
        (_, at) =>
          `w${path
            .slice(0, at + 1)
            .map((step) => letters[step - 1])
            .join("")}`,
      );

      expect(read.ok ? read.engine.replace(/[()]/gu, "") : prefix).toBe(
        `1 . ${steps.join(" . ")} 𝕋 A`,
      );
      const shown = read.ok
        ? displayRow(read.engine, resolved.language, resolved.theory.rowSort)
        : null;

      // Printed as typed, and read back as the same world.
      expect(shown?.replace(/\s/gu, "")).toBe(`${prefix}𝕋A`);
      const again = shown === null ? null : resolved.reader.read(shown);

      expect(
        again?.ok === true && read.ok && again.engine === read.engine,
      ).toBe(true);
    }

    expect(paths).toHaveLength(84);
    expect(resolved.reader.read("1.1.1.1.1 T: A").ok).toBe(false);
  });

  // A step `1` deep in a prefix once read as the root's first world, so
  // `1.1.1.1` shared its last step with `1.1` and was never new.
  test("□𝔽 three times reaches a new prefix each time", async () => {
    const tree = new TreeBuilder(["1 F: [][][]A"]);
    const [one] = tree.stack("n0", "r1", ["1.1 F: [][]A"], "[]F");
    const [two] = tree.stack("n0", one as string, ["1.1.1 F: []A"], "[]F");
    tree.stack("n0", two as string, ["1.1.1.1 F: A"], "[]F");

    expect(problems(await judge(":|-: □□□A", tree))).toEqual([]);
  }, 60_000);

  // proofs-in-K.tex, its first tableau.
  test("the book's tableau for (□A ∧ □B) → □(A ∧ B)", async () => {
    const tree = new TreeBuilder(["1 F: (□A ∧ □B) → □(A ∧ B)"]);
    const [and, box] = tree.stack(
      "n0",
      "r1",
      ["1 T: □A ∧ □B", "1 F: □(A ∧ B)"],
      "→F",
    );
    const [a, b] = tree.stack(
      "n0",
      and as string,
      ["1 T: □A", "1 T: □B"],
      "∧T",
    );
    const [ab] = tree.stack("n0", box as string, ["1.1 F: A ∧ B"], "□F");
    const { nodes, rows } = tree.split(
      "n0",
      ab as string,
      [["1.1 F: A"], ["1.1 F: B"]],
      "∧F",
    );
    const [ta] = tree.stack(nodes[0], a as string, ["1.1 T: A"], "□T");
    tree.close(nodes[0], ta as string, rows[0][0] as string);
    const [tb] = tree.stack(nodes[1], b as string, ["1.1 𝕋 B"], "[]T");
    tree.close(nodes[1], tb as string, rows[1][0] as string);
    const report = await judge(":|-: (□A ∧ □B) → □(A ∧ B)", tree);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);

  // rules-for-K.tex: why □𝕋 wants a prefix already used.
  test("□𝕋 to a prefix not yet on the branch is refused", async () => {
    const tree = new TreeBuilder(["1 T: □A", "1 F: ◇A"]);
    const [ta] = tree.stack("n0", "r1", ["1.1 T: A"], "□T");
    const [fa] = tree.stack("n0", "r2", ["1.1 F: A"], "◇F");
    tree.close("n0", ta as string, fa as string);
    const report = await judge("□A :|-: ◇A", tree);

    expect(problems(report)).toEqual([`row ${ta}: step-wrong`]);
  }, 60_000);

  // The witness `1.1 𝕋 B` is on the branch already, so a set would take a
  // second copy of it as nothing written.
  test("□𝕋 may not write its witness again", async () => {
    const step = async (rows: string[]) => {
      const tree = new TreeBuilder(["1 T: □A", "1 T: ◇B"]);
      tree.stack("n0", "r2", ["1.1 T: B"], "◇T");
      const written = tree.stack("n0", "r1", rows, "□T");
      const wrong = problems(await judge("□A, ◇B :|-: □A", tree)).filter(
        (problem) => problem.endsWith("step-wrong"),
      );

      return { written, wrong };
    };
    const twice = await step(["1.1 T: A", "1.1 T: B"]);

    expect(twice.wrong).toEqual(
      twice.written.map((row) => `row ${row}: step-wrong`),
    );
    expect((await step(["1.1 T: A"])).wrong).toEqual([]);
  }, 60_000);

  test("□𝔽 to a prefix already used is refused", async () => {
    const tree = new TreeBuilder(["1 T: ◇B", "1 F: □A"]);
    tree.stack("n0", "r1", ["1.1 T: B"], "◇T");
    const [fa] = tree.stack("n0", "r2", ["1.1 F: A"], "□F");
    const report = await judge("◇B :|-: □A", tree);

    expect(problems(report)).toContain(`row ${fa}: step-wrong`);
  }, 60_000);

  test("a branch closes on one formula at one prefix", async () => {
    const tree = new TreeBuilder(["1 T: ◇A", "1 T: ◇¬A"]);
    const [a] = tree.stack("n0", "r1", ["1.1 T: A"], "◇T");
    const [na] = tree.stack("n0", "r2", ["1.2 T: ¬A"], "◇T");
    const [fa] = tree.stack("n0", na as string, ["1.2 F: A"], "¬T");
    tree.close("n0", a as string, fa as string);
    const report = await judge("- ◇A\n- ◇¬A", tree);

    expect(problems(report)).toContain("end n0: closure-wrong");
  }, 60_000);
});

/** The grade the server gives a certified answer. */
// countermodels.tex, its first tableau: □(p ∨ q) → (□p ∨ □q) fails in K.
function countermodel(resolved: ResolvedTree, both: boolean) {
  const tree = new TreeBuilder(resolved.rootText);
  const [box, or] = tree.stack(
    tree.rootNode,
    "r1",
    ["1 T: □(p ∨ q)", "1 F: □p ∨ □q"],
    "→F",
  );
  const [fp, fq] = tree.stack(
    tree.rootNode,
    or as string,
    ["1 F: □p", "1 F: □q"],
    "∨F",
  );
  const [p11] = tree.stack(tree.rootNode, fp as string, ["1.1 F: p"], "□F");
  const [q12] = tree.stack(tree.rootNode, fq as string, ["1.2 F: q"], "□F");
  const [or11] = tree.stack(
    tree.rootNode,
    box as string,
    ["1.1 T: p ∨ q"],
    "□T",
  );
  const left = tree.split(
    tree.rootNode,
    or11 as string,
    [["1.1 T: p"], ["1.1 T: q"]],
    "∨T",
  );
  tree.close(left.nodes[0], left.rows[0][0] as string, p11 as string);

  if (!both) {
    tree.open(left.nodes[1]);
    return { box: box as string, open: left.nodes[1], tree };
  }

  const [or12] = tree.stack(
    left.nodes[1],
    box as string,
    ["1.2 T: p ∨ q"],
    "□T",
  );
  const right = tree.split(
    left.nodes[1],
    or12 as string,
    [["1.2 T: p"], ["1.2 T: q"]],
    "∨T",
  );
  tree.open(right.nodes[0]);
  tree.close(right.nodes[1], right.rows[1][0] as string, q12 as string);
  return { box: box as string, open: right.nodes[0], tree };
}

describe("an open branch in K", () => {
  test("is complete with □𝕋 at every prefix it uses", async () => {
    const asked = await exercise(":|-: □(p ∨ q) → (□p ∨ □q)", "one-open");
    const { resolved } = asked;
    const { box, tree } = countermodel(resolved, true);
    const answer = await certifyAnswer(asked.publicData, tree.answer());
    const judged = await judgeAsServer(asked, answer);

    expect(problems(judged)).toEqual([]);
    const mark = judged.marks.get(box);

    // The instances are the prefixes the row went to, as the book lists them.
    expect(mark).toEqual({
      names: ["((1) . wa)", "((1) . wb)"],
      type: "general",
    });
    expect(markText(mark as RowMark, resolved.language)).toBe("\\1.1,1.2");
    expect(await gradeAnswer(asked.item, answer)).toBe("correct");
  }, 60_000);

  test("is incomplete while □𝕋 skips a prefix it uses", async () => {
    const asked = await exercise(":|-: □(p ∨ q) → (□p ∨ □q)", "one-open");
    const { box, open, tree } = countermodel(asked.resolved, false);
    const answer = await certifyAnswer(asked.publicData, tree.answer());
    const judged = await judgeAsBrowser(asked, tree);

    expect(judged.ends.get(open)).toEqual({
      missing: [{ names: ["((1) . wb)"], row: box }],
      type: "open-incomplete",
    });
    expect(answer.mmb).toBeUndefined();
    expect(await gradeAnswer(asked.item, answer)).toBe("incorrect");
  }, 60_000);

  test("owes □𝕋 nothing at a prefix its world does not see", async () => {
    const asked = await exercise("- ◇◇p\n- □q", "one-open");
    const tree = new TreeBuilder(asked.resolved.rootText);
    const [dp] = tree.stack(tree.rootNode, "r1", ["1.1 T: ◇p"], "◇T");
    tree.stack(tree.rootNode, dp as string, ["1.1.1 T: p"], "◇T");
    tree.stack(tree.rootNode, "r2", ["1.1 T: q"], "□T");
    tree.open(tree.rootNode);
    const answer = await certifyAnswer(asked.publicData, tree.answer());

    expect(await gradeAnswer(asked.item, answer)).toBe("correct");
  }, 60_000);
});
