import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { Hono } from "hono";
import { exportJWK, generateKeyPair } from "jose";

import type { AppStores } from "../src/worker/application/stores";
import { LOCALE_COOKIE_NAME } from "../src/worker/cookies";
import type { Env } from "../src/worker/env";
import type { AppBindings, WorkerApp } from "../src/worker/http";
import { matchSupportedLocale } from "../src/worker/i18n/locales";
import { localeDetectorMiddleware } from "../src/worker/middleware/locale";
import { appRequest, createTestApp } from "./helpers/app";
import {
  beginTestLogin,
  createLtiTestApp,
  formRequest,
  INSTRUCTOR_ROLE,
  mintIdToken,
  registerTestPlatform,
} from "./helpers/lti";
import { createTestStorage, type TestStorage } from "./helpers/storage";

setDefaultTimeout(30_000);

const CLAIM_LAUNCH_PRESENTATION =
  "https://purl.imsglobal.org/spec/lti/claim/launch_presentation";

/** A German string from the page chrome; if this renders, the locale took. */
const GERMAN_CHROME = "Carnap-Startseite";

interface StartLoginResponse {
  readonly login: { readonly loginToken: string };
}

interface ConfirmLoginResponse {
  readonly actor: { readonly id: string };
  readonly csrfToken: string;
}

interface Session {
  readonly actorId: string;
  readonly cookieHeader: string;
  readonly csrfToken: string;
}

async function withStorage(
  run: (stores: AppStores, env: Env) => Promise<void>,
): Promise<void> {
  const storage = await createTestStorage();

  try {
    await run(storage.stores, { CARNAP_ENV: "local", DB: storage.db });
  } finally {
    await storage.dispose();
  }
}

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    readonly getSetCookie?: () => string[];
  };

  return headers.getSetCookie?.() ?? [];
}

