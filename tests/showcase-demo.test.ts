import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { renderCompiledContent } from "../src/worker/application/content/renderer";
import { i18nFor } from "../src/worker/i18n";
import { SHOWCASE_DEMO_SOURCE } from "./helpers/showcase-demo";

/**
 * The showcase lesson is the one document that uses **every** exercise directive
 * the profile exposes, so compiling it is a cheap end-to-end check that no
 * directive has drifted out from under its own documentation: the lesson prints
 * each directive's source in a code fence next to the live exercise, so a syntax
 * change that breaks the exercise breaks this test too.
 *
 * Whether the three worked proofs actually verify against the engine is checked
 * by `bun run scripts/showcase-verify.ts` (the compiler is client-only and
 * untyped, so it stays out of `bun test`).
 */

const EXPECTED_KINDS = [
  "multiple-choice@1",
  "free-response@1",
  "short-answer@1",
  "truth-table@1",
  "model@1",
  "translation@1",
  "aufbau-proof@1",
  "aufbau-proof-tree@1",
  "aufbau-proof-fitch@1",
];

describe("showcase demo lesson", () => {
  test("compiles with every exercise kind represented", async () => {
    const compiled = await compileCarnapMarkdown(SHOWCASE_DEMO_SOURCE);

    expect(
      compiled.diagnostics.map((entry) => entry.code),
      JSON.stringify(compiled.diagnostics),
    ).toEqual([]);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    expect(compiled.artifact.manifest.map((entry) => entry.id)).toEqual([
      "mc_discharge",
      "mc_which",
      "sa_exelim",
      "fr_eigen",
      "tt_demorgan",
      "tt_affirming",
      "tt_row",
      "md_both",
      "md_invalid",
      "tr_and",
      "tr_fine",
      "tr_exact",
      "pf_lines",
      "pf_tree",
      "pf_fitch",
      "pf_yours",
      "pf_sealed",
      "sa_commit",
    ]);

    const kinds = new Set(
      compiled.artifact.manifest.map((entry) => entry.kind),
    );
    for (const kind of EXPECTED_KINDS) {
      expect(kinds, `${kind} is missing from the showcase`).toContain(kind);
    }
  });

  test("the authoring source it quotes survives as code, not as directives", async () => {
    const compiled = await compileCarnapMarkdown(SHOWCASE_DEMO_SOURCE);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    const html = renderCompiledContent(compiled.artifact, i18nFor("en"));

    // The quoted source reaches the page verbatim inside a code block — the
    // fences are what keep a directive in a code fence from compiling as one.
    expect(html).toContain(
      '<pre><code class="language-md">:::multiple-choice{id="mc_discharge"',
    );
    expect(html).toContain(':::truth-table{id="tt_row"');

    // …and each quoted directive still produced exactly one live exercise.
    const exercises = compiled.artifact.document.nodes.filter(
      (node) => node.kind === "exercise",
    );
    expect(exercises).toHaveLength(18);
  });

  test("the closing Fitch exercise is left for the student to finish", async () => {
    const compiled = await compileCarnapMarkdown(SHOWCASE_DEMO_SOURCE);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    const node = compiled.artifact.document.nodes.find(
      (entry) => entry.kind === "exercise" && entry.exerciseId === "pf_yours",
    );
    expect(node?.kind).toBe("exercise");
    if (node?.kind !== "exercise") {
      return;
    }

    const publicData = node.publicData as { readonly starterBody?: unknown };
    expect(publicData.starterBody).toBe("¬ ¬ P    :ax");
  });

  test("the demo shows a sealed exercise, and it really is sealed", async () => {
    const compiled = await compileCarnapMarkdown(SHOWCASE_DEMO_SOURCE);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    // Prose claiming a setting exists is worth less than one exercise actually
    // carrying it: this is the tour, and a reader works the exercises.
    const sealed = compiled.artifact.manifest.find(
      (entry) => entry.id === "pf_sealed",
    );

    expect(sealed?.feedback).toBe("none");
    expect(
      compiled.artifact.manifest.find((entry) => entry.id === "pf_yours")
        ?.feedback,
    ).toBeUndefined();
  });

  test("and one where pressing Submit is the only feedback there is", async () => {
    const compiled = await compileCarnapMarkdown(SHOWCASE_DEMO_SOURCE);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    // The pair the compiler used to refuse. Both halves have to survive into
    // the manifest for it to mean anything: the `false` is what stops the work
    // being kept, and it compiled away until it was made to carry.
    expect(
      compiled.artifact.manifest.find((entry) => entry.id === "sa_commit"),
    ).toMatchObject({ exam: false, feedback: "none" });
  });
});
