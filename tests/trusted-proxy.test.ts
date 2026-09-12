import { describe, expect, test } from "bun:test";

import type { Env } from "../src/worker/env";
import { appRequest, createTestApp } from "./helpers/app";
import { createTestStorage, type TestStorage } from "./helpers/storage";

/**
 * A self-hosted instance behind a TLS-terminating proxy receives every request
 * over plain http, and only the proxy's `X-Forwarded-*` headers say what the
 * browser is actually on. `CARNAP_TRUST_PROXY` is what lets those headers
 * speak; without it they are text any client can send, and are ignored.
 */

const PROXIED = {
  "X-Forwarded-Host": "logic.example.edu",
  "X-Forwarded-Proto": "https",
};

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

function trusted(env: Env): Env {
  return { ...env, CARNAP_TRUST_PROXY: "1" };
}

/** The sign-in link `CARNAP_ENV=local` prints into the login page. */
function loginLink(html: string): string {
  const match = html.match(/href="(https?:\/\/[^"]+\/login\/confirm[^"]+)"/);

  if (match?.[1] === undefined) {
    throw new Error("Missing local login link.");
  }

  return match[1].replaceAll("&amp;", "&");
}

async function startLogin(env: Env, headers: HeadersInit): Promise<string> {
  const response = await appRequest(
    createTestApp(),
    "http://carnap.test/login",
    {
      body: new URLSearchParams({ email: "proxied@example.test" }),
      headers: {
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      method: "POST",
    },
    env,
  );

  expect(response.status).toBe(200);

  return loginLink(await response.text());
}

function sessionCookie(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith("carnap_session="));

  if (cookie === undefined) {
    throw new Error("Missing session cookie.");
  }

  return cookie;
}

describe("behind a trusted proxy", () => {
  test("HSTS follows X-Forwarded-Proto, in both directions", async () => {
    const app = createTestApp();
    const env = trusted({ CARNAP_ENV: "local" });
    const proxiedHttps = await appRequest(
      app,
      "http://carnap.test/login",
      { headers: PROXIED },
      env,
    );
    const proxiedHttp = await appRequest(
      app,
      "https://carnap.test/login",
      { headers: { "X-Forwarded-Proto": "http" } },
      env,
    );

    expect(proxiedHttps.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000",
    );
    expect(proxiedHttp.headers.get("Strict-Transport-Security")).toBeNull();
  });

  test("the headers are ignored without the opt-in", async () => {
    const response = await appRequest(
      createTestApp(),
      "http://carnap.test/login",
      { headers: PROXIED },
      { CARNAP_ENV: "local" },
    );

    expect(response.headers.get("Strict-Transport-Security")).toBeNull();
  });

  test("a chained header's first entry is the browser's side", async () => {
    const response = await appRequest(
      createTestApp(),
      "http://carnap.test/login",
      { headers: { "X-Forwarded-Proto": "https, http" } },
      trusted({ CARNAP_ENV: "local" }),
    );

    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000",
    );
  });

  // The link goes into an email, so it has to name the address the browser
  // can reach — and the request, behind a proxy, names the one only the proxy
  // can. Same for the session cookie the link then mints: `Secure` is decided
  // by what the browser is on, not by what we heard the request over.
  test("login links and session cookies take the browser's origin", async () => {
    await withStorage(async (_storage, env) => {
      const link = await startLogin(trusted(env), PROXIED);

      expect(link).toStartWith("https://logic.example.edu/login/confirm?");

      const confirm = await appRequest(
        createTestApp(),
        link,
        { headers: { Accept: "text/html", ...PROXIED } },
        trusted(env),
      );

      expect(confirm.status).toBe(303);
      expect(sessionCookie(confirm)).toContain("Secure");
    });
  });

  test("without the opt-in the request's own origin stands", async () => {
    await withStorage(async (_storage, env) => {
      const link = await startLogin(env, PROXIED);

      expect(link).toStartWith("http://carnap.test/login/confirm?");

      const confirm = await appRequest(
        createTestApp(),
        link,
        { headers: { Accept: "text/html", ...PROXIED } },
        env,
      );

      expect(confirm.status).toBe(303);
      expect(sessionCookie(confirm)).not.toContain("Secure");
    });
  });
});
