import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { Env } from "../src/worker/env";
import { grantTestCourseCreator } from "./helpers/admin";
import { appRequest, createTestApp } from "./helpers/app";
import { createTestStorage, type TestStorage } from "./helpers/storage";

setDefaultTimeout(30_000);

interface StartLoginResponse {
  readonly login: {
    readonly loginToken: string;
  };
}

interface LoginResponse {
  readonly actor: {
    readonly id: string;
    readonly email: string;
  };
  readonly csrfToken: string;
}

interface LoginResult {
  readonly body: LoginResponse;
  readonly cookieHeader: string;
  readonly csrfToken: string;
}

interface CapabilityResponse {
  readonly capability: {
    readonly capability: string;
    readonly userId: string;
  };
}

interface AuditResponse {
  readonly events: readonly {
    readonly action: string;
    readonly actorUserId: string;
    readonly requestId: string;
    readonly targetUserId: string | null;
  }[];
}

interface ErrorResponse {
  readonly error: {
    readonly code: string;
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
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(csrfToken === undefined ? {} : { "X-CSRF-Token": csrfToken }),
    },
    method: "POST",
  };
}

function authHeaders(login: LoginResult) {
  return {
    Accept: "application/json",
    Cookie: login.cookieHeader,
    "X-CSRF-Token": login.csrfToken,
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

async function bootstrapAdmin(env: Env, admin: LoginResult): Promise<void> {
  const response = await appRequest(
    createTestApp(),
    "/admin/bootstrap",
    {
      ...jsonRequest({}, admin.csrfToken),
      headers: {
        ...authHeaders(admin),
        "Content-Type": "application/json",
      },
    },
    env,
  );

  expect(response.status).toBe(201);
}

async function grantCapability(
  env: Env,
  admin: LoginResult,
  userId: string,
  capability: string,
): Promise<CapabilityResponse> {
  const response = await appRequest(
    createTestApp(),
    `/admin/users/${userId}/capabilities`,
    {
      ...jsonRequest({ capability }, admin.csrfToken),
      headers: {
        ...authHeaders(admin),
        "Content-Type": "application/json",
      },
    },
    env,
  );
  const body = (await response.json()) as CapabilityResponse;

  expect(response.status).toBe(201);

  return body;
}

describe("platform administration", () => {
  test("course instructor status does not grant platform admin", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");

      await grantTestCourseCreator(env, instructor.body.actor.id);

      const courseResponse = await appRequest(
        createTestApp(),
        "/courses",
        {
          ...jsonRequest(
            { title: "Logic", timezone: "UTC" },
            instructor.csrfToken,
          ),
          headers: {
            ...authHeaders(instructor),
            "Content-Type": "application/json",
          },
        },
        env,
      );
      const response = await appRequest(
        createTestApp(),
        "/admin/users?query=instructor",
        { headers: authHeaders(instructor) },
        env,
      );
      const body = (await response.json()) as ErrorResponse;

      expect(courseResponse.status).toBe(201);
      expect(response.status).toBe(403);
      expect(body.error.code).toBe("platform_capability_required");
    });
  });

  test("a site admin can grant and revoke course creator", async () => {
    await withStorage(async (_storage, env) => {
      const admin = await login(env, "admin@example.test");
      const target = await login(env, "teacher@example.test");

      await bootstrapAdmin(env, admin);

      const granted = await grantCapability(
        env,
        admin,
        target.body.actor.id,
        "course_creator",
      );
      const revokeResponse = await appRequest(
        createTestApp(),
        `/admin/users/${target.body.actor.id}/capabilities/revoke`,
        {
          ...jsonRequest({ capability: "course_creator" }, admin.csrfToken),
          headers: {
            ...authHeaders(admin),
            "Content-Type": "application/json",
          },
        },
        env,
      );
      const auditResponse = await appRequest(
        createTestApp(),
        "/admin/audit",
        { headers: authHeaders(admin) },
        env,
      );
      const audit = (await auditResponse.json()) as AuditResponse;

      expect(granted.capability.capability).toBe("course_creator");
      expect(granted.capability.userId).toBe(target.body.actor.id);
      expect(revokeResponse.status).toBe(200);
      expect(audit.events.map((event) => event.action)).toContain(
        "admin.grant_platform_capability",
      );
      expect(audit.events.map((event) => event.action)).toContain(
        "admin.revoke_platform_capability",
      );
    });
  });

  test("a support operator cannot grant site admin", async () => {
    await withStorage(async (_storage, env) => {
      const admin = await login(env, "admin@example.test");
      const support = await login(env, "support@example.test");
      const target = await login(env, "target@example.test");

      await bootstrapAdmin(env, admin);
      await grantCapability(
        env,
        admin,
        support.body.actor.id,
        "support_operator",
      );

      const denied = await appRequest(
        createTestApp(),
        `/admin/users/${target.body.actor.id}/capabilities`,
        {
          ...jsonRequest({ capability: "site_admin" }, support.csrfToken),
          headers: {
            ...authHeaders(support),
            "Content-Type": "application/json",
          },
        },
        env,
      );
      const auditResponse = await appRequest(
        createTestApp(),
        "/admin/audit",
        { headers: authHeaders(admin) },
        env,
      );
      const audit = (await auditResponse.json()) as AuditResponse;

      expect(denied.status).toBe(403);
      expect(
        audit.events.filter(
          (event) =>
            event.action === "admin.grant_platform_capability" &&
            event.targetUserId === target.body.actor.id,
        ),
      ).toHaveLength(0);
    });
  });

  test("suspension rejects existing sessions and future login", async () => {
    await withStorage(async (_storage, env) => {
      const admin = await login(env, "admin@example.test");
      const target = await login(env, "blocked@example.test");

      await bootstrapAdmin(env, admin);

      const suspendResponse = await appRequest(
        createTestApp(),
        `/admin/users/${target.body.actor.id}/suspend`,
        {
          ...jsonRequest({}, admin.csrfToken),
          headers: {
            ...authHeaders(admin),
            "Content-Type": "application/json",
          },
        },
        env,
      );
      const meResponse = await appRequest(
        createTestApp(),
        "/auth/me",
        { headers: authHeaders(target) },
        env,
      );
      const startResponse = await appRequest(
        createTestApp(),
        "/auth/login/start",
        jsonRequest({ email: "blocked@example.test" }),
        env,
      );
      const startBody = (await startResponse.json()) as StartLoginResponse;
      const confirmResponse = await appRequest(
        createTestApp(),
        "/auth/login/confirm",
        jsonRequest({ loginToken: startBody.login.loginToken }),
        env,
      );

      expect(suspendResponse.status).toBe(200);
      expect(meResponse.status).toBe(403);
      expect(startResponse.status).toBe(202);
      expect(confirmResponse.status).toBe(403);
    });
  });

  test("support membership changes are audited", async () => {
    await withStorage(async (_storage, env) => {
      const admin = await login(env, "admin@example.test");
      const user = await login(env, "student@example.test");
      const instructor = await login(env, "instructor@example.test");

      await bootstrapAdmin(env, admin);
      await grantTestCourseCreator(env, instructor.body.actor.id);

      const courseResponse = await appRequest(
        createTestApp(),
        "/courses",
        {
          ...jsonRequest(
            { title: "Logic", timezone: "UTC" },
            instructor.csrfToken,
          ),
          headers: {
            ...authHeaders(instructor),
            "Content-Type": "application/json",
          },
        },
        env,
      );
      const courseBody = (await courseResponse.json()) as {
        readonly course: { readonly id: string };
      };
      const membershipResponse = await appRequest(
        createTestApp(),
        "/admin/memberships",
        {
          ...jsonRequest(
            {
              courseId: courseBody.course.id,
              role: "student",
              status: "active",
              userId: user.body.actor.id,
            },
            admin.csrfToken,
          ),
          headers: {
            ...authHeaders(admin),
            "Content-Type": "application/json",
          },
        },
        env,
      );
      const auditResponse = await appRequest(
        createTestApp(),
        "/admin/audit",
        { headers: authHeaders(admin) },
        env,
      );
      const audit = (await auditResponse.json()) as AuditResponse;

      expect(courseResponse.status).toBe(201);
      expect(membershipResponse.status).toBe(200);
      expect(audit.events.map((event) => event.action)).toContain(
        "admin.change_course_membership",
      );
    });
  });
});
