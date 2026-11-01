import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";

import type { Env } from "../src/worker/env";
import { resetMissingForwardingReports } from "../src/worker/http";
import { appRequest, createTestApp } from "./helpers/app";
import { withStorage } from "./helpers/http";

/**
 * A self-hosted instance behind a TLS-terminating proxy receives every request
 * over plain http, and only the proxy's `X-Forwarded-*` headers say what the
 * browser is actually on. `CARNAP_TRUST_PROXY` is what lets those headers
 * speak; without it they are text any client can send, and are ignored.
 */

const PROXIED = {
  "X-Forwarded-For": "203.0.113.20",
  "X-Forwarded-Host": "logic.example.edu",
  "X-Forwarded-Proto": "https",
};

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

/**
 * Open a login link as the browser does, through the proxy: the page it opens
 * only asks, and its button's same-origin POST signs in.
 */
async function followLoginLink(link: string, env: Env): Promise<Response> {
  const url = new URL(link);
  const page = await appRequest(
    createTestApp(),
    url.href,
    { headers: { Accept: "text/html", ...PROXIED } },
    env,
  );

  expect(page.status).toBe(200);

  return appRequest(
    createTestApp(),
    new URL("/login/confirm", url).href,
    {
      body: new URLSearchParams({
        token: url.searchParams.get("token") ?? "",
      }),
      headers: {
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: url.origin,
        ...PROXIED,
      },
      method: "POST",
    },
    env,
  );
}

/** The session's `Set-Cookie`, under either name (`__Host-` on https). */
function sessionCookie(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .find((entry) => /^(__Host-)?carnap_session=/.test(entry));

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

      const confirm = await followLoginLink(link, trusted(env));

      expect(confirm.status).toBe(303);
      expect(sessionCookie(confirm)).toStartWith("__Host-carnap_session=");
      expect(sessionCookie(confirm)).toContain("Secure");
    });
  });

  test("without the opt-in the request's own origin stands", async () => {
    await withStorage(async (_storage, env) => {
      const link = await startLogin(env, PROXIED);

      expect(link).toStartWith("http://carnap.test/login/confirm?");

      const confirm = await followLoginLink(link, env);

      expect(confirm.status).toBe(303);
      expect(sessionCookie(confirm)).toStartWith("carnap_session=");
      expect(sessionCookie(confirm)).not.toContain("Secure");
    });
  });
});

/**
 * `CARNAP_TRUST_PROXY` with a proxy that sends nothing fails silently — no
 * client address, unprefixed cookies, links to the wrong origin — so the
 * application says so in the log: where the value is used, not on arrival,
 * and at most once an hour per header.
 */
describe("a trusted proxy that leaves out a header", () => {
  type Line = Record<string, unknown>;

  let warnings: Line[] = [];
  let spy: { mockRestore(): void } | undefined;

  beforeEach(() => {
    resetMissingForwardingReports();
    warnings = [];
    spy = spyOn(console, "warn").mockImplementation((line: unknown) => {
      warnings.push(JSON.parse(String(line)) as Line);
    });
  });

  afterEach(() => {
    spy?.mockRestore();
  });

  function missing(header: string): Line[] {
    return warnings.filter(
      (line) =>
        line.event === "proxy_header_missing" && line.header === header,
    );
  }

  test("a bare request that uses neither value reports nothing", async () => {
    const app = createTestApp();
    const env = trusted({ CARNAP_ENV: "local" });

    for (const path of ["/health", "/login", "/"]) {
      await appRequest(app, `http://carnap.test${path}`, {}, env);
    }

    expect(warnings).toEqual([]);
  });

  test("a login without X-Forwarded-For reports the address, once an hour", async () => {
    await withStorage(async (_storage, env) => {
      const { "X-Forwarded-For": _address, ...noAddress } = PROXIED;
      const now = Date.now();
      const clock = spyOn(Date, "now").mockReturnValue(now);

      try {
        await startLogin(trusted(env), {
          ...noAddress,
          "X-Real-IP": "1.2.3.4",
        });
        await startLogin(trusted(env), noAddress);

        expect(missing("X-Forwarded-For")).toEqual([
          expect.objectContaining({
            level: "warn",
            occurrences: 1,
            path: "/login",
            unreadHeaders: ["X-Real-IP"],
            use: "client_address",
          }),
        ]);

        clock.mockReturnValue(now + 60 * 60 * 1000);
        await startLogin(trusted(env), noAddress);

        expect(missing("X-Forwarded-For")).toHaveLength(2);
        expect(missing("X-Forwarded-For")[1]).toMatchObject({
          occurrences: 2,
        });
        expect(missing("X-Forwarded-For")[1]).not.toHaveProperty(
          "unreadHeaders",
        );
      } finally {
        clock.mockRestore();
      }
    });
  });

  test("a login link without X-Forwarded-Proto reports the scheme", async () => {
    await withStorage(async (_storage, env) => {
      const { "X-Forwarded-Proto": _scheme, ...noScheme } = PROXIED;
      const link = await startLogin(trusted(env), noScheme);

      expect(link).toStartWith("http://logic.example.edu/login/confirm?");
      expect(missing("X-Forwarded-Proto")).toEqual([
        expect.objectContaining({ path: "/login", use: "public_url" }),
      ]);
      expect(missing("X-Forwarded-For")).toEqual([]);
    });
  });

  test("a missing X-Forwarded-Host is not reported, since Host may be preserved", async () => {
    await withStorage(async (_storage, env) => {
      const { "X-Forwarded-Host": _host, ...noHost } = PROXIED;

      await startLogin(trusted(env), noHost);

      expect(warnings).toEqual([]);
    });
  });

  test("without the opt-in nothing is reported", async () => {
    await withStorage(async (_storage, env) => {
      await startLogin(env, {});

      expect(warnings).toEqual([]);
    });
  });
});
