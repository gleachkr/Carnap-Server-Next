import { describe, expect, setDefaultTimeout, test } from "bun:test";

import { hashAuthToken } from "../src/worker/application/auth";
import type { Env } from "../src/worker/env";
import { grantTestCourseCreator } from "./helpers/admin";
import { appRequest, createTestApp } from "./helpers/app";
import { createTestStorage, type TestStorage } from "./helpers/storage";

const EXPIRED = "2020-01-02T03:04:05.000Z";

setDefaultTimeout(30_000);

interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
  };
}

interface StartLoginResponse {
  readonly login: {
    readonly email: string;
    readonly loginToken: string;
  };
}

interface LoginResponse {
  readonly actor: {
    readonly id: string;
    readonly email: string;
    readonly name: string | null;
  };
  readonly csrfToken: string;
}

interface LoginResult {
  readonly body: LoginResponse;
  readonly cookieHeader: string;
  readonly csrfToken: string;
}

interface CourseResponse {
  readonly course: {
    readonly id: string;
    readonly title: string;
    readonly timezone: string;
    readonly archivedAt?: string | null;
  };
  readonly membership: {
    readonly id: string;
    readonly courseId: string;
    readonly userId: string;
    readonly role: string;
    readonly status: string;
  };
  readonly memberships?: readonly {
    readonly id: string;
    readonly role: string;
    readonly status: string;
    readonly userId: string;
  }[];
}

interface CourseListResponse {
  readonly courses: readonly CourseResponse[];
}

interface StaffResponse {
  readonly membership: {
    readonly role: string;
    readonly userId: string;
  };
}

interface EnrollmentLinkResponse {
  readonly enrollmentLink: {
    readonly id: string;
    readonly token: string;
    readonly enrollmentPath: string;
    readonly expiresAt: string;
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

function jsonRequest(body: unknown, csrfToken?: string): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken === undefined ? {} : { "X-CSRF-Token": csrfToken }),
    },
    method: "POST",
  };
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

async function login(env: Env, email: string): Promise<LoginResult> {
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

  expect(startResponse.status).toBe(202);
  expect(confirmResponse.status).toBe(200);

  return {
    body,
    cookieHeader: cookieHeader(confirmResponse),
    csrfToken: body.csrfToken,
  };
}

async function createCourse(
  env: Env,
  loginResult: LoginResult,
  title = "Intro Logic",
): Promise<CourseResponse> {
  await grantTestCourseCreator(env, loginResult.body.actor.id);

  const response = await appRequest(
    createTestApp(),
    "/courses",
    {
      ...jsonRequest({ title, timezone: "America/New_York" }),
      headers: {
        Cookie: loginResult.cookieHeader,
        "Content-Type": "application/json",
        "X-CSRF-Token": loginResult.csrfToken,
      },
    },
    env,
  );
  const body = (await response.json()) as CourseResponse;

  expect(response.status).toBe(201);

  return body;
}

async function createEnrollmentLink(
  env: Env,
  loginResult: LoginResult,
  courseId: string,
): Promise<EnrollmentLinkResponse> {
  const response = await appRequest(
    createTestApp(),
    `/courses/${courseId}/enrollment-links`,
    {
      ...jsonRequest({}, loginResult.csrfToken),
      headers: {
        Cookie: loginResult.cookieHeader,
        "Content-Type": "application/json",
        "X-CSRF-Token": loginResult.csrfToken,
      },
    },
    env,
  );
  const body = (await response.json()) as EnrollmentLinkResponse;

  expect(response.status).toBe(201);
  expect(body.enrollmentLink.token).toStartWith("aenr_");

  return body;
}

