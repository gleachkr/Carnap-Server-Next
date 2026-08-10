# Storage boundary

One SQLite schema, one set of migrations, one set of stores — and two drivers
that can run them. `d1.ts` opens Cloudflare's `DB` binding for the deployed
Worker; `libsql.ts` opens a file (or a remote libsql URL) for a self-hosted
instance. Both hand the same `AppDatabase` handle to `createStores`, so the
store implementation is not merely similar across the two, it is the same code.

`database.ts` is where that handle is defined, and its comment explains the one
subtlety: `batch` has to be declared there because D1 has no interactive
transactions, which makes a batch the only way several writes commit together.

Standing decisions:

- Application code generates UUIDv7-shaped IDs before calling stores.
- Timestamps are UTC ISO 8601 strings from `Date#toISOString()`.
- Routes and services depend on the store interfaces in
  `src/worker/application/stores.ts`, not on Drizzle or on driver result types.
- JSON database payloads are stored in SQLite text JSON columns and are checked
  at the store boundary with the small `JsonValue` contract type.
- Assignment scores are materialized in the schema so gradebook work can
  refresh them idempotently instead of redesigning the storage model.

Migrations are hand-written, in file-name order, with statements separated by
`--> statement-breakpoint`. Each opens with a comment saying why the change was
made. (`bun run db:generate` diffs against `meta/`, whose snapshots stopped at
`0003`; it is not the way new migrations get written here.)

Applying them, per host:

```sh
bun run db:migrate:local     # Worker, local D1 via wrangler
bun run db:migrate:remote    # Worker, remote D1 via wrangler
```

A self-hosted server applies its own pending migrations at boot — see
`migrate.ts`, which records what it has run in a `d1_migrations` table using
wrangler's own layout, so a database can move between the two hosts without
re-running anything.
