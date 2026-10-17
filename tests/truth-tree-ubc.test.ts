import { describe, expect, test } from "bun:test";
import { isLiteral } from "../src/worker/exercises/truth-tree/aufbau/branch";
import { ruleSpelling } from "../src/worker/exercises/truth-tree/aufbau/theory";
import type { TreeReport } from "../src/worker/exercises/truth-tree/report";
import { languageById } from "../src/worker/logic/specs";
import { sentenceSort } from "../src/worker/logic/specs/roles";
import {
  judgeAsBrowser,
  problems,
  TreeBuilder,
  treeExercise,
} from "./helpers/truth-tree";

/**
 * *forall x: UBC*'s trees, judged as the browser judges them: the book's
 * worked trees from chapter 5, every rule, and each mistake the report names,
 * where it names it. The book's source is github.com/jonathanichikawa/for-all-x
 * (v2.4.1, e01f809), licensed CC BY-SA 3.0; its trees are quoted as test data,
 * with credit.
 *
 * Each tree's root is the exercise's, so the exercise is the set of its root
 * sentences, and `finish` says what it asks.
 */

type Finish = "closed" | "complete" | "one-open";

async function judge(
  tree: TreeBuilder,
  finish: Finish = "closed",
): Promise<TreeReport> {
  const asked = await treeExercise(tree.rootTexts, { finish });

  return judgeAsBrowser(asked, tree);
}

