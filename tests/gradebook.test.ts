import { describe, expect, setDefaultTimeout, test } from "bun:test";

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

interface GradebookResponse {
  readonly rows: readonly {
    readonly score: {
      readonly maxScore: number;
      readonly score: number;
      readonly status: string;
    };
    readonly user: { readonly email: string };
  }[];
}

interface AssignmentGradebookResponse {
  readonly exercises: readonly {
    readonly id: string;
    readonly points: number;
    readonly title: string | null;
  }[];
  readonly rows: readonly {
    readonly exerciseScores: readonly (number | null)[];
  }[];
}

/** Both halves of a row at once: the total, and the cells it was summed from. */
interface FullGradebookResponse {
  readonly rows: readonly {
    readonly exerciseScores: readonly (number | null)[];
    readonly score: {
      readonly maxScore: number;
      readonly score: number;
      readonly status: string;
    };
  }[];
}

interface CourseGradebookResponse {
  readonly rows: readonly {
    readonly scores: readonly {
      readonly maxScore: number;
      readonly score: number;
      readonly status: string;
    }[];
    readonly user: { readonly email: string };
  }[];
}

interface StudentScoreResponse {
  readonly released: boolean;
  readonly score: {
    readonly maxScore: number;
    readonly score: number;
    readonly status: string;
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
    jsonRequest({ title: "Intro Logic", timezone: "UTC" }, instructor),
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
    {
      headers: authHeaders(student),
      method: "POST",
    },
    env,
  );

  expect(enrollResponse.status).toBe(200);
}

/** One exam question worth `points`, answered correctly by picking "yes". */
function question(id: string, points: number, title?: string): string {
  const titleAttribute = title === undefined ? "" : ` title="${title}"`;

  return `::::multiple-choice{#${id}${titleAttribute} points="${points}" exam="true"}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::`;
}

async function createRevision(
  env: Env,
  author: LoginResult,
  sourceText = `# Lesson\n\n${question("q1", 2)}`,
) {
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
  extra: Record<string, unknown> = {},
) {
  const draftResponse = await appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments`,
    jsonRequest(
      {
        contentRevisionId: revisionId,
        description: "Gradebook practice.",
        gradesVisibleAt: "2999-01-01T00:00:00.000Z",
        title: "Homework",
        ...extra,
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

/**
 * The attempt a practice set collects work into. There is no begin-attempt call
 * for one — opening the assignment is what creates the single perpetual attempt
 * — so this does what a student's browser does, and reads the id back off the
 * exercise forms the content view renders.
 */
async function ensurePracticeAttempt(
  env: Env,
  student: LoginResult,
  courseId: string,
  assignmentId: string,
) {
  const path = `/courses/${courseId}/assignments/${assignmentId}`;
  const headers = { Accept: "text/html", Cookie: student.cookieHeader };

  await appRequest(createTestApp(), path, { headers }, env);

  const contentResponse = await appRequest(
    createTestApp(),
    `${path}/content`,
    { headers },
    env,
  );
  const found = (await contentResponse.text()).match(
    /\/attempts\/([^/"]+)\/submissions/,
  );

  expect(contentResponse.status).toBe(200);
  expect(found).not.toBeNull();

  return found?.[1] ?? "";
}

function answer(selectedOptionIds: readonly string[], exerciseId: string) {
  return {
    answer: {
      data: { selectedOptionIds },
      kind: "multiple-choice-answer@1",
      schemaVersion: 1,
    },
    exerciseId,
  };
}

async function submitAnswer(
  env: Env,
  student: LoginResult,
  courseId: string,
  assignmentId: string,
  attemptId: string,
  selectedOptionIds: readonly string[],
  exerciseId = "q1",
) {
  return appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments/${assignmentId}` +
      `/attempts/${attemptId}/submissions`,
    jsonRequest(answer(selectedOptionIds, exerciseId), student),
    env,
  );
}

