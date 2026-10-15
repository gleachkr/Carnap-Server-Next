import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { JSDOM } from "jsdom";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { submissionNeedsReview } from "../src/worker/domain/assessment";
import type { Env } from "../src/worker/env";
import { withSystemText } from "../src/worker/exercise-kit/systems/join";
import type { TruthTreePublicData } from "../src/worker/exercises/truth-tree/types";
import { REVIEW_SCRIPT } from "../src/worker/web/assignment-scripts";
import { REVIEW_SCRIPT_ASSET } from "../src/worker/web/script-assets";
import { utcTimestampText } from "../src/worker/web/timestamp-formats";
import { appRequest, createTestApp } from "./helpers/app";
import { FITCH_THEORY_BLOCK } from "./helpers/fitch-theory";
import {
  authHeaders,
  createCourse,
  enrollStudent,
  jsonRequest,
  type LoginResult,
  login,
  withStorage,
} from "./helpers/http";
import { certifyTree } from "./helpers/truth-tree";

setDefaultTimeout(30_000);

interface ContentItemResponse {
  readonly item: { readonly id: string };
}

interface ContentRevisionResponse {
  readonly revision: { readonly id: string };
}

interface AssignmentResponse {
  readonly assignment: {
    readonly contentRevisionId: string;
    readonly id: string;
  };
}

interface BeginAttemptResponse {
  readonly attempt: { readonly id: string };
}

interface SubmissionResponse {
  readonly evaluation: {
    readonly checkerVersion: string | null;
    readonly maxScore: number;
    readonly result: {
      readonly answerKind: string;
      readonly contentRevisionId: string;
      readonly declarationHash: string;
      readonly exerciseId: string;
      readonly status: string;
    };
    readonly score: number;
  };
  readonly idempotent: boolean;
  readonly submission: {
    readonly answer: { readonly selectedOptionIds: readonly string[] };
    readonly answerKind: string;
    readonly contentRevisionId: string;
    readonly declarationHash: string;
    readonly exerciseId: string;
    readonly id: string;
    readonly submittedAt: string;
    readonly userId: string;
  };
}

interface SubmissionHistoryResponse {
  readonly submissions: readonly {
    readonly answerReview: {
      readonly details?: readonly {
        readonly label: string;
        readonly value: string;
      }[];
      readonly elementHtml?: string;
      readonly rubricHtml?: string;
      readonly summary: string;
    } | null;
    readonly evaluation: SubmissionResponse["evaluation"] | null;
    readonly submission: SubmissionResponse["submission"];
  }[];
}

type InstructorSubmissionsResponse = SubmissionHistoryResponse;

interface InstructorReviewSubmissionsResponse {
  readonly submissions: readonly {
    readonly evaluation:
      | (SubmissionResponse["evaluation"] & {
          readonly evaluatorKind: string;
        })
      | null;
    readonly needsReview: boolean;
    readonly submission: SubmissionResponse["submission"];
  }[];
}

interface FreeResponseSubmissionResponse {
  readonly evaluation: null;
  readonly submission: {
    readonly answer: { readonly text: string };
    readonly answerKind: string;
    readonly exerciseId: string;
  };
}

async function createRevision(
  env: Env,
  author: LoginResult,
  sourceText = `# Lesson

::::multiple-choice{#q1 points="2"}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::`,
): Promise<string> {
  const itemResponse = await appRequest(
    createTestApp(),
    "/content",
    jsonRequest({ title: "Lesson" }, author),
    env,
  );
  const item = (await itemResponse.json()) as ContentItemResponse;
  const revisionResponse = await appRequest(
    createTestApp(),
    `/content/${item.item.id}/revisions`,
    jsonRequest({ sourceText }, author),
    env,
  );
  const revision = (await revisionResponse.json()) as ContentRevisionResponse;

  expect(revisionResponse.status).toBe(201);

  return revision.revision.id;
}

async function createPublishedAssignment(
  env: Env,
  instructor: LoginResult,
  courseId: string,
  revisionId: string,
  fields: Record<string, unknown> = {},
): Promise<AssignmentResponse["assignment"]> {
  const draftResponse = await appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments`,
    jsonRequest(
      {
        contentRevisionId: revisionId,
        description: "Submission practice.",
        // Homework, as the title says, and as the new-assignment form's
        // preselected answer says: grades already visible. An assignment that
        // withholds them is an exam by default now — no feedback, every
        // submission kept — so a fixture that left this out would quietly make
        // every test in this file an exam. The ones that want that pass
        // `gradesVisibleAt: null`.
        gradesVisibleAt: "2026-01-01T00:00:00.000Z",
        title: "Homework",
        ...fields,
      },
      instructor,
    ),
    env,
  );
  const draft = (await draftResponse.json()) as AssignmentResponse;

  expect(draftResponse.status).toBe(201);

  const publishResponse = await appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments/${draft.assignment.id}/publish`,
    {
      headers: authHeaders(instructor),
      method: "POST",
    },
    env,
  );

  expect(publishResponse.status).toBe(200);

  return draft.assignment;
}

