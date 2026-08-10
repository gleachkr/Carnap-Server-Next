import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { AppStores } from "../src/worker/application/stores";
import { SEED_NOW, seedCourseWithAssignment, seedUser } from "./helpers/seed";
import { createTestStorage } from "./helpers/storage";

setDefaultTimeout(30_000);

const VOIDED_AT = "2026-01-01T01:00:00.000Z";

interface AttemptRow {
  readonly id: string;
  readonly ordinal: number;
  readonly status: string;
  readonly supersedes_attempt_id: string | null;
  readonly voided_at: string | null;
}

async function attemptRows(db: D1Database): Promise<AttemptRow[]> {
  const result = await db
    .prepare("SELECT * FROM attempts ORDER BY ordinal")
    .all<AttemptRow>();

  return result.results ?? [];
}

/** A student with one open attempt on a graded assignment. */
async function withOpenAttempt(
  run: (context: {
    readonly assignmentId: string;
    readonly db: D1Database;
    readonly stores: AppStores;
  }) => Promise<void>,
): Promise<void> {
  const storage = await createTestStorage();

  try {
    const stores = storage.stores;

    await seedUser(stores, "student");

    const assignmentId = await seedCourseWithAssignment(
      stores,
      "reset",
      "student",
    );
    const attempt = await stores.assessment.beginAttempt({
      assignmentId,
      createdFrom: "student",
      expiresAt: null,
      id: "attempt-original",
      maxAttempts: null,
      openedAt: SEED_NOW,
      userId: "student",
    });

    expect(attempt).not.toBeNull();

    await run({ assignmentId, db: storage.db, stores });
  } finally {
    await storage.dispose();
  }
}

function reset(
  stores: AppStores,
  assignmentId: string,
  newAttemptId: string,
): Promise<unknown> {
  return stores.assessment.resetAttempt({
    assignmentId,
    expiresAt: null,
    newAttemptId,
    oldAttemptId: "attempt-original",
    openedAt: VOIDED_AT,
    userId: "student",
    voidedAt: VOIDED_AT,
    voidedById: "student",
  });
}

describe("resetting an attempt", () => {
  test("voids the old attempt and records what the new one replaced", async () => {
    await withOpenAttempt(async ({ assignmentId, db, stores }) => {
      const result = await reset(stores, assignmentId, "attempt-replacement");

      expect(result).not.toBeNull();

      const rows = await attemptRows(db);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        id: "attempt-original",
        ordinal: 1,
        status: "voided",
        supersedes_attempt_id: null,
        voided_at: VOIDED_AT,
      });
      // The replacement carries the link, and takes the next ordinal — read
      // inside the insert, not handed to it.
      expect(rows[1]).toMatchObject({
        id: "attempt-replacement",
        ordinal: 2,
        status: "active",
        supersedes_attempt_id: "attempt-original",
      });
    });
  });

  test("refuses a second reset of the same attempt, and writes nothing", async () => {
    await withOpenAttempt(async ({ assignmentId, db, stores }) => {
      await reset(stores, assignmentId, "attempt-replacement");

      // The unique `supersedes_attempt_id` is what stops this, and because
      // the pair runs as one batch the rejected insert takes its own void
      // down with it rather than leaving half a reset behind.
      await expect(
        reset(stores, assignmentId, "attempt-second-replacement"),
      ).rejects.toThrow();

      const rows = await attemptRows(db);

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.id)).toEqual([
        "attempt-original",
        "attempt-replacement",
      ]);
    });
  });

  test("leaves the first reset's record intact when the second is refused", async () => {
    await withOpenAttempt(async ({ assignmentId, db, stores }) => {
      await reset(stores, assignmentId, "attempt-replacement");

      const before = await attemptRows(db);

      try {
        await reset(stores, assignmentId, "attempt-second-replacement");
      } catch {
        // The rejection is the previous test's subject; here it is the
        // rollback that matters.
      }

      expect(await attemptRows(db)).toEqual(before);
    });
  });
});
