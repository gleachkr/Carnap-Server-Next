import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { Hono } from "hono";

import { createApp } from "../src/worker/app";
import type { AppStores } from "../src/worker/application/stores";
import type { Env } from "../src/worker/env";
import type { AppBindings } from "../src/worker/http";
import { createLibSqlTestStorage } from "./helpers/storage";

setDefaultTimeout(30_000);

/**
 * A self-hosted instance binds no `DB` at all — its storage arrives on the
 * context instead. That difference is the whole of what `src/server/main.ts`
 * does differently, and it is invisible until something asks the wrong
 * question about it.
 */
const SERVER_ENV: Env = { CARNAP_ENV: "local" };

/** The composition `src/server/main.ts` performs, minus the socket. */
function serverApp(stores: AppStores): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use("*", async (context, next) => {
    context.set("stores", stores);
    await next();
  });
  app.route("/", createApp());

  return app;
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .join("; ");
}

describe("serving without a D1 binding", () => {
  test("signs someone in and keeps them signed in", async () => {
    const storage = await createLibSqlTestStorage();

    try {
      const app = serverApp(storage.stores);
      const json = (body: unknown): RequestInit => ({
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const start = await app.request(
        "/auth/login/start",
        json({ email: "ada@example.test", name: "Ada" }),
        SERVER_ENV,
      );

      expect(start.status).toBe(202);

      const startBody = (await start.json()) as {
        login: { loginToken: string };
      };
      const confirm = await app.request(
        "/auth/login/confirm",
        json({ loginToken: startBody.login.loginToken }),
        SERVER_ENV,
      );

      expect(confirm.status).toBe(200);

      // The actual regression: resolving the actor used to be gated on the
      // `DB` binding rather than on storage being available, so every request
      // after a successful sign-in came back anonymous — a login that appeared
      // to work and then silently did nothing.
      const me = await app.request(
        "/auth/me",
        { headers: { Cookie: cookieHeader(confirm) } },
        SERVER_ENV,
      );

      expect(me.status).toBe(200);
      await expect(me.json()).resolves.toMatchObject({
        actor: { email: "ada@example.test", name: "Ada" },
      });
    } finally {
      await storage.dispose();
    }
  });

  test("answers as a signed-out visitor when there is no storage either", async () => {
    // Neither a binding nor injected stores: the pages that need an actor must
    // still answer rather than throwing out of the middleware.
    const app = serverApp(undefined as unknown as AppStores);
    const response = await app.request("/auth/me", undefined, SERVER_ENV);

    expect(response.status).toBe(401);
  });
});
