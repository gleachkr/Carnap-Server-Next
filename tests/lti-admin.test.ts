import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { Env } from "../src/worker/env";
import { appRequest, createTestApp } from "./helpers/app";
import {
  ACCEPT_JSON,
  jsonRequest,
  type LoginResult,
  login,
  withStorage,
} from "./helpers/http";
import {
  createLtiTestApp,
  INSTRUCTOR_ROLE,
  performLaunch,
  TEST_CLIENT_ID,
  TEST_DEPLOYMENT_ID,
  TEST_ISSUER,
} from "./helpers/lti";

setDefaultTimeout(30_000);

interface PlatformResponse {
  readonly platform: {
    readonly clientId: string;
    readonly disabledAt: string | null;
    readonly id: string;
    readonly issuer: string;
  };
}

interface DeploymentResponse {
  readonly deployment: {
    readonly deploymentId: string;
    readonly id: string;
    readonly platformId: string;
  };
}

interface PlatformListResponse {
  readonly platforms: readonly {
    readonly deployments: readonly { readonly deploymentId: string }[];
    readonly platform: { readonly id: string; readonly name: string };
  }[];
}

interface ErrorResponse {
  readonly error: { readonly code: string };
}

const PLATFORM_FIELDS = {
  authorizationEndpoint: `${TEST_ISSUER}/auth`,
  clientId: TEST_CLIENT_ID,
  issuer: TEST_ISSUER,
  jwksUri: `${TEST_ISSUER}/jwks`,
  name: "Campus LMS",
  tokenEndpoint: `${TEST_ISSUER}/token`,
};

async function adminRequest(
  env: Env,
  admin: LoginResult,
  path: string,
  body: unknown,
): Promise<Response> {
  return appRequest(
    createTestApp(),
    path,
    jsonRequest(body, admin, ACCEPT_JSON),
    env,
  );
}

async function bootstrapAdmin(env: Env, admin: LoginResult): Promise<void> {
  const response = await adminRequest(env, admin, "/admin/bootstrap", {});

  expect(response.status).toBe(201);
}

async function siteAdmin(env: Env): Promise<LoginResult> {
  const admin = await login(env, "admin@example.test");

  await bootstrapAdmin(env, admin);

  return admin;
}

