import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { CompiledContentArtifact } from "../src/worker/domain/content";
import type { Env } from "../src/worker/env";
import { CONTENT_SCRIPT_ASSET } from "../src/worker/web/script-assets";
import { CONTENT_STYLE_SHEET } from "../src/worker/web/style-assets";
import {
  grantTestContentAuthor,
  grantTestCourseCreator,
} from "./helpers/admin";
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
  readonly enrollmentLink: {
    readonly enrollmentPath: string;
  };
}

interface ContentItemResponse {
  readonly item: { readonly id: string };
}

interface ContentRevisionResponse {
  readonly revision: {
    readonly compiled: CompiledContentArtifact;
    readonly createdAt: string;
    readonly id: string;
  };
}

interface AssignmentResponse {
  readonly assignment: {
    readonly assessmentMode: string;
    readonly contentRevisionId: string;
    readonly description: string;
    readonly dueAt: string | null;
    readonly gradesVisibleAt: string | null;
    readonly id: string;
    readonly listed: boolean;
    readonly maxAttempts: number;
    readonly state: string;
    readonly title: string;
  };
  readonly contentRevision: { readonly id: string };
  readonly contentVersions: readonly {
    readonly contentRevisionId: string;
    readonly note: string;
  }[];
  readonly exerciseExcuses: readonly {
    readonly exerciseId: string;
    readonly reason: string;
    readonly status: string;
  }[];
  readonly renderedHtml: string;
  readonly requiredComponents: readonly string[];
}

interface AssignmentListResponse {
  readonly assignments: readonly AssignmentResponse["assignment"][];
}

interface ItemListResponse {
  readonly items: readonly AssignmentResponse["assignment"][];
}

interface CourseGradebookResponse {
  readonly assignments: readonly { readonly id: string }[];
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

async function createCourse(
  env: Env,
  instructor: LoginResult,
): Promise<CourseResponse> {
  await grantTestCourseCreator(env, instructor.actorId);

  const response = await appRequest(
    createTestApp(),
    "/courses",
    jsonRequest({ title: "Intro Logic", timezone: "UTC" }, instructor),
    env,
  );

  expect(response.status).toBe(201);

  return (await response.json()) as CourseResponse;
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
      headers: {
        Cookie: student.cookieHeader,
        "X-CSRF-Token": student.csrfToken,
      },
      method: "POST",
    },
    env,
  );

  expect(enrollResponse.status).toBe(200);
}

function source(exerciseId: string, prompt: string): string {
  return `# Lesson ${exerciseId}

Intro prose.

::::multiple-choice{#${exerciseId} title="Question" points="1"}
${prompt}

- [x] yes | Yes
- [ ] no | No
::::

Closing prose.`;
}

async function createContentItem(
  env: Env,
  author: LoginResult,
): Promise<ContentItemResponse> {
  // Writing content is a permission now. What that permission gates is
  // content.test.ts's subject; here an item is only ever a fixture, so the
  // helper hands it over rather than making every caller ask for it.
  await grantTestContentAuthor(env, author.actorId);

  const itemResponse = await appRequest(
    createTestApp(),
    "/content",
    jsonRequest({ title: "Lesson" }, author),
    env,
  );

  expect(itemResponse.status).toBe(201);

  return (await itemResponse.json()) as ContentItemResponse;
}

async function createRevisionForItem(
  env: Env,
  author: LoginResult,
  itemId: string,
  sourceText: string,
): Promise<ContentRevisionResponse> {
  const revisionResponse = await appRequest(
    createTestApp(),
    `/content/${itemId}/revisions`,
    jsonRequest({ sourceText }, author),
    env,
  );

  expect(revisionResponse.status).toBe(201);

  return (await revisionResponse.json()) as ContentRevisionResponse;
}

async function createRevision(
  env: Env,
  author: LoginResult,
  sourceText: string,
): Promise<ContentRevisionResponse> {
  const item = await createContentItem(env, author);

  return createRevisionForItem(env, author, item.item.id, sourceText);
}

async function createDraft(
  env: Env,
  instructor: LoginResult,
  courseId: string,
  revisionId: string,
  fields: Record<string, unknown> = {},
): Promise<AssignmentResponse> {
  const response = await appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments`,
    jsonRequest(
      {
        contentRevisionId: revisionId,
        description: "Read the lesson and answer the question.",
        title: "Homework 1",
        ...fields,
      },
      instructor,
    ),
    env,
  );

  expect(response.status).toBe(201);

  return (await response.json()) as AssignmentResponse;
}

async function publish(
  env: Env,
  instructor: LoginResult,
  courseId: string,
  assignmentId: string,
): Promise<AssignmentResponse> {
  const response = await appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments/${assignmentId}/publish`,
    {
      headers: {
        Cookie: instructor.cookieHeader,
        "X-CSRF-Token": instructor.csrfToken,
      },
      method: "POST",
    },
    env,
  );

  expect(response.status).toBe(200);

  return (await response.json()) as AssignmentResponse;
}

