import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import {
  AssessmentExerciseRegistry,
  type AssessmentExerciseType,
  createDefaultExerciseKindRegistry,
  MULTIPLE_CHOICE_ANSWER_KIND,
} from "../src/worker/application/content/registry";
import {
  ComponentRegistry,
  componentAssetsForArtifact,
  renderCompiledContent,
} from "../src/worker/application/content/renderer";
import type {
  AnswerEnvelope,
  AutomaticEvaluation,
  CompiledContentArtifact,
  ExerciseManifestItem,
  NormalizedAnswer,
} from "../src/worker/domain/content";
import type { JsonValue } from "../src/worker/domain/json";
import { i18nFor } from "../src/worker/i18n";

function isObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const fakeCapabilities = {
  supportsAutomaticEvaluation: true,
  supportsManualReview: true,
};

const fakeManifestItem: ExerciseManifestItem = {
  answerKind: "fake-answer@1",
  capabilities: fakeCapabilities,
  declarationHash: "sha256:fake",
  id: "fake_1",
  kind: "fake-exercise@1",
  nominalPoints: 3,
  privateData: { expected: "yes" },
  publicData: { prompt: "Answer yes." },
  render: {
    assetId: "fake-widget-v1",
    component: "fake-widget",
    componentVersion: "1",
  },
  schemaVersion: 1,
  title: "Fake exercise",
};

const fakeExerciseType: AssessmentExerciseType = {
  answerKind: "fake-answer@1",
  capabilities: fakeCapabilities,
  component: {
    assetId: "fake-widget-v1",
    capabilities: fakeCapabilities,
    clientModule: true,
    component: "fake-widget",
    componentVersion: "1",
  },
  kind: "fake-exercise@1",
  schemaVersion: 1,
  async evaluate(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
  ): Promise<AutomaticEvaluation> {
    const data = answer.data;
    const expected =
      isObject(declaration.privateData) &&
      typeof declaration.privateData.expected === "string"
        ? declaration.privateData.expected
        : "";
    const value =
      isObject(data) && typeof data.value === "string" ? data.value : "";
    const correct = value === expected;

    return {
      awardedScore: correct ? declaration.nominalPoints : 0,
      declarationHash: declaration.declarationHash,
      evaluatorVersion: "fake-evaluator@1",
      kind: "automatic",
      nominalMaxScore: declaration.nominalPoints,
      status: correct ? "correct" : "incorrect",
    };
  },
  normalizeAnswer(envelope: AnswerEnvelope) {
    if (envelope.kind !== "fake-answer@1") {
      return {
        diagnostics: [{ code: "wrong_kind", message: "Wrong answer kind." }],
        ok: false,
        reason: "wrong-kind",
      };
    }

    if (!isObject(envelope.data) || typeof envelope.data.value !== "string") {
      return {
        diagnostics: [
          { code: "invalid_value", message: "A string value is required." },
        ],
        ok: false,
        reason: "schema-invalid",
      };
    }

    return {
      answer: {
        data: { value: envelope.data.value.trim().toLowerCase() },
        kind: "fake-answer@1",
        schemaVersion: 1,
      },
      ok: true,
    };
  },
};

async function assessSubmission(
  registry: AssessmentExerciseRegistry,
  declaration: ExerciseManifestItem,
  envelope: AnswerEnvelope,
): Promise<AutomaticEvaluation | null> {
  const normalized = registry.normalizeAnswer(declaration, envelope);

  if (!normalized.ok) {
    return {
      awardedScore: 0,
      declarationHash: declaration.declarationHash,
      evaluatorVersion: "structural-normalizer@1",
      feedback: {
        diagnostics: normalized.diagnostics.map((item) => ({
          code: item.code,
          message: item.message,
        })),
      },
      kind: "automatic",
      nominalMaxScore: declaration.nominalPoints,
      status: "invalid",
    };
  }

  return registry.evaluateAutomatic(declaration, normalized.answer, {
    now: "2026-01-01T00:00:00.000Z",
  });
}

