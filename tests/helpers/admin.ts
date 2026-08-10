import type { PlatformCapability } from "../../src/worker/domain/admin";
import type { Env } from "../../src/worker/env";

export async function grantTestCapability(
  env: Env,
  userId: string,
  capability: PlatformCapability,
): Promise<void> {
  const now = new Date().toISOString();
  const id = `test_${capability}_${Date.now()}_${Math.random()}`;
  // Optional on `Env` since a self-hosted server binds no D1; every test that
  // reaches here built its env from `createTestStorage`, so it is present.
  const db = env.DB;

  if (db === undefined) {
    throw new Error("grantTestCapability needs a D1 binding.");
  }

  await db
    .prepare(
      `INSERT INTO platform_capability_grants (
      id,
      user_id,
      capability,
      granted_by_id,
      granted_at,
      revoked_at
    ) VALUES (?, ?, ?, NULL, ?, NULL)`,
    )
    .bind(id, userId, capability, now)
    .run();
}

export async function grantTestCourseCreator(
  env: Env,
  userId: string,
): Promise<void> {
  return grantTestCapability(env, userId, "course_creator");
}

export async function grantTestContentAuthor(
  env: Env,
  userId: string,
): Promise<void> {
  return grantTestCapability(env, userId, "content_author");
}