// Graded assignment content is withheld until the student has an active
// attempt, so tests that assert on delivered content must open one first.
async function startAttempt(
  env: Env,
  student: LoginResult,
  courseId: string,
  assignmentId: string,
): Promise<void> {
  const response = await appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments/${assignmentId}/attempts`,
    {
      headers: {
        Cookie: student.cookieHeader,
        "X-CSRF-Token": student.csrfToken,
      },
      method: "POST",
    },
    env,
  );

  expect(response.status).toBe(201);
}

describe("assignment publication", () => {
  test("an instructor can create and publish a draft assignment", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "teacher@example.test");
      const student = await login(env, "student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("q1", "Choose yes."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );

      expect(draft.assignment.state).toBe("draft");
      expect(draft.assignment.contentRevisionId).toBe(revision.revision.id);

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, draft.assignment.id);

      const listResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const list = (await listResponse.json()) as AssignmentListResponse;

      await startAttempt(env, student, course.course.id, draft.assignment.id);

      const detailResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${draft.assignment.id}`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const detail = (await detailResponse.json()) as AssignmentResponse;

      expect(list.assignments.map((item) => item.id)).toEqual([
        draft.assignment.id,
      ]);
      expect(detail.renderedHtml).toContain("Intro prose");
      expect(detail.renderedHtml).toContain("Closing prose");
      expect(detail.renderedHtml).toContain('data-exercise-id="q1"');
      expect(detail.renderedHtml).toContain(
        `data-content-revision-id="${revision.revision.id}"`,
      );
      expect(detail.requiredComponents).toEqual([
        "carnap-multiple-choice-v1",
      ]);
    });
  });

  test("a non-assessed item can be viewed without attempts", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "resource-teacher@example.test");
      const student = await login(env, "resource-student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("resource_question", "Optional prompt."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        {
          assessmentMode: "none",
          dueAt: "2026-01-09T03:04:05.000Z",
          gradesVisibleAt: "2026-01-10T03:04:05.000Z",
          maxAttempts: 7,
          title: "Syllabus and resources",
        },
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, draft.assignment.id);

      const listResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/items`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const list = (await listResponse.json()) as ItemListResponse;
      const detailResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/items/${draft.assignment.id}`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const detail = (await detailResponse.json()) as AssignmentResponse;
      const htmlResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/items/${draft.assignment.id}`,
        {
          headers: {
            Accept: "text/html",
            Cookie: student.cookieHeader,
          },
        },
        env,
      );
      const html = await htmlResponse.text();
      const beginResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${draft.assignment.id}/attempts`,
        {
          headers: {
            Cookie: student.cookieHeader,
            "X-CSRF-Token": student.csrfToken,
          },
          method: "POST",
        },
        env,
      );
      const gradebookResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/gradebook`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const gradebook =
        (await gradebookResponse.json()) as CourseGradebookResponse;

      expect(list.items.map((item) => item.id)).toEqual([
        draft.assignment.id,
      ]);
      expect(detail.assignment.assessmentMode).toBe("none");
      expect(detail.assignment.dueAt).toBe(null);
      expect(detail.assignment.gradesVisibleAt).toBe(null);
      expect(detail.assignment.maxAttempts).toBe(1);
      expect(detail.renderedHtml).toContain("Intro prose");
      expect(html).not.toContain("Start attempt");
      expect(beginResponse.status).toBe(403);
      expect(gradebook.assignments).toEqual([]);
    });
  });

  test("new content revisions do not alter old assignments", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "stable-teacher@example.test");
      const student = await login(env, "stable-student@example.test");
      const course = await createCourse(env, instructor);
      const first = await createRevision(
        env,
        instructor,
        source("old_question", "Old prompt."),
      );
      const second = await createRevision(
        env,
        instructor,
        source("new_question", "New prompt."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        first.revision.id,
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, draft.assignment.id);
      await startAttempt(env, student, course.course.id, draft.assignment.id);

      const response = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${draft.assignment.id}`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const detail = (await response.json()) as AssignmentResponse;

      expect(second.revision.id).not.toBe(first.revision.id);
      expect(detail.assignment.contentRevisionId).toBe(first.revision.id);
      expect(detail.renderedHtml).toContain("old_question");
      expect(detail.renderedHtml).not.toContain("new_question");
    });
  });

  test("an instructor can repoint a published assignment", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "repoint-teacher@example.test");
      const student = await login(env, "repoint-student@example.test");
      const course = await createCourse(env, instructor);
      const item = await createContentItem(env, instructor);
      const first = await createRevisionForItem(
        env,
        instructor,
        item.item.id,
        source("old_question", "Old prompt."),
      );
      const second = await createRevisionForItem(
        env,
        instructor,
        item.item.id,
        source("new_question", "New prompt."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        first.revision.id,
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, draft.assignment.id);

      const repointResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/assignments/${draft.assignment.id}/content-revision`,
        jsonRequest(
          {
            contentRevisionId: second.revision.id,
            note: "Removed the old problem.",
          },
          instructor,
        ),
        env,
      );
      const repointed = (await repointResponse.json()) as AssignmentResponse;

      await startAttempt(env, student, course.course.id, draft.assignment.id);

      const studentResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${draft.assignment.id}`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const detail = (await studentResponse.json()) as AssignmentResponse;

      expect(repointResponse.status).toBe(200);
      expect(repointed.assignment.contentRevisionId).toBe(second.revision.id);
      expect(
        repointed.contentVersions.map((entry) => entry.contentRevisionId),
      ).toEqual([first.revision.id, second.revision.id]);
      expect(detail.renderedHtml).toContain("new_question");
      expect(detail.renderedHtml).not.toContain("old_question");
      expect(detail.contentVersions.at(-1)?.note).toBe(
        "Removed the old problem.",
      );
    });
  });

  test("the corrections ledger lists every version, noted or not", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "ledger-teacher@example.test");
      const course = await createCourse(env, instructor);
      const item = await createContentItem(env, instructor);
      const first = await createRevisionForItem(
        env,
        instructor,
        item.item.id,
        source("first_question", "First prompt."),
      );
      const second = await createRevisionForItem(
        env,
        instructor,
        item.item.id,
        source("second_question", "Second prompt."),
      );
      const third = await createRevisionForItem(
        env,
        instructor,
        item.item.id,
        source("third_question", "Third prompt."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        first.revision.id,
      );

      await publish(env, instructor, course.course.id, draft.assignment.id);

      const base = `/courses/${course.course.id}/instructor/assignments/${draft.assignment.id}`;

      // One correction described, one not. The note is optional on the form, so
      // an instructor in a hurry publishes the second kind, and it changes the
      // content under whoever has already answered it exactly as the first does.
      await appRequest(
        createTestApp(),
        `${base}/content-revision`,
        jsonRequest(
          {
            contentRevisionId: second.revision.id,
            note: "Fixed a typo in the second question.",
          },
          instructor,
        ),
        env,
      );
      await appRequest(
        createTestApp(),
        `${base}/content-revision`,
        jsonRequest({ contentRevisionId: third.revision.id }, instructor),
        env,
      );

      const page = await appRequest(
        createTestApp(),
        base,
        { headers: { Accept: "text/html", Cookie: instructor.cookieHeader } },
        env,
      );
      const html = await page.text();
      const start = html.indexOf("Published assignment corrections");
      // The ledger table alone: it ends where the sheet's footer forms begin.
      const ledger = html.slice(
        start,
        html.indexOf(`${base}/content-revision`, start),
      );
      // Cells, not loose text: the sheet's own description says "Content
      // updates and excused exercises", and would be counted as a row.
      const rows = (cell: string): number =>
        ledger.split(`<td>${cell}</td>`).length - 1;

      expect(page.status).toBe(200);
      expect(start).toBeGreaterThan(-1);
      // Three versions: the publication's own, and both corrections.
      expect(rows("Initial revision")).toBe(1);
      expect(rows("Content update")).toBe(2);
      expect(ledger).toContain("Fixed a typo in the second question.");
      // The publication and the undescribed correction. Neither carries a note,
      // and no sentence of the platform's is passed off as one.
      expect(rows("No details given")).toBe(2);
      expect(ledger).not.toContain("Initial published revision.");

      // The picker under the ledger. An `<option>` admits no `<time>` element,
      // so the instant rides on the option itself and the shell's script writes
      // the reader's own clock over the UTC text the server rendered. That
      // rewrite is a substring replacement: if the label ever stopped containing
      // the text the option was tagged with, the script would silently leave
      // every picker in UTC, and this is the assertion that would fail first.
      const option = html.match(
        new RegExp(
          `<option[^>]*value="${third.revision.id}"[^>]*>([^<]*)</option>`,
        ),
      );
      const stamp = html.match(
        new RegExp(
          `<option[^>]*value="${third.revision.id}"[^>]*` +
            `data-revision-time-utc="([^"]*)"`,
        ),
      );

      expect(html).toContain(
        `data-revision-time="${third.revision.createdAt}"`,
      );
      expect(stamp?.[1] ?? "").toContain("UTC");
      expect(option?.[1] ?? "").toContain(stamp?.[1] ?? "\0");
    });
  });

  test("an instructor can excuse an exercise", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "excuse-teacher@example.test");
      const student = await login(env, "excuse-student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("too_hard", "Difficult prompt."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, draft.assignment.id);

      const excuseResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/assignments/${draft.assignment.id}/excuses`,
        jsonRequest(
          {
            exerciseId: "too_hard",
            reason: "This was more difficult than intended.",
          },
          instructor,
        ),
        env,
      );

      await startAttempt(env, student, course.course.id, draft.assignment.id);

      const detailResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${draft.assignment.id}`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const detail = (await detailResponse.json()) as AssignmentResponse;
      const htmlResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${draft.assignment.id}`,
        {
          headers: {
            Accept: "text/html",
            Cookie: student.cookieHeader,
          },
        },
        env,
      );
      const html = await htmlResponse.text();
      const documentResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${draft.assignment.id}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const documentHtml = await documentResponse.text();
      const instructorResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/assignments/${draft.assignment.id}`,
        {
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );
      const instructorHtml = await instructorResponse.text();

      expect(excuseResponse.status).toBe(201);
      expect(
        detail.exerciseExcuses.map((excuse) => ({
          exerciseId: excuse.exerciseId,
          reason: excuse.reason,
          status: excuse.status,
        })),
      ).toEqual([
        {
          exerciseId: "too_hard",
          reason: "This was more difficult than intended.",
          status: "excused",
        },
      ]);
      // The student assignment page is content-only now; the excuse is
      // recorded (asserted above) but no longer surfaced as an updates notice.
      // The content itself lives in the iframe's document.
      expect(htmlResponse.status).toBe(200);
      expect(html).toContain('class="content-frame"');
      expect(documentResponse.status).toBe(200);
      expect(documentHtml).toContain("Difficult prompt.");
      // The ledger names the exercise the way the form above it offered it: the
      // instructor picked "Question" from a list of titles, so a row reading
      // "too_hard" names something they never chose.
      expect(instructorResponse.status).toBe(200);
      expect(instructorHtml).toContain(
        "<td>Question — This was more difficult than intended.</td>",
      );
      expect(instructorHtml).not.toContain("too_hard —");
    });
  });

  test("student visibility hides unlisted work and previews upcoming work", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "visibility-teacher@example.test");
      const student = await login(env, "visibility-student@example.test");
      const outsider = await login(env, "outsider@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("visible_question", "Visible prompt."),
      );
      const hidden = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { listed: false, title: "Hidden homework" },
      );
      const future = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        {
          availableFrom: "2999-01-01T00:00:00.000Z",
          title: "Future homework",
        },
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, hidden.assignment.id);
      await publish(env, instructor, course.course.id, future.assignment.id);

      const listResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const list = (await listResponse.json()) as AssignmentListResponse;
      const hiddenDetail = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${hidden.assignment.id}`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const futureDetail = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${future.assignment.id}`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const outsiderDetail = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${hidden.assignment.id}`,
        { headers: { Cookie: outsider.cookieHeader } },
        env,
      );

      // The unlisted assignment stays hidden, but the future one now previews in
      // the student list as upcoming — while its detail page remains gated (404)
      // until it opens.
      expect(list.assignments.map((entry) => entry.id)).toEqual([
        future.assignment.id,
      ]);
      expect(hiddenDetail.status).toBe(200);
      expect(futureDetail.status).toBe(404);
      expect(outsiderDetail.status).toBe(403);
    });
  });

  test("student course page shows each assignment's availability", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "avail-teacher@example.test");
      const student = await login(env, "avail-student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("avail_question", "Prompt."),
      );
      const open = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { title: "Open now" },
      );
      const closing = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        {
          availableUntil: "2999-01-01T00:00:00.000Z",
          title: "Closing later",
        },
      );
      const upcoming = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { availableFrom: "2999-01-01T00:00:00.000Z", title: "Upcoming" },
      );
      const closed = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        {
          availableUntil: "2000-01-01T00:00:00.000Z",
          title: "Already closed",
        },
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, open.assignment.id);
      await publish(env, instructor, course.course.id, closing.assignment.id);
      await publish(
        env,
        instructor,
        course.course.id,
        upcoming.assignment.id,
      );
      await publish(env, instructor, course.course.id, closed.assignment.id);

      const page = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}`,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );
      const html = await page.text();
      const openHref = `/courses/${course.course.id}/assignments/${open.assignment.id}`;
      const upcomingHref = `/courses/${course.course.id}/assignments/${upcoming.assignment.id}`;
      const closedHref = `/courses/${course.course.id}/assignments/${closed.assignment.id}`;

      expect(page.status).toBe(200);
      expect(html).toContain("<th>Availability</th>");
      expect(html).toContain(">Open<");
      expect(html).toContain("Closes ");
      expect(html).toContain("Opens ");
      expect(html).toContain("Closed ");
      // A closed assignment lingers in a greyed row.
      expect(html).toContain('class="assignment-closed"');
      // The open assignment links to its detail page; the upcoming and closed
      // ones preview as plain text, since their detail pages are gated.
      expect(html).toContain(`href="${openHref}"`);
      expect(html).not.toContain(`href="${upcomingHref}"`);
      expect(html).not.toContain(`href="${closedHref}"`);
    });
  });

  test("browser forms create, edit, and publish assignments", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "browser-teacher@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("browser_question", "Browser prompt."),
      );
      const coursePageResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}`,
        {
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );
      const quickCreateResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments`,
        {
          body: new URLSearchParams({
            csrfToken: instructor.csrfToken,
            quickCreate: "1",
            title: "Quick browser homework",
          }),
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        env,
      );
      const quickLocation = quickCreateResponse.headers.get("Location") ?? "";
      const quickEditResponse = await appRequest(
        createTestApp(),
        quickLocation.split("?")[0] ?? "",
        {
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );
      const coursePageHtml = await coursePageResponse.text();
      const quickEditHtml = await quickEditResponse.text();

      expect(coursePageResponse.status).toBe(200);
      expect(coursePageHtml).toContain('placeholder="new assignment"');
      expect(coursePageHtml).toContain('name="quickCreate"');
      expect(quickCreateResponse.status).toBe(303);
      expect(quickLocation).toContain("/edit?created=1");
      expect(quickEditResponse.status).toBe(200);
      expect(quickEditHtml).toContain("Quick browser homework");

      const createResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments`,
        {
          body: new URLSearchParams({
            contentRevisionId: revision.revision.id,
            csrfToken: instructor.csrfToken,
            description: "Browser created.",
            listed: "1",
            title: "Browser homework",
          }),
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        env,
      );
      const location = createResponse.headers.get("Location") ?? "";
      const assignmentId = location.match(/assignments\/([^/?]+)/)?.[1];

      expect(createResponse.status).toBe(303);
      expect(assignmentId).toBeDefined();

      const detailPath =
        `/courses/${course.course.id}` +
        `/instructor/assignments/${assignmentId}`;
      const detailResponse = await appRequest(
        createTestApp(),
        detailPath,
        {
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );
      const editResponse = await appRequest(
        createTestApp(),
        `${detailPath}/edit`,
        {
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );
      const updateResponse = await appRequest(
        createTestApp(),
        detailPath,
        {
          body: new URLSearchParams({
            contentRevisionId: revision.revision.id,
            csrfToken: instructor.csrfToken,
            description: "Browser edited.",
            listed: "1",
            maxAttempts: "2",
            title: "Browser homework edited",
          }),
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        env,
      );
      const updatedResponse = await appRequest(
        createTestApp(),
        detailPath,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const updated = (await updatedResponse.json()) as AssignmentResponse;
      const publishResponse = await appRequest(
        createTestApp(),
        `${detailPath}/publish`,
        {
          body: new URLSearchParams({ csrfToken: instructor.csrfToken }),
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        env,
      );

      const detailHtml = await detailResponse.text();
      const editHtml = await editResponse.text();

      expect(detailResponse.status).toBe(200);
      expect(detailHtml).toContain("Edit assignment");
      expect(editResponse.status).toBe(200);
      expect(editHtml).toContain("Save assignment");
      expect(editHtml).toContain('type="datetime-local"');
      expect(editHtml).toContain('name="dueAt" type="hidden"');
      // Nothing between the two attributes: no `step`, so the control is
      // minute-granular. Seconds are noise in a deadline, the seconds box
      // costs the width that was hiding the AM/PM marker, and the client
      // script writes minute-granular values — which a step of 1 second
      // would leave the browser refusing to submit as a step mismatch.
      expect(editHtml).toContain(
        '<input data-timestamp-local="dueAt" type="datetime-local"/>',
      );
      expect(updateResponse.status).toBe(303);
      expect(updateResponse.headers.get("Location")).toContain("updated=1");
      expect(updated.assignment.title).toBe("Browser homework edited");
      expect(updated.assignment.description).toBe("Browser edited.");
      expect(updated.assignment.maxAttempts).toBe(2);
      const publishedDetailResponse = await appRequest(
        createTestApp(),
        detailPath,
        {
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );
      const publishedUpdateResponse = await appRequest(
        createTestApp(),
        detailPath,
        {
          body: new URLSearchParams({
            contentRevisionId: revision.revision.id,
            csrfToken: instructor.csrfToken,
            title: "Too late",
          }),
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        env,
      );

      expect(publishResponse.status).toBe(303);
      expect(publishResponse.headers.get("Location")).toContain(
        "published=1",
      );
      expect(publishedDetailResponse.status).toBe(200);
      expect(await publishedDetailResponse.text()).not.toContain(
        "Edit assignment",
      );
      expect(publishedUpdateResponse.status).toBe(400);
    });
  });

  test("an instructor edits scheduling on a published assignment", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "settings-teacher@example.test");
      const outsider = await login(env, "settings-outsider@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("q1", "Prompt."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { dueAt: "2999-01-01T00:00:00.000Z" },
      );
      const assignmentId = draft.assignment.id;

      await publish(env, instructor, course.course.id, assignmentId);

      const detailPath = `/courses/${course.course.id}/instructor/assignments/${assignmentId}`;
      const settingsPath = `${detailPath}/settings`;

      // The edit page for a published assignment serves the settings form,
      // which omits the frozen content and assessment-mode fields.
      const editResponse = await appRequest(
        createTestApp(),
        `${detailPath}/edit`,
        { headers: { Accept: "text/html", Cookie: instructor.cookieHeader } },
        env,
      );
      const editHtml = await editResponse.text();

      expect(editResponse.status).toBe(200);
      expect(editHtml).toContain("Published settings");
      expect(editHtml).toContain("Save settings");
      expect(editHtml).not.toContain('name="contentRevisionId"');
      expect(editHtml).not.toContain('name="assessmentMode"');

      // The due date and max attempts can be changed after publishing.
      const update = await appRequest(
        createTestApp(),
        settingsPath,
        jsonRequest(
          {
            dueAt: "2030-06-01T00:00:00.000Z",
            maxAttempts: 3,
            title: "Homework 1",
          },
          instructor,
        ),
        env,
      );
      const updated = (await update.json()) as AssignmentResponse;

      expect(update.status).toBe(200);
      expect(updated.assignment.state).toBe("published");
      expect(updated.assignment.dueAt).toBe("2030-06-01T00:00:00.000Z");
      expect(updated.assignment.maxAttempts).toBe(3);

      // A non-instructor cannot change published settings.
      const denied = await appRequest(
        createTestApp(),
        settingsPath,
        jsonRequest(
          { dueAt: "2031-01-01T00:00:00.000Z", title: "No" },
          outsider,
        ),
        env,
      );

      expect(denied.status).toBe(403);
    });
  });

  test("the assignment form's Cancel goes back where the form was opened", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "cancel-teacher@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("q1", "Prompt."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );
      const headers = {
        Accept: "text/html",
        Cookie: instructor.cookieHeader,
      };
      const detailPath = `/courses/${course.course.id}/instructor/assignments/${draft.assignment.id}`;

      const createPage = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/assignments/new`,
        { headers },
        env,
      );
      const editPage = await appRequest(
        createTestApp(),
        `${detailPath}/edit`,
        { headers },
        env,
      );

      // Nothing exists yet, so giving up on a new assignment returns to the
      // course; giving up on an edit returns to the assignment itself. A single
      // default for both would send one of them somewhere it never came from.
      expect(await createPage.text()).toContain(
        `href="/courses/${course.course.id}">Cancel</a>`,
      );
      expect(await editPage.text()).toContain(
        `href="${detailPath}">Cancel</a>`,
      );
    });
  });

  test("assignment routes render compiled content, not markdown source", async () => {
    await withStorage(async ({ db }, env) => {
      const instructor = await login(env, "compiled-teacher@example.test");
      const student = await login(env, "compiled-student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("compiled_question", "Compiled prompt."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );

      await db
        .prepare("UPDATE content_revisions SET source_text = ? WHERE id = ?")
        .bind("::::unsupported\n::::", revision.revision.id)
        .run();
      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, draft.assignment.id);
      await startAttempt(env, student, course.course.id, draft.assignment.id);

      const response = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${draft.assignment.id}`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const detail = (await response.json()) as AssignmentResponse;

      expect(response.status).toBe(200);
      expect(detail.renderedHtml).toContain("compiled_question");
      expect(detail.renderedHtml).not.toContain("unsupported");
    });
  });

  test("graded content is withheld until an attempt is active", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "gated-teacher@example.test");
      const student = await login(env, "gated-student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("secret_question", "Secret prompt."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, draft.assignment.id);

      const beforeResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${draft.assignment.id}`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const before = (await beforeResponse.json()) as AssignmentResponse;

      await startAttempt(env, student, course.course.id, draft.assignment.id);

      const afterResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${draft.assignment.id}`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const after = (await afterResponse.json()) as AssignmentResponse;

      // Before an attempt the questions are absent from the JSON entirely, not
      // just hidden in the HTML view.
      expect(beforeResponse.status).toBe(200);
      expect(before.renderedHtml).not.toContain("secret_question");
      expect(before.renderedHtml).not.toContain("Secret prompt.");
      expect(before.requiredComponents).toEqual([]);
      expect(after.renderedHtml).toContain("secret_question");
    });
  });

  test("timestamps render as machine-readable time elements", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "time-teacher@example.test");
      const student = await login(env, "time-student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("time_question", "Prompt."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { dueAt: "2026-07-20T23:59:00.000Z" },
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, draft.assignment.id);

      const pageResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${draft.assignment.id}`,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );
      const html = await pageResponse.text();

      // The due date on the pre-attempt briefing is a <time> element carrying
      // the ISO instant; a client script localizes the visible text.
      expect(html).toContain(
        '<time datetime="2026-07-20T23:59:00.000Z">2026-07-20T23:59:00.000Z</time>',
      );
    });
  });
});