describe("exercise contract", () => {
  test("a fake exercise type can be assessed without route changes", async () => {
    const registry = new AssessmentExerciseRegistry();

    registry.register(fakeExerciseType);

    await expect(
      assessSubmission(registry, fakeManifestItem, {
        data: { value: " YES " },
        kind: "fake-answer@1",
        schemaVersion: 1,
      }),
    ).resolves.toMatchObject({ awardedScore: 3, status: "correct" });
    await expect(
      assessSubmission(registry, fakeManifestItem, {
        data: { value: "no" },
        kind: "fake-answer@1",
        schemaVersion: 1,
      }),
    ).resolves.toMatchObject({ awardedScore: 0, status: "incorrect" });
  });

  test("structural answer errors are distinct from incorrect answers", async () => {
    const registry = new AssessmentExerciseRegistry();

    registry.register(fakeExerciseType);

    await expect(
      assessSubmission(registry, fakeManifestItem, {
        data: { value: 7 },
        kind: "fake-answer@1",
        schemaVersion: 1,
      }),
    ).resolves.toMatchObject({ status: "invalid" });
    await expect(
      assessSubmission(registry, fakeManifestItem, {
        data: { value: "no" },
        kind: "fake-answer@1",
        schemaVersion: 1,
      }),
    ).resolves.toMatchObject({ status: "incorrect" });
  });

  test("manual grading metadata is optional", () => {
    const registry = new AssessmentExerciseRegistry();

    registry.register(fakeExerciseType);

    expect(registry.manualGradingSpec(fakeManifestItem)).toEqual({});
  });

  test("exercise packages return earned credit evidence, not scores", async () => {
    const registry = new AssessmentExerciseRegistry();

    registry.register(fakeExerciseType);

    const evaluation = await assessSubmission(registry, fakeManifestItem, {
      data: { value: "yes" },
      kind: "fake-answer@1",
      schemaVersion: 1,
    });

    expect(evaluation).toMatchObject({
      awardedScore: 3,
      kind: "automatic",
      nominalMaxScore: 3,
    });
    expect(evaluation).not.toHaveProperty("finalScore");
  });

  test("exercise island rendering uses component registry metadata", () => {
    const artifact: CompiledContentArtifact = {
      componentRegistryVersion: "component-registry-v1",
      document: {
        nodes: [
          {
            exerciseId: fakeManifestItem.id,
            exerciseKind: fakeManifestItem.kind,
            kind: "exercise",
            publicData: fakeManifestItem.publicData,
            render: fakeManifestItem.render,
          },
        ],
        profile: "carnap-markdown-v1",
      },
      manifest: [fakeManifestItem],
      manifestVersion: 1,
      sourceProfile: "carnap-markdown-v1",
    };
    const components = new ComponentRegistry();

    components.register({
      metadata: fakeExerciseType.component,
      render(node) {
        return `<fake-widget data-exercise-id="${node.exerciseId}"></fake-widget>`;
      },
    });

    expect(componentAssetsForArtifact(artifact, components)).toEqual([
      "fake-widget-v1",
    ]);
    expect(
      renderCompiledContent(artifact, i18nFor("en"), components),
    ).toContain("<fake-widget");
  });

  test("bundle-less exercise types contribute no component assets", async () => {
    const compiled = await compileCarnapMarkdown(
      [
        '::::short-answer{#sa_1 answer="yes"}',
        "Type yes.",
        "::::",
        "",
        '::::free-response{#fr_1 rubric="Any argument in good faith."}',
        "Say something.",
        "::::",
        "",
        "::::multiple-choice{#mc_1}",
        "Pick one.",
        "",
        "- [x] a | A",
        "- [ ] b | B",
        "::::",
      ].join("\n"),
    );

    expect(compiled.ok).toBe(true);

    if (!compiled.ok) {
      return;
    }

    // Short answer and free response render as plain form fields, so only the
    // multiple-choice bundle may be requested — asking for the other two would
    // 404 (no such module was ever built).
    expect(componentAssetsForArtifact(compiled.artifact)).toEqual([
      "carnap-multiple-choice-v1",
    ]);
  });

  test("default registry normalizes a multiple-choice answer envelope", () => {
    const registry = createDefaultExerciseKindRegistry();
    const item: ExerciseManifestItem = {
      answerKind: MULTIPLE_CHOICE_ANSWER_KIND,
      capabilities: {
        supportsAutomaticEvaluation: true,
        supportsManualReview: true,
      },
      declarationHash: "sha256:mc",
      id: "mc_1",
      kind: "multiple-choice@1",
      nominalPoints: 1,
      privateData: { correctOptionIds: ["a"], mode: "single" },
      publicData: {
        mode: "single",
        options: [
          { html: "A", id: "a" },
          { html: "B", id: "b" },
        ],
        promptHtml: "Pick one.",
      },
      render: {
        assetId: "carnap-multiple-choice-v1",
        component: "carnap-multiple-choice",
        componentVersion: "1",
      },
      schemaVersion: 1,
    };

    expect(
      registry.normalizeAnswer(item, {
        data: { selectedOptionIds: ["a"] },
        kind: MULTIPLE_CHOICE_ANSWER_KIND,
        schemaVersion: 1,
      }),
    ).toMatchObject({ ok: true });
  });
});