async function beginAttempt(
  env: Env,
  student: LoginResult,
  courseId: string,
  assignmentId: string,
): Promise<string> {
  const response = await appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments/${assignmentId}/attempts`,
    {
      headers: authHeaders(student),
      method: "POST",
    },
    env,
  );
  const body = (await response.json()) as BeginAttemptResponse;

  expect(response.status).toBe(201);

  return body.attempt.id;
}

function answer(selectedOptionIds: readonly string[]) {
  return {
    answer: {
      data: { selectedOptionIds },
      kind: "multiple-choice-answer@1",
      schemaVersion: 1,
    },
    exerciseId: "q1",
    score: 1000,
  };
}

function freeResponseAnswer(text: string) {
  return {
    answer: {
      data: { text },
      kind: "free-response-answer@1",
      schemaVersion: 1,
    },
    exerciseId: "essay_1",
  };
}

async function submitAnswer(
  env: Env,
  student: LoginResult,
  courseId: string,
  assignmentId: string,
  attemptId: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<Response> {
  const request = jsonRequest(body, student);

  request.headers = {
    ...(request.headers as Record<string, string>),
    ...(idempotencyKey === undefined
      ? {}
      : { "Idempotency-Key": idempotencyKey }),
  };

  return appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments/${assignmentId}` +
      `/attempts/${attemptId}/submissions`,
    request,
    env,
  );
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("multiple-choice submissions", () => {
  test("an active attempt renders only inline assignment content", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "inline-teacher@example.test");
      const student = await login(env, "inline-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const response = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}`,
        {
          headers: {
            Accept: "text/html",
            Cookie: student.cookieHeader,
          },
        },
        env,
      );
      const html = await response.text();
      const documentResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const documentHtml = await documentResponse.text();

      // The page hosts the content iframe and nothing instructor-facing;
      // the live exercise forms render inside the content document.
      expect(response.status).toBe(200);
      expect(html).toContain('class="content-frame"');
      expect(html).toContain('class="content-fullscreen"');
      expect(html).not.toContain("<h1>Homework</h1>");
      expect(html).not.toContain("<h2>Submissions</h2>");
      expect(html).not.toContain("<h2>Attempts</h2>");
      expect(html).not.toContain("Submission practice.");
      expect(html).not.toContain("Content revision");
      expect(html).not.toContain("Max attempts");
      expect(documentResponse.status).toBe(200);
      // The prompt renders once in the visible form; the hydration data island
      // also carries publicData.promptHtml, so count with the islands stripped.
      const visibleHtml = documentHtml.replaceAll(
        /<script type="application\/json" data-exercise-hydration>.*?<\/script>/gs,
        "",
      );
      expect(countOccurrences(visibleHtml, "Choose yes.")).toBe(1);
      expect(documentHtml).toContain("<h1>Lesson</h1>");
      expect(documentHtml).toContain(`/attempts/${attemptId}/submissions`);
      expect(documentHtml).toContain('name="exerciseId"');
      expect(documentHtml).toContain("data-carnap-exercise-runtime-state");
      expect(documentHtml).toContain("data-exercise-hydration");
      expect(documentHtml).toContain("data-exercise-status");
      expect(documentHtml).toContain("No submission in this attempt.");
      // The exercise element ships its chrome in a Declarative Shadow Root that
      // is inert (aria-busy) until the bundle upgrades it in place.
      expect(documentHtml).toContain('shadowrootmode="open"');
      expect(documentHtml).toContain('aria-busy="true"');
    });
  });

  /**
   * The correctness mark is the one place every exercise says whether the work
   * is right, and "every" is the whole claim: before it, each widget type drew
   * its own verdict in its own shadow root and the text types drew none. A
   * type that renders its action bar some other way would lose the
   * mark silently — the exercise would work, grade and record exactly as
   * before — so the count is asserted against the number of forms rather than
   * against a list of kinds someone has to remember to extend.
   */
  test("every exercise renders exactly one correctness mark, idle", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "mark-teacher@example.test");
      const student = await login(env, "mark-student@example.test");
      const courseId = await createCourse(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      // One of each family: an element that projects its own bar, a text type
      // that has no element at all, and a widget with a local Check.
      const revisionId = await createRevision(
        env,
        instructor,
        `::::multiple-choice{#mc}
Choose.

- [x] yes | Yes
- [ ] no | No
::::

::::short-answer{#sa answer="yes"}
Type yes.
::::

::::free-response{#fr rubric="Anything."}
Explain.
::::

::::truth-table{#tt}
Fill it in.

- P -> P
::::`,
      );
      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );

      await beginAttempt(env, student, courseId, assignment.id);

      const response = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const html = await response.text();

      // One box per exercise, and exactly one: the form around it is
      // `.exercise-submission`, so this counts the exercises themselves —
      // two custom elements and two sections — as it does on every other path.
      expect(countOccurrences(html, 'class="exercise"')).toBe(4);
      expect(countOccurrences(html, 'class="exercise-submission"')).toBe(4);
      expect(countOccurrences(html, 'class="exercise-mark"')).toBe(4);

      // Idle from the first paint, not conjured when there is finally something
      // to say: a reader who has never got one right still learns where the
      // verdict lives, and the row does not reflow when it arrives.
      expect(countOccurrences(html, 'data-state="idle"')).toBe(4);

      // All four accessible names ride on the element, because the widgets are
      // separate bundles and the runtime is a string — none of them can reach
      // the translator, and all of them write this mark.
      for (const attribute of [
        "data-label-error",
        "data-label-idle",
        "data-label-ok",
        "data-label-working",
      ]) {
        expect(countOccurrences(html, attribute)).toBe(4);
      }

      // A glyph this small needs words for a reader who can see it too: the
      // state's name is both the accessible name and the tooltip, from one
      // string, so hovering answers what a pale outline is claiming.
      expect(countOccurrences(html, 'aria-label="Not correct yet"')).toBe(4);
      expect(countOccurrences(html, 'title="Not correct yet"')).toBe(4);

      // In the action bar, and last on its row, which is what puts it hard right
      // for all four. Only the widget's own check status may follow it, and that
      // is not on the row: it takes the whole line under it.
      expect(html).toMatch(
        /class="exercise-mark"[^>]*><\/span><p aria-live="polite" class="exercise-status exercise-check-status" data-exercise-check-status><\/p><\/div>/,
      );
    });
  });

  test("a Fitch proof exercise renders as an interactive, hydrated form", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "fitch-teacher@example.test");
      const student = await login(env, "fitch-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `${FITCH_THEORY_BLOCK}

:::aufbau-proof-fitch{system="prop" id="mp"}
Derive b from the premises.

theorem mp (a b: wff): $ (a → b) , a ⊢ b $
----
a → b   :ax
a       :ax
b       :imp_elim 1 2
:::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      await beginAttempt(env, student, courseId, assignment.id);

      const documentResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const documentHtml = await documentResponse.text();

      expect(documentResponse.status).toBe(200);
      // The regression this guards: the Fitch type must dispatch to an
      // interactive submission form (element + hydration island), not fall
      // through to the inert text form (the "submissionFormNode gotcha").
      expect(documentHtml).toContain("<carnap-aufbau-proof-fitch ");
      expect(documentHtml).toContain("data-exercise-hydration");
      expect(documentHtml).toContain("aufbau-proof-fitch-answer@1");
      expect(documentHtml).toContain('name="exerciseId"');
    });
  });

  test("a Prawitz proof exercise renders as an interactive, hydrated form", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "prawitz-teacher@example.test");
      const student = await login(env, "prawitz-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `${FITCH_THEORY_BLOCK}

:::aufbau-proof-prawitz{system="prop" id="mp"}
Derive b from the premises.

theorem mp (a b: wff): $ (a → b) , a ⊢ b $
:::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      await beginAttempt(env, student, courseId, assignment.id);

      const documentResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const documentHtml = await documentResponse.text();

      expect(documentResponse.status).toBe(200);
      // The same submissionFormNode gotcha, guarded for the Prawitz kind.
      expect(documentHtml).toContain("<carnap-aufbau-proof-prawitz ");
      expect(documentHtml).toContain("data-exercise-hydration");
      expect(documentHtml).toContain("aufbau-proof-prawitz-answer@1");
      expect(documentHtml).toContain('name="exerciseId"');
    });
  });

  test("student pages bootstrap latest exercise submission state", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "state-teacher@example.test");
      const student = await login(env, "state-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const submitResponse = await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId,
        answer(["yes"]),
      );
      const submission = (await submitResponse.json()) as SubmissionResponse;
      // The runtime-state bootstrap now lives in the content document the
      // page's iframe loads.
      const pageResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const html = await pageResponse.text();
      const stateJson = html.match(
        /<script type="application\/json" data-carnap-exercise-runtime-state>(.*?)<\/script>/s,
      )?.[1];

      expect(pageResponse.status).toBe(200);
      expect(stateJson).toBeDefined();
      // Exactly what the runtime reads: the verdict and numbers, and when the
      // work went in. Not the answer, its kind or its review — those are the
      // submissions endpoint's, and the answer is in the hydration payload.
      expect(JSON.parse(stateJson ?? "{}")).toEqual({
        exercises: {
          q1: {
            evaluation: {
              maxScore: 2,
              score: 2,
              verdict: "correct",
            },
            submission: {
              exerciseId: "q1",
              submittedAt: submission.submission.submittedAt,
            },
          },
        },
        version: 1,
      });
      // The first paint is in UTC with the zone named, since the server has no
      // reader's clock; the runtime rewrites it in theirs on load.
      expect(html).toContain(
        `Submitted at ${utcTimestampText(submission.submission.submittedAt, "en")} · 2/2.`,
      );
      expect(html).toContain("UTC · 2/2.");

      // The exercise embeds a hydration payload the client element reads on
      // connect: publicData to render from, plus the student's own prior answer
      // so the widget can restore its selection.
      const hydrationJson = html.match(
        /<script type="application\/json" data-exercise-hydration>(.*?)<\/script>/s,
      )?.[1];

      expect(hydrationJson).toBeDefined();
      expect(JSON.parse(hydrationJson ?? "{}")).toMatchObject({
        mode: "answer",
        priorAnswer: { selectedOptionIds: ["yes"] },
        publicData: { mode: "single" },
        version: 1,
      });
    });
  });

  test("a student can submit and receive an automatic evaluation", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "submit-teacher@example.test");
      const student = await login(env, "submit-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const response = await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId,
        answer(["yes"]),
      );
      const body = (await response.json()) as SubmissionResponse;

      expect(response.status).toBe(201);
      expect(body.submission.contentRevisionId).toBe(revisionId);
      expect(body.submission.exerciseId).toBe("q1");
      expect(body.submission.answerKind).toBe("multiple-choice-answer@1");
      expect(body.submission.answer).toEqual({ selectedOptionIds: ["yes"] });
      expect(body.submission.declarationHash).toEqual(expect.any(String));
      expect(body.evaluation.score).toBe(2);
      expect(body.evaluation.maxScore).toBe(2);
      expect(body.evaluation.result.status).toBe("correct");
      expect(body.evaluation.result.contentRevisionId).toBe(revisionId);
      expect(body.evaluation.result.exerciseId).toBe("q1");
      expect(body.evaluation.checkerVersion).toBe(
        "multiple-choice-evaluator@1",
      );

      const instructorResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignment.id}` +
          "/submissions",
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const instructorBody =
        (await instructorResponse.json()) as InstructorSubmissionsResponse;

      expect(instructorResponse.status).toBe(200);
      expect(instructorBody.submissions).toHaveLength(1);
      expect(instructorBody.submissions[0]?.submission.id).toBe(
        body.submission.id,
      );
      expect(instructorBody.submissions[0]?.answerReview?.summary).toBe(
        "Yes",
      );

      // ?review=all: a correct autograded answer is off the needs-review queue.
      const instructorHtml = await (
        await appRequest(
          createTestApp(),
          `/courses/${courseId}/instructor/assignments/${assignment.id}` +
            "/submissions?review=all",
          {
            headers: { Accept: "text/html", Cookie: instructor.cookieHeader },
          },
          env,
        )
      ).text();

      // Instructor review renders the rich, shadow-isolated review widget, with
      // the student's correct choice marked correct.
      expect(instructorHtml).toContain('shadowrootmode="open"');
      expect(instructorHtml).toContain("mc-review-option");
      expect(instructorHtml).toContain("data-selected data-correct");
    });
  });

  test("the answer endpoint rejects form-encoded submissions", async () => {
    // Carnap requires JavaScript for exercises: the runtime always intercepts
    // the form and posts JSON, so the endpoint no longer accepts a no-JS
    // form-encoded body (design/component-system-v2.md D1/D2).
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "formpost-teacher@example.test");
      const student = await login(env, "formpost-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const response = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}` +
          `/attempts/${attemptId}/submissions`,
        {
          body: new URLSearchParams({
            answerKind: "multiple-choice-answer@1",
            exerciseId: "q1",
            schemaVersion: "1",
            selectedOptionIds: "yes",
          }).toString(),
          headers: {
            ...authHeaders(student),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        env,
      );

      expect(response.status).toBe(400);
    });
  });

  test("free-response rubrics appear only in instructor review", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "rubric-teacher@example.test");
      const student = await login(env, "rubric-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Lesson

::::free-response{#essay_1 points="5" rubric="Mention the rule used."}
Explain the proof.
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const studentPage = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const studentHtml = await studentPage.text();
      const response = await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId,
        freeResponseAnswer("It uses modus ponens."),
      );
      const body = (await response.json()) as FreeResponseSubmissionResponse;
      const instructorResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignment.id}` +
          "/submissions",
        { headers: { Accept: "text/html", Cookie: instructor.cookieHeader } },
        env,
      );
      const instructorHtml = await instructorResponse.text();
      const instructorJsonResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignment.id}` +
          "/submissions",
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const instructorJson =
        (await instructorJsonResponse.json()) as InstructorSubmissionsResponse;
      const studentHistoryResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}` +
          `/attempts/${attemptId}/submissions`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const studentHistory =
        (await studentHistoryResponse.json()) as SubmissionHistoryResponse;

      expect(studentPage.status).toBe(200);
      expect(studentHtml).toContain("Explain the proof.");
      expect(studentHtml).not.toContain("Mention the rule used.");
      expect(response.status).toBe(201);
      expect(body.evaluation).toBeNull();
      expect(body.submission.answer).toEqual({
        text: "It uses modus ponens.",
      });
      expect(body.submission.answerKind).toBe("free-response-answer@1");
      expect(instructorResponse.status).toBe(200);
      expect(instructorHtml).toContain("It uses modus ponens.");
      expect(instructorHtml).toContain("Rubric");
      expect(instructorHtml).toContain("Mention the rule used.");
      expect(instructorJson.submissions[0]?.answerReview).toMatchObject({
        rubricHtml: "Mention the rule used.",
        summary: "It uses modus ponens.",
      });
      expect(studentHistoryResponse.status).toBe(200);
      expect(studentHistory.submissions[0]?.answerReview).toEqual({
        details: [{ label: "Response", value: "It uses modus ponens." }],
        summary: "It uses modus ponens.",
      });
    });
  });

  test("idempotency keys prevent duplicate submissions", async () => {
    await withStorage(async ({ db }, env) => {
      const instructor = await login(env, "idem-teacher@example.test");
      const student = await login(env, "idem-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const firstResponse = await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId,
        answer(["yes"]),
        "idem-1",
      );
      const secondResponse = await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId,
        answer(["no"]),
        "idem-1",
      );
      const first = (await firstResponse.json()) as SubmissionResponse;
      const second = (await secondResponse.json()) as SubmissionResponse;
      const count = await db
        .prepare("SELECT COUNT(1) AS count FROM submissions")
        .first<{ count: number }>();

      expect(firstResponse.status).toBe(201);
      expect(secondResponse.status).toBe(200);
      expect(second.idempotent).toBe(true);
      expect(second.submission.id).toBe(first.submission.id);
      expect(second.submission.answer).toEqual({
        selectedOptionIds: ["yes"],
      });
      expect(count?.count).toBe(1);
    });
  });

  test("incorrect answers are checked but not recorded outside exam exercises", async () => {
    await withStorage(async ({ db }, env) => {
      const instructor = await login(env, "guard-teacher@example.test");
      const student = await login(env, "guard-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const wrongResponse = await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId,
        answer(["no"]),
      );
      const wrong = (await wrongResponse.json()) as {
        readonly check: {
          readonly maxScore: number;
          readonly score: number;
          readonly status: string;
        };
        readonly recorded: boolean;
      };

      expect(wrongResponse.status).toBe(200);
      expect(wrong.recorded).toBe(false);
      expect(wrong.check).toEqual({
        maxScore: 2,
        score: 0,
        status: "incorrect",
      });

      const afterWrong = await db
        .prepare("SELECT COUNT(1) AS count FROM submissions")
        .first<{ count: number }>();

      expect(afterWrong?.count).toBe(0);

      const rightResponse = await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId,
        answer(["yes"]),
      );
      const right = (await rightResponse.json()) as SubmissionResponse & {
        readonly recorded: boolean;
      };

      expect(rightResponse.status).toBe(201);
      expect(right.recorded).toBe(true);
      expect(right.evaluation.score).toBe(2);

      const afterRight = await db
        .prepare("SELECT COUNT(1) AS count FROM submissions")
        .first<{ count: number }>();

      expect(afterRight?.count).toBe(1);
    });
  });

  test("exam exercises record incorrect answers and seal the verdict until release", async () => {
    await withStorage(async ({ db }, env) => {
      const instructor = await login(env, "exam-teacher@example.test");
      const student = await login(env, "exam-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Lesson

::::multiple-choice{#q1 points="2" exam}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        // Grades withheld, which is what makes there be a release to seal
        // until. The `exam` on the exercise is the explicit form of what this
        // assignment would default to anyway.
        { gradesVisibleAt: null },
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const wrongResponse = await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId,
        answer(["no"]),
      );
      const wrong = (await wrongResponse.json()) as {
        readonly evaluation: SubmissionResponse["evaluation"] | null;
        readonly recorded: boolean;
      };

      // The incorrect answer records, but with grades withheld the student
      // only learns that it was accepted, not how it scored.
      expect(wrongResponse.status).toBe(201);
      expect(wrong.recorded).toBe(true);
      expect(wrong.evaluation).toBeNull();

      const submissionCount = await db
        .prepare("SELECT COUNT(1) AS count FROM submissions")
        .first<{ count: number }>();
      const evaluationCount = await db
        .prepare("SELECT COUNT(1) AS count FROM evaluations")
        .first<{ count: number }>();

      expect(submissionCount?.count).toBe(1);
      expect(evaluationCount?.count).toBe(1);

      const historyPath =
        `/courses/${courseId}/assignments/${assignment.id}` +
        `/attempts/${attemptId}/submissions`;
      const sealedHistory = (await (
        await appRequest(
          createTestApp(),
          historyPath,
          { headers: authHeaders(student) },
          env,
        )
      ).json()) as SubmissionHistoryResponse;

      expect(sealedHistory.submissions).toHaveLength(1);
      expect(sealedHistory.submissions[0]?.evaluation).toBeNull();

      // The instructor sees the evaluation regardless of release.
      const instructorList = (await (
        await appRequest(
          createTestApp(),
          `/courses/${courseId}/instructor/assignments/${assignment.id}/submissions`,
          { headers: authHeaders(instructor) },
          env,
        )
      ).json()) as InstructorSubmissionsResponse;

      expect(instructorList.submissions[0]?.evaluation?.score).toBe(0);
      expect(instructorList.submissions[0]?.evaluation?.maxScore).toBe(2);

      const releaseResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignment.id}/grade-visibility`,
        jsonRequest({ release: true }, instructor),
        env,
      );

      expect(releaseResponse.status).toBe(200);

      const releasedHistory = (await (
        await appRequest(
          createTestApp(),
          historyPath,
          { headers: authHeaders(student) },
          env,
        )
      ).json()) as SubmissionHistoryResponse;

      expect(releasedHistory.submissions[0]?.evaluation?.score).toBe(0);
    });
  });

  test("full feedback still waits on the release date for the numbers", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "numbers-teacher@example.test");
      const student = await login(env, "numbers-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Lesson

::::multiple-choice{#q1 points="2" exam feedback="full"}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { gradesVisibleAt: null },
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const submitted = (await (
        await submitAnswer(
          env,
          student,
          courseId,
          assignment.id,
          attemptId,
          answer(["no"]),
        )
      ).json()) as {
        readonly evaluation: {
          readonly maxScore: number | null;
          readonly result: unknown;
          readonly score: number | null;
          readonly verdict: string;
        } | null;
      };

      // The author asked for full feedback and gets it: the student is told the
      // answer is wrong. The 0 of 2 is a grade, and grades wait for the release
      // date no matter how loudly the exercise is willing to talk.
      expect(submitted.evaluation).toMatchObject({
        maxScore: null,
        score: null,
        verdict: "incorrect",
      });
      // The raw checker payload carries the awarded score inside it, so it goes
      // with them — otherwise the nulls close the front door and it walks in
      // the side one.
      expect(submitted.evaluation?.result).toBeNull();

      const historyPath =
        `/courses/${courseId}/assignments/${assignment.id}` +
        `/attempts/${attemptId}/submissions`;
      const read = async (): Promise<SubmissionHistoryResponse> =>
        (await (
          await appRequest(
            createTestApp(),
            historyPath,
            { headers: authHeaders(student) },
            env,
          )
        ).json()) as SubmissionHistoryResponse;

      expect((await read()).submissions[0]?.evaluation).toMatchObject({
        score: null,
        verdict: "incorrect",
      });

      const releaseResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignment.id}/grade-visibility`,
        jsonRequest({ release: true }, instructor),
        env,
      );

      expect(releaseResponse.status).toBe(200);
      expect((await read()).submissions[0]?.evaluation).toMatchObject({
        maxScore: 2,
        score: 0,
        verdict: "incorrect",
      });
    });
  });

  test("a refused answer says only that it was refused", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "refused-teacher@example.test");
      const student = await login(env, "refused-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Lesson

::::multiple-choice{#q1 points="2" exam="false"}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::

::::multiple-choice{#q2 points="2" exam="false" feedback="terse"}
Choose yes again.

- [x] yes | Yes
- [ ] no | No
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { gradesVisibleAt: null },
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const refuse = async (
        exerciseId: string,
      ): Promise<Record<string, unknown>> =>
        (await (
          await submitAnswer(
            env,
            student,
            courseId,
            assignment.id,
            attemptId,
            {
              ...answer(["no"]),
              exerciseId,
            },
          )
        ).json()) as Record<string, unknown>;

      // Silence plus a refusal: the refusal is the whole message, so there is
      // no check payload to read a verdict out of.
      const silent = await refuse("q1");

      expect(silent.recorded).toBe(false);
      expect(silent).not.toHaveProperty("check");

      // Terse says right or wrong, and that is all it says — no number, since
      // grades are still withheld.
      expect(await refuse("q2")).toMatchObject({
        check: { maxScore: null, score: null, status: "incorrect" },
        recorded: false,
      });
    });
  });

  test('exam="false" keeps refusing wrong work where silence would keep it', async () => {
    await withStorage(async ({ db }, env) => {
      const instructor = await login(env, "retry-teacher@example.test");
      const student = await login(env, "retry-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Lesson

::::multiple-choice{#q1 points="2" exam="false" feedback="none"}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::

::::multiple-choice{#q2 points="2"}
Choose yes again.

- [x] yes | Yes
- [ ] no | No
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { gradesVisibleAt: null },
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const submit = async (
        exerciseId: string,
        selected: readonly string[],
      ): Promise<{ readonly recorded: boolean }> =>
        (await (
          await submitAnswer(
            env,
            student,
            courseId,
            assignment.id,
            attemptId,
            {
              ...answer(selected),
              exerciseId,
            },
          )
        ).json()) as { readonly recorded: boolean };

      // Both exercises are on an assignment holding its grades back, so both
      // are sealed. The one that said `exam="false"` still throws the wrong
      // answer away; the one that said nothing takes the assignment's word for
      // it and keeps it.
      expect(await submit("q1", ["no"])).toMatchObject({ recorded: false });
      expect(await submit("q2", ["no"])).toMatchObject({ recorded: true });

      const afterWrong = await db
        .prepare("SELECT exercise_id FROM submissions")
        .all<{ exercise_id: string }>();

      expect(afterWrong.results.map((row) => row.exercise_id)).toEqual([
        "q2",
      ]);

      // And the right answer lands, which is the only way the student ever
      // learns they were done.
      expect(await submit("q1", ["yes"])).toMatchObject({ recorded: true });
    });
  });

  test("the resolved feedback and exam reach the widget's hydration payload", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "hydrate-teacher@example.test");
      const student = await login(env, "hydrate-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Lesson

::::multiple-choice{#q1 points="2" feedback="none"}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::

::::multiple-choice{#q2 points="2" exam}
Choose yes again.

- [x] yes | Yes
- [ ] no | No
::::

::::multiple-choice{#q3 points="2"}
And again.

- [x] yes | Yes
- [ ] no | No
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const optionsOn = async (
        assignmentId: string,
      ): Promise<{ exam?: boolean; feedback?: string }[]> => {
        const documentHtml = await (
          await appRequest(
            createTestApp(),
            `/courses/${courseId}/assignments/${assignmentId}/content`,
            { headers: { Cookie: student.cookieHeader } },
            env,
          )
        ).text();

        return [
          ...documentHtml.matchAll(
            /<script type="application\/json" data-exercise-hydration>(.*?)<\/script>/gs,
          ),
        ].map(
          (match) =>
            (
              JSON.parse(match[1] as string) as {
                readonly options: {
                  readonly exam?: boolean;
                  readonly feedback?: string;
                };
              }
            ).options,
        );
      };

      const withheld = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { gradesVisibleAt: null },
      );

      await beginAttempt(env, student, courseId, withheld.id);

      // With grades withheld the assignment is an exam, so silence is the
      // default and all three widgets get it — the one that asked for it, the
      // one that said only `exam`, and the one that said nothing at all. And
      // all three are told it is an exam, for the same reason.
      expect(await optionsOn(withheld.id)).toEqual([
        { exam: true, feedback: "none" },
        { exam: true, feedback: "none" },
        { exam: true, feedback: "none" },
      ]);

      const released = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );

      await beginAttempt(env, student, courseId, released.id);

      // Released, it is homework. What the author wrote still stands; what they
      // left unsaid resolves to `full`, which the payload omits because that is
      // what a widget assumes anyway. `exam` no longer has a say in this
      // question — it decides what is kept, not what is said — and only the
      // exercise that wrote it is still one; the payload omits the default
      // there too.
      expect(await optionsOn(released.id)).toEqual([
        { feedback: "none" },
        { exam: true },
        {},
      ]);
    });
  });

  test('feedback="none" withholds the marked-up grid, not just the score', async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "seal-teacher@example.test");
      const student = await login(env, "seal-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Lesson

::::truth-table{#t1 points="2" feedback="none"}
Fill it in.

- P -> P
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { gradesVisibleAt: null },
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );

      // Wrong in the second row. A truth table is graded from formulas the
      // student can see, so its review recomputes the verdict rather than
      // reading one off the evaluation — which is how a sealed score still left
      // a fully marked-up grid on the page.
      //
      // The assignment withholds its grades, so there is a release at the end
      // for the author's seal to survive.
      const response = await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId,
        {
          answer: {
            data: {
              cells: [
                [
                  ["T", "T", "T"],
                  ["F", "F", "F"],
                ],
              ],
              reference: [["T"], ["F"]],
            },
            kind: "truth-table-answer@1",
            schemaVersion: 1,
          },
          exerciseId: "t1",
        },
      );

      // `feedback="none"` records like `exam`: withholding the verdict while
      // discarding the work would leave the student unable to submit at all.
      expect(response.status).toBe(201);
      expect(
        ((await response.json()) as { readonly evaluation: unknown })
          .evaluation,
      ).toBeNull();

      const historyPath =
        `/courses/${courseId}/assignments/${assignment.id}` +
        `/attempts/${attemptId}/submissions`;
      const read = async (
        login: LoginResult,
        path = historyPath,
      ): Promise<SubmissionHistoryResponse> =>
        (await (
          await appRequest(
            createTestApp(),
            path,
            { headers: authHeaders(login) },
            env,
          )
        ).json()) as SubmissionHistoryResponse;

      const sealed = await read(student);
      const sealedReview = sealed.submissions[0]?.answerReview;

      expect(sealedReview?.summary).toBe("Truth table");
      expect(sealedReview?.details).toBeUndefined();
      // The class names appear in the shadow stylesheet regardless; what must
      // be gone is a cell wearing one.
      expect(sealedReview?.elementHtml).not.toContain(
        '<span class="tt-incorrect"',
      );
      expect(sealedReview?.elementHtml).not.toContain(
        '<span class="tt-correct"',
      );
      // Still their own work, all of it — only the marking is gone.
      expect(sealedReview?.elementHtml).toContain('<span data-tt-value="F">');

      // The instructor is never the one being sealed off.
      const staff = await read(
        instructor,
        `/courses/${courseId}/instructor/assignments/${assignment.id}/submissions`,
      );

      expect(staff.submissions[0]?.answerReview?.elementHtml).toContain(
        '<span class="tt-incorrect"',
      );

      const releaseResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignment.id}/grade-visibility`,
        jsonRequest({ release: true }, instructor),
        env,
      );

      expect(releaseResponse.status).toBe(200);

      const released = await read(student);

      // And it stays sealed. Release used to override the author outright,
      // which handed out the answer key to an exercise whose author had said
      // not to — the term ends, the grades go out, and the question cannot be
      // set again. Release now settles only what an author left unsaid.
      expect(released.submissions[0]?.answerReview?.summary).toBe(
        "Truth table",
      );
      expect(
        released.submissions[0]?.answerReview?.elementHtml,
      ).not.toContain('<span class="tt-incorrect"');
    });
  });

  test("submissionNeedsReview flags only unreviewed, less-than-full work", () => {
    const base = {
      checkerVersion: null,
      createdAt: "2026-07-13T00:00:00.000Z",
      id: "eval-1",
      result: null,
      submissionId: "sub-1",
      voidedAt: null,
    } as const;

    // Nothing graded yet (a free response) still wants a look.
    expect(submissionNeedsReview(null)).toBe(true);
    // A partial or zero autograde wants a look.
    expect(
      submissionNeedsReview({
        ...base,
        evaluatorKind: "automatic",
        maxScore: 2,
        score: 0,
      }),
    ).toBe(true);
    // Full autograded marks are trusted and drop off the queue.
    expect(
      submissionNeedsReview({
        ...base,
        evaluatorKind: "automatic",
        maxScore: 2,
        score: 2,
      }),
    ).toBe(false);
    // A manual evaluation means an instructor already signed off.
    expect(
      submissionNeedsReview({
        ...base,
        evaluatorKind: "manual",
        maxScore: 2,
        score: 0,
      }),
    ).toBe(false);
  });

  test("approving an autograded score clears it from the review queue", async () => {
    await withStorage(async ({ db }, env) => {
      const instructor = await login(env, "approve-teacher@example.test");
      const student = await login(env, "approve-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Lesson

::::multiple-choice{#q1 points="2" exam}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );

      await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId,
        answer(["no"]),
      );

      const listPath = `/courses/${courseId}/instructor/assignments/${assignment.id}/submissions`;
      const before = (await (
        await appRequest(
          createTestApp(),
          listPath,
          { headers: { Cookie: instructor.cookieHeader } },
          env,
        )
      ).json()) as InstructorReviewSubmissionsResponse;

      // The wrong-but-recorded exam answer is autograded 0/2 and waiting.
      expect(before.submissions).toHaveLength(1);
      expect(before.submissions[0]?.needsReview).toBe(true);
      expect(before.submissions[0]?.evaluation?.evaluatorKind).toBe(
        "automatic",
      );
      const submissionId = before.submissions[0]?.submission.id ?? "";

      const approveResponse = await appRequest(
        createTestApp(),
        `${listPath}/${submissionId}/approve`,
        jsonRequest({}, instructor),
        env,
      );

      expect(approveResponse.status).toBe(201);

      const after = (await (
        await appRequest(
          createTestApp(),
          listPath,
          { headers: { Cookie: instructor.cookieHeader } },
          env,
        )
      ).json()) as InstructorReviewSubmissionsResponse;

      // Approval records a manual evaluation copying the autograded score, so
      // the submission now reads as reviewed and leaves the queue.
      expect(after.submissions[0]?.needsReview).toBe(false);
      expect(after.submissions[0]?.evaluation?.evaluatorKind).toBe("manual");
      expect(after.submissions[0]?.evaluation?.score).toBe(0);
      expect(after.submissions[0]?.evaluation?.maxScore).toBe(2);

      const evaluationCount = await db
        .prepare("SELECT COUNT(1) AS count FROM evaluations")
        .first<{ count: number }>();

      expect(evaluationCount?.count).toBe(2);

      // Approving again is a no-op: the existing sign-off stands, unduplicated.
      const reapprove = await appRequest(
        createTestApp(),
        `${listPath}/${submissionId}/approve`,
        jsonRequest({}, instructor),
        env,
      );

      expect(reapprove.status).toBe(201);

      const evaluationCountAfter = await db
        .prepare("SELECT COUNT(1) AS count FROM evaluations")
        .first<{ count: number }>();

      expect(evaluationCountAfter?.count).toBe(2);
    });
  });

  test("a free response has no autograded score to approve", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(
        env,
        "approve-free-teacher@example.test",
      );
      const student = await login(env, "approve-free-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Lesson

::::free-response{#essay_1 points="5"}
Explain the proof.
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );

      await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId,
        freeResponseAnswer("It uses modus ponens."),
      );

      const listPath = `/courses/${courseId}/instructor/assignments/${assignment.id}/submissions`;
      const list = (await (
        await appRequest(
          createTestApp(),
          listPath,
          { headers: { Cookie: instructor.cookieHeader } },
          env,
        )
      ).json()) as InstructorReviewSubmissionsResponse;

      expect(list.submissions[0]?.needsReview).toBe(true);
      const submissionId = list.submissions[0]?.submission.id ?? "";

      const approveResponse = await appRequest(
        createTestApp(),
        `${listPath}/${submissionId}/approve`,
        jsonRequest({}, instructor),
        env,
      );

      expect(approveResponse.status).toBe(400);
    });
  });

  test("hand grading is out of the exercise's points, and may exceed them", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "hand-teacher@example.test");
      const student = await login(env, "hand-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Lesson

::::free-response{#essay_1 points="5"}
Explain the proof.
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );

      await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId,
        freeResponseAnswer("It uses modus ponens."),
      );

      const listPath = `/courses/${courseId}/instructor/assignments/${assignment.id}/submissions`;
      const list = (await (
        await appRequest(
          createTestApp(),
          listPath,
          { headers: { Cookie: instructor.cookieHeader } },
          env,
        )
      ).json()) as InstructorReviewSubmissionsResponse;
      const submissionId = list.submissions[0]?.submission.id ?? "";
      const page = await (
        await appRequest(
          createTestApp(),
          listPath,
          {
            headers: { Accept: "text/html", Cookie: instructor.cookieHeader },
          },
          env,
        )
      ).text();

      // The exercise says what the score is out of, and says it in the label —
      // there is no field for it, because editing it would change the wording
      // here and nothing the gradebook does. This is a free response, so the
      // figure can only have come from the declaration.
      expect(page).toContain("Score out of 5");
      expect(page).not.toContain('name="maxScore"');

      const settingMax = await appRequest(
        createTestApp(),
        `${listPath}/${submissionId}/evaluations`,
        jsonRequest({ maxScore: 8, score: 4 }, instructor),
        env,
      );

      // Accepting a maximum and then grading out of the exercise's own would be
      // the worse of the two answers, so it is refused rather than ignored.
      expect(settingMax.status).toBe(400);

      const graded = await appRequest(
        createTestApp(),
        `${listPath}/${submissionId}/evaluations`,
        jsonRequest({ feedback: "Clear.", score: 4 }, instructor),
        env,
      );

      expect(graded.status).toBe(201);

      const afterGrading = (await (
        await appRequest(
          createTestApp(),
          listPath,
          { headers: { Cookie: instructor.cookieHeader } },
          env,
        )
      ).json()) as InstructorReviewSubmissionsResponse;

      // Out of the five the author declared, with nothing said about it.
      expect(afterGrading.submissions[0]?.evaluation?.score).toBe(4);
      expect(afterGrading.submissions[0]?.evaluation?.maxScore).toBe(5);

      const bonus = await appRequest(
        createTestApp(),
        `${listPath}/${submissionId}/evaluations`,
        jsonRequest({ score: 7 }, instructor),
        env,
      );

      // Bonus marks: seven out of five is recorded as it was given. The score
      // is the numerator and the manifest is the denominator, so the extra two
      // offset a low score elsewhere instead of costing one.
      expect(bonus.status).toBe(201);

      const afterBonus = (await (
        await appRequest(
          createTestApp(),
          listPath,
          { headers: { Cookie: instructor.cookieHeader } },
          env,
        )
      ).json()) as InstructorReviewSubmissionsResponse;

      expect(afterBonus.submissions[0]?.evaluation?.score).toBe(7);
      expect(afterBonus.submissions[0]?.evaluation?.maxScore).toBe(5);
    });
  });

  test("the review page filters to submissions needing review", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "filter-teacher@example.test");
      const student = await login(env, "filter-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Lesson

::::multiple-choice{#q1 points="2" exam}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );

      await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId,
        answer(["no"]),
      );

      const listPath = `/courses/${courseId}/instructor/assignments/${assignment.id}/submissions`;
      const defaultView = await (
        await appRequest(
          createTestApp(),
          listPath,
          {
            headers: { Accept: "text/html", Cookie: instructor.cookieHeader },
          },
          env,
        )
      ).text();

      // The default view leads with the needs-review filter and offers the
      // one-click approval on the waiting submission.
      expect(defaultView).toContain("Needs review (");
      expect(defaultView).toContain('class="review-count-needs">1</span>');
      expect(defaultView).toContain("All (1)");
      expect(defaultView).toContain('class="approve-score"');
      // The review actions are enhanced to submit without a full reload; the
      // hooks the script reconciles against ride along with the page, and the
      // script itself is linked.
      expect(defaultView).toContain(
        'class="segmented review-filter" data-filter=',
      );
      expect(defaultView).toContain(REVIEW_SCRIPT_ASSET.href);
      expect(REVIEW_SCRIPT).toContain("form.approve-score-form");
      expect(REVIEW_SCRIPT).toContain("form.manual-evaluation-form");
      // The review state travels as a value, not as the displayed word: the
      // server's reply to a grade names each try's state as a value, the script
      // filters and counts on it and writes it back to this attribute, so
      // translating the label must not change what it sees. A page that
      // carried only the prose would silently miscount in every language but
      // English.
      expect(defaultView).toContain(
        'class="review-state-label" data-review-state="needs-review"',
      );
      expect(defaultView).toContain("data-carnap-review-strings");
      expect(REVIEW_SCRIPT).toContain(
        "label.dataset.reviewState = entry.state",
      );
      expect(REVIEW_SCRIPT).toContain("entry.state === NEEDS_REVIEW");
      expect(REVIEW_SCRIPT).not.toContain('=== "Needs review"');
      // The score line names who graded in words, and the script fills the
      // server's own message rather than pasting the raw enum value in.
      expect(defaultView).toContain('"evaluators":{"automatic":');
      expect(REVIEW_SCRIPT).toContain("S.scored ||");
      expect(REVIEW_SCRIPT).not.toContain('" · " +');
    });
  });

  test("invalid answers and mismatched attempts are rejected", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "reject-teacher@example.test");
      const student = await login(env, "reject-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const firstAssignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const secondAssignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { title: "Other homework" },
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        firstAssignment.id,
      );
      const invalidOptionResponse = await submitAnswer(
        env,
        student,
        courseId,
        firstAssignment.id,
        attemptId,
        answer(["bogus"]),
      );
      const wrongKindResponse = await submitAnswer(
        env,
        student,
        courseId,
        firstAssignment.id,
        attemptId,
        {
          answer: {
            data: { selectedOptionIds: ["yes"] },
            kind: "proof-answer@1",
            schemaVersion: 1,
          },
          exerciseId: "q1",
        },
      );
      const wrongAssignmentResponse = await submitAnswer(
        env,
        student,
        courseId,
        secondAssignment.id,
        attemptId,
        answer(["yes"]),
      );

      expect(invalidOptionResponse.status).toBe(400);
      expect(wrongKindResponse.status).toBe(400);
      expect(wrongAssignmentResponse.status).toBe(404);
    });
  });

  test("closed assignments and expired attempts reject submissions", async () => {
    await withStorage(async ({ db }, env) => {
      const instructor = await login(env, "closed-teacher@example.test");
      const student = await login(env, "closed-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const timed = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { timeLimitMinutes: 5 },
      );
      const attemptId = await beginAttempt(env, student, courseId, timed.id);

      await db
        .prepare("UPDATE attempts SET expires_at = ? WHERE id = ?")
        .bind("2000-01-01T00:00:00.000Z", attemptId)
        .run();

      const expiredResponse = await submitAnswer(
        env,
        student,
        courseId,
        timed.id,
        attemptId,
        answer(["yes"]),
      );
      const closed = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { availableUntil: "2000-01-01T00:00:00.000Z" },
      );

      await db
        .prepare("UPDATE assignments SET available_until = ? WHERE id = ?")
        .bind("2999-01-01T00:00:00.000Z", closed.id)
        .run();

      const closedAttemptId = await beginAttempt(
        env,
        student,
        courseId,
        closed.id,
      );

      await db
        .prepare("UPDATE assignments SET available_until = ? WHERE id = ?")
        .bind("2000-01-01T00:00:00.000Z", closed.id)
        .run();

      const closedResponse = await submitAnswer(
        env,
        student,
        courseId,
        closed.id,
        closedAttemptId,
        answer(["yes"]),
      );

      expect(expiredResponse.status).toBe(403);
      expect(closedResponse.status).toBe(403);
    });
  });
});

