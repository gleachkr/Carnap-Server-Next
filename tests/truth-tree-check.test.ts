import { describe, expect, test } from "bun:test";
import type { TreeReport } from "../src/worker/exercises/truth-tree/logic/check";
import { FORALLX_UBC } from "../src/worker/exercises/truth-tree/logic/system";
import { TreeBuilder, ubcFormula } from "./helpers/truth-tree";

/**
 * The truth-tree checker against *forall x: UBC*'s own worked trees, from
 * the book's source (github.com/jonathanichikawa/for-all-x, v2.4.1, commit
 * e01f809), chapters 5 and 10, and the common errors of §10.13. Each tree is
 * the book's, row for row, with the closures cited as the checker requires.
 * The book is licensed CC BY-SA 3.0; its trees are quoted here as test data,
 * with credit.
 */

function problems(report: TreeReport): string[] {
  return report.problems.map((problem) =>
    problem.at.type === "tree"
      ? problem.at.problem.type
      : `${problem.at.id}:${problem.at.problem.type}`,
  );
}

describe("the book's worked SL trees (chapter 5)", () => {
  test("§5.2: a closed tree", () => {
    const t = new TreeBuilder(["A & B", "¬(C ∨ D)", "(¬B ∨ C) ∨ E", "¬E"]);
    const [, b] = t.stack(t.rootNode, "r1", ["A", "B"]);
    const [notC] = t.stack(t.rootNode, "r2", ["¬C", "¬D"]);
    const {
      nodes: [left, right],
      rows: [[negBorC], [e]],
    } = t.split(t.rootNode, "r3", [["¬B ∨ C"], ["E"]]);
    const {
      nodes: [notB, c],
      rows: [[negB], [cRow]],
    } = t.split(left as string, negBorC as string, [["¬B"], ["C"]]);
    t.close(notB as string, b as string, negB as string);
    t.close(c as string, notC as string, cRow as string);
    t.close(right as string, "r4", e as string);

    const done = t.check();

    expect(problems(done)).toEqual([]);
    expect(done.closed).toBe(true);
    expect(done.finished).toBe(true);
    expect(done.marks.get("r1")).toEqual({ names: [], type: "resolved" });
    expect(done.marks.get("r3")?.type).toBe("resolved");
    // ¬E is a literal; it has no rule and no mark.
    expect(done.marks.has("r4")).toBe(false);
  });

  test("§5.3: a complete open branch", () => {
    const t = new TreeBuilder(["(D ∨ A) & ¬N", "N ∨ ¬A", "¬(¬N & A)"]);
    const [dOrA, notN] = t.stack(t.rootNode, "r1", ["D ∨ A", "¬N"]);
    const {
      nodes: [n, notA],
      rows: [[nRow]],
    } = t.split(t.rootNode, "r2", [["N"], ["¬A"]]);
    t.close(n as string, notN as string, nRow as string);
    const {
      nodes: [notNotN, notA2],
      rows: [[notNotNRow], [notA2Row]],
    } = t.split(notA as string, "r3", [["¬¬N"], ["¬A"]]);
    t.close(notNotN as string, notN as string, notNotNRow as string);
    const {
      nodes: [d, a],
      rows: [, [aRow]],
    } = t.split(notA2 as string, dOrA as string, [["D"], ["A"]]);
    t.open(d as string);
    t.close(a as string, notA2Row as string, aRow as string);

    const report = t.check();

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(false);
    expect(report.open).toBe(true);
    expect(report.finished).toBe(true);
  });

  test("§5.4: the tree in the mockup, with its shared lines", () => {
    const t = new TreeBuilder(["(D & ¬R) ∨ Q", "¬Q ∨ R"]);
    const {
      nodes: [left, right],
      rows: [[dAndNotR], [q]],
    } = t.split(t.rootNode, "r1", [["D & ¬R"], ["Q"]]);
    const {
      nodes: [notQ, r],
      rows: [, [rRow]],
    } = t.split(left as string, "r2", [["¬Q"], ["R"]]);
    t.stack(notQ as string, dAndNotR as string, ["D", "¬R"]);
    t.open(notQ as string);
    const [, notR] = t.stack(r as string, dAndNotR as string, ["D", "¬R"]);
    t.close(r as string, rRow as string, notR as string);
    const {
      nodes: [notQ2, r2],
      rows: [[notQ2Row]],
    } = t.split(right as string, "r2", [["¬Q"], ["R"]]);
    t.close(notQ2 as string, q as string, notQ2Row as string);
    t.open(r2 as string);

    const report = t.check();

    expect(problems(report)).toEqual([]);
    expect(report.finished).toBe(true);
    expect(report.marks.get(dAndNotR as string)?.type).toBe("resolved");
  });

  test("§5.5: a biconditional's two rows a side", () => {
    const t = new TreeBuilder(["¬(C & A)", "D ≡ C", "A ∨ B", "¬B"]);
    const {
      nodes: [notC, notA],
      rows: [[notCRow], [notARow]],
    } = t.split(t.rootNode, "r1", [["¬C"], ["¬A"]]);
    const {
      nodes: [dc, ndnc],
      rows: [[, cRow]],
    } = t.split(notC as string, "r2", [
      ["D", "C"],
      ["¬D", "¬C"],
    ]);
    t.close(dc as string, notCRow as string, cRow as string);
    const {
      nodes: [a, b],
      rows: [, [bRow]],
    } = t.split(ndnc as string, "r3", [["A"], ["B"]]);
    t.open(a as string);
    t.close(b as string, "r4", bRow as string);
    const {
      nodes: [dc2, ndnc2],
      rows: [[, c2]],
    } = t.split(notA as string, "r2", [
      ["C", "D"],
      ["¬D", "¬C"],
    ]);

    for (const node of [dc2, ndnc2]) {
      const {
        nodes: [a3, b3],
        rows: [[a3Row], [b3Row]],
      } = t.split(node as string, "r3", [["A"], ["B"]]);
      t.close(a3 as string, notARow as string, a3Row as string);
      t.close(b3 as string, "r4", b3Row as string);
    }

    const report = t.check();

    // The rows within a branch may come in either order: `C, D` for `D ≡ C`.
    expect(problems(report)).toEqual([]);
    expect(report.finished).toBe(true);
    expect(c2).toBeDefined();
  });

  test("§5.x: one complete open branch settles it, unfinished branches and all", () => {
    const t = new TreeBuilder(["¬(C & A)", "D ≡ C", "A ∨ B", "¬B"]);
    const {
      nodes: [a],
      rows: [[aRow]],
    } = t.split(t.rootNode, "r3", [["A"], ["B"]]);
    const {
      nodes: [notC, notA],
      rows: [[notCRow], [notARow]],
    } = t.split(a as string, "r1", [["¬C"], ["¬A"]]);
    t.close(notA as string, aRow as string, notARow as string);
    const {
      nodes: [dc, ndnc],
      rows: [[, cRow]],
    } = t.split(notC as string, "r2", [
      ["D", "C"],
      ["¬D", "¬C"],
    ]);
    t.close(dc as string, notCRow as string, cRow as string);
    t.open(ndnc as string);

    // The B branch is left alone: it would close, but it need not.
    const report = t.check();

    expect(problems(report)).toEqual([]);
    expect(report.finished).toBe(true);
    expect(report.closed).toBe(false);
  });
});

