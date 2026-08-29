import { describe, expect, test } from "bun:test";

import type {
  TurnstileVerifier,
  VerifyTurnstileInput,
} from "../src/worker/application/auth";
import {
  type AppErrorStatus,
  AppHttpError,
} from "../src/worker/application/errors";
import { createStoredLoginRateLimiter } from "../src/worker/application/login-rate-limit";
import type { Env } from "../src/worker/env";
import {
  CloudflareTurnstileVerifier,
  turnstileFromEnv,
} from "../src/worker/infrastructure/turnstile";
import { appRequest, createTestApp } from "./helpers/app";
import { createTestStorage, type TestStorage } from "./helpers/storage";

/**
 * The Turnstile gate on asking for a login email: the verifier that redeems
 * widget tokens against Cloudflare, the two routes that must both stand
 * behind it, the login page that renders the widget and widens its CSP for
 * it, and the looser per-IP bound a verified request earns.
 */

async function expectAppError(
  run: Promise<unknown>,
  status: AppErrorStatus,
  code: string,
): Promise<void> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(AppHttpError);

    const appError = error as AppHttpError;

    expect(appError.status).toBe(status);
    expect(appError.code).toBe(code);
    return;
  }

  throw new Error(`Expected a ${status} ${code} error.`);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

describe("the siteverify client", () => {
  test("a missing token is refused without a verification call", async () => {
    const verifier = new CloudflareTurnstileVerifier({
      fetcher: () => {
        throw new Error("Nothing should be fetched for an absent token.");
      },
      secretKey: "secret-1",
    });

    await expectAppError(
      verifier.verify({ ipAddress: "203.0.113.7", token: null }),
      403,
      "login_challenge_missing",
    );
    await expectAppError(
      verifier.verify({ ipAddress: "203.0.113.7", token: "" }),
      403,
      "login_challenge_missing",
    );
  });

  test("a passing token redeems with the secret, the client IP, and our name", async () => {
    const requests: { body: unknown; headers: Headers; url: string }[] = [];
    const verifier = new CloudflareTurnstileVerifier({
      fetcher: async (input, init) => {
        requests.push({
          body: JSON.parse(String(init?.body)),
          headers: new Headers(init?.headers),
          url: String(input),
        });

        return jsonResponse({ success: true });
      },
      secretKey: "secret-1",
    });

    await verifier.verify({ ipAddress: "203.0.113.7", token: "tok-1" });

    expect(requests[0]?.url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(requests[0]?.body).toEqual({
      remoteip: "203.0.113.7",
      response: "tok-1",
      secret: "secret-1",
    });
    // Workers' fetch sends no User-Agent unless one is set, and we name
    // ourselves on every outbound request.
    expect(requests[0]?.headers.get("User-Agent")).toContain("CarnapServer");
  });

  test("an unknown client address is simply not asserted", async () => {
    let body: Record<string, unknown> = {};
    const verifier = new CloudflareTurnstileVerifier({
      fetcher: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return jsonResponse({ success: true });
      },
      secretKey: "secret-1",
    });

    await verifier.verify({ ipAddress: null, token: "tok-1" });

    expect("remoteip" in body).toBe(false);
  });

  test("a failed challenge is the requester's problem", async () => {
    const verifier = new CloudflareTurnstileVerifier({
      fetcher: async () =>
        jsonResponse({
          "error-codes": ["invalid-input-response"],
          success: false,
        }),
      secretKey: "secret-1",
    });

    await expectAppError(
      verifier.verify({ ipAddress: null, token: "tok-1" }),
      403,
      "login_challenge_failed",
    );
  });

  test("a replayed token fails like an unsolved one", async () => {
    const verifier = new CloudflareTurnstileVerifier({
      fetcher: async () =>
        jsonResponse({
          "error-codes": ["timeout-or-duplicate"],
          success: false,
        }),
      secretKey: "secret-1",
    });

    await expectAppError(
      verifier.verify({ ipAddress: null, token: "tok-1" }),
      403,
      "login_challenge_failed",
    );
  });

  test("a bad secret is the deployment's problem, not the requester's", async () => {
    // Without this distinction a mistyped secret reads as "the check did not
    // pass, try again" to every single reader, forever.
    const verifier = new CloudflareTurnstileVerifier({
      fetcher: async () =>
        jsonResponse({
          "error-codes": ["invalid-input-secret"],
          success: false,
        }),
      secretKey: "wrong",
    });

    await expectAppError(
      verifier.verify({ ipAddress: null, token: "tok-1" }),
      500,
      "login_challenge_misconfigured",
    );
  });

  test.each([
    [
      "an unreachable endpoint",
      () => {
        throw new Error("connect ECONNREFUSED");
      },
    ],
    ["an error status", async () => new Response("nope", { status: 503 })],
    ["an unreadable body", async () => new Response("not json")],
  ])("%s fails closed", async (_name, fetcher) => {
    const verifier = new CloudflareTurnstileVerifier({
      fetcher: fetcher as () => Promise<Response>,
      secretKey: "secret-1",
    });

    await expectAppError(
      verifier.verify({ ipAddress: null, token: "tok-1" }),
      500,
      "login_challenge_unavailable",
    );
  });

  test("the gate exists exactly when the secret does", () => {
    expect(turnstileFromEnv({ CARNAP_ENV: "local" })).toBeNull();
    expect(
      turnstileFromEnv({ CARNAP_ENV: "local", TURNSTILE_SITE_KEY: "site" }),
    ).toBeNull();
    expect(
      turnstileFromEnv({
        CARNAP_ENV: "local",
        TURNSTILE_SECRET_KEY: "secret",
      }),
    ).not.toBeNull();
  });
});