describe("practice and reading assignments", () => {
  function attemptIdFrom(html: string): string | undefined {
    return html.match(/\/attempts\/([^/]+)\/submissions/)?.[1];
  }

  test("practice exercises are interactive, recorded, and stay uncounted", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "prac-teacher@example.test");
      const student = await login(env, "prac-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { assessmentMode: "practice", title: "Practice set" },
      );

      // Viewing the content document auto-opens the single practice attempt
      // and renders the exercise as an interactive form — not the inert,
      // disabled preview. The page itself just hosts the iframe.
      const page = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}`,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );
      const document = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const html = await document.text();
      const attemptId = attemptIdFrom(html);

      expect(page.status).toBe(200);
      expect((await page.text()).includes('class="content-frame"')).toBe(
        true,
      );
      expect(document.status).toBe(200);
      expect(attemptId).toBeDefined();
      expect(html).toContain('name="exerciseId"');
      expect(html).toContain("Choose yes.");
      expect(html).not.toContain("input disabled");

      // The answer is accepted (no graded-only 403) and auto-scored.
      const submitResponse = await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId ?? "",
        answer(["yes"]),
      );
      const submission = (await submitResponse.json()) as SubmissionResponse;

      expect(submitResponse.status).toBe(201);
      expect(submission.evaluation.score).toBe(2);
      expect(submission.evaluation.result.status).toBe("correct");

      // Results are visible immediately — practice has no grade-release gate.
      const results = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}/results`,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );
      const resultsHtml = await results.text();

      expect(results.status).toBe(200);
      expect(resultsHtml).toContain("Attempt 1");
      expect(resultsHtml).toContain("2/2");
      expect(resultsHtml).not.toContain("have not been released");

      // The course page surfaces the recorded score, muted, and keeps it out of
      // the counted course total (which stays absent with no graded work).
      const coursePage = await appRequest(
        createTestApp(),
        `/courses/${courseId}`,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );
      const courseHtml = await coursePage.text();

      expect(coursePage.status).toBe(200);
      expect(courseHtml).toContain("score-uncounted");
      expect(courseHtml).not.toContain("Course total");
    });
  });

  // "No assessment" is the whole meaning of the mode: a reading creates no
  // attempts, records no submissions, and so has no results. Its exercises are
  // still there and still work — a reader can try one and check it locally,
  // exactly as an author does in a preview — but there is nowhere to submit to.
  test("reading exercises are interactive and record nothing", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "read-teacher@example.test");
      const student = await login(env, "read-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { assessmentMode: "none", title: "Chapter 4" },
      );
      const page = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const html = await page.text();

      expect(page.status).toBe(200);
      // The exercise is on the page, with the bar every reader gets — and its
      // submit is dead, saying so.
      expect(html).toContain("Choose yes.");
      expect(html).toContain(
        'class="exercise-submit" type="submit" disabled',
      );
      expect(html).toContain('title="Answers are not recorded here."');
      // No form to submit through, because no attempt was opened for it.
      expect(attemptIdFrom(html)).toBeUndefined();

      const attempts = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}/attempts`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );

      expect(attempts.status).toBe(200);
      expect((await attempts.json()) as unknown).toEqual({ attempts: [] });

      const results = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}/results`,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );

      expect(results.status).toBe(200);
      expect(await results.text()).not.toContain("2/2");
    });
  });

  // Belt and braces for the pipeline itself: the route withholds the form, but
  // an attempt id from elsewhere must not become a way to write work into a
  // reading either.
  test("a reading refuses a submission aimed at it directly", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "read2-teacher@example.test");
      const student = await login(env, "read2-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const practice = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { assessmentMode: "practice", title: "Practice set" },
      );
      const reading = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { assessmentMode: "none", title: "Chapter 5" },
      );
      // A real, open attempt — just not one that belongs to the reading.
      const practicePage = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${practice.id}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const attemptId = attemptIdFrom(await practicePage.text());

      expect(attemptId).toBeDefined();

      const refused = await submitAnswer(
        env,
        student,
        courseId,
        reading.id,
        attemptId ?? "",
        answer(["yes"]),
      );

      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({
        error: { code: "assignment_not_assessed" },
      });
    });
  });
});

