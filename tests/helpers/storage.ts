import { sql } from "drizzle-orm";
import { Miniflare } from "miniflare";

import type { AppStores } from "../../src/worker/application/stores";
import { createD1Stores } from "../../src/worker/infrastructure/database/d1";
import type { AppDatabase } from "../../src/worker/infrastructure/database/database";
import {
  type LibSqlStorage,
  openLibSqlStorage,
} from "../../src/worker/infrastructure/database/libsql";
import {
  applyPendingMigrations,
  readMigrations,
} from "../../src/worker/infrastructure/database/migrate";

/**
 * The two hosts, as test fixtures. `createTestStorage` is D1 through miniflare
 * — what almost every test wants, since that is what runs in production — and
 * `createLibSqlTestStorage` is the self-hosted driver. `storage.contract.test`
 * runs the same suite against both.
 */

/** Storage over a real D1 binding, which raw-SQL assertions can reach for. */
export interface TestStorage {
  readonly db: D1Database;
  readonly dispose: () => Promise<void>;
  readonly stores: AppStores;
}

/**
 * The narrower thing a driver-neutral suite may assume: stores, and a way to
 * let go of them. Anything reachable from here is reachable on both hosts,
 * which is exactly the property the contract suite is asserting.
 */
export interface StoresUnderTest {
  readonly dispose: () => Promise<void>;
  readonly stores: AppStores;
}

export type StorageFactory = () => Promise<StoresUnderTest>;

async function migrationStatements(): Promise<string[]> {
  const migrations = await readMigrations();

  return migrations.flatMap((migration) => [...migration.statements]);
}

export async function applyMigrations(db: D1Database): Promise<void> {
  await db.exec("PRAGMA foreign_keys = ON");

  for (const statement of await migrationStatements()) {
    await db.prepare(statement).run();
  }
}

/**
 * Empty every table between tests. Reusing one Miniflare instance for the whole
 * process (see `sharedDatabase`) keeps the workerd startup + migration cost out
 * of the per-test path; truncating restores the clean-slate isolation that a
 * fresh database used to provide.
 */
async function resetDatabase(db: D1Database): Promise<void> {
  const tables = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' " +
        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    )
    .all<{ name: string }>();

  if (tables.results.length === 0) {
    return;
  }

  // A single batch is one transaction; `defer_foreign_keys` holds FK
  // enforcement until commit, by which point every table is empty — so the
  // deletes need no dependency ordering. (A plain `PRAGMA foreign_keys = OFF`
  // does not persist across D1's per-statement sessions.)
  await db.batch([
    db.prepare("PRAGMA defer_foreign_keys = TRUE"),
    ...tables.results.map((table) =>
      db.prepare(`DELETE FROM "${table.name}"`),
    ),
  ]);
}

/** The same truncation, over the driver-neutral handle. */
async function resetAppDatabase(db: AppDatabase): Promise<void> {
  const tables = await db.all<{ name: string }>(
    sql.raw(
      "SELECT name FROM sqlite_master WHERE type = 'table' " +
        "AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations'",
    ),
  );

  if (tables.length === 0) {
    return;
  }

  await db.batch([
    db.run(sql.raw("PRAGMA defer_foreign_keys = TRUE")),
    ...tables.map((table) => db.run(sql.raw(`DELETE FROM "${table.name}"`))),
  ]);
}

let sharedDatabase: Promise<D1Database> | null = null;
let sharedMiniflare: Miniflare | null = null;
let sharedLibSql: Promise<LibSqlStorage> | null = null;

/**
 * Shut the shared workerd down at the end of the test process.
 *
 * Without this it outlives us: miniflare's workerd is not killed when the bun
 * process exits, so it is reparented to init and stays resident — around
 * 250 MB each, forever, one per `bun test` invocation. That is invisible until
 * a day of running the suite has quietly consumed most of the machine's
 * memory, which is exactly what happened.
 *
 * Wired up as a global `afterAll` in `tests/setup.ts`, because the instance is
 * shared across the whole process (see `getSharedDatabase`) and so cannot be
 * disposed by any individual test's teardown.
 */
export async function disposeSharedDatabase(): Promise<void> {
  const miniflare = sharedMiniflare;
  const libSql = sharedLibSql;

  sharedDatabase = null;
  sharedMiniflare = null;
  sharedLibSql = null;

  await miniflare?.dispose();
  (await libSql)?.close();
}

function getSharedDatabase(): Promise<D1Database> {
  if (sharedDatabase === null) {
    sharedDatabase = (async () => {
      // In-memory (`d1Persist: false`) so concurrent `bun test` processes each
      // get an isolated database with no shared on-disk state — which is what
      // the old cross-process file lock existed to guarantee.
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
      const db = await miniflare.getD1Database("DB");

      sharedMiniflare = miniflare;

      await applyMigrations(db);

      return db;
    })();
  }

  return sharedDatabase;
}

/**
 * In-memory, and built by `applyPendingMigrations` rather than by replaying
 * statements the way the D1 fixture does — so the contract suite is also
 * checking that the runner a self-hosted instance boots with produces the
 * schema everything else assumes.
 */
function getSharedLibSql(): Promise<LibSqlStorage> {
  if (sharedLibSql === null) {
    sharedLibSql = (async () => {
      const storage = await openLibSqlStorage(":memory:");

      await applyPendingMigrations(storage.db);

      return storage;
    })();
  }

  return sharedLibSql;
}

export async function createTestStorage(): Promise<TestStorage> {
  const db = await getSharedDatabase();

  await resetDatabase(db);

  return {
    db,
    async dispose() {},
    stores: createD1Stores(db),
  };
}

export async function createLibSqlTestStorage(): Promise<StoresUnderTest> {
  const storage = await getSharedLibSql();

  await resetAppDatabase(storage.db);

  return {
    async dispose() {},
    stores: storage.stores,
  };
}