describe("LTI platform administration", () => {
  test("a site admin registers a platform and deployment, audited", async () => {
    await withStorage(async (storage, env) => {
      const admin = await siteAdmin(env);
      const registered = await adminRequest(
        env,
        admin,
        "/admin/lti/platforms",
        PLATFORM_FIELDS,
      );

      expect(registered.status).toBe(201);

      const { platform } = (await registered.json()) as PlatformResponse;

      expect(platform.issuer).toBe(TEST_ISSUER);

      const deploymentResponse = await adminRequest(
        env,
        admin,
        `/admin/lti/platforms/${platform.id}/deployments`,
        { deploymentId: TEST_DEPLOYMENT_ID, name: "Main" },
      );

      expect(deploymentResponse.status).toBe(201);

      const list = await appRequest(
        createTestApp(),
        "/admin/lti",
        {
          headers: {
            Accept: "application/json",
            Cookie: admin.cookieHeader,
          },
        },
        env,
      );
      const listBody = (await list.json()) as PlatformListResponse;

      expect(listBody.platforms).toHaveLength(1);
      expect(listBody.platforms[0]?.deployments[0]?.deploymentId).toBe(
        TEST_DEPLOYMENT_ID,
      );

      const audits = await storage.stores.adminAudit.listRecent(10);
      const actions = audits.map((event) => event.action);

      expect(actions).toContain("admin.lti_platform_registered");
      expect(actions).toContain("admin.lti_deployment_added");
      expect(audits.every((event) => event.requestId.length > 0)).toBe(true);
    });
  });

  test("registration requires the site_admin capability", async () => {
    await withStorage(async (_storage, env) => {
      await siteAdmin(env);

      const outsider = await login(env, "user@example.test");
      const response = await adminRequest(
        env,
        outsider,
        "/admin/lti/platforms",
        PLATFORM_FIELDS,
      );

      expect(response.status).toBe(403);

      const body = (await response.json()) as ErrorResponse;

      expect(body.error.code).toBe("platform_capability_required");
    });
  });

  test("duplicate platforms and deployments are rejected", async () => {
    await withStorage(async (_storage, env) => {
      const admin = await siteAdmin(env);
      const first = await adminRequest(
        env,
        admin,
        "/admin/lti/platforms",
        PLATFORM_FIELDS,
      );
      const { platform } = (await first.json()) as PlatformResponse;
      const duplicate = await adminRequest(
        env,
        admin,
        "/admin/lti/platforms",
        PLATFORM_FIELDS,
      );

      expect(duplicate.status).toBe(400);
      expect(((await duplicate.json()) as ErrorResponse).error.code).toBe(
        "lti_platform_duplicate",
      );

      await adminRequest(
        env,
        admin,
        `/admin/lti/platforms/${platform.id}/deployments`,
        { deploymentId: TEST_DEPLOYMENT_ID },
      );

      const duplicateDeployment = await adminRequest(
        env,
        admin,
        `/admin/lti/platforms/${platform.id}/deployments`,
        { deploymentId: TEST_DEPLOYMENT_ID },
      );

      expect(duplicateDeployment.status).toBe(400);
      expect(
        ((await duplicateDeployment.json()) as ErrorResponse).error.code,
      ).toBe("lti_deployment_duplicate");
    });
  });

  test("endpoints must be http(s) URLs", async () => {
    await withStorage(async (_storage, env) => {
      const admin = await siteAdmin(env);
      const response = await adminRequest(
        env,
        admin,
        "/admin/lti/platforms",
        {
          ...PLATFORM_FIELDS,
          jwksUri: "not a url",
        },
      );

      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorResponse).error.code).toBe(
        "invalid_platform_jwks_uri",
      );
    });
  });

  test("a platform registered through the admin API accepts a real launch", async () => {
    await withStorage(async (_storage, env) => {
      const admin = await siteAdmin(env);
      const registered = await adminRequest(
        env,
        admin,
        "/admin/lti/platforms",
        PLATFORM_FIELDS,
      );
      const { platform } = (await registered.json()) as PlatformResponse;

      await adminRequest(
        env,
        admin,
        `/admin/lti/platforms/${platform.id}/deployments`,
        { deploymentId: TEST_DEPLOYMENT_ID },
      );

      const ltiApp = await createLtiTestApp();
      const launch = await performLaunch(ltiApp, env, {
        email: "teacher@example.test",
        roles: [INSTRUCTOR_ROLE],
        sub: "lms-teacher-1",
      });

      expect(launch.response.status).toBe(303);

      // Disabling the platform stops further launches.
      const disabled = await adminRequest(
        env,
        admin,
        `/admin/lti/platforms/${platform.id}/disable`,
        {},
      );

      expect(disabled.status).toBe(200);

      const blockedLogin = await appRequest(
        ltiApp,
        `/lti/login?iss=${encodeURIComponent(TEST_ISSUER)}&login_hint=u&client_id=${TEST_CLIENT_ID}`,
        {},
        env,
      );

      expect(blockedLogin.status).toBe(400);

      // Re-enabling restores launches.
      const enabled = await adminRequest(
        env,
        admin,
        `/admin/lti/platforms/${platform.id}/enable`,
        {},
      );

      expect(enabled.status).toBe(200);

      const relaunch = await performLaunch(ltiApp, env, {
        email: "teacher@example.test",
        roles: [INSTRUCTOR_ROLE],
        sub: "lms-teacher-1",
      });

      expect(relaunch.response.status).toBe(303);
    });
  });

  test("deployments can be removed, blocking their launches", async () => {
    await withStorage(async (_storage, env) => {
      const admin = await siteAdmin(env);
      const registered = await adminRequest(
        env,
        admin,
        "/admin/lti/platforms",
        PLATFORM_FIELDS,
      );
      const { platform } = (await registered.json()) as PlatformResponse;
      const added = await adminRequest(
        env,
        admin,
        `/admin/lti/platforms/${platform.id}/deployments`,
        { deploymentId: TEST_DEPLOYMENT_ID },
      );
      const { deployment } = (await added.json()) as DeploymentResponse;
      const removed = await adminRequest(
        env,
        admin,
        `/admin/lti/platforms/${platform.id}/deployments/${deployment.id}/remove`,
        {},
      );

      expect(removed.status).toBe(204);

      const ltiApp = await createLtiTestApp();
      const launch = await performLaunch(ltiApp, env, {
        roles: [INSTRUCTOR_ROLE],
      });

      expect(launch.response.status).toBe(400);
      expect(await launch.response.text()).toContain(
        "lti_deployment_unknown",
      );

      const removeAgain = await adminRequest(
        env,
        admin,
        `/admin/lti/platforms/${platform.id}/deployments/${deployment.id}/remove`,
        {},
      );

      expect(removeAgain.status).toBe(404);
    });
  });
});
