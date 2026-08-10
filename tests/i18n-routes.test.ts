import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { AppStores } from "../src/worker/application/stores";
import { timestampNow } from "../src/worker/domain/time";
import type { Env } from "../src/worker/env";
import type { WorkerApp } from "../src/worker/http";
import { grantTestCourseCreator } from "./helpers/admin";
import { appRequest, createTestApp } from "./helpers/app";
import {
  beginTestLogin,
  createLtiTestApp,
  formRequest,
  mintIdToken,
  registerTestPlatform,
} from "./helpers/lti";
import { createTestStorage, type TestStorage } from "./helpers/storage";

setDefaultTimeout(30_000);

/**
 * Enough of a Resend account for `loginEmailSenderFromEnv` and
 * `ltiLinkEmailSenderFromEnv` to build a real sender; the fetch it posts to is
 * captured rather than made.
 */
const EMAIL_ENV = {
  AUTH_LOGIN_EMAIL_FROM: "Carnap <login@example.test>",
  RESEND_API_KEY: "test-api-key",
} as const;

interface SentEmail {
  readonly html: string;
  readonly subject: string;
  readonly text: string;
  readonly to: readonly string[];
}

interface LoginResult {
  readonly actorId: string;
  readonly cookieHeader: string;
  readonly csrfToken: string;
}

interface StartLoginResponse {
  readonly login: { readonly loginToken: string };
}

interface ConfirmLoginResponse {
  readonly actor: { readonly id: string };
  readonly csrfToken: string;
}

interface CourseResponse {
  readonly course: { readonly id: string };
}

interface ContentItemResponse {
  readonly item: { readonly id: string };
}

interface ContentRevisionResponse {
  readonly revision: { readonly id: string };
}

interface AssignmentResponse {
  readonly assignment: { readonly id: string };
}

async function withStorage(
  run: (storage: TestStorage, env: Env) => Promise<void>,
  overrides: Partial<Omit<Env, "DB">> = {},
): Promise<void> {
  const storage = await createTestStorage();

  try {
    await run(storage, {
      CARNAP_ENV: "local",
      DB: storage.db,
      ...overrides,
    });
  } finally {
    await storage.dispose();
  }
}

/**
 * Run `body` with the transactional emails captured instead of delivered.
 *
 * The sender reads the global `fetch` at call time, so replacing it here is
 * what makes the *language a recipient actually receives* observable — the
 * property under test lives in the message body, not in the response.
 */
async function capturingEmail<T>(
  body: (sent: SentEmail[]) => Promise<T>,
): Promise<T> {
  const sent: SentEmail[] = [];
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const request = new Request(input, init);

    if (new URL(request.url).host === "api.resend.com") {
      sent.push((await request.json()) as SentEmail);

      return Response.json({ id: `email-${sent.length}` });
    }

    return realFetch(input as RequestInfo, init);
  }) as typeof globalThis.fetch;

  try {
    return await body(sent);
  } finally {
    globalThis.fetch = realFetch;
  }
}

function jsonRequest(body: unknown, login?: LoginResult): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(login === undefined
        ? {}
        : {
            Cookie: login.cookieHeader,
            "X-CSRF-Token": login.csrfToken,
          }),
    },
    method: "POST",
  };
}

function setCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & {
    readonly getSetCookie?: () => string[];
  };

  return headers.getSetCookie?.() ?? [];
}

/** Everything a requester can see on a response bar the correlation id. */
function comparableHeaders(
  response: Response,
): readonly (readonly [string, string])[] {
  return [...response.headers].filter(
    ([name]) => name.toLowerCase() !== "x-request-id",
  );
}

function cookieHeader(response: Response): string {
  return setCookieHeaders(response)
    .map((cookie) => cookie.split(";")[0] ?? "")
    .join("; ");
}

async function login(env: Env, email: string): Promise<LoginResult> {
  const startResponse = await appRequest(
    createTestApp(),
    "/auth/login/start",
    jsonRequest({ email }),
    env,
  );
  const startBody = (await startResponse.json()) as StartLoginResponse;
  const confirmResponse = await appRequest(
    createTestApp(),
    "/auth/login/confirm",
    jsonRequest({ loginToken: startBody.login.loginToken }),
    env,
  );
  const confirmBody = (await confirmResponse.json()) as ConfirmLoginResponse;

  return {
    actorId: confirmBody.actor.id,
    cookieHeader: cookieHeader(confirmResponse),
    csrfToken: confirmBody.csrfToken,
  };
}

async function storeLocale(
  stores: AppStores,
  userId: string,
  locale: string,
): Promise<void> {
  const user = await stores.users.getById(userId);

  await stores.users.updateProfile(
    userId,
    // One write covers both fields, so the name has to be carried through it.
    { locale, name: user?.name ?? null },
    timestampNow(new Date()),
  );
}

