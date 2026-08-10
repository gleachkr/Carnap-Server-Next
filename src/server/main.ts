import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { createApp } from "../worker/app";
import type { AppStores } from "../worker/application/stores";
import type { Env } from "../worker/env";
import type { AppBindings } from "../worker/http";
import { openLibSqlStorage } from "../worker/infrastructure/database/libsql";
import { applyPendingMigrations } from "../worker/infrastructure/database/migrate";
import { NOSNIFF_HEADER } from "../worker/middleware/security-headers";
import { runGradePassback } from "../worker/passback";
import {
  FONT_CACHE_CONTROL,
  FONT_ROUTE_PREFIX,
} from "../worker/web/math-font";

/**
 * Carnap as an ordinary long-running server, for anyone hosting their own.
 *
 * The application is untouched: this file supplies the four things Cloudflare
 * used to supply — storage, static files, an execution context, and a clock
 * that ticks the grade-passback sweep — and then hands every request to the
 * same `createApp()` the Worker serves.
 */

const DEFAULT_DATABASE_URL = "file:./data/carnap.db";
const DEFAULT_PORT = 8787;

/** The cron trigger's schedule, kept the same so behaviour does not fork. */
const PASSBACK_INTERVAL_MS = 5 * 60 * 1000;

function present<K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

/**
 * The bindings, from the process environment. Absent stays absent rather than
 * becoming an explicit `undefined`, because the application distinguishes the
 * two: `RESEND_API_KEY` unset is "no email configured", and every such check
 * is written against the key being missing.
 *
 * `CARNAP_ENV` defaults to `production`, which is the safe default rather than
 * the convenient one — `local` weakens cookies and hands the login token back
 * in the response body, and a self-hosted instance that quietly did that would
 * be a security hole with no symptom.
 */
function readEnv(): Env {
  return {
    CARNAP_ENV: process.env.CARNAP_ENV ?? "production",
    ...present("ADMIN_BOOTSTRAP_TOKEN", process.env.ADMIN_BOOTSTRAP_TOKEN),
    ...present("AUTH_LOGIN_CONFIRM_URL", process.env.AUTH_LOGIN_CONFIRM_URL),
    ...present("AUTH_LOGIN_EMAIL_FROM", process.env.AUTH_LOGIN_EMAIL_FROM),
    ...present("LTI_TOOL_PRIVATE_KEY", process.env.LTI_TOOL_PRIVATE_KEY),
    ...present("RESEND_API_KEY", process.env.RESEND_API_KEY),
  };
}

/** libsql opens the file but will not create the directory holding it. */
async function ensureDatabaseDirectory(url: string): Promise<void> {
  if (!url.startsWith("file:")) {
    return;
  }

  const path = url.slice("file:".length).replace(/^\/\//, "").split("?")[0];

  if (path === undefined || path.length === 0) {
    return;
  }

  const directory = dirname(path);

  if (directory !== "." && directory.length > 0) {
    await mkdir(directory, { recursive: true });
  }
}

const env = readEnv();
const databaseUrl = process.env.CARNAP_DATABASE_URL ?? DEFAULT_DATABASE_URL;
const port = Number(process.env.PORT ?? DEFAULT_PORT);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(
    `PORT must be a positive integer, got "${process.env.PORT}".`,
  );
}

await ensureDatabaseDirectory(databaseUrl);

const storage = await openLibSqlStorage(
  databaseUrl,
  process.env.CARNAP_DATABASE_AUTH_TOKEN,
);
const applied = await applyPendingMigrations(storage.db);

if (applied.length > 0) {
  console.log(`migrations applied: ${applied.join(", ")}`);
}

if (env.CARNAP_ENV !== "local" && env.RESEND_API_KEY === undefined) {
  // Login delivery fails closed outside `local`, and it fails at the moment
  // someone tries to sign in rather than at boot — so say it now, while there
  // is still an operator looking.
  console.warn(
    "RESEND_API_KEY is not set: nobody will be able to sign in. " +
      "Set it and AUTH_LOGIN_EMAIL_FROM, or run with CARNAP_ENV=local.",
  );
}

