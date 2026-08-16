import { describe, expect, setDefaultTimeout, test } from "bun:test";

import {
  requireAuthenticated,
  requireInstructor,
} from "../src/worker/application/authorization";
import {
  createStoredLoginRateLimiter,
  LOGIN_RATE_LIMIT_PER_EMAIL,
  LOGIN_RATE_LIMIT_PER_IP,
} from "../src/worker/application/login-rate-limit";
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
      // Both cookies, not just the session one: no page script reads the CSRF
      // token from `document.cookie` — it is rendered into each form — so
      // leaving it readable would be exposure with no consumer.
      expect(result.csrfCookie).toContain("HttpOnly");
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

/**
 * The login throttle, exercised through the route rather than the limiter, so
 * that "no construction site forgot to pass one" is part of what is asserted.
 * Every assertion here is about mail volume: the harm being prevented is an
 * instance made to send login links to addresses nobody at the keyboard owns.
 */
describe("login rate limiting", () => {
  async function startLogin(
    env: Env,
    email: string,
    ipAddress?: string,
  ): Promise<Response> {
    const request = jsonRequest({ email });

    return appRequest(
      createTestApp(),
      "/auth/login/start",
      ipAddress === undefined
        ? request
        : {
            ...request,
            headers: {
              ...(request.headers as Record<string, string>),
              "CF-Connecting-IP": ipAddress,
            },
          },
      env,
    );
  }

  test("one address may only be mailed so many links in a window", async () => {
    await withStorage(async (_storage, env) => {
      const statuses: number[] = [];

      for (
        let attempt = 0;
        attempt < LOGIN_RATE_LIMIT_PER_EMAIL + 1;
        attempt++
      ) {
        statuses.push((await startLogin(env, "ada@example.test")).status);
      }

      expect(statuses.slice(0, LOGIN_RATE_LIMIT_PER_EMAIL)).toEqual(
        Array.from({ length: LOGIN_RATE_LIMIT_PER_EMAIL }, () => 202),
      );
      expect(statuses.at(-1)).toBe(429);
    });
  });

  test("the refusal names itself and does not depend on how the address is spelled", async () => {
    await withStorage(async (_storage, env) => {
      for (let attempt = 0; attempt < LOGIN_RATE_LIMIT_PER_EMAIL; attempt++) {
        await startLogin(env, "ada@example.test");
      }

      // Same mailbox, different capitals and whitespace: the limiter counts
      // the normalized address, or it would be trivially sidestepped.
      const response = await startLogin(env, "  Ada@Example.test ");
      const body = (await response.json()) as ErrorEnvelope;

      expect(response.status).toBe(429);
      expect(body.error.code).toBe("login_rate_limited");
    });
  });

  test("a throttled address does not throttle everyone else", async () => {
    await withStorage(async (_storage, env) => {
      for (
        let attempt = 0;
        attempt < LOGIN_RATE_LIMIT_PER_EMAIL + 1;
        attempt++
      ) {
        await startLogin(env, "ada@example.test");
      }

      const other = await startLogin(env, "grace@example.test");

      expect(other.status).toBe(202);
    });
  });

  test("one client address may only cause so many links, across mailboxes", async () => {
    await withStorage(async (_storage, env) => {
      const statuses: number[] = [];

      // A distinct address each time, so only the IP budget can be what runs
      // out — this is the mail-bombing case the per-address limit misses.
      for (
        let attempt = 0;
        attempt < LOGIN_RATE_LIMIT_PER_IP + 1;
        attempt++
      ) {
        statuses.push(
          (
            await startLogin(
              env,
              `student${attempt}@example.test`,
              "203.0.113.7",
            )
          ).status,
        );
      }

      expect(statuses.at(-2)).toBe(202);
      expect(statuses.at(-1)).toBe(429);

      // The budget is the caller's, not the world's.
      const elsewhere = await startLogin(
        env,
        "grace@example.test",
        "198.51.100.9",
      );

      expect(elsewhere.status).toBe(202);
    });
  });

  test("hits age out of the window, and the table is pruned as they do", async () => {
    await withStorage(async (storage) => {
      const auth = storage.stores.auth;
      const clock = { now: new Date("2026-01-02T03:04:05.000Z") };
      const limiter = createStoredLoginRateLimiter({
        auth,
        now: () => clock.now,
        windowSeconds: 60,
      });
      const input = { email: "ada@example.test", ipAddress: null };

      for (let attempt = 0; attempt < LOGIN_RATE_LIMIT_PER_EMAIL; attempt++) {
        await limiter.check(input);
      }

      await expect(limiter.check(input)).rejects.toThrow();

      clock.now = new Date("2026-01-02T03:05:06.000Z");

      // A minute later every earlier hit is outside the window, so the request
      // goes through — and the rows that no longer count are gone, rather than
      // accumulating for as long as the instance runs.
      await limiter.check(input);

      const remaining = await storage.db
        .prepare("SELECT COUNT(*) AS hits FROM login_rate_limit_hits")
        .first<{ hits: number }>();

      expect(remaining?.hits).toBe(1);
    });
  });

  test("nothing is charged to an address whose request was refused outright", async () => {
    await withStorage(async (storage, env) => {
      const response = await startLogin(env, "not-an-address");
      const hits = await storage.db
        .prepare("SELECT COUNT(*) AS hits FROM login_rate_limit_hits")
        .first<{ hits: number }>();

      expect(response.status).toBe(400);
      expect(hits?.hits).toBe(0);
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
