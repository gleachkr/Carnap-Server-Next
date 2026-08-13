import { describe, expect, setDefaultTimeout, test } from "bun:test";

import {
  requireAuthenticated,
  requireInstructor,
} from "../src/worker/application/authorization";
import type { AppStores } from "../src/worker/application/stores";
import type { Env } from "../src/worker/env";
import { storesForContext } from "../src/worker/stores";
import { appRequest, createTestApp } from "./helpers/app";
import { createTestStorage, type TestStorage } from "./helpers/storage";

const NOW = "2026-01-02T03:04:05.000Z";

setDefaultTimeout(30_000);

interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}

interface StartLoginResponse {
  readonly login: {
    readonly email: string;
    readonly expiresAt: string;
    readonly loginToken: string;
  };
}

interface ConfirmLoginResponse {
  readonly actor: {
    readonly id: string;
    readonly email: string;
    readonly name: string | null;
  };
  readonly csrfToken: string;
}

interface LoginResult {
  readonly body: ConfirmLoginResponse;
  readonly cookieHeader: string;
  readonly csrfToken: string;
  readonly sessionCookie: string;
  readonly csrfCookie: string;
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

function jsonRequest(body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
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

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

function cookieHeader(response: Response): string {
  return setCookieHeaders(response).map(cookiePair).join("; ");
}

function findSetCookie(response: Response, name: string): string {
  const header = setCookieHeaders(response).find((cookie) =>
    cookie.startsWith(`${name}=`),
  );

  if (header === undefined) {
    throw new Error(`Missing ${name} cookie.`);
  }

  return header;
}

async function login(
  env: Env,
  email = "Ada@Example.test",
): Promise<LoginResult> {
  const app = createTestApp();
  const startResponse = await appRequest(
    app,
    "/auth/login/start",
    jsonRequest({ email }),
    env,
  );
  const startBody = (await startResponse.json()) as StartLoginResponse;

  expect(startResponse.status).toBe(202);
  expect(startBody.login.email).toBe(email.toLowerCase());
  expect(startBody.login.loginToken).toStartWith("alt_");

  const confirmResponse = await appRequest(
    app,
    "/auth/login/confirm",
    jsonRequest({ loginToken: startBody.login.loginToken }),
    env,
  );
  const body = (await confirmResponse.json()) as ConfirmLoginResponse;
  const sessionCookie = findSetCookie(confirmResponse, "carnap_session");
  const csrfCookie = findSetCookie(confirmResponse, "carnap_csrf");

  expect(confirmResponse.status).toBe(200);

  return {
    body,
    cookieHeader: cookieHeader(confirmResponse),
    csrfCookie,
    csrfToken: body.csrfToken,
    sessionCookie,
  };
}

describe("native authentication", () => {
  test("a user can log in and receive secure local cookies", async () => {
    await withStorage(async (_storage, env) => {
      const result = await login(env);

      expect(result.body.actor.email).toBe("ada@example.test");
      // Nameless: signing in proves an address and nothing else. The name is
      // the account owner's to give on the profile form once they are in.
      expect(result.body.actor.name).toBeNull();
      expect(result.sessionCookie).toContain("HttpOnly");
      expect(result.sessionCookie).toContain("Max-Age=1209600");
      expect(result.sessionCookie).toContain("Path=/");
      expect(result.sessionCookie).toContain("SameSite=Lax");
      expect(result.sessionCookie).not.toContain("Secure");
      expect(result.csrfCookie).not.toContain("HttpOnly");
      expect(result.csrfCookie).toContain("SameSite=Lax");
    });
  });

  test("a logged-in request resolves the current actor", async () => {
    await withStorage(async (_storage, env) => {
      const result = await login(env);
      const response = await appRequest(
        createTestApp(),
        "/auth/me",
        { headers: { Cookie: result.cookieHeader } },
        env,
      );
      const body = (await response.json()) as ConfirmLoginResponse;

      expect(response.status).toBe(200);
      expect(body.actor.email).toBe("ada@example.test");
    });
  });

  test("unauthenticated users cannot access protected routes", async () => {
    await withStorage(async (_storage, env) => {
      const response = await appRequest(createTestApp(), "/auth/me", {}, env);
      const body = (await response.json()) as ErrorEnvelope;

      expect(response.status).toBe(401);
      expect(body.error.code).toBe("unauthenticated");
      expect(body.error.requestId).toBeString();
    });
  });

  test("logout requires CSRF and invalidates the session", async () => {
    await withStorage(async (_storage, env) => {
      const result = await login(env);
      const missingCsrf = await appRequest(
        createTestApp(),
        "/auth/logout",
        { headers: { Cookie: result.cookieHeader }, method: "POST" },
        env,
      );
      const missingBody = (await missingCsrf.json()) as ErrorEnvelope;

      expect(missingCsrf.status).toBe(403);
      expect(missingBody.error.code).toBe("csrf_token_invalid");

      const logout = await appRequest(
        createTestApp(),
        "/auth/logout",
        {
          headers: {
            Cookie: result.cookieHeader,
            "X-CSRF-Token": result.csrfToken,
          },
          method: "POST",
        },
        env,
      );

      expect(logout.status).toBe(204);

      const afterLogout = await appRequest(
        createTestApp(),
        "/auth/me",
        { headers: { Cookie: result.cookieHeader } },
        env,
      );
      const afterBody = (await afterLogout.json()) as ErrorEnvelope;

      expect(afterLogout.status).toBe(401);
      expect(afterBody.error.code).toBe("unauthenticated");
    });
  });

  test("disabled users cannot authenticate", async () => {
    await withStorage(async ({ stores }, env) => {
      const user = await stores.users.create({
        id: "disabled-user-1",
        email: "disabled@example.test",
        name: "Disabled User",
        createdAt: NOW,
      });
      const startResponse = await appRequest(
        createTestApp(),
        "/auth/login/start",
        jsonRequest({ email: user.email }),
        env,
      );
      const startBody = (await startResponse.json()) as StartLoginResponse;

      await stores.users.disable(user.id, NOW);

      const confirmResponse = await appRequest(
        createTestApp(),
        "/auth/login/confirm",
        jsonRequest({ loginToken: startBody.login.loginToken }),
        env,
      );
      const confirmBody = (await confirmResponse.json()) as ErrorEnvelope;

      expect(confirmResponse.status).toBe(403);
      expect(confirmBody.error.code).toBe("disabled_user");
    });
  });

  test("disabled users cannot act with an existing session", async () => {
    await withStorage(async ({ stores }, env) => {
      const result = await login(env, "blocked@example.test");

      await stores.users.disable(result.body.actor.id, NOW);

      const response = await appRequest(
        createTestApp(),
        "/auth/me",
        { headers: { Cookie: result.cookieHeader } },
        env,
      );
      const body = (await response.json()) as ErrorEnvelope;

      expect(response.status).toBe(403);
      expect(body.error.code).toBe("disabled_user");
    });
  });
});

describe("course role authorization", () => {
  async function createCourse(stores: AppStores, instructorId: string) {
    return stores.courses.create({
      id: "course-auth-1",
      title: "Intro Logic",
      timezone: "UTC",
      createdAt: NOW,
      createdById: instructorId,
    });
  }

  test("course role checks distinguish instructors from students", async () => {
    await withStorage(async ({ stores }, env) => {
      const app = createTestApp({
        configure(configuredApp) {
          configuredApp.get(
            "/courses/:courseId/instructor",
            async (context) => {
              const actor = requireAuthenticated(context);
              const membership = await requireInstructor(
                storesForContext(context),
                actor,
                context.req.param("courseId"),
              );

              return context.json({ role: membership.role });
            },
          );
        },
      });
      const instructorLogin = await login(env, "instructor@example.test");
      const studentLogin = await login(env, "student@example.test");
      const course = await createCourse(
        stores,
        instructorLogin.body.actor.id,
      );

      await stores.courses.addMembership({
        id: "membership-instructor-auth-1",
        courseId: course.id,
        userId: instructorLogin.body.actor.id,
        role: "instructor",
        status: "active",
        createdAt: NOW,
      });
      await stores.courses.addMembership({
        id: "membership-student-auth-1",
        courseId: course.id,
        userId: studentLogin.body.actor.id,
        role: "student",
        status: "active",
        createdAt: NOW,
      });

      const studentResponse = await appRequest(
        app,
        `/courses/${course.id}/instructor`,
        { headers: { Cookie: studentLogin.cookieHeader } },
        env,
      );
      const studentBody = (await studentResponse.json()) as ErrorEnvelope;
      const instructorResponse = await appRequest(
        app,
        `/courses/${course.id}/instructor`,
        { headers: { Cookie: instructorLogin.cookieHeader } },
        env,
      );
      const instructorBody = (await instructorResponse.json()) as {
        readonly role: string;
      };

      expect(studentResponse.status).toBe(403);
      expect(studentBody.error.code).toBe("course_role_required");
      expect(instructorResponse.status).toBe(200);
      expect(instructorBody.role).toBe("instructor");
    });
  });
});
