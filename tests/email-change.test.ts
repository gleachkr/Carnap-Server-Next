import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { Env } from "../src/worker/env";
import { grantTestCapability } from "./helpers/admin";
import { appRequest, createTestApp } from "./helpers/app";
import { capturingEmail, EMAIL_ENV, type SentEmail } from "./helpers/email";
import {
  cookieHeader,
  jsonRequest,
  type LoginResult,
  login,
  withStorage,
} from "./helpers/http";

setDefaultTimeout(30_000);

const NOW = "2026-01-02T03:04:05.000Z";

function form(
  env: Env,
  path: string,
  fields: Record<string, string>,
  session?: LoginResult,
): Promise<Response> {
  return appRequest(
    createTestApp(),
    path,
    {
      body: new URLSearchParams(fields),
      headers: {
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
        ...(session === undefined
          ? {}
          : {
              Cookie: session.cookieHeader,
              "X-CSRF-Token": session.csrfToken,
            }),
      },
      method: "POST",
    },
    env,
  );
}

function get(
  env: Env,
  path: string,
  session?: LoginResult,
): Promise<Response> {
  return appRequest(
    createTestApp(),
    path,
    {
      headers: {
        Accept: "text/html",
        ...(session === undefined ? {} : { Cookie: session.cookieHeader }),
      },
    },
    env,
  );
}

/**
 * The one mail sent to `to` (with `subject`, where an address gets more than
 * one kind), failing if there is not exactly one.
 */
function mailTo(
  sent: readonly SentEmail[],
  to: string,
  subject?: string,
): SentEmail {
  const mails = sent.filter(
    (mail) =>
      mail.to.includes(to) &&
      (subject === undefined || mail.subject === subject),
  );

  expect(mails).toHaveLength(1);

  return mails[0] as SentEmail;
}

/** The token on the link to `path` in a mail's text. */
function linkToken(mail: SentEmail, path: string): string {
  const url = mail.text
    .split("\n")
    .find((line) => line.includes(path) && line.includes("token="));

  if (url === undefined) {
    throw new Error(`No ${path} link in: ${mail.text}`);
  }

  return new URL(url).searchParams.get("token") ?? "";
}

/** Ask for a new address and open the link that comes back. */
async function changeAddress(
  env: Env,
  sent: SentEmail[],
  session: LoginResult,
  to: string,
): Promise<Response> {
  const requested = await form(env, "/profile/email", { email: to }, session);

  expect(requested.status).toBe(303);
  expect(requested.headers.get("Location")).toBe("/profile?sent=1");

  const token = linkToken(mailTo(sent, to), "/profile/email/confirm");

  return form(env, "/profile/email/confirm", { token });
}

