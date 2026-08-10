import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { Env } from "../src/worker/env";
import { CONTENT_SCRIPT_ASSET } from "../src/worker/web/script-assets";
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

interface AttemptJson {
  readonly expiresAt: string | null;
  readonly id: string;
  readonly openedAt: string;
  readonly ordinal: number;
  readonly status: string;
  readonly voidedAt: string | null;
}

interface BeginAttemptResponse {
  readonly attempt: AttemptJson;
}

interface AttemptListResponse {
  readonly attempts: readonly AttemptJson[];
}

interface ResetAttemptResponse {
  readonly newAttempt: AttemptJson;
  readonly voidedAttempt: AttemptJson;
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

async function createCourse(
  env: Env,
  instructor: LoginResult,
): Promise<string> {
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

async function createRevision(
  env: Env,
  author: LoginResult,
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
    jsonRequest(
      {
        sourceText: `# Lesson

::::multiple-choice{#q1 points="1"}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::`,
      },
      author,
    ),
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
): Promise<string> {
  const draftResponse = await appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments`,
    jsonRequest(
      {
        contentRevisionId: revisionId,
        description: "Attempt policy practice.",
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

  return draft.assignment.id;
}

async function beginAttempt(
  env: Env,
  student: LoginResult,
  courseId: string,
  assignmentId: string,
): Promise<Response> {
  return appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments/${assignmentId}/attempts`,
    {
      headers: authHeaders(student),
      method: "POST",
    },
    env,
  );
}

describe("attempt policy", () => {
  test("routes enforce availability, expiry, and reset", async () => {
    await withStorage(async ({ db }, env) => {
      const instructor = await login(env, "attempt-teacher@example.test");
      const student = await login(env, "attempt-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const future = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { availableFrom: "2999-01-01T00:00:00.000Z" },
      );
      const closed = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { availableUntil: "2000-01-01T00:00:00.000Z" },
      );
      const timed = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        { maxAttempts: 1, timeLimitMinutes: 5 },
      );
      const resettable = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );

      const futureResponse = await beginAttempt(
        env,
        student,
        courseId,
        future,
      );
      const closedResponse = await beginAttempt(
        env,
        student,
        courseId,
        closed,
      );
      const timedBeginResponse = await beginAttempt(
        env,
        student,
        courseId,
        timed,
      );
      const timedBegin =
        (await timedBeginResponse.json()) as BeginAttemptResponse;

      expect(futureResponse.status).toBe(403);
      expect(closedResponse.status).toBe(403);
      expect(timedBeginResponse.status).toBe(201);
      expect(timedBegin.attempt.status).toBe("active");
      expect(timedBegin.attempt.ordinal).toBe(1);
      expect(timedBegin.attempt.expiresAt).not.toBeNull();
      expect(timedBegin.attempt.expiresAt).not.toBe(
        timedBegin.attempt.openedAt,
      );

      await db
        .prepare("UPDATE attempts SET expires_at = ? WHERE id = ?")
        .bind("2000-01-01T00:00:00.000Z", timedBegin.attempt.id)
        .run();

      const timedListResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${timed}/attempts`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const timedList =
        (await timedListResponse.json()) as AttemptListResponse;
      const secondTimedBeginResponse = await beginAttempt(
        env,
        student,
        courseId,
        timed,
      );

      expect(timedList.attempts).toHaveLength(1);
      expect(timedList.attempts[0]?.status).toBe("expired");
      expect(secondTimedBeginResponse.status).toBe(403);

      const resetBeginResponse = await beginAttempt(
        env,
        student,
        courseId,
        resettable,
      );
      const resetBegin =
        (await resetBeginResponse.json()) as BeginAttemptResponse;
      const resetResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${resettable}` +
          `/attempts/${resetBegin.attempt.id}/reset`,
        {
          headers: authHeaders(instructor),
          method: "POST",
        },
        env,
      );
      const reset = (await resetResponse.json()) as ResetAttemptResponse;
      const resetListResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${resettable}/attempts`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const resetList =
        (await resetListResponse.json()) as AttemptListResponse;

      expect(resetResponse.status).toBe(200);
      expect(reset.voidedAttempt.status).toBe("voided");
      expect(reset.voidedAttempt.voidedAt).not.toBeNull();
      expect(reset.newAttempt.status).toBe("active");
      expect(reset.newAttempt.ordinal).toBe(2);
      expect(resetList.attempts.map((attempt) => attempt.status)).toEqual([
        "voided",
        "active",
      ]);
      expect(resetList.attempts.map((attempt) => attempt.ordinal)).toEqual([
        1, 2,
      ]);
    });
  });
});

describe("exercise component pipeline", () => {
  test("the interactive content document wires up the custom-element loader and form", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "pipeline-teacher@example.test");
      const student = await login(env, "pipeline-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );

      // An open attempt is what flips the content document from read-only to
      // the submittable (enhanced) render.
      const beginResponse = await beginAttempt(
        env,
        student,
        courseId,
        assignmentId,
      );

      expect(beginResponse.status).toBe(201);

      const documentResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignmentId}/content`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const html = await documentResponse.text();

      expect(documentResponse.status).toBe(200);
      // The asset list the loader reads, and the multiple-choice bundle in it.
      expect(html).toContain("data-carnap-component-assets");
      expect(html).toContain("carnap-multiple-choice-v1");
      // The linked script carrying the loader that module-loads each listed
      // bundle; that it reaches for /assets/components/ is asserted where the
      // script itself is, in script-assets.test.ts.
      expect(html).toContain(CONTENT_SCRIPT_ASSET.href);
      // The enhanced form: the custom-element tag plus the hidden field the
      // element mirrors its answer into for the submission runtime.
      expect(html).toContain("<carnap-multiple-choice");
      expect(html).toContain('name="answerData"');
      // Each form carries its own payload (with the student's prior answer), so
      // the document-scoped preview table would be redundant here.
      expect(html).not.toContain("data-exercise-hydration-map");
    });
  });

  test("the instructor preview document hydrates its exercises without a submit path", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "preview-teacher@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);
      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );

      const documentResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignmentId}/content`,
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const html = await documentResponse.text();

      expect(documentResponse.status).toBe(200);
      // An exercise is inert markup until its element upgrades, so the preview
      // needs the bundles just as much as the student view does.
      expect(html).toContain("data-carnap-component-assets");
      expect(html).toContain("carnap-multiple-choice-v1");
      expect(html).toContain(CONTENT_SCRIPT_ASSET.href);
      // …and the document hydration table that stands in for the forms the
      // preview does not have, keyed by exercise id.
      expect(html).toContain("data-exercise-hydration-map");
      expect(html).toContain('{"q1":{"mode":"answer"');
      expect(html).toContain('"promptHtml"');
      // Preview, not attempt: nothing to submit and nothing recorded.
      expect(html).not.toContain('class="exercise"');
      expect(html).not.toContain('name="answerData"');
    });
  });
});
