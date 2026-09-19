import type { Env } from "../../src/worker/env";
import { grantTestCourseCreator } from "./admin";
import { appRequest, createTestApp } from "./app";
import { createTestStorage, type TestStorage } from "./storage";

/**
 * The HTTP plumbing the route suites share: a storage fixture with its
 * `Env`, the cookie and JSON request shapes, the passwordless login, and the
 * course and enrolment seeds every assignment-shaped test starts from.
 *
 * Each of these was defined locally in up to twenty-two test files, and the
 * copies drifted — one `login` returned the body and read `body.actor.id`,
 * another `actorId`; one `jsonRequest` took a CSRF token and another the
 * whole login — so a fix to the shared idea meant twenty edits and usually
 * got fewer. A suite that needs more than these (the auth suite, which is
 * *about* the login, and the profile suite, which saves a name on the way
 * in) keeps its own on top of them.
 *
 * Nothing here asserts: a helper that fails throws with the status and body,
 * which is what a fixture failure is. The `expect`s belong to the tests.
 */

export interface LoginResult {
  readonly actorId: string;
  readonly cookieHeader: string;
  readonly csrfToken: string;
}

/**
 * A clean database and the `Env` the app reads it from. The storage is the
 * process-wide Miniflare instance, truncated on each call, so there is
 * nothing to release afterwards.
 */
export async function withStorage(
  run: (storage: TestStorage, env: Env) => Promise<void>,
  overrides: Partial<Omit<Env, "DB">> = {},
): Promise<void> {
  const storage = await createTestStorage();

  await run(storage, { CARNAP_ENV: "local", DB: storage.db, ...overrides });
}

/** Each `Set-Cookie` of a response, whole. */
export function setCookieHeaders(response: Response): readonly string[] {
  return response.headers.getSetCookie();
}

/** The `Cookie` header that sends a response's cookies back. */
export function cookieHeader(response: Response): string {
  return setCookieHeaders(response)
    .map((cookie) => cookie.split(";")[0] ?? "")
    .join("; ");
}

/** The session cookie and CSRF token, as a signed-in request carries them. */
export function authHeaders(login: LoginResult): Record<string, string> {
  return { Cookie: login.cookieHeader, "X-CSRF-Token": login.csrfToken };
}

/** A JSON `POST`, signed in when `login` is given. */
export function jsonRequest(body: unknown, login?: LoginResult): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(login === undefined ? {} : authHeaders(login)),
    },
    method: "POST",
  };
}

async function failed(step: string, response: Response): Promise<Error> {
  return new Error(
    `${step} answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
  );
}

/**
 * Sign `email` in through the local passwordless flow, whose start route
 * hands back the confirmation token under `CARNAP_ENV=local`.
 */
export async function login(env: Env, email: string): Promise<LoginResult> {
  const start = await appRequest(
    createTestApp(),
    "/auth/login/start",
    jsonRequest({ email }),
    env,
  );

  if (start.status !== 202) {
    throw await failed(`login start for ${email}`, start);
  }

  const { login: challenge } = (await start.json()) as {
    readonly login: { readonly loginToken: string };
  };
  const confirm = await appRequest(
    createTestApp(),
    "/auth/login/confirm",
    jsonRequest({ loginToken: challenge.loginToken }),
    env,
  );

  if (confirm.status !== 200) {
    throw await failed(`login confirm for ${email}`, confirm);
  }

  const body = (await confirm.json()) as {
    readonly actor: { readonly id: string };
    readonly csrfToken: string;
  };

  return {
    actorId: body.actor.id,
    cookieHeader: cookieHeader(confirm),
    csrfToken: body.csrfToken,
  };
}

/**
 * A course `instructor` owns, granting them the creator capability on the
 * way. Returns the course id, which is all a test setting up an assignment
 * goes on to use.
 */
export async function createCourse(
  env: Env,
  instructor: LoginResult,
  fields: { readonly timezone?: string; readonly title?: string } = {},
): Promise<string> {
  await grantTestCourseCreator(env, instructor.actorId);

  const response = await appRequest(
    createTestApp(),
    "/courses",
    jsonRequest(
      { timezone: "UTC", title: "Intro Logic", ...fields },
      instructor,
    ),
    env,
  );

  if (response.status !== 201) {
    throw await failed("creating a course", response);
  }

  return ((await response.json()) as { course: { id: string } }).course.id;
}

/** Enrol `student` through a link `instructor` makes, as a student would. */
export async function enrollStudent(
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

  if (linkResponse.status !== 201) {
    throw await failed("making an enrolment link", linkResponse);
  }

  const { enrollmentLink } = (await linkResponse.json()) as {
    readonly enrollmentLink: { readonly enrollmentPath: string };
  };
  const enrollResponse = await appRequest(
    createTestApp(),
    enrollmentLink.enrollmentPath,
    { headers: authHeaders(student), method: "POST" },
    env,
  );

  if (enrollResponse.status !== 200) {
    throw await failed("enrolling", enrollResponse);
  }
}
