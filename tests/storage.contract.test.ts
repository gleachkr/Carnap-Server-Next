import { setDefaultTimeout } from "bun:test";

import {
  createLibSqlTestStorage,
  createTestStorage,
} from "./helpers/storage";
import { describeStorageContract } from "./helpers/storage-contract";

setDefaultTimeout(30_000);

/**
 * The store contract, run once per host.
 *
 * The stores are one implementation over an `AppDatabase` handle, and the two
 * drivers that can supply one are meant to be indistinguishable from inside.
 * That is a claim, not a fact — Drizzle papers over a good deal, and a dialect
 * difference, a foreign key left unenforced, or a batch that is not really a
 * transaction would all typecheck perfectly. Running the same assertions twice
 * is what turns the claim into something the suite can fail on.
 */
describeStorageContract("D1", createTestStorage);
describeStorageContract("libsql", createLibSqlTestStorage);
