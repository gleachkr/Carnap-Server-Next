import type { BatchItem, BatchResponse } from "drizzle-orm/batch";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import type * as schema from "./schema";

/**
 * The database handle every store in `stores.ts` is written against: a Drizzle
 * SQLite handle in async mode, over this schema, that can run a batch.
 *
 * Named for what it is rather than for who provides it, because two things do.
 * Cloudflare's D1 backs the deployed Worker; a libsql file backs a self-hosted
 * instance. Both drivers extend the same `BaseSQLiteDatabase`, speak the same
 * dialect, and run the same migrations, so a store written to this type is the
 * *same* store on both — not two implementations kept in step by hand.
 *
 * `batch` is declared here rather than inherited because neither driver puts it
 * on the base class; each redeclares it, identically. It matters more than it
 * looks: D1 has no interactive transactions, so a batch is the only way to make
 * several writes commit or fail together, and seven places in `stores.ts` depend
 * on that. A driver without it could not run this code.
 *
 * `TRunResult` is `unknown` — it is the driver's own row-metadata shape (D1's
 * `D1Result`, libsql's `ResultSet`), it appears only in return positions, and no
 * store reads it. Widening it is what lets one interface name both handles.
 */
export interface AppDatabase
  extends BaseSQLiteDatabase<"async", unknown, typeof schema> {
  batch<U extends BatchItem<"sqlite">, T extends Readonly<[U, ...U[]]>>(
    batch: T,
  ): Promise<BatchResponse<T>>;
}