describe("content documents", () => {
  const styledSource = `:::style{src="https://styles.example.test/theme.css"}
h1 { color: maroon; }
:::

${source("styled_q", "Styled prompt.")}`;

  test("graded documents withhold content and styles until an attempt begins", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "doc-teacher@example.test");
      const student = await login(env, "doc-student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(env, instructor, styledSource);
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, draft.assignment.id);

      const pageUrl = `/courses/${course.course.id}/assignments/${draft.assignment.id}`;
      const documentUrl = `${pageUrl}/content`;
      const gateUrl = `${pageUrl}/start`;
      const before = await appRequest(
        createTestApp(),
        documentUrl,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const beforePage = await appRequest(
        createTestApp(),
        pageUrl,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );
      const beforeGate = await appRequest(
        createTestApp(),
        gateUrl,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );
      const beforeGateHtml = await beforeGate.text();

      // Pre-attempt there is no content to serve — the artifact is withheld —
      // so the document sends the reader to the gate that starts the attempt.
      expect(before.status).toBe(302);
      expect(before.headers.get("Location")).toBe(gateUrl);
      expect(await beforePage.text()).not.toContain("<iframe");
      // And the gate leaks neither the content nor the author's stylesheet
      // (whose content: rules could carry answers).
      expect(beforeGate.status).toBe(200);
      expect(beforeGateHtml).not.toContain("Intro prose.");
      expect(beforeGateHtml).not.toContain("maroon");
      expect(beforeGateHtml).not.toContain("styles.example.test");

      await startAttempt(env, student, course.course.id, draft.assignment.id);

      const after = await appRequest(
        createTestApp(),
        documentUrl,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const afterHtml = await after.text();
      const page = await appRequest(
        createTestApp(),
        pageUrl,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );
      const pageHtml = await page.text();

      expect(after.status).toBe(200);
      expect(afterHtml).toContain("Intro prose.");
      // The author stylesheet is a separate style element after the defaults,
      // which the document links rather than carries — so the link is what the
      // author's rules have to come after to win a tie.
      expect(afterHtml).toContain("maroon");
      expect(afterHtml.indexOf("maroon")).toBeGreaterThan(
        afterHtml.indexOf(CONTENT_STYLE_SHEET.href),
      );
      expect(afterHtml).toContain(
        '<link href="https://styles.example.test/theme.css" rel="stylesheet"',
      );
      expect(afterHtml).toContain('name="csrfToken"');
      expect(afterHtml).toContain(CONTENT_SCRIPT_ASSET.href);
      // The page hosts the iframe; the fullscreen link opens the same URL. The
      // frame's copy carries the marker that tells the document its links have
      // our chrome to escape — the fullscreen link's, opening a tab of its own,
      // does not.
      expect(page.status).toBe(200);
      expect(pageHtml).toContain(`src="${documentUrl}?appframe=1"`);
      expect(pageHtml).toContain(`href="${documentUrl}"`);
      expect(pageHtml).toContain('target="_blank"');
    });
  });

  test("a style reset drops the default document styles", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "reset-teacher@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        `:::style{reset}
body { background: black; }
p::after { content: "</style><script>alert(1)</script>"; }
:::

Plain reading prose.`,
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { assessmentMode: "none" },
      );

      await publish(env, instructor, course.course.id, draft.assignment.id);

      const response = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/assignments/${draft.assignment.id}/content`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain("Plain reading prose.");
      expect(html).toContain("background: black;");
      // Reset: no default stylesheet, no font links.
      expect(html).not.toContain(".exercise-prompt");
      expect(html).not.toContain("fonts.googleapis.com");
      // The escaped stylesheet cannot close its own style element.
      expect(html).not.toContain("</style><script>");
      expect(html).toContain("\\3c ");
    });
  });

  test("content documents enforce course access", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "access-teacher@example.test");
      const student = await login(env, "access-student@example.test");
      const outsider = await login(env, "access-outsider@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("access_q", "Access prompt."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, draft.assignment.id);

      const studentUrl = `/courses/${course.course.id}/assignments/${draft.assignment.id}/content`;
      const instructorUrl = `/courses/${course.course.id}/instructor/assignments/${draft.assignment.id}/content`;
      const outsiderResponse = await appRequest(
        createTestApp(),
        studentUrl,
        { headers: { Cookie: outsider.cookieHeader } },
        env,
      );
      const studentOnInstructor = await appRequest(
        createTestApp(),
        instructorUrl,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const unauthenticated = await appRequest(
        createTestApp(),
        studentUrl,
        {},
        env,
      );

      expect(outsiderResponse.status).toBe(403);
      expect(studentOnInstructor.status).toBe(403);
      expect(unauthenticated.status).toBe(302);
      expect(unauthenticated.headers.get("Location")).toContain("/login");
    });
  });
});

