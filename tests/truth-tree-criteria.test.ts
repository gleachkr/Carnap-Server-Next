import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { readTreeDevelopment } from "../src/worker/exercises/truth-tree/aufbau/criteria";
import { matchTerm } from "../src/worker/exercises/truth-tree/aufbau/patterns";
import type { EndProblem } from "../src/worker/exercises/truth-tree/report";
import { describeEndProblem } from "../src/worker/exercises/truth-tree/verdict-text";
import { languageById } from "../src/worker/logic/specs";
import { theorySourceByFileName } from "../src/worker/logic/theories";
import type { TreeExercise } from "./helpers/truth-tree";
import {
  certifyAnswer,
  gradeAnswer,
  judgeAsBrowser,
  judgeAsServer,
  lessonTree,
  TreeBuilder,
  treeExercise,
} from "./helpers/truth-tree";

/**
 * Completeness by the theory's development criteria (gh #46): what UBC's
 * roles say, what an open branch still needs, the marks, and the instances
 * a general step was written with, found by asking the engine and confirmed
 * again by the server's verification.
 */

function consistency(...members: string[]) {
  return treeExercise(members, {
    finish: "one-open",
    prompt: "Is this set consistent?",
  });
}

/** The English catalog: each message as written, its values filled in. */
function words(
  message: string,
  values?: Readonly<Record<string, string>>,
): string {
  return message.replace(/\{(\w+)\}/gu, (_, key) => values?.[key] ?? "");
}

function certify(exercise: TreeExercise, t: TreeBuilder) {
  return certifyAnswer(exercise.publicData, t.answer());
}

describe("UBC's development roles", () => {
  test("read without problems, and say what each rule asks", async () => {
    const { resolved } = await consistency("Fa");
    const development = readTreeDevelopment(
      resolved.language,
      resolved.theory,
    );
    const kind = (axiom: string) =>
      development.byAxiom.get(axiom)?.criterion?.kind;

    expect(development.problems).toEqual([]);
    expect(development.annotated).toBe(true);
    expect(development.relation).toEqual({ mp: "jeq_mp", refl: "jeq_refl" });
    expect(kind("tb_and")).toBe("once");
    expect(kind("tb_or_l")).toBe("once");
    expect(kind("tb_all1")).toBe("general");
    expect(kind("tb_all3")).toBe("general");
    expect(kind("tb_nex1")).toBe("general");
    expect(kind("tb_ex")).toBe("once");
    expect(kind("tb_id_ba")).toBe("pairs");
    expect(development.byAxiom.get("tb_id_ba")?.flags).toEqual(
      new Set(["literals"]),
    );
    expect(development.byAxiom.get("tb_all1")?.instance?.binder).toBe("te");
    expect(development.byAxiom.get("tb_ex")?.instance?.binder).toBe("a");
    expect(development.closure).toHaveLength(2);
  });
});

