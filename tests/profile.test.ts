import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { Env } from "../src/worker/env";
import { appRequest, createTestApp } from "./helpers/app";
import { createTestStorage, type TestStorage } from "./helpers/storage";

setDefaultTimeout(30_000);

const NOW = "2026-01-02T03:04:05.000Z";

interface StartLoginResponse {
  readonly login: { readonly loginToken: string };
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
  readonly actorId: string;
  readonly cookieHeader: string;
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

function cookieHeader(response: Response): string {
  return setCookieHeaders(response)
    .map((cookie) => cookie.split(";")[0] ?? "")
    .join("; ");
}

async function login(
  env: Env,
  email = "Ada@Example.test",
  name = "Ada Lovelace",
): Promise<LoginResult> {
  const startResponse = await appRequest(
    createTestApp(),
    "/auth/login/start",
    jsonRequest({ email, name }),
    env,
  );
  const startBody = (await startResponse.json()) as StartLoginResponse;
  const confirmResponse = await appRequest(
    createTestApp(),
    "/auth/login/confirm",
    jsonRequest({ loginToken: startBody.login.loginToken }),
    env,
  );
  const body = (await confirmResponse.json()) as ConfirmLoginResponse;

  expect(confirmResponse.status).toBe(200);

  return {
    actorId: body.actor.id,
    cookieHeader: cookieHeader(confirmResponse),
    csrfToken: body.csrfToken,
  };
}

function removeIdentity(
  env: Env,
  session: LoginResult,
  identityId: string,
): Promise<Response> {
  return appRequest(
    createTestApp(),
    "/profile/identities/remove",
    {
      body: new URLSearchParams({ identityId }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: session.cookieHeader,
        "X-CSRF-Token": session.csrfToken,
      },
      method: "POST",
    },
    env,
  );
}

function saveProfile(
  env: Env,
  session: LoginResult,
  fields: Record<string, string>,
  options: { readonly csrf?: boolean } = {},
): Promise<Response> {
  const useCsrf = options.csrf ?? true;

  return appRequest(
    createTestApp(),
    "/profile",
    {
      body: new URLSearchParams(fields),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: session.cookieHeader,
        ...(useCsrf ? { "X-CSRF-Token": session.csrfToken } : {}),
      },
      method: "POST",
    },
    env,
  );
}

