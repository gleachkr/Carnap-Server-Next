import { describe, expect, test } from "bun:test";
import {
  ContentArtifactError,
  parseContentArtifact,
} from "../src/worker/application/content/artifact";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { CompiledContentArtifact } from "../src/worker/domain/content";
import type { JsonValue } from "../src/worker/domain/json";
import {
  EXERCISE_HYDRATION_VERSION,
  exerciseHydrationScript,
} from "../src/worker/exercises/hydration";
import { keyedArtifact } from "../src/worker/exercises/systems";
import { truthTableLanguage } from "../src/worker/exercises/truth-table/logic";
import { THEORY_SOURCES } from "../src/worker/logic/theories";

/**
 * The document's systems table: one copy of a theory per document rather than
 * one per exercise, and the join that makes that invisible to everything
 * downstream.
 *
 * The property under test is *not* "the table exists" — it is that a consumer
 * cannot tell. Every assertion here is either about what is stored (a key) or
 * about what a reader gets (the same text as before), and the pair is what
 * makes the saving free.
 */

const FORALLX_SOURCE = THEORY_SOURCES["forallx-calgary-2019.mm0"] ?? "";

const THEORY_BLOCK = `:::aufbau-mm0{name="forallx" src="/theories/forallx-calgary-2019.mm0"}\n:::`;

function fitch(id: string, goal: string, system = "forallx"): string {
  return `:::aufbau-proof-fitch{system="${system}" id="${id}"}
Take it apart and put it back.

theorem ${goal} (P Q: wff): $ P ∧ Q ⊢ Q ∧ P $
----
P ∧ Q   :ax
:::`;
}

async function compile(source: string): Promise<CompiledContentArtifact> {
  const compiled = await compileCarnapMarkdown(source);

  if (!compiled.ok) {
    throw new Error(
      `compile failed: ${compiled.diagnostics.map((one) => one.code).join(", ")}`,
    );
  }

  return compiled.artifact;
}

/** What the database would hold, through the JSON the column actually stores. */
function stored(artifact: CompiledContentArtifact): JsonValue {
  return JSON.parse(
    JSON.stringify(keyedArtifact(artifact)),
  ) as unknown as JsonValue;
}

function publicDataOf(
  artifact: CompiledContentArtifact,
  id: string,
): Record<string, unknown> {
  const item = artifact.manifest.find((entry) => entry.id === id);

  if (item === undefined) {
    throw new Error(`no exercise "${id}"`);
  }

  return item.publicData as unknown as Record<string, unknown>;
}