describe("the book's worked QL trees (chapter 10)", () => {
  test("§10.3: an existential takes a new name, a universal any", () => {
    const t = new TreeBuilder(["Gb ⊃ ∀x¬Fx", "∃xFx", "¬¬Gb"]);
    const {
      nodes: [notGb, all],
      rows: [[notGbRow], [allRow]],
    } = t.split(t.rootNode, "r1", [["¬Gb"], ["∀x¬Fx"]]);
    t.close(notGb as string, notGbRow as string, "r3");
    const [fa] = t.stack(all as string, "r2", ["Fa"]);
    const [notFa] = t.stack(all as string, allRow as string, ["¬Fa"]);
    t.close(all as string, fa as string, notFa as string);

    const report = t.check();

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
    expect(report.marks.get("r2")).toEqual({
      names: ["a"],
      type: "resolved",
    });
    expect(report.marks.get(allRow as string)).toEqual({
      names: ["a"],
      type: "general",
    });
  });

  test("§10.3: a complete open branch instantiates the universal for every name", () => {
    const t = new TreeBuilder(["∃xFx", "∀xGx"]);
    t.stack(t.rootNode, "r1", ["Fa"]);
    t.stack(t.rootNode, "r2", ["Ga"]);
    t.open(t.rootNode);

    const report = t.check();

    expect(problems(report)).toEqual([]);
    expect(report.open).toBe(true);
    expect(report.finished).toBe(true);
  });

  test("§10.4: a branch is not complete until the universal meets every name", () => {
    const t = new TreeBuilder(["∀x(Fx & Gx)", "¬Fa ∨ ¬Gb"]);
    const [faga] = t.stack(t.rootNode, "r1", ["Fa & Ga"]);
    const [fa] = t.stack(t.rootNode, faga as string, ["Fa", "Ga"]);
    const {
      nodes: [notFa, notGb],
      rows: [[notFaRow], [notGbRow]],
    } = t.split(t.rootNode, "r2", [["¬Fa"], ["¬Gb"]]);
    t.close(notFa as string, fa as string, notFaRow as string);

    // Marked open after the `a` instance only: `b` is on the branch too.
    t.open(notGb as string);
    const early = t.check();

    expect(early.ends.get(notGb as string)).toEqual({
      missing: [{ names: ["b"], row: "r1" }],
      type: "open-incomplete",
    });
    expect(early.finished).toBe(false);

    // The book's finished tree.
    const finished = new TreeBuilder(["∀x(Fx & Gx)", "¬Fa ∨ ¬Gb"]);
    const [faga2] = finished.stack(finished.rootNode, "r1", ["Fa & Ga"]);
    const [fa2] = finished.stack(finished.rootNode, faga2 as string, [
      "Fa",
      "Ga",
    ]);
    const {
      nodes: [left, right],
      rows: [[left1], [right1]],
    } = finished.split(finished.rootNode, "r2", [["¬Fa"], ["¬Gb"]]);
    finished.close(left as string, fa2 as string, left1 as string);
    const [fbgb] = finished.stack(right as string, "r1", ["Fb & Gb"]);
    const [, gb] = finished.stack(right as string, fbgb as string, [
      "Fb",
      "Gb",
    ]);
    finished.close(right as string, right1 as string, gb as string);

    expect(problems(finished.check())).toEqual([]);
    expect(finished.check().closed).toBe(true);
    expect(notGbRow).toBeDefined();
  });

  test("§10.4: a general sentence on a branch with no names still needs an instance", () => {
    const t = new TreeBuilder(["∀xFx"]);
    t.open(t.rootNode);

    expect(t.check().ends.get(t.rootNode)).toEqual({
      missing: [{ names: [], row: "r1" }],
      type: "open-incomplete",
    });

    const done = new TreeBuilder(["∀xFx"]);
    done.stack(done.rootNode, "r1", ["Fa"]);
    done.open(done.rootNode);

    expect(problems(done.check())).toEqual([]);
    expect(done.check().finished).toBe(true);
  });

  test("§10.13: an existential instantiated with a name already on the branch", () => {
    const t = new TreeBuilder(["∀x∃y¬Rxy", "Rab"]);
    const [some] = t.stack(t.rootNode, "r1", ["∃y¬Ray"]);
    const [notRab] = t.stack(t.rootNode, some as string, ["¬Rab"]);

    expect(t.check().rows.get(notRab as string)).toEqual({
      name: "b",
      type: "name-not-new",
    });
  });

  test("a general row may take several instances in one step", () => {
    const t = new TreeBuilder(["∀x(Fx ⊃ Gx)", "Fa", "¬Gb"]);
    t.stack(t.rootNode, "r1", ["Fa ⊃ Ga", "Fb ⊃ Gb"]);

    expect(problems(t.check())).toEqual([]);
    expect(t.check().marks.get("r1")).toEqual({
      names: ["a", "b"],
      type: "general",
    });
  });

  test("a negated quantifier's instance is negated", () => {
    const t = new TreeBuilder(["¬∀xFx", "¬∃xGx", "Hc"]);
    const [notFd] = t.stack(t.rootNode, "r1", ["¬Fd"]);
    const [notGc] = t.stack(t.rootNode, "r2", ["¬Gc"]);
    const [fc] = t.stack(t.rootNode, "r1", ["¬Fc"]);

    const report = t.check();

    expect(report.rows.has(notFd as string)).toBe(false);
    expect(report.rows.has(notGc as string)).toBe(false);
    // `c` is on the branch, so it is not new for ¬∀.
    expect(report.rows.get(fc as string)).toEqual({
      name: "c",
      type: "name-not-new",
    });
  });
});