describe("profile page", () => {
  test("renders the account form prefilled with the user's details", async () => {
    await withStorage(async (_storage, env) => {
      const session = await login(env);
      const response = await appRequest(
        createTestApp(),
        "/profile",
        { headers: { Cookie: session.cookieHeader } },
        env,
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('name="name" value="Ada Lovelace"');
      expect(html).toContain("ada@example.test");
      expect(html).toContain("Sign-in");
      expect(html).toContain("Member since");
    });
  });

  test("redirects to the login page when signed out", async () => {
    await withStorage(async (_storage, env) => {
      const response = await appRequest(createTestApp(), "/profile", {}, env);

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/login?next=%2Fprofile");
    });
  });

  // One set of inputs and one Save: the language is a field of this form, not a
  // control beside it with a submit button of its own.
  test("one save writes every field the form carries", async () => {
    await withStorage(async ({ stores }, env) => {
      const session = await login(env);
      const response = await saveProfile(env, session, {
        locale: "de",
        name: "Grace Hopper",
      });

      expect(response.status).toBe(303);
      await expect(
        stores.users.getById(session.actorId),
      ).resolves.toMatchObject({ locale: "de", name: "Grace Hopper" });
    });
  });

  test("saves an updated display name", async () => {
    await withStorage(async ({ stores }, env) => {
      const session = await login(env);
      const saveResponse = await saveProfile(env, session, {
        name: "Ada, Countess of Lovelace",
      });

      expect(saveResponse.status).toBe(303);
      expect(saveResponse.headers.get("Location")).toBe("/profile?saved=1");

      const stored = await stores.users.getById(session.actorId);

      expect(stored?.name).toBe("Ada, Countess of Lovelace");

      const confirmation = await appRequest(
        createTestApp(),
        "/profile?saved=1",
        { headers: { Cookie: session.cookieHeader } },
        env,
      );
      const html = await confirmation.text();

      expect(html).toContain("Your profile has been saved.");
      expect(html).toContain('value="Ada, Countess of Lovelace"');
    });
  });

  test("trims a submitted name and clears a blank one", async () => {
    await withStorage(async ({ stores }, env) => {
      const session = await login(env);

      await saveProfile(env, session, { name: "  Grace Hopper  " });
      expect((await stores.users.getById(session.actorId))?.name).toBe(
        "Grace Hopper",
      );

      await saveProfile(env, session, { name: "   " });
      expect((await stores.users.getById(session.actorId))?.name).toBeNull();
    });
  });

  test("rejects a name longer than 200 characters", async () => {
    await withStorage(async ({ stores }, env) => {
      const session = await login(env);
      const response = await saveProfile(env, session, {
        name: "x".repeat(201),
      });
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain("Name must be 200 characters or less.");
      expect((await stores.users.getById(session.actorId))?.name).toBe(
        "Ada Lovelace",
      );
    });
  });

  test("requires a CSRF token to save", async () => {
    await withStorage(async ({ stores }, env) => {
      const session = await login(env);
      const response = await saveProfile(
        env,
        session,
        { name: "Mallory" },
        { csrf: false },
      );

      expect(response.status).toBe(403);
      expect((await stores.users.getById(session.actorId))?.name).toBe(
        "Ada Lovelace",
      );
    });
  });

  test("lists linked LMS access by platform name and removes it", async () => {
    await withStorage(async ({ stores }, env) => {
      const session = await login(env);
      const platform = await stores.lti.createPlatform({
        id: "lti-platform-1",
        name: "Campus Moodle",
        issuer: "https://lms.example.test",
        clientId: "client-1",
        authorizationEndpoint: "https://lms.example.test/auth",
        tokenEndpoint: "https://lms.example.test/token",
        jwksUri: "https://lms.example.test/jwks",
        createdAt: NOW,
      });

      await stores.users.createExternalIdentity({
        id: "identity-lti-1",
        userId: session.actorId,
        provider: "lti",
        providerSubject: `${platform.id}:lms-user-9`,
        createdAt: NOW,
      });

      const page = await appRequest(
        createTestApp(),
        "/profile",
        { headers: { Cookie: session.cookieHeader } },
        env,
      );
      const html = await page.text();

      expect(html).toContain("Linked LMS access");
      expect(html).toContain("Campus Moodle");

      const removed = await removeIdentity(env, session, "identity-lti-1");

      expect(removed.status).toBe(303);
      await expect(
        stores.users.getExternalIdentity("lti", `${platform.id}:lms-user-9`),
      ).resolves.toBeNull();
    });
  });

  test("the native email identity cannot be removed", async () => {
    await withStorage(async ({ stores }, env) => {
      const session = await login(env);
      const identities = await stores.users.listExternalIdentitiesForUser(
        session.actorId,
      );
      const native = identities.find(
        (identity) => identity.provider === "native",
      );

      if (native === undefined) {
        throw new Error("Expected a native identity after login.");
      }

      const response = await removeIdentity(env, session, native.id);

      expect(await response.text()).toContain(
        "Email sign-in cannot be removed",
      );
      await expect(
        stores.users.getExternalIdentity("native", "ada@example.test"),
      ).resolves.not.toBeNull();
    });
  });

  test("only the account owner's identities can be removed", async () => {
    await withStorage(async ({ stores }, env) => {
      const session = await login(env);
      const other = await stores.users.create({
        id: "user-other",
        email: "other@example.test",
        name: null,
        createdAt: NOW,
      });

      await stores.users.createExternalIdentity({
        id: "identity-other",
        userId: other.id,
        provider: "lti",
        providerSubject: "platform-x:lms-user-x",
        createdAt: NOW,
      });

      const response = await removeIdentity(env, session, "identity-other");

      expect(await response.text()).toContain(
        "The linked identity was not found on your account.",
      );
      await expect(
        stores.users.getExternalIdentity("lti", "platform-x:lms-user-x"),
      ).resolves.not.toBeNull();
    });
  });
});
