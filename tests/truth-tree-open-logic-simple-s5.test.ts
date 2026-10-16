import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../src/worker/domain/content";
import { withSystemText } from "../src/worker/exercise-kit/systems/join";
import type { ResolvedTree } from "../src/worker/exercises/truth-tree/grading";
import { resolveTruthTree } from "../src/worker/exercises/truth-tree/grading";
import { markText } from "../src/worker/exercises/truth-tree/labels";
import type {
  RowMark,
  TreeReport,
} from "../src/worker/exercises/truth-tree/report";
import type { TruthTreePublicData } from "../src/worker/exercises/truth-tree/types";
import { theorySourceByFileName } from "../src/worker/logic/theories";
import {
  certifyAnswer,
  engine,
  judgeAsBrowser,
  TreeBuilder,
} from "./helpers/truth-tree";

/**
 * The Open Logic Project's simplified tableaux for S5
 * (`open-logic-simple-s5.mm0`, `simple-S5`): prefixes are positive integers,
 * `2 𝕋 A`, because in S5 every world sees every world.
 */

async function exercise(
  root: string,
  finish = "closed",
): Promise<{
  item: ExerciseManifestItem;
  resolved: ResolvedTree;
  mm0: string;
}> {
  const result = await compileCarnapMarkdown(
    `::::truth-tree{#t system="open-logic-simple-s5" finish="${finish}"}\nShow it.\n\n${root}\n::::`,
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

/** The text of a file from `start` up to `end`. */
function section(file: string, start: string, end: string): string {
  const text = theorySourceByFileName(file) ?? "";
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);

  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);

  return text.slice(from, to);
}

describe("open-logic-simple-s5", () => {
  // The header says so: a change to K's language or propositional rules is
  // a change to this file too.
  test("shares K's language, rows and propositional rules word for word", () => {
    const shared: readonly [string, string][] = [
      ["--| @syntax brackets ( )", "-- ## Prefixes"],
      [
        "-- ## Prefixed signed formulas\n--\n-- The sign",
        "-- ## The modal rules",
      ],
    ];

    for (const [start, end] of shared) {
      expect(section("open-logic-simple-s5.mm0", start, end)).toBe(
        section("open-logic-modal-k.mm0", start, end),
      );
    }
  });

  test("an argument's root is at prefix 1", async () => {
    const { resolved } = await exercise("□A :|-: ◇A");

    expect(resolved.root).toEqual(["((1) 𝕋 (□ A))", "((1) 𝔽 (◇ A))"]);
  });

  // simple-S5.tex, its one worked tableau: S5 ⊢ ◇A → □◇A.
  test("the book's tableau for ◇A → □◇A", async () => {
    const tree = new TreeBuilder(["1 F: ◇A → □◇A"]);
    const [dia, box] = tree.stack("n0", "r1", ["1 T: ◇A", "1 F: □◇A"], "→F");
    const [fdia] = tree.stack("n0", box as string, ["2 F: ◇A"], "□F");
    const [ta] = tree.stack("n0", dia as string, ["3 T: A"], "◇T");
    const [fa] = tree.stack("n0", fdia as string, ["3 F: A"], "◇F");
    tree.close("n0", ta as string, fa as string);
    const report = await judge(":|-: ◇A → □◇A", tree);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);

  test("□𝕋 may go to its own prefix, which is used", async () => {
    const tree = new TreeBuilder(["1 F: □A → A"]);
    const [box, fa] = tree.stack("n0", "r1", ["1 T: □A", "1 F: A"], "→F");
    const [ta] = tree.stack("n0", box as string, ["1 T: A"], "□T");
    tree.close("n0", ta as string, fa as string);
    const report = await judge(":|-: □A → A", tree);

    expect(problems(report)).toEqual([]);
    expect(report.closed).toBe(true);
  }, 60_000);

  test("□𝕋 to a prefix not yet on the branch is refused", async () => {
    const tree = new TreeBuilder(["1 T: □A", "1 F: ◇A"]);
    const [ta] = tree.stack("n0", "r1", ["2 T: A"], "□T");
    const [fa] = tree.stack("n0", "r2", ["2 F: A"], "◇F");
    tree.close("n0", ta as string, fa as string);
    const report = await judge("□A :|-: ◇A", tree);

    expect(problems(report)).toEqual([`row ${ta}: step-wrong`]);
  }, 60_000);

  test("□𝔽 to a prefix already used is refused", async () => {
    const tree = new TreeBuilder(["1 T: ◇B", "1 F: □A"]);
    tree.stack("n0", "r1", ["2 T: B"], "◇T");
    const [at1] = tree.stack("n0", "r2", ["1 F: A"], "□F");
    const [at2] = tree.stack("n0", "r2", ["2 F: A"], "□F");
    const report = await judge("◇B :|-: □A", tree);

    expect(problems(report)).toContain(`row ${at1}: step-wrong`);
    expect(problems(report)).toContain(`row ${at2}: step-wrong`);
  }, 60_000);

  test("a branch closes on one formula at one prefix", async () => {
    const tree = new TreeBuilder(["1 T: ◇A", "1 T: ◇¬A"]);
    const [a] = tree.stack("n0", "r1", ["2 T: A"], "◇T");
    const [na] = tree.stack("n0", "r2", ["3 T: ¬A"], "◇T");
    const [fa] = tree.stack("n0", na as string, ["3 F: A"], "¬T");
    tree.close("n0", a as string, fa as string);
    const report = await judge("- ◇A\n- ◇¬A", tree);

    expect(problems(report)).toContain("end n0: closure-wrong");
  }, 60_000);
});

/** A tree for `- □p` and `- ◇q`, with `□𝕋` at 1 and, if `both`, at 2. */
async function countermodel(both: boolean) {
  const { item, resolved } = await exercise("- □p\n- ◇q", "one-open");
  const tree = new TreeBuilder(resolved.rootText);
  tree.stack(tree.rootNode, "r2", ["2 T: q"], "◇T");
  tree.stack(tree.rootNode, "r1", ["1 T: p"], "□T");

  if (both) {
    tree.stack(tree.rootNode, "r1", ["2 T: p"], "[]T");
  }

  tree.open(tree.rootNode);
  const answer = await certifyAnswer(
    item.publicData as unknown as TruthTreePublicData,
    tree.answer(),
  );

  return {
    certified: answer.mmb !== undefined,
    report: judgeAsBrowser(
      await engine(),
      resolved,
      (item.publicData as unknown as TruthTreePublicData).mm0 ?? "",
      tree.answer(),
    ),
    resolved,
    root: tree.rootNode,
  };
}

describe("an open branch in simple S5", () => {
  test("is complete with □𝕋 at every prefix it uses", async () => {
    const { certified, report, resolved } = await countermodel(true);

    expect(problems(report)).toEqual([]);
    expect(certified).toBe(true);
    expect(
      markText(report.marks.get("r1") as RowMark, resolved.language),
    ).toBe("\\1,2");
  }, 60_000);

  test("is incomplete while □𝕋 skips one", async () => {
    const { certified, report, root } = await countermodel(false);

    expect(report.ends.get(root)).toEqual({
      missing: [{ names: ["w2"], row: "r1" }],
      type: "open-incomplete",
    });
    expect(certified).toBe(false);
  }, 60_000);
});