describe("route error pages speak the reader's language", () => {
  /**
   * The submit button on a re-rendered form is the tell. Everything else on the
   * page — the heading, the validation message, the chrome — already goes
   * through the translator, so an English button beside German prose is exactly
   * the mixed-language page an instructor sees when a save fails.
   */
  test("a rejected save keeps its submit label translated", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "de-teacher@example.test");

      await grantTestCourseCreator(env, instructor.actorId);

      const course = (await (
        await appRequest(
          createTestApp(),
          "/courses",
          jsonRequest({ timezone: "UTC", title: "Intro Logic" }, instructor),
          env,
        )
      ).json()) as CourseResponse;
      const item = (await (
        await appRequest(
          createTestApp(),
          "/content",
          jsonRequest({ title: "Lesson" }, instructor),
          env,
        )
      ).json()) as ContentItemResponse;
      const revision = (await (
        await appRequest(
          createTestApp(),
          `/content/${item.item.id}/revisions`,
          jsonRequest({ sourceText: "# Lesson\n\nProse." }, instructor),
          env,
        )
      ).json()) as ContentRevisionResponse;
      const draft = (await (
        await appRequest(
          createTestApp(),
          `/courses/${course.course.id}/assignments`,
          jsonRequest(
            {
              contentRevisionId: revision.revision.id,
              description: "Read it.",
              title: "Homework 1",
            },
            instructor,
          ),
          env,
        )
      ).json()) as AssignmentResponse;
      const detailPath = `/courses/${course.course.id}/instructor/assignments/${draft.assignment.id}`;

      // Publishing freezes the content, so the draft-edit form below is
      // refused — an ordinary validation failure, re-rendering the form.
      await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${draft.assignment.id}/publish`,
        {
          headers: {
            Cookie: instructor.cookieHeader,
            "X-CSRF-Token": instructor.csrfToken,
          },
          method: "POST",
        },
        env,
      );

      const response = await appRequest(
        createTestApp(),
        detailPath,
        {
          body: new URLSearchParams({
            contentRevisionId: revision.revision.id,
            csrfToken: instructor.csrfToken,
            title: "Too late",
          }),
          headers: {
            Accept: "text/html",
            Cookie: `${instructor.cookieHeader}; carnap_locale=de`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        env,
      );
      const html = await response.text();

      expect(response.status).toBe(400);
      expect(html).toContain('lang="de"');
      // The heading is already translated; the button used not to be.
      expect(html).toContain("Aufgabe nicht aktualisiert");
      expect(html).toContain("Aufgabe speichern");
      expect(html).not.toContain("Save assignment");
    });
  });
});

describe("the login email is written for its recipient", () => {
  /**
   * The account owner set German. The link is then asked for from a fresh
   * browser — no cookie of ours, `Accept-Language: en` — which is the ordinary
   * case: a lab machine, a phone, a reinstalled profile. The page in front of
   * that browser is rightly English; the mail is read by the account owner.
   */
  test("it uses the account's stored locale, not the browser's", async () => {
    await withStorage(async (storage, env) => {
      const owner = await login(env, "stored-de@example.test");

      await storeLocale(storage.stores, owner.actorId, "de");

      await capturingEmail(async (sent) => {
        const response = await appRequest(
          createTestApp(),
          "/login",
          {
            body: new URLSearchParams({ email: "stored-de@example.test" }),
            headers: {
              Accept: "text/html",
              "Accept-Language": "en",
              "Content-Type": "application/x-www-form-urlencoded",
            },
            method: "POST",
          },
          env,
        );

        expect(response.status).toBe(200);
        // The page belongs to the browser that asked, and it asked in English.
        expect(await response.text()).toContain("Check your email");

        expect(sent).toHaveLength(1);
        expect(sent[0]?.to).toEqual(["stored-de@example.test"]);
        expect(sent[0]?.subject).toBe("Ihr Carnap-Anmeldelink");
        expect(sent[0]?.text).toContain(
          "Melden Sie sich über diesen Link bei Carnap an:",
        );
      });
    }, EMAIL_ENV);
  });

  test("an account with no stored locale still follows the request", async () => {
    await withStorage(async (_storage, env) => {
      await login(env, "no-pref@example.test");

      await capturingEmail(async (sent) => {
        await appRequest(
          createTestApp(),
          "/login",
          {
            body: new URLSearchParams({ email: "no-pref@example.test" }),
            headers: {
              Accept: "text/html",
              "Accept-Language": "de",
              "Content-Type": "application/x-www-form-urlencoded",
            },
            method: "POST",
          },
          env,
        );

        expect(sent[0]?.subject).toBe("Ihr Carnap-Anmeldelink");
      });
    }, EMAIL_ENV);
  });

  /**
   * Reading a stored preference means reading the users table, which is one
   * `if` away from an oracle for "does this address have an account?". The
   * answer must never reach the requester: only the mailbox owner sees any
   * difference at all, and only in the language of a message they alone
   * receive.
   */
  test("a known and an unknown address are answered identically", async () => {
    await withStorage(async (storage, env) => {
      const owner = await login(env, "known@example.test");

      await storeLocale(storage.stores, owner.actorId, "de");

      await capturingEmail(async (sent) => {
        const request = (email: string): RequestInit => ({
          body: new URLSearchParams({ email }),
          headers: {
            Accept: "text/html",
            "Accept-Language": "en",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        });
        const known = await appRequest(
          createTestApp(),
          "/login",
          request("known@example.test"),
          env,
        );
        const unknown = await appRequest(
          createTestApp(),
          "/login",
          request("nobody@example.test"),
          env,
        );
        const knownBody = await known.text();
        const unknownBody = await unknown.text();

        expect(known.status).toBe(unknown.status);
        // Headers included, bar the per-request correlation id: a `Set-Cookie`
        // or a differing length would give the answer away as surely as the
        // body would.
        expect(comparableHeaders(known)).toEqual(comparableHeaders(unknown));
        expect(knownBody).toBe(unknownBody);
        // The one asymmetry is in the mailbox, where it belongs.
        expect(sent.map((email) => email.subject)).toEqual([
          "Ihr Carnap-Anmeldelink",
          "Your Carnap login link",
        ]);
        expect(sent[1]?.to).toEqual(["nobody@example.test"]);
      });
    }, EMAIL_ENV);
  });
});

describe("the LTI account-link branch adopts the launch's language", () => {
  const CLAIM_LAUNCH_PRESENTATION =
    "https://purl.imsglobal.org/spec/lti/claim/launch_presentation";

  async function withLti(
    run: (app: WorkerApp, storage: TestStorage, env: Env) => Promise<void>,
  ): Promise<void> {
    await withStorage(async (storage, env) => {
      await registerTestPlatform(storage.stores);
      await run(await createLtiTestApp(), storage, env);
    }, EMAIL_ENV);
  }

  /** A launch whose asserted email already belongs to an Carnap account. */
  async function launch(
    app: WorkerApp,
    env: Env,
    email: string,
    locale: string | undefined,
  ): Promise<Response> {
    const begun = await beginTestLogin(app, env);
    const idToken = await mintIdToken({
      claims:
        locale === undefined
          ? {}
          : { [CLAIM_LAUNCH_PRESENTATION]: { locale } },
      email,
      nonce: begun.nonce,
      sub: "lms-linker-1",
    });

    return app.request(
      "/lti/launch",
      formRequest({ id_token: idToken, state: begun.state }),
      env,
    );
  }

  /**
   * The prompt is rendered in this very response, so the cookie alone would be
   * a request too late — and for a first-time reader arriving from a German
   * LMS, that request is one they have no reason to make.
   */
  test("the prompt renders in the platform's language", async () => {
    await withLti(async (app, _storage, env) => {
      await login(env, "linker@example.test");

      await capturingEmail(async () => {
        const response = await launch(
          app,
          env,
          "linker@example.test",
          "de-DE",
        );
        const html = await response.text();

        expect(html).toContain('lang="de"');
        expect(html).toContain("Kontoverknüpfung bestätigen");
      });
    });
  });

  test("the confirmation email follows the platform's language", async () => {
    await withLti(async (app, _storage, env) => {
      await login(env, "linker@example.test");

      await capturingEmail(async (sent) => {
        await launch(app, env, "linker@example.test", "de-DE");

        expect(sent).toHaveLength(1);
        expect(sent[0]?.to).toEqual(["linker@example.test"]);
        expect(sent[0]?.subject).toBe(
          "Bestätigen Sie die Verknüpfung Ihres Carnap-Kontos",
        );
        expect(sent[0]?.html).toContain("LMS-Identität verknüpfen");
        expect(sent[0]?.text).toContain(
          "Ein Start aus dem LMS Ihrer Einrichtung",
        );
      });
    });
  });

  /**
   * The recipient here is not a stranger — the challenge exists because the
   * launch named an address that already has an account — so their own choice
   * outranks the platform's chrome language.
   */
  test("a stored preference outranks the platform's language", async () => {
    await withLti(async (app, storage, env) => {
      const owner = await login(env, "linker@example.test");

      await storeLocale(storage.stores, owner.actorId, "en");

      await capturingEmail(async (sent) => {
        await launch(app, env, "linker@example.test", "de-DE");

        expect(sent[0]?.subject).toBe("Confirm your Carnap account link");
      });
    });
  });
});
