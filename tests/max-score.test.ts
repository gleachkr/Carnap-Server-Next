import { describe, expect, setDefaultTimeout, test } from "bun:test";

import {
  evaluationVerdict,
  storedPointsDrift,
  submissionNeedsReview,
} from "../src/worker/domain/assessment";
import type { Env } from "../src/worker/env";
import { grantTestCourseCreator } from "./helpers/admin";
import { appRequest, createTestApp } from "./helpers/app";
import { createTestStorage, type TestStorage } from "./helpers/storage";

setDefaultTimeout(30_000);

interface LoginResult {
  readonly actorId: string;
  readonly cookieHeader: string;
  readonly csrfToken: string;
}

interface StartLoginResponse {
  readonly login: { readonly loginToken: string };
}

interface ConfirmLoginResponse {
  readonly actor: { readonly id: string };
  readonly csrfToken: string;
}

interface CourseResponse {
  readonly course: { readonly id: string };
}

interface EnrollmentLinkResponse {
  readonly enrollmentLink: { readonly enrollmentPath: string };
}

interface ContentItemResponse {
  readonly item: { readonly id: string };
}

interface ContentRevisionResponse {
  readonly revision: { readonly id: string };
}

interface AssignmentResponse {
  readonly assignment: { readonly id: string };
}

interface BeginAttemptResponse {
  readonly attempt: { readonly id: string };
}

interface FullGradebookResponse {
  readonly exercises: readonly { readonly id: string }[];
  readonly rows: readonly {
    readonly exerciseScores: readonly (number | null)[];
    readonly score: {
      readonly maxScore: number;
      readonly score: number;
    };
  }[];
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

function authHeaders(login: LoginResult) {
  return {
    Cookie: login.cookieHeader,
    "X-CSRF-Token": login.csrfToken,
  };
}

async function login(env: Env, email: string): Promise<LoginResult> {
  const startResponse = await appRequest(
    createTestApp(),
    "/auth/login/start",
    jsonRequest({ email }),
    env,
  );
  const startBody = (await startResponse.json()) as StartLoginResponse;
  const confirmResponse = await appRequest(
    createTestApp(),
    "/auth/login/confirm",
    jsonRequest({ loginToken: startBody.login.loginToken }),
    env,
  );
  const confirmBody = (await confirmResponse.json()) as ConfirmLoginResponse;

  return {
    actorId: confirmBody.actor.id,
    cookieHeader: cookieHeader(confirmResponse),
    csrfToken: confirmBody.csrfToken,
  };
}

async function createCourse(env: Env, instructor: LoginResult) {
  await grantTestCourseCreator(env, instructor.actorId);

  const response = await appRequest(
    createTestApp(),
    "/courses",
    jsonRequest({ timezone: "UTC", title: "Intro Logic" }, instructor),
    env,
  );
  const body = (await response.json()) as CourseResponse;

  expect(response.status).toBe(201);

  return body.course.id;
}

async function enrollStudent(
  env: Env,
  instructor: LoginResult,
  student: LoginResult,
  courseId: string,
): Promise<void> {
  const linkResponse = await appRequest(
    createTestApp(),
    `/courses/${courseId}/enrollment-links`,
    jsonRequest({}, instructor),
    env,
  );
  const link = (await linkResponse.json()) as EnrollmentLinkResponse;
  const enrollResponse = await appRequest(
    createTestApp(),
    link.enrollmentLink.enrollmentPath,
    { headers: authHeaders(student), method: "POST" },
    env,
  );

  expect(enrollResponse.status).toBe(200);
}

/** One exam question worth `points`, answered correctly by picking "yes". */
function question(id: string, points: number): string {
  return `::::multiple-choice{#${id} points="${points}" exam="true"}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::`;
}

async function createItem(env: Env, author: LoginResult) {
  const itemResponse = await appRequest(
    createTestApp(),
    "/content",
    jsonRequest({ title: "Lesson" }, author),
    env,
  );
  const item = (await itemResponse.json()) as ContentItemResponse;

  return item.item.id;
}

async function createRevisionForItem(
  env: Env,
  author: LoginResult,
  itemId: string,
  sourceText: string,
) {
  const response = await appRequest(
    createTestApp(),
    `/content/${itemId}/revisions`,
    jsonRequest({ sourceText }, author),
    env,
  );
  const body = (await response.json()) as ContentRevisionResponse;

  expect(response.status).toBe(201);

  return body.revision.id;
}

async function createPublishedAssignment(
  env: Env,
  instructor: LoginResult,
  courseId: string,
  revisionId: string,
) {
  const draftResponse = await appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments`,
    jsonRequest(
      {
        contentRevisionId: revisionId,
        description: "Two denominators.",
        // Released from the start, so the student surface shows its numbers.
        gradesVisibleAt: "2000-01-01T00:00:00.000Z",
        title: "Homework",
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
    { headers: authHeaders(instructor), method: "POST" },
    env,
  );

  expect(publishResponse.status).toBe(200);

  return draft.assignment.id;
}

async function beginAttempt(
  env: Env,
  student: LoginResult,
  courseId: string,
  assignmentId: string,
) {
  const response = await appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments/${assignmentId}/attempts`,
    { headers: authHeaders(student), method: "POST" },
    env,
  );
  const body = (await response.json()) as BeginAttemptResponse;

