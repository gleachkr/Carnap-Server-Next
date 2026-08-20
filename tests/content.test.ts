import { describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Root } from "mdast";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { createDefaultAuthoringExerciseRegistry } from "../src/worker/application/content/authoring-registry";
import {
  CONTENT_SANITIZE_SCHEMA,
  compileCarnapMarkdown,
} from "../src/worker/application/content/compiler";
import {
  createDefaultExerciseKindRegistry,
  FREE_RESPONSE_ANSWER_KIND,
  FREE_RESPONSE_KIND,
  MULTIPLE_CHOICE_ANSWER_KIND,
  MultipleChoiceExerciseHandler,
  SHORT_ANSWER_ANSWER_KIND,
  SHORT_ANSWER_KIND,
} from "../src/worker/application/content/registry";
import { renderCompiledContent } from "../src/worker/application/content/renderer";
import type {
  CompiledContentArtifact,
  ExerciseManifestItem,
} from "../src/worker/domain/content";
import type { Env } from "../src/worker/env";
import { i18nFor } from "../src/worker/i18n";
import { passthroughTranslator } from "../src/worker/i18n/translator";
import { sampleSource as starterTemplate } from "../src/worker/web/content";
import { CONTENT_STYLE_SHEET } from "../src/worker/web/style-assets";
import { grantTestContentAuthor } from "./helpers/admin";
import { appRequest, createTestApp } from "./helpers/app";
import { createTestStorage, type TestStorage } from "./helpers/storage";

setDefaultTimeout(30_000);

interface StartLoginResponse {
  readonly login: {
    readonly loginToken: string;
  };
}

interface LoginResponse {
  readonly actor: {
    readonly id: string;
  };
  readonly csrfToken: string;
}

interface LoginResult {
  readonly actorId: string;
  readonly cookieHeader: string;
  readonly csrfToken: string;
}

interface ContentItemResponse {
  readonly item: {
    readonly id: string;
    readonly title: string;
  };
}

interface ContentRevisionResponse {
  readonly revision: {
    readonly compiled: CompiledContentArtifact;
    readonly contentHash: string;
    readonly details: string;
    readonly id: string;
    readonly revisionNumber: number;
    readonly sourceText: string;
  };
}

interface ContentDetailResponse {
  readonly revisions: readonly {
    readonly details: string;
    readonly id: string;
    readonly revisionNumber: number;
    readonly sourceText: string;
  }[];
}

interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
  };
}

async function withStorage(
  run: (storage: TestStorage, env: Env) => Promise<void>,
): Promise<void> {
  const storage = await createTestStorage();

  try {
    await run(storage, { CARNAP_ENV: "local", DB: storage.db });
  } finally {
    await storage.dispose();
  }
}

function setCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & {
    readonly getSetCookie?: () => string[];
  };

  if (headers.getSetCookie !== undefined) {
    return headers.getSetCookie();
  }

  return (headers.get("set-cookie") ?? "")
    .split(/,(?=\s*[^;=]+=)/)
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.length > 0);
}

function cookieHeader(response: Response): string {
  return setCookieHeaders(response)
    .map((cookie) => cookie.split(";")[0] ?? "")
    .join("; ");
}

function jsonRequest(body: unknown, login?: LoginResult): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(login === undefined
        ? {}
        : {
            Cookie: login.cookieHeader,
            "X-CSRF-Token": login.csrfToken,
          }),
    },
    method: "POST",
  };
}

/** Signs in with no authoring permission at all — a student, in effect. */
async function signIn(env: Env, email: string): Promise<LoginResult> {
  const app = createTestApp();
  const startResponse = await appRequest(
    app,
    "/auth/login/start",
    jsonRequest({ email }),
    env,
  );
  const startBody = (await startResponse.json()) as StartLoginResponse;
  const confirmResponse = await appRequest(
    app,
    "/auth/login/confirm",
    jsonRequest({ loginToken: startBody.login.loginToken }),
    env,
  );
  const body = (await confirmResponse.json()) as LoginResponse;

  return {
    actorId: body.actor.id,
    cookieHeader: cookieHeader(confirmResponse),
    csrfToken: body.csrfToken,
  };
}

/**
 * Signs in as somebody who may write content. Nobody may by default, so every
 * test below that saves an item or a revision goes through here.
 */
async function login(env: Env, email: string): Promise<LoginResult> {
  const result = await signIn(env, email);

  await grantTestContentAuthor(env, result.actorId);

  return result;
}

async function createContent(
  env: Env,
  loginResult: LoginResult,
): Promise<ContentItemResponse> {
  const response = await appRequest(
    createTestApp(),
    "/content",
    jsonRequest({ title: "Truth tables" }, loginResult),
    env,
  );

  expect(response.status).toBe(201);

  return (await response.json()) as ContentItemResponse;
}

function sampleSource(id = "truth_table_1"): string {
  return `# Truth tables

Choose the tautology.

::::multiple-choice{#${id} title="Tautology" points="2"}
Which sentence is a tautology?

- [x] excluded_middle | P or not P
- [ ] contradiction | P and not P
::::

Good work.`;
}

function findExercise(
  artifact: CompiledContentArtifact,
  id = "truth_table_1",
): ExerciseManifestItem {
  const item = artifact.manifest.find((entry) => entry.id === id);

  if (item === undefined) {
    throw new Error("Missing exercise manifest item.");
  }

  return item;
}

