# Storage boundary

D1 and libsql use the same SQLite schema, migrations, and store
implementation.
`d1.ts` opens the Worker's Cloudflare `DB` binding; `libsql.ts` opens a local
file or remote libsql URL. Both supply an `AppDatabase` to `createStores`.

`database.ts` defines the shared handle. It requires `batch` because D1 does
not support interactive transactions. Stores use batches when several writes
must commit or fail together. The storage contract tests run against both
drivers to check that they implement the required behavior.

## Data conventions

- Application code generates UUIDv7-shaped IDs before calling stores.
- Timestamps are UTC ISO 8601 strings from `Date#toISOString()`.
- Routes and services depend on `src/worker/application/stores.ts`, not
  Drizzle or driver-specific result types.
- SQLite text JSON columns use the `JsonValue` contract and are checked at
  store boundaries.
- `assignment_scores` records projected score state for LTI change detection
  and delivery ordering. Gradebooks calculate displayed scores from current
  evidence; see `docs/grading-model.md`.

## Migrations

Write numbered SQL migrations in file-name order. Separate statements with
`--> statement-breakpoint` and explain the change in an opening comment.
Keep `schema.ts`, row mapping, stores, and storage tests consistent.

Drizzle's `meta/` snapshots stop at `0003`, so `bun run db:generate` does not
compare against the current migrated schema. Do not use its output as a new
migration without reconciling that history.

For Cloudflare D1, enter `nix develop`, then run:

```sh
bun run db:migrate:local
bun run db:migrate:remote
```

The remote command requires an actual database ID in Wrangler configuration.

A standalone server applies pending migrations at startup through
`migrate.ts`. Each migration and its history entry run in one batch. History
uses Wrangler's `d1_migrations` layout so an imported database can retain its
migration state. Test export and import procedures before moving a deployment
between hosts.