describe("mistakes in a development", () => {
  test("a disjunction stacked, a conjunction split", () => {
    const t = new TreeBuilder(["A ∨ B", "C & D"]);
    const [a] = t.stack(t.rootNode, "r1", ["A", "B"]);
    const {
      rows: [[c]],
    } = t.split(t.rootNode, "r2", [["C"], ["D"]]);
    const report = t.check();

    expect(report.rows.get(a as string)).toEqual({
      branches: 2,
      type: "should-split",
    });
    expect(report.rows.get(c as string)).toEqual({ type: "should-stack" });
  });

  test("a row the rule does not write", () => {
    const t = new TreeBuilder(["A ⊃ B"]);
    const {
      rows: [[a]],
    } = t.split(t.rootNode, "r1", [["A"], ["B"]]);

    expect(t.check().rows.get(a as string)).toEqual({
      type: "not-from-rule",
    });
  });

  test("a stack that stops short, and one that repeats itself", () => {
    const short = new TreeBuilder(["A & B"]);
    const [a] = short.stack(short.rootNode, "r1", ["A"]);

    expect(short.check().rows.get(a as string)).toEqual({
      type: "incomplete",
    });

    const repeated = new TreeBuilder(["A & B"]);
    const [, again] = repeated.stack(repeated.rootNode, "r1", [
      "A",
      "A",
      "B",
    ]);

    expect(repeated.check().rows.get(again as string)).toEqual({
      type: "extra",
    });
  });

  test("a split's branches may come in either order", () => {
    const t = new TreeBuilder(["A ∨ B", "¬(A ≡ B)"]);
    t.split(t.rootNode, "r1", [["B"], ["A"]]);
    const branches = t.check();

    expect(problems(branches)).toEqual([]);

    const iff = new TreeBuilder(["¬(A ≡ B)"]);
    iff.split(iff.rootNode, "r1", [
      ["¬A", "B"],
      ["¬B", "A"],
    ]);

    expect(problems(iff.check())).toEqual([]);
  });

  test("the ¬¬ rule, and the rules for negated binaries", () => {
    const t = new TreeBuilder(["¬¬A", "¬(B ∨ C)", "¬(D ⊃ E)", "¬(F & G)"]);
    t.stack(t.rootNode, "r1", ["A"]);
    t.stack(t.rootNode, "r2", ["¬B", "¬C"]);
    t.stack(t.rootNode, "r3", ["D", "¬E"]);
    t.split(t.rootNode, "r4", [["¬F"], ["¬G"]]);

    expect(problems(t.check())).toEqual([]);
  });

  test("citations: missing, of a literal, and of a row on another branch", () => {
    const t = new TreeBuilder(["A ∨ B", "C & D"]);
    const {
      nodes: [left, right],
      rows: [[a]],
    } = t.split(t.rootNode, "r1", [["A"], ["B"]]);
    const [uncited] = t.stack(left as string, null, ["C"]);
    const [literal] = t.stack(left as string, a as string, ["A"]);
    const [sideways] = t.stack(right as string, a as string, ["A"]);
    const report = t.check();

    expect(report.rows.get(uncited as string)).toEqual({ type: "uncited" });
    expect(report.rows.get(literal as string)).toEqual({ type: "no-rule" });
    expect(report.rows.get(sideways as string)).toEqual({
      cite: a as string,
      type: "cite-not-above",
    });
  });

  test("rows that do not read, or use identity without its rules", () => {
    const t = new TreeBuilder(["A & B"]);
    const [broken] = t.stack(t.rootNode, "r1", ["A &"]);
    const [nested] = t.stack(t.rootNode, "r1", ["P & Q ⊃ R"]);
    const [identity] = t.stack(t.rootNode, "r1", ["a = b"]);
    const [empty] = t.stack(t.rootNode, "r1", [" "]);
    const report = t.check();

    expect(report.rows.get(broken as string)?.type).toBe("unreadable");
    // The book's grammar: ⊃ takes no unbracketed binary operand.
    expect(report.rows.get(nested as string)?.type).toBe("unreadable");
    // UBC has identity's rules; a system without them refuses the row.
    expect(report.rows.get(identity as string)?.type).toBe("not-from-rule");
    const { identity: _, ...withoutIdentity } = FORALLX_UBC;
    expect(
      t.check(undefined, withoutIdentity).rows.get(identity as string),
    ).toEqual({ type: "identity" });
    expect(report.rows.get(empty as string)).toEqual({ type: "empty" });
  });

  test("a root that is not the declared one", () => {
    const t = new TreeBuilder(["A & B"]);
    const report = t.check([ubcFormula("B & A")]);

    expect(report.rows.get("r1")).toEqual({ type: "root-mismatch" });
  });
});