describe("aufbau-proof submissions", () => {
  test("an active attempt renders the interactive proof form and hydration", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "proof-teacher@example.test");
      const student = await login(env, "proof-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Proof lesson

:::aufbau-mm0{name="prop" show}
provable sort wff;
term top: wff;
axiom top_i: $ top $;
:::

:::aufbau-proof{system="prop" id="p1"}
Prove top.

theorem thm_top: $ top $
----
l1: $ top $ by top_i []
:::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const documentResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const documentHtml = await documentResponse.text();

      expect(documentResponse.status).toBe(200);
      // Regression: the per-kind answer-form dispatch once omitted aufbau-proof,
      // so the element rendered inert (no form, no hydration) and could not be
      // answered. Assert the interactive form and hydration are emitted.
      expect(documentHtml).toContain("<carnap-aufbau-proof ");
      expect(documentHtml).toContain('class="exercise"');
      expect(documentHtml).toContain("data-exercise-hydration");
      expect(documentHtml).toContain("aufbau-proof-answer@1");
      expect(documentHtml).toContain(`/attempts/${attemptId}/submissions`);
      // The theory panel renders alongside the exercise.
      expect(documentHtml).toContain("aufbau-theory");
      // The document carries one copy of the theory, and the widget's own
      // payload carries its name — the element joins the two on connect. A
      // document that emitted the table but kept the text in each payload would
      // still work and would still be the duplication this replaced.
      expect(documentHtml).toContain("data-carnap-systems");
      const payload =
        /<script type="application\/json" data-exercise-hydration>(.*?)<\/script>/s.exec(
          documentHtml,
        )?.[1] ?? "";

      expect(payload).toContain('"system":"prop"');
      expect(payload).not.toContain("sort wff");
    });
  });
});

