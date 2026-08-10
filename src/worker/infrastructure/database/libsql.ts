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

export async function openLibSqlStorage(
  url: string,
  authToken?: string,
): Promise<LibSqlStorage> {
  const client = createClient(
    authToken === undefined ? { url } : { authToken, url },
  );
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
