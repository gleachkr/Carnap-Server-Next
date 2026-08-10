import { afterAll } from "bun:test";

import { disposeSharedDatabase } from "./helpers/storage";

/**
 * Global test teardown, preloaded via `bunfig.toml`.
 *
 * Hooks registered here run once for the whole process rather than per file,
 * which is the only scope that can shut down the database harness: it
 * deliberately shares one miniflare instance across every test file, so no
 * individual test's teardown may dispose it.
 *
 * Importing the helper does not start anything — the instance is created
 * lazily on the first `createTestStorage`, so a run that touches no database
 * disposes nothing.
 */
afterAll(disposeSharedDatabase);
