import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../src/worker/domain/content";
import { withSystemText } from "../src/worker/exercise-kit/systems/join";
import { TRUTH_TREE_EXERCISE } from "../src/worker/exercises/truth-tree";
import { readTreeDevelopment } from "../src/worker/exercises/truth-tree/aufbau/criteria";
import type { ResolvedTree } from "../src/worker/exercises/truth-tree/grading";
import {
  judgeTree,
  resolveTruthTree,
} from "../src/worker/exercises/truth-tree/grading";
import type { TruthTreePublicData } from "../src/worker/exercises/truth-tree/types";
import {
  TRUTH_TREE_ANSWER_KIND,
  TRUTH_TREE_SCHEMA_VERSION,
} from "../src/worker/exercises/truth-tree/types";
import type { CertifiedAnswer } from "./helpers/truth-tree";
import { certifyAnswer, TreeBuilder } from "./helpers/truth-tree";

/**
 * Completeness by the theory's development criteria (gh #46): what UBC's
 * roles say, what an open branch still needs, the marks, and the instances
 * a general step was written with, found by asking the engine and confirmed
 * again by the server's verification.
 */

async function exercise(
  body: string,
): Promise<{ item: ExerciseManifestItem; resolved: ResolvedTree }> {
  const result = await compileCarnapMarkdown(
    `::::truth-tree{#t finish="one-open"}\n${body}\n::::`,
  );

  if (!result.ok) {
    throw new Error(result.diagnostics.map((d) => d.code).join(", "));
  }

  const raw = result.artifact.manifest[0] as ExerciseManifestItem;
  const item = {
    ...raw,
    publicData: withSystemText(raw.publicData, result.artifact.systems),
  };
  const resolved = resolveTruthTree(
    item.publicData as unknown as TruthTreePublicData,
  );

  if (resolved === null) {
    throw new Error("the exercise does not resolve");
  }

  return { item, resolved };
}

function consistency(...members: string[]) {
  return exercise(
    `Is this set consistent?\n\n${members.map((each) => `- ${each}`).join("\n")}`,
  );
}

async function grade(
  item: ExerciseManifestItem,
  data: CertifiedAnswer,
): Promise<string> {
  const normalized = TRUTH_TREE_EXERCISE.normalizeAnswer(
    {
      data: data as never,
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

  return evaluation.status;
}

function certify(item: ExerciseManifestItem, t: TreeBuilder) {
  return certifyAnswer(
    item.publicData as unknown as TruthTreePublicData,
    t.answer(),
  );
}

/** The report, as the server makes it once the certificate verifies. */
function report(resolved: ResolvedTree, answer: CertifiedAnswer) {
  return judgeTree(resolved, answer as never, { kind: "verified", ok: true })
    .report;
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
    const { item, resolved } = await consistency("∀x Rxb", "Fa");
    const t = new TreeBuilder(resolved.rootText);
    const [rab, rbb] = t.stack(t.rootNode, "r1", ["Rab", "Rbb"], "∀");
    t.open(t.rootNode);

    const answer = await certify(item, t);

    // `Rab` could be the instance at a or at b; the engine says which.
    expect(answer.instances).toEqual({
      [rab as string]: "a",
      [rbb as string]: "b",
    });
    expect(answer.mmb).toBeDefined();
    expect(report(resolved, answer).marks.get("r1")).toEqual({
      names: ["a", "b"],
      type: "general",
    });
    expect(await grade(item, answer)).toBe("correct");
  });

  test("is not developed while a name on its branch is missing", async () => {
    const { item, resolved } = await consistency("∀x Rxb", "Fa");
    const t = new TreeBuilder(resolved.rootText);
    t.stack(t.rootNode, "r1", ["Rab"], "∀");
    t.open(t.rootNode);

    const answer = await certify(item, t);

    expect(report(resolved, answer).ends.get(t.rootNode)).toEqual({
      missing: [{ names: ["b"], row: "r1" }],
      type: "open-incomplete",
    });
    expect(await grade(item, answer)).toBe("incorrect");
  });

  test("an instance the certificate does not prove fails verification", async () => {
    const { item, resolved } = await consistency("∀x Rxb", "Fa");
    const t = new TreeBuilder(resolved.rootText);
    // `Rab` twice: both are the instance at a, so b is still missing.
    const [, second] = t.stack(t.rootNode, "r1", ["Rab", "Rab"], "∀");
    t.open(t.rootNode);

    const answer = await certify(item, t);

    expect(Object.values(answer.instances ?? {})).toEqual(["a", "a"]);
    expect(await grade(item, answer)).toBe("incorrect");

    // Claim the second was the instance at b: the branch would look
    // complete, but the certificate does not prove that link.
    const forged = {
      ...answer,
      instances: { ...answer.instances, [second as string]: "b" },
    };

    expect(report(resolved, forged).ends.get(t.rootNode)).toBeUndefined();
    expect(await grade(item, forged)).toBe("incorrect");
  });

  test("on a branch with no names, needs one instance (nonempty)", async () => {
    const { item, resolved } = await consistency("∀x Fx");
    const bare = new TreeBuilder(resolved.rootText);
    bare.open(bare.rootNode);

    expect(report(resolved, bare.answer()).ends.get(bare.rootNode)).toEqual({
      missing: [{ names: [], row: "r1" }],
      type: "open-incomplete",
    });

    const t = new TreeBuilder(resolved.rootText);
    t.stack(t.rootNode, "r1", ["Fa"], "∀");
    t.open(t.rootNode);

    expect(await grade(item, await certify(item, t))).toBe("correct");
  });

  // Judged as if verified: the engine cannot yet check a vacuous step at all,
  // since `@recover` finds no instance in a body without the variable.
  test("vacuous, needs one step whatever the names", async () => {
    const { item, resolved } = await consistency("∀x Fa", "Gb");
    const t = new TreeBuilder(resolved.rootText);
    t.stack(t.rootNode, "r1", ["Fa"], "∀");
    t.open(t.rootNode);

    const answer = await certify(item, t);

    expect(report(resolved, answer).ends.get(t.rootNode)).toBeUndefined();
    expect(report(resolved, answer).branches.get(t.rootNode)).toEqual({
      right: true,
      type: "open",
    });
  });
});

