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

function fitch(id: string, goal: string): string {
  return `:::aufbau-proof-fitch{theory="forallx" id="${id}"}
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
    expect(artifact.systems?.forallx?.source).toBe(FORALLX_SOURCE);

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
      systems: { forallx: { source: 42 } },
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
