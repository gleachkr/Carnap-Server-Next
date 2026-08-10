import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { generateKeyPair, jwtVerify } from "jose";

import type { AuthenticatedActor } from "../src/worker/application/auth";
import { GradePassbackService } from "../src/worker/application/grade-passback";
import type { AppStores } from "../src/worker/application/stores";
import type { AuthSession } from "../src/worker/domain/auth";
import type { LtiPlatform } from "../src/worker/domain/lti";
import type { User } from "../src/worker/domain/users";
import type { Env } from "../src/worker/env";
import { AgsClient } from "../src/worker/infrastructure/lti/ags-client";
import type { LtiToolKey } from "../src/worker/infrastructure/lti/tool-key";
import { grantTestCourseCreator } from "./helpers/admin";
import { appRequest, createTestApp } from "./helpers/app";
import { registerTestPlatform, TEST_ISSUER } from "./helpers/lti";
import { createTestStorage, type TestStorage } from "./helpers/storage";

setDefaultTimeout(30_000);

const NOW = "2026-01-02T03:04:05.000Z";
const LINE_ITEM_URL = `${TEST_ISSUER}/line-items/42?type_id=7`;
const AGS_SCORE_SCOPE = "https://purl.imsglobal.org/spec/lti-ags/scope/score";

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
  const body = (await response.json()) as { course: { id: string } };

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
  const link = (await linkResponse.json()) as {
    enrollmentLink: { enrollmentPath: string };
  };
  const enrollResponse = await appRequest(
    createTestApp(),
    link.enrollmentLink.enrollmentPath,
    { headers: authHeaders(student), method: "POST" },
    env,
  );

  expect(enrollResponse.status).toBe(200);
}

async function createRevision(env: Env, author: LoginResult) {
  const itemResponse = await appRequest(
    createTestApp(),
    "/content",
    jsonRequest({ title: "Lesson" }, author),
    env,
  );
  const item = (await itemResponse.json()) as { item: { id: string } };
  const revisionResponse = await appRequest(
    createTestApp(),
    `/content/${item.item.id}/revisions`,
    jsonRequest(
      {
        sourceText: `# Lesson

::::multiple-choice{#q1 points="2"}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::`,
      },
      author,
    ),
    env,
  );
  const revision = (await revisionResponse.json()) as {
    revision: { id: string };
  };

  expect(revisionResponse.status).toBe(201);

  return revision.revision.id;
}

async function createPublishedAssignment(
  env: Env,
  instructor: LoginResult,
  courseId: string,
  revisionId: string,
  // Passback only delivers released grades, so the fixture releases them
  // from the start; the release-gating test overrides this.
  gradesVisibleAt: string | null = "2026-01-01T00:00:00.000Z",
) {
  const draftResponse = await appRequest(
    createTestApp(),
    `/courses/${courseId}/assignments`,
    jsonRequest(
      {
        contentRevisionId: revisionId,
        description: "Grade passback practice.",
        ...(gradesVisibleAt === null ? {} : { gradesVisibleAt }),
        title: "Homework",
      },
      instructor,
    ),
    env,
  );
  const draft = (await draftResponse.json()) as {
    assignment: { id: string };
  };

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
  const body = (await response.json()) as { attempt: { id: string } };

  expect(response.status).toBe(201);

  return body.attempt.id;
}

async function submitCorrectAnswer(
  env: Env,
  student: LoginResult,
  courseId: string,
  assignmentId: string,
  attemptId: string,
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
        exerciseId: "q1",
      },
      student,
    ),
    env,
  );

  expect([200, 201]).toContain(response.status);
}

/**
 * The LMS-side LTI fixture: registered platform and deployment, a context
 * mapped to the course, and one resource link carrying an AGS line item.
 */