describe("the book's worked trees (chapter 5)", () => {
  test("§5.2: a closed tree", async () => {
    const t = new TreeBuilder(["A & B", "¬(C ∨ D)", "(¬B ∨ C) ∨ E", "¬E"]);
    const [, b] = t.stack(t.rootNode, "r1", ["A", "B"], "&");
    const [notC] = t.stack(t.rootNode, "r2", ["¬C", "¬D"], "¬∨");
    const {
      nodes: [left, right],
      rows: [[orC], [e]],
    } = t.split(t.rootNode, "r3", [["¬B ∨ C"], ["E"]], "∨");
    const {
      nodes: [notB, c],
      rows: [[notBRow], [cRow]],
    } = t.split(left, orC as string, [["¬B"], ["C"]], "∨");
    t.close(notB, b as string, notBRow as string);
    t.close(c, notC as string, cRow as string);
    t.close(right, "r4", e as string);
    const report = await judge(t);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
    expect(report.finished).toBe(true);
    expect(report.marks.get("r1")).toEqual({ names: [], type: "resolved" });
    expect(report.marks.get("r3")?.type).toBe("resolved");
    // ¬E is a literal: no rule develops it, and it has no mark.
    expect(report.marks.has("r4")).toBe(false);
  }, 60_000);

  test("§5.3: a complete open branch", async () => {
    const t = new TreeBuilder(["(D ∨ A) & ¬N", "N ∨ ¬A", "¬(¬N & A)"]);
    const [dOrA, notN] = t.stack(t.rootNode, "r1", ["D ∨ A", "¬N"], "&");
    const {
      nodes: [n, notA],
      rows: [[nRow]],
    } = t.split(t.rootNode, "r2", [["N"], ["¬A"]], "∨");
    t.close(n, notN as string, nRow as string);
    const {
      nodes: [notNotN, notA2],
      rows: [[notNotNRow], [notA2Row]],
    } = t.split(notA, "r3", [["¬¬N"], ["¬A"]], "¬&");
    t.close(notNotN, notN as string, notNotNRow as string);
    const {
      nodes: [d, a],
      rows: [, [aRow]],
    } = t.split(notA2, dOrA as string, [["D"], ["A"]], "∨");
    t.open(d);
    t.close(a, notA2Row as string, aRow as string);
    const report = await judge(t, "one-open");

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(false);
    expect(report.open).toBe(true);
    expect(report.finished).toBe(true);
  }, 60_000);

  test("§5.4: a row developed on each branch below it", async () => {
    const t = new TreeBuilder(["(D & ¬R) ∨ Q", "¬Q ∨ R"]);
    const {
      nodes: [left, right],
      rows: [[dAndNotR], [q]],
    } = t.split(t.rootNode, "r1", [["D & ¬R"], ["Q"]], "∨");
    const {
      nodes: [notQ, r],
      rows: [, [rRow]],
    } = t.split(left, "r2", [["¬Q"], ["R"]], "∨");
    t.stack(notQ, dAndNotR as string, ["D", "¬R"], "&");
    t.open(notQ);
    const [, notR] = t.stack(r, dAndNotR as string, ["D", "¬R"], "&");
    t.close(r, rRow as string, notR as string);
    const {
      nodes: [notQ2, r2],
      rows: [[notQ2Row]],
    } = t.split(right, "r2", [["¬Q"], ["R"]], "∨");
    t.close(notQ2, q as string, notQ2Row as string);
    t.open(r2);
    const report = await judge(t, "complete");

    expect(problems(report)).toEqual([]);
    expect(report.finished).toBe(true);
    expect(report.marks.get(dAndNotR as string)?.type).toBe("resolved");
  }, 60_000);

  test("§5.4: a biconditional's two rows a side, in either order", async () => {
    const t = new TreeBuilder(["¬(C & A)", "D ≡ C", "A ∨ B", "¬B"]);
    const {
      nodes: [notC, notA],
      rows: [[notCRow], [notARow]],
    } = t.split(t.rootNode, "r1", [["¬C"], ["¬A"]], "¬&");
    const {
      nodes: [dc, ndnc],
      rows: [[, cRow]],
    } = t.split(
      notC,
      "r2",
      [
        ["D", "C"],
        ["¬D", "¬C"],
      ],
      "≡",
    );
    t.close(dc, notCRow as string, cRow as string);
    const {
      nodes: [a, b],
      rows: [, [bRow]],
    } = t.split(ndnc, "r3", [["A"], ["B"]], "∨");
    t.open(a);
    t.close(b, "r4", bRow as string);
    // `C, D` for `D ≡ C`'s first branch.
    const { nodes } = t.split(
      notA,
      "r2",
      [
        ["C", "D"],
        ["¬D", "¬C"],
      ],
      "≡",
    );

    for (const node of nodes) {
      const {
        nodes: [a3, b3],
        rows: [[a3Row], [b3Row]],
      } = t.split(node, "r3", [["A"], ["B"]], "∨");
      t.close(a3, notARow as string, a3Row as string);
      t.close(b3, "r4", b3Row as string);
    }

    const report = await judge(t, "one-open");

    expect(problems(report)).toEqual([]);
    expect(report.finished).toBe(true);
  }, 60_000);

  test("§5.8: one complete open branch settles it, unfinished branches and all", async () => {
    const t = new TreeBuilder(["¬(C & A)", "D ≡ C", "A ∨ B", "¬B"]);
    const {
      nodes: [a],
      rows: [[aRow]],
    } = t.split(t.rootNode, "r3", [["A"], ["B"]], "∨");
    const {
      nodes: [notC, notA],
      rows: [[notCRow], [notARow]],
    } = t.split(a, "r1", [["¬C"], ["¬A"]], "¬&");
    t.close(notA, aRow as string, notARow as string);
    const {
      nodes: [dc, ndnc],
      rows: [[, cRow]],
    } = t.split(
      notC,
      "r2",
      [
        ["D", "C"],
        ["¬D", "¬C"],
      ],
      "≡",
    );
    t.close(dc, notCRow as string, cRow as string);
    t.open(ndnc);
    // The B branch is left alone: it would close, but it need not.
    const report = await judge(t, "one-open");

    expect(problems(report)).toEqual([]);
    expect(report.finished).toBe(true);
    expect(report.closed).toBe(false);
  }, 60_000);
});

