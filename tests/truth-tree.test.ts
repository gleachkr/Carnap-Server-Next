import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../src/worker/domain/content";
import type { JsonValue } from "../src/worker/domain/json";
import { MAX_CERTIFICATE_BASE64_LENGTH } from "../src/worker/exercise-kit/proof/certificate";
import { withSystemText } from "../src/worker/exercise-kit/systems/join";
import { TRUTH_TREE_EXERCISE } from "../src/worker/exercises/truth-tree";
import {
  judgeTree,
  resolveTruthTree,
  treeProofOf,
} from "../src/worker/exercises/truth-tree/grading";
import type { TruthTreePublicData } from "../src/worker/exercises/truth-tree/types";
import {
  TRUTH_TREE_ANSWER_KIND,
  TRUTH_TREE_SCHEMA_VERSION,
} from "../src/worker/exercises/truth-tree/types";
import { passthroughTranslator } from "../src/worker/i18n/translator";
import {
  certifyAnswer,
  certifyTree,
  TreeBuilder,
} from "./helpers/truth-tree";

/**
 * The truth-tree type's worker half: the directive, the grader and the
 * review. The judgement itself is `tests/truth-tree-aufbau.test.ts` and
 * `tests/truth-tree-criteria.test.ts`.
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

/** A tree, certified as the browser would certify it. */
async function certified(
  item: ExerciseManifestItem,
  answer: { readonly nodes: unknown; readonly rules?: unknown },
): Promise<JsonValue> {
  return (await certifyAnswer(
    publicDataOf(item),
    answer,
  )) as unknown as JsonValue;
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
    {
      ...(normalized.certificate === undefined
        ? {}
        : { certificate: normalized.certificate }),
      now: new Date("2026-01-01T00:00:00Z"),
    } as never,
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
  '#ts finish="one-open"',
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
  test("a closed tree, certified, scores in full", async () => {
    const item = await declaration(VALID);
    const t = builderFor(item);
    const [p] = t.stack(t.rootNode, "r1", ["P", "Q"], "&");
    t.close(t.rootNode, p as string, "r2");

    const right = await grade(item, await certified(item, t.answer()));

    expect(right.status).toBe("correct");
    expect(right.score).toBe(3);
    // The review has the tree and not the certificate, so it says nothing
    // of what only the engine could tell.
    expect(right.summary).toBe("Truth tree");
    expect(right.html).toContain("<carnap-truth-tree");
    expect(right.html).toContain("×");
  });

  test("a closed tree without its certificate, or with another's, scores nothing", async () => {
    const item = await declaration(VALID);
    const t = builderFor(item);
    const [p] = t.stack(t.rootNode, "r1", ["P", "Q"], "&");
    t.close(t.rootNode, p as string, "r2");
    const other = builderFor(item);
    const [q] = other.stack(other.rootNode, "r1", ["P", "Q"], "&");
    other.close(other.rootNode, q as string, "r2");
    other.stack(other.rootNode, "r1", ["P", "Q"], "&");
    const mmb = await certifyTree(publicDataOf(item), other.answer());

    expect(mmb).toBeDefined();
    expect((await grade(item, t.answer() as never)).score).toBe(0);
    expect((await grade(item, { ...t.answer(), mmb } as never)).score).toBe(
      0,
    );
  });

  test("without the engine's word, a done tree is unconfirmed and an undone one unfinished", async () => {
    const item = await declaration(VALID);
    const resolved = resolveTruthTree(publicDataOf(item));
    const t = builderFor(item);
    const [p] = t.stack(t.rootNode, "r1", ["P", "Q"], "&");
    const open = judgeTree(resolved as never, t.answer(), { kind: "none" });

    t.close(t.rootNode, p as string, "r2");

    const closed = judgeTree(resolved as never, t.answer(), { kind: "none" });
    const confirmed = judgeTree(resolved as never, t.answer(), {
      kind: "verified",
      ok: true,
    });

    expect(open.problem).toEqual({ finish: "closed", type: "unfinished" });
    expect(open.report.finishedIfConfirmed).toBe(false);
    expect(closed.problem).toEqual({ type: "unconfirmed" });
    expect(closed.report.finished).toBe(false);
    expect(closed.report.finishedIfConfirmed).toBe(true);
    expect(confirmed.problem).toBeNull();
    expect(confirmed.report.finished).toBe(true);
  });

  test("a step naming the wrong rule does not certify", async () => {
    const item = await declaration(VALID);
    const t = builderFor(item);
    const [p] = t.stack(t.rootNode, "r1", ["P", "Q"], "∨");
    t.close(t.rootNode, p as string, "r2");

    expect(await certifyTree(publicDataOf(item), t.answer())).toBeUndefined();
    expect(
      (await grade(item, await certified(item, t.answer()))).status,
    ).toBe("incorrect");
  });

  test("identity: a root may use it, and a substitution is graded", async () => {
    const item = await declaration(
      directive("#ti", "Is this argument valid?\n\nFa, a = b :|-: Fb"),
    );
    const t = builderFor(item);

    expect(t.rootTexts).toEqual(["Fa", "a=b", "¬Fb"]);

    const [fb] = t.stack(t.rootNode, ["r1", "r2"], ["Fb"], "=");
    t.close(t.rootNode, "r3", fb as string);

    const graded = await grade(item, await certified(item, t.answer()));

    expect(graded.status).toBe("correct");
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
      "The tree is not finished: close every branch.",
    );
  });

  test("a step with no rule named is unfinished, not wrong", async () => {
    const item = await declaration(VALID);
    const t = builderFor(item);
    const [p] = t.stack(t.rootNode, "r1", ["P", "Q"]);
    t.close(t.rootNode, p as string, "r2");

    const graded = await grade(item, await certified(item, t.answer()));

    expect(graded.score).toBe(0);
    expect(graded.summary).toBe(
      "Row 3: Name the rule this step uses: type it in the margin, after the row it develops.",
    );
  });

  test("a complete open branch answers a consistency question", async () => {
    const item = await declaration(CONSISTENT);
    const t = builderFor(item);
    const {
      nodes: [p, q],
      rows: [[pRow]],
    } = t.split(t.rootNode, "r1", [["P"], ["Q"]], "∨");
    t.close(p, "r2", pRow as string);
    t.open(q);

    const graded = await grade(item, await certified(item, t.answer()));

    expect(graded.status).toBe("correct");
  });

  test("a root with nothing to develop, marked open, is certified complete", async () => {
    const item = await declaration(
      directive(
        '#tl finish="one-open"',
        "Is this set consistent?\n\n- Fa\n- ¬Gb",
      ),
    );
    const t = builderFor(item);
    t.open(t.rootNode);

    const answer = await certified(item, t.answer());

    // No inference, but the certificate proves each row developed.
    expect((answer as { mmb?: string }).mmb).toBeDefined();
    expect((await grade(item, answer)).status).toBe("correct");
  });

  test("a row written below the root with no citation is no assumption", async () => {
    const item = await declaration(
      directive("#tu", "Is this set consistent?\n\n- P"),
    );
    const t = builderFor(item);
    const [row] = t.stack(t.rootNode, null, ["¬P"]);
    t.close(t.rootNode, "r1", row as string);

    const graded = await grade(item, await certified(item, t.answer()));

    expect(graded.status).not.toBe("correct");
    expect(graded.score).toBe(0);
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

  test("a tree's certificate may be far larger than a proof's, up to 8 MiB", async () => {
    const item = await declaration(VALID);
    const root = builderFor(item).tree.nodes;
    const accepts = (length: number) =>
      TRUTH_TREE_EXERCISE.normalizeAnswer(
        {
          data: {
            mmb: "A".repeat(length),
            nodes: root,
          } as unknown as JsonValue,
          kind: TRUTH_TREE_ANSWER_KIND,
          schemaVersion: TRUTH_TREE_SCHEMA_VERSION,
        },
        item,
      ).ok;

    // Past the proof types' 256 KiB, as a long first-order branch's is.
    expect(accepts(MAX_CERTIFICATE_BASE64_LENGTH + 4)).toBe(true);
    expect(accepts(8 * 1024 * 1024)).toBe(true);
    expect(accepts(8 * 1024 * 1024 + 4)).toBe(false);
  });

  test("nodes that are not one tree are refused, and so is a tree too big to read", async () => {
    const item = await declaration(VALID);
    const row = (id: string, dev = `d${id}`) => ({
      cites: [],
      dev,
      id,
      text: "P",
    });
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

    // One development written in two places would be two steps under one
    // id: a second run in the same node, or a run below the first.
    expect(
      refuses([
        {
          id: "r",
          parent: null,
          rows: [row("a", "d"), row("b", "e"), row("c", "d")],
        },
      ]),
    ).toBe(true);
    expect(
      refuses([
        { id: "r", parent: null, rows: [row("a", "d")] },
        { id: "n", parent: "r", rows: [row("b", "d")] },
        { id: "m", parent: "r", rows: [row("c", "d")] },
      ]),
    ).toBe(true);
    expect(
      refuses([
        { id: "r", parent: null, rows: [row("a")] },
        { id: "n", parent: "r", rows: [row("b", "s"), row("c", "s")] },
        { id: "m", parent: "r", rows: [row("d", "s")] },
        { id: "k", parent: "n", rows: [row("e", "s")] },
      ]),
    ).toBe(true);

    // A split's branches share its development.
    expect(
      refuses([
        { id: "r", parent: null, rows: [row("a")] },
        { id: "n", parent: "r", rows: [row("b", "s"), row("c", "s")] },
        { id: "m", parent: "r", rows: [row("d", "s"), row("e")] },
      ]),
    ).toBe(false);
  });

  test("rules and instances name only developments and rows the tree has", async () => {
    const item = await declaration(VALID);
    const t = builderFor(item);
    const [p] = t.stack(t.rootNode, "r1", ["P", "Q"], "&");
    const accepts = (extra: Record<string, unknown>) =>
      TRUTH_TREE_EXERCISE.normalizeAnswer(
        {
          data: { ...t.answer(), ...extra } as unknown as JsonValue,
          kind: TRUTH_TREE_ANSWER_KIND,
          schemaVersion: TRUTH_TREE_SCHEMA_VERSION,
        },
        item,
      ).ok;

    expect(accepts({})).toBe(true);
    expect(accepts({ instances: { [p as string]: "a" } })).toBe(true);
    expect(accepts({ instances: { nowhere: "a" } })).toBe(false);
    expect(accepts({ rules: { ...t.answer().rules, nowhere: "&" } })).toBe(
      false,
    );
    expect(
      accepts({ rules: { ...t.answer().rules, ["x".repeat(5000)]: "&" } }),
    ).toBe(false);
  });

  test("a split with an empty branch is reported, not a crash", async () => {
    const item = await declaration(CONSISTENT);
    const t = builderFor(item);
    const {
      nodes: [, q],
    } = t.split(t.rootNode, "r1", [["P"], ["Q"]], "∨");
    const nodes = t.tree.nodes.map((node) =>
      node.id === q ? { ...node, rows: [] } : node,
    );

    const graded = await grade(item, { nodes } as unknown as JsonValue);

    expect(graded.status).toBe("incorrect");
    expect(graded.summary).toContain("This branch has no rows.");
  });

  test("an empty node with nodes below it is reported too", async () => {
    const item = await declaration(CONSISTENT);
    const t = builderFor(item);
    const {
      nodes: [p],
    } = t.split(t.rootNode, "r1", [["P"], ["Q"]], "∨");
    t.split(p, "r2", [["¬P"], ["¬P"]], "∨");
    const nodes = t.tree.nodes.map((node) =>
      node.id === p ? { ...node, rows: [] } : node,
    );

    const graded = await grade(item, { nodes } as unknown as JsonValue);

    expect(graded.status).toBe("incorrect");
    expect(graded.summary).toContain("This branch has no rows.");
  });

  test("a declaration whose theory text is not text is an error, not a crash", async () => {
    const item = await declaration(VALID);
    const broken = {
      ...item,
      publicData: { ...publicDataOf(item), mm0: 5 } as unknown as JsonValue,
    } as ExerciseManifestItem;
    const t = builderFor(item);

    const evaluation = await TRUTH_TREE_EXERCISE.evaluate(
      {
        data: t.answer() as unknown as JsonValue,
        kind: TRUTH_TREE_ANSWER_KIND,
        schemaVersion: TRUTH_TREE_SCHEMA_VERSION,
      },
      broken,
      { now: new Date("2026-01-01T00:00:00Z") } as never,
    );

    expect(evaluation.status).toBe("error");
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

  test("a tree far past the row cap is not written down at all", async () => {
    const item = await declaration(VALID);
    const resolved = resolveTruthTree(publicDataOf(item));
    const t = builderFor(item);
    let cite = "r1";

    // Every row cited and named, so each would be a step restating its
    // branch: some 60 MB of theorems, were they written.
    for (let at = 0; at < 990; at += 1) {
      [cite] = t.stack(t.rootNode, cite, ["P & Q & P & Q"], "&") as [string];
    }

    const proof = treeProofOf(resolved as never, t.answer());

    expect(proof.oversize).toEqual({ cap: "rows", limit: 200 });
    expect(proof.goal).toBeNull();
    expect((await grade(item, t.answer() as never)).summary).toContain("200");
  });

  test("a tree under the row cap whose theorems are too long is not checked", async () => {
    const item = await declaration(VALID);
    const resolved = resolveTruthTree(publicDataOf(item));
    const t = builderFor(item);
    const long = Array.from({ length: 150 }, () => "P").join(" & ");

    // 150 rows of 600 characters on one branch: under the row cap and the
    // JSON cap, and some 13 MB of theorems.
    for (let at = 0; at < 150; at += 1) {
      t.stack(t.rootNode, "r1", [long], "&");
    }

    const proof = treeProofOf(resolved as never, t.answer());
    const graded = await grade(item, t.answer() as never);

    expect(proof.oversize).toEqual({ cap: "text" });
    expect(graded.score).toBe(0);
    expect(graded.summary).toBe(
      "The tree is too large to check: its branches hold too much text.",
    );
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
