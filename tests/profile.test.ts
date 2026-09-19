import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { Env } from "../src/worker/env";
import { appRequest, createTestApp } from "./helpers/app";
import {
  type LoginResult,
  login as signIn,
  withStorage,
} from "./helpers/http";

setDefaultTimeout(30_000);

const NOW = "2026-01-02T03:04:05.000Z";

/**
 * Sign in, and save a name unless the caller wants the account left as a new
 * one really is: nameless. The two steps are two requests because the login
 * flow no longer accepts a name — it is the account owner's to set, signed in,
 * on this very form.
 */
async function login(
  env: Env,
  email = "Ada@Example.test",
  name: string | null = "Ada Lovelace",
): Promise<LoginResult> {
  const session = await signIn(env, email);

  if (name !== null) {
    expect(
      (await saveProfile(env, session, { locale: "", name })).status,
    ).toBe(303);
  }

  return session;
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
      // No student ID on an account no LMS has launched into, and no empty
      // field where one would go.
      expect(html).not.toContain("Student ID");
    });
  });

  // Shown so that someone whose grades are being matched against a roster can
  // see which number they are matched by — and shown read-only, with no input
  // the form posts back, because the value is the institution's assertion about
  // them rather than a preference of theirs.
  test("shows an LMS-supplied student ID without offering to edit it", async () => {
    await withStorage(async ({ stores }, env) => {
      const session = await login(env);

      await stores.users.adoptStudentId(session.actorId, "20261234", NOW);

      const response = await appRequest(
        createTestApp(),
        "/profile",
        { headers: { Cookie: session.cookieHeader } },
        env,
      );
      const html = await response.text();

      expect(html).toContain("Student ID");
      expect(html).toContain('<input readonly="" value="20261234"/>');
      expect(html).not.toContain('name="studentId"');
    });
  });

  // The field is not on the form, so a post that names it anyway is ignored
  // rather than honoured: there is no route by which a person can choose the
  // identifier their institution knows them by.
  test("a student ID cannot be set by posting one", async () => {
    await withStorage(async ({ stores }, env) => {
      const session = await login(env);
      const response = await saveProfile(env, session, {
        name: "Ada Lovelace",
        studentId: "99999999",
      });

      expect(response.status).toBe(303);
      await expect(
        stores.users.getById(session.actorId),
      ).resolves.toMatchObject({ studentId: null });
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

/**
 * The other half of taking the name off the login form: what the login form
 * stopped asking for, this asks for once the person is signed in and can answer
 * for themselves.
 */
describe("incomplete profile prompt", () => {
  const PROMPT = "Your work shows up under your email address";

  function page(
    env: Env,
    session: LoginResult,
    path = "/courses",
  ): Promise<Response> {
    return appRequest(
      createTestApp(),
      path,
      { headers: { Accept: "text/html", Cookie: session.cookieHeader } },
      env,
    );
  }

  test("asks a nameless account for a name, and stops once it has one", async () => {
    await withStorage(async (_storage, env) => {
      const session = await login(env, "Ada@Example.test", null);
      const before = await page(env, session);

      expect(before.status).toBe(200);

      const html = await before.text();

      expect(html).toContain(PROMPT);
      expect(html).toContain('action="/profile/prompt/dismiss"');
      // Inside the main landmark rather than loose between the header and it.
      expect(html).toContain(
        '<main class="page-shell"><div class="profile-prompt">',
      );

      expect(
        (await saveProfile(env, session, { locale: "", name: "Ada" })).status,
      ).toBe(303);

      expect(await (await page(env, session)).text()).not.toContain(PROMPT);
    });
  });

  // It offers to take you to the name field, so on the page holding that field
  // it would be pointing at itself.
  test("stays off the profile page", async () => {
    await withStorage(async (_storage, env) => {
      const session = await login(env, "Ada@Example.test", null);

      expect(
        await (await page(env, session, "/profile")).text(),
      ).not.toContain(PROMPT);
      expect(await (await page(env, session)).text()).toContain(PROMPT);
    });
  });

  test("a blank name is no name at all", async () => {
    await withStorage(async (_storage, env) => {
      const session = await login(env, "Ada@Example.test", "   ");

      expect(await (await page(env, session)).text()).toContain(PROMPT);
    });
  });

  test("dismissing it puts it away and returns to the page asking", async () => {
    await withStorage(async (_storage, env) => {
      const session = await login(env, "Ada@Example.test", null);
      const dismissed = await appRequest(
        createTestApp(),
        "/profile/prompt/dismiss",
        {
          body: new URLSearchParams({ next: "/courses?page=2" }),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: session.cookieHeader,
            "X-CSRF-Token": session.csrfToken,
          },
          method: "POST",
        },
        env,
      );
      const cookie = dismissed.headers.get("set-cookie") ?? "";

      expect(dismissed.status).toBe(303);
      expect(dismissed.headers.get("Location")).toBe("/courses?page=2");
      // For this browsing session only: an account still showing up as an email
      // address in the gradebook is worth asking about again next time.
      expect(cookie).toContain("carnap_profile_prompt=dismissed");
      expect(cookie).not.toContain("Max-Age");

      const withCookie = await appRequest(
        createTestApp(),
        "/courses",
        {
          headers: {
            Accept: "text/html",
            Cookie: `${session.cookieHeader}; carnap_profile_prompt=dismissed`,
          },
        },
        env,
      );

      expect(await withCookie.text()).not.toContain(PROMPT);
    });
  });

  test("an off-site next is refused", async () => {
    await withStorage(async (_storage, env) => {
      const session = await login(env, "Ada@Example.test", null);
      const dismissed = await appRequest(
        createTestApp(),
        "/profile/prompt/dismiss",
        {
          body: new URLSearchParams({ next: "//evil.example" }),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: session.cookieHeader,
            "X-CSRF-Token": session.csrfToken,
          },
          method: "POST",
        },
        env,
      );

      expect(dismissed.status).toBe(303);
      expect(dismissed.headers.get("Location")).toBe("/courses");
    });
  });

  test("requires a CSRF token to dismiss", async () => {
    await withStorage(async (_storage, env) => {
      const session = await login(env, "Ada@Example.test", null);
      const dismissed = await appRequest(
        createTestApp(),
        "/profile/prompt/dismiss",
        {
          body: new URLSearchParams({ next: "/courses" }),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: session.cookieHeader,
          },
          method: "POST",
        },
        env,
      );

      expect(dismissed.status).toBe(403);
      expect(dismissed.headers.get("set-cookie") ?? "").not.toContain(
        "carnap_profile_prompt",
      );
    });
  });
});