describe("every rule", () => {
  test("¬¬, and the rules for negated binaries", async () => {
    const t = new TreeBuilder(["¬¬A", "¬(B ∨ C)", "¬(D ⊃ E)", "¬(F & G)"]);
    t.stack(t.rootNode, "r1", ["A"], "¬¬");
    t.stack(t.rootNode, "r2", ["¬B", "¬C"], "¬∨");
    t.stack(t.rootNode, "r3", ["D", "¬E"], "¬⊃");
    t.split(t.rootNode, "r4", [["¬F"], ["¬G"]], "¬&");

    expect(problems(await judge(t))).toEqual([]);
  }, 60_000);

  test("≡ and ¬≡, each branch's rows and the branches in either order", async () => {
    for (const branches of [
      [
        ["A", "B"],
        ["¬A", "¬B"],
      ],
      [
        ["¬B", "¬A"],
        ["B", "A"],
      ],
    ]) {
      const t = new TreeBuilder(["A ≡ B"]);
      t.split(t.rootNode, "r1", branches, "≡");

      expect(problems(await judge(t))).toEqual([]);
    }

    for (const branches of [
      [
        ["A", "¬B"],
        ["¬A", "B"],
      ],
      [
        ["B", "¬A"],
        ["¬B", "A"],
      ],
    ]) {
      const t = new TreeBuilder(["¬(A ≡ B)"]);
      t.split(t.rootNode, "r1", branches, "¬≡");

      expect(problems(await judge(t))).toEqual([]);
    }
  }, 60_000);

  test("≡'s rows the other rule's are refused", async () => {
    const t = new TreeBuilder(["A ≡ B"]);
    const { rows } = t.split(
      t.rootNode,
      "r1",
      [
        ["A", "¬B"],
        ["¬A", "B"],
      ],
      "≡",
    );

    expect(problems(await judge(t))).toEqual(
      rows.flat().map((row) => `row ${row}: step-wrong`),
    );
  }, 60_000);

  test("¬∀ and ¬∃: a negated quantifier's instance is negated, and ¬∀'s name is new", async () => {
    const t = new TreeBuilder(["¬∀xFx", "¬∃xGx", "Hc"]);
    const [notFd] = t.stack(t.rootNode, "r1", ["¬Fd"], "¬∀");
    const [notGc] = t.stack(t.rootNode, "r2", ["¬Gc"], "¬∃");
    // `c` is on the branch, so it is not new for ¬∀.
    const [notFc] = t.stack(t.rootNode, "r1", ["¬Fc"], "¬∀");
    const report = await judge(t);

    expect(report.rows.has(notFd as string)).toBe(false);
    expect(report.rows.has(notGc as string)).toBe(false);
    expect(problems(report)).toEqual([`row ${notFc}: step-wrong`]);
  }, 60_000);

  test("a rule is named by any of its spellings", async () => {
    const t = new TreeBuilder(["A ⊃ B", "¬(C & D)", "∀x Fx"]);
    t.split(t.rootNode, "r1", [["¬A"], ["B"]], "->");
    t.stack(t.rootNode, "r3", ["Fa"], "@");
    const report = await judge(t);

    expect(problems(report)).toEqual([]);
  }, 60_000);
});

describe("the margin's rule names", () => {
  test("are spelled as the book first spells them", () => {
    const language = languageById("forallx-ubc");

    if (language === null) {
      throw new Error("no UBC language");
    }

    expect(ruleSpelling(language, "->")).toBe("⊃");
    expect(ruleSpelling(language, "~&")).toBe("¬&");
    expect(ruleSpelling(language, " \\/ ")).toBe("∨");
    expect(ruleSpelling(language, "@")).toBe("∀");
    expect(ruleSpelling(language, "¬3")).toBe("¬∃");
    expect(ruleSpelling(language, "=")).toBe("=");
    expect(ruleSpelling(language, "×")).toBe("×");
    // A name no rule has, or an axiom's own name, is no rule.
    expect(ruleSpelling(language, "MP")).toBeNull();
    expect(ruleSpelling(language, "tb_and")).toBeNull();
  });
});

