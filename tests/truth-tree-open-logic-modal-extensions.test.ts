import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../src/worker/domain/content";
import { withSystemText } from "../src/worker/exercise-kit/systems/join";
import type { ResolvedTree } from "../src/worker/exercises/truth-tree/grading";
import {
  judgeTree,
  resolveTruthTree,
} from "../src/worker/exercises/truth-tree/grading";
import { markText } from "../src/worker/exercises/truth-tree/labels";
import type {
  RowMark,
  TreeReport,
} from "../src/worker/exercises/truth-tree/report";
import type { TruthTreePublicData } from "../src/worker/exercises/truth-tree/types";
import {
  certifyAnswer,
  engine,
  judgeAsBrowser,
  TreeBuilder,
} from "./helpers/truth-tree";

/**
 * The Open Logic Project's modal logics past K (`more-rules`): each is K's
 * tableaux with the rules for its accessibility relation, `open-logic-modal-t`
 * through `open-logic-modal-s5`, and each refuses the rules it lacks.
 */

type Logic = "k" | "t" | "d" | "b" | "k4" | "s4" | "s5";

async function exercise(
  logic: Logic,
  root: string,
  finish = "closed",
): Promise<{
  item: ExerciseManifestItem;
  resolved: ResolvedTree;
  mm0: string;
}> {
  const result = await compileCarnapMarkdown(
    `::::truth-tree{#t system="open-logic-modal-${logic}" finish="${finish}"}\nShow it.\n\n${root}\n::::`,
  );

  if (!result.ok) {
    throw new Error(
      result.diagnostics
        .map((d) => `${d.code}: ${JSON.stringify(d)}`)
        .join("\n"),
    );
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

  return {
    item: { ...raw, publicData: publicData as never },
    mm0: publicData.mm0,
    resolved,
  };
}

async function judge(
  logic: Logic,
  root: string,
  tree: TreeBuilder,
): Promise<TreeReport> {
  const { mm0, resolved } = await exercise(logic, root);
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

/** A closed tree for `⊢ goal`, written by `build` below its root row. */
interface Proof {
  readonly goal: string;
  readonly build: (tree: TreeBuilder) => void;
}

// The schema each extension's rules prove, by the rule they need.
const T: Proof = {
  build: (tree) => {
    const [box, fa] = tree.stack("n0", "r1", ["1 T: □A", "1 F: A"], "→F");
    const [ta] = tree.stack("n0", box as string, ["1 T: A"], "T□");
    tree.close("n0", ta as string, fa as string);
  },
  goal: "□A → A",
};

const D: Proof = {
  build: (tree) => {
    const [box, dia] = tree.stack("n0", "r1", ["1 T: □A", "1 F: ◇A"], "→F");
    const [td] = tree.stack("n0", box as string, ["1 T: ◇A"], "D[]");
    const [ta] = tree.stack("n0", td as string, ["1.1 T: A"], "◇T");
    const [fa] = tree.stack("n0", dia as string, ["1.1 F: A"], "◇F");
    tree.close("n0", ta as string, fa as string);
  },
  goal: "□A → ◇A",
};

const B: Proof = {
  build: (tree) => {
    const [ta, box] = tree.stack("n0", "r1", ["1 T: A", "1 F: □◇A"], "→F");
    const [dia] = tree.stack("n0", box as string, ["1.1 F: ◇A"], "□F");
    const [fa] = tree.stack("n0", dia as string, ["1 F: A"], "B◇");
    tree.close("n0", ta as string, fa as string);
  },
  goal: "A → □◇A",
};

const FOUR: Proof = {
  build: (tree) => {
    const [box, boxbox] = tree.stack(
      "n0",
      "r1",
      ["1 T: □A", "1 F: □□A"],
      "→F",
    );
    const [fbox] = tree.stack("n0", boxbox as string, ["1.1 F: □A"], "□F");
    const [fa] = tree.stack("n0", fbox as string, ["1.1.1 F: A"], "□F");
    const [tbox] = tree.stack("n0", box as string, ["1.1 T: □A"], "4□");
    const [ta] = tree.stack("n0", tbox as string, ["1.1.1 T: A"], "□T");
    tree.close("n0", ta as string, fa as string);
  },
  goal: "□A → □□A",
};

// more-rules.tex, its one worked tableau: S5 ⊢ □A → □◇A, by 4r◇.
const FIVE: Proof = {
  build: (tree) => {
    const [box, boxdia] = tree.stack(
      "n0",
      "r1",
      ["1 T: □A", "1 F: □◇A"],
      "→F",
    );
    const [dia11] = tree.stack("n0", boxdia as string, ["1.1 F: ◇A"], "□F");
    const [dia1] = tree.stack("n0", dia11 as string, ["1 F: ◇A"], "4r◇");
    const [fa] = tree.stack("n0", dia1 as string, ["1.1 F: A"], "◇F");
    const [ta] = tree.stack("n0", box as string, ["1.1 T: A"], "□T");
    tree.close("n0", ta as string, fa as string);
  },
  goal: "□A → □◇A",
};

async function proves(logic: Logic, proof: Proof): Promise<string[]> {
  const tree = new TreeBuilder([`1 F: ${proof.goal}`]);
  proof.build(tree);
  const report = await judge(logic, `:|-: ${proof.goal}`, tree);
  return report.closed ? problems(report) : ["open", ...problems(report)];
}

describe("the logics past K prove their schemas", () => {
  const cases: readonly [Logic, string, Proof][] = [
    ["t", "T", T],
    ["d", "D", D],
    ["b", "B", B],
    ["k4", "4", FOUR],
    ["s4", "T", T],
    ["s4", "4", FOUR],
    ["s5", "T", T],
    ["s5", "4", FOUR],
    ["s5", "5", FIVE],
  ];

  for (const [logic, schema, proof] of cases) {
    test(`${logic} proves ${schema}`, async () => {
      expect(await proves(logic, proof)).toEqual([]);
    }, 60_000);
  }
});

describe("a logic refuses the rules it lacks", () => {
  const cases: readonly [Logic, string, Proof][] = [
    ["k", "T", T],
    ["k", "D", D],
    ["k", "B", B],
    ["k", "4", FOUR],
    ["k", "5", FIVE],
    ["t", "4", FOUR],
    ["d", "T", T],
    ["k4", "5", FIVE],
    ["s4", "5", FIVE],
  ];

  for (const [logic, schema, proof] of cases) {
    test(`${logic} does not prove ${schema} so`, async () => {
      const found = await proves(logic, proof);

      // Refused at the one step that needs the rule, so the branch stays open.
      expect(found).toHaveLength(2);
      expect(found[0]).toBe("open");
      expect(found[1]).toEndWith(": step-wrong");
    }, 60_000);
  }
});

describe("the more-rules side conditions", () => {
  test("4□ to a prefix not yet on the branch is refused", async () => {
    const tree = new TreeBuilder(["1 T: □A"]);
    const [row] = tree.stack("n0", "r1", ["1.1 T: □A"], "4□");
    const report = await judge("k4", "- □A", tree);

    expect(problems(report)).toContain(`row ${row}: step-wrong`);
  }, 60_000);

  test("B□ wants a row at σ.n, so not at the root's prefix", async () => {
    const tree = new TreeBuilder(["1 T: □A"]);
    const [row] = tree.stack("n0", "r1", ["1 T: A"], "B□");
    const report = await judge("b", "- □A", tree);

    expect(problems(report)).toContain(`row ${row}: step-wrong`);
  }, 60_000);
});

/** Whether the open branch of a tree for `- □p` and `- ◇q` in S5 is done. */
async function s5Branch(with4: boolean) {
  const { item, resolved } = await exercise("s5", "- □p\n- ◇q", "one-open");
  const tree = new TreeBuilder(resolved.rootText);
  tree.stack(tree.rootNode, "r2", ["1.1 T: q"], "◇T");
  tree.stack(tree.rootNode, "r1", ["1.1 T: p"], "□T");
  tree.stack(tree.rootNode, "r1", ["1 T: p"], "T□");

  if (with4) {
    tree.stack(tree.rootNode, "r1", ["1.1 T: □p"], "4□");
  }

  tree.open(tree.rootNode);
  const answer = await certifyAnswer(
    item.publicData as unknown as TruthTreePublicData,
    tree.answer(),
  );

  return {
    report: judgeTree(resolved, answer as never, {
      kind: "verified",
      ok: true,
    }).report,
    root: tree.rootNode,
  };
}

describe("an open branch in S5", () => {
  // 4□ writes 1.1 𝕋 □p, which 4r□ would take back to 1 and T□ to 1.1 𝕋 p:
  // both are on the branch already, so neither is owed again. Judged by steps,
  // writing them would set off the same obligations without end.
  test("is complete when each rule's conclusions are on it", async () => {
    const { report } = await s5Branch(true);

    expect(problems(report)).toEqual([]);
  }, 60_000);

  test("owes 4□ at a prefix it uses", async () => {
    const { report, root } = await s5Branch(false);

    expect(report.ends.get(root)).toEqual({
      missing: [{ names: ["((1) . wa)"], row: "r1" }],
      type: "open-incomplete",
    });
  }, 60_000);
});

describe("a complete branch, as completeness.tex defines one", () => {
  // UBC would have the conjunction checked off; the book asks only that its
  // conjuncts be on the branch, as they are here from the root.
  test("owes a rule nothing whose conclusions are on it already", async () => {
    const { item, resolved } = await exercise(
      "k",
      "- A ∧ B\n- A\n- B",
      "one-open",
    );
    const tree = new TreeBuilder(resolved.rootText);
    tree.open(tree.rootNode);
    const answer = await certifyAnswer(
      item.publicData as unknown as TruthTreePublicData,
      tree.answer(),
    );
    const { report } = judgeTree(resolved, answer as never, {
      kind: "verified",
      ok: true,
    });

    expect(problems(report)).toEqual([]);
  }, 60_000);
});

describe("a logic the table does not have", () => {
  // The book's exercises ask for KT5: T's file with 4r's rules after it.
  test("is a built-in with rules appended in a theory block", async () => {
    const rules = [
      "--| @syntax alias 4r◇ 4r<>",
      "axiom tb_ax_4r_dia (ga: ctx) (si: pfx) (n: idx) (ph: wff):",
      "  $ closes ga ; si 𝔽 ◇ ph $ > $ focus ga at (si . n 𝔽 ◇ ph) $;",
    ].join("\n");
    const result = await compileCarnapMarkdown(
      `:::aufbau-mm0{name="kt5" src="/theories/open-logic-modal-t.mm0"}\n${rules}\n:::\n\n::::truth-tree{#t system="kt5"}\nShow it.\n\n:|-: ${FIVE.goal}\n::::`,
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
    const tree = new TreeBuilder([`1 F: ${FIVE.goal}`]);
    FIVE.build(tree);
    const report = judgeAsBrowser(
      await engine(),
      resolved as ResolvedTree,
      publicData.mm0 as string,
      tree.answer(),
    );

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);
});

describe("a row more than one rule develops", () => {
  // In T, 𝕋 □p is T□'s once and □𝕋's at every prefix: never done with.
  async function marked(withBox: boolean) {
    const { item, resolved } = await exercise("t", "- □p\n- ◇q", "one-open");
    const tree = new TreeBuilder(resolved.rootText);
    tree.stack(tree.rootNode, "r2", ["1.1 T: q"], "◇T");
    tree.stack(tree.rootNode, "r1", ["1 T: p"], "T□");

    if (withBox) {
      tree.stack(tree.rootNode, "r1", ["1.1 T: p"], "□T");
    }

    tree.open(tree.rootNode);
    const answer = await certifyAnswer(
      item.publicData as unknown as TruthTreePublicData,
      tree.answer(),
    );
    const { report } = judgeTree(resolved, answer as never, {
      kind: "verified",
      ok: true,
    });

    return { language: resolved.language, report };
  }

  test("is not checked off by the rule it is used once by", async () => {
    const { report } = await marked(false);

    expect(report.marks.get("r1")).toBeUndefined();
    expect(problems(report)).not.toEqual([]);
  }, 60_000);

  test("lists the prefixes its general rule went to", async () => {
    const { language, report } = await marked(true);

    expect(problems(report)).toEqual([]);
    expect(markText(report.marks.get("r1") as RowMark, language)).toBe(
      "\\1.1",
    );
  }, 60_000);
});