describe("a general row", () => {
  test("is developed once instantiated for every name on its branch", async () => {
    const asked = await consistency("∀x Rxb", "Fa");
    const t = new TreeBuilder(asked.resolved.rootText);
    const [rab, rbb] = t.stack(t.rootNode, "r1", ["Rab", "Rbb"], "∀");
    t.open(t.rootNode);

    const answer = await certify(asked, t);

    // `Rab` could be the instance at a or at b; the engine says which.
    expect(answer.instances).toEqual({
      [rab as string]: "a",
      [rbb as string]: "b",
    });
    expect(answer.mmb).toBeDefined();
    expect((await judgeAsServer(asked, answer)).marks.get("r1")).toEqual({
      names: ["a", "b"],
      type: "general",
    });
    expect(await gradeAnswer(asked.item, answer)).toBe("correct");
  });

  test("is not developed while a name on its branch is missing", async () => {
    const asked = await consistency("∀x Rxb", "Fa");
    const t = new TreeBuilder(asked.resolved.rootText);
    t.stack(t.rootNode, "r1", ["Rab"], "∀");
    t.open(t.rootNode);

    const answer = await certify(asked, t);

    expect(answer.mmb).toBeUndefined();
    expect((await judgeAsBrowser(asked, t)).ends.get(t.rootNode)).toEqual({
      missing: [{ kind: "general", names: ["b"], row: "r1" }],
      type: "open-incomplete",
    });
    expect(await gradeAnswer(asked.item, answer)).toBe("incorrect");
  });

  test("an instance the certificate does not prove fails verification", async () => {
    const asked = await consistency("∀x Rxb", "Fa");
    const t = new TreeBuilder(asked.resolved.rootText);
    // `Rab` twice: both are the instance at a, so b is still missing.
    const [, second] = t.stack(t.rootNode, "r1", ["Rab", "Rab"], "∀");
    t.open(t.rootNode);

    const answer = await certify(asked, t);

    expect(Object.values(answer.instances ?? {})).toEqual(["a", "a"]);
    expect(await gradeAnswer(asked.item, answer)).toBe("incorrect");

    // Claim the second was the instance at b: the branch would look
    // complete, but the certificate does not prove that link.
    const forged = {
      ...answer,
      instances: { ...answer.instances, [second as string]: "b" },
    };

    expect(
      (await judgeAsServer(asked, forged)).ends.get(t.rootNode),
    ).toBeUndefined();
    expect(await gradeAnswer(asked.item, forged)).toBe("incorrect");
  });

  test("on a branch with no names, needs one instance (nonempty)", async () => {
    const asked = await consistency("∀x Fx");
    const bare = new TreeBuilder(asked.resolved.rootText);
    bare.open(bare.rootNode);

    expect(
      (await judgeAsBrowser(asked, bare)).ends.get(bare.rootNode),
    ).toEqual({
      missing: [{ kind: "general", names: [], row: "r1" }],
      type: "open-incomplete",
    });

    const t = new TreeBuilder(asked.resolved.rootText);
    t.stack(t.rootNode, "r1", ["Fa"], "∀");
    t.open(t.rootNode);

    expect(await gradeAnswer(asked.item, await certify(asked, t))).toBe(
      "correct",
    );
  });

  // The engine is asked about a vacuous step once, at any one term.
  test("vacuous, needs one step whatever the names", async () => {
    const asked = await consistency("∀x Fa", "Gb");
    const t = new TreeBuilder(asked.resolved.rootText);
    t.stack(t.rootNode, "r1", ["Fa"], "∀");
    t.open(t.rootNode);

    const answer = await certify(asked, t);
    const report = await judgeAsServer(asked, answer);

    expect(answer.mmb).toBeDefined();
    expect(report.problems).toEqual([]);
    expect(report.branches.get(t.rootNode)).toEqual({
      right: true,
      type: "open",
    });
    expect(await gradeAnswer(asked.item, answer)).toBe("correct");
  });
});

describe("a step writes what its rule does", () => {
  // A branch is a multiset to the engine, so a row already on it neither
  // stands in for a row the rule writes nor hides one it does not.
  async function wrongRows(
    members: string[],
    cite: string,
    rows: string[],
    rule: string,
    closeOn: [number, string],
  ) {
    const asked = await consistency(...members);
    const t = new TreeBuilder(asked.resolved.rootText);
    const written = t.stack(t.rootNode, cite, rows, rule);
    t.close(t.rootNode, written[closeOn[0]] as string, closeOn[1]);
    const answer = await certify(asked, t);

    return {
      graded: await gradeAnswer(asked.item, answer),
      rows: (await judgeAsBrowser(asked, t)).rows,
      written,
    };
  }

  test("a general step may not write a row that is no instance", async () => {
    const { graded, rows, written } = await wrongRows(
      ["∀x Fx", "Ga", "¬Fa"],
      "r1",
      ["Fa", "Ga"],
      "∀",
      [0, "r3"],
    );

    expect(rows.get(written[1] as string)?.type).toBe("step-wrong");
    expect(graded).toBe("incorrect");
  });

  test("a step may not write one conclusion twice for another on the branch", async () => {
    const { graded, rows, written } = await wrongRows(
      ["A & B", "B", "¬A"],
      "r1",
      ["A", "A"],
      "&",
      [0, "r3"],
    );

    expect(rows.get(written[0] as string)?.type).toBe("step-wrong");
    expect(graded).toBe("incorrect");
  });

  test("a step may not leave out a conclusion already on the branch", async () => {
    const { graded, rows, written } = await wrongRows(
      ["A & B", "B", "¬A"],
      "r1",
      ["A"],
      "&",
      [0, "r3"],
    );

    expect(rows.get(written[0] as string)?.type).toBe("step-wrong");
    expect(graded).toBe("incorrect");
  });

  test("the same steps, written as the rule writes them, are right", async () => {
    expect(
      (await wrongRows(["∀x Fx", "Ga", "¬Fa"], "r1", ["Fa"], "∀", [0, "r3"]))
        .graded,
    ).toBe("correct");
    expect(
      (
        await wrongRows(["A & B", "B", "¬A"], "r1", ["A", "B"], "&", [
          0,
          "r3",
        ])
      ).graded,
    ).toBe("correct");
  });

  test("a step whose rule writes one row twice must write it twice", async () => {
    const once = await wrongRows(["A & A", "¬A"], "r1", ["A"], "&", [
      0,
      "r2",
    ]);

    expect(once.rows.get(once.written[0] as string)?.type).toBe("step-wrong");
    expect(once.graded).toBe("incorrect");
    expect(
      (await wrongRows(["A & A", "¬A"], "r1", ["A", "A"], "&", [0, "r2"]))
        .graded,
    ).toBe("correct");
  });
});