describe("courses and enrollment", () => {
  test("course creation requires course creator permission", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const response = await appRequest(
        createTestApp(),
        "/courses",
        {
          ...jsonRequest({ title: "Intro Logic", timezone: "UTC" }),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": instructor.csrfToken,
          },
        },
        env,
      );
      const body = (await response.json()) as ErrorEnvelope;

      expect(response.status).toBe(403);
      expect(body.error.code).toBe("platform_capability_required");
    });
  });

  test("a course creator can create a course", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const created = await createCourse(env, instructor);

      expect(created.course.title).toBe("Intro Logic");
      expect(created.course.timezone).toBe("America/New_York");
      expect(created.membership.role).toBe("instructor");
      expect(created.membership.status).toBe("active");
      expect(created.membership.userId).toBe(instructor.body.actor.id);
    });
  });

  test("a student can join with a valid enrollment link", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const student = await login(env, "student@example.test");
      const created = await createCourse(env, instructor);
      const link = await createEnrollmentLink(
        env,
        instructor,
        created.course.id,
      );
      const accepted = await appRequest(
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
      const body = (await accepted.json()) as CourseResponse;

      expect(accepted.status).toBe(200);
      expect(body.membership.role).toBe("student");
      expect(body.membership.status).toBe("active");
      expect(body.membership.userId).toBe(student.body.actor.id);
    });
  });

  test("a non-member cannot view course details", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const outsider = await login(env, "outsider@example.test");
      const created = await createCourse(env, instructor);
      const response = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}`,
        { headers: { Cookie: outsider.cookieHeader } },
        env,
      );
      const body = (await response.json()) as ErrorEnvelope;

      expect(response.status).toBe(403);
      expect(body.error.code).toBe("course_role_required");
    });
  });

  test("a dropped member cannot access protected course data", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const student = await login(env, "student@example.test");
      const created = await createCourse(env, instructor);
      const link = await createEnrollmentLink(
        env,
        instructor,
        created.course.id,
      );
      const accepted = await appRequest(
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
      const acceptedBody = (await accepted.json()) as CourseResponse;
      const dropResponse = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/memberships/${acceptedBody.membership.id}`,
        {
          body: JSON.stringify({ status: "dropped" }),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": instructor.csrfToken,
          },
          method: "PATCH",
        },
        env,
      );
      const detailResponse = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const detailBody = (await detailResponse.json()) as ErrorEnvelope;

      expect(dropResponse.status).toBe(200);
      expect(detailResponse.status).toBe(403);
      expect(detailBody.error.code).toBe("course_role_required");
    });
  });

  test("an instructor can suspend a member from the members table form", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const student = await login(env, "student@example.test");
      const created = await createCourse(env, instructor);
      const link = await createEnrollmentLink(
        env,
        instructor,
        created.course.id,
      );
      const accepted = await appRequest(
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
      const acceptedBody = (await accepted.json()) as CourseResponse;
      const suspendResponse = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/memberships/${acceptedBody.membership.id}`,
        {
          body: new URLSearchParams({ role: "student", status: "suspended" }),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-Token": instructor.csrfToken,
          },
          method: "POST",
        },
        env,
      );
      const detailResponse = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}`,
        { headers: { Cookie: student.cookieHeader } },
        env,
      );
      const detailBody = (await detailResponse.json()) as ErrorEnvelope;

      expect(suspendResponse.status).toBe(303);
      expect(suspendResponse.headers.get("Location")).toBe(
        `/courses/${created.course.id}?membershipUpdated=1`,
      );
      expect(detailResponse.status).toBe(403);
      expect(detailBody.error.code).toBe("course_role_required");
    });
  });

  test("an instructor can promote a member to staff from the members form", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const student = await login(env, "student@example.test");
      const created = await createCourse(env, instructor);
      const link = await createEnrollmentLink(
        env,
        instructor,
        created.course.id,
      );
      const accepted = await appRequest(
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
      const acceptedBody = (await accepted.json()) as CourseResponse;
      const promoteResponse = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/memberships/${acceptedBody.membership.id}`,
        {
          body: new URLSearchParams({
            role: "teacher_assistant",
            status: "active",
          }),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-Token": instructor.csrfToken,
          },
          method: "POST",
        },
        env,
      );
      // The membership now carries the staff role.
      const detail = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}`,
        {
          headers: {
            Accept: "application/json",
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );
      const detailBody = (await detail.json()) as {
        readonly memberships: readonly {
          readonly id: string;
          readonly role: string;
        }[];
      };
      const promoted = detailBody.memberships.find(
        (membership) => membership.id === acceptedBody.membership.id,
      );

      expect(promoteResponse.status).toBe(303);
      expect(promoted?.role).toBe("teacher_assistant");
    });
  });

  test("the last active instructor cannot be demoted", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const created = await createCourse(env, instructor);
      const detail = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}`,
        {
          headers: {
            Accept: "application/json",
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );
      const detailBody = (await detail.json()) as {
        readonly memberships: readonly { readonly id: string }[];
      };
      const ownMembershipId = detailBody.memberships[0]?.id ?? "";
      const demoteResponse = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/memberships/${ownMembershipId}`,
        {
          body: new URLSearchParams({ role: "student", status: "active" }),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-Token": instructor.csrfToken,
          },
          method: "POST",
        },
        env,
      );
      const body = await demoteResponse.text();

      expect(demoteResponse.status).toBe(400);
      expect(body).toContain(
        "A course must keep at least one active instructor.",
      );
    });
  });

  test("course lists only include the current user's courses", async () => {
    await withStorage(async (_storage, env) => {
      const firstInstructor = await login(env, "first@example.test");
      const secondInstructor = await login(env, "second@example.test");

      await createCourse(env, firstInstructor, "First Course");
      await createCourse(env, secondInstructor, "Second Course");

      const response = await appRequest(
        createTestApp(),
        "/courses",
        { headers: { Cookie: firstInstructor.cookieHeader } },
        env,
      );
      const body = (await response.json()) as CourseListResponse;

      expect(response.status).toBe(200);
      expect(body.courses.map((entry) => entry.course.title)).toEqual([
        "First Course",
      ]);
    });
  });

  test("co-instructors can teach while TAs remain limited", async () => {
    await withStorage(async (_storage, env) => {
      const owner = await login(env, "owner@example.test");
      const coInstructor = await login(env, "co@example.test");
      const assistant = await login(env, "ta@example.test");
      const created = await createCourse(env, owner);
      const coStaffResponse = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/staff`,
        {
          ...jsonRequest(
            { role: "co_instructor", userId: coInstructor.body.actor.id },
            owner.csrfToken,
          ),
          headers: {
            Cookie: owner.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": owner.csrfToken,
          },
        },
        env,
      );
      const taStaffResponse = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/staff`,
        {
          ...jsonRequest(
            { role: "teacher_assistant", userId: assistant.body.actor.id },
            owner.csrfToken,
          ),
          headers: {
            Cookie: owner.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": owner.csrfToken,
          },
        },
        env,
      );
      const coStaff = (await coStaffResponse.json()) as StaffResponse;
      const coEnrollmentLink = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/enrollment-links`,
        {
          ...jsonRequest({}, coInstructor.csrfToken),
          headers: {
            Cookie: coInstructor.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": coInstructor.csrfToken,
          },
        },
        env,
      );
      const taEnrollmentLink = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/enrollment-links`,
        {
          ...jsonRequest({}, assistant.csrfToken),
          headers: {
            Cookie: assistant.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": assistant.csrfToken,
          },
        },
        env,
      );
      const taBody = (await taEnrollmentLink.json()) as ErrorEnvelope;

      expect(coStaffResponse.status).toBe(201);
      expect(coStaff.membership.role).toBe("co_instructor");
      expect(taStaffResponse.status).toBe(201);
      expect(coEnrollmentLink.status).toBe(201);
      expect(taEnrollmentLink.status).toBe(403);
      expect(taBody.error.code).toBe("course_role_required");
    });
  });
  test("invalid and expired enrollment links are rejected", async () => {
    await withStorage(async ({ stores }, env) => {
      const instructor = await login(env, "instructor@example.test");
      const student = await login(env, "student@example.test");
      const created = await createCourse(env, instructor);
      const expiredToken = "aenr_expired_test_token";

      await stores.courses.createEnrollmentLink({
        id: "expired-enrollment-link-1",
        courseId: created.course.id,
        tokenHash: await hashAuthToken(expiredToken),
        createdById: instructor.body.actor.id,
        createdAt: EXPIRED,
        expiresAt: EXPIRED,
      });

      for (const token of ["aenr_missing", expiredToken]) {
        const response = await appRequest(
          createTestApp(),
          `/enrollments/${token}`,
          {
            headers: {
              Cookie: student.cookieHeader,
              "X-CSRF-Token": student.csrfToken,
            },
            method: "POST",
          },
          env,
        );
        const body = (await response.json()) as ErrorEnvelope;

        expect(response.status).toBe(404);
        expect(body.error.code).toBe("enrollment_link_invalid");
      }
    });
  });

  test("an instructor can rename a course and change its timezone", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const created = await createCourse(env, instructor);
      const response = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}`,
        {
          ...jsonRequest(
            { timezone: "Europe/Paris", title: "Advanced Logic" },
            instructor.csrfToken,
          ),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": instructor.csrfToken,
          },
        },
        env,
      );
      const body = (await response.json()) as CourseResponse;

      expect(response.status).toBe(200);
      expect(body.course.title).toBe("Advanced Logic");
      expect(body.course.timezone).toBe("Europe/Paris");
    });
  });

  test("updating a course with an invalid timezone is rejected", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const created = await createCourse(env, instructor);
      const response = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}`,
        {
          ...jsonRequest(
            { timezone: "Mars/Phobos", title: "Advanced Logic" },
            instructor.csrfToken,
          ),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": instructor.csrfToken,
          },
        },
        env,
      );
      const body = (await response.json()) as ErrorEnvelope;

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("invalid_course_timezone");
    });
  });

  test("a non-instructor cannot update the course", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const student = await login(env, "student@example.test");
      const created = await createCourse(env, instructor);
      const link = await createEnrollmentLink(
        env,
        instructor,
        created.course.id,
      );
      await appRequest(
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
      const response = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}`,
        {
          ...jsonRequest({ title: "Hijacked" }, student.csrfToken),
          headers: {
            Cookie: student.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": student.csrfToken,
          },
        },
        env,
      );
      const body = (await response.json()) as ErrorEnvelope;

      expect(response.status).toBe(403);
      expect(body.error.code).toBe("course_role_required");
    });
  });

  test("archiving a course sets archivedAt and unarchiving clears it", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const created = await createCourse(env, instructor);

      const archived = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/archive`,
        {
          ...jsonRequest({}, instructor.csrfToken),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": instructor.csrfToken,
          },
        },
        env,
      );
      const archivedBody = (await archived.json()) as CourseResponse;

      expect(archived.status).toBe(200);
      expect(archivedBody.course.archivedAt).not.toBeNull();
      expect(typeof archivedBody.course.archivedAt).toBe("string");

      const listAfterArchive = await appRequest(
        createTestApp(),
        "/courses",
        { headers: { Cookie: instructor.cookieHeader } },
        env,
      );
      const listBody = (await listAfterArchive.json()) as CourseListResponse;
      const listed = listBody.courses.find(
        (entry) => entry.course.id === created.course.id,
      );

      expect(listed?.course.archivedAt).not.toBeNull();

      const unarchived = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/unarchive`,
        {
          ...jsonRequest({}, instructor.csrfToken),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": instructor.csrfToken,
          },
        },
        env,
      );
      const unarchivedBody = (await unarchived.json()) as CourseResponse;

      expect(unarchived.status).toBe(200);
      expect(unarchivedBody.course.archivedAt).toBeNull();
    });
  });

  test("a clone must be given a title", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const created = await createCourse(env, instructor);

      // The clone bar shows a suggested name as a placeholder and marks the
      // field `required`; there is no server-side default behind it, so a clone
      // with no title is refused rather than named for the caller.
      const untitled = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/clone`,
        {
          ...jsonRequest({}, instructor.csrfToken),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": instructor.csrfToken,
          },
        },
        env,
      );
      const untitledBody = (await untitled.json()) as ErrorEnvelope;

      expect(untitled.status).toBe(400);
      expect(untitledBody.error.code).toBe("invalid_course_title");

      const blank = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/clone`,
        {
          ...jsonRequest({ title: "   " }, instructor.csrfToken),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": instructor.csrfToken,
          },
        },
        env,
      );
      const blankBody = (await blank.json()) as ErrorEnvelope;

      expect(blank.status).toBe(400);
      expect(blankBody.error.code).toBe("invalid_course_title");

      const named = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/clone`,
        {
          ...jsonRequest(
            { title: "Intro Logic, Fall" },
            instructor.csrfToken,
          ),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": instructor.csrfToken,
          },
        },
        env,
      );
      const namedBody = (await named.json()) as CourseResponse;

      expect(named.status).toBe(201);
      expect(namedBody.course.title).toBe("Intro Logic, Fall");
    });
  });

  test("an archived course stays in every member's list", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const student = await login(env, "student@example.test");
      const created = await createCourse(env, instructor);
      const link = await createEnrollmentLink(
        env,
        instructor,
        created.course.id,
      );
      await appRequest(
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
      await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/archive`,
        {
          ...jsonRequest({}, instructor.csrfToken),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/json",
            "X-CSRF-Token": instructor.csrfToken,
          },
        },
        env,
      );

      const studentList = await appRequest(
        createTestApp(),
        "/courses",
        {
          headers: {
            Accept: "application/json",
            Cookie: student.cookieHeader,
          },
        },
        env,
      );
      const studentBody = (await studentList.json()) as CourseListResponse;
      const instructorList = await appRequest(
        createTestApp(),
        "/courses",
        {
          headers: {
            Accept: "application/json",
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );
      const instructorBody =
        (await instructorList.json()) as CourseListResponse;

      // The instructor keeps it so they can unarchive it — and so does the
      // student, whose enrollment is exactly as real as it was yesterday.
      // Nothing else on the site links to a course, so dropping it from this
      // list was dropping a student's only route back to their own work; the
      // web list folds archived courses into a closed drawer instead.
      const studentEntry = studentBody.courses.find(
        (entry) => entry.course.id === created.course.id,
      );

      expect(studentEntry).toBeDefined();
      // A `find` miss would be `undefined`, which `not.toBeNull()` lets past.
      expect(typeof studentEntry?.course.archivedAt).toBe("string");
      expect(
        instructorBody.courses.some(
          (entry) => entry.course.id === created.course.id,
        ),
      ).toBe(true);
    });
  });

  test("an instructor can add a staff member by email", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const ta = await login(env, "ta@example.test");
      const created = await createCourse(env, instructor);
      const response = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/staff`,
        {
          body: new URLSearchParams({
            email: "ta@example.test",
            role: "teacher_assistant",
          }),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-Token": instructor.csrfToken,
          },
          method: "POST",
        },
        env,
      );
      const detail = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}`,
        {
          headers: {
            Accept: "application/json",
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );
      const detailBody = (await detail.json()) as CourseResponse;
      const added = detailBody.memberships?.find(
        (membership) => membership.userId === ta.body.actor.id,
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe(
        `/courses/${created.course.id}?staffAdded=1`,
      );
      expect(added?.role).toBe("teacher_assistant");
      expect(added?.status).toBe("active");
    });
  });

  test("adding an already-enrolled student as staff promotes in place", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const student = await login(env, "student@example.test");
      const created = await createCourse(env, instructor);
      const link = await createEnrollmentLink(
        env,
        instructor,
        created.course.id,
      );
      await appRequest(
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
      const response = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/staff`,
        {
          body: new URLSearchParams({
            email: "student@example.test",
            role: "co_instructor",
          }),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-Token": instructor.csrfToken,
          },
          method: "POST",
        },
        env,
      );
      const detail = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}`,
        {
          headers: {
            Accept: "application/json",
            Cookie: instructor.cookieHeader,
          },
        },
        env,
      );
      const detailBody = (await detail.json()) as CourseResponse;
      const forStudent = detailBody.memberships?.filter(
        (membership) => membership.userId === student.body.actor.id,
      );

      expect(response.status).toBe(303);
      // Exactly one membership — promoted in place, not duplicated.
      expect(forStudent?.length).toBe(1);
      expect(forStudent?.[0]?.role).toBe("co_instructor");
    });
  });

  test("adding staff by an unknown email is rejected", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const created = await createCourse(env, instructor);
      const response = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/staff`,
        {
          body: new URLSearchParams({
            email: "nobody@example.test",
            role: "teacher_assistant",
          }),
          headers: {
            Cookie: instructor.cookieHeader,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-Token": instructor.csrfToken,
          },
          method: "POST",
        },
        env,
      );

      expect(response.status).toBe(404);
    });
  });

  test("a non-instructor cannot add staff", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const student = await login(env, "student@example.test");
      const created = await createCourse(env, instructor);
      const link = await createEnrollmentLink(
        env,
        instructor,
        created.course.id,
      );
      await appRequest(
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
      const response = await appRequest(
        createTestApp(),
        `/courses/${created.course.id}/staff`,
        {
          body: new URLSearchParams({
            email: "student@example.test",
            role: "teacher_assistant",
          }),
          headers: {
            Cookie: student.cookieHeader,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-Token": student.csrfToken,
          },
          method: "POST",
        },
        env,
      );

      expect(response.status).toBe(403);
    });
  });
});