describe("changing your own address", () => {
  test("nothing changes until the new address's link is opened, and the old address can undo it", async () => {
    await capturingEmail(async (sent) => {
      await withStorage(async ({ stores }, env) => {
        const session = await login(env, "ada@example.test");
        const requested = await form(
          env,
          "/profile/email",
          { email: " Ada@New.Example.test " },
          session,
        );

        expect(requested.status).toBe(303);
        await expect(
          stores.users.getById(session.actorId),
        ).resolves.toMatchObject({ email: "ada@example.test" });

        const confirmation = mailTo(sent, "ada@new.example.test");
        const token = linkToken(confirmation, "/profile/email/confirm");

        expect(confirmation.subject).toBe(
          "Confirm your new Carnap email address",
        );

        // Opening the link only describes the change: mail scanners open
        // links too.
        const page = await get(env, `/profile/email/confirm?token=${token}`);

        expect(page.status).toBe(200);
        expect(await page.text()).toContain(
          "Change the email address of the Carnap account that uses ada@example.test to ada@new.example.test?",
        );
        await expect(
          stores.users.getById(session.actorId),
        ).resolves.toMatchObject({ email: "ada@example.test" });

        const confirmed = await form(env, "/profile/email/confirm", {
          token,
        });

        expect(confirmed.status).toBe(303);
        expect(confirmed.headers.get("Location")).toBe("/profile?email=1");
        expect(cookieHeader(confirmed)).toContain("carnap_session=");

        const changed = await stores.users.getById(session.actorId);

        expect(changed).toMatchObject({
          email: "ada@new.example.test",
          emailSource: "user",
        });
        expect(changed?.emailVerifiedAt).not.toBeNull();
        await expect(
          stores.users.getExternalIdentity("native", "ada@example.test"),
        ).resolves.toBeNull();

        // The old address is told, with the way back.
        const notice = mailTo(sent, "ada@example.test");

        expect(notice.subject).toBe("Your Carnap email address was changed");
        expect(notice.text).toContain("ada@new.example.test");
        expect(notice.text).toContain("It works for 7 days.");

        const undoToken = linkToken(notice, "/profile/email/undo");
        const undoPage = await get(
          env,
          `/profile/email/undo?token=${undoToken}`,
        );

        expect(undoPage.status).toBe(200);
        expect(await undoPage.text()).toContain("Put my old address back");

        const undone = await form(env, "/profile/email/undo", {
          token: undoToken,
        });

        expect(undone.status).toBe(303);
        expect(undone.headers.get("Location")).toBe("/profile?restored=1");
        await expect(
          stores.users.getById(session.actorId),
        ).resolves.toMatchObject({
          email: "ada@example.test",
          emailSource: "user",
        });

        // Every session the account had is gone; the undo's own one works.
        expect((await get(env, "/profile", session)).status).toBe(302);
        expect(
          (
            await appRequest(
              createTestApp(),
              "/profile",
              { headers: { Cookie: cookieHeader(undone) } },
              env,
            )
          ).status,
        ).toBe(200);

        // Once.
        const again = await form(env, "/profile/email/undo", {
          token: undoToken,
        });

        expect(again.status).toBe(400);
        expect(await again.text()).toContain(
          "That link has expired or has already been used.",
        );
      }, EMAIL_ENV);
    });
  });

  test("an address another account uses gets a note instead of a link, and the page says the same", async () => {
    await capturingEmail(async (sent) => {
      await withStorage(async ({ stores }, env) => {
        const session = await login(env, "ada@example.test");

        await stores.users.create({
          id: "user-holder",
          email: "taken@example.test",
          name: null,
          createdAt: NOW,
        });
        await stores.users.updateProfile(
          "user-holder",
          { locale: "de", name: null, singleKeyShortcuts: true },
          NOW,
        );

        const requested = await form(
          env,
          "/profile/email",
          { email: "taken@example.test" },
          session,
        );

        expect(requested.status).toBe(303);
        expect(requested.headers.get("Location")).toBe("/profile?sent=1");

        const note = mailTo(sent, "taken@example.test");

        // Written for the account that has the address, not the requester.
        expect(note.subject).toBe(
          "Ihre E-Mail-Adresse bei Carnap wurde nicht geändert",
        );
        expect(note.text).not.toContain("token=");
      }, EMAIL_ENV);
    });
  });

  test("refuses your own address and a malformed one, keeping what was typed", async () => {
    await withStorage(async (_storage, env) => {
      const session = await login(env, "ada@example.test");
      const same = await form(
        env,
        "/profile/email",
        { email: "ADA@example.test" },
        session,
      );

      expect(same.status).toBe(400);
      expect(await same.text()).toContain("That is already your address.");

      const malformed = await form(
        env,
        "/profile/email",
        { email: "not-an-address" },
        session,
      );

      expect(malformed.status).toBe(400);
      expect(await malformed.text()).toContain('value="not-an-address"');
    });
  });

  test("without mail, the local page shows the link, as the login page does", async () => {
    await withStorage(async ({ stores }, env) => {
      const session = await login(env, "ada@example.test");
      const requested = await form(
        env,
        "/profile/email",
        { email: "ada@new.example.test" },
        session,
      );
      const html = await requested.text();

      expect(requested.status).toBe(200);
      expect(html).toContain(
        "We sent a link to the new address. Open it to finish the change.",
      );

      const token = /\/profile\/email\/confirm\?token=([^"&]+)/.exec(
        html,
      )?.[1];

      expect(token).toBeDefined();
      expect(
        (await form(env, "/profile/email/confirm", { token: token ?? "" }))
          .status,
      ).toBe(303);
      await expect(
        stores.users.getById(session.actorId),
      ).resolves.toMatchObject({ email: "ada@new.example.test" });
    });
  });

  test("a second change leaves the first change's undo to the old mailbox, and it puts the first address back", async () => {
    await capturingEmail(async (sent) => {
      await withStorage(async ({ stores }, env) => {
        const session = await login(env, "ada@example.test");

        await changeAddress(env, sent, session, "ada@second.example.test");

        const first = linkToken(
          mailTo(sent, "ada@example.test"),
          "/profile/email/undo",
        );
        const signedIn = await login(env, "ada@second.example.test");

        await changeAddress(env, sent, signedIn, "ada@third.example.test");

        // Whoever made the second change holds the second mailbox, so its
        // notice carries no way back of its own.
        const notice = mailTo(
          sent,
          "ada@second.example.test",
          "Your Carnap email address was changed",
        );

        expect(notice.text).not.toContain("token=");
        expect(notice.text).toContain("undo that earlier change");

        const page = await get(env, `/profile/email/undo?token=${first}`);

        expect(await page.text()).toContain("ada@third.example.test");
        expect(
          (await form(env, "/profile/email/undo", { token: first })).status,
        ).toBe(303);
        await expect(
          stores.users.getById(session.actorId),
        ).resolves.toMatchObject({ email: "ada@example.test" });
      }, EMAIL_ENV);
    });
  });

  test("an undo also cancels a confirmation link still pending from the address it puts back", async () => {
    await capturingEmail(async (sent) => {
      await withStorage(async ({ stores }, env) => {
        const session = await login(env, "ada@example.test");
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
          assertedEmail: "ada@campus.example.test",
          createdAt: NOW,
        });

        // Asked for, and left unopened…
        await form(
          env,
          "/profile/email",
          { email: "someone@else.example.test" },
          session,
        );

        const pending = linkToken(
          mailTo(sent, "someone@else.example.test"),
          "/profile/email/confirm",
        );

        // …while the account moves another way, and is moved back.
        await form(
          env,
          "/profile/email/lms",
          { identityId: "identity-lti-1" },
          session,
        );

        const undo = linkToken(
          mailTo(sent, "ada@example.test"),
          "/profile/email/undo",
        );

        expect(
          (await form(env, "/profile/email/undo", { token: undo })).status,
        ).toBe(303);
        expect(
          (await form(env, "/profile/email/confirm", { token: pending }))
            .status,
        ).toBe(400);
        await expect(
          stores.users.getById(session.actorId),
        ).resolves.toMatchObject({ email: "ada@example.test" });
      }, EMAIL_ENV);
    });
  });

  test("the links' buttons post only from Carnap's own pages", async () => {
    await capturingEmail(async (sent) => {
      await withStorage(async ({ stores }, env) => {
        const session = await login(env, "ada@example.test");

        await form(
          env,
          "/profile/email",
          { email: "ada@new.example.test" },
          session,
        );

        const token = linkToken(
          mailTo(sent, "ada@new.example.test"),
          "/profile/email/confirm",
        );
        const post = (headers: Record<string, string>) =>
          appRequest(
            createTestApp(),
            "/profile/email/confirm",
            {
              body: new URLSearchParams({ token }),
              headers: {
                Accept: "text/html",
                "Content-Type": "application/x-www-form-urlencoded",
                ...headers,
              },
              method: "POST",
            },
            env,
          );

        expect((await post({ "Sec-Fetch-Site": "cross-site" })).status).toBe(
          403,
        );
        expect(
          (await post({ Origin: "https://elsewhere.example.test" })).status,
        ).toBe(403);
        await expect(
          stores.users.getById(session.actorId),
        ).resolves.toMatchObject({ email: "ada@example.test" });
        expect((await post({ "Sec-Fetch-Site": "same-origin" })).status).toBe(
          303,
        );
      }, EMAIL_ENV);
    });
  });

  test("an address held for its account is no one else's, and signing in with it leads to the undo", async () => {
    await capturingEmail(async (sent) => {
      await withStorage(async ({ stores }, env) => {
        const ada = await login(env, "ada@example.test");
        const admin = await login(env, "admin@example.test");

        await grantTestCapability(env, admin.actorId, "site_admin");
        await changeAddress(env, sent, ada, "ada@new.example.test");

        // Another account cannot take the address while it is held.
        const taken = await form(
          env,
          `/admin/users/${admin.actorId}/email`,
          { email: "ada@example.test" },
          admin,
        );

        expect(taken.status).toBe(400);
        expect(await taken.text()).toContain(
          "That address was recently moved off another Carnap account",
        );

        // Nor does signing in with it make a new, empty account: it leads to
        // the undo.
        const start = await appRequest(
          createTestApp(),
          "/auth/login/start",
          jsonRequest({ email: "ada@example.test" }),
          env,
        );
        const { login: challenge } = (await start.json()) as {
          readonly login: { readonly loginToken: string };
        };
        const confirmed = await form(env, "/login/confirm", {
          token: challenge.loginToken,
        });

        expect(confirmed.status).toBe(303);

        const location = confirmed.headers.get("Location") ?? "";

        expect(location).toStartWith("/profile/email/undo?token=");
        await expect(
          stores.users.getByEmail("ada@example.test"),
        ).resolves.toBeNull();

        // The reissued link is the live one; the mailed one stopped working.
        const mailed = linkToken(
          mailTo(sent, "ada@example.test"),
          "/profile/email/undo",
        );

        expect(
          (await get(env, `/profile/email/undo?token=${mailed}`)).status,
        ).toBe(400);
        expect(
          (
            await form(env, "/profile/email/undo", {
              token: new URL(location, "http://x").searchParams.get(
                "token",
              ) as string,
            })
          ).status,
        ).toBe(303);
        await expect(
          stores.users.getById(ada.actorId),
        ).resolves.toMatchObject({ email: "ada@example.test" });
      }, EMAIL_ENV);
    });
  });

  test("taking the address an LMS offers sends the old address the undo", async () => {
    await capturingEmail(async (sent) => {
      await withStorage(async ({ stores }, env) => {
        const session = await login(env, "ada@example.test");
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
          assertedEmail: "ada@campus.example.test",
          createdAt: NOW,
        });

        expect(
          (
            await form(
              env,
              "/profile/email/lms",
              { identityId: "identity-lti-1" },
              session,
            )
          ).status,
        ).toBe(303);

        const token = linkToken(
          mailTo(sent, "ada@example.test"),
          "/profile/email/undo",
        );

        expect(
          (await form(env, "/profile/email/undo", { token })).status,
        ).toBe(303);
        // Back as it was, the holder's own, and now proven by the click.
        await expect(
          stores.users.getById(session.actorId),
        ).resolves.toMatchObject({
          email: "ada@example.test",
          emailSource: "user",
          emailSourcePlatformId: null,
        });
      }, EMAIL_ENV);
    });
  });
});