/**
 * One lesson holding every kind, half of them titled and half not, rendered
 * through the no-submission path — which is the preview every author writes
 * against. Shared by the two describes below, which ask different things of the
 * same six exercises.
 */
const LESSON = [
  '::::multiple-choice{#mc title="Pick one" points="1"}',
  "Choose.",
  "",
  "- [x] yes | Yes",
  "- [ ] no | No",
  "::::",
  "",
  '::::short-answer{#sa answer="yes"}',
  "Type yes.",
  "::::",
  "",
  '::::free-response{#fr title="Explain" rubric="Anything."}',
  "Explain.",
  "::::",
  "",
  "::::truth-table{#tt}",
  "Fill it in.",
  "",
  "- P -> P",
  "::::",
  "",
  ':::aufbau-mm0{name="prop"}',
  "provable sort wff;",
  "term top: wff;",
  "axiom top_i: $ top $;",
  ":::",
  "",
  ':::aufbau-proof{theory="prop" id="pf" title="Prove top"}',
  "Prove it.",
  "",
  "theorem thm_top: $ top $",
  "----",
  "l1: $ top $ by top_i []",
  ":::",
  "",
  ':::aufbau-proof-tree{theory="prop" id="tr"}',
  "Build it.",
  "",
  "theorem thm_tree: $ top $",
  ":::",
].join("\n");