/** The value a response sets `name` to, or null when it sets no such cookie. */
function cookieValue(response: Response, name: string): string | null {
  for (const header of setCookies(response)) {
    const [pair = ""] = header.split(";");
    const separator = pair.indexOf("=");

    if (separator > 0 && pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }

  return null;
}

function cookieAttributes(response: Response, name: string): string {
  return (
    setCookies(response).find((header) => header.startsWith(`${name}=`)) ?? ""
  );
}

/**
 * The `Cookie` header a browser would send on a *cross-site* request — an LTI
 * launch is a form POST from the LMS's origin, so `SameSite=Lax` cookies stay
 * behind. Deriving the header this way instead of writing it by hand is what
 * makes the launch tests below mean anything.
 */
function crossSiteCookieHeader(response: Response): string {
  return setCookies(response)
    .filter((header) => /;\s*SameSite=None\b/i.test(header))
    .map((header) => header.split(";")[0] ?? "")
    .join("; ");
}

/**
 * The origin a request that must produce `Secure` cookies has to use: what our
 * cookies may carry follows the connection, not the environment's name (see
 * `cookieSecure`). Every other request in this file is plain-http localhost.
 */
const SECURE_ORIGIN = "https://localhost";

/**
 * Sign in and give the account a name, which takes two requests because those
 * are two things: signing in proves an address, and the name is saved on the
 * profile form afterwards. The tests below need a stored name to start from —
 * their subject is what a *rejected* save leaves behind.
 */
async function signIn(env: Env): Promise<Session> {
  const session = await signInWithoutName(env);

  await saveProfile(env, session, { locale: "" });

  return session;
}

async function signInWithoutName(env: Env): Promise<Session> {
  const started = await appRequest(
    createTestApp(),
    "/auth/login/start",
    {
      body: JSON.stringify({ email: "ada@example.test" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    env,
  );
  const startBody = (await started.json()) as StartLoginResponse;
  const confirmed = await appRequest(
    createTestApp(),
    "/auth/login/confirm",
    {
      body: JSON.stringify({ loginToken: startBody.login.loginToken }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    env,
  );
  const body = (await confirmed.json()) as ConfirmLoginResponse;

  return {
    actorId: body.actor.id,
    cookieHeader: setCookies(confirmed)
      .map((header) => header.split(";")[0] ?? "")
      .join("; "),
    csrfToken: body.csrfToken,
  };
}

/**
 * Save the profile form the way a browser would — every field it carries, in one
 * POST. The language is one of those fields, so a test that sets it must send a
 * name too: leaving it out is a browser submitting a blank name, which clears it.
 */
function saveProfile(
  env: Env,
  session: Session,
  fields: Record<string, string>,
  origin = "",
): Promise<Response> {
  return appRequest(
    createTestApp(),
    `${origin}/profile`,
    {
      body: new URLSearchParams({ name: "Ada", ...fields }),
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

/** Choose a language, `""` being the form's "match my browser". */
function chooseLanguage(
  env: Env,
  session: Session,
  locale: string,
  origin = "",
): Promise<Response> {
  return saveProfile(env, session, { locale }, origin);
}

/**
 * The profile form's own markup. The page carries other forms — log out, and one
 * per linked LMS identity — so an assertion about *the* form has to say which.
 */
function profileForm(html: string): string {
  const start = html.indexOf('<form action="/profile"');

  expect(start).toBeGreaterThan(-1);

  return html.slice(start, html.indexOf("</form>", start));
}

/** Whether the form comes back with `locale` preselected. */
function selectedLocale(html: string, locale: string): boolean {
  return new RegExp(`<option[^>]*selected[^>]*value="${locale}"`).test(
    profileForm(html),
  );
}

function get(
  env: Env,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return appRequest(createTestApp(), path, { headers }, env);
}

describe("the two resolution phases", () => {
  /**
   * Phase one has to resolve the *translator*, not merely the language tag.
   *
   * `AppVariables.i18n` is typed non-optional, and everything between the
   * detector and `localeMiddleware` — the actor lookup, and `app.onError` for
   * anything either of them throws — is entitled to believe that. While only
   * phase two set it, those handlers held a `Translator`-typed `undefined`, and
   * nothing crashed purely because the error handlers answer in JSON and never
   * ask for words. The first prose on the 500 page would have found the hole.
   */
  test("the detector alone leaves a usable translator behind", async () => {
    const app = new Hono<AppBindings>();

    app.use("*", localeDetectorMiddleware());
    app.get("/probe", (context) => {
      const i18n = context.get("i18n");

      return context.json({
        language: context.get("language"),
        translated: i18n.t("Courses"),
      });
    });

    const german = await app.request("/probe", {
      headers: { "Accept-Language": "de" },
    });
    const body = (await german.json()) as {
      readonly language: string;
      readonly translated: string;
    };

    expect(body.language).toBe("de");
    // Not the wording, which a translator may revisit — only that a catalog
    // answered at all. Ids are the English source, so an absent translator and
    // an English one are otherwise indistinguishable.
    expect(body.translated).not.toBe("Courses");
  });

  test("a language we do not serve still gets a translator", async () => {
    const app = new Hono<AppBindings>();

    app.use("*", localeDetectorMiddleware());
    app.get("/probe", (context) =>
      context.json({
        language: context.get("language"),
        // Typed `SupportedLocale`, and this is what makes that sound: the tag
        // reaching the context is narrowed, never passed through.
        locale: context.get("i18n").locale,
      }),
    );

    const response = await app.request("/probe", {
      headers: { "Accept-Language": "fr-CA" },
    });

    const body = (await response.json()) as {
      readonly language: string;
      readonly locale: string;
    };

    expect(body).toEqual({ language: "en", locale: "en" });
  });
});

describe("matching a language tag to a locale we serve", () => {
  test("an exact tag, whatever its case", () => {
    expect(matchSupportedLocale("de")).toBe("de");
    expect(matchSupportedLocale("DE")).toBe("de");
    expect(matchSupportedLocale(" en ")).toBe("en");
    expect(matchSupportedLocale("en-xa")).toBe("en-XA");
  });

  // An LMS reports the language of its own chrome, which is regional far more
  // often than not; serving German to an Austrian beats serving English.
  test("a regional tag falls back to its primary subtag", () => {
    expect(matchSupportedLocale("de-AT")).toBe("de");
    expect(matchSupportedLocale("en-GB")).toBe("en");
  });

  test("a language we do not serve matches nothing", () => {
    expect(matchSupportedLocale("fr-CA")).toBeNull();
    expect(matchSupportedLocale("")).toBeNull();
    expect(matchSupportedLocale("   ")).toBeNull();
  });
});

describe("choosing a language", () => {
  // A signed-out reader has already answered this question, in the header their
  // browser sends. Asking it again in the footer of the login page put a
  // prominent control in front of someone with no reason yet to care.
  test("a signed-out reader is not asked, and gets what their browser asks for", async () => {
    await withStorage(async (_stores, env) => {
      const html = await (
        await get(env, "/login", { "Accept-Language": "de" })
      ).text();

      expect(html).toContain(GERMAN_CHROME);
      expect(html).not.toContain('name="locale"');
    });
  });

  // The language is a preference like any other, so it is a field on the profile
  // form rather than a second form beside it: one set of inputs, one Save.
  test("the profile form carries it, beside the name and under one Save", async () => {
    await withStorage(async (_stores, env) => {
      const session = await signIn(env);
      const form = profileForm(
        await (
          await get(env, "/profile", { Cookie: session.cookieHeader })
        ).text(),
      );

      expect(form).toContain('name="name"');
      expect(form).toContain('<select name="locale">');
      expect(form).toContain("Deutsch");
      expect(form).toContain("Match my browser");
      // And exactly one button to press.
      expect(form.match(/<button/g)).toHaveLength(1);
    });
  });

  test("choosing one stores it, cookies it, and answers in it", async () => {
    await withStorage(async (stores, env) => {
      const session = await signIn(env);
      const response = await chooseLanguage(env, session, "de");

      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe("/profile?saved=1");
      expect((await stores.users.getById(session.actorId))?.locale).toBe(
        "de",
      );
      // Cookied as well as stored, so logging out does not silently revert the
      // language, and so the choice survives on a shared browser.
      expect(cookieValue(response, LOCALE_COOKIE_NAME)).toBe("de");
      // Nothing client-side reads it, and a page that could rewrite it could
      // disagree with the language it was rendered in.
      expect(cookieAttributes(response, LOCALE_COOKIE_NAME)).toContain(
        "HttpOnly",
      );

      // The redirect target is the confirmation: the page comes back in the
      // chosen language, with the choice still showing.
      const page = await get(env, "/profile", {
        Cookie: session.cookieHeader,
      });
      const html = await page.text();

      expect(html).toContain(GERMAN_CHROME);
      expect(selectedLocale(html, "de")).toBe(true);
    });
  });

  // The way back out, which the old switcher had no way to express: an account
  // that has never chosen follows the request, and so does one that unchooses.
  test("match my browser clears both the row and the cookie", async () => {
    await withStorage(async (stores, env) => {
      const session = await signIn(env);

      await chooseLanguage(env, session, "de");

      const response = await chooseLanguage(env, session, "");

      expect(response.status).toBe(303);
      expect(
        (await stores.users.getById(session.actorId))?.locale,
      ).toBeNull();
      // Cleared rather than left to be outranked: detection reads the cookie
      // before `Accept-Language`, so a cookie left behind would go on answering
      // the question the reader just withdrew.
      expect(cookieValue(response, LOCALE_COOKIE_NAME)).toBe("");
      expect(cookieAttributes(response, LOCALE_COOKIE_NAME)).toContain(
        "Max-Age=0",
      );

      const page = await get(env, "/profile", {
        "Accept-Language": "de",
        Cookie: session.cookieHeader,
      });
      const html = await page.text();

      expect(html).toContain(GERMAN_CHROME);
      expect(selectedLocale(html, "")).toBe(true);
    });
  });

  // Both fields are validated before either is written, so the reader gets their
  // whole submission back to correct rather than half of it applied.
  test("a rejected save keeps the language the reader chose", async () => {
    await withStorage(async (stores, env) => {
      const session = await signIn(env);
      const response = await saveProfile(env, session, {
        locale: "de",
        // Over the 200-character limit, so the save is refused and the page
        // comes back carrying the error rather than redirecting.
        name: "x".repeat(201),
      });
      const html = await response.text();

      // Rendered, not redirected — that is the case under test.
      expect(response.status).toBe(200);
      expect(html).toContain("Name must be 200 characters or less.");
      expect(selectedLocale(html, "de")).toBe(true);
      // Nothing was written, so the page is still in the language it was
      // requested in: German is what the form offers, not what it did.
      expect(html).not.toContain(GERMAN_CHROME);
      await expect(
        stores.users.getById(session.actorId),
      ).resolves.toMatchObject({ locale: null, name: "Ada" });
    });
  });

  // The reader whose choice this cookie records is most likely to be read
  // inside an LMS, and the launch that reads it is a cross-site POST: a `Lax`
  // cookie is not sent on one, so the launch would conclude they had never
  // chosen and overwrite them with the platform's language. The cookie names a
  // language and authenticates nothing, so `None` gives up no defence.
  test("the cookie is cross-site, so an LTI launch can see it", async () => {
    await withStorage(async (_stores, env) => {
      const attributes = cookieAttributes(
        // Signed in over plain http, because that is where the API hands a
        // login token back; the save — the request under test — runs over
        // https, which is what decides the cookie's attributes.
        await chooseLanguage(env, await signIn(env), "de", SECURE_ORIGIN),
        LOCALE_COOKIE_NAME,
      );

      expect(attributes).toContain("SameSite=None");
      expect(attributes).toContain("Secure");
    });
  });

  // Browsers reject `None` without `Secure`, and local dev is plain http.
  test("plain-http local dev falls back to Lax", async () => {
    await withStorage(async (_stores, env) => {
      const attributes = cookieAttributes(
        await chooseLanguage(env, await signIn(env), "de"),
        LOCALE_COOKIE_NAME,
      );

      expect(attributes).toContain("SameSite=Lax");
      expect(attributes).not.toContain("Secure");
    });
  });

  // Only reachable by a forged form — the `<select>` offers exactly the locales
  // that are on offer — so it is refused rather than folded to a default, and it
  // takes the name down with it: the save is one write or none.
  test("a locale that is not on offer is refused", async () => {
    await withStorage(async (stores, env) => {
      const session = await signIn(env);

      for (const locale of ["fr", "en-XA", "de-DE"]) {
        const response = await saveProfile(env, session, {
          locale,
          name: "Grace",
        });

        expect(response.status, locale).toBe(200);
        expect(await response.text(), locale).toContain(
          "That language is not available.",
        );
        expect(cookieValue(response, LOCALE_COOKIE_NAME), locale).toBeNull();
        await expect(
          stores.users.getById(session.actorId),
          locale,
        ).resolves.toMatchObject({ locale: null, name: "Ada" });
      }
    });
  });

  test("the stored preference outranks a cookie from another browser", async () => {
    await withStorage(async (_stores, env) => {
      const session = await signIn(env);

      await chooseLanguage(env, session, "de");

      const page = await get(env, "/profile", {
        // A German account reading through a browser that asked for English.
        Cookie: `${session.cookieHeader}; ${LOCALE_COOKIE_NAME}=en`,
      });

      expect(await page.text()).toContain(GERMAN_CHROME);
    });
  });

  /**
   * The single exception to that rule, and the reason it exists: the layout
   * audit reaches the instructor routes by signing in as staff, and a staff
   * account that has ever chosen a language has one stored. Before the
   * exception, `bun run i18n:overflow` asked for `en-XA` and measured that
   * account's language instead — a vacuous check that reported success.
   *
   * Asserted against a real stored preference, both ways round, because the
   * exception is only defensible while it stays this narrow.
   */
  test("the pseudolocale outranks even a stored preference", async () => {
    await withStorage(async (_stores, env) => {
      const session = await signIn(env);

      await chooseLanguage(env, session, "de");

      const pseudo = await get(env, "/profile", {
        "Accept-Language": "en-XA",
        Cookie: session.cookieHeader,
      });
      const html = await pseudo.text();

      expect(html).toContain('lang="en-XA"');
      expect(html).not.toContain(GERMAN_CHROME);

      // Any other request-borne language still loses to the stored one.
      const english = await get(env, "/profile", {
        "Accept-Language": "en",
        Cookie: session.cookieHeader,
      });

      expect(await english.text()).toContain(GERMAN_CHROME);
    });
  });
});

const CLAIM_DL_SETTINGS =
  "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings";

/** A German string from the Deep Linking picker's own body. */
const GERMAN_PICKER_TITLE = "Aufgabe auswählen";

let cachedToolKey: Promise<string> | null = null;

/** The tool's signing key; Deep Linking refuses to render without one. */
function testToolKey(): Promise<string> {
  cachedToolKey ??= (async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    const jwk = await exportJWK(pair.privateKey);

    jwk.alg = "RS256";
    jwk.kid = "carnap-tool-locale-test";

    return JSON.stringify(jwk);
  })();

  return cachedToolKey;
}

describe("the LTI launch_presentation.locale claim", () => {
  async function launch(
    app: WorkerApp,
    env: Env,
    options: {
      /** Extra id_token claims, e.g. Deep Linking settings. */
      readonly claims?: Record<string, unknown>;
      readonly cookie?: string;
      readonly locale?: string;
      readonly messageType?: string;
    } = {},
  ): Promise<Response> {
    const login = await beginTestLogin(app, env);
    const idToken = await mintIdToken({
      claims: {
        ...(options.locale === undefined
          ? {}
          : { [CLAIM_LAUNCH_PRESENTATION]: { locale: options.locale } }),
        ...options.claims,
      },
      // An instructor, so the launch lands on the course page rather than
      // failing for want of a provisioned assignment.
      email: "instructor@example.test",
      nonce: login.nonce,
      roles: [INSTRUCTOR_ROLE],
      sub: "lms-instructor-1",
      ...(options.messageType === undefined
        ? {}
        : { messageType: options.messageType }),
    });
    const request = formRequest({ id_token: idToken, state: login.state });

    return app.request(
      "/lti/launch",
      options.cookie === undefined
        ? request
        : {
            ...request,
            headers: { ...request.headers, Cookie: options.cookie },
          },
      env,
    );
  }

  async function withLti(
    run: (app: WorkerApp, env: Env) => Promise<void>,
    overrides: Partial<Omit<Env, "DB">> = {},
  ): Promise<void> {
    const storage: TestStorage = await createTestStorage();

    try {
      const env: Env = {
        CARNAP_ENV: "local",
        DB: storage.db,
        ...overrides,
      };

      await registerTestPlatform(storage.stores);
      await run(await createLtiTestApp(), env);
    } finally {
      await storage.dispose();
    }
  }

  test("seeds the locale cookie from the platform's language", async () => {
    await withLti(async (app, env) => {
      const response = await launch(app, env, { locale: "de-DE" });

      expect(response.status).toBe(303);
      expect(cookieValue(response, LOCALE_COOKIE_NAME)).toBe("de");
    });
  });

  // A reader who chose English inside a German Moodle chose that; a launch is
  // not the place to overrule it.
  //
  // The launch carries the cookies a *browser* would send on its cross-site
  // POST, not a hand-written header. That distinction is the test: while the
  // cookie was `SameSite=Lax` no browser sent it here at all, so the launch saw
  // no choice to leave alone and overwrote it — and a test that supplied the
  // header itself passed all the same. Hence the https save: over plain http
  // the cookie is `Lax` of necessity.
  test("leaves an existing choice alone", async () => {
    await withLti(async (app, env) => {
      const chosen = await chooseLanguage(
        env,
        await signIn(env),
        "en",
        SECURE_ORIGIN,
      );

      expect(crossSiteCookieHeader(chosen)).toBe(`${LOCALE_COOKIE_NAME}=en`);

      const response = await launch(app, env, {
        cookie: crossSiteCookieHeader(chosen),
        locale: "de-DE",
      });

      expect(response.status).toBe(303);
      expect(cookieValue(response, LOCALE_COOKIE_NAME)).toBeNull();
    });
  });

  test("ignores a language we do not serve, and a missing claim", async () => {
    await withLti(async (app, env) => {
      for (const locale of ["fr-CA", undefined]) {
        const response = await launch(
          app,
          env,
          locale === undefined ? {} : { locale },
        );

        expect(response.status, String(locale)).toBe(303);
        expect(cookieValue(response, LOCALE_COOKIE_NAME)).toBeNull();
      }
    });
  });

  // The session branch 303s and the next request re-detects, so the cookie is
  // enough there. Deep Linking answers with a page in this very response, and
  // adopting a locale it does not render in would show the instructor English
  // chrome while setting a German cookie.
  test("the Deep Linking picker renders in the adopted language", async () => {
    await withLti(
      async (app, env) => {
        const response = await launch(app, env, {
          claims: {
            [CLAIM_DL_SETTINGS]: {
              accept_multiple: false,
              accept_types: ["ltiResourceLink"],
              deep_link_return_url: "https://lms.example.test/dl-return",
            },
          },
          locale: "de-DE",
          messageType: "LtiDeepLinkingRequest",
        });
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(cookieValue(response, LOCALE_COOKIE_NAME)).toBe("de");
        expect(html).toContain('lang="de"');
        expect(html).toContain(GERMAN_PICKER_TITLE);
        expect(html).toContain(GERMAN_CHROME);
      },
      { LTI_TOOL_PRIVATE_KEY: await testToolKey() },
    );
  });
});