describe("content compiler", () => {
  /**
   * The starter text a fresh content item opens with, from the editor page
   * itself — not the `sampleSource` fixture above, which merely shares its name.
   *
   * Nothing used to compile the real one, and it silently rotted: the directive
   * it names was spelled `aufbau-multiple-choice` and then
   * `carnap-multiple-choice`, and both survived the renames that made them
   * invalid, so an author's first sight of the format was a template that would
   * not compile. It is the one piece of Carnap Markdown the app ships, and the
   * only one no author can be blamed for.
   */
  test("the editor's starter template compiles", async () => {
    const compiled = await compileCarnapMarkdown(starterTemplate());

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.ok).toBe(true);
  });

  test("compiles interleaved prose and multiple-choice directives", async () => {
    const compiled = await compileCarnapMarkdown(sampleSource());

    expect(compiled.ok).toBe(true);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    expect(compiled.artifact.document.nodes.map((node) => node.kind)).toEqual(
      ["markdown", "exercise", "markdown"],
    );
    expect(compiled.artifact.manifest).toHaveLength(1);
    expect(compiled.artifact.manifest[0]?.id).toBe("truth_table_1");
    expect(JSON.stringify(compiled.artifact.document)).not.toContain(
      "correctOptionIds",
    );
    expect(compiled.artifact.manifest[0]?.privateData).toEqual({
      correctOptionIds: ["excluded_middle"],
      mode: "single",
    });
    expect(compiled.artifact.manifest[0]?.nominalPoints).toBe(2);
    expect(compiled.artifact.manifest[0]?.schemaVersion).toBe(1);
    expect(compiled.artifact.manifest[0]?.answerKind).toBe(
      MULTIPLE_CHOICE_ANSWER_KIND,
    );
  });

  test("renders Markdown through remark", async () => {
    const compiled = await compileCarnapMarkdown(`# Lesson

A [safe link](https://example.test) has **emphasis**.

::::multiple-choice{#markdown_bits title="Markdown" points="1"}
Pick **one**.

- [x] yes | **Yes**
- [ ] no | [No](https://example.test/no)
::::`);

    expect(compiled.ok).toBe(true);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    const prose = compiled.artifact.document.nodes[0];
    const serialized = JSON.stringify(
      findExercise(compiled.artifact, "markdown_bits"),
    );

    expect(prose?.kind).toBe("markdown");

    if (prose?.kind !== "markdown") {
      throw new Error("Expected a Markdown node.");
    }

    expect(prose.html).toContain(
      '<a href="https://example.test">safe link</a>',
    );
    expect(prose.html).toContain("<strong>emphasis</strong>");
    expect(serialized).toContain("<p>Pick <strong>one</strong>.</p>");
    expect(serialized).toContain("<strong>Yes</strong>");
  });

  test("compiles pipe tables, alignment and all", async () => {
    const compiled = await compileCarnapMarkdown(`| symbol | ascii | reads |
| :----- | :---: | ----: |
| \`∧\` | \`/\\\` | and |
| \`∨\` | \`\\/\` | or |
`);

    expect(compiled.diagnostics).toEqual([]);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    const prose = compiled.artifact.document.nodes[0];

    if (prose?.kind !== "markdown") {
      throw new Error("Expected a Markdown node.");
    }

    // The alignment row survives sanitization: it is the `align` attribute
    // that carries `:---:` to the page, and the default schema is strict
    // about which attributes it keeps.
    expect(prose.html).toContain('<th align="left">symbol</th>');
    expect(prose.html).toContain('<th align="center">ascii</th>');
    expect(prose.html).toContain('<th align="right">reads</th>');
    expect(prose.html).toContain('<td align="center"><code>/\\</code></td>');
  });

  /**
   * Task lists are the reason the dialect takes the table and footnote
   * extensions one by one instead of all of GFM: an option line opens with
   * `[x]`, which GFM would read as a checkbox and eat.
   */
  test("a multiple-choice option keeps its literal [x]", async () => {
    const compiled = await compileCarnapMarkdown(`::::multiple-choice{#q1}
Pick one.

- [x] yes | Yes
- [ ] no | No
::::`);

    expect(compiled.diagnostics).toEqual([]);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    expect(compiled.artifact.manifest[0]?.publicData).toEqual({
      mode: "single",
      options: [
        { html: "Yes", id: "yes" },
        { html: "No", id: "no" },
      ],
      promptHtml: "<p>Pick one.</p>",
    });
  });

  test("compiles footnotes into linked notes at the foot", async () => {
    const compiled = await compileCarnapMarkdown(`Frege said so.[^sinn]

[^sinn]: *Über Sinn und Bedeutung*, page 25.
`);

    expect(compiled.diagnostics).toEqual([]);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    const prose = compiled.artifact.document.nodes[0];

    if (prose?.kind !== "markdown") {
      throw new Error("Expected a Markdown node.");
    }

    // The marker is numbered by position and points at the note; the note
    // points back. Both halves of each pair must agree, which is what the
    // sanitizer's own id-namespacing used to break: it rewrote the ids and
    // left the hrefs alone.
    expect(prose.html).toContain('href="#user-content-n1-fn-sinn"');
    expect(prose.html).toContain('<li id="user-content-n1-fn-sinn">');
    expect(prose.html).toContain('id="user-content-n1-fnref-sinn"');
    expect(prose.html).toContain('href="#user-content-n1-fnref-sinn"');
    expect(prose.html).toContain(
      '<section data-footnotes class="footnotes">',
    );
    // The section's heading names it for a screen reader and must stay out of
    // sight, which takes this site's utility class rather than GitHub's.
    expect(prose.html).toContain('<h2 class="visually-hidden"');
    expect(prose.html).toContain("<em>Über Sinn und Bedeutung</em>");
  });

  /**
   * The idiom is to collect footnote definitions at the foot of the source —
   * which, in a lesson, is past every exercise directive and so past the point
   * where the prose that cites them became its own node. Each node is rendered
   * on its own, so without hoisting the marker would link to a note that is
   * never emitted.
   */
  test("a footnote defined below an exercise still reaches its prose", async () => {
    const compiled = await compileCarnapMarkdown(`Intro with a note.[^one]

::::multiple-choice{#q1}
Pick.

- [x] a | A
- [ ] b | B
::::

Later prose, another note.[^two]

[^one]: The first note.

[^two]: The second note.
`);

    expect(compiled.diagnostics).toEqual([]);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    const [intro, , later] = compiled.artifact.document.nodes;

    if (intro?.kind !== "markdown" || later?.kind !== "markdown") {
      throw new Error("Expected prose on both sides of the exercise.");
    }

    expect(intro.html).toContain("The first note.");
    expect(intro.html).not.toContain("The second note.");
    expect(later.html).toContain("The second note.");
    // Every id is namespaced by the count the block starts from, so the second
    // marker on the page cannot jump to the first block's note — and the two
    // hidden "Footnotes" headings are not the same id twice.
    expect(intro.html).toContain('id="user-content-n1-footnote-label"');
    expect(later.html).toContain('id="user-content-n2-footnote-label"');
  });

  /**
   * Each block renders on its own, and `mdast-util-to-hast` numbers the notes of
   * every tree it is handed from 1 — so without a shared count a lesson shows
   * one note numbered 1 before an exercise and another numbered 1 after it.
   */
  test("footnote numbering runs on through a document", async () => {
    const compiled = await compileCarnapMarkdown(`Opening claim.[^one]

::::short-answer{#q1 answer="x"}
A prompt with its own note.[^two]

[^two]: Cited from inside the prompt.
::::

Closing claim[^three] and one more.[^four]

[^one]: The first note.
[^three]: The third note.
[^four]: The fourth note.
`);

    expect(compiled.diagnostics).toEqual([]);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    const [intro, exercise, closing] = compiled.artifact.document.nodes;

    if (
      intro?.kind !== "markdown" ||
      exercise?.kind !== "exercise" ||
      closing?.kind !== "markdown"
    ) {
      throw new Error("Expected prose on both sides of the exercise.");
    }

    const prompt = (exercise.publicData as { readonly promptHtml: string })
      .promptHtml;
    const markers = (html: string): string[] =>
      [...html.matchAll(/data-footnote-ref[^>]*>(\d+)</g)].map(
        (match) => match[1] as string,
      );

    // The prompt's note continues the prose's count rather than restarting it,
    // and the run after the exercise carries on from the prompt.
    expect(markers(intro.html)).toEqual(["1"]);
    expect(markers(prompt)).toEqual(["2"]);
    expect(markers(closing.html)).toEqual(["3", "4"]);
    // The notes themselves are an ordered list, so it has to start where its
    // block's numbering does or the list would count 1, 1, 1 down the page.
    expect(intro.html).toContain("<ol>");
    expect(prompt).toContain('<ol start="2">');
    expect(closing.html).toContain('<ol start="3">');
    // The back-links name the reference they return to, which is the number the
    // reader can see.
    expect(closing.html).toContain('aria-label="Back to reference 4"');
  });

  test("two prompts may use the same footnote label", async () => {
    const compiled =
      await compileCarnapMarkdown(`::::short-answer{#q1 answer="x"}
Name it.[^1]

[^1]: A note.
::::

::::short-answer{#q2 answer="y"}
Name it again.[^1]

[^1]: A different note.
::::`);

    expect(compiled.diagnostics).toEqual([]);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    const prompts = compiled.artifact.manifest.map(
      (item) =>
        (item.publicData as { readonly promptHtml: string }).promptHtml,
    );

    // Ids are built from the label the author wrote, so two prompts that both
    // use `[^1]` would mint the same one; the count each block starts from is
    // what keeps them apart.
    expect(prompts[0]).toContain('<li id="user-content-n1-fn-1">');
    expect(prompts[1]).toContain('<li id="user-content-n2-fn-1">');
  });

  test("an undefined footnote marker stays literal text", async () => {
    const compiled = await compileCarnapMarkdown("See here.[^nope] Done.\n");

    expect(compiled.diagnostics).toEqual([]);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    const prose = compiled.artifact.document.nodes[0];

    if (prose?.kind !== "markdown") {
      throw new Error("Expected a Markdown node.");
    }

    expect(prose.html).toBe("<p>See here.[^nope] Done.</p>");
  });

  test("compiles free-response and short-answer directives", async () => {
    const compiled = await compileCarnapMarkdown(`# Lesson

::::free-response{#essay_1 title="Explain" points="5" rubric="Mention truth preservation."}
Explain why the argument is valid.
::::

::::short-answer{#term_1 answer="modus ponens" points="2"}
Name the rule.
::::`);

    expect(compiled.ok).toBe(true);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    expect(compiled.artifact.manifest.map((item) => item.kind)).toEqual([
      FREE_RESPONSE_KIND,
      SHORT_ANSWER_KIND,
    ]);
    expect(compiled.artifact.manifest[0]?.answerKind).toBe(
      FREE_RESPONSE_ANSWER_KIND,
    );
    expect(compiled.artifact.manifest[0]?.capabilities).toEqual({
      supportsAutomaticEvaluation: false,
      supportsManualReview: true,
    });
    expect(compiled.artifact.manifest[0]?.privateData).toEqual({
      rubricHtml: "Mention truth preservation.",
    });
    expect(compiled.artifact.manifest[1]?.answerKind).toBe(
      SHORT_ANSWER_ANSWER_KIND,
    );
    expect(JSON.stringify(compiled.artifact.document)).not.toContain(
      "Mention truth preservation",
    );
    expect(JSON.stringify(compiled.artifact.document)).not.toContain(
      "modus ponens",
    );
    expect(compiled.artifact.manifest[1]?.privateData).toEqual({
      acceptedAnswers: ["modus ponens"],
      caseSensitive: false,
    });
  });

  test("the exam attribute lands in the manifest only when set", async () => {
    const exam = await compileCarnapMarkdown(`::::multiple-choice{#q1 exam}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::

::::short-answer{#term_1 answer="modus ponens" exam="true"}
Name the rule.
::::

::::short-answer{#term_2 answer="modus ponens" exam="false"}
Name the rule again.
::::`);

    expect(exam.ok).toBe(true);

    if (!exam.ok) {
      throw new Error("Expected successful compilation.");
    }

    expect(exam.artifact.manifest[0]?.exam).toBe(true);
    expect(exam.artifact.manifest[1]?.exam).toBe(true);
    // The written `false` is carried. It used to compile away, which made it
    // indistinguishable from silence — and the two are now different
    // instructions, since silence defers to the assignment and this does not.
    expect(exam.artifact.manifest[2]?.exam).toBe(false);

    const plain = await compileCarnapMarkdown(sampleSource());

    if (!plain.ok) {
      throw new Error("Expected successful compilation.");
    }

    expect(plain.artifact.manifest[0]?.exam).toBeUndefined();

    const invalid =
      await compileCarnapMarkdown(`::::multiple-choice{#q1 exam="banana"}
Choose yes.

- [x] yes | Yes
::::`);

    expect(invalid.ok).toBe(false);

    if (invalid.ok) {
      throw new Error("Expected compilation to fail.");
    }

    expect(
      invalid.diagnostics.map((diagnosticEntry) => diagnosticEntry.code),
    ).toContain("invalid_exam");
  });

  test("short-answer normalization and evaluation are registry based", async () => {
    const compiled =
      await compileCarnapMarkdown(`::::short-answer{#term_1 answers="modus ponens|MP" points="2"}
Name the rule.
::::`);
    const registry = createDefaultExerciseKindRegistry();

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    const item = findExercise(compiled.artifact, "term_1");
    const correct = registry.normalizeAnswer(item, {
      data: { text: " mp " },
      kind: SHORT_ANSWER_ANSWER_KIND,
      schemaVersion: 1,
    });

    expect(correct.ok).toBe(true);

    if (!correct.ok) {
      throw new Error("Unexpected normalization result.");
    }

    await expect(
      registry.evaluateAutomatic(item, correct.answer, {
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ awardedScore: 2, status: "correct" });
    expect(
      registry.reviewAnswer(item, correct.answer, {
        audience: "student",
        i18n: passthroughTranslator,
      }),
    ).toMatchObject({
      summary: "mp",
    });
  });

  test("free-response answers normalize without automatic evaluation", async () => {
    const compiled =
      await compileCarnapMarkdown(`::::free-response{#essay_1 points="5" rubric="Check for a cited rule."}
Explain the proof.
::::`);
    const registry = createDefaultExerciseKindRegistry();

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    const item = findExercise(compiled.artifact, "essay_1");
    const normalized = registry.normalizeAnswer(item, {
      data: { text: "Because the rule preserves truth." },
      kind: FREE_RESPONSE_ANSWER_KIND,
      schemaVersion: 1,
    });

    expect(normalized.ok).toBe(true);

    if (!normalized.ok) {
      throw new Error("Unexpected normalization result.");
    }

    await expect(
      registry.evaluateAutomatic(item, normalized.answer, {
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).resolves.toBeNull();
    expect(
      registry.reviewAnswer(item, normalized.answer, {
        audience: "instructor",
        i18n: passthroughTranslator,
      }),
    ).toMatchObject({
      rubricHtml: "Check for a cited rule.",
      summary: "Because the rule preserves truth.",
    });
    expect(
      registry.reviewAnswer(item, normalized.answer, {
        audience: "student",
        i18n: passthroughTranslator,
      }),
    ).not.toHaveProperty("rubricHtml");
  });

  test("exercise IDs stay stable when prose is reordered", async () => {
    const first = await compileCarnapMarkdown(sampleSource("stable_id"));
    const second = await compileCarnapMarkdown(
      `${sampleSource("stable_id")}\n\nA later paragraph.`,
    );

    if (!first.ok || !second.ok) {
      throw new Error("Expected successful compilation.");
    }

    expect(first.artifact.manifest[0]?.id).toBe("stable_id");
    expect(second.artifact.manifest[0]?.id).toBe("stable_id");
    expect(first.artifact.manifest[0]?.declarationHash).toBe(
      second.artifact.manifest[0]?.declarationHash,
    );
  });

  test("unsupported syntax produces useful diagnostics", async () => {
    const compiled = await compileCarnapMarkdown(`Unsafe <script></script>

::::unknown{#bad}
Body
::::`);

    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((item) => item.code)).toContain(
      "unsafe_raw_html",
    );
    expect(compiled.diagnostics.map((item) => item.code)).toContain(
      "unsupported_directive",
    );
  });

  test("legacy directive syntax is rejected", async () => {
    const compiled = await compileCarnapMarkdown(`::::multiple-choice id="old"
Question?

- [x] yes | Yes
- [ ] no | No
::::`);

    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((item) => item.code)).toContain(
      "invalid_directive_attributes",
    );
  });

  test("missing and duplicate exercise IDs are rejected", async () => {
    const missing = await compileCarnapMarkdown(`::::multiple-choice
Question?

- [x] yes | Yes
- [ ] no | No
::::`);
    const duplicate = await compileCarnapMarkdown(`${sampleSource("dup")}

::::multiple-choice{#dup}
Another?

- [x] yes | Yes
- [ ] no | No
::::`);

    expect(missing.ok).toBe(false);
    expect(missing.diagnostics.map((item) => item.code)).toContain(
      "missing_id",
    );
    expect(duplicate.ok).toBe(false);
    expect(duplicate.diagnostics.map((item) => item.code)).toContain(
      "duplicate_exercise_id",
    );
  });

  test("an exercise ID may be anything HTML would take as an id", async () => {
    // A textbook numbers its problems "1.2", and refusing that spelling bought
    // nothing: an ID reaches the page as `data-exercise-id="…"`, which an
    // attribute selector matches with the dot and all. What is still refused is
    // what HTML itself refuses — a space — and what would make two IDs
    // indistinguishable on screen.
    const cases = [
      { attrs: 'id="ex1.2"', id: "ex1.2" },
      { attrs: 'id="1.2"', id: "1.2" },
      { attrs: 'id="σ1"', id: "σ1" },
      { attrs: 'id="ex#2"', id: "ex#2" },
    ];

    for (const { attrs, id } of cases) {
      const compiled = await compileCarnapMarkdown(
        `::::multiple-choice{${attrs}}\nQuestion?\n\n- [x] yes | Yes\n- [ ] no | No\n::::`,
      );

      expect(compiled.diagnostics).toEqual([]);

      if (!compiled.ok) {
        throw new Error("Expected successful compilation.");
      }

      expect(compiled.artifact.manifest.map((item) => item.id)).toEqual([id]);
    }

    // A space; the non-breaking space that would look like none, written as
    // an escape because in source it would look like the line above; and one
    // character past the limit.
    for (const attrs of [
      'id="ex 2"',
      'id="ex\u00a02"',
      `id="${"x".repeat(65)}"`,
    ]) {
      const compiled = await compileCarnapMarkdown(
        `::::multiple-choice{${attrs}}\nQuestion?\n\n- [x] yes | Yes\n- [ ] no | No\n::::`,
      );

      expect(compiled.diagnostics.map((item) => item.code)).toContain(
        "invalid_exercise_id",
      );
    }
  });

  test("a dotted ID written with the # shorthand is caught, not silently truncated", async () => {
    // `.2` is a class there, as it is in HTML — so the ID would quietly become
    // `ex1`. It does not, because a directive's attributes are a closed list:
    // the stray class is what fails, and the author is told to write `id=`.
    const compiled = await compileCarnapMarkdown(
      `::::multiple-choice{#ex1.2}\nQuestion?\n\n- [x] yes | Yes\n- [ ] no | No\n::::`,
    );

    expect(compiled.ok).toBe(false);
    expect(
      compiled.diagnostics.find((item) => item.code === "unknown_attribute")
        ?.params,
    ).toEqual({
      accepted: "exam, feedback, id, mode, points, title",
      name: "class",
    });
  });

  test("an attribute the directive does not know is refused, by name", async () => {
    const compiled =
      await compileCarnapMarkdown(`::::multiple-choice{#m1 exm="true"}
Question?

- [x] yes | Yes
- [ ] no | No
::::`);

    expect(compiled.ok).toBe(false);

    const unknown = compiled.diagnostics.find(
      (item) => item.code === "unknown_attribute",
    );

    // Naming the accepted set is the point: `exm` is a typo of `exam`, and
    // `exam` is what decides whether a wrong answer is recorded at all. Told
    // only "unknown attribute", an author is left guessing at the spelling.
    expect(unknown?.params).toEqual({
      accepted: "exam, feedback, id, mode, points, title",
      name: "exm",
    });
  });

  test("every exercise directive refuses an attribute it does not know", async () => {
    const registry = createDefaultAuthoringExerciseRegistry();
    const names = registry.directiveNames();

    expect(names.length).toBe(10);

    // The bodies are nonsense, so every one of these compiles to a pile of
    // diagnostics — which is fine, because the attribute check runs before any
    // of them. What is being tested is that a tenth type cannot quietly skip
    // `validateAttributes` and go back to discarding what its author wrote.
    for (const name of names) {
      const compiled = await compileCarnapMarkdown(
        `::::${name}{#x1 nonesuch="1"}\nBody\n::::`,
      );

      expect(compiled.ok).toBe(false);
      expect(
        compiled.diagnostics.filter(
          (item) =>
            item.code === "unknown_attribute" &&
            item.params?.name === "nonesuch",
        ).length,
        `${name} should refuse an unknown attribute`,
      ).toBe(1);
    }
  });

  test("feedback is recorded only when the author asks for it", async () => {
    const silent = await compileCarnapMarkdown(sampleSource("q1"));
    const asked = await compileCarnapMarkdown(
      sampleSource("q1").replace("{#q1", '{#q1 feedback="terse"'),
    );

    if (!silent.ok || !asked.ok) {
      throw new Error("Expected successful compilation.");
    }

    // Absent, not defaulted: the default depends on the assignment the exercise
    // is used in, and one artifact serves many. Absence also keeps the
    // declaration hash of everything compiled before `feedback` existed.
    expect(silent.artifact.manifest[0]?.feedback).toBeUndefined();
    expect(asked.artifact.manifest[0]?.feedback).toBe("terse");
    expect(asked.artifact.manifest[0]?.declarationHash).not.toBe(
      silent.artifact.manifest[0]?.declarationHash,
    );
  });

  test("a feedback value nobody knows is refused", async () => {
    const compiled = await compileCarnapMarkdown(
      sampleSource("q1").replace("{#q1", '{#q1 feedback="quiet"'),
    );

    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((item) => item.code)).toContain(
      "invalid_feedback",
    );
  });

  test('feedback="none" and exam="false" compiles, and both survive', async () => {
    const compiled = await compileCarnapMarkdown(
      sampleSource("q1").replace("{#q1", '{#q1 feedback="none" exam="false"'),
    );

    // This used to be refused as a contradiction, on the reasoning that
    // withholding the verdict while discarding the work leaves a student unable
    // to submit and unable to learn why. It does not: the runtime says the
    // submission was not recorded, so pressing Submit and watching whether it
    // sticks is the feedback. An author asking for that is asking the student
    // to commit before they learn anything, without holding a wrong try against
    // them.
    expect(compiled.ok).toBe(true);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    expect(compiled.artifact.manifest[0]).toMatchObject({
      exam: false,
      feedback: "none",
    });
  });

  test("an exam attribute nobody wrote is absent, not false", async () => {
    // The distinction the declaration has to carry: `false` is an instruction
    // ("let them retry, whatever the assignment says") and absence is not, so
    // collapsing them would put the attribute back to being a no-op.
    const silent = await compileCarnapMarkdown(sampleSource("q1"));
    const written = await compileCarnapMarkdown(
      sampleSource("q1").replace("{#q1", '{#q1 exam="false"'),
    );

    if (!silent.ok || !written.ok) {
      throw new Error("Expected successful compilation.");
    }

    expect(silent.artifact.manifest[0]).not.toHaveProperty("exam");
    expect(written.artifact.manifest[0]?.exam).toBe(false);
    // And it is in the hashed declaration, not just the manifest, so the
    // instruction cannot be lost between compiling and recording.
    expect(silent.artifact.manifest[0]?.declarationHash).not.toBe(
      written.artifact.manifest[0]?.declarationHash,
    );
  });

  test("a theory block refuses exercise attributes", async () => {
    const compiled =
      await compileCarnapMarkdown(`:::aufbau-mm0{name="t" points="2"}
term wff: sort;
:::`);

    expect(compiled.ok).toBe(false);
    expect(
      compiled.diagnostics.some(
        (item) =>
          item.code === "unknown_attribute" && item.params?.name === "points",
      ),
    ).toBe(true);
  });

  test("multiple-choice normalization and evaluation are registry based", async () => {
    const compiled = await compileCarnapMarkdown(sampleSource());
    const registry = createDefaultExerciseKindRegistry();

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    const item = findExercise(compiled.artifact);
    const correct = registry.normalizeAnswer(item, {
      data: { selectedOptionIds: ["excluded_middle"] },
      kind: MULTIPLE_CHOICE_ANSWER_KIND,
      schemaVersion: 1,
    });
    const incorrect = registry.normalizeAnswer(item, {
      data: { selectedOptionIds: ["contradiction"] },
      kind: MULTIPLE_CHOICE_ANSWER_KIND,
      schemaVersion: 1,
    });
    const malformed = registry.normalizeAnswer(item, {
      data: { selectedOptionIds: ["missing"] },
      kind: MULTIPLE_CHOICE_ANSWER_KIND,
      schemaVersion: 1,
    });

    expect(correct.ok).toBe(true);
    expect(incorrect.ok).toBe(true);
    expect(malformed.ok).toBe(false);

    if (!correct.ok || !incorrect.ok || malformed.ok) {
      throw new Error("Unexpected normalization result.");
    }

    await expect(
      registry.evaluateAutomatic(item, correct.answer, {
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ awardedScore: 2, status: "correct" });
    await expect(
      registry.evaluateAutomatic(item, incorrect.answer, {
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ awardedScore: 0, status: "incorrect" });
    expect(malformed.reason).toBe("schema-invalid");
  });

  test("preview rendering uses registered components", async () => {
    const compiled = await compileCarnapMarkdown(sampleSource());
    const handler = new MultipleChoiceExerciseHandler();

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    const html = renderCompiledContent(compiled.artifact, i18nFor("en"));

    expect(handler.component.assetId).toBe("carnap-multiple-choice-v1");
    expect(html).toContain('data-component="carnap-multiple-choice"');
    expect(html).toContain("Truth tables");
  });

  test("style directives are extracted, not rendered", async () => {
    const compiled = await compileCarnapMarkdown(`Before the styles.

:::style
h1 { color: maroon; }
:::

After the styles.`);

    expect(compiled.ok).toBe(true);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    expect(compiled.artifact.css).toBe("h1 { color: maroon; }");
    expect(compiled.artifact.cssReset).toBeUndefined();
    expect(
      renderCompiledContent(compiled.artifact, i18nFor("en")),
    ).not.toContain("maroon");
    // No flush around the style block: the surrounding prose stays one node.
    expect(compiled.artifact.document.nodes.map((node) => node.kind)).toEqual(
      ["markdown"],
    );
  });

  test("css code fences stay code samples", async () => {
    const compiled = await compileCarnapMarkdown(`A sample:

\`\`\`css
h1 { color: maroon; }
\`\`\``);

    expect(compiled.ok).toBe(true);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    expect(compiled.artifact.css).toBeUndefined();
    expect(renderCompiledContent(compiled.artifact, i18nFor("en"))).toContain(
      "maroon",
    );
  });

  test("style directives concatenate and reset clears defaults", async () => {
    const compiled = await compileCarnapMarkdown(`:::style{reset}
body { font-family: serif; }
:::

Prose.

:::style
h1 { color: maroon; }
:::`);

    expect(compiled.ok).toBe(true);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    expect(compiled.artifact.css).toBe(
      "body { font-family: serif; }\n\nh1 { color: maroon; }",
    );
    expect(compiled.artifact.cssReset).toBe(true);
  });

  test("an empty reset block clears defaults without adding css", async () => {
    const compiled = await compileCarnapMarkdown(`:::style{reset}
:::

Prose.`);

    expect(compiled.ok).toBe(true);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    expect(compiled.artifact.css).toBeUndefined();
    expect(compiled.artifact.cssReset).toBe(true);
  });

  test("style bodies are exempt from the raw-HTML scan", async () => {
    const inStyle = await compileCarnapMarkdown(`:::style
p::before { content: "<b>"; }
:::`);
    const inProse = await compileCarnapMarkdown(`The tag <b> is bold.`);

    expect(inStyle.ok).toBe(true);

    if (!inStyle.ok) {
      throw new Error("Expected successful compilation.");
    }

    expect(inStyle.artifact.css).toContain('content: "<b>";');
    expect(inProse.ok).toBe(false);
    expect(inProse.diagnostics.map((item) => item.code)).toContain(
      "unsafe_raw_html",
    );
  });

  test("style directives reject unknown attributes and nesting", async () => {
    const unknownAttribute = await compileCarnapMarkdown(`:::style{scope=all}
h1 { color: maroon; }
:::`);
    const nested = await compileCarnapMarkdown(`::::free-response{#essay_1}
Explain.

:::style
h1 { color: maroon; }
:::
::::`);

    expect(unknownAttribute.ok).toBe(false);
    expect(unknownAttribute.diagnostics.map((item) => item.code)).toContain(
      "invalid_style_attributes",
    );
    expect(nested.ok).toBe(false);
    expect(nested.diagnostics.map((item) => item.code)).toContain(
      "unsupported_directive",
    );
  });

  test("style directives link external stylesheets via src", async () => {
    const compiled =
      await compileCarnapMarkdown(`:::style{src="https://styles.example.test/theme.css"}
:::

:::style{reset src="/styles/slate.css"}
h1 { color: maroon; }
:::`);

    expect(compiled.ok).toBe(true);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    expect(compiled.artifact.cssHrefs).toEqual([
      "https://styles.example.test/theme.css",
      "/styles/slate.css",
    ]);
    expect(compiled.artifact.css).toBe("h1 { color: maroon; }");
    expect(compiled.artifact.cssReset).toBe(true);
  });

  test("style src accepts only https URLs and site-relative paths", async () => {
    const rejected = [
      "http://styles.example.test/theme.css",
      "//styles.example.test/theme.css",
      "javascript:alert(1)",
      "theme.css",
      "",
    ];

    for (const src of rejected) {
      const compiled = await compileCarnapMarkdown(`:::style{src="${src}"}
:::`);

      expect(compiled.ok).toBe(false);

      if (compiled.ok) {
        throw new Error(`Expected ${src} to be rejected.`);
      }

      expect(compiled.diagnostics.map((item) => item.code)).toContain(
        "invalid_style_src",
      );
    }
  });

  test("item links compile to relative resolver URLs everywhere", async () => {
    const compiled =
      await compileCarnapMarkdown(`Read [Chapter 2](item:chapter-2-id) and [the site](https://example.test).

::::multiple-choice{id="q1"}
Pick per [the rules](item:rules-id).

- [x] a | yes, see [notes](item:notes-id)
- [ ] b | no
::::`);

    expect(compiled.ok).toBe(true);

    if (!compiled.ok) {
      throw new Error("Expected successful compilation.");
    }

    const prose = compiled.artifact.document.nodes[0];
    const publicData = compiled.artifact.manifest[0]?.publicData as {
      options: readonly { html: string }[];
      promptHtml: string;
    };

    expect(prose?.kind === "markdown" ? prose.html : "").toContain(
      '<a href="../../go/chapter-2-id">Chapter 2</a>',
    );
    expect(prose?.kind === "markdown" ? prose.html : "").toContain(
      '<a href="https://example.test">the site</a>',
    );
    expect(publicData.promptHtml).toContain(
      '<a href="../../go/rules-id">the rules</a>',
    );
    expect(publicData.options[0]?.html).toContain(
      '<a href="../../go/notes-id">notes</a>',
    );
  });

  test("malformed item links are rejected", async () => {
    for (const target of ["item:", "item:!bang", "item:-leading-dash"]) {
      const compiled = await compileCarnapMarkdown(
        `A [broken](${target}) link.`,
      );

      expect(compiled.ok).toBe(false);

      if (compiled.ok) {
        throw new Error(`Expected ${target} to be rejected.`);
      }

      expect(compiled.diagnostics.map((item) => item.code)).toContain(
        "invalid_item_link",
      );
    }
  });

  test("item-link syntax inside a style body stays inert CSS", async () => {
    const compiled = await compileCarnapMarkdown(`:::style
a::after { content: "[x](item:!bang)"; }
:::`);

    expect(compiled.ok).toBe(true);
  });

  test("the sanitize schema keeps class attributes and nothing else new", async () => {
    // No dialect syntax emits classes yet, so exercise the schema directly:
    // inject hast properties on a parsed paragraph the way a future
    // class-bearing construct would.
    const render = unified()
      .use(remarkParse)
      .use(() => (tree: Root) => {
        const paragraph = tree.children[0];

        if (paragraph !== undefined) {
          paragraph.data = {
            hProperties: {
              className: ["theorem", "numbered"],
              onClick: "alert(1)",
              style: "color: red",
            },
          };
        }
      })
      .use(remarkRehype)
      .use(rehypeSanitize, CONTENT_SANITIZE_SCHEMA)
      .use(rehypeStringify);
    const html = String(await render.process("A classed paragraph."));

    expect(html).toBe('<p class="theorem numbered">A classed paragraph.</p>');
  });
});

describe("content authoring permission", () => {
  test("a signed-in reader with no permission cannot create an item", async () => {
    await withStorage(async (_storage, env) => {
      const reader = await signIn(env, "reader@example.test");
      const response = await appRequest(
        createTestApp(),
        "/content",
        jsonRequest({ title: "Homework" }, reader),
        env,
      );
      const body = (await response.json()) as ErrorEnvelope;

      expect(response.status).toBe(403);
      expect(body.error.code).toBe("content_author_required");
    });
  });

  test("a reader with no permission cannot upload a revision", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "owner@example.test");
      const item = await createContent(env, author);
      const reader = await signIn(env, "uploader@example.test");
      const form = new FormData();

      form.set("csrfToken", reader.csrfToken);
      form.set(
        "sourceFile",
        new File([sampleSource()], "lesson.md", { type: "text/markdown" }),
      );

      const response = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions`,
        {
          body: form,
          headers: { Cookie: reader.cookieHeader },
          method: "POST",
        },
        env,
      );

      // Refused for the permission, not for the ownership: the upload never
      // reaches the question of whose item it is.
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("content_owner_required");
    });
  });

  test("the library offers no create bar to a reader who cannot write", async () => {
    await withStorage(async (_storage, env) => {
      const reader = await signIn(env, "browsing@example.test");
      const response = await appRequest(
        createTestApp(),
        "/content",
        { headers: { Accept: "text/html", Cookie: reader.cookieHeader } },
        env,
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain("You do not have permission to write content.");
      expect(html).not.toContain("Create content item");
      // Nor a nav item pointing back at a library they cannot fill.
      expect(html).not.toContain('href="/content">Content');
    });
  });

  test("course staff may author with no capability granted", async () => {
    await withStorage(async (storage, env) => {
      // The arm that keeps an LTI-launched instructor working: their LMS hands
      // them a course, and no administrator ever visits the grants screen.
      const instructor = await signIn(env, "lti-instructor@example.test");
      const now = new Date().toISOString();

      await storage.stores.courses.create({
        createdAt: now,
        createdById: instructor.actorId,
        id: "course-staffed-by-launch",
        timezone: "UTC",
        title: "Logic",
      });
      await storage.stores.courses.addMembership({
        courseId: "course-staffed-by-launch",
        createdAt: now,
        id: "membership-staffed-by-launch",
        role: "instructor",
        status: "active",
        userId: instructor.actorId,
      });

      const response = await appRequest(
        createTestApp(),
        "/content",
        jsonRequest({ title: "Week one" }, instructor),
        env,
      );

      expect(response.status).toBe(201);
    });
  });

  test("a student membership confers nothing", async () => {
    await withStorage(async (storage, env) => {
      const student = await signIn(env, "enrolled@example.test");
      const now = new Date().toISOString();

      await storage.stores.courses.create({
        createdAt: now,
        createdById: student.actorId,
        id: "course-with-a-student",
        timezone: "UTC",
        title: "Logic",
      });
      await storage.stores.courses.addMembership({
        courseId: "course-with-a-student",
        createdAt: now,
        id: "membership-of-a-student",
        role: "student",
        status: "active",
        userId: student.actorId,
      });

      const response = await appRequest(
        createTestApp(),
        "/content",
        jsonRequest({ title: "Week one" }, student),
        env,
      );

      expect(response.status).toBe(403);
    });
  });
});

describe("content routes", () => {
  test("an author can create content and immutable revisions", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const item = await createContent(env, author);
      const first = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions`,
        jsonRequest({ sourceText: sampleSource("q1") }, author),
        env,
      );
      const second = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions`,
        jsonRequest({ sourceText: sampleSource("q2") }, author),
        env,
      );
      const firstBody = (await first.json()) as ContentRevisionResponse;
      const secondBody = (await second.json()) as ContentRevisionResponse;

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(firstBody.revision.revisionNumber).toBe(1);
      expect(secondBody.revision.revisionNumber).toBe(2);
      expect(firstBody.revision.sourceText).toContain("q1");
      expect(secondBody.revision.sourceText).toContain("q2");
      expect(firstBody.revision.contentHash).not.toBe(
        secondBody.revision.contentHash,
      );
    });
  });

  test("an author can upload a markdown file as a revision", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "upload-author@example.test");
      const item = await createContent(env, author);
      const form = new FormData();

      form.set("csrfToken", author.csrfToken);
      form.set(
        "sourceFile",
        new File([sampleSource("uploaded_q")], "lesson.md", {
          type: "text/markdown",
        }),
      );

      const response = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions`,
        {
          body: form,
          headers: { Cookie: author.cookieHeader },
          method: "POST",
        },
        env,
      );
      const detailResponse = await appRequest(
        createTestApp(),
        `/content/${item.item.id}`,
        { headers: { Cookie: author.cookieHeader } },
        env,
      );
      const detail = (await detailResponse.json()) as ContentDetailResponse;

      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe(
        `/content/${item.item.id}?revisionCreated=1`,
      );
      expect(detail.revisions).toHaveLength(1);
      expect(detail.revisions[0]?.sourceText).toContain("uploaded_q");
    });
  });

  test("a revision carries the note the author saved with it", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "noting-author@example.test");
      const item = await createContent(env, author);
      const created = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions`,
        jsonRequest(
          {
            details: "Replaced the tautology example.",
            sourceText: sampleSource("noted_q"),
          },
          author,
        ),
        env,
      );
      const createdBody = (await created.json()) as ContentRevisionResponse;
      const page = await appRequest(
        createTestApp(),
        `/content/${item.item.id}`,
        { headers: { Accept: "text/html", Cookie: author.cookieHeader } },
        env,
      );
      const pageHtml = await page.text();
      const revisionPage = await appRequest(
        createTestApp(),
        `/content/revisions/${createdBody.revision.id}`,
        { headers: { Accept: "text/html", Cookie: author.cookieHeader } },
        env,
      );
      const revisionHtml = await revisionPage.text();

      expect(created.status).toBe(201);
      expect(createdBody.revision.details).toBe(
        "Replaced the tautology example.",
      );
      // The note is how the list names the revision; the ordinal it used to
      // print is gone from the table entirely.
      expect(pageHtml).toContain("<th>Details</th>");
      expect(pageHtml).not.toContain("<th>Revision</th>");
      expect(pageHtml).toContain("Replaced the tautology example.");
      expect(revisionHtml).toContain("Replaced the tautology example.");
    });
  });

  test("the revisions table reads newest first", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "ordering-author@example.test");
      const item = await createContent(env, author);

      for (const [index, note] of [
        "The older note.",
        "The newer note.",
      ].entries()) {
        await appRequest(
          createTestApp(),
          `/content/${item.item.id}/revisions`,
          jsonRequest(
            { details: note, sourceText: sampleSource(`rev_${index}`) },
            author,
          ),
          env,
        );
      }

      const page = await appRequest(
        createTestApp(),
        `/content/${item.item.id}`,
        { headers: { Accept: "text/html", Cookie: author.cookieHeader } },
        env,
      );
      const html = await page.text();

      // The revision anyone is looking for is nearly always the last one
      // saved, so it is the first row rather than the one at the bottom of a
      // list that only grows.
      expect(html.indexOf("The newer note.")).toBeGreaterThan(-1);
      expect(html.indexOf("The newer note.")).toBeLessThan(
        html.indexOf("The older note."),
      );
    });
  });

  test("a revision saved without a note says so rather than showing nothing", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "quiet-author@example.test");
      const item = await createContent(env, author);
      const created = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions`,
        jsonRequest({ sourceText: sampleSource("unnoted_q") }, author),
        env,
      );
      const createdBody = (await created.json()) as ContentRevisionResponse;
      const page = await appRequest(
        createTestApp(),
        `/content/${item.item.id}`,
        { headers: { Accept: "text/html", Cookie: author.cookieHeader } },
        env,
      );
      const pageHtml = await page.text();

      expect(created.status).toBe(201);
      expect(createdBody.revision.details).toBe("");
      // A row still has to be clickable, so the empty case is worded.
      expect(pageHtml).toContain("No details given");
    });
  });

  test("an uploaded revision takes its note from the form", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "upload-noter@example.test");
      const item = await createContent(env, author);
      const form = new FormData();

      form.set("csrfToken", author.csrfToken);
      form.set("details", "  Imported from the shared drive.  ");
      form.set(
        "sourceFile",
        new File([sampleSource("upload_noted_q")], "lesson.md", {
          type: "text/markdown",
        }),
      );

      const response = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions`,
        {
          body: form,
          headers: { Cookie: author.cookieHeader },
          method: "POST",
        },
        env,
      );
      const detailResponse = await appRequest(
        createTestApp(),
        `/content/${item.item.id}`,
        { headers: { Cookie: author.cookieHeader } },
        env,
      );
      const detail = (await detailResponse.json()) as ContentDetailResponse;

      expect(response.status).toBe(303);
      // Stored trimmed: surrounding space in a note is never meaningful, and it
      // would make an empty-looking field a non-empty one.
      expect(detail.revisions[0]?.details).toBe(
        "Imported from the shared drive.",
      );
    });
  });

  test("the editor hands a typed note back when the source will not compile", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "retry-author@example.test");
      const item = await createContent(env, author);
      const form = new FormData();

      form.set("csrfToken", author.csrfToken);
      form.set("details", "Second attempt at the ID.");
      form.set(
        "sourceText",
        `::::multiple-choice{title="No id"}