describe("a citation not above its row", () => {
  test("names the row that is not, not the first one cited", async () => {
    const asked = await consistency("a=b", "Fa → Ga");
    const t = new TreeBuilder(asked.resolved.rootText);
    const {
      nodes: [left],
      rows: [, [ga]],
    } = t.split(t.rootNode, "r2", [["¬Fa"], ["Ga"]], "→");
    const [gb] = t.stack(left, ["r1", ga as string], ["Gb"], "=");
    const rows = (await judgeAsBrowser(asked, t)).rows;

    expect(rows.get(gb as string)).toEqual({
      cite: ga as string,
      type: "cite-not-above",
    });
  });
});

describe("a row used once", () => {
  test("takes ✓ with the name an existential step introduced", async () => {
    const asked = await consistency("∃x Fx", "∀x ¬Gx");
    const t = new TreeBuilder(asked.resolved.rootText);
    t.stack(t.rootNode, "r1", ["Fa"], "∃");
    t.stack(t.rootNode, "r2", ["¬Ga"], "∀");
    t.open(t.rootNode);

    const answer = await certify(asked, t);
    const marks = (await judgeAsServer(asked, answer)).marks;

    expect(marks.get("r1")).toEqual({ names: ["a"], type: "resolved" });
    expect(marks.get("r2")).toEqual({ names: ["a"], type: "general" });
    expect(await gradeAnswer(asked.item, answer)).toBe("correct");
  });

  // Without a modus ponens the engine confirms no instance, and the rule is
  // used without one; its steps still check its rows off.
  test("is checked off where the theory confirms no instance", async () => {
    const ubc = (theorySourceByFileName("forallx-ubc.mm0") ?? "").replace(
      "--| @relation judgement jeq jeq_refl jeq_trans jeq_sym jeq_mp",
      "--| @relation judgement jeq jeq_refl jeq_trans jeq_sym _",
    );
    expect(ubc).toContain("jeq_sym _");
    const asked = await lessonTree(
      `:::aufbau-mm0{name="plain"}\n${ubc}\n:::\n\n::::truth-tree{#t system="plain"}\nIs this set consistent?\n\n- ∃x Fx\n- ∀x ¬Fx\n::::`,
    );
    const t = new TreeBuilder(asked.resolved.rootText);
    const [fa] = t.stack(t.rootNode, "r1", ["Fa"], "∃");
    const [nfa] = t.stack(t.rootNode, "r2", ["¬Fa"], "∀");
    t.close(t.rootNode, fa as string, nfa as string);

    expect(
      (await judgeAsServer(asked, await certify(asked, t))).marks.get("r1"),
    ).toEqual({ names: [], type: "resolved" });
  });

  test("on a split, needs developing on the branch marked open", async () => {
    const asked = await consistency("P ∨ Q", "R & S");
    const t = new TreeBuilder(asked.resolved.rootText);
    const {
      nodes: [left],
    } = t.split(t.rootNode, "r1", [["P"], ["Q"]], "∨");
    t.open(left);

    expect((await judgeAsBrowser(asked, t)).ends.get(left)).toEqual({
      missing: [{ kind: "developed", row: "r2" }],
      type: "open-incomplete",
    });
    expect(await gradeAnswer(asked.item, await certify(asked, t))).toBe(
      "incorrect",
    );
  });
});

