import { describe, expect, test } from "bun:test";

import {
  ContentArtifactError,
  parseContentArtifact,
} from "../src/worker/application/content/artifact";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { JsonValue } from "../src/worker/domain/json";
import { i18nFor } from "../src/worker/i18n";

const REVISION = "rev-under-test";

const SOURCE = `# A lesson

Some prose.

::::multiple-choice{id="mp" title="Modus ponens" points="2"}
From P and "if P then Q", which follows?

- [ ] p | P
- [x] q | Q
::::
`;

/** What the compiler actually produces, as JSON, the way a row stores it. */
async function compiledArtifact(): Promise<Record<string, unknown>> {
  const result = await compileCarnapMarkdown(SOURCE);

  if (!result.ok) {
    throw new Error(
      `fixture failed to compile: ${result.diagnostics.map((d) => d.message).join("; ")}`,
    );
  }

  return JSON.parse(JSON.stringify(result.artifact)) as Record<
    string,
    unknown
  >;
}

function defectOf(compiled: JsonValue): string {
  try {
    parseContentArtifact(compiled, REVISION);
  } catch (error) {
    if (error instanceof ContentArtifactError) {
      return error.message;
    }

    throw error;
  }

  throw new Error("the artifact parsed, but the test expected it not to");
}

describe("reading a stored content artifact", () => {
  test("what the compiler produces reads back", async () => {
    const compiled = await compiledArtifact();
    const artifact = parseContentArtifact(compiled as JsonValue, REVISION);

    expect(artifact.manifest.map((item) => item.id)).toEqual(["mp"]);
    expect(artifact.document.nodes.length).toBeGreaterThan(1);
  });

  test("every refusal names the revision, uniformly", () => {
    const cases: JsonValue[] = [
      null,
      "not an artifact",
      [],
      { manifest: [] },
      { document: { nodes: {} }, manifest: [] },
      { document: { nodes: [] } },
    ];

    for (const compiled of cases) {
      let thrown: unknown;

      try {
        parseContentArtifact(compiled, REVISION);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ContentArtifactError);
      const error = thrown as ContentArtifactError;

      expect(error.status).toBe(500);
      expect(error.code).toBe("invalid_content_artifact");
      expect(error.revisionId).toBe(REVISION);
      // The English is the diagnostic: it reaches the JSON envelope and the log
      // line, and before this every one of these was an anonymous 500 or an
      // unhandled TypeError naming nothing.
      expect(error.message).toContain(REVISION);
      expect(error.message).toContain(error.defect);
    }
  });

  test("each defect is named specifically enough to act on", () => {
    expect(defectOf(null)).toContain("the artifact is null");
    expect(defectOf({ manifest: [] })).toContain("`document.nodes`");
    expect(defectOf({ document: { nodes: [] } })).toContain("`manifest`");
    expect(
      defectOf({ css: 7, document: { nodes: [] }, manifest: [] }),
    ).toContain("`css`");
  });

  /**
   * The failure this parse was written for, and the only one on this list that
   * used to produce no error at all: the AGS acceptance fixture rendered its
   * question, and its radios stayed disabled forever, because the manifest the
   * hydration payload is built from did not mention the exercise.
   */
  test("an exercise the manifest does not declare is a defect, not an absence", async () => {
    const compiled = await compiledArtifact();
    const defect = defectOf({ ...compiled, manifest: [] } as JsonValue);

    expect(defect).toContain('exercise "mp"');
    expect(defect).toContain("not in the manifest");
  });

  test("a document with no exercises at all still reads", async () => {
    const result = await compileCarnapMarkdown(
      "# Just prose\n\nNo questions.\n",
    );

    if (!result.ok) {
      throw new Error("prose-only fixture failed to compile");
    }

    const compiled = JSON.parse(JSON.stringify(result.artifact)) as JsonValue;

    expect(parseContentArtifact(compiled, REVISION).manifest).toEqual([]);
  });

  test("the reader is shown prose, in their language, with no identifiers", () => {
    const error = new ContentArtifactError(REVISION, "`manifest` is missing");
    const german = error.localize(i18nFor("de"));

    expect(german).not.toBe(error.message);
    expect(german).not.toContain(REVISION);
    expect(german).not.toContain("manifest");
    // Translated, not merely different: this class overrides `localize` rather
    // than carrying a deferred message, so nothing else proves it is in the
    // catalog at all.
    expect(german).not.toBe(error.localize(i18nFor("en")));
  });
});
