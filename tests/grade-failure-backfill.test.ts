import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdir } from "node:fs/promises";

import { Miniflare } from "miniflare";

setDefaultTimeout(30_000);

const MIGRATIONS_DIRECTORY = "src/worker/infrastructure/database/migrations";
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** The migration that added `last_failure_reason` and backfilled it. */
const BACKFILL_MIGRATION = "0017_grade_failure_reason.sql";

interface JobRow {
  readonly id: string;
  readonly last_failure_reason: string | null;
  readonly last_error: string | null;
}

interface ExpectedRow {
  readonly reason: string;
  readonly detail: string | null;
}

/**
 * Every sentence `last_error` could hold before the reason codes landed,
 * taken from the pre-refactor `ags-client.ts` and `grade-passback.ts`, with
 * the code and platform-supplied detail each must end up as.
 */
const LEGACY_CASES: ReadonlyArray<{
  readonly id: string;
  readonly lastError: string;
  readonly expected: ExpectedRow;
}> = [
  {
    // One of the eight pre-flight sentences 0017 already handled: the repair
    // must not disturb them.
    expected: { detail: null, reason: "resource_link_unlinked" },
    id: "legacy-unlinked",
    lastError: "The LMS activity is no longer linked to an assignment.",
  },
  {
    expected: { detail: null, reason: "unexpected" },
    id: "legacy-unexpected",
    lastError: "Unexpected delivery failure.",
  },
  {
    // The LMS really did reject: the code stands, but the sentence around
    // the platform's status line was ours and goes.
    expected: {
      detail: 'HTTP 400: {"error":"bad score"}',
      reason: "lms_rejected",
    },
    id: "legacy-rejected-with-body",
    lastError:
      'The LMS rejected the score (HTTP 400: {"error":"bad score"}).',
  },
  {
    expected: { detail: "HTTP 500", reason: "lms_rejected" },
    id: "legacy-rejected-no-body",
    lastError: "The LMS rejected the score (HTTP 500).",
  },
  {
    expected: {
      detail: "HTTP 401: invalid_client",
      reason: "lms_token_refused",
    },
    id: "legacy-token-refused",
    lastError:
      "The LMS token endpoint refused the request " +
      "(HTTP 401: invalid_client).",
  },
  {
    expected: { detail: null, reason: "lms_token_unreadable" },
    id: "legacy-token-unreadable",
    lastError:
      "The LMS token endpoint returned an unreadable token response.",
  },
  {
    // The prefix case: an equality CASE can never match the variable tail.
    expected: { detail: "fetch failed", reason: "lms_unreachable" },
    id: "legacy-unreachable",
    lastError: "Could not reach the LMS: fetch failed",
  },
  {
    // A bare `error.message` from a non-ScoreDeliveryError throw. Arbitrary
    // text, and no evidence the LMS saw the grade at all.
    expected: { detail: null, reason: "unexpected" },
    id: "legacy-bare-error",
    lastError: "Cannot read properties of undefined (reading 'id')",
  },
];

/**
 * Failures recorded after 0017 shipped — on a deployment that has been
 * running the reason codes for a while. The repair must leave them alone.
 */
const MODERN_CASES: ReadonlyArray<{
  readonly id: string;
  readonly expected: ExpectedRow;
}> = [
  {
    expected: {
      detail: "HTTP 422: score exceeds maximum",
      reason: "lms_rejected",
    },
    id: "modern-rejected",
  },
  {
    expected: { detail: "fetch failed", reason: "lms_unreachable" },
    id: "modern-unreachable",
  },
  {
    expected: { detail: "boom", reason: "unexpected" },
    id: "modern-unexpected",
  },
];

async function migrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIRECTORY);

  return entries.filter((entry) => entry.endsWith(".sql")).sort();
}