Which sentence is a tautology?

- [x] excluded_middle | P or not P
::::`,
      );

      const response = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions/new`,
        {
          body: form,
          headers: { Cookie: author.cookieHeader },
          method: "POST",
        },
        env,
      );
      const html = await response.text();

      expect(response.status).toBe(400);
      expect(html).toContain('value="Second attempt at the ID."');
    });
  });

  test("a note longer than the cap is refused", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "verbose-author@example.test");
      const item = await createContent(env, author);
      const response = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions`,
        jsonRequest(
          {
            details: "x".repeat(501),
            sourceText: sampleSource("long_note_q"),
          },
          author,
        ),
        env,
      );
      const body = (await response.json()) as ErrorEnvelope;

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("invalid_content_details");
    });
  });

  test("the same source cannot be saved a second time under one item", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "repeat-author@example.test");
      const item = await createContent(env, author);
      const first = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions`,
        jsonRequest({ sourceText: sampleSource("repeat_q") }, author),
        env,
      );
      // Same text, different note. The (item, hash) index refuses this, and
      // before the check it refused it as an unhandled 500.
      const second = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions`,
        jsonRequest(
          {
            details: "Only the note is new.",
            sourceText: sampleSource("repeat_q"),
          },
          author,
        ),
        env,
      );
      const secondBody = (await second.json()) as ErrorEnvelope;

      expect(first.status).toBe(201);
      expect(second.status).toBe(400);
      expect(secondBody.error.code).toBe("duplicate_content_revision");
    });
  });

  test("content libraries are owner scoped", async () => {
    await withStorage(async (_storage, env) => {
      const firstAuthor = await login(env, "first@example.test");
      const secondAuthor = await login(env, "second@example.test");
      const item = await createContent(env, firstAuthor);
      const blocked = await appRequest(
        createTestApp(),
        `/content/${item.item.id}`,
        { headers: { Cookie: secondAuthor.cookieHeader } },
        env,
      );

      expect(blocked.status).toBe(403);
    });
  });

  test("revision pages embed the compiled document with author styles", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "styled-author@example.test");
      const stranger = await login(env, "stranger@example.test");
      const item = await createContent(env, author);
      const revisionResponse = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions`,
        jsonRequest(
          {
            sourceText: `:::style
h1 { color: maroon; }
:::

${sampleSource("styled_doc")}`,
          },
          author,
        ),
        env,
      );
      const revision =
        (await revisionResponse.json()) as ContentRevisionResponse;
      const documentUrl = `/content/revisions/${revision.revision.id}/document`;
      const page = await appRequest(
        createTestApp(),
        `/content/revisions/${revision.revision.id}`,
        { headers: { Accept: "text/html", Cookie: author.cookieHeader } },
        env,
      );
      const pageHtml = await page.text();
      const documentResponse = await appRequest(
        createTestApp(),
        documentUrl,
        { headers: { Cookie: author.cookieHeader } },
        env,
      );
      const documentHtml = await documentResponse.text();
      const blocked = await appRequest(
        createTestApp(),
        documentUrl,
        { headers: { Cookie: stranger.cookieHeader } },
        env,
      );

      expect(revisionResponse.status).toBe(201);
      // The page hosts the iframe; the fullscreen link opens the same URL,
      // without the marker that tells the document it sits in a frame of ours.
      expect(page.status).toBe(200);
      expect(pageHtml).toContain(`src="${documentUrl}?appframe=1"`);
      expect(pageHtml).toContain(`href="${documentUrl}"`);
      expect(pageHtml).toContain('target="_blank"');
      // The document carries the compiled markup and the author stylesheet
      // as a separate style element after the defaults, which it links rather
      // than carries — so the link is what the author's rules come after.
      expect(documentResponse.status).toBe(200);
      expect(documentHtml).toContain(
        'data-component="carnap-multiple-choice"',
      );
      expect(documentHtml).toContain("maroon");
      expect(documentHtml.indexOf("maroon")).toBeGreaterThan(
        documentHtml.indexOf(CONTENT_STYLE_SHEET.href),
      );
      expect(blocked.status).toBe(403);
    });
  });

  function editorForm(login: LoginResult, fields: Record<string, string>) {
    return {
      body: new URLSearchParams({ csrfToken: login.csrfToken, ...fields }),
      headers: {
        Accept: "text/html",
        Cookie: login.cookieHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    } satisfies RequestInit;
  }

  test("the editor pairs the source field with a compiled preview", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "editor@example.test");
      const item = await createContent(env, author);
      const response = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions/new`,
        { headers: { Accept: "text/html", Cookie: author.cookieHeader } },
        env,
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('name="sourceText"');
      expect(html).toContain("Create revision");
      // The sample source arrives already compiled inside the preview
      // iframe's srcdoc, attribute-escaped by the JSX encoder; from there
      // the preview bundle keeps it current as the author types.
      expect(html).toContain("srcdoc=");
      expect(html).toContain(
        "data-component=&quot;carnap-multiple-choice&quot;",
      );
      expect(html).toContain('src="/assets/editor-preview.js"');
      // The narrow-viewport Write/Preview switch ships in the markup (the
      // bundle reveals it; CSS keeps it to stacked layouts).
      expect(html).toContain("data-editor-mode-switch");
      expect(html).toContain('data-mode="write"');
    });
  });

  test("the editor offers a way out that does not save", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "editor@example.test");
      const item = await createContent(env, author);
      const response = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions/new`,
        { headers: { Accept: "text/html", Cookie: author.cookieHeader } },
        env,
      );
      const html = await response.text();

      // Back to the item the revision would have joined — the same place the
      // breadcrumb goes, and never the POST route the form saves through.
      expect(html).toContain(
        `<a class="button ghost" href="/content/${item.item.id}">Cancel</a>`,
      );
    });
  });

  test("the editor starts from the latest revision's source", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "editor@example.test");
      const item = await createContent(env, author);
      await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions`,
        jsonRequest({ sourceText: sampleSource("first_rev") }, author),
        env,
      );
      await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions`,
        jsonRequest({ sourceText: sampleSource("second_rev") }, author),
        env,
      );
      const response = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions/new`,
        { headers: { Accept: "text/html", Cookie: author.cookieHeader } },
        env,
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain("second_rev");
      expect(html).not.toContain("first_rev");
    });
  });

  test("saving invalid source reports diagnostics without saving", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "editor@example.test");
      const item = await createContent(env, author);
      const response = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions/new`,
        editorForm(author, { sourceText: "<strong>unsafe</strong>" }),
        env,
      );
      const html = await response.text();

      // The re-rendered editor compiles the rejected source server-side, so
      // the diagnostics show even before the preview bundle loads.
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(html).toContain("unsafe_raw_html");
      expect(html).toContain('name="sourceText"');

      const detailResponse = await appRequest(
        createTestApp(),
        `/content/${item.item.id}`,
        { headers: { Cookie: author.cookieHeader } },
        env,
      );
      const detail = (await detailResponse.json()) as ContentDetailResponse;

      expect(detail.revisions).toHaveLength(0);
    });
  });

  test("the editor creates a revision and redirects to the item", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "editor@example.test");
      const item = await createContent(env, author);
      const response = await appRequest(
        createTestApp(),
        `/content/${item.item.id}/revisions/new`,
        editorForm(author, { sourceText: sampleSource() }),
        env,
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe(
        `/content/${item.item.id}?revisionCreated=1`,
      );

      const detailResponse = await appRequest(
        createTestApp(),
        `/content/${item.item.id}`,
        { headers: { Cookie: author.cookieHeader } },
        env,
      );
      const detail = (await detailResponse.json()) as ContentDetailResponse;

      expect(detail.revisions).toHaveLength(1);
    });
  });
});