// UBC §12.7: an open branch is complete once each identity is substituted
// one way round into every atomic and negated atomic row on it (`pairs`).
describe("an identity on an open branch", () => {
  test("owes its substitution into each literal, one way round", async () => {
    const asked = await consistency("a=b", "Fa", "¬Gb");
    const bare = new TreeBuilder(asked.resolved.rootText);
    bare.open(bare.rootNode);

    // Each literal is the other way round already (`Fa` with every b made a
    // is `Fa`), but one way must do for all: Fb, or ¬Ga.
    expect(
      (await judgeAsBrowser(asked, bare)).ends.get(bare.rootNode),
    ).toEqual({
      missing: [{ kind: "pairs", partner: "r3", row: "r1", rule: "=" }],
      type: "open-incomplete",
    });
    expect((await certify(asked, bare)).mmb).toBeUndefined();

    const t = new TreeBuilder(asked.resolved.rootText);
    t.stack(t.rootNode, ["r1", "r2"], ["Fb"], "=");
    t.open(t.rootNode);
    const answer = await certify(asked, t);

    expect(answer.directions).toEqual({ [`${t.rootNode} r1`]: "tb_id_ab" });
    expect(
      (await judgeAsBrowser(asked, t)).ends.get(t.rootNode),
    ).toBeUndefined();
    expect(
      (await judgeAsServer(asked, answer)).ends.get(t.rootNode),
    ).toBeUndefined();
    // A substitution develops neither row it cites.
    expect(
      (await judgeAsServer(asked, answer)).marks.get("r1"),
    ).toBeUndefined();
    expect(await gradeAnswer(asked.item, answer)).toBe("correct");
  });

  test("is not owed into a row that is not a literal", async () => {
    const asked = await consistency("a=b", "Fa → Ga");
    const t = new TreeBuilder(asked.resolved.rootText);
    const {
      nodes: [left, right],
      rows: [[nfa], [ga]],
    } = t.split(t.rootNode, "r2", [["¬Fa"], ["Ga"]], "→");
    t.stack(left, ["r1", nfa as string], ["¬Fb"], "=");
    t.stack(right, ["r1", ga as string], ["Gb"], "=");
    t.open(left);
    const answer = await certify(asked, t);

    // `Fa → Ga` with every a made b is owed nowhere.
    expect((await judgeAsServer(asked, answer)).problems).toEqual([]);
    expect(
      (await judgeAsServer(asked, answer)).ends.get(left),
    ).toBeUndefined();
  });

  test("is certified only in the direction the answer names", async () => {
    const asked = await consistency("a=b", "Fa", "¬Gb");
    const t = new TreeBuilder(asked.resolved.rootText);
    t.stack(t.rootNode, ["r1", "r2"], ["Fb"], "=");
    t.open(t.rootNode);
    const answer = await certify(asked, t);
    const key = `${t.rootNode} r1`;

    expect(await gradeAnswer(asked.item, answer)).toBe("correct");
    // The other way round, `¬Ga` is missing: the certificate proves the
    // branch developed one way, and the goal states the other.
    expect(
      await gradeAnswer(asked.item, {
        ...answer,
        directions: { [key]: "tb_id_ba" },
      }),
    ).toBe("incorrect");
    // With none named, the rule's own statement is asked.
    const { directions: _directions, ...unnamed } = answer;
    expect(await gradeAnswer(asked.item, unnamed)).toBe("incorrect");
    // A pair the tree does not have is no answer.
    await expect(
      gradeAnswer(asked.item, {
        ...answer,
        directions: { "n9 r1": "tb_id_ab" },
      }),
    ).rejects.toThrow("answer refused");
  });

  test("owes nothing a self-identity would be", async () => {
    const asked = await consistency("a=b", "b=a");
    const t = new TreeBuilder(asked.resolved.rootText);
    t.open(t.rootNode);

    expect(
      (await judgeAsBrowser(asked, t)).ends.get(t.rootNode),
    ).toBeUndefined();
    expect((await certify(asked, t)).mmb).toBeDefined();
  });
});