describe("the attempt gate", () => {
  test("starting from the gate returns to the content, without chrome", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "gate-teacher@example.test");
      const student = await login(env, "gate-student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("gate_q", "Gate prompt."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { title: "Gated homework" },
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, draft.assignment.id);

      const base = `/courses/${course.course.id}/assignments/${draft.assignment.id}`;
      const gate = await appRequest(
        createTestApp(),
        `${base}/start`,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );
      const gateHtml = await gate.text();
      const started = await appRequest(
        createTestApp(),
        `${base}/start`,
        {
          body: new URLSearchParams({ csrfToken: student.csrfToken }),
          headers: {
            Accept: "text/html",
            Cookie: student.cookieHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        env,
      );
      const afterStart = await appRequest(
        createTestApp(),
        `${base}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const afterStartHtml = await afterStart.text();

      // The gate is the briefing with the navigation taken away: no navbar, no
      // breadcrumb, no footer — nothing inviting a student to leave the one
      // resource their LMS launch named.
      expect(gate.status).toBe(200);
      expect(gateHtml).toContain("Gated homework");
      expect(gateHtml).toContain(`action="${base}/start"`);
      expect(gateHtml).not.toContain("app-header");
      expect(gateHtml).not.toContain("app-footer");
      expect(gateHtml).not.toContain("breadcrumb");
      // Starting comes back to the content, not to the full assignment page,
      // which inside an LMS frame would be our navbar under theirs.
      expect(started.status).toBe(303);
      expect(started.headers.get("Location")).toBe(`${base}/content`);
      expect(afterStart.status).toBe(200);
      expect(afterStartHtml).toContain("Gate prompt.");
    });
  });

  test("the gate stands aside when there is nothing to gate", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "gate2-teacher@example.test");
      const student = await login(env, "gate2-student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("gate2_q", "Reading prompt."),
      );
      const reading = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { assessmentMode: "none", title: "Reading" },
      );
      const graded = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { title: "Graded" },
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, reading.assignment.id);
      await publish(env, instructor, course.course.id, graded.assignment.id);
      await startAttempt(
        env,
        student,
        course.course.id,
        graded.assignment.id,
      );

      const readingBase = `/courses/${course.course.id}/assignments/${reading.assignment.id}`;
      const gradedBase = `/courses/${course.course.id}/assignments/${graded.assignment.id}`;
      const onReading = await appRequest(
        createTestApp(),
        `${readingBase}/start`,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );
      const onOpenAttempt = await appRequest(
        createTestApp(),
        `${gradedBase}/start`,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );

      // An ungraded assignment is interactive on sight, and a graded one with
      // an attempt already open has been through here: both are the content.
      expect(onReading.status).toBe(302);
      expect(onReading.headers.get("Location")).toBe(
        `${readingBase}/content`,
      );
      expect(onOpenAttempt.status).toBe(302);
      expect(onOpenAttempt.headers.get("Location")).toBe(
        `${gradedBase}/content`,
      );
    });
  });
});

describe("a student the instructor has overridden", () => {
  test("the briefing states that student's own allowance, not the assignment's", async () => {
    await withStorage(async (storage, env) => {
      const instructor = await login(env, "over-teacher@example.test");
      const student = await login(env, "over-student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("over_q", "Prompt."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { maxAttempts: 3, timeLimitMinutes: 1, title: "Overridden" },
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, draft.assignment.id);
      await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/assignments/${draft.assignment.id}/overrides`,
        jsonRequest({ maxAttempts: 1, userId: student.actorId }, instructor),
        env,
      );
      await startAttempt(env, student, course.course.id, draft.assignment.id);
      // Time the attempt out, as the clock would have. The next request the
      // student makes reaps it, leaving one used attempt and none open — which
      // is one more than this student is allowed.
      await storage.db
        .prepare("UPDATE attempts SET expires_at = ? WHERE assignment_id = ?")
        .bind("2020-01-01T00:00:00.000Z", draft.assignment.id)
        .run();

      const base = `/courses/${course.course.id}/assignments/${draft.assignment.id}`;
      const page = await appRequest(
        createTestApp(),
        base,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );
      const html = await page.text();
      const denied = await appRequest(
        createTestApp(),
        `${base}/attempts`,
        {
          headers: {
            Cookie: student.cookieHeader,
            "X-CSRF-Token": student.csrfToken,
          },
          method: "POST",
        },
        env,
      );

      expect(page.status).toBe(200);
      // The allowance the student is held to, counted against, rather than the
      // assignment's own 3 — which they would have compared against nothing.
      expect(html).toContain("<dt>Attempts</dt><dd>1 of 1</dd>");
      expect(html).not.toContain("of 3");
      // And no button that cannot work: the server would refuse it, so the
      // page says what the refusal would have said.
      expect(html).not.toContain("Start attempt");
      expect(html).toContain("You have used all of your attempts");
      expect(denied.status).toBe(403);
    });
  });
});