describe("identity (§12.7)", () => {
  test("the substitution rule closes {Fa, ¬Fb, a=b}", () => {
    const t = new TreeBuilder(["Fa", "¬Fb", "a = b"]);
    const [fb] = t.stack(t.rootNode, ["r1", "r3"], ["Fb"]);
    t.close(t.rootNode, "r2", fb as string);
    const report = t.check();

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
    expect(report.justifications.get(fb as string)).toEqual({
      cites: ["r1", "r3"],
      rule: { head: { type: "identity" }, negated: false },
    });
    // Substitution develops neither row, so neither is ticked.
    expect(report.marks.size).toBe(0);
  });

  test("the rule rewrites either way, citing the rows in either order", () => {
    const t = new TreeBuilder(["Fa", "Gb", "a = b"]);
    t.stack(t.rootNode, ["r3", "r1"], ["Fb"]);
    t.stack(t.rootNode, ["r2", "r3"], ["Ga"]);

    expect(problems(t.check())).toEqual([]);
  });

  test("every occurrence is replaced, and the rule reaches any sentence", () => {
    const t = new TreeBuilder(["Raa ∨ ∀xRxa", "a = b"]);
    const [partial] = t.stack(t.rootNode, ["r1", "r2"], ["Rab ∨ ∀xRxa"]);
    const [whole] = t.stack(t.rootNode, ["r1", "r2"], ["Rbb ∨ ∀xRxb"]);
    const report = t.check();

    expect(report.rows.get(partial as string)).toEqual({
      identity: "r2",
      into: "r1",
      type: "not-substitution",
    });
    expect(report.rows.has(whole as string)).toBe(false);
  });

  test("a ≠ a closes a branch on one row: ∀x a=x, ∃x x≠a", () => {
    const t = new TreeBuilder(["∀x a = x", "∃x x ≠ a"]);
    const [bNotA] = t.stack(t.rootNode, "r2", ["b ≠ a"]);
    const [aIsB] = t.stack(t.rootNode, "r1", ["a = b"]);
    const [bNotB] = t.stack(
      t.rootNode,
      [bNotA as string, aIsB as string],
      ["b ≠ b"],
    );
    t.close(t.rootNode, bNotB as string);
    const report = t.check();

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
    expect(report.finished).toBe(true);
  });

  test("an unended branch holding a ≠ a says it closes", () => {
    const t = new TreeBuilder(["a ≠ a", "P"]);

    expect(t.check().branches.get(t.rootNode)).toMatchObject({
      contradiction: ["r1"],
    });
    t.open(t.rootNode);
    expect(t.check().ends.get(t.rootNode)).toEqual({
      rows: ["r1"],
      type: "open-contradiction",
    });
  });

  test("the book's model-reading tree: two complete open branches", () => {
    const t = new TreeBuilder(["∀x(Rax ⊃ x = b)", "∃xRax"]);
    const [rac] = t.stack(t.rootNode, "r2", ["Rac"]);
    const [raa, rab, racIf] = t.stack(t.rootNode, "r1", [
      "Raa ⊃ a = b",
      "Rab ⊃ b = b",
      "Rac ⊃ c = b",
    ]);
    const {
      nodes: [notRacNode, cbNode],
      rows: [[notRac], [cb]],
    } = t.split(t.rootNode, racIf as string, [["¬Rac"], ["c = b"]]);
    t.close(notRacNode, rac as string, notRac as string);
    const [rabRow] = t.stack(cbNode, [rac as string, cb as string], ["Rab"]);
    const {
      nodes: [notRabNode, bbNode],
      rows: [[notRab]],
    } = t.split(cbNode, rab as string, [["¬Rab"], ["b = b"]]);
    t.close(notRabNode, rabRow as string, notRab as string);
    const {
      nodes: [notRaaNode, abNode],
      rows: [, [ab]],
    } = t.split(bbNode, raa as string, [["¬Raa"], ["a = b"]]);
    t.open(notRaaNode);
    t.stack(abNode, [rabRow as string, ab as string], ["Rbb"]);
    t.stack(abNode, [rac as string, ab as string], ["Rbc"]);
    t.open(abNode);
    const report = t.check();

    expect(problems(report)).toEqual([]);
    expect(report.open).toBe(true);
    expect(report.finished).toBe(true);
    expect(report.marks.get("r1")).toEqual({
      names: ["a", "b", "c"],
      type: "general",
    });
  });

  test("a branch is complete only once each identity is substituted one way", () => {
    const t = new TreeBuilder(["a = b", "Fa", "¬Gb"]);
    t.open(t.rootNode);

    expect(t.check().ends.get(t.rootNode)).toEqual({
      missing: [{ row: "r1", substitution: true }],
      type: "open-incomplete",
    });

    // a→b: Fb. Rewriting a=b itself gives b=b, which is never needed.
    const u = new TreeBuilder(["a = b", "Fa", "¬Gb"]);
    u.stack(u.rootNode, ["r1", "r2"], ["Fb"]);
    u.open(u.rootNode);
    expect(problems(u.check())).toEqual([]);

    // b→a instead: ¬Ga.
    const v = new TreeBuilder(["a = b", "Fa", "¬Gb"]);
    v.stack(v.rootNode, ["r3", "r1"], ["¬Ga"]);
    v.open(v.rootNode);
    expect(problems(v.check())).toEqual([]);

    // Half of each way is neither.
    const w = new TreeBuilder(["a = b", "Fa", "¬Gb", "Hab"]);
    w.stack(w.rootNode, ["r1", "r2"], ["Fb"]);
    w.stack(w.rootNode, ["r1", "r3"], ["¬Ga"]);
    expect(w.check().branches.get(w.rootNode)).toMatchObject({
      complete: false,
    });
  });

  test("the book's Dxy solution (§12): complete without d=d or e=e", () => {
    const t = new TreeBuilder(["Dab", "Dcd", "Def", "¬Dcf", "d = e"]);
    t.stack(t.rootNode, ["r3", "r5"], ["Ddf"]);
    t.stack(t.rootNode, ["r2", "r5"], ["Dce"]);
    t.open(t.rootNode);

    expect(problems(t.check())).toEqual([]);
  });

  test("what a substitution can get wrong", () => {
    const t = new TreeBuilder(["a = b", "Fa", "Gc", "Hd & Ha"]);
    const [alone] = t.stack(t.rootNode, "r1", ["b = a"]);
    const [noIdentity] = t.stack(t.rootNode, ["r2", "r3"], ["Fc"]);
    const [neither] = t.stack(t.rootNode, ["r1", "r3"], ["Gc"]);
    const [three] = t.stack(t.rootNode, ["r1", "r2", "r3"], ["Fb"]);
    const [once, twice] = t.stack(t.rootNode, ["r1", "r2"], ["Fb", "Fb"]);
    const report = t.check();

    expect(report.rows.get(alone as string)).toEqual({
      type: "identity-alone",
    });
    expect(report.rows.get(noIdentity as string)).toEqual({
      type: "no-identity",
    });
    // Gc has no a or b in it, so the rule writes nothing from it.
    expect(report.rows.get(neither as string)?.type).toBe("not-substitution");
    expect(report.rows.get(three as string)).toEqual({
      type: "cites-several",
    });
    expect(report.rows.has(once as string)).toBe(false);
    expect(report.rows.get(twice as string)).toEqual({ type: "extra" });
  });

  test("a closure on one row that is not a ≠ a", () => {
    const t = new TreeBuilder(["a ≠ b"]);
    t.close(t.rootNode, "r1");

    expect(t.check().ends.get(t.rootNode)).toEqual({
      type: "closure-not-self-non-identity",
    });
  });
});