describe("closure, as the theory says it", () => {
  test("a branch marked open that a closure rule closes is refused", async () => {
    const asked = await consistency("P", "¬P");
    const t = new TreeBuilder(asked.resolved.rootText);
    t.open(t.rootNode);

    expect(
      (await judgeAsServer(asked, t.answer())).ends.get(t.rootNode),
    ).toEqual({
      rows: ["r1", "r2"],
      type: "open-contradiction",
    });
  });

  test("a row a≠a closes a branch alone", async () => {
    const asked = await consistency("¬a = a");
    const t = new TreeBuilder(asked.resolved.rootText);
    t.open(t.rootNode);

    expect(
      (await judgeAsServer(asked, t.answer())).ends.get(t.rootNode),
    ).toEqual({
      rows: ["r1"],
      type: "open-contradiction",
    });
  });

  // A closure rule may cite any number of rows: an author's theory that
  // closes on a sentence, another, and the negation of their conjunction.
  test("a closure rule citing three rows closes on all three", async () => {
    const ubc = (theorySourceByFileName("forallx-ubc.mm0") ?? "").replace(
      "--| @fallback tb_close_neq\n",
      "--| @fallback tb_close_neq\naxiom tb_close_three (ga: ctx) (ph ps: wff): $ focus ga at (ph ; ps ; ¬ (ph & ps)) $;\n--| @fallback tb_close_three\n",
    );
    expect(ubc).toContain("tb_close_three");
    const asked = await lessonTree(
      `:::aufbau-mm0{name="three"}\n${ubc}\n:::\n\n::::truth-tree{#t system="three" finish="one-open"}\nIs this set consistent?\n\n- P\n- Q\n- ¬(P & Q)\n::::`,
    );
    const t = new TreeBuilder(asked.resolved.rootText);
    t.open(t.rootNode);
    const report = await judgeAsServer(asked, t.answer());
    const end = report.ends.get(t.rootNode);

    expect(end).toEqual({
      rows: ["r1", "r2", "r3"],
      type: "open-contradiction",
    });
    expect(
      describeEndProblem(end as EndProblem, words, (id) => id.slice(1)),
    ).toBe("Rows 1, 2, 3 close this branch, so it cannot be marked open.");

    const closed = new TreeBuilder(asked.resolved.rootText);
    closed.close(closed.rootNode, "r3", "r1", "r2");

    expect(await gradeAnswer(asked.item, await certify(asked, closed))).toBe(
      "correct",
    );
  });

  test("an open branch's closing rows are named whatever the rule", () => {
    const number = (id: string) => id.slice(1);

    expect(
      describeEndProblem(
        { rows: ["r4"], type: "open-contradiction" },
        words,
        number,
      ),
    ).toBe("Row 4 closes this branch, so it cannot be marked open.");
    expect(
      describeEndProblem(
        { rows: ["r1", "r4"], type: "open-contradiction" },
        words,
        number,
      ),
    ).toBe("Rows 1 and 4 close this branch, so it cannot be marked open.");
  });
});

describe("a list in a pattern", () => {
  // A member of a list that is neither its constructor nor its unit (`1`, or
  // `t2s a` in a `seq`) is one member: matched as itself, not as a list again.
  test.each([
    ["open-logic-tableaux", "wff", "A (te , a)", "A (b , a)"],
    ["open-logic-intuitionistic", "pfx", "1", "1"],
  ])("%s matches %s %s against %s", (id, sort, pattern, term) => {
    const language = languageById(id);

    if (language === null) {
      throw new Error(`no language ${id}`);
    }

    const scope = new Map([
      ["te", "tm"],
      ["a", "name"],
      ["b", "name"],
    ]);
    const read = (text: string) => {
      const parsed = language.parse(text, {
        lints: false,
        mode: "engine",
        scope,
        sort,
      });

      if (!parsed.ok) {
        throw new Error(`${text} does not read`);
      }

      return parsed.term;
    };

    expect(
      matchTerm(
        language,
        read(pattern),
        read(term),
        new Map([["te", false]]),
      ),
    ).not.toBeNull();
  });
});