async function ltiFixture(
  stores: AppStores,
  courseId: string,
  options: { readonly assignmentId?: string } = {},
) {
  const { deployment, platform } = await registerTestPlatform(stores);
  const context = await stores.lti.createContext({
    id: "lti-context-1",
    deploymentId: deployment.id,
    contextId: "lms-course-1",
    courseId,
    createdAt: NOW,
  });
  const link = await stores.lti.upsertResourceLink({
    id: "lti-resource-link-1",
    contextId: context.id,
    resourceLinkId: "lms-activity-1",
    title: "Homework (LMS)",
    agsLineItemUrl: LINE_ITEM_URL,
    now: NOW,
  });

  if (options.assignmentId !== undefined) {
    await stores.lti.setResourceLinkAssignment(
      link.id,
      options.assignmentId,
      NOW,
    );
  }

  return { context, deployment, link, platform };
}

async function linkStudentToLms(
  stores: AppStores,
  platform: LtiPlatform,
  userId: string,
  sub: string,
): Promise<void> {
  await stores.users.createExternalIdentity({
    id: `identity-${sub}`,
    userId,
    provider: "lti",
    providerSubject: `${platform.id}:${sub}`,
    createdAt: NOW,
  });
}

interface RecordedRequest {
  readonly url: string;
  readonly body: string;
  readonly headers: Record<string, string>;
}

/**
 * A fake LMS: answers the OAuth token endpoint and the AGS scores endpoint,
 * recording every request. `scoreStatus` can be swapped mid-test to simulate
 * outages and rejections.
 */
function fakeLms(): {
  readonly fetcher: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  readonly requests: RecordedRequest[];
  readonly scoreRequests: () => RecordedRequest[];
  readonly tokenRequests: () => RecordedRequest[];
  scoreStatus: number;
} {
  const requests: RecordedRequest[] = [];
  const lms = {
    fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers: Record<string, string> = {};

      for (const [key, value] of new Headers(init?.headers).entries()) {
        headers[key] = value;
      }

      requests.push({ body: String(init?.body ?? ""), headers, url });

      if (url === `${TEST_ISSUER}/token`) {
        return Response.json({
          access_token: "lms-access-token-1",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }

      return new Response(lms.scoreStatus >= 400 ? "nope" : null, {
        status: lms.scoreStatus,
      });
    },
    requests,
    scoreRequests: () =>
      requests.filter((request) => !request.url.endsWith("/token")),
    scoreStatus: 200,
    tokenRequests: () =>
      requests.filter((request) => request.url.endsWith("/token")),
  };

  return lms;
}

interface TestToolKey {
  readonly publicKey: CryptoKey;
  readonly toolKey: LtiToolKey;
}

let cachedToolKey: Promise<TestToolKey> | null = null;

function testToolKey(): Promise<TestToolKey> {
  cachedToolKey ??= (async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });

    return {
      publicKey: pair.publicKey,
      toolKey: { alg: "RS256", key: pair.privateKey, kid: "tool-key-1" },
    };
  })();

  return cachedToolKey;
}

async function passbackService(
  stores: AppStores,
  lms: ReturnType<typeof fakeLms>,
  now?: () => Date,
): Promise<GradePassbackService> {
  const { toolKey } = await testToolKey();
  const senderOptions: ConstructorParameters<typeof AgsClient>[0] = {
    fetcher: lms.fetcher,
    toolKey,
    ...(now === undefined ? {} : { now }),
  };
  const options: ConstructorParameters<typeof GradePassbackService>[0] = {
    sender: new AgsClient(senderOptions),
    stores,
    ...(now === undefined ? {} : { now }),
  };

  return new GradePassbackService(options);
}

function actorFor(user: User): AuthenticatedActor {
  const session: AuthSession = {
    tokenHash: "test-session-hash",
    userId: user.id,
    csrfTokenHash: "test-csrf-hash",
    createdAt: NOW,
    expiresAt: "2999-01-01T00:00:00.000Z",
    revokedAt: null,
    lastSeenAt: null,
  };

  return { capabilities: [], isCourseStaff: false, session, user };
}

