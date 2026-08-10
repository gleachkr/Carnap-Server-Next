import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { AppStores } from "../src/worker/application/stores";
import { createTestStorage, type TestStorage } from "./helpers/storage";

setDefaultTimeout(30_000);

const MIGRATION_PATH =
  "src/worker/infrastructure/database/migrations/0021_content_author_capability.sql";

const NOW = "2026-08-01T00:00:00.000Z";

/**
 * The backfill in migration 0021, run again.
 *
 * Every test database starts empty, so the migration that runs during setup
 * matches no rows and proves nothing. Reading the file back and running it over
 * seeded rows is the only way the statement that will meet the real database
 * ever gets executed here — and it doubles as the check that running it twice
 * grants nothing twice.
 */
async function runBackfill(db: D1Database): Promise<void> {
  await db.prepare(await Bun.file(MIGRATION_PATH).text()).run();
}

async function withStorage(
  run: (storage: TestStorage) => Promise<void>,
): Promise<void> {
  const storage = await createTestStorage();

  try {
    await run(storage);
  } finally {
    await storage.dispose();
  }
}

async function createUser(
  stores: AppStores,
  id: string,
  email: string,
): Promise<string> {
  await stores.users.create({
    createdAt: NOW,
    email,
    id,
    name: null,
  });

  return id;
}

async function capabilitiesOf(
  stores: AppStores,
  userId: string,
): Promise<string[]> {
  const grants = await stores.platformCapabilities.listActiveForUser(userId);

  return grants.map((grant) => grant.capability);
}

describe("the content_author backfill", () => {
  test("grants the capability to everyone who could already write", async () => {
    await withStorage(async ({ db, stores }) => {
      const creator = await createUser(
        stores,
        "user-creator",
        "creator@example.test",
      );
      const admin = await createUser(
        stores,
        "user-admin",
        "admin@example.test",
      );
      const owner = await createUser(
        stores,
        "user-owner",
        "owner@example.test",
      );
      const student = await createUser(
        stores,
        "user-student",
        "student@example.test",
      );

      await stores.platformCapabilities.grant({
        capability: "course_creator",
        grantedAt: NOW,
        grantedById: null,
        id: "grant-creator",
        userId: creator,
      });
      await stores.platformCapabilities.grant({
        capability: "site_admin",
        grantedAt: NOW,
        grantedById: null,
        id: "grant-admin",
        userId: admin,
      });
      // No grant of any kind, but content to their name: an author by
      // demonstration, whatever anybody wrote down.
      await stores.content.createItem({
        createdAt: NOW,
        id: "item-owned",
        ownerUserId: owner,
        title: "Week one",
      });

      await runBackfill(db);

      expect(await capabilitiesOf(stores, creator)).toContain(
        "content_author",
      );
      expect(await capabilitiesOf(stores, admin)).toContain("content_author");
      expect(await capabilitiesOf(stores, owner)).toEqual(["content_author"]);
      expect(await capabilitiesOf(stores, student)).toEqual([]);
    });
  });

  test("passes over a revoked grant and does not grant twice", async () => {
    await withStorage(async ({ db, stores }) => {
      const retired = await createUser(
        stores,
        "user-retired",
        "retired@example.test",
      );
      const creator = await createUser(
        stores,
        "user-still-here",
        "still@example.test",
      );

      await stores.platformCapabilities.grant({
        capability: "course_creator",
        grantedAt: NOW,
        grantedById: null,
        id: "grant-retired",
        userId: retired,
      });
      await stores.platformCapabilities.revoke({
        capability: "course_creator",
        revokedAt: NOW,
        userId: retired,
      });
      await stores.platformCapabilities.grant({
        capability: "course_creator",
        grantedAt: NOW,
        grantedById: null,
        id: "grant-still-here",
        userId: creator,
      });

      await runBackfill(db);
      await runBackfill(db);

      // A capability somebody took away is not one to hand back.
      expect(await capabilitiesOf(stores, retired)).toEqual([]);
      expect(await capabilitiesOf(stores, creator)).toEqual([
        "content_author",
        "course_creator",
      ]);
    });
  });

  test("writes ids in the shape the application writes", async () => {
    await withStorage(async ({ db, stores }) => {
      // Ids are opaque, but they are also sorted and compared, and a row the
      // migration wrote should not be distinguishable from one a Worker wrote.
      for (const index of [1, 2, 3]) {
        await createUser(
          stores,
          `user-${index}`,
          `user-${index}@example.test`,
        );
        await stores.platformCapabilities.grant({
          capability: "course_creator",
          grantedAt: NOW,
          grantedById: null,
          id: `grant-${index}`,
          userId: `user-${index}`,
        });
      }

      await runBackfill(db);

      const rows = await db
        .prepare(
          "SELECT id, granted_at FROM platform_capability_grants WHERE capability = 'content_author'",
        )
        .all<{ granted_at: string; id: string }>();
      const ids = rows.results.map((row) => row.id);

      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);

      for (const row of rows.results) {
        expect(row.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(row.granted_at).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        );
      }
    });
  });
});