describe("item link resolution", () => {
  test("item links land on the course assignment for each role", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "link-teacher@example.test");
      const student = await login(env, "link-student@example.test");
      const course = await createCourse(env, instructor);
      const target = await createContentItem(env, instructor);
      const targetRevision = await createRevisionForItem(
        env,
        instructor,
        target.item.id,
        "Chapter 2 prose.",
      );
      const linkingRevision = await createRevision(
        env,
        instructor,
        `Continue with [Chapter 2](item:${target.item.id}).`,
      );
      const targetDraft = await createDraft(
        env,
        instructor,
        course.course.id,
        targetRevision.revision.id,
        { assessmentMode: "none", title: "Chapter 2" },
      );
      const linkingDraft = await createDraft(
        env,
        instructor,
        course.course.id,
        linkingRevision.revision.id,
        { assessmentMode: "none", title: "Chapter 1" },
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(
        env,
        instructor,
        course.course.id,
        targetDraft.assignment.id,
      );
      await publish(
        env,
        instructor,
        course.course.id,
        linkingDraft.assignment.id,
      );

      const documentResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${linkingDraft.assignment.id}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const documentHtml = await documentResponse.text();

      // The compiled link is course-agnostic; the document URL supplies the
      // course when the browser resolves it to /courses/:courseId/go/:itemId.
      expect(documentHtml).toContain(
        `<a href="../../go/${target.item.id}">Chapter 2</a>`,
      );
      // Fetched as itself rather than as our frame's body, so a followed link
      // navigates in place — see the frame marker below.
      expect(documentHtml).not.toContain("<base");

      const studentGo = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/go/${target.item.id}`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const instructorGo = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/go/${target.item.id}`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const linkingDocumentUrl = `http://localhost/courses/${course.course.id}/assignments/${linkingDraft.assignment.id}/content`;
      const fromStandalone = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/go/${target.item.id}`,
        {
          headers: {
            Cookie: student.cookieHeader,
            Referer: linkingDocumentUrl,
          },
        },
        env,
      );
      const fromOurFrame = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/go/${target.item.id}`,
        {
          headers: {
            Cookie: student.cookieHeader,
            Referer: `${linkingDocumentUrl}?appframe=1`,
          },
        },
        env,
      );
      const unauthenticated = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/go/${target.item.id}`,
        {},
        env,
      );

      expect(studentGo.status).toBe(302);
      expect(studentGo.headers.get("Location")).toBe(
        `/courses/${course.course.id}/assignments/${targetDraft.assignment.id}`,
      );
      // Followed from a document standing on its own — a fullscreen tab, or a
      // lesson framed by an LMS — the next item is the next document: there is
      // no page around this one to go back to.
      expect(fromStandalone.headers.get("Location")).toBe(
        `/courses/${course.course.id}/assignments/${targetDraft.assignment.id}/content`,
      );
      // Followed from a document inside one of our frames, the link is on its
      // way out to `_top`, which is the page the reader is already looking at.
      expect(fromOurFrame.headers.get("Location")).toBe(
        `/courses/${course.course.id}/assignments/${targetDraft.assignment.id}`,
      );
      expect(instructorGo.status).toBe(302);
      expect(instructorGo.headers.get("Location")).toBe(
        `/courses/${course.course.id}/instructor/assignments/${targetDraft.assignment.id}`,
      );
      expect(unauthenticated.status).toBe(302);
      expect(unauthenticated.headers.get("Location")).toContain("/login");
    });
  });

  test("unpublished items resolve for staff and 404 kindly for students", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "draft-link-teacher@example.test");
      const student = await login(env, "draft-link-student@example.test");
      const course = await createCourse(env, instructor);
      const target = await createContentItem(env, instructor);
      const targetRevision = await createRevisionForItem(
        env,
        instructor,
        target.item.id,
        "Draft chapter prose.",
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        targetRevision.revision.id,
      );

      await enrollStudent(env, instructor, student, course.course.id);

      const studentGo = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/go/${target.item.id}`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const studentHtml = await studentGo.text();
      const instructorGo = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/go/${target.item.id}`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const missingGo = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/go/not-a-real-item`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );

      // A draft is invisible to students: a friendly page, not a JSON envelope.
      expect(studentGo.status).toBe(404);
      expect(studentHtml).toContain("not available in this course");
      expect(instructorGo.status).toBe(302);
      expect(instructorGo.headers.get("Location")).toBe(
        `/courses/${course.course.id}/instructor/assignments/${draft.assignment.id}`,
      );
      expect(missingGo.status).toBe(404);
    });
  });

  test("the library go route redirects to the item page", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "library-link@example.test");
      const item = await createContentItem(env, author);
      const response = await appRequest(
        createTestApp(),
        `/content/go/${item.item.id}`,
        { headers: { Cookie: author.cookieHeader } },
        env,
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(
        `/content/${item.item.id}`,
      );
    });
  });
});