describe("an administrator changing an address", () => {
  test("takes effect at once, is audited, and tells the old address without an undo", async () => {
    await capturingEmail(async (sent) => {
      await withStorage(async ({ stores }, env) => {
        const admin = await login(env, "admin@example.test");
        const ada = await login(env, "ada@example.test");

        await grantTestCapability(env, admin.actorId, "site_admin");

        const changed = await form(
          env,
          `/admin/users/${ada.actorId}/email`,
          { email: "Ada@Recovered.example.test" },
          admin,
        );

        expect(changed.status).toBe(303);
        expect(changed.headers.get("Location")).toBe(
          `/admin/users/${ada.actorId}?saved=1`,
        );
        await expect(
          stores.users.getById(ada.actorId),
        ).resolves.toMatchObject({
          email: "ada@recovered.example.test",
          emailSource: "admin",
          emailVerifiedAt: null,
        });
        await expect(
          stores.users.getExternalIdentity("native", "ada@example.test"),
        ).resolves.toBeNull();

        const [event] = await stores.adminAudit.listRecent(1);

        expect(event).toMatchObject({
          action: "admin.change_user_email",
          actorUserId: admin.actorId,
          metadata: {
            from: "ada@example.test",
            to: "ada@recovered.example.test",
          },
          targetUserId: ada.actorId,
        });

        const notice = mailTo(sent, "ada@example.test");

        expect(notice.text).toContain("A Carnap administrator changed");
        expect(notice.text).not.toContain("/profile/email/undo");

        const page = await get(env, `/admin/users/${ada.actorId}`, admin);

        expect(await page.text()).toContain("Set by an administrator");
      }, EMAIL_ENV);
    });
  });

  test("cancels a pending undo, so the old mailbox cannot take the account back", async () => {
    await capturingEmail(async (sent) => {
      await withStorage(async ({ stores }, env) => {
        const admin = await login(env, "admin@example.test");
        const ada = await login(env, "ada@example.test");

        await grantTestCapability(env, admin.actorId, "site_admin");
        await changeAddress(env, sent, ada, "ada@new.example.test");

        const undo = linkToken(
          mailTo(sent, "ada@example.test"),
          "/profile/email/undo",
        );

        expect(
          (
            await form(
              env,
              `/admin/users/${ada.actorId}/email`,
              { email: "ada@recovered.example.test" },
              admin,
            )
          ).status,
        ).toBe(303);
        expect(
          (await form(env, "/profile/email/undo", { token: undo })).status,
        ).toBe(400);
        await expect(
          stores.users.getById(ada.actorId),
        ).resolves.toMatchObject({ email: "ada@recovered.example.test" });
      }, EMAIL_ENV);
    });
  });

  test("is a site administrator's alone, and refuses an address in use", async () => {
    await withStorage(async ({ stores }, env) => {
      const admin = await login(env, "admin@example.test");
      const ada = await login(env, "ada@example.test");

      expect(
        (
          await form(
            env,
            `/admin/users/${admin.actorId}/email`,
            { email: "mine@example.test" },
            ada,
          )
        ).status,
      ).toBe(403);

      await grantTestCapability(env, admin.actorId, "site_admin");

      const refused = await form(
        env,
        `/admin/users/${ada.actorId}/email`,
        { email: "admin@example.test" },
        admin,
      );

      expect(refused.status).toBe(400);
      expect(await refused.text()).toContain(
        "Another Carnap account already uses that address.",
      );
      await expect(stores.users.getById(ada.actorId)).resolves.toMatchObject({
        email: "ada@example.test",
      });
    });
  });
});
