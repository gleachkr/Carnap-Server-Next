import { type CreateAppOptions, createApp } from "../../src/worker/app";
import type { Env } from "../../src/worker/env";
import type { WorkerApp } from "../../src/worker/http";

const TEST_ENV: Env = { CARNAP_ENV: "local" };

export function createTestApp(options: CreateAppOptions = {}): WorkerApp {
  return createApp(options);
}

export async function appRequest(
  app: WorkerApp,
  path: string,
  init?: RequestInit,
  env: Env = TEST_ENV,
): Promise<Response> {
  return app.request(path, init, env);
}