async function unpublish(
  env: Env,
  actor: LoginResult,
  courseId: string,
  assignmentId: string,
): Promise<Response> {
  return appRequest(
    createTestApp(),
    `/courses/${courseId}/instructor/assignments/${assignmentId}/unpublish`,
    {
      headers: {
        Cookie: actor.cookieHeader,
        "X-CSRF-Token": actor.csrfToken,
      },
      method: "POST",
    },
    env,
  );
}

describe("assignment unpublish", () => {
  test("an instructor can unpublish a published assignment with no attempts", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "teacher@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("q1", "Choose yes."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );
      await publish(env, instructor, course.course.id, draft.assignment.id);

      const response = await unpublish(
        env,
        instructor,
        course.course.id,
        draft.assignment.id,
      );
      const body = (await response.json()) as AssignmentResponse;

      expect(response.status).toBe(200);
      expect(body.assignment.state).toBe("draft");
    });
  });

  test("unpublish is blocked once a student has an attempt", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "teacher@example.test");
      const student = await login(env, "student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("q1", "Choose yes."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );
      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, draft.assignment.id);
      await startAttempt(env, student, course.course.id, draft.assignment.id);

      const response = await unpublish(
        env,
        instructor,
        course.course.id,
        draft.assignment.id,
      );
      const body = (await response.json()) as {
        readonly error: { readonly code: string };
      };

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("assignment_has_attempts");
    });
  });

  test("unpublishing a draft assignment is rejected", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "teacher@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("q1", "Choose yes."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );

      const response = await unpublish(
        env,
        instructor,
        course.course.id,
        draft.assignment.id,
      );
      const body = (await response.json()) as {
        readonly error: { readonly code: string };
      };

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("assignment_not_published");
    });
  });

  test("a non-instructor cannot unpublish an assignment", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "teacher@example.test");
      const student = await login(env, "student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("q1", "Choose yes."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );
      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, draft.assignment.id);

      const response = await unpublish(
        env,
        student,
        course.course.id,
        draft.assignment.id,
      );

      expect(response.status).toBe(403);
    });
  });
});

