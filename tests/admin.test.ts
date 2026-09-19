import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { Env } from "../src/worker/env";
import { grantTestCourseCreator } from "./helpers/admin";
import { appRequest, createTestApp } from "./helpers/app";
import {
  ACCEPT_JSON,
  authHeaders,
  jsonRequest,
  type LoginResult,
  login,
  withStorage,
} from "./helpers/http";

setDefaultTimeout(30_000);

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

/** Signed in and asking for JSON: the admin routes answer HTML otherwise. */
function adminHeaders(login: LoginResult): Record<string, string> {
  return { ...authHeaders(login), ...ACCEPT_JSON };
}

async function bootstrapAdmin(env: Env, admin: LoginResult): Promise<void> {
  const response = await appRequest(
    createTestApp(),
    "/admin/bootstrap",
    jsonRequest({}, admin, ACCEPT_JSON),
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
    jsonRequest({ capability }, admin, ACCEPT_JSON),
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

      await grantTestCourseCreator(env, instructor.actorId);

      const courseResponse = await appRequest(
        createTestApp(),
        "/courses",
        jsonRequest(
          { title: "Logic", timezone: "UTC" },
          instructor,
          ACCEPT_JSON,
        ),
        env,
      );
      const response = await appRequest(
        createTestApp(),
        "/admin/users?query=instructor",
        { headers: adminHeaders(instructor) },
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
        target.actorId,
        "course_creator",
      );
      const revokeResponse = await appRequest(
        createTestApp(),
        `/admin/users/${target.actorId}/capabilities/revoke`,
        jsonRequest({ capability: "course_creator" }, admin, ACCEPT_JSON),
        env,
      );
      const auditResponse = await appRequest(
        createTestApp(),
        "/admin/audit",
        { headers: adminHeaders(admin) },
        env,
      );
      const audit = (await auditResponse.json()) as AuditResponse;

      expect(granted.capability.capability).toBe("course_creator");
      expect(granted.capability.userId).toBe(target.actorId);
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
      await grantCapability(env, admin, support.actorId, "support_operator");

      const denied = await appRequest(
        createTestApp(),
        `/admin/users/${target.actorId}/capabilities`,
        jsonRequest({ capability: "site_admin" }, support, ACCEPT_JSON),
        env,
      );
      const auditResponse = await appRequest(
        createTestApp(),
        "/admin/audit",
        { headers: adminHeaders(admin) },
        env,
      );
      const audit = (await auditResponse.json()) as AuditResponse;

      expect(denied.status).toBe(403);
      expect(
        audit.events.filter(
          (event) =>
            event.action === "admin.grant_platform_capability" &&
            event.targetUserId === target.actorId,
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
        `/admin/users/${target.actorId}/suspend`,
        jsonRequest({}, admin, ACCEPT_JSON),
        env,
      );
      const meResponse = await appRequest(
        createTestApp(),
        "/auth/me",
        { headers: adminHeaders(target) },
        env,
      );
      const startResponse = await appRequest(
        createTestApp(),
        "/auth/login/start",
        jsonRequest({ email: "blocked@example.test" }),
        env,
      );
      const startBody = (await startResponse.json()) as {
        login: { loginToken: string };
      };
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
      await grantTestCourseCreator(env, instructor.actorId);

      const courseResponse = await appRequest(
        createTestApp(),
        "/courses",
        jsonRequest(
          { title: "Logic", timezone: "UTC" },
          instructor,
          ACCEPT_JSON,
        ),
        env,
      );
      const courseBody = (await courseResponse.json()) as {
        readonly course: { readonly id: string };
      };
      const membershipResponse = await appRequest(
        createTestApp(),
        "/admin/memberships",
        jsonRequest(
          {
            courseId: courseBody.course.id,
            role: "student",
            status: "active",
            userId: user.actorId,
          },
          admin,
          ACCEPT_JSON,
        ),
        env,
      );
      const auditResponse = await appRequest(
        createTestApp(),
        "/admin/audit",
        { headers: adminHeaders(admin) },
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