/**
 * Promises handed to `waitUntil`, which on Cloudflare would outlive the
 * response. Here nothing needs keeping alive — the process is already running
 * — so the set exists only so shutdown can wait for work in flight instead of
 * cutting a grade delivery in half.
 */
const pending = new Set<Promise<unknown>>();

/**
 * Cloudflare's type also names `exports`, `tracing`, and `cache` — platform
 * machinery with no counterpart here. The application reaches for exactly one
 * member of it, `waitUntil` (`passback.ts`), so this implements that and
 * asserts the rest rather than fabricating stand-ins for internals nothing off
 * Cloudflare will ever call.
 */
const executionCtx = {
  passThroughOnException() {},
  props: {},
  waitUntil(promise: Promise<unknown>) {
    pending.add(promise);

    void promise
      .catch((error: unknown) => {
        console.error("background_task_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        pending.delete(promise);
      });
  },
} as unknown as ExecutionContext;

const app = new Hono<AppBindings>();

// Cloudflare's assets binding answers before the Worker ever runs; this is
// that, and it has to stay ahead of the app for the same reason. `public/`
// holds nothing but the client bundles, the compiler's WASM and the math font,
// so the mount is scoped to them rather than to `*` — a catch-all here would
// sit in front of every page.
app.use(
  "/assets/*",
  serveStatic({
    // The other half of `public/_headers`, which only Workers Assets reads.
    // Everything under the font prefix is named by version, so it can be kept
    // for a year; nothing else under `/assets` is content-addressed, and
    // saying `immutable` about `editor-preview.js` would strand a returning
    // reader on the bundle they happened to fetch first.
    onFound: (path, context) => {
      // This mount answers ahead of `createApp()`, so its responses never meet
      // the security-headers middleware. `nosniff` is the header that matters
      // for a file — these are served under the same origin the scripts are
      // trusted from — so it is set here, as `public/_headers` sets it for the
      // Cloudflare half.
      context.header(NOSNIFF_HEADER.name, NOSNIFF_HEADER.value);

      if (path.includes(FONT_ROUTE_PREFIX)) {
        context.header("Cache-Control", FONT_CACHE_CONTROL);
      }
    },
    root: "./public",
  }),
);

// Where the Worker resolves storage per request from its `DB` binding, this
// hands over stores opened once at boot. `storesForContext` prefers whatever
// it finds here, so nothing downstream has to know which happened.
app.use("*", async (context, next) => {
  context.set("stores", storage.stores);
  await next();
});

app.route("/", createApp());

let sweeping = false;

/**
 * The cron trigger's job. Skipping while one is still running matters: a sweep
 * that outlasts its interval would otherwise stack up copies of itself, each
 * competing for the same jobs, at exactly the moment the LMS is slow.
 */
async function sweepGradePassback(stores: AppStores): Promise<void> {
  if (sweeping) {
    return;
  }

  sweeping = true;

  try {
    await runGradePassback(env, stores, `sweep-${Date.now()}`);
  } catch (error: unknown) {
    console.error("lti_grade_passback_sweep_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    sweeping = false;
  }
}

const sweep = setInterval(() => {
  void sweepGradePassback(storage.stores);
}, PASSBACK_INTERVAL_MS);

const server = Bun.serve({
  fetch: (request) => app.fetch(request, env, executionCtx),
  port,
});

console.log(
  `carnap listening on http://localhost:${server.port} ` +
    `(${env.CARNAP_ENV}, ${databaseUrl})`,
);

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}: shutting down`);

  clearInterval(sweep);
  await server.stop();
  // Grade deliveries kicked from a request that has already answered. Losing
  // one is not fatal — the sweep retries it on the next boot — but finishing
  // is free here and spares the LMS a duplicate.
  await Promise.allSettled([...pending]);
  storage.close();

  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