async function deleteDraft(
  env: Env,
  actor: LoginResult,
  courseId: string,
  assignmentId: string,
): Promise<Response> {
  return appRequest(
    createTestApp(),
    `/courses/${courseId}/instructor/assignments/${assignmentId}/delete`,
    {
      headers: {
        Cookie: actor.cookieHeader,
        "X-CSRF-Token": actor.csrfToken,
      },
      method: "POST",
    },
    env,
  );
}

describe("assignment delete", () => {
  test("an instructor can delete a draft assignment", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "teacher@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("q1", "Choose yes."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );

      const response = await deleteDraft(
        env,
        instructor,
        course.course.id,
        draft.assignment.id,
      );
      const body = (await response.json()) as { readonly deleted: boolean };

      expect(response.status).toBe(200);
      expect(body.deleted).toBe(true);

      // The draft is gone: a second delete finds nothing.
      const again = await deleteDraft(
        env,
        instructor,
        course.course.id,
        draft.assignment.id,
      );
      expect(again.status).toBe(404);
    });
  });

  test("deleting a published assignment is rejected", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "teacher@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("q1", "Choose yes."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );
      await publish(env, instructor, course.course.id, draft.assignment.id);

      const response = await deleteDraft(
        env,
        instructor,
        course.course.id,
        draft.assignment.id,
      );
      const body = (await response.json()) as {
        readonly error: { readonly code: string };
      };

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("assignment_not_draft");
    });
  });

  test("a non-instructor cannot delete a draft assignment", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "teacher@example.test");
      const student = await login(env, "student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("q1", "Choose yes."),
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );
      await enrollStudent(env, instructor, student, course.course.id);

      const response = await deleteDraft(
        env,
        student,
        course.course.id,
        draft.assignment.id,
      );

      expect(response.status).toBe(403);
    });
  });
});

/**
 * The failure task #182 was filed about: a revision whose `compiled` column is
 * not an artifact. Written with raw SQL because that is how it happens — the
 * original was a hand-inserted row holding `{"blocks":[],"exercises":[]}`, and
 * nothing that goes through the compiler can produce it.
 */
async function corruptArtifact(
  storage: TestStorage,
  revisionId: string,
  compiled: unknown = { blocks: [] },
): Promise<void> {
  await storage.db
    .prepare("UPDATE content_revisions SET compiled_json = ? WHERE id = ?")
    .bind(JSON.stringify(compiled), revisionId)
    .run();
}

