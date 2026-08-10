import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { sql } from "drizzle-orm";

import type { AppDatabase } from "./database";

/**
 * Applying pending migrations to a database that has no `wrangler` in front of
 * it — which means a self-hosted server, at boot.
 *
 * Reads the filesystem, so this module must not be imported by Worker code:
 * `node:fs` does not exist on workerd, and the Worker has no use for it anyway
 * since `wrangler d1 migrations apply` does this job there.
 */

export const MIGRATIONS_DIRECTORY =
  "src/worker/infrastructure/database/migrations";

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/**
 * Wrangler's own bookkeeping table, recreated verbatim — same name, same
 * columns, and the same `0000_high_energizer.sql`-style values in `name`.
 *
 * Deliberately not a table of our own. A database is portable between the two
 * hosts (export a D1 database, serve it from a file; or the reverse), and it
 * only stays portable if both hosts agree on what has already run. Under any
 * other name a migrated D1 export would look untouched here, and every
 * migration would be attempted a second time.
 */
const CREATE_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS d1_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

export interface Migration {
  readonly name: string;
  readonly statements: readonly string[];
}

/** The statements of one migration file, in order. */
export function splitStatements(text: string): string[] {
  return text
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/**
 * Every migration, in file-name order — which is the order they must run in,
 * and the reason the files are numbered.
 */
export async function readMigrations(
  directory: string = MIGRATIONS_DIRECTORY,
): Promise<Migration[]> {
  const entries = await readdir(directory);
  const names = entries.filter((entry) => entry.endsWith(".sql")).sort();
  const migrations: Migration[] = [];

  for (const name of names) {
    const text = await readFile(join(directory, name), "utf8");

    migrations.push({ name, statements: splitStatements(text) });
  }

  return migrations;
}

/**
 * Bring a database up to date, and report what that took. Returns the names
 * applied — empty on a database that was already current, which is the normal
 * result of every boot after the first.
 *
 * Each migration is one batch, so it is one transaction: a file that fails
 * halfway leaves nothing behind, and its name is not recorded, so the next boot
 * tries it again from the top. Recording the name inside that same batch is
 * what makes the pair inseparable — there is no window in which the statements
 * have run and the record has not.
 */
export async function applyPendingMigrations(
  db: AppDatabase,
  directory: string = MIGRATIONS_DIRECTORY,
): Promise<string[]> {
  await db.run(sql.raw(CREATE_MIGRATIONS_TABLE));

  const recorded = await db.all<{ name: string }>(
    sql.raw("SELECT name FROM d1_migrations"),
  );
  const applied = new Set(recorded.map((row) => row.name));
  const pending = (await readMigrations(directory)).filter(
    (migration) => !applied.has(migration.name),
  );

  for (const migration of pending) {
    const [first, ...rest] = migration.statements.map((statement) =>
      db.run(sql.raw(statement)),
    );

    // A migration file with nothing runnable in it is a mistake worth naming:
    // recording it as applied would quietly skip whatever it was meant to do
    // once someone filled it in.
    if (first === undefined) {
      throw new Error(`Migration ${migration.name} contains no statements.`);
    }

    await db.batch([
      first,
      ...rest,
      db.run(
        sql`INSERT INTO d1_migrations (name) VALUES (${migration.name})`,
      ),
    ]);
  }

  return pending.map((migration) => migration.name);
}