// Identity completion (`tree.development.literals`) pairs only these.
describe("a literal", () => {
  test("is a sentence with no sentence in it, or one negated", () => {
    const language = languageById("forallx-ubc");
    const sort = language === null ? undefined : sentenceSort(language);

    if (language === null || sort === undefined) {
      throw new Error("no UBC language");
    }

    const literal = (text: string): boolean => {
      const parsed = language.parse(text, { sort });

      if (!parsed.ok) {
        throw new Error(`${text} does not read`);
      }

      return isLiteral(language, parsed.term);
    };

    expect(["Fa", "Rab", "a=b", "¬Fa", "¬a=b"].map(literal)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(["¬¬Fa", "Fa & Gb", "∀x Fx", "¬∃x Fx"].map(literal)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("mistakes in a development", () => {
  test("a disjunction stacked, a conjunction split", async () => {
    const t = new TreeBuilder(["A ∨ B", "C & D"]);
    const [a, b] = t.stack(t.rootNode, "r1", ["A", "B"], "∨");
    const {
      rows: [[c], [d]],
    } = t.split(t.rootNode, "r2", [["C"], ["D"]], "&");

    expect(problems(await judge(t))).toEqual([
      `row ${a}: step-wrong`,
      `row ${b}: step-wrong`,
      `row ${c}: step-wrong`,
      `row ${d}: step-wrong`,
    ]);
  }, 60_000);

  test("a row the rule does not write", async () => {
    const t = new TreeBuilder(["A ⊃ B"]);
    const {
      rows: [[a], [b]],
    } = t.split(t.rootNode, "r1", [["A"], ["B"]], "⊃");

    expect(problems(await judge(t))).toEqual([
      `row ${a}: step-wrong`,
      `row ${b}: step-wrong`,
    ]);
  }, 60_000);

  test("a stack that stops short, and one that repeats itself", async () => {
    const short = new TreeBuilder(["A & B"]);
    const [a] = short.stack(short.rootNode, "r1", ["A"], "&");

    expect(problems(await judge(short))).toEqual([`row ${a}: step-wrong`]);

    const repeated = new TreeBuilder(["A & B"]);
    const rows = repeated.stack(
      repeated.rootNode,
      "r1",
      ["A", "A", "B"],
      "&",
    );

    expect(problems(await judge(repeated))).toEqual(
      rows.map((row) => `row ${row}: step-wrong`),
    );
  }, 60_000);

  test("citations: missing, of a literal, and of a row on another branch", async () => {
    const t = new TreeBuilder(["(A & B) ∨ C", "D & E"]);
    const {
      nodes: [left, right],
      rows: [[ab]],
    } = t.split(t.rootNode, "r1", [["A & B"], ["C"]], "∨");
    const [uncited] = t.stack(left, null, ["D", "E"], "&");
    const [a] = t.stack(left, ab as string, ["A", "B"], "&");
    const [literal] = t.stack(left, a as string, ["A"], "&");
    // Right but for its citation: `A & B` is on the other branch.
    const [sideways] = t.stack(right, ab as string, ["A", "B"], "&");
    const report = await judge(t);

    expect(report.rows.get(uncited as string)).toEqual({ type: "uncited" });
    expect(report.rows.get(literal as string)?.type).toBe("step-wrong");
    expect(report.rows.get(sideways as string)).toEqual({
      cite: ab as string,
      type: "cite-not-above",
    });
  }, 60_000);

  test("one step's rows citing different rows", async () => {
    const t = new TreeBuilder(["A & B", "C & D"]);
    const [a, b] = t.stack(t.rootNode, "r1", ["A", "B"], "&");
    t.recite([b as string], "r2");

    expect(problems(await judge(t))).toEqual([
      `row ${a}: cites-differ`,
      `row ${b}: cites-differ`,
    ]);
  }, 60_000);

  test("a split whose branches are not one step", async () => {
    const t = new TreeBuilder(["A ∨ B"]);
    const {
      rows: [[a], [b]],
    } = t.split(t.rootNode, "r1", [["A"], ["B"]], "∨");
    t.reshape((document) => ({
      nodes: document.nodes.map((node) => ({
        ...node,
        rows: node.rows.map((row) =>
          row.id === b ? { ...row, dev: "another" } : row,
        ),
      })),
    }));

    expect(problems(await judge(t))).toEqual([
      `row ${a}: split-mixed`,
      `row ${b}: split-mixed`,
    ]);
  }, 60_000);

  test("a step that names no rule is not written yet", async () => {
    const t = new TreeBuilder(["A & B"]);
    const [a, b] = t.stack(t.rootNode, "r1", ["A", "B"]);

    expect(problems(await judge(t))).toEqual([
      `row ${a}: no-rule-named`,
      `row ${b}: no-rule-named`,
    ]);
  }, 60_000);

  test("rows that are empty or do not read", async () => {
    const t = new TreeBuilder(["A & B"]);
    const [broken] = t.stack(t.rootNode, "r1", ["A &"], "&");
    // The book's grammar: ⊃ takes no unbracketed binary operand.
    const [nested] = t.stack(t.rootNode, "r1", ["P & Q ⊃ R"], "&");
    const [empty] = t.stack(t.rootNode, "r1", [" "], "&");
    const report = await judge(t);

    expect(report.rows.get(broken as string)?.type).toBe("unreadable");
    expect(report.rows.get(nested as string)?.type).toBe("unreadable");
    expect(report.rows.get(empty as string)).toEqual({ type: "empty" });
  }, 60_000);

  test("a root that is not the exercise's", async () => {
    const asked = await treeExercise(["A & B"]);
    const t = new TreeBuilder(["B & A"]);

    expect(problems(await judgeAsBrowser(asked, t))).toEqual([
      "row r1: root-mismatch",
    ]);
  }, 60_000);

  test("a tree past the row cap is not read", async () => {
    const t = new TreeBuilder(["A & B"]);
    t.stack(
      t.rootNode,
      "r1",
      Array.from({ length: 250 }, () => "A"),
      "&",
    );
    const report = await judge(t);

    expect(report.problems).toEqual([
      {
        at: { problem: { limit: 200, type: "too-many-rows" }, type: "tree" },
      },
    ]);
    expect(report.rows.size).toBe(0);
  }, 60_000);
});

describe("branch ends", () => {
  test("a closure must cite a sentence and its negation on its branch", async () => {
    const t = new TreeBuilder(["A", "¬A", "B ∨ C"]);
    const {
      nodes: [b, c],
    } = t.split(t.rootNode, "r3", [["B"], ["C"]], "∨");
    t.close(b, "r1", "r3");
    t.close(c);
    const report = await judge(t);

    expect(report.ends.get(b)).toEqual({ type: "closure-wrong" });
    expect(report.ends.get(c)).toEqual({ type: "closure-uncited" });
    expect(report.closed).toBe(false);
  }, 60_000);

  test("a closure citing a row on another branch", async () => {
    const t = new TreeBuilder(["¬B", "B ∨ C"]);
    const {
      nodes: [b, c],
      rows: [[bRow]],
    } = t.split(t.rootNode, "r2", [["B"], ["C"]], "∨");
    t.close(b, "r1", bRow as string);
    t.close(c, "r1", bRow as string);
    const report = await judge(t);

    expect(report.ends.get(b)).toBeUndefined();
    expect(report.ends.get(c)).toEqual({ type: "closure-cite-off-branch" });
  }, 60_000);

  test("↑ where every branch must close", async () => {
    const t = new TreeBuilder(["A"]);
    t.open(t.rootNode);

    expect((await judge(t, "closed")).ends.get(t.rootNode)).toEqual({
      type: "open-not-offered",
    });
  }, 60_000);

  test("↑ with rows left to develop", async () => {
    const t = new TreeBuilder(["A & B"]);
    t.open(t.rootNode);

    expect((await judge(t, "one-open")).ends.get(t.rootNode)).toEqual({
      missing: [{ kind: "developed", row: "r1" }],
      type: "open-incomplete",
    });
  }, 60_000);

  test("an end on a node with branches below it", async () => {
    const t = new TreeBuilder(["A ∨ B", "¬A"]);
    t.split(t.rootNode, "r1", [["A"], ["B"]], "∨");
    t.close(t.rootNode, "r1", "r2");

    expect((await judge(t)).ends.get(t.rootNode)).toEqual({
      type: "end-not-leaf",
    });
  }, 60_000);

  test("a branch with no rows", async () => {
    const t = new TreeBuilder(["A ∨ B"]);
    const {
      nodes: [, empty],
    } = t.split(t.rootNode, "r1", [["A"], []], "∨");

    expect((await judge(t)).ends.get(empty)).toEqual({
      type: "empty-branch",
    });
  }, 60_000);
});

describe("marks", () => {
  test("a row is ticked once every branch below it develops it or is closed", async () => {
    const t = new TreeBuilder(["A ∨ B", "C & D", "¬A"]);
    const {
      nodes: [a, b],
      rows: [[aRow]],
    } = t.split(t.rootNode, "r1", [["A"], ["B"]], "∨");
    t.stack(b, "r2", ["C", "D"], "&");

    expect((await judge(t)).marks.has("r2")).toBe(false);

    t.close(a, "r3", aRow as string);

    expect((await judge(t)).marks.get("r2")).toEqual({
      names: [],
      type: "resolved",
    });
  }, 60_000);
});