describe("another calculus's roles", () => {
  const signed = readFileSync(
    new URL("./helpers/signed-tableau.mm0", import.meta.url),
    "utf8",
  );
  const lesson = (theory: string, finish: string) =>
    `:::aufbau-mm0{name="signed"}\n${theory}\n:::\n\n::::truth-tree{#t system="signed" finish="${finish}"}\nIs this set consistent?\n\n- T P ∧ Q\n- T R\n::::`;
  const codes = async (source: string) =>
    (await compileCarnapMarkdown(source)).diagnostics.map((each) => [
      each.code,
      each.params?.rule ?? each.params?.name,
    ]);

  test("a theory that says nothing cannot have a branch marked open", async () => {
    expect(await codes(lesson(signed, "one-open"))).toEqual([
      ["truth_tree_no_development", "signed"],
    ]);
    expect(await codes(lesson(signed, "closed"))).toEqual([]);
  });

  test("a role that does not read is the author's to fix", async () => {
    const misspelt = signed.replace(
      "--| @syntax alias T∧",
      "--| @syntax role tree.development.onse.ph\n--| @syntax alias T∧",
    );

    expect(await codes(lesson(misspelt, "one-open"))).toEqual([
      ["truth_tree_development", "t_and"],
    ]);
  });

  describe("nothing an author writes is passed over in silence", () => {
    const annotated = signed.replace(
      "--| @syntax alias T∧",
      "--| @syntax role tree.development.once\n--| @syntax alias T∧",
    );
    const said = async (theory: string) =>
      (
        await compileCarnapMarkdown(lesson(theory, "one-open"))
      ).diagnostics.map((each) => [
        each.code,
        each.params?.rule,
        each.params?.kind ?? null,
      ]);

    test("a misspelt kind of one word is an unknown kind, not a flag", async () => {
      const misspelt = signed.replace(
        "--| @syntax alias T∧",
        "--| @syntax role tree.development.onse\n--| @syntax alias T∧",
      );

      expect(await said(misspelt)).toEqual([
        ["truth_tree_development", "t_and", "onse"],
      ]);
    });

    test("a role on the axiom a rule falls back on is the rule's", async () => {
      const fallenBackOn = annotated.replace(
        "axiom f_and_l",
        "--| @syntax role tree.development.none.ph\naxiom f_and_l",
      );

      expect(await said(fallenBackOn)).toEqual([
        ["truth_tree_development", "f_and_r", null],
      ]);
    });

    test("a tree role Carnap does not know", async () => {
      const misspelt = annotated.replace(
        "--| @syntax role tree.closes",
        "--| @syntax role tree.closes\n--| @syntax role tree.completness.contents",
      );

      expect(await said(misspelt)).toEqual([
        ["truth_tree_development", "cl", null],
      ]);
    });

    test("a step whose premises are not rows on its branch", async () => {
      const odd = `${annotated}\n--| @syntax alias T¬¬\naxiom t_odd (ga: ctx) (ph: wff): $ ga ≜ ga $ > $ focus ga at T (¬ ¬ ph) $;\n`;

      expect(await said(odd)).toEqual([
        ["truth_tree_development", "t_odd", null],
      ]);
    });

    test("a variant without the instance's binder", async () => {
      // tb_all2's view and axiom, with its first instance's binder renamed.
      const source = theorySourceByFileName("forallx-ubc.mm0") ?? "";
      const from = source.indexOf(
        "--| @view {x: var} (ga: ctx x) (te ue: tm)",
      );
      const to = source.indexOf(";\n", source.indexOf("axiom tb_all2", from));
      const ubc =
        source.slice(0, from) +
        source.slice(from, to).replaceAll(/\bte\b/gu, "se") +
        source.slice(to);
      expect(ubc).toContain("axiom tb_all2 {x: var} (ga: ctx x) (se ue: tm)");
      const result = await compileCarnapMarkdown(
        `:::aufbau-mm0{name="renamed"}\n${ubc}\n:::\n\n::::truth-tree{#t system="renamed" finish="one-open"}\nIs this set consistent?\n\n- ∀x Fx\n::::`,
      );

      expect(
        result.diagnostics.map((each) => [
          each.code,
          each.params?.rule,
          each.params?.binder,
        ]),
      ).toEqual([["truth_tree_development", "tb_all2", "te"]]);
    });

    test("a mark without its role is not a row", async () => {
      const ubc = (theorySourceByFileName("forallx-ubc.mm0") ?? "").replace(
        "--| @syntax role tree.mark\n",
        "",
      );
      expect(ubc).not.toContain("role tree.mark\n");
      const result = await compileCarnapMarkdown(
        `:::aufbau-mm0{name="unmarked"}\n${ubc}\n:::\n\n::::truth-tree{#t system="unmarked" finish="one-open"}\nIs this set consistent?\n\n- ∀x Fx\n::::`,
      );

      expect(
        result.diagnostics.map((each) => [each.code, each.params?.rule]),
      ).toContainEqual(["truth_tree_development", "tb_and"]);
    });

    test("a rule that writes no mark, in a system whose rules do", async () => {
      const ubc = (theorySourceByFileName("forallx-ubc.mm0") ?? "").replace(
        "$ closes ga ; chk (¬ ¬ ph) ; ph $",
        "$ closes ga ; ph $",
      );
      const result = await compileCarnapMarkdown(
        `:::aufbau-mm0{name="unmarked"}\n${ubc}\n:::\n\n::::truth-tree{#t system="unmarked" finish="one-open"}\nIs this set consistent?\n\n- ¬¬A\n::::`,
      );

      expect(
        result.diagnostics.map((each) => [each.code, each.params?.rule]),
      ).toEqual([["truth_tree_development", "tb_nn"]]);
    });

    test("a rule that writes a new name it has no view of", async () => {
      const olp = (
        theorySourceByFileName("open-logic-tableaux.mm0") ?? ""
      ).replace(
        "--| @view {x: var} {a: name} (ga: ctx x) (ph: wff x) (ps: wff): $ closes ga ; 𝕋 ps $ > $ focus ga at (𝕋 ∃ x ph) $\n",
        "",
      );
      const result = await compileCarnapMarkdown(
        `:::aufbau-mm0{name="viewless"}\n${olp}\n:::\n\n::::truth-tree{#t system="viewless" finish="one-open"}\nIs this set consistent?\n\n- 𝕋 ∃x F(x)\n::::`,
      );

      expect(
        result.diagnostics.map((each) => [each.code, each.params?.rule]),
      ).toEqual([["truth_tree_development", "tb_t_ex"]]);
    });

    // A modal prefix's step has no relation, which only the rules judged
    // without the engine need yet (#469): not the author's to fix.
    test.each([
      ["forallx-ubc", "A"],
      ["open-logic-tableaux", "𝕋 A"],
      ["open-logic-intuitionistic", "1 𝕋 A"],
      ["open-logic-simple-s5", "1 𝕋 A"],
      ["open-logic-modal-k", "1 𝕋 A"],
      ["open-logic-modal-t", "1 𝕋 A"],
      ["open-logic-modal-d", "1 𝕋 A"],
      ["open-logic-modal-k4", "1 𝕋 A"],
      ["open-logic-modal-b", "1 𝕋 A"],
      ["open-logic-modal-s4", "1 𝕋 A"],
      ["open-logic-modal-s5", "1 𝕋 A"],
    ])("the built-in %s says nothing", async (system, row) => {
      const result = await compileCarnapMarkdown(
        `::::truth-tree{#t system="${system}" finish="one-open"}\nIs this set consistent?\n\n- ${row}\n::::`,
      );

      expect(result.diagnostics).toEqual([]);
    });

    test("a substitution that is not one", async () => {
      const wrong = annotated.replace(
        "--| @syntax role conjunction",
        "--| @syntax role conjunction\n--| @syntax role tree.substitution",
      );

      expect(await said(wrong)).toEqual([
        ["truth_tree_development", "and", null],
      ]);
    });
  });

  test("a signed tableau's open branch is judged by its own rules", async () => {
    const annotated = signed.replace(
      "--| @syntax alias T∧",
      "--| @syntax role tree.development.once\n--| @syntax alias T∧",
    );
    expect(await codes(lesson(annotated, "one-open"))).toEqual([]);

    const asked = await lessonTree(lesson(annotated, "one-open"));
    const bare = new TreeBuilder(asked.resolved.rootText);
    bare.open(bare.rootNode);

    // It writes no marks, so it is judged by its contents.
    expect(
      (await judgeAsBrowser(asked, bare)).ends.get(bare.rootNode),
    ).toEqual({
      missing: [{ kind: "developed", row: "r1" }],
      type: "open-incomplete",
    });

    const t = new TreeBuilder(asked.resolved.rootText);
    t.stack(t.rootNode, "r1", ["T P", "T Q"], "T∧");
    t.open(t.rootNode);

    expect(await gradeAnswer(asked.item, await certify(asked, t))).toBe(
      "correct",
    );
  });
});