describe("aufbau-proof-tree submissions", () => {
  test("an active attempt renders the interactive tree form and hydration", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "tree-teacher@example.test");
      const student = await login(env, "tree-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Tree proof lesson

:::aufbau-mm0{name="prop" show}
provable sort wff;
term top: wff;
axiom top_i: $ top $;
:::

:::aufbau-proof-tree{system="prop" id="t1"}
Build a proof of top.

theorem thm_top: $ top $
:::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const documentResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.id}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const documentHtml = await documentResponse.text();

      expect(documentResponse.status).toBe(200);
      // Regression guard mirroring aufbau-proof: a new interactive kind must be
      // added to the per-kind submissionFormNode dispatch or it renders inert.
      expect(documentHtml).toContain("<carnap-aufbau-proof-tree ");
      expect(documentHtml).toContain('class="exercise"');
      expect(documentHtml).toContain("data-exercise-hydration");
      expect(documentHtml).toContain("aufbau-proof-tree-answer@1");
      expect(documentHtml).toContain(`/attempts/${attemptId}/submissions`);
      expect(documentHtml).toContain("aufbau-theory");
    });
  });
});

describe("the review queue", () => {
  test("lists students' work and not a staff member's own dry run", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "queue-teacher@example.test");
      const student = await login(env, "queue-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );

      // The student pages are any member's, so the instructor can try the
      // assignment the way a student would — and does, before the student.
      // The right answer, so that homework with feedback records it.
      for (const member of [instructor, student]) {
        const attemptId = await beginAttempt(
          env,
          member,
          courseId,
          assignment.id,
        );
        const submitted = await submitAnswer(
          env,
          member,
          courseId,
          assignment.id,
          attemptId,
          answer(["yes"]),
        );

        expect(submitted.status).toBe(201);
      }

      const list = (await (
        await appRequest(
          createTestApp(),
          `/courses/${courseId}/instructor/assignments/${assignment.id}/submissions`,
          { headers: { Cookie: instructor.cookieHeader } },
          env,
        )
      ).json()) as InstructorReviewSubmissionsResponse;

      expect(list.submissions).toHaveLength(1);
      expect(list.submissions[0]?.submission.userId).toBe(student.actorId);
    });
  });

  test("keeps a reset attempt's work under All, marked Reset, with nothing to grade", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "reset-queue-teacher@example.test");
      const student = await login(env, "reset-queue-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Essay

::::free-response{#essay_1 points="5"}
Explain the rule.
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { maxAttempts: 2 },
      );
      const base = `/courses/${courseId}/instructor/assignments/${assignment.id}`;
      const work = async (text: string): Promise<string> => {
        const attemptId = await beginAttempt(
          env,
          student,
          courseId,
          assignment.id,
        );
        const submitted = await submitAnswer(
          env,
          student,
          courseId,
          assignment.id,
          attemptId,
          freeResponseAnswer(text),
        );

        expect(submitted.status).toBe(201);

        return attemptId;
      };
      const firstAttemptId = await work("First try.");
      const reset = await appRequest(
        createTestApp(),
        `${base}/attempts/${firstAttemptId}/reset`,
        { headers: authHeaders(instructor), method: "POST" },
        env,
      );

      expect(reset.status).toBe(200);

      await work("Second try.");

      const page = async (query: string) =>
        (
          await appRequest(
            createTestApp(),
            `${base}/submissions${query}`,
            {
              headers: {
                Accept: "text/html",
                Cookie: instructor.cookieHeader,
              },
            },
            env,
          )
        ).text();

      // The queue and Active hold the live attempt only, and count only it.
      const queue = await page("");

      expect(queue).toContain("Second try.");
      expect(queue).not.toContain("First try.");
      expect(queue).toContain('<span class="review-count-needs">1</span>');
      expect(queue).toContain(
        'Active (<span class="review-count-active">1</span>)',
      );
      expect(queue).toContain("All (2)");

      const active = await page("?review=active");

      expect(active).toContain("Second try.");
      expect(active).not.toContain("First try.");
      expect(active).toContain("Attempt 2 · ");

      // All adds the reset attempt's work, in the state slot rather than a
      // badge, and offers a grading form for the live card alone.
      const all = await page("?review=all");

      expect(all).toContain("First try.");
      expect(all).toContain(
        'Attempt 1 · <span class="review-state-label" data-review-state="reset"',
      );
      expect(countOccurrences(all, 'data-review-state="reset"')).toBe(1);
      expect(countOccurrences(all, 'class="manual-evaluation-form"')).toBe(1);

      const list = (await (
        await appRequest(
          createTestApp(),
          `${base}/submissions`,
          { headers: { Cookie: instructor.cookieHeader } },
          env,
        )
      ).json()) as {
        readonly submissions: readonly {
          readonly attemptOrdinal: number;
          readonly attemptVoided: boolean;
          readonly needsReview: boolean;
          readonly submission: { readonly id: string };
        }[];
      };
      const voided = list.submissions.find((entry) => entry.attemptVoided);

      expect(voided?.attemptOrdinal).toBe(1);
      expect(voided?.needsReview).toBe(false);
      expect(
        list.submissions.filter((entry) => entry.needsReview),
      ).toHaveLength(1);

      // Nor will the server take a grade for it, by either route.
      for (const [path, body] of [
        ["evaluations", { score: 4 }],
        ["approve", {}],
      ] as const) {
        const refused = await appRequest(
          createTestApp(),
          `${base}/submissions/${voided?.submission.id}/${path}`,
          jsonRequest(body, instructor),
          env,
        );

        expect(refused.status).toBe(400);
        expect(
          ((await refused.json()) as { error: { code: string } }).error.code,
        ).toBe("attempt_voided");
      }
    });
  });
});