  expect(response.status).toBe(201);

  return body.attempt.id;
}

async function submitCorrect(
  env: Env,
  student: LoginResult,
  courseId: string,
  assignmentId: string,
  attemptId: string,
  exerciseId: string,
) {
  const response = await appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments/${assignmentId}` +
      `/attempts/${attemptId}/submissions`,
    jsonRequest(
      {
        answer: {
          data: { selectedOptionIds: ["yes"] },
          kind: "multiple-choice-answer@1",
          schemaVersion: 1,
        },
        exerciseId,
      },
      student,
    ),
    env,
  );

  expect(response.status).toBe(201);
}

const BANNER_TEXT = "graded when their exercises were worth different points";
const ADVISORY_TEXT =
  "keeps each recorded score and the points it was graded out of";

describe("storedPointsDrift", () => {
  test("nothing drifts without an evaluation or without its numbers", () => {
    expect(storedPointsDrift(null, 5)).toBeNull();
    // Sealed for this reader: a number they may not see cannot be annotated.
    expect(storedPointsDrift({ maxScore: null }, 5)).toBeNull();
  });

  test("matching points do not drift", () => {
    expect(storedPointsDrift({ maxScore: 5 }, 5)).toBeNull();
  });

  test("changed points name the current figure", () => {
    expect(storedPointsDrift({ maxScore: 5 }, 2)).toEqual({
      kind: "changed",
      nominalPoints: 2,
    });
  });

  test("an exercise that left the assignment reads as removed", () => {
    expect(storedPointsDrift({ maxScore: 5 }, null)).toEqual({
      kind: "removed",
    });
  });
});

describe("bonus grades against the stored maximum", () => {
  // The one place the stored max still decides something on its own: a grade
  // at or above it is full marks. A bonus 7/5 is an instructor's deliberate
  // act, so it reads as correct and needs no second look.
  test("a bonus grade is correct and leaves the review queue", () => {
    expect(evaluationVerdict({ maxScore: 5, score: 7 })).toBe("correct");
    expect(
      submissionNeedsReview({
        evaluatorKind: "automatic",
        maxScore: 5,
        score: 7,
      }),
    ).toBe(false);
  });
});

describe("two denominators after a repoint", () => {
  test("evaluations keep their figures while totals use the manifest's", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "drift-teacher@example.test");
      const student = await login(env, "drift-student@example.test");
      const courseId = await createCourse(env, instructor);
      const itemId = await createItem(env, instructor);
      const firstRevision = await createRevisionForItem(
        env,
        instructor,
        itemId,
        `# Lesson\n\n${question("q1", 5)}\n\n${question("q2", 3)}`,
      );
      // The same item, re-priced and shortened: q1 drops to 2 points and q2
      // leaves the assignment entirely.
      const secondRevision = await createRevisionForItem(
        env,
        instructor,
        itemId,
        `# Lesson\n\n${question("q1", 2)}`,
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        firstRevision,
      );
      const base = `/courses/${courseId}/instructor/assignments/${assignmentId}`;
      const asInstructorPage = {
        headers: { Accept: "text/html", Cookie: instructor.cookieHeader },
      };

      // Nothing has been graded yet, so the correction form asks nothing:
      // repointing a fresh assignment stays one click.
      const freshPage = await (
        await appRequest(createTestApp(), base, asInstructorPage, env)
      ).text();

      expect(freshPage).not.toContain(ADVISORY_TEXT);
      expect(freshPage).not.toContain("confirm-correction");

      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignmentId,
      );

      await submitCorrect(
        env,
        student,
        courseId,
        assignmentId,
        attemptId,
        "q1",
      );
      await submitCorrect(
        env,
        student,
        courseId,
        assignmentId,
        attemptId,
        "q2",
      );

      // With graded work recorded, publishing a correction asks first: the
      // form is wired to a confirmation dialog that states what a repoint
      // will and will not change.
      const gradedPage = await (
        await appRequest(createTestApp(), base, asInstructorPage, env)
      ).text();

      expect(gradedPage).toContain(ADVISORY_TEXT);
      expect(gradedPage).toContain(
        'data-confirm-dialog="confirm-correction"',
      );
      expect(gradedPage).toContain('data-confirm-submit="repoint-form"');

      const before = (await (
        await appRequest(
          createTestApp(),
          `${base}/gradebook`,
          { headers: authHeaders(instructor) },
          env,
        )
      ).json()) as FullGradebookResponse;

      expect(before.rows[0]?.score).toMatchObject({ maxScore: 8, score: 8 });

      // No drift, no mark: the banner and the tint appear only once the
      // stored and declared figures disagree.
      const cleanReview = await (
        await appRequest(
          createTestApp(),
          `${base}/submissions?review=all`,
          asInstructorPage,
          env,
        )
      ).text();

      expect(cleanReview).not.toContain("points-drift");
      expect(cleanReview).not.toContain(BANNER_TEXT);

      const repointResponse = await appRequest(
        createTestApp(),
        `${base}/content-revision`,
        jsonRequest(
          { contentRevisionId: secondRevision, note: "Re-priced." },
          instructor,
        ),
        env,
      );

      expect(repointResponse.status).toBe(200);

      // The projection swaps denominators at once: the total divides by the
      // current manifest (2 points, q2 gone), while the numerator still sums
      // the stored raw scores it can place — 5 earned on the now-2-point q1,
      // the same arithmetic that lets deliberate extra credit exceed the
      // maximum. q2's 3 points vanish from both sides.
      const after = (await (
        await appRequest(
          createTestApp(),
          `${base}/gradebook`,
          { headers: authHeaders(instructor) },
          env,
        )
      ).json()) as FullGradebookResponse;

      expect(after.exercises.map((exercise) => exercise.id)).toEqual(["q1"]);
      expect(after.rows[0]?.score).toMatchObject({ maxScore: 2, score: 5 });
      expect(after.rows[0]?.exerciseScores).toEqual([5]);

      // The review page keeps every stored figure and says how each drifted:
      // the banner over the queue, the tint on the score, the current points
      // (or the exercise's absence) named beside it.
      const reviewHtml = await (
        await appRequest(
          createTestApp(),
          `${base}/submissions?review=all`,
          asInstructorPage,
          env,
        )
      ).text();

      expect(reviewHtml).toContain(BANNER_TEXT);
      expect(reviewHtml).toContain("points-drift");
      expect(reviewHtml).toContain("5/5");
      expect(reviewHtml).toContain("now worth 2");
      expect(reviewHtml).toContain("3/3");
      expect(reviewHtml).toContain("no longer in the assignment");
      expect(reviewHtml).toContain('data-nominal-points="2"');
      // A fresh hand grade will be stamped with the current points, so that
      // is the number the manual form promises.
      expect(reviewHtml).toContain("Score out of 2");

      // The student reads the same story: their graded fractions unchanged,
      // each drifted one marked and explained, the banner naming the rule
      // their total follows.
      const resultsHtml = await (
        await appRequest(
          createTestApp(),
          `/courses/${courseId}/assignments/${assignmentId}/results`,
          { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
          env,
        )
      ).text();

      expect(resultsHtml).toContain(BANNER_TEXT);
      expect(resultsHtml).toContain("points-drift");
      expect(resultsHtml).toContain("5/5");
      expect(resultsHtml).toContain("now worth 2");
      expect(resultsHtml).toContain("3/3");
      expect(resultsHtml).toContain("no longer in the assignment");
    });
  });
});