describe("the document's systems table", () => {
  test("two exercises over one theory store one copy of it", async () => {
    const artifact = await compile(
      `${THEORY_BLOCK}\n\n${fitch("ex1", "andcomm")}\n\n${fitch("ex2", "andcomm2")}`,
    );

    expect(Object.keys(artifact.systems ?? {})).toEqual(["forallx"]);
    expect(artifact.systems?.forallx).toBe(FORALLX_SOURCE);

    // Not a rounding-error saving: the theory is 30 KB, so what is stored is
    // the difference between one copy and one per exercise.
    for (const id of ["ex1", "ex2"]) {
      const keyed = publicDataOf(
        keyedArtifact(artifact) as CompiledContentArtifact,
        id,
      );

      expect(keyed.system).toBe("forallx");
      expect(keyed.source).toBeUndefined();
      expect(keyed.mm0).toBeUndefined();
      expect(keyed.goalDecl).toContain("theorem");
    }
  });

  test("what a reader gets back is what the compiler produced", async () => {
    // The whole contract in one assertion. Grading, review and the server
    // renderers all read `publicData` off a parsed artifact, so if the round
    // trip is lossless none of them can tell the table exists.
    const artifact = await compile(
      `${THEORY_BLOCK}\n\n${fitch("ex1", "andcomm")}`,
    );

    expect(parseContentArtifact(stored(artifact), "rev-1")).toEqual(artifact);
  });

  test("the joined source is the theory with this exercise's goal appended", async () => {
    const artifact = await compile(
      `${THEORY_BLOCK}\n\n${fitch("ex1", "andcomm")}`,
    );
    const read = parseContentArtifact(stored(artifact), "rev-1");
    const data = publicDataOf(read, "ex1");

    expect(data.source).toBe(`${FORALLX_SOURCE}\n${data.goalDecl as string}`);
  });

  test("a lesson set in no system carries no table and is unchanged", async () => {
    const artifact = await compile(
      `::::multiple-choice{#mc1 points="1"}
Pick one.

- [x] yes | Yes
- [ ] no | No
::::`,
    );

    expect(artifact.systems).toBeUndefined();
    expect(keyedArtifact(artifact)).toBe(artifact);
    expect(parseContentArtifact(stored(artifact), "rev-1")).toEqual(artifact);
  });

  test("an artifact that froze its own text is left alone", () => {
    // Every lesson saved before the table existed. Its `publicData` carries the
    // only copy of its theory, so the join must not touch it — and there is no
    // key for it to touch it by.
    const legacy = {
      componentRegistryVersion: "component-registry-v1",
      document: {
        nodes: [
          {
            exerciseId: "ex1",
            exerciseKind: "aufbau-proof@1",
            kind: "exercise",
            publicData: { mm0: "sort wff;" },
            render: { assetId: "carnap-aufbau-proof-v1" },
          },
        ],
        profile: "carnap-markdown-v1",
      },
      manifest: [
        {
          id: "ex1",
          nominalPoints: 1,
          publicData: { mm0: "sort wff;" },
        },
      ],
      manifestVersion: 1,
      sourceProfile: "carnap-markdown-v1",
    } as unknown as JsonValue;

    const read = parseContentArtifact(legacy, "rev-1");

    expect(publicDataOf(read, "ex1").mm0).toBe("sort wff;");
  });

  test("a table entry that is not MM0 text is a diagnosable artifact", () => {
    const broken = {
      componentRegistryVersion: "component-registry-v1",
      document: { nodes: [], profile: "carnap-markdown-v1" },
      manifest: [],
      manifestVersion: 1,
      sourceProfile: "carnap-markdown-v1",
      systems: { forallx: 42 },
    } as unknown as JsonValue;

    expect(() => parseContentArtifact(broken, "rev-1")).toThrow(
      ContentArtifactError,
    );
  });

  test("the payload the browser gets carries the key, not the theory", async () => {
    const artifact = await compile(
      `${THEORY_BLOCK}\n\n${fitch("ex1", "andcomm")}`,
    );
    const script = exerciseHydrationScript({
      mode: "answer",
      options: {},
      priorAnswer: null,
      publicData: publicDataOf(artifact, "ex1") as unknown as JsonValue,
      strings: {},
      version: EXERCISE_HYDRATION_VERSION,
    });

    expect(script).toContain('"system":"forallx"');
    expect(script).not.toContain("@syntax");
    expect(script.length).toBeLessThan(FORALLX_SOURCE.length);
  });
});