describe("narrowing and ordering the review queue", () => {
  test("orders by exercise as the lesson asks them, then by student name, and narrows to either", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "narrow-teacher@example.test");
      // Created first, so first by account; last by name.
      const zed = await login(env, "zed-narrow@example.test");
      const amy = await login(env, "amy-narrow@example.test");
      const courseId = await createCourse(env, instructor);
      // The lesson asks `zeta` first: document order, not the ids', decides.
      const revisionId = await createRevision(
        env,
        instructor,
        `# Essays

::::free-response{#zeta title="Opening question" points="5"}
Begin.
::::

::::free-response{#alpha points="5"}
Continue.
::::`,
      );

      for (const student of [zed, amy]) {
        await enrollStudent(env, instructor, student, courseId);
      }

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const base = `/courses/${courseId}/instructor/assignments/${assignment.id}`;
      // Amy answers alpha before zeta; Zed answers zeta alone.
      const work = [
        [amy, "amy-narrow@example.test", ["alpha", "zeta"]],
        [zed, "zed-narrow@example.test", ["zeta"]],
      ] as const;

      for (const [student, email, exerciseIds] of work) {
        const attemptId = await beginAttempt(
          env,
          student,
          courseId,
          assignment.id,
        );

        for (const exerciseId of exerciseIds) {
          const submitted = await submitAnswer(
            env,
            student,
            courseId,
            assignment.id,
            attemptId,
            {
              ...freeResponseAnswer(`${email} on ${exerciseId}.`),
              exerciseId,
            },
          );

          expect(submitted.status).toBe(201);
        }
      }

      const page = async (query: string) =>
        (
          await appRequest(
            createTestApp(),
            `${base}/submissions${query}`,
            {
              headers: {
                Accept: "text/html",
                Cookie: instructor.cookieHeader,
              },
            },
            env,
          )
        ).text();
      const order = (html: string, needles: readonly string[]) =>
        needles.map((needle) => html.indexOf(needle));
      const queue = await page("");
      const cards = order(queue, [
        "amy-narrow@example.test on zeta.",
        "zed-narrow@example.test on zeta.",
        "amy-narrow@example.test on alpha.",
      ]);

      expect(cards.every((index) => index !== -1)).toBe(true);
      expect([...cards].sort((left, right) => left - right)).toEqual(cards);

      // The form offers each exercise by its title where it has one, and
      // each student by name, both in queue order.
      const options = order(queue, [
        ">Opening question</option>",
        ">alpha</option>",
        ">amy-narrow@example.test</option>",
        ">zed-narrow@example.test</option>",
      ]);

      expect(options.every((index) => index !== -1)).toBe(true);
      // Behind the funnel, closed while nothing is narrowed.
      expect(queue).toContain('<details class="review-narrow">');
      expect(options[0]).toBeLessThan(options[1] ?? -1);
      expect(options[2]).toBeLessThan(options[3] ?? -1);

      // Narrowed to an exercise, the counts follow, and every tab and the
      // grading forms keep the narrowing.
      const alpha = await page("?exercise=alpha");

      expect(alpha).toContain("amy-narrow@example.test on alpha.");
      expect(alpha).not.toContain("on zeta.");
      expect(alpha).toContain('<span class="review-count-needs">1</span>');
      expect(alpha).toContain("All (1)");
      expect(alpha).toContain(
        `href="${base}/submissions?review=all&amp;exercise=alpha"`,
      );
      expect(alpha).toContain('<option selected="" value="alpha">');
      // Open while narrowed, so a narrowed queue never passes for the whole.
      expect(alpha).toContain('<details class="review-narrow" open="">');
      expect(alpha).toMatch(/\/evaluations\?exercise=alpha"/);

      // Narrowed to a student, on a tab.
      const zeds = await page(`?review=all&student=${zed.actorId}`);

      expect(zeds).toContain("zed-narrow@example.test on zeta.");
      expect(zeds).not.toContain("amy-narrow@example.test on");
      expect(zeds).toContain(
        '<input name="review" type="hidden" value="all"',
      );

      // Both at once can match nothing, which is said; a choice the work on
      // file does not offer narrows nothing.
      expect(await page(`?exercise=alpha&student=${zed.actorId}`)).toContain(
        "No submissions match these choices.",
      );
      expect(await page("?exercise=missing")).toContain("All (3)");

      // A grade posted without script returns to the view it came from.
      const amyAlpha = (
        (await (
          await appRequest(
            createTestApp(),
            `${base}/submissions`,
            { headers: { Cookie: instructor.cookieHeader } },
            env,
          )
        ).json()) as InstructorReviewSubmissionsResponse
      ).submissions.find(
        (entry) =>
          entry.submission.userId === amy.actorId &&
          entry.submission.exerciseId === "alpha",
      );
      const graded = await appRequest(
        createTestApp(),
        `${base}/submissions/${amyAlpha?.submission.id}/evaluations?review=active&exercise=alpha`,
        {
          body: new URLSearchParams({ score: "4" }).toString(),
          headers: {
            ...authHeaders(instructor),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        env,
      );

      expect(graded.status).toBe(303);
      expect(graded.headers.get("Location")).toBe(
        `${base}/submissions?review=active&exercise=alpha&manualEvaluation=1`,
      );
    });
  });
});

