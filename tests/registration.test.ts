import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { Env } from "../src/worker/env";
import { bootstrapTestAdmin } from "./helpers/admin";
import { appRequest, createTestApp } from "./helpers/app";
import {
  ACCEPT_JSON,
  authHeaders,
  createCourse,
  jsonRequest,
  type LoginResult,
  login,
  withStorage,
} from "./helpers/http";

setDefaultTimeout(30_000);

/**
 * Who may create an account by email sign-in: the `nativeRegistration` site
 * setting. Whatever it says, an account that exists signs in, and the refusal
 * comes only once the link is opened, so the login form answers every address
 * alike.
 */

interface ErrorResponse {
  readonly error: { readonly code: string };
}

async function setRegistration(
  env: Env,
  admin: LoginResult,
  mode: string,
): Promise<Response> {
  return appRequest(
    createTestApp(),
    "/admin/settings/registration",
    jsonRequest({ mode }, admin, ACCEPT_JSON),
    env,
  );
}

/** An admin, with the setting changed to `mode`. */
async function siteWith(env: Env, mode: string): Promise<LoginResult> {
  const admin = await login(env, "admin@example.test");

  await bootstrapTestAdmin(env, admin);
  expect((await setRegistration(env, admin, mode)).status).toBe(200);

  return admin;
}

/** Start a JSON sign-in and confirm it, returning the confirmation. */
async function confirmJson(
  env: Env,
  email: string,
  extra: Record<string, string> = {},
): Promise<Response> {
  const start = await appRequest(
    createTestApp(),
    "/auth/login/start",
    jsonRequest({ email }),
    env,
  );

  expect(start.status).toBe(202);

  const { login: started } = (await start.json()) as {
    readonly login: { readonly loginToken: string };
  };

  return appRequest(
    createTestApp(),
    "/auth/login/confirm",
    jsonRequest({ loginToken: started.loginToken, ...extra }),
    env,
  );
}

/**
 * The browser's way in: the login form, with `next` where the reader was
 * headed, and then the link `CARNAP_ENV=local` prints instead of mailing it.
 */
async function followLoginLink(
  env: Env,
  email: string,
  next: string,
): Promise<Response> {
  const sent = await appRequest(
    createTestApp(),
    "/login",
    {
      body: new URLSearchParams({ email, next }).toString(),
      headers: {
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
    env,
  );
  const html = await sent.text();
  const href = html.match(/href="([^"]*\/login\/confirm[^"]*)"/)?.[1];

  expect(sent.status).toBe(200);
  expect(href).toBeDefined();

  // The link's page only asks; its button's POST is what signs in, or
  // refuses to.
  const link = (href ?? "").replaceAll("&amp;", "&");
  const page = await appRequest(
    createTestApp(),
    link,
    { headers: { Accept: "text/html" } },
    env,
  );

  expect(page.status).toBe(200);

  const params = new URL(link, "http://x").searchParams;

  return appRequest(
    createTestApp(),
    "/login/confirm",
    {
      body: new URLSearchParams({
        next: params.get("next") ?? "",
        token: params.get("token") ?? "",
      }).toString(),
      headers: {
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
    env,
  );
}

async function enrollmentToken(
  env: Env,
  instructor: LoginResult,
  courseId: string,
): Promise<string> {
  const response = await appRequest(
    createTestApp(),
    `/courses/${courseId}/enrollment-links`,
    jsonRequest({}, instructor),
    env,
  );
  const body = (await response.json()) as {
    readonly enrollmentLink: { readonly token: string };
  };

  expect(response.status).toBe(201);

  return body.enrollmentLink.token;
}

describe("native registration setting", () => {
  test("public by default: a new address gets an account", async () => {
    await withStorage(async (_storage, env) => {
      const response = await confirmJson(env, "new@example.test");

      expect(response.status).toBe(200);
    });
  });

  test("LMS-only refuses a new address at confirmation, and signs in existing accounts", async () => {
    await withStorage(async (storage, env) => {
      const existing = await login(env, "existing@example.test");

      await siteWith(env, "lms_only");

      // An account an LTI launch made: a users row, no native identity yet.
      await storage.stores.users.create({
        createdAt: "2026-01-02T03:04:05.000Z",
        email: "from-lms@example.test",
        id: "0190a000-0000-7000-8000-000000000001",
        name: null,
      });

      const refused = await confirmJson(env, "stranger@example.test");
      const body = (await refused.json()) as ErrorResponse;

      expect(refused.status).toBe(403);
      expect(body.error.code).toBe("registration_closed");
      expect(
        await storage.stores.users.getByEmail("stranger@example.test"),
      ).toBeNull();

      expect((await confirmJson(env, "existing@example.test")).status).toBe(
        200,
      );
      expect((await confirmJson(env, "from-lms@example.test")).status).toBe(
        200,
      );

      const me = await appRequest(
        createTestApp(),
        "/auth/me",
        { headers: authHeaders(existing) },
        env,
      );

      expect(me.status).toBe(200);
    });
  });

  test("the login form answers a new and a known address alike, and the link says why it failed", async () => {
    await withStorage(async (_storage, env) => {
      await siteWith(env, "lms_only");

      const page = await followLoginLink(env, "stranger@example.test", "/");
      const html = await page.text();

      expect(page.status).toBe(403);
      expect(html).toContain("There is no account for this email address.");
      expect(html).toContain("learning management system");
    });
  });

  test("link-only admits a new address only through a valid enrollment link", async () => {
    await withStorage(async (storage, env) => {
      const admin = await siteWith(env, "link_only");
      const courseId = await createCourse(env, admin);
      const token = await enrollmentToken(env, admin, courseId);

      const without = await followLoginLink(
        env,
        "nolink@example.test",
        "/courses",
      );
      const bogus = await followLoginLink(
        env,
        "bogus@example.test",
        "/enrollments/aenr_not-a-real-link",
      );

      expect(without.status).toBe(403);
      expect(await without.text()).toContain("enrollment link");
      expect(bogus.status).toBe(403);

      const invited = await followLoginLink(
        env,
        "invited@example.test",
        `/enrollments/${token}`,
      );

      expect(invited.status).toBe(303);
      expect(invited.headers.get("Location")).toBe(`/enrollments/${token}`);
      expect(
        await storage.stores.users.getByEmail("invited@example.test"),
      ).not.toBeNull();

      // The JSON route takes the link's token directly.
      const viaJson = await confirmJson(env, "api@example.test", {
        enrollmentToken: token,
      });

      expect(viaJson.status).toBe(200);
    });
  });

  test("only a site admin changes the setting, and each change is audited", async () => {
    await withStorage(async (_storage, env) => {
      const other = await login(env, "other@example.test");
      const admin = await siteWith(env, "link_only");
      const unchanged = await setRegistration(env, admin, "link_only");
      const invalid = await setRegistration(env, admin, "closed");
      const forbidden = await setRegistration(env, other, "public");

      expect(unchanged.status).toBe(200);
      expect(invalid.status).toBe(400);
      expect(forbidden.status).toBe(403);

      const audit = await appRequest(
        createTestApp(),
        "/admin/audit",
        { headers: { ...authHeaders(admin), ...ACCEPT_JSON } },
        env,
      );
      const { events } = (await audit.json()) as {
        readonly events: readonly {
          readonly action: string;
          readonly metadata: unknown;
        }[];
      };
      const changes = events.filter(
        (event) => event.action === "admin.change_native_registration",
      );

      // One row: setting the value it already had wrote nothing.
      expect(changes).toHaveLength(1);
      expect(changes[0]?.metadata).toEqual({
        from: "public",
        to: "link_only",
      });
    });
  });
});