describe("branch ends", () => {
  test("a closure must cite a sentence and its negation on its branch", () => {
    const t = new TreeBuilder(["A", "¬A", "B ∨ C"]);
    const {
      nodes: [b, c],
    } = t.split(t.rootNode, "r3", [["B"], ["C"]]);
    t.close(b as string, "r1", "r3");
    t.close(c as string);
    const report = t.check();

    expect(report.ends.get(b as string)).toEqual({
      type: "closure-not-contradiction",
    });
    expect(report.ends.get(c as string)).toEqual({ type: "closure-uncited" });
    expect(report.closed).toBe(false);
  });

  test("a closure citing a row on another branch", () => {
    const t = new TreeBuilder(["¬B", "B ∨ C"]);
    const {
      nodes: [b, c],
      rows: [[bRow]],
    } = t.split(t.rootNode, "r2", [["B"], ["C"]]);
    t.close(c as string, "r1", bRow as string);

    expect(t.check().ends.get(c as string)).toEqual({
      type: "closure-cite-off-branch",
    });
    expect(b).toBeDefined();
  });

  test("↑ on a branch holding a contradiction, or with rows left to develop", () => {
    const t = new TreeBuilder(["A", "¬A"]);
    t.open(t.rootNode);

    expect(t.check().ends.get(t.rootNode)).toEqual({
      rows: ["r1", "r2"],
      type: "open-contradiction",
    });

    const u = new TreeBuilder(["A & B"]);
    u.open(u.rootNode);

    expect(u.check().ends.get(u.rootNode)).toEqual({
      missing: [{ row: "r1" }],
      type: "open-incomplete",
    });
  });

  test("an unended branch says what it still needs", () => {
    const t = new TreeBuilder(["A & B", "C"]);
    const state = t.check().branches.get(t.rootNode);

    expect(state).toEqual({
      complete: false,
      contradiction: null,
      missing: [{ row: "r1" }],
      type: "unfinished",
    });
    expect(t.check().finished).toBe(false);
  });
});

describe("marks", () => {
  test("a row is ticked once every branch below it develops it or is closed", () => {
    const t = new TreeBuilder(["A ∨ B", "C & D", "¬A"]);
    const {
      nodes: [a, b],
      rows: [[aRow]],
    } = t.split(t.rootNode, "r1", [["A"], ["B"]]);
    t.stack(b as string, "r2", ["C", "D"]);

    expect(t.check().marks.has("r2")).toBe(false);

    t.close(a as string, "r3", aRow as string);

    expect(t.check().marks.get("r2")).toEqual({
      names: [],
      type: "resolved",
    });
  });
});