describe("which submission counts, in the review queue", () => {
  interface CountsResponse {
    readonly submissions: readonly {
      readonly counts: boolean;
      readonly needsReview: boolean;
      readonly submission: { readonly answer: unknown; readonly id: string };
    }[];
  }

  test("asks for no review of an exam's wrong tries once a right one decides", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "counts-exam-teacher@example.test");
      const student = await login(env, "counts-exam-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Quiz

::::multiple-choice{#q1 points="2" exam="true"}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const base = `/courses/${courseId}/instructor/assignments/${assignment.id}`;
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );

      // An exam records every try, wrong ones included: wrong, right, then
      // wrong again. The score takes the right one.
      for (const [index, choice] of (
        ["no", "yes", "no"] as const
      ).entries()) {
        const submitted = await submitAnswer(
          env,
          student,
          courseId,
          assignment.id,
          attemptId,
          answer([choice]),
          `exam-try-${index}`,
        );

        expect(submitted.status).toBe(201);
      }

      const list = (await (
        await appRequest(
          createTestApp(),
          `${base}/submissions`,
          { headers: { Cookie: instructor.cookieHeader } },
          env,
        )
      ).json()) as CountsResponse;
      const counting = list.submissions.filter((entry) => entry.counts);

      expect(list.submissions).toHaveLength(3);
      expect(counting).toHaveLength(1);
      expect(JSON.stringify(counting[0]?.submission.answer)).toContain("yes");
      expect(list.submissions.some((entry) => entry.needsReview)).toBe(false);

      const page = async (query: string) =>
        (
          await appRequest(
            createTestApp(),
            `${base}/submissions${query}`,
            {
              headers: {
                Accept: "text/html",
                Cookie: instructor.cookieHeader,
              },
            },
            env,
          )
        ).text();
      const queue = await page("");

      expect(queue).toContain('<span class="review-count-needs">0</span>');
      expect(queue).toContain(
        "Every submission that counts has been reviewed.",
      );

      // Active lists the right try alone.
      const active = await page("?review=active");

      expect(active).toContain(
        'Active (<span class="review-count-active">1</span>)',
      );
      expect(countOccurrences(active, 'class="review-state-label"')).toBe(1);
      expect(
        countOccurrences(active, 'data-review-state="auto-graded"'),
      ).toBe(1);

      // The wrong tries are on file under All, said not to count, with no
      // one-click approval of a score that decides nothing.
      const all = await page("?review=all");

      expect(countOccurrences(all, 'data-review-state="not-counted"')).toBe(
        2,
      );
      expect(all).toContain(">Does not count</span>");
      expect(all).not.toContain('class="approve-score-form"');
    });
  });

  test("counts the latest ungraded try, and lets a grade move which try counts", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(
        env,
        "counts-essay-teacher@example.test",
      );
      const student = await login(env, "counts-essay-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Essay

::::free-response{#essay_1 points="5"}
Explain the rule.
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const base = `/courses/${courseId}/instructor/assignments/${assignment.id}`;
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );

      for (const text of ["First try.", "Second try.", "Third try."]) {
        const submitted = await submitAnswer(
          env,
          student,
          courseId,
          assignment.id,
          attemptId,
          freeResponseAnswer(text),
          text,
        );

        expect(submitted.status).toBe(201);
      }

      const read = async () => {
        const list = (await (
          await appRequest(
            createTestApp(),
            `${base}/submissions`,
            { headers: { Cookie: instructor.cookieHeader } },
            env,
          )
        ).json()) as CountsResponse;
        const byText = (text: string) => {
          const entry = list.submissions.find((candidate) =>
            JSON.stringify(candidate.submission.answer).includes(text),
          );

          if (entry === undefined) {
            throw new Error(`No submission reads "${text}".`);
          }

          return entry;
        };

        return {
          first: byText("First try."),
          second: byText("Second try."),
          third: byText("Third try."),
        };
      };
      // The reply to a grade names the new state of each of the student's
      // tries, which is what the queue's script redraws the cards from.
      const grade = async (submissionId: string, score: number) => {
        const response = await appRequest(
          createTestApp(),
          `${base}/submissions/${submissionId}/evaluations`,
          jsonRequest({ score }, instructor),
          env,
        );

        expect(response.status).toBe(201);

        const body = (await response.json()) as {
          readonly tries: readonly {
            readonly state: string;
            readonly submissionId: string;
          }[];
        };

        return new Map(
          body.tries.map((entry) => [entry.submissionId, entry.state]),
        );
      };

      // Nothing graded: the latest try is the student's answer.
      let tries = await read();

      expect([
        tries.first.counts,
        tries.second.counts,
        tries.third.counts,
      ]).toEqual([false, false, true]);
      expect(tries.third.needsReview).toBe(true);

      const queue = await (
        await appRequest(
          createTestApp(),
          `${base}/submissions`,
          {
            headers: { Accept: "text/html", Cookie: instructor.cookieHeader },
          },
          env,
        )
      ).text();

      expect(queue).toContain("Third try.");
      expect(queue).not.toContain("First try.");
      expect(queue).toContain('<span class="review-count-needs">1</span>');
      // The card says how the student's tries stood when it was drawn, so the
      // script can move the tab counts by what a grade changes.
      expect(queue).toContain('data-group-counting="1" data-group-needs="1"');
      expect(queue).toContain(
        `data-submission-id="${tries.third.submission.id}"`,
      );

      // Grading an earlier try makes it count; the latest, still ungraded,
      // counts too, since its grade could yet beat it.
      const afterFirst = await grade(tries.first.submission.id, 4);

      expect(afterFirst).toEqual(
        new Map([
          [tries.first.submission.id, "reviewed"],
          [tries.second.submission.id, "not-counted"],
          [tries.third.submission.id, "needs-review"],
        ]),
      );
      tries = await read();

      expect([
        tries.first.counts,
        tries.second.counts,
        tries.third.counts,
      ]).toEqual([true, false, true]);
      expect(tries.first.needsReview).toBe(false);
      expect(tries.third.needsReview).toBe(true);

      // Graded lower, the latest no longer counts, and nothing is left to do.
      const afterThird = await grade(tries.third.submission.id, 2);

      expect(afterThird.get(tries.third.submission.id)).toBe("not-counted");
      expect(afterThird.get(tries.first.submission.id)).toBe("reviewed");
      tries = await read();

      expect([
        tries.first.counts,
        tries.second.counts,
        tries.third.counts,
      ]).toEqual([true, false, false]);
      expect(
        [tries.first, tries.second, tries.third].some(
          (entry) => entry.needsReview,
        ),
      ).toBe(false);
    });
  });
});