async function applyMigration(db: D1Database, file: string): Promise<void> {
  const text = await Bun.file(`${MIGRATIONS_DIRECTORY}/${file}`).text();
  const statements = text
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

const TS = "2026-01-01T00:00:00.000Z";

/**
 * The owning chain a grade job needs to satisfy its foreign keys: one user,
 * one course, and a platform → deployment → context spine. A resource link
 * per job keeps the (link, user) unique index happy.
 */
async function seedFixtures(
  db: D1Database,
  linkIds: readonly string[],
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO users (id, email, created_at, updated_at) " +
        "VALUES ('user-1', 'student@example.test', ?, ?)",
    )
    .bind(TS, TS)
    .run();
  await db
    .prepare(
      "INSERT INTO courses (id, title, created_by_id, created_at, " +
        "updated_at) VALUES ('course-1', 'Course', 'user-1', ?, ?)",
    )
    .bind(TS, TS)
    .run();
  await db
    .prepare(
      "INSERT INTO lti_platforms (id, name, issuer, client_id, " +
        "authorization_endpoint, token_endpoint, jwks_uri, created_at, " +
        "updated_at) VALUES ('platform-1', 'LMS', " +
        "'https://lms.example.test', 'client-1', " +
        "'https://lms.example.test/auth', 'https://lms.example.test/token', " +
        "'https://lms.example.test/jwks', ?, ?)",
    )
    .bind(TS, TS)
    .run();
  await db
    .prepare(
      "INSERT INTO lti_deployments (id, platform_id, deployment_id, " +
        "created_at) VALUES ('deployment-1', 'platform-1', 'dep-1', ?)",
    )
    .bind(TS)
    .run();
  await db
    .prepare(
      "INSERT INTO lti_contexts (id, deployment_id, context_id, course_id, " +
        "created_at) VALUES ('context-1', 'deployment-1', 'ctx-1', " +
        "'course-1', ?)",
    )
    .bind(TS)
    .run();

  for (const linkId of linkIds) {
    await db
      .prepare(
        "INSERT INTO lti_resource_links (id, context_id, resource_link_id, " +
          "created_at, updated_at) VALUES (?, 'context-1', ?, ?, ?)",
      )
      .bind(linkId, linkId, TS, TS)
      .run();
  }
}

/** A grade job row as the pre-0017 schema knew it: prose, no reason code. */
function insertLegacyJob(
  db: D1Database,
  id: string,
  lastError: string,
): Promise<unknown> {
  return db
    .prepare(
      "INSERT INTO lti_grade_jobs (id, resource_link_id, user_id, score, " +
        "max_score, score_timestamp, status, attempt_count, " +
        "next_attempt_at, last_error, created_at, updated_at) VALUES " +
        "(?, ?, 'user-1', 1, 1, ?, 'failed', 8, ?, ?, ?, ?)",
    )
    .bind(id, id, TS, TS, lastError, TS, TS)
    .run();
}

function insertModernJob(
  db: D1Database,
  id: string,
  reason: string,
  detail: string | null,
): Promise<unknown> {
  return db
    .prepare(
      "INSERT INTO lti_grade_jobs (id, resource_link_id, user_id, score, " +
        "max_score, score_timestamp, status, attempt_count, " +
        "next_attempt_at, last_failure_reason, last_error, created_at, " +
        "updated_at) VALUES (?, ?, 'user-1', 1, 1, ?, 'failed', 8, ?, ?, " +
        "?, ?, ?)",
    )
    .bind(id, id, TS, TS, reason, detail, TS, TS)
    .run();
}

describe("grade failure reason backfill", () => {
  test("resolves every historical last_error to its own code", async () => {
    // A private database rather than the shared harness one: the rows have to
    // exist *before* the backfill runs, which means stopping the migration
    // sequence part-way through.
    const miniflare = new Miniflare({
      d1Databases: ["DB"],
      d1Persist: false,
      modules: true,
      script: `export default {
        fetch() {
          return new Response("ok");
        },
      }`,
    });

    try {
      const db = await miniflare.getD1Database("DB");
      const files = await migrationFiles();
      const backfillIndex = files.indexOf(BACKFILL_MIGRATION);

      expect(backfillIndex).toBeGreaterThan(0);

      for (const file of files.slice(0, backfillIndex)) {
        await applyMigration(db, file);
      }

      await seedFixtures(db, [
        ...LEGACY_CASES.map((legacy) => legacy.id),
        ...MODERN_CASES.map((modern) => modern.id),
      ]);

      for (const legacy of LEGACY_CASES) {
        await insertLegacyJob(db, legacy.id, legacy.lastError);
      }

      await applyMigration(db, BACKFILL_MIGRATION);

      // Written by the post-refactor code, between 0017 and the repair.
      for (const modern of MODERN_CASES) {
        await insertModernJob(
          db,
          modern.id,
          modern.expected.reason,
          modern.expected.detail,
        );
      }

      for (const file of files.slice(backfillIndex + 1)) {
        await applyMigration(db, file);
      }

      const rows = await db
        .prepare(
          "SELECT id, last_failure_reason, last_error FROM lti_grade_jobs " +
            "ORDER BY id",
        )
        .all<JobRow>();
      const actual = Object.fromEntries(
        rows.results.map((row) => [
          row.id,
          { detail: row.last_error, reason: row.last_failure_reason },
        ]),
      );
      const expected = Object.fromEntries(
        [...LEGACY_CASES, ...MODERN_CASES].map((entry) => [
          entry.id,
          entry.expected,
        ]),
      );

      expect(actual).toEqual(expected);
    } finally {
      await miniflare.dispose();
    }
  });
});
