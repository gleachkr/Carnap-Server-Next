import { drizzle } from "drizzle-orm/d1";

import type { AppStores } from "../../application/stores";
import * as schema from "./schema";
import { createStores } from "./stores";

/**
 * Storage for the deployed Worker, from Cloudflare's `DB` binding.
 *
 * The whole of what is Cloudflare-specific about persistence lives in this
 * file. Everything past `createStores` is driver-neutral, which is why a
 * self-hosted instance can hand it a libsql handle instead (see `libsql.ts`)
 * and get the same behaviour from the same code.
 */
export function createD1Stores(d1Database: D1Database): AppStores {
  return createStores(drizzle(d1Database, { schema }));
}