describe("grading in place on the review queue", () => {
  /**
   * The review page as a browser has it: the server's own render, with the
   * review script run over it in jsdom and its requests answered by the app.
   * What the script does with a reply can only be seen here — the server
   * render says how the page starts, and the reply what changed.
   */
  async function reviewPage(
    env: Env,
    instructor: LoginResult,
    path: string,
  ): Promise<{
    readonly grade: (text: string, score: number) => Promise<void>;
    readonly settle: () => Promise<void>;
    readonly window: Window & typeof globalThis;
  }> {
    const html = await (
      await appRequest(
        createTestApp(),
        path,
        { headers: { Accept: "text/html", Cookie: instructor.cookieHeader } },
        env,
      )
    ).text();
    const dom = new JSDOM(html, {
      runScripts: "outside-only",
      url: `http://localhost${path}`,
    });
    const window = dom.window as unknown as Window & typeof globalThis;
    let inFlight: Promise<unknown> = Promise.resolve();

    (window as unknown as { fetch: unknown }).fetch = (
      url: string,
      init: RequestInit,
    ) => {
      inFlight = appRequest(
        createTestApp(),
        new URL(url).pathname,
        {
          ...init,
          headers: {
            ...(init.headers as Record<string, string>),
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );

      return inFlight;
    };
    (window as unknown as { eval(code: string): void }).eval(REVIEW_SCRIPT);

    return {
      // Waits out the request a key or a click set off, and the redraw after.
      settle: async () => {
        await inFlight;
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
      grade: async (text, score) => {
        const card = [
          ...window.document.querySelectorAll(".submission-review-card"),
        ].find((candidate) => candidate.textContent?.includes(text));
        const form = card?.querySelector(
          "form.manual-evaluation-form",
        ) as HTMLFormElement | null;

        if (form === null || form === undefined) {
          throw new Error(`No grading form on a card reading "${text}".`);
        }

        (form.querySelector("[name=score]") as HTMLInputElement).value =
          String(score);
        form.dispatchEvent(
          new window.Event("submit", { bubbles: true, cancelable: true }),
        );
        await inFlight;
        // The reply's body is read, then the cards are redrawn.
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
      window,
    };
  }

  test("redraws every try a grade moved, and offers a reload for one off the page", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "inplace-teacher@example.test");
      const student = await login(env, "inplace-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        `# Essay

::::free-response{#essay_1 points="5"}
Explain the rule.
::::`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const base = `/courses/${courseId}/instructor/assignments/${assignment.id}`;
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const submissionIds: string[] = [];

      for (const text of ["First try.", "Second try.", "Third try."]) {
        const submitted = await submitAnswer(
          env,
          student,
          courseId,
          assignment.id,
          attemptId,
          freeResponseAnswer(text),
          text,
        );

        submissionIds.push(
          ((await submitted.json()) as { submission: { id: string } })
            .submission.id,
        );
      }

      // The first try graded 4: it counts, and so does the latest while it
      // waits for a grade.
      await appRequest(
        createTestApp(),
        `${base}/submissions/${submissionIds[0]}/evaluations`,
        jsonRequest({ score: 4 }, instructor),
        env,
      );

      const page = await reviewPage(
        env,
        instructor,
        `${base}/submissions?review=active`,
      );
      const document = page.window.document;
      const read = () => ({
        active: document.querySelector(".review-count-active")?.textContent,
        cards: [...document.querySelectorAll(".submission-review-card")].map(
          (card) =>
            `${card.querySelector(".answer-review")?.textContent?.replace("Response", "")}: ${card.querySelector(".review-state-label")?.textContent}`,
        ),
        needs: document.querySelector(".review-count-needs")?.textContent,
        note: document.querySelector(".review-other-try")?.textContent,
      });

      expect(read()).toEqual({
        active: "2",
        cards: ["First try.: Reviewed", "Third try.: Needs review"],
        needs: "1",
        note: "",
      });
      // The grading form is open on the try waiting for a grade, and shut on
      // the one that has it.
      expect(
        [...document.querySelectorAll("details.manual-evaluation")].map(
          (details) => (details as HTMLDetailsElement).open,
        ),
      ).toEqual([false, true]);

      // Ctrl+Enter in the feedback saves the grade with it and moves on: the
      // next card's form opens, with its score field focused.
      const cards = [...document.querySelectorAll(".submission-review-card")];
      const firstForm = cards[0]?.querySelector(
        "form.manual-evaluation-form",
      ) as HTMLFormElement;
      const nextScore = cards[1]?.querySelector(
        "[name=score]",
      ) as HTMLInputElement;
      const textarea = firstForm.querySelector(
        "textarea",
      ) as HTMLTextAreaElement;

      (firstForm.querySelector("[name=score]") as HTMLInputElement).value =
        "4";
      textarea.value = "Well argued.";
      textarea.dispatchEvent(
        new page.window.KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "Enter",
        }),
      );
      await page.settle();

      expect(
        cards[0]?.querySelector(".submission-review-status")?.textContent,
      ).toBe("4/5 · manual");
      expect(document.activeElement).toBe(nextScore);
      expect(
        (
          cards[1]?.querySelector(
            "details.manual-evaluation",
          ) as HTMLDetailsElement
        ).open,
      ).toBe(true);

      // Graded below the first, the latest stops counting and leaves Active.
      await page.grade("Third try.", 2);

      expect(read()).toEqual({
        active: "1",
        cards: ["First try.: Reviewed"],
        needs: "0",
        note: "",
      });

      // Regraded below it, the first stops counting and the latest, off the
      // page, takes its place: said, with a reload offered, not forced.
      await page.grade("First try.", 1);

      expect(read()).toEqual({
        active: "1",
        cards: [],
        needs: "0",
        note: "A different try by inplace-student@example.test now counts. Reload to show it",
      });
      expect(
        document.querySelector(".review-other-try a")?.getAttribute("href"),
      ).toBe(`http://localhost${base}/submissions?review=active`);
      expect(document.body.textContent).toContain(
        "None of the recorded submissions counts toward a grade.",
      );
    });
  });
});

describe("a truth tree on an assignment", () => {
  test("renders its live form with hydration, and grades a submitted tree", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "tree-teacher@example.test");
      const student = await login(env, "tree-student@example.test");
      const courseId = await createCourse(env, instructor);
      const lesson = `# Lesson

::::truth-tree{#tt points="2"}
Use a tree.

P & Q :|-: P
::::`;
      const revisionId = await createRevision(env, instructor, lesson);

      await enrollStudent(env, instructor, student, courseId);

      const assignment = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignment.id,
      );
      const documentHtml = await (
        await appRequest(
          createTestApp(),
          `/courses/${courseId}/assignments/${assignment.id}/content`,
          { headers: { Cookie: student.cookieHeader } },
          env,
        )
      ).text();

      // The element, inside the live form, with its payload and the bar.
      expect(documentHtml).toContain("<carnap-truth-tree");
      expect(documentHtml).toContain(`/attempts/${attemptId}/submissions`);
      expect(documentHtml).toContain("data-exercise-hydration");
      expect(documentHtml).toContain('slot="exercise-actions"');
      expect(documentHtml).toContain("carnap-truth-tree-v1");

      const tree = {
        nodes: [
          {
            end: { cites: ["r3", "r2"], type: "closed" },
            id: "n0",
            parent: null,
            rows: [
              { cites: [], dev: "root", id: "r1", text: "P & Q" },
              { cites: [], dev: "root", id: "r2", text: "¬P" },
              { cites: ["r1"], dev: "d1", id: "r3", text: "P" },
              { cites: ["r1"], dev: "d1", id: "r4", text: "Q" },
            ],
          },
        ],
        rules: { d1: "&" },
      };
      // The certificate the browser would send: the tree's inferences,
      // compiled against the lesson's theory.
      const compiled = await compileCarnapMarkdown(lesson);
      const item = compiled.ok ? compiled.artifact.manifest[0] : undefined;
      const mmb =
        compiled.ok && item !== undefined
          ? await certifyTree(
              withSystemText(
                item.publicData,
                compiled.artifact.systems,
              ) as unknown as TruthTreePublicData,
              tree,
            )
          : undefined;

      expect(mmb).toBeDefined();

      const response = await submitAnswer(
        env,
        student,
        courseId,
        assignment.id,
        attemptId,
        {
          answer: {
            data: { ...tree, mmb },
            kind: "truth-tree-answer@1",
            schemaVersion: 1,
          },
          exerciseId: "tt",
        },
      );
      const body = (await response.json()) as SubmissionResponse;

      expect(response.status).toBe(201);
      expect(body.evaluation.result.status).toBe("correct");
      expect(body.evaluation.score).toBe(2);
    });
  });
});