describe("system=", () => {
  test("a proof can name a shipped id with no block at all", async () => {
    // The common case, and what the attribute is for: a lesson that teaches
    // from the textbook's own rules should not have to declare a block whose
    // only job is to have a name.
    const artifact = await compile(
      fitch("ex1", "andcomm", "forallx-calgary-2019"),
    );

    expect(Object.keys(artifact.systems ?? {})).toEqual([
      "forallx-calgary-2019",
    ]);
    expect(publicDataOf(artifact, "ex1").source).toContain("@syntax");
  });

  test("a block of the same name wins over the shipped id", async () => {
    // The point of the order. A course that extends forallx calls the result
    // whatever it likes — including `forallx-calgary-2019` — and every exercise
    // naming it gets the extension.
    const artifact = await compile(
      `:::aufbau-mm0{name="forallx-calgary-2019" src="/theories/forallx-calgary-2019.mm0"}
--| @syntax delimiter $ Cube $
term Cube (sq: seq): wff;
:::

${fitch("ex1", "andcomm", "forallx-calgary-2019")}`,
    );

    expect(publicDataOf(artifact, "ex1").source).toContain("term Cube");
  });

  test("a translation can be set in a language the document declares", async () => {
    // Not possible before: `system=` took an id, and a block had no id. This is
    // the half of #257 that a course with its own vocabulary was waiting for.
    const artifact = await compile(
      `:::aufbau-mm0{name="ours" src="/theories/forallx-calgary-2019.mm0"}
--| @syntax delimiter $ Cube $
term Cube (sq: seq): wff;
:::

::::translation{#t1 system="ours" variant="first-order"}
Something is a cube.

- ExCube(x)
::::`,
    );

    expect(publicDataOf(artifact, "t1").system).toBe("ours");
    expect(publicDataOf(artifact, "t1").source).toContain("term Cube");
  });

  test("a language with no quantifiers is refused, and says which half is missing", async () => {
    const compiled = await compileCarnapMarkdown(
      `::::translation{#t1 system="carnap-prop"}
People danced.

- P
::::`,
    );

    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((one) => one.code)).toContain(
      "system_not_first_order",
    );
  });

  test("a truth table can name a propositional system, and refuses a quantified one", async () => {
    // The one type an author could not point at their own notation, for no
    // reason beyond nobody having written the attribute.
    const ok = await compileCarnapMarkdown(
      `::::truth-table{#tt1 system="carnap-prop"}
Fill it in.

- P -> Q
::::`,
    );

    expect(ok.ok).toBe(true);

    const refused = await compileCarnapMarkdown(
      `::::truth-table{#tt1 system="forallx-calgary-2019"}
Fill it in.

- P -> Q
::::`,
    );

    expect(refused.diagnostics.map((one) => one.code)).toContain(
      "system_not_propositional",
    );
  });

  test("a language with no sentence sort still reaches its reader as a language", async () => {
    // The table entry used to be a discriminated pair, and the compiler chose
    // its arm by asking whether the theory declared a sentence sort — a
    // proof-type question asked of a table that serves all seven. A
    // language-only spec has one provable sort and so declares none, and the
    // exercise silently lost its `@syntax`: it compiled, stored its formulas in
    // the author's canonical spelling, and had no language to read them back
    // in. The entry is now the source as written, so there is no arm to pick.
    const artifact = await compile(
      `:::aufbau-mm0{name="ours" src="/theories/carnap-prop.mm0"}
--| @syntax delimiter $ ∧ $
infixl and: $∧$ prec 40;
:::

::::truth-table{#tt1 system="ours"}
Fill it in.

- P /\\ Q
::::`,
    );

    const data = publicDataOf(artifact, "tt1") as {
      readonly formulas: readonly string[];
      readonly source?: string;
    };

    expect(artifact.systems?.ours).toContain("@syntax role conjunction");
    // Stored in the block's canonical spelling, which is the point: nothing but
    // the block's own language reads it.
    expect(data.formulas).toEqual(["(P ∧ Q)"]);
    expect(truthTableLanguage(data)?.parse("(P ∧ Q)").ok).toBe(true);
  });

  test("a system that does not read says so, rather than what it lacks", async () => {
    // `infixl` on a term that was never declared. The capability refusals state
    // a fact about the language ("has quantifiers", "declares none"), so they
    // may only be said of one that read; before this, an unreadable spec got
    // the truth-table refusal and an author chasing a binder that was not the
    // problem.
    const compiled = await compileCarnapMarkdown(
      `:::aufbau-mm0{name="ours" src="/theories/carnap-prop.mm0"}
--| @syntax delimiter $ ∧ $
infixl nosuchterm: $∧$ prec 40;
:::

::::truth-table{#tt1 system="ours"}
Fill it in.

- P /\\ Q
::::`,
    );

    expect(compiled.diagnostics.map((one) => one.code)).toEqual([
      "system_unreadable",
    ]);
  });

  test("an unresolvable name names both places it was looked for", async () => {
    const compiled = await compileCarnapMarkdown(
      `${THEORY_BLOCK}\n\n${fitch("ex1", "andcomm", "forallks")}`,
    );
    const miss = compiled.diagnostics.find(
      (one) => one.code === "unknown_system",
    );

    // A typo'd block name falls through to the shipped ids, so a message that
    // listed only those would answer a question the author did not ask.
    expect(miss?.message).toContain("This document declares");
    expect(miss?.params?.declared).toBe("forallx");
    expect(miss?.params?.available).toContain("gentzen-lk");
  });
});