async function render(): Promise<string> {
  const compiled = await compileCarnapMarkdown(LESSON);

  if (!compiled.ok) {
    throw new Error(
      `compile failed: ${compiled.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }

  return renderCompiledContent(compiled.artifact, i18nFor("en"));
}

/**
 * Every exercise a reader can meet is one named group with named controls, on
 * every path that renders one. This is asserted on the *markup* because that is
 * the only place it is observable: the accessible names live in a Declarative
 * Shadow Root that jsdom will not parse, and an exercise that quietly loses its
 * legend goes on rendering perfectly for a sighted reader.
 */
describe("every exercise names itself", () => {
  test("each one is a group whose legend is the author's title", async () => {
    const html = await render();

    // Six exercises, six groups — including the two proof kinds, which had no
    // legend at all before, and the truth table, which used to accept a title and
    // drop it. (Fitch needs a sequent theory to compile, so it is covered by the
    // a11y fixture lesson and `fitch-verify.test.ts` rather than repeated here.)
    expect((html.match(/class="exercise-group/g) ?? []).length).toBe(6);

    for (const title of ["Pick one", "Explain", "Prove top"]) {
      expect(html).toContain(
        `<legend class="exercise-legend">${title}</legend>`,
      );
    }

    // The untitled ones are named too, just not on screen.
    for (const kind of [
      "Short-answer question",
      "Truth table",
      "Proof tree",
    ]) {
      expect(html).toContain(
        `<legend class="exercise-legend visually-hidden">${kind}</legend>`,
      );
    }
  });

  test("no exercise shows its id to a reader", async () => {
    const html = await render();

    // Ids belong in attributes, never in a legend or a label: the fallback for an
    // untitled exercise used to be `node.exerciseId`, which put slugs on screen.
    for (const id of ["mc", "sa", "fr", "tt", "pf", "tr"]) {
      expect(html).not.toContain(`>${id}</legend>`);
    }
  });

  test("multiple-choice options are labelled by for/id, not by nesting", async () => {
    const html = await render();

    for (const option of ["yes", "no"]) {
      expect(html).toContain(`id="mc-option-${option}"`);
      expect(html).toContain(
        `<label class="mc-label" for="mc-option-${option}">`,
      );
    }

    // The input is the label's sibling now, so no label wraps a control.
    expect(html).not.toContain('<label class="mc-option">');
  });

  test("the text kinds label their answer field", async () => {
    const html = await render();

    for (const id of ["sa", "fr"]) {
      expect(html).toContain(`<label for="${id}-answer">Answer</label>`);
      expect(html).toContain(`id="${id}-answer"`);
    }
  });

  test("every fillable truth-table cell carries a name", async () => {
    const html = await render();
    const cells = html.match(/<button class="tt-cell"[^>]*>/g) ?? [];

    // 2 rows × (1 atom + 3 formula cells).
    expect(cells.length).toBe(8);

    for (const cell of cells) {
      expect(cell).toContain('aria-label="');
    }

    // Column, 1-based row, and the value as a word — not the glyph, which may be
    // an author's custom mark or (under `nodash`) nothing at all.
    expect(html).toContain('aria-label="P, row 1: blank"');
    expect(html).toContain('aria-label="-&gt;, row 2: blank"');
  });

  test("a shadow root that hides text carries the rule that hides it", async () => {
    const html = await render();
    const roots =
      html.match(/<template shadowrootmode="open">[\s\S]*?<\/template>/g) ??
      [];

    // Four of the six kinds render their chrome into a shadow root.
    expect(roots.length).toBe(4);

    // A shadow root inherits no page CSS, so `class="visually-hidden"` inside one
    // is inert unless that root's own `<style>` defines the rule. Shipped without
    // it, the three proof widgets printed the generic legend ("PROOF") on screen
    // for every untitled exercise — visible where it was meant to be heard only.
    for (const root of roots) {
      if (!root.includes('class="exercise-legend visually-hidden"')) continue;

      expect(root).toContain(".visually-hidden {");
    }
  });
});

/**
 * What an author is writing towards.
 *
 * A preview renders the exercises with no attempt behind them, and used to stop
 * at the widget: no action bar, so no submit, no status line, no correctness mark
 * — and, since a widget puts its own controls into that bar, no Check either. The
 * shape on the author's screen was therefore not the shape on the student's, and
 * the missing row was the one that closes every exercise.
 *
 * So the bar is rendered, with the submit disabled. These assertions are on the
 * markup because that is where it is observable: this path has no form, so
 * nothing downstream would notice a renderer that quietly omitted the row.
 */
describe("the preview's action bar", () => {
  test("every exercise ends with one, and its submit is disabled", async () => {
    const html = await render();

    // One bar per exercise — every renderer, whether it projects the bar into a
    // shadow card (the four element kinds) or sits it beside the fieldset (the
    // two text kinds).
    expect((html.match(/class="exercise-actions"/g) ?? []).length).toBe(6);
    expect((html.match(/class="exercise-mark"/g) ?? []).length).toBe(6);

    // Disabled, and saying why: a button drawn like a live one that silently
    // does nothing is worse than no button.
    expect(
      (html.match(/class="exercise-submit" type="submit" disabled/g) ?? [])
        .length,
    ).toBe(6);
    expect(html).toContain('title="Answers are not recorded here."');

    // Nothing has been submitted here, so the status line has nothing to say —
    // but it is present, because the row's height should not change when the
    // same document is opened as an attempt.
    expect(html).toContain(
      '<p aria-live="polite" class="exercise-status" data-exercise-status></p>',
    );
  });

  test("the widget kinds project it into their shadow card", async () => {
    const html = await render();

    // Four of the six kinds have an element, and the bar must carry the slot
    // attribute for those: without it the row stays outside the card, reading as
    // something that floats under the exercise rather than closes it.
    expect(
      (html.match(/class="exercise-actions" slot="exercise-actions"/g) ?? [])
        .length,
    ).toBe(4);
  });
});

describe("the interactive submission path", () => {
  /**
   * Every widget that fills the shared action bar looks for `.exercise-actions`
   * in **its own light DOM** — the bar is handed to the element renderer and
   * projected through a slot. The generic submission form puts the bar beside
   * the element instead, where the element cannot reach it, so a type with a
   * widget needs its own branch in `submissionFormNode`.
   *
   * Missing that branch hides well: the exercise renders, the fields work, the
   * answer is recorded and graded — only the widget's own buttons are silently
   * absent. It has now happened twice, which is why this is a test rather than a
   * comment.
   *
   * Read off the per-type folders rather than a hand-kept list, so a type added
   * later is covered without anyone remembering to come back here.
   */
  test("every kind with a client element has its own submission form", async () => {
    const page = await Bun.file(
      "src/worker/web/assignment-detail.tsx",
    ).text();
    const glob = new Bun.Glob("src/worker/exercises/*/types.ts");
    const interactive: string[] = [];

    for await (const path of glob.scan(".")) {
      const source = await Bun.file(path).text();

      if (!source.includes("clientModule: true")) {
        continue;
      }

      // The folder name, which by convention names the branch:
      // `model` → `modelSubmissionForm`.
      const folder = path.split("/").at(-2) ?? "";

      interactive.push(folder);
    }

    // Six interactive types today, and a floor so an empty scan cannot make
    // this pass by finding nothing.
    expect(interactive.length).toBeGreaterThanOrEqual(6);

    // The dispatcher's own body, not the whole file: a per-kind form that exists
    // but is never called is the same bug as one that was never written.
    const dispatcher = /function submissionFormNode\([\s\S]*?\n}/.exec(
      page,
    )?.[0];

    expect(
      dispatcher,
      "submissionFormNode is not where it was",
    ).toBeDefined();

    for (const folder of interactive) {
      const camel = folder.replace(/-([a-z])/g, (_, letter: string) =>
        letter.toUpperCase(),
      );

      expect(
        dispatcher,
        `${folder} has a client element, so submissionFormNode needs to call ${camel}SubmissionForm — otherwise the bar renders beside the element instead of inside it, and the widget's own buttons never appear`,
      ).toContain(`${camel}SubmissionForm(`);
    }
  });

  /**
   * No widget draws its own verdict.
   *
   * This is what the mark replaced: four proof widgets each with a bracketed
   * `[✓]` in its own shadow root, two of them at the right of the goal line and
   * two at the right of a toolbar, plus a truth table and a model that turned a
   * sentence green instead. Uniformity is not a property one can see from
   * inside any single widget — each looked perfectly consistent with itself —
   * so it is asserted from outside, over all of them at once.
   *
   * The check codepoint is the tell, and it is searched for in the widget
   * bundles only: the review views legitimately draw their own ticks (a
   * multiple-choice option marked right in an instructor's read-only view is a
   * different claim from "this exercise is correct", and sits beside the option
   * rather than in an action bar).
   */
  test("no widget draws a correctness glyph of its own", async () => {
    const glob = new Bun.Glob("src/client/components/carnap-*.{ts,tsx}");
    const offenders: string[] = [];

    for await (const path of glob.scan(".")) {
      const source = await Bun.file(path).text();

      if (source.includes("✓")) {
        offenders.push(path);
      }
    }

    expect(
      offenders,
      "a widget spelling its own check has stopped using the shared correctness mark — call this.setMark(...) from the base class instead, so the glyph, the font, the colours and the position stay one description in styles.ts",
    ).toEqual([]);
  });

  /**
   * Every CodeMirror view in a shadow root paints its caret from the palette.
   *
   * CodeMirror's base theme ships two caret colours and picks between them from
   * the EditorView.darkTheme facet, not from the OS — so a view that never sets
   * that facet gets the black one in dark mode too, where it sits at 1.37:1
   * against the surface and is, in practice, invisible. Every such view has to
   * say `caret-color` itself.
   *
   * The selector matters as much as the property. CodeMirror mounts its theme
   * through adoptedStyleSheets, which the cascade applies after the shadow
   * root's own style element, so a two-class rule of ours loses the tie to its
   * two-class rule and the property is there but does nothing — which is
   * exactly the state this test was written for. Three classes wins.
   */
  test("a CodeMirror view in a shadow root sets its own caret colour", async () => {
    const glob = new Bun.Glob("src/client/components/carnap-*.{ts,tsx}");
    const offenders: string[] = [];

    for await (const path of glob.scan(".")) {
      const source = await Bun.file(path).text();

      if (!source.includes("@codemirror/view")) {
        continue;
      }

      if (
        !/\.[a-z-]+ \.cm-editor \.cm-content \{\s*caret-color: var\(--ink/.test(
          source,
        )
      ) {
        offenders.push(path);
      }
    }

    expect(
      offenders,
      "a widget embedding CodeMirror needs `.<wrapper> .cm-editor .cm-content { caret-color: var(--ink, …) }` in its shadow styles — without the property the caret is black in dark mode, and without the third class CodeMirror's own adopted stylesheet outranks it",
    ).toEqual([]);
  });

  /**
   * And every such view repaints the bubble its diagnostics are read in.
   *
   * Same failure as the caret, one layer out: CodeMirror's base theme gives the
   * tooltip a #f5f5f5 background from a rule scoped to `&light`, `&light` is
   * chosen by the EditorView.darkTheme facet rather than by the OS, and a view
   * that never sets that facet keeps the pale bubble in dark mode while the
   * message inside inherits the light ink — white on near-white.
   *
   * The selector is checked as strictly as the caret's, and for one reason more.
   * Three classes are needed to outrank the adopted stylesheet, and the wrapper
   * has to be named directly: `.cm-tooltip-lint` is the <ul> *inside* the bubble,
   * so the obvious-looking `.cm-tooltip.cm-tooltip-lint` matches no element in
   * the document — which is how this shipped past the caret fix.
   */
  test("a CodeMirror view in a shadow root repaints its diagnostic tooltip", async () => {
    const glob = new Bun.Glob("src/client/components/carnap-*.{ts,tsx}");
    const offenders: string[] = [];

    for await (const path of glob.scan(".")) {
      const source = await Bun.file(path).text();

      if (!source.includes("@codemirror/lint")) {
        continue;
      }

      if (
        !/\.[a-z-]+ \.cm-editor \.cm-tooltip \{[^}]*\bbackground: var\(--/.test(
          source,
        )
      ) {
        offenders.push(path);
      }
    }

    expect(
      offenders,
      "a widget showing CodeMirror diagnostics needs `.<wrapper> .cm-editor .cm-tooltip { background: var(--…) }` in its shadow styles — hung on `.cm-tooltip-lint` the rule matches nothing, and with only two classes CodeMirror's own adopted stylesheet outranks it",
    ).toEqual([]);
  });
});