describe("LTI grade passback", () => {
  test("a graded submission queues a delivery and the processor sends it", async () => {
    await withStorage(async ({ stores }, env) => {
      const instructor = await login(env, "ags-teacher@example.test");
      const linked = await login(env, "ags-linked@example.test");
      const unlinked = await login(env, "ags-unlinked@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, linked, courseId);
      await enrollStudent(env, instructor, unlinked, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const { platform } = await ltiFixture(stores, courseId, {
        assignmentId,
      });

      await linkStudentToLms(stores, platform, linked.actorId, "sub-linked");

      for (const student of [linked, unlinked]) {
        const attemptId = await beginAttempt(
          env,
          student,
          courseId,
          assignmentId,
        );

        await submitCorrectAnswer(
          env,
          student,
          courseId,
          assignmentId,
          attemptId,
        );
      }

      // Only the LMS-linked student has a gradebook row the platform could
      // accept, so exactly one job is queued.
      const pending = await stores.lti.listGradeJobsForCourse(
        courseId,
        "pending",
      );

      expect(pending).toHaveLength(1);
      expect(pending[0]?.userId).toBe(linked.actorId);
      expect(pending[0]?.score).toBe(2);
      expect(pending[0]?.maxScore).toBe(2);

      const lms = fakeLms();
      const service = await passbackService(stores, lms);
      const summary = await service.processDueJobs();

      expect(summary).toMatchObject({ claimed: 1, sent: 1 });

      // The token request carries a verifiable client assertion.
      const tokenRequest = lms.tokenRequests()[0];

      if (tokenRequest === undefined) {
        throw new Error("Expected a token endpoint request.");
      }

      const tokenBody = new URLSearchParams(tokenRequest.body);

      expect(tokenBody.get("grant_type")).toBe("client_credentials");
      expect(tokenBody.get("scope")).toContain(AGS_SCORE_SCOPE);

      const assertion = tokenBody.get("client_assertion") ?? "";
      const { publicKey } = await testToolKey();
      const verified = await jwtVerify(assertion, publicKey, {
        audience: platform.tokenEndpoint,
        issuer: platform.clientId,
      });

      expect(verified.payload.sub).toBe(platform.clientId);

      // The score lands at {lineitem}/scores with the query preserved, keyed
      // by the student's LTI subject.
      const scoreRequest = lms.scoreRequests()[0];

      if (scoreRequest === undefined) {
        throw new Error("Expected a scores endpoint request.");
      }

      expect(scoreRequest.url).toBe(
        `${TEST_ISSUER}/line-items/42/scores?type_id=7`,
      );
      expect(scoreRequest.headers.authorization).toBe(
        "Bearer lms-access-token-1",
      );
      expect(scoreRequest.headers["content-type"]).toBe(
        "application/vnd.ims.lis.v1.score+json",
      );

      const scoreBody = JSON.parse(scoreRequest.body) as Record<
        string,
        unknown
      >;

      expect(scoreBody.userId).toBe("sub-linked");
      expect(scoreBody.scoreGiven).toBe(2);
      expect(scoreBody.scoreMaximum).toBe(2);
      expect(scoreBody.gradingProgress).toBe("FullyGraded");
      expect(scoreBody.timestamp).toBe(pending[0]?.scoreTimestamp);

      const [job] = await stores.lti.listGradeJobsForCourse(
        courseId,
        "complete",
      );

      expect(job?.id).toBe(pending[0]?.id);

      // A gradebook view recomputes scores; an unchanged score must not
      // re-queue a send.
      const gradebookResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/gradebook`,
        {
          headers: { ...authHeaders(instructor), Accept: "application/json" },
        },
        env,
      );

      expect(gradebookResponse.status).toBe(200);
      await expect(
        stores.lti.listGradeJobsForCourse(courseId, "pending"),
      ).resolves.toEqual([]);
      await expect(
        stores.lti.listGradeJobsForCourse(courseId, "complete"),
      ).resolves.toHaveLength(1);
    });
  });

  test("associating an activity backfills deliveries for existing scores", async () => {
    await withStorage(async ({ stores }, env) => {
      const instructor = await login(env, "ags-teacher@example.test");
      const student = await login(env, "ags-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      // The activity has launched (so the link and its line item exist) but
      // is not attached to the assignment yet.
      const { link, platform } = await ltiFixture(stores, courseId);

      await linkStudentToLms(stores, platform, student.actorId, "sub-1");

      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignmentId,
      );

      await submitCorrectAnswer(
        env,
        student,
        courseId,
        assignmentId,
        attemptId,
      );
      await expect(
        stores.lti.listGradeJobsForCourse(courseId, "pending"),
      ).resolves.toEqual([]);

      const associateResponse = await appRequest(
        createTestApp(),
        `/lti/resource-links/${link.id}/assignment`,
        {
          body: new URLSearchParams({ assignmentId, courseId }),
          headers: {
            ...authHeaders(instructor),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        env,
      );

      expect(associateResponse.status).toBe(303);

      const pending = await stores.lti.listGradeJobsForCourse(
        courseId,
        "pending",
      );

      expect(pending).toHaveLength(1);
      expect(pending[0]?.userId).toBe(student.actorId);
      expect(pending[0]?.score).toBe(2);
    });
  });

  test("transient failures back off and rejections park as failed until retried", async () => {
    await withStorage(async ({ stores }, env) => {
      const instructor = await login(env, "ags-teacher@example.test");
      const student = await login(env, "ags-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const { link, platform } = await ltiFixture(stores, courseId, {
        assignmentId,
      });

      await linkStudentToLms(stores, platform, student.actorId, "sub-1");
      await stores.lti.enqueueGradeJob({
        id: "grade-job-1",
        resourceLinkId: link.id,
        userId: student.actorId,
        score: 2,
        maxScore: 2,
        scoreTimestamp: NOW,
        now: NOW,
      });

      let nowMs = Date.parse("2026-01-02T04:00:00.000Z");
      const clock = () => new Date(nowMs);
      const lms = fakeLms();
      const service = await passbackService(stores, lms, clock);

      // An outage schedules a retry with backoff.
      lms.scoreStatus = 503;

      await expect(service.processDueJobs()).resolves.toMatchObject({
        claimed: 1,
        retried: 1,
      });

      let [job] = await stores.lti.listGradeJobsForCourse(
        courseId,
        "pending",
      );

      expect(job?.attemptCount).toBe(1);
      expect(job?.lastFailureReason).toBe("lms_rejected");
      expect(job?.lastErrorDetail).toContain("503");
      expect(job?.nextAttemptAt).toBe("2026-01-02T04:01:00.000Z");

      // Not due yet: nothing is claimed before the backoff elapses.
      await expect(service.processDueJobs()).resolves.toMatchObject({
        claimed: 0,
      });

      // A rejection the LMS will always repeat parks the job as failed.
      nowMs = Date.parse("2026-01-02T04:01:01.000Z");
      lms.scoreStatus = 403;

      await expect(service.processDueJobs()).resolves.toMatchObject({
        claimed: 1,
        failed: 1,
      });

      [job] = await stores.lti.listGradeJobsForCourse(courseId, "failed");
      expect(job?.lastFailureReason).toBe("lms_rejected");
      expect(job?.lastErrorDetail).toContain("403");

      // The instructor sees the failure and can re-queue it.
      const instructorUser = await stores.users.getById(instructor.actorId);

      if (instructorUser === null) {
        throw new Error("Expected the instructor user to exist.");
      }

      const failures = await service.listFailedJobs(
        actorFor(instructorUser),
        courseId,
      );

      expect(failures).toHaveLength(1);
      expect(failures[0]?.activityTitle).toBe("Homework (LMS)");
      expect(failures[0]?.student?.id).toBe(student.actorId);

      const retried = await service.retryJob(
        actorFor(instructorUser),
        job?.id ?? "",
      );

      expect(retried.status).toBe("pending");
      expect(retried.attemptCount).toBe(0);

      // The re-queued job delivers once the LMS recovers.
      lms.scoreStatus = 200;

      await expect(service.processDueJobs()).resolves.toMatchObject({
        claimed: 1,
        sent: 1,
      });
    });
  });

  test("a failure Carnap detects itself records a reason code, not prose", async () => {
    await withStorage(async ({ stores }, env) => {
      const instructor = await login(env, "ags-teacher@example.test");
      const student = await login(env, "ags-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const { link } = await ltiFixture(stores, courseId, { assignmentId });

      // Deliberately no linkStudentToLms: the student has no identity on this
      // platform, so the delivery can never be addressed and never will be.
      await stores.lti.enqueueGradeJob({
        id: "grade-job-1",
        resourceLinkId: link.id,
        userId: student.actorId,
        score: 2,
        maxScore: 2,
        scoreTimestamp: NOW,
        now: NOW,
      });

      const lms = fakeLms();
      const service = await passbackService(stores, lms);

      await expect(service.processDueJobs()).resolves.toMatchObject({
        claimed: 1,
        failed: 1,
      });

      const [job] = await stores.lti.listGradeJobsForCourse(
        courseId,
        "failed",
      );

      // The record carries the machine reason and nothing the LMS didn't say,
      // so the instructor's page can explain it in their own language.
      expect(job?.lastFailureReason).toBe("student_unlinked");
      expect(job?.lastErrorDetail).toBeNull();
    });
  });

  test("failures surface on the course page and retry is instructor-gated", async () => {
    await withStorage(async ({ stores }, env) => {
      const instructor = await login(env, "ags-teacher@example.test");
      const student = await login(env, "ags-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const { link, platform } = await ltiFixture(stores, courseId, {
        assignmentId,
      });

      await linkStudentToLms(stores, platform, student.actorId, "sub-1");
      await stores.lti.enqueueGradeJob({
        id: "grade-job-1",
        resourceLinkId: link.id,
        userId: student.actorId,
        score: 2,
        maxScore: 2,
        scoreTimestamp: NOW,
        now: NOW,
      });

      const lms = fakeLms();

      lms.scoreStatus = 403;

      await (await passbackService(stores, lms)).processDueJobs();

      const coursePage = await appRequest(
        createTestApp(),
        `/courses/${courseId}`,
        { headers: { Accept: "text/html", Cookie: instructor.cookieHeader } },
        env,
      );
      const courseHtml = await coursePage.text();

      expect(courseHtml).toContain("LMS grade sync problems");
      expect(courseHtml).toContain("ags-student@example.test");
      expect(courseHtml).toContain("403");

      // A student sees no panel and cannot re-queue the delivery.
      const studentPage = await appRequest(
        createTestApp(),
        `/courses/${courseId}`,
        { headers: { Accept: "text/html", Cookie: student.cookieHeader } },
        env,
      );

      expect(await studentPage.text()).not.toContain(
        "LMS grade sync problems",
      );

      const denied = await appRequest(
        createTestApp(),
        "/lti/grade-jobs/grade-job-1/retry",
        {
          body: new URLSearchParams({ courseId }),
          headers: {
            ...authHeaders(student),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        env,
      );

      expect(denied.status).toBe(403);
      await expect(
        stores.lti.listGradeJobsForCourse(courseId, "failed"),
      ).resolves.toHaveLength(1);

      const retried = await appRequest(
        createTestApp(),
        "/lti/grade-jobs/grade-job-1/retry",
        {
          body: new URLSearchParams({ courseId }),
          headers: {
            ...authHeaders(instructor),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        env,
      );

      expect(retried.status).toBe(303);
      expect(retried.headers.get("Location")).toBe(
        `/courses/${courseId}?gradeSyncRetried=1`,
      );
      await expect(
        stores.lti.listGradeJobsForCourse(courseId, "pending"),
      ).resolves.toHaveLength(1);
    });
  });

  test("the retry budget is bounded", async () => {
    await withStorage(async ({ stores }, env) => {
      const instructor = await login(env, "ags-teacher@example.test");
      const student = await login(env, "ags-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const { link, platform } = await ltiFixture(stores, courseId, {
        assignmentId,
      });

      await linkStudentToLms(stores, platform, student.actorId, "sub-1");
      await stores.lti.enqueueGradeJob({
        id: "grade-job-1",
        resourceLinkId: link.id,
        userId: student.actorId,
        score: 2,
        maxScore: 2,
        scoreTimestamp: NOW,
        now: NOW,
      });

      let nowMs = Date.parse("2026-01-02T04:00:00.000Z");
      const lms = fakeLms();
      const service = await passbackService(
        stores,
        lms,
        () => new Date(nowMs),
      );

      lms.scoreStatus = 503;

      // Chase the backoff schedule until the budget runs out: every attempt
      // stays retryable, but the eighth parks the job anyway.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const summary = await service.processDueJobs();

        expect(summary.claimed).toBe(1);

        const [job] = await stores.lti.listGradeJobsForCourse(
          courseId,
          attempt < 7 ? "pending" : "failed",
        );

        if (job === undefined) {
          throw new Error(
            `Expected the job to exist after attempt ${attempt}.`,
          );
        }

        expect(job.attemptCount).toBe(attempt + 1);
        nowMs = Date.parse(job.nextAttemptAt) + 1000;
      }

      await expect(service.processDueJobs()).resolves.toMatchObject({
        claimed: 0,
      });
    });
  });

  test("without a tool key the outbox is left untouched", async () => {
    await withStorage(async ({ stores }, env) => {
      const instructor = await login(env, "ags-teacher@example.test");
      const student = await login(env, "ags-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const { link, platform } = await ltiFixture(stores, courseId, {
        assignmentId,
      });

      await linkStudentToLms(stores, platform, student.actorId, "sub-1");
      await stores.lti.enqueueGradeJob({
        id: "grade-job-1",
        resourceLinkId: link.id,
        userId: student.actorId,
        score: 2,
        maxScore: 2,
        scoreTimestamp: NOW,
        now: NOW,
      });

      const service = new GradePassbackService({ sender: null, stores });

      await expect(service.processDueJobs()).resolves.toMatchObject({
        claimed: 0,
      });

      const [job] = await stores.lti.listGradeJobsForCourse(
        courseId,
        "pending",
      );

      expect(job?.attemptCount).toBe(0);
    });
  });

  test("deliveries to one platform share an access token", async () => {
    await withStorage(async ({ stores }, env) => {
      const instructor = await login(env, "ags-teacher@example.test");
      const first = await login(env, "ags-first@example.test");
      const second = await login(env, "ags-second@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, first, courseId);
      await enrollStudent(env, instructor, second, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const { link, platform } = await ltiFixture(stores, courseId, {
        assignmentId,
      });

      await linkStudentToLms(stores, platform, first.actorId, "sub-first");
      await linkStudentToLms(stores, platform, second.actorId, "sub-second");

      for (const [index, student] of [first, second].entries()) {
        await stores.lti.enqueueGradeJob({
          id: `grade-job-${index}`,
          resourceLinkId: link.id,
          userId: student.actorId,
          score: 2,
          maxScore: 2,
          scoreTimestamp: NOW,
          now: NOW,
        });
      }

      const lms = fakeLms();
      const service = await passbackService(stores, lms);

      await expect(service.processDueJobs()).resolves.toMatchObject({
        claimed: 2,
        sent: 2,
      });
      expect(lms.tokenRequests()).toHaveLength(1);
      expect(lms.scoreRequests()).toHaveLength(2);
    });
  });

  test("unreleased grades defer without spending retries and deliver on release", async () => {
    await withStorage(async ({ stores }, env) => {
      const instructor = await login(env, "ags-teacher@example.test");
      const student = await login(env, "ags-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      // No release date at all: grades stay hidden in Carnap, so they must
      // stay out of the LMS gradebook too.
      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
        null,
      );
      const { link, platform } = await ltiFixture(stores, courseId, {
        assignmentId,
      });

      await linkStudentToLms(stores, platform, student.actorId, "sub-1");

      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignmentId,
      );

      await submitCorrectAnswer(
        env,
        student,
        courseId,
        assignmentId,
        attemptId,
      );

      const lms = fakeLms();
      const service = await passbackService(stores, lms);

      await expect(service.processDueJobs()).resolves.toMatchObject({
        claimed: 1,
        deferred: 1,
        sent: 0,
      });
      expect(lms.scoreRequests()).toEqual([]);

      // Deferral costs no retry budget and parks the job pending.
      const deferredJob = await stores.lti.getGradeJob(
        link.id,
        student.actorId,
      );

      expect(deferredJob?.status).toBe("pending");
      expect(deferredJob?.attemptCount).toBe(0);

      // Releasing grades re-anchors the deferred delivery to now.
      const releaseResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignmentId}/grade-visibility`,
        jsonRequest({ release: true }, instructor),
        env,
      );

      expect(releaseResponse.status).toBe(200);
      await expect(service.processDueJobs()).resolves.toMatchObject({
        claimed: 1,
        sent: 1,
      });

      const scoreBody = JSON.parse(lms.scoreRequests()[0]?.body ?? "{}") as {
        scoreGiven?: number;
      };

      expect(scoreBody.scoreGiven).toBe(2);
    });
  });

  test("a token the platform revoked is replaced within the same delivery", async () => {
    await withStorage(async ({ stores }, env) => {
      const instructor = await login(env, "ags-teacher@example.test");
      const student = await login(env, "ags-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const { link, platform } = await ltiFixture(stores, courseId, {
        assignmentId,
      });

      await linkStudentToLms(stores, platform, student.actorId, "sub-1");
      await stores.lti.enqueueGradeJob({
        id: "grade-job-1",
        resourceLinkId: link.id,
        userId: student.actorId,
        score: 2,
        maxScore: 2,
        scoreTimestamp: NOW,
        now: NOW,
      });

      // An LMS that revoked the first token: the initial score POST gets a
      // 401, and only a freshly minted token succeeds.
      let tokenCount = 0;
      const scoreAuths: string[] = [];
      const fetcher = async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);

        if (url === `${TEST_ISSUER}/token`) {
          tokenCount += 1;

          return Response.json({
            access_token: `lms-access-token-${tokenCount}`,
            expires_in: 3600,
            token_type: "Bearer",
          });
        }

        const auth = new Headers(init?.headers).get("Authorization") ?? "";

        scoreAuths.push(auth);

        return new Response(null, {
          status: auth === "Bearer lms-access-token-1" ? 401 : 200,
        });
      };
      const { toolKey } = await testToolKey();
      const service = new GradePassbackService({
        sender: new AgsClient({ fetcher, toolKey }),
        stores,
      });

      await expect(service.processDueJobs()).resolves.toMatchObject({
        claimed: 1,
        sent: 1,
        failed: 0,
      });
      expect(tokenCount).toBe(2);
      expect(scoreAuths).toEqual([
        "Bearer lms-access-token-1",
        "Bearer lms-access-token-2",
      ]);
    });
  });

  test("instructor corrections resync scores without a gradebook view", async () => {
    await withStorage(async ({ stores }, env) => {
      const instructor = await login(env, "ags-teacher@example.test");
      const student = await login(env, "ags-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const { link, platform } = await ltiFixture(stores, courseId, {
        assignmentId,
      });

      await linkStudentToLms(stores, platform, student.actorId, "sub-1");

      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignmentId,
      );

      await submitCorrectAnswer(
        env,
        student,
        courseId,
        assignmentId,
        attemptId,
      );

      const lms = fakeLms();
      const service = await passbackService(stores, lms);

      await expect(service.processDueJobs()).resolves.toMatchObject({
        sent: 1,
      });

      // Resetting the attempt re-queues the corrected (now missing) score
      // immediately — no gradebook view in between.
      const resetResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignmentId}/attempts/${attemptId}/reset`,
        { headers: authHeaders(instructor), method: "POST" },
        env,
      );

      expect(resetResponse.status).toBe(200);

      const requeued = await stores.lti.getGradeJob(link.id, student.actorId);

      expect(requeued?.status).toBe("pending");
      expect(requeued?.score).toBe(0);
      expect(requeued?.maxScore).toBe(2);
      await expect(service.processDueJobs()).resolves.toMatchObject({
        sent: 1,
      });

      const correction = JSON.parse(lms.scoreRequests()[1]?.body ?? "{}") as {
        scoreGiven?: number;
      };

      expect(correction.scoreGiven).toBe(0);

      // Excusing the only exercise zeroes the possible points; the score row
      // updates immediately, but a scoreMaximum of 0 has no AGS
      // representation, so nothing is queued (rather than queuing a send the
      // LMS would permanently reject).
      const excuseResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignmentId}/excuses`,
        jsonRequest(
          { exerciseId: "q1", reason: "covered in class" },
          instructor,
        ),
        env,
      );

      expect(excuseResponse.status).toBe(201);
      await expect(
        stores.scores.getAssignmentScore(assignmentId, student.actorId),
      ).resolves.toMatchObject({ maxScore: 0 });
      await expect(
        stores.lti.listGradeJobsForCourse(courseId, "pending"),
      ).resolves.toEqual([]);
    });
  });

  test("a student who merely opened an attempt is never reported to the LMS", async () => {
    await withStorage(async ({ stores }, env) => {
      const instructor = await login(env, "ags-teacher@example.test");
      const student = await login(env, "ags-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignmentId = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const { link, platform } = await ltiFixture(stores, courseId, {
        assignmentId,
      });

      await linkStudentToLms(stores, platform, student.actorId, "sub-1");
      await beginAttempt(env, student, courseId, assignmentId);

      // The gradebook view recomputes a "missing" zero for the opened
      // attempt, but pushing it would render a real grade for a student who
      // only peeked.
      const gradebookResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/gradebook`,
        {
          headers: { ...authHeaders(instructor), Accept: "application/json" },
        },
        env,
      );

      expect(gradebookResponse.status).toBe(200);
      await expect(
        stores.scores.getAssignmentScore(assignmentId, student.actorId),
      ).resolves.toMatchObject({ status: "missing" });
      await expect(
        stores.lti.getGradeJob(link.id, student.actorId),
      ).resolves.toBeNull();
    });
  });

  test("re-pointing a mapped activity clears its queued scores", async () => {
    await withStorage(async ({ stores }, env) => {
      const instructor = await login(env, "ags-teacher@example.test");
      const student = await login(env, "ags-student@example.test");
      const courseId = await createCourse(env, instructor);
      const revisionId = await createRevision(env, instructor);

      await enrollStudent(env, instructor, student, courseId);

      const assignmentA = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const assignmentB = await createPublishedAssignment(
        env,
        instructor,
        courseId,
        revisionId,
      );
      const { link, platform } = await ltiFixture(stores, courseId, {
        assignmentId: assignmentA,
      });

      await linkStudentToLms(stores, platform, student.actorId, "sub-1");

      const attemptId = await beginAttempt(
        env,
        student,
        courseId,
        assignmentA,
      );

      await submitCorrectAnswer(
        env,
        student,
        courseId,
        assignmentA,
        attemptId,
      );
      await expect(
        stores.lti.getGradeJob(link.id, student.actorId),
      ).resolves.toMatchObject({ status: "pending", score: 2 });

      // Re-pointing the activity at assignment B makes its LMS column mean
      // B; the queued A score must not land in it.
      const associateResponse = await appRequest(
        createTestApp(),
        `/lti/resource-links/${link.id}/assignment`,
        {
          body: new URLSearchParams({ assignmentId: assignmentB, courseId }),
          headers: {
            ...authHeaders(instructor),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        env,
      );

      expect(associateResponse.status).toBe(303);
      // The student has no B score, so after the A jobs were cleared the
      // backfill queues nothing.
      await expect(
        stores.lti.getGradeJob(link.id, student.actorId),
      ).resolves.toBeNull();
    });
  });
});
