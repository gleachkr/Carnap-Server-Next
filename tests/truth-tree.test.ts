import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../src/worker/domain/content";
import type { JsonValue } from "../src/worker/domain/json";
import { withSystemText } from "../src/worker/exercise-kit/systems/join";
import { TRUTH_TREE_EXERCISE } from "../src/worker/exercises/truth-tree";
import { resolveTruthTree } from "../src/worker/exercises/truth-tree/grading";
import type { TruthTreePublicData } from "../src/worker/exercises/truth-tree/types";
import {
  TRUTH_TREE_ANSWER_KIND,
  TRUTH_TREE_SCHEMA_VERSION,
} from "../src/worker/exercises/truth-tree/types";
import { passthroughTranslator } from "../src/worker/i18n/translator";
import { TreeBuilder } from "./helpers/truth-tree";

/**
 * The truth-tree type's worker half: the directive, the grader and the
 * review. The checker itself is `tests/truth-tree-check.test.ts`.
 */

function directive(attrs: string, body: string): string {
  return `::::truth-tree{${attrs}}\n${body}\n::::`;
}

async function compileCodes(source: string): Promise<string[]> {
  const result = await compileCarnapMarkdown(source);
  return result.diagnostics.map((d) => d.code);
}

async function declaration(source: string): Promise<ExerciseManifestItem> {
  const result = await compileCarnapMarkdown(source);

  if (!result.ok) {
    throw new Error(
      `compile failed: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }

  const item = result.artifact.manifest[0] as ExerciseManifestItem;

  return {
    ...item,
    publicData: withSystemText(item.publicData, result.artifact.systems),
  };
}

function publicDataOf(item: ExerciseManifestItem): TruthTreePublicData {
  return item.publicData as unknown as TruthTreePublicData;
}

/** A tree builder whose root is the exercise's, as the widget shows it. */
function builderFor(item: ExerciseManifestItem): TreeBuilder {
  const resolved = resolveTruthTree(publicDataOf(item));

  if (resolved === null) {
    throw new Error("the declaration does not resolve");
  }

  return new TreeBuilder(resolved.rootText);
}

async function grade(
  item: ExerciseManifestItem,
  data: JsonValue,
): Promise<{ score: number; status: string; summary: string; html: string }> {
  const normalized = TRUTH_TREE_EXERCISE.normalizeAnswer(
    {
      data,
      kind: TRUTH_TREE_ANSWER_KIND,
      schemaVersion: TRUTH_TREE_SCHEMA_VERSION,
    },
    item,
  );

  if (!normalized.ok) {
    throw new Error(`answer refused: ${normalized.reason}`);
  }

  const evaluation = await TRUTH_TREE_EXERCISE.evaluate(
    normalized.answer,
    item,
    { now: new Date("2026-01-01T00:00:00Z") } as never,
  );
  const review = TRUTH_TREE_EXERCISE.reviewAnswer(normalized.answer, item, {
    audience: "student",
    i18n: passthroughTranslator,
  } as never);

  return {
    html: review.elementHtml ?? "",
    score: evaluation.awardedScore,
    status: evaluation.status,
    summary: review.summary,
  };
}

const VALID = directive(
  '#tt points="3"',
  "Is this argument valid? Use a tree.\n\nP & Q :|-: P",
);
const CONSISTENT = directive(
  "#ts",
  "Is this set consistent?\n\n- P ∨ Q\n- ¬P",
);

describe("the directive", () => {
  test("an argument line asks validity, and its root negates the conclusion", async () => {
    const item = await declaration(VALID);
    const data = publicDataOf(item);
    const resolved = resolveTruthTree(data);

    expect(item.kind).toBe("truth-tree@1");
    expect(data.task).toBe("validity");
    expect(data.premises).toBe(1);
    expect(data.system).toBe("forallx-ubc");
    expect(resolved?.rootText).toEqual(["P & Q", "¬P"]);
    expect(data.promptHtml).toContain("Is this argument valid?");
  });

  test("a list asks consistency", async () => {
    const data = publicDataOf(await declaration(CONSISTENT));

    expect(data.task).toBe("consistency");
    expect(resolveTruthTree(data)?.rootText).toEqual(["P ∨ Q", "¬P"]);
  });

  test("an argument with no premises tests a logical truth", async () => {
    const data = publicDataOf(
      await declaration(directive("#t", ":|-: P ∨ ¬P")),
    );

    expect(resolveTruthTree(data)?.rootText).toEqual(["¬(P ∨ ¬P)"]);
  });

  test("what an author can get wrong", async () => {
    expect(await compileCodes(directive("#t", "Just prose."))).toContain(
      "truth_tree_no_root",
    );
    expect(await compileCodes(directive("#t", "- P\n\nP :|-: Q"))).toContain(
      "truth_tree_mixed_root",
    );
    expect(await compileCodes(directive("#t", "P :|-: Q, R"))).toContain(
      "truth_tree_conclusions",
    );
    expect(await compileCodes(directive("#t", "P :|-:"))).toContain(
      "empty_conclusions",
    );
    expect(await compileCodes(directive("#t", "- P & Q ⊃ R"))).toContain(
      "invalid_formula",
    );
    // Fill mode is gone, and its attribute with it.
    expect(
      await compileCodes(directive('#t develop="fill"', "- P")),
    ).toContain("unknown_attribute");
    expect(
      await compileCodes(directive("#t", "- P\n\nmore prose")),
    ).toContain("invalid_truth_tree_body");
  });

  test("a system that is not a tree theory is refused, with what it lacks", async () => {
    const result = await compileCarnapMarkdown(
      directive('#t system="forallx-magnus"', "- P"),
    );
    const refusal = result.diagnostics.find(
      (one) => one.code === "truth_tree_not_tree_theory",
    );

    expect(refusal?.params?.roles).toBe(
      "tree.closes, tree.focus, tree.unfocus, tree.closure",
    );
  });

  test("a theory block is a tree calculus, and writes its own root", async () => {
    const signed = readFileSync(
      new URL("./helpers/signed-tableau.mm0", import.meta.url),
      "utf8",
    );
    const data = publicDataOf(
      await declaration(
        `:::aufbau-mm0{name="signed"}\n${signed}\n:::\n\n${directive(
          '#t system="signed"',
          "P ∧ Q :|-: P",
        )}`,
      ),
    );

    expect(data.root).toEqual(["(T (P ∧ Q))", "(F P)"]);
  });
});

describe("grading", () => {
  test("a closed tree scores in full, and says what it shows", async () => {
    const item = await declaration(VALID);
    const t = builderFor(item);
    const [p] = t.stack(t.rootNode, "r1", ["P", "Q"]);
    t.close(t.rootNode, p as string, "r2");

    const right = await grade(item, {
      nodes: t.tree.nodes,
    } as unknown as JsonValue);

    expect(right.status).toBe("correct");
    expect(right.score).toBe(3);
    expect(right.summary).toBe(
      "Right: the tree closes, so the argument is valid.",
    );
    expect(right.html).toContain("<carnap-truth-tree");
    expect(right.html).toContain("×");
  });

  test("identity: a root may use it, and a substitution is graded", async () => {
    const item = await declaration(
      directive("#ti", "Is this argument valid?\n\nFa, a = b :|-: Fb"),
    );
    const t = builderFor(item);

    expect(t.rootTexts).toEqual(["Fa", "a=b", "¬Fb"]);

    const [fb] = t.stack(t.rootNode, ["r1", "r2"], ["Fb"]);
    t.close(t.rootNode, "r3", fb as string);
    const dev = t.tree.nodes[0]?.rows.find((row) => row.id === fb)?.dev;

    const graded = await grade(item, {
      nodes: t.tree.nodes,
      rules: { [dev ?? ""]: "=" },
    } as unknown as JsonValue);

    expect(graded.status).toBe("correct");
    expect(graded.summary).toBe(
      "Right: the tree closes, so the argument is valid.",
    );
    // The margin is the step's citation and the rule it names.
    expect(graded.html).toContain(
      '<span class="tableau-margin-cites">1, 2</span> <span class="tableau-margin-rule">=</span>',
    );
    expect(graded.html).toContain("Row 4: Fb, from rows 1 and 2, =");
  });

  test("an unfinished tree scores nothing", async () => {
    const item = await declaration(VALID);
    const t = builderFor(item);

    const unfinished = await grade(item, {
      nodes: t.tree.nodes,
    } as unknown as JsonValue);

    expect(unfinished.score).toBe(0);
    expect(unfinished.summary).toBe(
      "The tree is not finished: close every branch, or mark a complete open branch.",
    );
  });

  test("a wrong row is named, with its number", async () => {
    const item = await declaration(VALID);
    const t = builderFor(item);
    t.split(t.rootNode, "r1", [["P"], ["Q"]]);

    const graded = await grade(item, {
      nodes: t.tree.nodes,
    } as unknown as JsonValue);

    expect(graded.summary).toBe(
      "Row 3: The rule for row 1 does not split the branch.",
    );
  });

  test("a complete open branch answers a consistency question", async () => {
    const item = await declaration(CONSISTENT);
    const t = builderFor(item);
    const {
      nodes: [p, q],
      rows: [[pRow]],
    } = t.split(t.rootNode, "r1", [["P"], ["Q"]]);
    t.close(p, "r2", pRow as string);
    t.open(q);

    const graded = await grade(item, {
      nodes: t.tree.nodes,
    } as unknown as JsonValue);

    expect(graded.status).toBe("correct");
  });

  test("a tree whose root is not the exercise's scores nothing", async () => {
    const item = await declaration(VALID);
    const t = new TreeBuilder(["Q & P", "¬P"]);

    const graded = await grade(item, {
      nodes: t.tree.nodes,
    } as unknown as JsonValue);

    expect(graded.score).toBe(0);
    expect(graded.summary).toBe(
      "Row 1: This is not the sentence the exercise gives.",
    );
  });

  test("only JSON that is not a tree is refused", async () => {
    const item = await declaration(VALID);
    const refused = TRUTH_TREE_EXERCISE.normalizeAnswer(
      {
        data: { nodes: [{ id: 1 }] } as unknown as JsonValue,
        kind: TRUTH_TREE_ANSWER_KIND,
        schemaVersion: TRUTH_TREE_SCHEMA_VERSION,
      },
      item,
    );

    expect(refused.ok).toBe(false);

    // Rules are a record of short names, one per development at most.
    const root = builderFor(item).tree.nodes;
    const withRules = (rules: unknown) =>
      TRUTH_TREE_EXERCISE.normalizeAnswer(
        {
          data: { nodes: root, rules } as unknown as JsonValue,
          kind: TRUTH_TREE_ANSWER_KIND,
          schemaVersion: TRUTH_TREE_SCHEMA_VERSION,
        },
        item,
      ).ok;

    expect(withRules({ root: "&" })).toBe(true);
    expect(withRules(["&"])).toBe(false);
    expect(withRules({ root: 3 })).toBe(false);
    expect(withRules({ root: "x".repeat(65) })).toBe(false);
    expect(withRules({ a: "&", b: "&", c: "&" })).toBe(false);
  });

  test("nodes that are not one tree are refused, and so is a tree too big to read", async () => {
    const item = await declaration(VALID);
    const row = (id: string) => ({ cites: [], dev: "d", id, text: "P" });
    const refuses = (nodes: unknown[]) =>
      !TRUTH_TREE_EXERCISE.normalizeAnswer(
        {
          data: { nodes } as unknown as JsonValue,
          kind: TRUTH_TREE_ANSWER_KIND,
          schemaVersion: TRUTH_TREE_SCHEMA_VERSION,
        },
        item,
      ).ok;

    // A node that is its own child would have the checker walk forever.
    expect(
      refuses([
        { id: "r", parent: null, rows: [row("a")] },
        { id: "r", parent: "r", rows: [] },
      ]),
    ).toBe(true);
    // A row id used twice would have one row judged and another shown.
    expect(
      refuses([
        { id: "r", parent: null, rows: [row("a")] },
        { id: "n", parent: "r", rows: [row("a")] },
      ]),
    ).toBe(true);
    // A child before its parent, or a second root.
    expect(
      refuses([
        { id: "n", parent: "r", rows: [] },
        { id: "r", parent: null, rows: [] },
      ]),
    ).toBe(true);
    expect(
      refuses([
        { id: "r", parent: null, rows: [] },
        { id: "s", parent: null, rows: [] },
      ]),
    ).toBe(true);
    // A comb of empty nodes, and a row no student would type.
    expect(
      refuses([
        { id: "0", parent: null, rows: [] },
        ...Array.from({ length: 1200 }, (_, at) => ({
          id: String(at + 1),
          parent: String(at),
          rows: [],
        })),
      ]),
    ).toBe(true);
    expect(
      refuses([
        {
          id: "r",
          parent: null,
          rows: [{ ...row("a"), text: "P".repeat(2000) }],
        },
      ]),
    ).toBe(true);

    expect(
      refuses([
        { id: "r", parent: null, rows: [row("a")] },
        { id: "n", parent: "r", rows: [row("b")] },
      ]),
    ).toBe(false);
  });

  test("a tree past the row cap is answered without being read", async () => {
    const item = await declaration(VALID);
    const t = builderFor(item);
    t.stack(
      t.rootNode,
      "r1",
      Array.from({ length: 250 }, (_, at) => `P${at}`),
    );

    const graded = await grade(item, {
      nodes: t.tree.nodes,
    } as unknown as JsonValue);

    expect(graded.score).toBe(0);
    expect(graded.summary).toContain("200");
  });

  test("terse feedback gives only the verdict in review", async () => {
    const item = await declaration(
      directive('#tt feedback="terse"', "P & Q :|-: P"),
    );
    const t = builderFor(item);
    t.split(t.rootNode, "r1", [["P"], ["Q"]]);

    const graded = await grade(item, {
      nodes: t.tree.nodes,
    } as unknown as JsonValue);

    expect(graded.summary).toBe("The tree is not right yet.");
  });
});

describe("rendering", () => {
  test("the element draws the root inert, and asks no question", async () => {
    const result = await compileCarnapMarkdown(VALID);

    if (!result.ok) {
      throw new Error("compile failed");
    }

    const node = result.artifact.document.nodes.find(
      (each) => each.kind === "exercise",
    );

    if (node === undefined || node.kind !== "exercise") {
      throw new Error("no exercise node");
    }

    const html = TRUTH_TREE_EXERCISE.render(
      {
        ...node,
        publicData: withSystemText(node.publicData, result.artifact.systems),
      },
      { heading: { level: 2, number: 1 }, i18n: passthroughTranslator },
    );

    expect(html).toContain("<carnap-truth-tree");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("P &amp; Q");
    expect(html).toContain("¬P");
    expect(html).not.toContain('type="radio"');
    // The outline a screen reader reads.
    expect(html).toContain("Row 1: P &amp; Q");
  });
});