describe("a step writes what its rule does", () => {
  // A branch is a set to the engine, so a row already on it is written
  // whether or not the rule writes it; the theory's patterns tell.
  async function wrongRows(
    members: string[],
    cite: string,
    rows: string[],
    rule: string,
    closeOn: [number, string],
  ) {
    const { item, resolved } = await consistency(...members);
    const t = new TreeBuilder(resolved.rootText);
    const written = t.stack(t.rootNode, cite, rows, rule);
    t.close(t.rootNode, written[closeOn[0]] as string, closeOn[1]);
    const answer = await certify(item, t);

    return {
      graded: await grade(item, answer),
      rows: report(resolved, answer).rows,
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
});

describe("a row used once", () => {
  test("takes ✓ with the name an existential step introduced", async () => {
    const { item, resolved } = await consistency("∃x Fx", "∀x ¬Gx");
    const t = new TreeBuilder(resolved.rootText);
    t.stack(t.rootNode, "r1", ["Fa"], "∃");
    t.stack(t.rootNode, "r2", ["¬Ga"], "∀");
    t.open(t.rootNode);

    const answer = await certify(item, t);
    const marks = report(resolved, answer).marks;

    expect(marks.get("r1")).toEqual({ names: ["a"], type: "resolved" });
    expect(marks.get("r2")).toEqual({ names: ["a"], type: "general" });
    expect(await grade(item, answer)).toBe("correct");
  });

  test("on a split, needs developing on the branch marked open", async () => {
    const { item, resolved } = await consistency("P ∨ Q", "R & S");
    const t = new TreeBuilder(resolved.rootText);
    const {
      nodes: [left],
    } = t.split(t.rootNode, "r1", [["P"], ["Q"]], "∨");
    t.open(left);

    expect(report(resolved, t.answer()).ends.get(left)).toEqual({
      missing: [{ row: "r2" }],
      type: "open-incomplete",
    });
    expect(await grade(item, await certify(item, t))).toBe("incorrect");
  });
});

// UBC §12.7: an open branch is complete once each identity is substituted
// one way round into every atomic and negated atomic row on it (`pairs`).
describe("an identity on an open branch", () => {
  test("owes its substitution into each literal, one way round", async () => {
    const { item, resolved } = await consistency("a=b", "Fa", "¬Gb");
    const bare = new TreeBuilder(resolved.rootText);
    bare.open(bare.rootNode);

    // Each literal is the other way round already (`Fa` with every b made a
    // is `Fa`), but one way must do for all: Fb, or ¬Ga.
    expect(report(resolved, bare.answer()).ends.get(bare.rootNode)).toEqual({
      missing: [{ row: "r1", substitution: true }],
      type: "open-incomplete",
    });

    const t = new TreeBuilder(resolved.rootText);
    t.stack(t.rootNode, ["r1", "r2"], ["Fb"], "=");
    t.open(t.rootNode);
    const answer = await certify(item, t);

    expect(report(resolved, answer).ends.get(t.rootNode)).toBeUndefined();
    // A substitution develops neither row it cites.
    expect(report(resolved, answer).marks.get("r1")).toBeUndefined();
    expect(await grade(item, answer)).toBe("correct");
  });

  test("is not owed into a row that is not a literal", async () => {
    const { item, resolved } = await consistency("a=b", "Fa → Ga");
    const t = new TreeBuilder(resolved.rootText);
    const {
      nodes: [left, right],
      rows: [[nfa], [ga]],
    } = t.split(t.rootNode, "r2", [["¬Fa"], ["Ga"]], "→");
    t.stack(left, ["r1", nfa as string], ["¬Fb"], "=");
    t.stack(right, ["r1", ga as string], ["Gb"], "=");
    t.open(left);
    const answer = await certify(item, t);

    // `Fa → Ga` with every a made b is owed nowhere.
    expect(report(resolved, answer).problems).toEqual([]);
    expect(report(resolved, answer).ends.get(left)).toBeUndefined();
  });

  test("owes nothing a self-identity would be", async () => {
    const { resolved } = await consistency("a=b", "b=a");
    const t = new TreeBuilder(resolved.rootText);
    t.open(t.rootNode);

    expect(report(resolved, t.answer()).ends.get(t.rootNode)).toBeUndefined();
  });
});

describe("closure, as the theory says it", () => {
  test("a branch marked open that a closure rule closes is refused", async () => {
    const { resolved } = await consistency("P", "¬P");
    const t = new TreeBuilder(resolved.rootText);
    t.open(t.rootNode);

    expect(report(resolved, t.answer()).ends.get(t.rootNode)).toEqual({
      rows: ["r1", "r2"],
      type: "open-contradiction",
    });
  });

  test("a row a≠a closes a branch alone", async () => {
    const { resolved } = await consistency("¬a = a");
    const t = new TreeBuilder(resolved.rootText);
    t.open(t.rootNode);

    expect(report(resolved, t.answer()).ends.get(t.rootNode)).toEqual({
      rows: ["r1"],
      type: "open-contradiction",
    });
  });
});

describe("another calculus's roles", () => {
  const signed = readFileSync(
    new URL("./helpers/signed-tableau.mm0", import.meta.url),
    "utf8",
  );
  const lesson = (theory: string, finish: string) =>
    `:::aufbau-mm0{name="signed"}\n${theory}\n:::\n\n::::truth-tree{#t system="signed" finish="${finish}"}\nIs this set consistent?\n\n- P ∧ Q\n- R\n::::`;
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

  test("a signed tableau's open branch is judged by its own rules", async () => {
    const annotated = signed.replace(
      "--| @syntax alias T∧",
      "--| @syntax role tree.development.once\n--| @syntax alias T∧",
    );
    const result = await compileCarnapMarkdown(lesson(annotated, "one-open"));

    expect(result.diagnostics).toEqual([]);

    if (!result.ok) {
      return;
    }

    const raw = result.artifact.manifest[0] as ExerciseManifestItem;
    const item = {
      ...raw,
      publicData: withSystemText(raw.publicData, result.artifact.systems),
    };
    const resolved = resolveTruthTree(
      item.publicData as unknown as TruthTreePublicData,
    ) as ResolvedTree;
    const bare = new TreeBuilder(resolved.rootText);
    bare.open(bare.rootNode);

    expect(report(resolved, bare.answer()).ends.get(bare.rootNode)).toEqual({
      missing: [{ row: "r1" }],
      type: "open-incomplete",
    });

    const t = new TreeBuilder(resolved.rootText);
    t.stack(t.rootNode, "r1", ["T P", "T Q"], "T∧");
    t.open(t.rootNode);

    expect(await grade(item, await certify(item, t))).toBe("correct");
  });
});