describe("an assignment whose content cannot be read", () => {
  test("the instructor keeps the page that can repair it", async () => {
    await withStorage(async (storage, env) => {
      const instructor = await login(env, "unreadable-teacher@example.test");
      const course = await createCourse(env, instructor);
      const item = await createContentItem(env, instructor);
      const revision = await createRevisionForItem(
        env,
        instructor,
        item.item.id,
        "A lesson that will stop compiling to anything.",
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );

      await publish(env, instructor, course.course.id, draft.assignment.id);
      await corruptArtifact(storage, revision.revision.id);

      const base = `/courses/${course.course.id}/instructor/assignments/${draft.assignment.id}`;
      const page = await appRequest(
        createTestApp(),
        base,
        { headers: { Accept: "text/html", Cookie: instructor.cookieHeader } },
        env,
      );
      const html = await page.text();

      expect(page.status).toBe(200);
      // The record, and the diagnosis where the content would have been.
      expect(html).toContain("Assignment record");
      expect(html).toContain("This content could not be read");
      expect(html).toContain(revision.revision.id);
      expect(html).toContain("`document.nodes`");
      // And the way out: the correction form, which is the entire reason this
      // page degrades rather than failing.
      expect(html).toContain(`${base}/content-revision`);
      // No frame, because an empty document would read as "this lesson is
      // blank" rather than "this lesson is broken".
      expect(html).not.toContain(`src="${base}/content?`);
    });
  });

  test("everything that is not that page still fails, and says why", async () => {
    await withStorage(async (storage, env) => {
      const instructor = await login(env, "unreadable-strict@example.test");
      const student = await login(env, "unreadable-student@example.test");
      const course = await createCourse(env, instructor);
      const item = await createContentItem(env, instructor);
      const revision = await createRevisionForItem(
        env,
        instructor,
        item.item.id,
        "A lesson that will stop compiling to anything.",
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
      );

      await publish(env, instructor, course.course.id, draft.assignment.id);
      await enrollStudent(env, instructor, student, course.course.id);
      await corruptArtifact(storage, revision.revision.id);

      const base = `/courses/${course.course.id}`;
      const instructorJson = await appRequest(
        createTestApp(),
        `${base}/instructor/assignments/${draft.assignment.id}`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const instructorContent = await appRequest(
        createTestApp(),
        `${base}/instructor/assignments/${draft.assignment.id}/content`,
        { headers: { Accept: "text/html", Cookie: instructor.cookieHeader } },
        env,
      );
      const studentPage = await appRequest(
        createTestApp(),
        `${base}/assignments/${draft.assignment.id}`,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );
      const envelope = (await instructorJson.json()) as {
        readonly error: { readonly code: string; readonly message: string };
      };

      expect(instructorJson.status).toBe(500);
      expect(envelope.error.code).toBe("invalid_content_artifact");
      // The revision id in the English message is what makes a log line or a
      // bug report point at a row somebody can fix.
      expect(envelope.error.message).toContain(revision.revision.id);
      // A student is shown prose, and no identifiers.
      expect(studentPage.status).toBe(500);
      expect(await studentPage.text()).not.toContain(revision.revision.id);
      // The bare content document has no repair control on it, so degrading
      // there would only serve a blank page that looks deliberate.
      expect(instructorContent.status).toBe(500);
    });
  });

  test("the correction picker will not offer the revision that broke it", async () => {
    await withStorage(async (storage, env) => {
      const instructor = await login(env, "unreadable-picker@example.test");
      const course = await createCourse(env, instructor);
      const item = await createContentItem(env, instructor);
      const good = await createRevisionForItem(
        env,
        instructor,
        item.item.id,
        "The revision that still reads.",
      );
      const bad = await createRevisionForItem(
        env,
        instructor,
        item.item.id,
        "The revision that will not.",
      );
      const draft = await createDraft(
        env,
        instructor,
        course.course.id,
        good.revision.id,
      );

      await publish(env, instructor, course.course.id, draft.assignment.id);
      await corruptArtifact(storage, bad.revision.id);

      const page = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/assignments/${draft.assignment.id}`,
        { headers: { Accept: "text/html", Cookie: instructor.cookieHeader } },
        env,
      );
      const html = await page.text();
      const options = [...html.matchAll(/<option[^>]*>/g)].map((m) => m[0]);
      const badOption = options.find((tag) => tag.includes(bad.revision.id));
      const goodOption = options.find((tag) =>
        tag.includes(good.revision.id),
      );

      expect(page.status).toBe(200);
      // Still listed — a revision that vanishes from the picker reads as one
      // that was never saved — but not selectable, and said in words.
      expect(badOption).toContain("disabled");
      expect(goodOption).not.toContain("disabled");
      expect(html).toContain("cannot be read");
    });
  });
});

describe("grade visibility", () => {
  test("an author says when grades appear, and never has to guess", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "visibility-teacher@example.test");
      const student = await login(env, "visibility-student@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("q_visibility", "Choose yes."),
      );
      const open = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { gradesVisibility: "immediate", title: "Homework, open" },
      );
      const held = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { gradesVisibility: "manual", title: "Exam, held" },
      );
      const timed = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        {
          gradesVisibleAt: "2030-01-01T00:00:00.000Z",
          gradesVisibility: "scheduled",
          title: "Quiz, timed",
        },
      );

      expect(open.assignment.gradesVisibleAt).not.toBeNull();
      expect(held.assignment.gradesVisibleAt).toBeNull();
      expect(timed.assignment.gradesVisibleAt).toBe(
        "2030-01-01T00:00:00.000Z",
      );

      await enrollStudent(env, instructor, student, course.course.id);
      await publish(env, instructor, course.course.id, open.assignment.id);
      await publish(env, instructor, course.course.id, held.assignment.id);

      // The point of the whole control: the student can see how they did on the
      // open one without the instructor going back to release anything.
      const score = async (assignmentId: string) =>
        appRequest(
          createTestApp(),
          `/courses/${course.course.id}/assignments/${assignmentId}/score`,
          { headers: { Cookie: student.cookieHeader } },
          env,
        );

      expect((await score(open.assignment.id)).status).toBe(200);
      expect((await score(held.assignment.id)).status).toBe(403);
    });
  });

  test("releasing on an open assignment says what that does", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "warn-teacher@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("q_warn", "Choose yes."),
      );
      const open = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { gradesVisibility: "manual", title: "Exam, still open" },
      );
      const closed = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        {
          availableUntil: "2026-01-01T00:00:00.000Z",
          gradesVisibility: "manual",
          title: "Exam, closed",
        },
      );

      await publish(env, instructor, course.course.id, open.assignment.id);
      await publish(env, instructor, course.course.id, closed.assignment.id);

      const page = async (assignmentId: string): Promise<string> =>
        (
          await appRequest(
            createTestApp(),
            `/courses/${course.course.id}/instructor/assignments/${assignmentId}`,
            {
              headers: {
                Accept: "text/html",
                Cookie: instructor.cookieHeader,
              },
            },
            env,
          )
        ).text();

      // Releasing is also the moment the assignment stops being an exam, so
      // anyone still working gets an easier run at it than the ones who sat it.
      expect(await page(open.assignment.id)).toContain(
        "Submissions are still open",
      );
      // Nobody can submit, so there is nothing to warn about.
      expect(await page(closed.assignment.id)).not.toContain(
        "Submissions are still open",
      );
    });
  });

  test("scheduling grades with no time to schedule is refused", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "unscheduled-teacher@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("q_unscheduled", "Choose yes."),
      );
      const response = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments`,
        jsonRequest(
          {
            contentRevisionId: revision.revision.id,
            gradesVisibility: "scheduled",
            title: "Quiz with no date",
          },
          instructor,
        ),
        env,
      );

      expect(response.status).toBe(400);
      expect((await response.json()) as unknown).toMatchObject({
        error: { code: "invalid_assignment_grades_visibility" },
      });
    });
  });

  test("a bare timestamp still means what it always meant", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "legacy-teacher@example.test");
      const course = await createCourse(env, instructor);
      const revision = await createRevision(
        env,
        instructor,
        source("q_legacy", "Choose yes."),
      );
      // No `gradesVisibility` at all: the shape every API caller has sent since
      // before the choice existed, where the timestamp — or its absence — is the
      // whole answer.
      const scheduled = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { gradesVisibleAt: "2031-05-05T00:00:00.000Z" },
      );
      const silent = await createDraft(
        env,
        instructor,
        course.course.id,
        revision.revision.id,
        { title: "Homework 2" },
      );

      expect(scheduled.assignment.gradesVisibleAt).toBe(
        "2031-05-05T00:00:00.000Z",
      );
      expect(silent.assignment.gradesVisibleAt).toBeNull();
    });
  });

  test("the form asks the question, and preselects the open answer", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "form-visibility@example.test");
      const course = await createCourse(env, instructor);
      await createRevision(
        env,
        instructor,
        source("q_form_visibility", "Choose yes."),
      );

      const page = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/assignments/new`,
        { headers: { Accept: "text/html", Cookie: instructor.cookieHeader } },
        env,
      );
      const html = await page.text();
      const select = html.match(
        /<select[^>]*name="gradesVisibility"[\s\S]*?<\/select>/,
      )?.[0];

      expect(page.status).toBe(200);
      expect(select).toBeDefined();
      expect(select).toContain("As soon as work is checked");
      expect(select).toContain("When I release them");
      // Selected, and only it: an unattended form must not produce grades that
      // never appear.
      expect(select).toMatch(
        /<option selected="" value="immediate">|<option selected value="immediate">/,
      );
      expect((select ?? "").match(/selected/g)?.length).toBe(1);
    });
  });

  test("quick create takes the same default the form shows", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "quick-visibility@example.test");
      const course = await createCourse(env, instructor);
      await createRevision(
        env,
        instructor,
        source("q_quick_visibility", "Choose yes."),
      );

      const created = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments`,
        {
          body: new URLSearchParams({
            csrfToken: instructor.csrfToken,
            quickCreate: "1",
            title: "Quick homework",
          }),
          headers: {
            Accept: "text/html",
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        env,
      );
      const assignmentId =
        (created.headers.get("Location") ?? "").match(
          /assignments\/([^/?]+)/,
        )?.[1] ?? "";
      const detail = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/assignments/${assignmentId}`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );

      expect(created.status).toBe(303);
      expect(
        ((await detail.json()) as AssignmentResponse).assignment
          .gradesVisibleAt,
      ).not.toBeNull();
    });
  });
});