describe("gradebook", () => {
  test("scores, release visibility, and CSV export work", async () => {
    await withStorage(async ({ db }, env) => {
      const instructor = await login(env, "grade-teacher@example.test");
      const correct = await login(env, "a-correct@example.test");
      const incorrect = await login(env, "b-incorrect@example.test");
      const missing = await login(env, "c-missing@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, correct, courseId);
      await enrollStudent(env, instructor, incorrect, courseId);
      await enrollStudent(env, instructor, missing, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const correctAttempt = await beginAttempt(
        env,
        correct,
        courseId,
        assignmentId,
      );
      const incorrectAttempt = await beginAttempt(
        env,
        incorrect,
        courseId,
        assignmentId,
      );

      expect(
        (
          await submitAnswer(
            env,
            correct,
            courseId,
            assignmentId,
            correctAttempt,
            ["yes"],
          )
        ).status,
      ).toBe(201);
      expect(
        (
          await submitAnswer(
            env,
            incorrect,
            courseId,
            assignmentId,
            incorrectAttempt,
            ["no"],
          )
        ).status,
      ).toBe(201);

      const hiddenResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignmentId}/score`,
        { headers: { Cookie: correct.cookieHeader } },
        env,
      );

      expect(hiddenResponse.status).toBe(403);

      const coursePageResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}`,
        {
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );
      const coursePage = await coursePageResponse.text();

      expect(coursePageResponse.status).toBe(200);
      expect(coursePage).toContain(
        `/courses/${courseId}/instructor/gradebook`,
      );

      expect(coursePage).toContain("Assignment management");
      expect(coursePage).toContain(
        `/courses/${courseId}/instructor/assignments/${assignmentId}/gradebook`,
      );

      const assignmentPageResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignmentId}`,
        {
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );
      const assignmentPage = await assignmentPageResponse.text();

      expect(assignmentPageResponse.status).toBe(200);
      expect(assignmentPage).toContain(
        `/courses/${courseId}/instructor/assignments/${assignmentId}/gradebook`,
      );

      // Grade export and submission review live on the gradebook page, not the
      // assignment record page.
      const assignmentGradebookResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignmentId}/gradebook`,
        {
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );
      const assignmentGradebook = await assignmentGradebookResponse.text();

      expect(assignmentGradebookResponse.status).toBe(200);
      expect(assignmentGradebook).toContain(
        `/courses/${courseId}/instructor/assignments/${assignmentId}/grades.csv`,
      );
      expect(assignmentGradebook).toContain(
        `/courses/${courseId}/instructor/assignments/${assignmentId}/submissions`,
      );

      const courseGradebookResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/gradebook`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const courseGradebook =
        (await courseGradebookResponse.json()) as CourseGradebookResponse;

      expect(courseGradebookResponse.status).toBe(200);
      expect(courseGradebook.rows.map((row) => row.user.email)).toEqual([
        "a-correct@example.test",
        "b-incorrect@example.test",
        "c-missing@example.test",
      ]);
      expect(courseGradebook.rows.map((row) => row.scores[0]?.score)).toEqual(
        [2, 0, 0],
      );
      expect(
        courseGradebook.rows.map((row) => row.scores[0]?.status),
      ).toEqual(["complete", "partial", "not-started"]);

      const refreshedScoreCount = await db
        .prepare("SELECT COUNT(1) AS count FROM assignment_scores")
        .first<{ count: number }>();

      expect(refreshedScoreCount?.count).toBe(3);

      const firstGradebookResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignmentId}/gradebook`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const firstGradebook =
        (await firstGradebookResponse.json()) as GradebookResponse;

      expect(firstGradebookResponse.status).toBe(200);
      expect(firstGradebook.rows.map((row) => row.user.email)).toEqual([
        "a-correct@example.test",
        "b-incorrect@example.test",
        "c-missing@example.test",
      ]);
      expect(firstGradebook.rows.map((row) => row.score.score)).toEqual([
        2, 0, 0,
      ]);
      expect(firstGradebook.rows.map((row) => row.score.maxScore)).toEqual([
        2, 2, 2,
      ]);
      expect(firstGradebook.rows.map((row) => row.score.status)).toEqual([
        "complete",
        "partial",
        "not-started",
      ]);

      await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignmentId}/gradebook`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );

      const scoreCount = await db
        .prepare("SELECT COUNT(1) AS count FROM assignment_scores")
        .first<{ count: number }>();

      expect(scoreCount?.count).toBe(3);

      await db
        .prepare("UPDATE assignments SET grades_visible_at = ? WHERE id = ?")
        .bind("2000-01-01T00:00:00.000Z", assignmentId)
        .run();

      const scoreResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignmentId}/score`,
        { headers: { Cookie: correct.cookieHeader } },
        env,
      );
      const score = (await scoreResponse.json()) as StudentScoreResponse;

      expect(scoreResponse.status).toBe(200);
      expect(score.released).toBe(true);
      expect(score.score.score).toBe(2);
      expect(score.score.maxScore).toBe(2);

      const csvResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignmentId}/grades.csv`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const csv = await csvResponse.text();

      expect(csvResponse.status).toBe(200);
      // Named for what it holds, not for the ids that identify it to us.
      expect(csvResponse.headers.get("Content-Disposition")).toMatch(
        /^attachment; filename="Intro Logic - Homework - \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.csv"; filename\*=UTF-8''/,
      );
      expect(csv).toContain(
        "student_name,student_email,user_id,score,max_score,percent,status",
      );
      expect(csv.indexOf("a-correct@example.test")).toBeLessThan(
        csv.indexOf("b-incorrect@example.test"),
      );
      expect(csv.indexOf("b-incorrect@example.test")).toBeLessThan(
        csv.indexOf("c-missing@example.test"),
      );

      const courseCsvResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/grades.csv`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const courseCsv = await courseCsvResponse.text();

      expect(courseCsvResponse.status).toBe(200);
      expect(courseCsvResponse.headers.get("Content-Type")).toBe(
        "text/csv; charset=utf-8",
      );
      expect(courseCsvResponse.headers.get("Content-Disposition")).toMatch(
        /^attachment; filename="Intro Logic - All grades - \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.csv"/,
      );
      // Tidy long format: the assignment leads each row, then the same columns
      // the per-assignment export uses.
      expect(courseCsv).toContain(
        "assignment_id,assignment_title,student_name,student_email,user_id,score,max_score,percent,status,calculated_at",
      );
      expect(courseCsv).toContain(`${assignmentId},`);
      // One row per (student, assignment) score, grouped by student in row order.
      expect(courseCsv.indexOf("a-correct@example.test")).toBeLessThan(
        courseCsv.indexOf("b-incorrect@example.test"),
      );
      expect(courseCsv.indexOf("b-incorrect@example.test")).toBeLessThan(
        courseCsv.indexOf("c-missing@example.test"),
      );
    });
  });

  test("the assignment export breaks the total down by problem", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "breakdown-teacher@example.test");
      const student = await login(env, "breakdown-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        [
          "# Lesson",
          question("q1", 2, "Modus ponens"),
          question("q2", 1),
          question("q3", 1),
        ].join("\n\n"),
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );

      // Excused, so it counts for nobody — and so has no column to be read as a
      // problem everyone failed to answer.
      const excuseResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignmentId}/excuses`,
        jsonRequest({ exerciseId: "q3", reason: "Ambiguous" }, instructor),
        env,
      );

      expect(excuseResponse.status).toBe(201);

      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignmentId,
      );

      // Right, wrong, and never answered — the three things a cell has to be
      // able to say apart.
      await submitAnswer(
        env,
        student,
        courseId,
        assignmentId,
        attemptId,
        ["yes"],
        "q1",
      );
      await submitAnswer(
        env,
        student,
        courseId,
        assignmentId,
        attemptId,
        ["no"],
        "q2",
      );

      const csvResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignmentId}/grades.csv`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const [header = "", row = ""] = (await csvResponse.text()).split("\n");

      expect(csvResponse.status).toBe(200);
      // Titled by its author where there is a title, by the id either way, and
      // always with what it is worth: a bare "1" is unreadable out of nothing.
      expect(header).toBe(
        "student_name,student_email,user_id,score,max_score,percent,status," +
          "calculated_at,Modus ponens (q1) /2,q2 /1",
      );
      expect(header).not.toContain("q3");
      // Two of two on the first, zero of one on the second, and the earned
      // columns sum to the score three cells to their left.
      expect(row).toContain(",2,3,66.67,partial,");
      expect(row.endsWith(",2,0")).toBe(true);

      const gradebookResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignmentId}/gradebook`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const gradebook =
        (await gradebookResponse.json()) as AssignmentGradebookResponse;

      expect(gradebook.exercises).toEqual([
        { id: "q1", points: 2, title: "Modus ponens" },
        { id: "q2", points: 1, title: null },
      ]);
      expect(gradebook.rows.map((entry) => entry.exerciseScores)).toEqual([
        [2, 0],
      ]);
    });
  });

  test("a practice set records points, and the instructor can read them", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "practice-teacher@example.test");
      const student = await login(env, "practice-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(
        env,
        instructor,
        [question("q1", 2, "Modus ponens"), question("q2", 3)].join("\n\n"),
      );

      await enrollStudent(env, instructor, student, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { assessmentMode: "practice" },
      );
      const attemptId = await ensurePracticeAttempt(
        env,
        student,
        courseId,
        assignmentId,
      );

      await submitAnswer(
        env,
        student,
        courseId,
        assignmentId,
        attemptId,
        ["yes"],
        "q1",
      );
      await submitAnswer(
        env,
        student,
        courseId,
        assignmentId,
        attemptId,
        ["no"],
        "q2",
      );

      const gradingBase = `/courses/${courseId}/instructor/assignments/${assignmentId}`;
      const asInstructor = { headers: { Cookie: instructor.cookieHeader } };
      const gradebookResponse = await appRequest(
        createTestApp(),
        `${gradingBase}/gradebook`,
        asInstructor,
        env,
      );
      const gradebook =
        (await gradebookResponse.json()) as FullGradebookResponse;

      // The same table a graded assignment gets: the total, and where it came
      // from. This used to be a 403.
      expect(gradebookResponse.status).toBe(200);
      expect(gradebook.rows[0]?.score).toMatchObject({
        maxScore: 5,
        score: 2,
        status: "partial",
      });
      expect(gradebook.rows.map((row) => row.exerciseScores)).toEqual([
        [2, 0],
      ]);

      const csvResponse = await appRequest(
        createTestApp(),
        `${gradingBase}/grades.csv`,
        asInstructor,
        env,
      );
      const csv = await csvResponse.text();

      expect(csvResponse.status).toBe(200);
      expect(csv).toContain("practice-student@example.test");
      expect(csv).toContain(",2,5,40.00,partial,");

      const reviewResponse = await appRequest(
        createTestApp(),
        `${gradingBase}/submissions`,
        asInstructor,
        env,
      );
      const review = (await reviewResponse.json()) as {
        readonly submissions: readonly unknown[];
      };

      // Both answers are listed. The empty list this used to return read as
      // "nobody has done this" while the work sat in the database.
      expect(review.submissions).toHaveLength(2);

      const reviewPage = await appRequest(
        createTestApp(),
        `${gradingBase}/submissions`,
        { headers: { Accept: "text/html", Cookie: instructor.cookieHeader } },
        env,
      );
      const reviewHtml = await reviewPage.text();

      // The same interface a graded assignment gets, queue and all: the page
      // opens on the submission short of full marks and leaves out the one that
      // earned them. Practice collects real answers — a free response, a proof
      // an autograder scored zero on a technicality — and an instructor reading
      // them has the same reasons to write back and to correct a score.
      expect(reviewHtml).toContain("q2");
      expect(reviewHtml).not.toContain("q1");
      expect(reviewHtml).toContain("Add a manual evaluation");
      expect(reviewHtml).toContain("review-state-label");

      // …and the grade an instructor writes by hand lands on the practice
      // score, as the autograded one does.
      const secondSubmissionId = (
        review.submissions[1] as {
          readonly submission: { readonly id: string };
        }
      ).submission.id;
      const manualResponse = await appRequest(
        createTestApp(),
        `${gradingBase}/submissions/${secondSubmissionId}/evaluations`,
        jsonRequest(
          {
            feedback: "Right idea, wrong connective.",
            maxScore: 3,
            score: 2,
          },
          instructor,
        ),
        env,
      );

      expect(manualResponse.status).toBe(201);

      const regraded = (await (
        await appRequest(
          createTestApp(),
          `${gradingBase}/gradebook`,
          asInstructor,
          env,
        )
      ).json()) as FullGradebookResponse;

      expect(regraded.rows[0]?.score).toMatchObject({
        maxScore: 5,
        score: 4,
      });
      expect(regraded.rows.map((row) => row.exerciseScores)).toEqual([
        [2, 2],
      ]);

      const gradebookPage = await appRequest(
        createTestApp(),
        `${gradingBase}/gradebook`,
        { headers: { Accept: "text/html", Cookie: instructor.cookieHeader } },
        env,
      );
      const gradebookHtml = await gradebookPage.text();

      expect(gradebookHtml).toContain("do not count toward the course total");
      // Named for what it holds. "Assignment grades" over a table of points
      // that reach no course total is the confusing half of this.
      expect(gradebookHtml).toContain("Practice scores");
      expect(gradebookHtml).not.toContain("Assignment grades");

      const assignmentPage = await appRequest(
        createTestApp(),
        gradingBase,
        { headers: { Accept: "text/html", Cookie: instructor.cookieHeader } },
        env,
      );

      // …and a way to get there that is not typing the URL.
      expect(await assignmentPage.text()).toContain(
        `${gradingBase}/gradebook`,
      );

      const courseGradebookResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/gradebook`,
        asInstructor,
        env,
      );
      const courseGradebook =
        (await courseGradebookResponse.json()) as CourseGradebookResponse;

      // Deliberately absent from the course table: every column there is summed
      // into a total, and a practice column has no way to say it does not count.
      expect(courseGradebook.rows[0]?.scores).toEqual([]);

      const readingId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { assessmentMode: "none", title: "Reading" },
      );
      const readingGradebook = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${readingId}/gradebook`,
        asInstructor,
        env,
      );

      // A reading takes no submissions at all, so its gradebook would be a
      // table of zeros no reader could tell from work nobody did.
      expect(readingGradebook.status).toBe(403);
      expect(await readingGradebook.text()).toContain(
        "assignment_not_scored",
      );
    });
  });

  test("students see assignment worth, and earned work only once released", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "results-teacher@example.test");
      const student = await login(env, "results-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignmentId,
      );

      expect(
        (
          await submitAnswer(
            env,
            student,
            courseId,
            assignmentId,
            attemptId,
            ["yes"],
          )
        ).status,
      ).toBe(201);

      const resultsPath = `/courses/${courseId}/assignments/${assignmentId}/results`;

      // Before release: the assignment's worth is shown, but the earned score
      // and the results page are withheld.
      const hiddenCoursePage = await appRequest(
        createTestApp(),
        `/courses/${courseId}`,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );

      expect(hiddenCoursePage.status).toBe(200);

      const hiddenCourseHtml = await hiddenCoursePage.text();

      expect(hiddenCourseHtml).toContain("<th>Score</th>");
      expect(hiddenCourseHtml).toContain("not released");
      expect(hiddenCourseHtml).not.toContain(resultsPath);

      const hiddenResults = await appRequest(
        createTestApp(),
        resultsPath,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );

      expect(hiddenResults.status).toBe(200);

      const hiddenResultsHtml = await hiddenResults.text();

      expect(hiddenResultsHtml).toContain("have not been released");
      // The page used to stop there, which left a student who was getting live
      // feedback in the widget staring at an empty history. What release holds
      // is the numbers; the work is theirs to read back either way.
      expect(hiddenResultsHtml).toContain("Attempt 1");
      expect(hiddenResultsHtml).toContain("q1");
      expect(hiddenResultsHtml).not.toContain("2/2");

      const releasePath = `/courses/${courseId}/instructor/assignments/${assignmentId}/grade-visibility`;

      // A student cannot release grades.
      const studentRelease = await appRequest(
        createTestApp(),
        releasePath,
        jsonRequest({ release: true }, student),
        env,
      );

      expect(studentRelease.status).toBe(403);

      // The instructor releases grades with one action.
      const instructorRelease = await appRequest(
        createTestApp(),
        releasePath,
        jsonRequest({ release: true }, instructor),
        env,
      );

      expect(instructorRelease.status).toBe(200);

      // After release: the earned score links through to the results page,
      // which shows the graded attempt.
      const releasedCoursePage = await appRequest(
        createTestApp(),
        `/courses/${courseId}`,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );
      const releasedCourseHtml = await releasedCoursePage.text();

      expect(releasedCourseHtml).toContain(resultsPath);
      expect(releasedCourseHtml).toContain("2/2");

      const releasedResults = await appRequest(
        createTestApp(),
        resultsPath,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );

      expect(releasedResults.status).toBe(200);

      const releasedResultsHtml = await releasedResults.text();

      expect(releasedResultsHtml).toContain("Attempt 1");
      expect(releasedResultsHtml).toContain("q1");
    });
  });
});
