import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import type { AppStores } from "../../application/stores";
import type { AppDatabase } from "./database";
import * as schema from "./schema";
import { createStores } from "./stores";

/**
 * Storage for a self-hosted instance: a SQLite file, opened through libsql.
 *
 * libsql rather than `bun:sqlite` for one reason, and it is the same reason
 * `AppDatabase` declares `batch` — Drizzle's libsql driver has that method with
 * D1's exact signature, so the stores compiled against it are the stores, not a
 * second implementation. A synchronous driver would have forced the seven
 * multi-write call sites to grow a transaction-shaped alternative and the two
 * hosts would have started drifting immediately.
 *
 * The URL is anything libsql accepts. `file:./data/carnap.db` for the ordinary
 * case; a `libsql://…` URL with a token also works, and costs nothing to allow.
 */
export interface LibSqlStorage {
  readonly close: () => void;
  readonly db: AppDatabase;
  readonly stores: AppStores;
}

/**
 * The filesystem path a `file:` URL names, or undefined for a remote one.
 *
 * Exported because the server has to create the directory before it can open
 * the database, and a failure has to name the same path the open used. Two
 * readings of one URL that must not drift apart.
 */
export function fileUrlPath(url: string): string | undefined {
  if (!url.startsWith("file:")) {
    return undefined;
  }

  const path = url.slice("file:".length).replace(/^\/\//, "").split("?")[0];

  return path === undefined || path.length === 0 ? undefined : path;
}

function isWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);

    return true;
  } catch {
    return false;
  }
}

/**
 * Why a `file:` database would not open, in terms an operator can act on.
 *
 * libsql reports a bare SQLite result code and nothing else — the `: 14` in
 * `Unable to open connection to local database /data/carnap.db: 14` is
 * `SQLITE_CANTOPEN`, which covers a missing directory, an unwritable one, and
 * an unreadable file without saying which — so an operator whose container
 * volume belongs to somebody else is told a number and nothing more.
 *
 * Almost always it is a permission on the *directory* rather than on the
 * database: SQLite writes `-wal` and `-shm` beside the file, so an unwritable
 * directory fails before there is a database to open at all. Hence the report
 * leads with the directory, and names the uid asking — the pair is the whole
 * answer when a container's volume belongs to somebody else.
 */
function diagnoseFileOpen(path: string): string {
  const directory = dirname(path);
  const uid = process.getuid?.();
  const self =
    uid === undefined ? "this process" : `this process (uid ${uid})`;

  let stats: ReturnType<typeof statSync>;

  try {
    stats = statSync(directory);
  } catch {
    return `The directory ${directory} does not exist, and libsql will not create it.`;
  }

  if (!stats.isDirectory()) {
    return `${directory} is not a directory.`;
  }

  const mode = (stats.mode & 0o7777).toString(8).padStart(4, "0");
  const described = `mode ${mode}, owned by uid ${stats.uid}`;

  if (!isWritable(directory)) {
    return (
      `The directory ${directory} (${described}) is not writable by ${self}. ` +
      "SQLite writes the -wal and -shm files beside the database, so the " +
      "directory has to be writable and not only the database file. In a " +
      "container this usually means the volume mounted there does not belong " +
      "to the user the server runs as."
    );
  }

  // Only worth saying when there *is* a file: on a first run there is not, and
  // an unwritable-file report would send the operator after the wrong thing.
  if (existsSync(path) && !isWritable(path)) {
    return `The directory ${directory} (${described}) is writable by ${self}, but the database file ${path} is not.`;
  }

  return `The directory ${directory} (${described}) is writable by ${self}, so this is not a directory permission.`;
}

/**
 * `createClient`, with a failed local open explained rather than reported as a
 * number. A remote URL is left to libsql's own message, which for a network or
 * token failure already says what happened.
 */
function openClient(
  url: string,
  authToken?: string,
): ReturnType<typeof createClient> {
  try {
    return createClient(
      authToken === undefined ? { url } : { authToken, url },
    );
  } catch (error) {
    const path = fileUrlPath(url);

    if (path === undefined) {
      throw error;
    }

    throw new Error(
      `Could not open the SQLite database at ${path}. ${diagnoseFileOpen(path)}`,
      { cause: error },
    );
  }
}

export async function openLibSqlStorage(
  url: string,
  authToken?: string,
): Promise<LibSqlStorage> {
  const client = openClient(url, authToken);
  const db = drizzle(client, { schema });

  // D1 enforces foreign keys; plain SQLite does not unless asked, once per
  // connection. Without this the schema's `ON DELETE CASCADE` and its
  // `REFERENCES` guards would be decoration on a self-hosted instance, and the
  // two hosts would disagree about what a delete does.
  await db.run(sql.raw("PRAGMA foreign_keys = ON"));

  return {
    close: () => {
      client.close();
    },
    db,
    stores: createStores(db),
  };
}