/** A verifier that records what it saw and answers as told. */
function fakeVerifier(outcome?: AppHttpError): {
  verifier: TurnstileVerifier;
  readonly seen: VerifyTurnstileInput[];
} {
  const seen: VerifyTurnstileInput[] = [];

  return {
    seen,
    verifier: {
      async verify(input) {
        seen.push(input);

        if (outcome !== undefined) {
          throw outcome;
        }
      },
    },
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

describe("the login routes stand behind the gate", () => {
  test("the form's widget token reaches the verifier, and the mail goes out", async () => {
    await withStorage(async (_storage, env) => {
      const { seen, verifier } = fakeVerifier();
      const app = createTestApp({ turnstile: { verifier } });
      const form = new FormData();

      form.set("email", "ada@example.test");
      form.set("next", "");
      form.set("cf-turnstile-response", "tok-1");

      const response = await appRequest(
        app,
        "/login",
        {
          body: form,
          headers: { "CF-Connecting-IP": "203.0.113.7" },
          method: "POST",
        },
        env,
      );

      expect(response.status).toBe(200);
      expect(seen).toEqual([{ ipAddress: "203.0.113.7", token: "tok-1" }]);
    });
  });

  test("a refused form request gets the login page back, not a raw error", async () => {
    await withStorage(async (storage, env) => {
      const { verifier } = fakeVerifier(
        new AppHttpError(403, "login_challenge_missing", "No challenge."),
      );
      const app = createTestApp({ turnstile: { verifier } });
      const form = new FormData();

      form.set("email", "ada@example.test");
      form.set("next", "");

      const response = await appRequest(
        app,
        "/login",
        { body: form, method: "POST" },
        env,
      );

      expect(response.status).toBe(403);
      expect(await response.text()).toContain("form");

      // Refused before anything was issued: no mail budget spent, no
      // challenge row written.
      const hits = await storage.db
        .prepare("SELECT COUNT(*) AS hits FROM login_rate_limit_hits")
        .first<{ hits: number }>();

      expect(hits?.hits).toBe(0);
    });
  });

  test("the JSON route is gated exactly like the form", async () => {
    await withStorage(async (_storage, env) => {
      const { seen, verifier } = fakeVerifier();
      const app = createTestApp({ turnstile: { verifier } });
      const response = await appRequest(
        app,
        "/auth/login/start",
        {
          body: JSON.stringify({
            email: "ada@example.test",
            turnstileToken: "tok-2",
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
        env,
      );

      expect(response.status).toBe(202);
      expect(seen).toEqual([{ ipAddress: null, token: "tok-2" }]);
    });
  });

  test("a refusal on the JSON route carries the verifier's code", async () => {
    await withStorage(async (_storage, env) => {
      const { verifier } = fakeVerifier(
        new AppHttpError(403, "login_challenge_failed", "Failed."),
      );
      const app = createTestApp({ turnstile: { verifier } });
      const response = await appRequest(
        app,
        "/auth/login/start",
        {
          body: JSON.stringify({ email: "ada@example.test" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
        env,
      );
      const body = (await response.json()) as {
        readonly error: { readonly code: string };
      };

      expect(response.status).toBe(403);
      expect(body.error.code).toBe("login_challenge_failed");
    });
  });

  test("with no verifier anywhere, the routes behave as before", async () => {
    await withStorage(async (_storage, env) => {
      const response = await appRequest(
        createTestApp(),
        "/auth/login/start",
        {
          body: JSON.stringify({ email: "ada@example.test" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
        env,
      );

      expect(response.status).toBe(202);
    });
  });
});

describe("the verified per-IP bound", () => {
  test("a verified request is held to the looser IP limit", async () => {
    await withStorage(async (storage) => {
      const limiter = createStoredLoginRateLimiter({
        auth: storage.stores.auth,
        perIpAddress: 2,
        perIpAddressVerified: 4,
      });
      const check = (attempt: number, turnstileVerified: boolean) =>
        limiter.check({
          email: `student${attempt}@example.test`,
          ipAddress: "203.0.113.7",
          turnstileVerified,
        });

      await check(1, true);
      await check(2, true);
      // Past the unverified bound, inside the verified one.
      await check(3, true);
      await check(4, true);
      await expect(check(5, true)).rejects.toThrow();
    });
  });

  test("an unverified request keeps the tight bound over the same table", async () => {
    await withStorage(async (storage) => {
      const limiter = createStoredLoginRateLimiter({
        auth: storage.stores.auth,
        perIpAddress: 2,
        perIpAddressVerified: 4,
      });
      const check = (attempt: number, turnstileVerified: boolean) =>
        limiter.check({
          email: `student${attempt}@example.test`,
          ipAddress: "203.0.113.7",
          turnstileVerified,
        });

      await check(1, true);
      await check(2, true);
      // The hits above count against it: verification loosens the bound for
      // a request, not the ledger under all of them.
      await expect(check(3, false)).rejects.toThrow();
    });
  });

  test("the email bound does not loosen for a verified request", async () => {
    // A paid-for challenge solve threatens a stranger's mailbox exactly as
    // much as a script does.
    await withStorage(async (storage) => {
      const limiter = createStoredLoginRateLimiter({
        auth: storage.stores.auth,
        perEmail: 2,
      });
      const check = () =>
        limiter.check({
          email: "ada@example.test",
          ipAddress: null,
          turnstileVerified: true,
        });

      await check();
      await check();
      await expect(check()).rejects.toThrow();
    });
  });
});

describe("the login page's widget", () => {
  const CONFIGURED: Env = {
    CARNAP_ENV: "local",
    TURNSTILE_SECRET_KEY: "secret-1",
    TURNSTILE_SITE_KEY: "site-1",
  };

  test("both keys render the widget and widen the page's CSP for it", async () => {
    const response = await appRequest(
      createTestApp(),
      "/login",
      undefined,
      CONFIGURED,
    );
    const body = await response.text();
    const policy = response.headers.get("Content-Security-Policy") ?? "";
    const directives = policy.split("; ");

    expect(body).toContain('class="cf-turnstile"');
    expect(body).toContain('data-sitekey="site-1"');
    expect(body).toContain(
      "https://challenges.cloudflare.com/turnstile/v0/api.js",
    );
    expect(directives).toContain(
      "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
    );
    expect(directives).toContain(
      "frame-src 'self' https://challenges.cloudflare.com",
    );
  });

  test("a site key with no secret renders nothing and widens nothing", async () => {
    // A widget whose tokens nothing checks would be the reassuring checkbox
    // with the gate it implies quietly off.
    const response = await appRequest(createTestApp(), "/login", undefined, {
      CARNAP_ENV: "local",
      TURNSTILE_SITE_KEY: "site-1",
    });
    const policy = response.headers.get("Content-Security-Policy") ?? "";

    expect(await response.text()).not.toContain("cf-turnstile");
    expect(policy).not.toContain("challenges.cloudflare.com");
  });

  test("the grant does not leak onto pages without the widget", async () => {
    const response = await appRequest(
      createTestApp(),
      "/donate",
      undefined,
      CONFIGURED,
    );

    expect(
      response.headers.get("Content-Security-Policy") ?? "",
    ).not.toContain("challenges.cloudflare.com");
  });
});
