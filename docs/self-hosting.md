# Self-hosting Carnap

Carnap runs in two places: as a Cloudflare Worker, and as an ordinary
long-running process against a SQLite file. The application is the same
application — same routes, same storage layer, same compiled content. Only four
things differ, and `src/server/main.ts` is where all four are supplied:

| Cloudflare gives you | Self-hosting supplies |
|---|---|
| a D1 binding | a SQLite file, opened through libsql |
| Workers Assets | `serveStatic` over `public/` |
| an execution context | a small `waitUntil` that shutdown drains |
| a cron trigger | a five-minute interval |

The store implementation underneath is byte-for-byte the one the Worker uses,
and `tests/storage.contract.test.ts` runs its whole body against both drivers so
that stays true.

## What you need

Either a container runtime (Podman or Docker) or [Bun](https://bun.sh) ≥ 1.3.
Nothing else: no database server, no Redis, no build step at boot.

## Quick start: a container

```sh
podman build -t carnap .
podman run -d --name carnap -p 8787:8787 \
  -v carnap-data:/data \
  -e CARNAP_ENV=local \
  -e ADMIN_BOOTSTRAP_TOKEN=change-me \
  carnap
```

Then open <http://localhost:8787/login>. `docker` in place of `podman` works
identically; the image is ~375 MB, most of which is Bun and `node_modules`.

The bootstrap token is there because an empty database has nobody in it who may
create a course — see [First run](#first-run-becoming-the-site-administrator),
which is the next thing to do.

`CARNAP_ENV=local` is what makes that first run possible without an email
provider: the login page prints a sign-in link into the page instead of sending
it. **It is not a mode to serve anyone else with** — it also drops `Secure` from
the session cookie and returns the one-time login token in API responses. Read
[Configuration](#configuration) before putting this on a network.

The database lives on the `/data` volume, not in the image, so `podman rm` and
`podman run` again keeps every course. The image applies pending migrations at
boot and says which ones it ran; on the second boot it says nothing, because
there are none.

Two notes for Podman specifically. `HEALTHCHECK` is dropped unless you build
with `--format docker`, since the OCI image format has no such field. And if
`/etc/subuid` has no entry for you, Podman can map only one uid and cannot honour
the image's non-root `USER`; `--user 0` runs it anyway, mapping container root to
your own account on the host.

## Quick start: from source

```sh
bun install
CARNAP_ENV=local bun run serve
```

`serve` builds the client bundles into `public/` and then starts the server, by
default on port 8787 against `file:./data/carnap.db`. The directory is created if
it is not there.

## First run: becoming the site administrator

A fresh instance has no users and therefore nobody who can create a course. The
way in is a one-time token you set and then spend:

1. Start the server with `ADMIN_BOOTSTRAP_TOKEN` set to a secret of your
   choosing.
2. Sign in normally, as yourself.
3. Visit `/admin/bootstrap` and submit the token.

That grants your account the `site_admin` capability, and from there everything
is in the interface. Remove `ADMIN_BOOTSTRAP_TOKEN` from the environment
afterwards — while it is set, anyone who learns it and can sign in can make
themselves an administrator.

## Configuration

Everything is read from the process environment at boot. Absent stays absent:
the application distinguishes an unset variable from an empty one in several
places, so unsetting is the way to turn something off.

| Variable | Default | What it is |
|---|---|---|
| `CARNAP_ENV` | `production` | `production`, `preview`, or `local`. See below. |
| `PORT` | `8787` | The port to listen on. |
| `CARNAP_DATABASE_URL` | `file:./data/carnap.db` | Anything libsql accepts — a local file, or a `libsql://` URL. |
| `CARNAP_DATABASE_AUTH_TOKEN` | — | For a remote libsql database. |
| `ADMIN_BOOTSTRAP_TOKEN` | — | The first-run token above. Unset it once used. |
| `RESEND_API_KEY` | — | Required for sign-in outside `local`. |
| `AUTH_LOGIN_EMAIL_FROM` | — | The `From:` on login emails, e.g. `Carnap <login@example.edu>`. |
| `AUTH_LOGIN_CONFIRM_URL` | the request's own origin, plus `/login/confirm` | Where login links point. |
| `LTI_TOOL_PRIVATE_KEY` | — | The tool's signing key, as a JSON JWK. Only needed for LMS integration. |

`CARNAP_ENV` defaults to `production` rather than to the convenient value,
because `local` weakens the session cookie and hands out login tokens over the
API — an instance that quietly did that would be a security hole with no
symptom. Set it to `local` only on a machine nobody else can reach.

## Signing in

Login is passwordless: the user gives an email address and gets a one-time link.
Delivery goes through [Resend](https://resend.com), and outside `local` it fails
closed — with no `RESEND_API_KEY`, nobody can sign in at all. The server says so
at boot rather than at the moment the first person tries.

`AUTH_LOGIN_CONFIRM_URL` is where the emailed link points. Left unset it is
derived from the request that asked for the link, which is right until something
sits in front: a proxy that forwards to `http://carnap:8787` will mail out links
to a hostname nobody outside your network can open. Set it to your public URL.

There is no SMTP support. If Resend is not an option for you, sending is behind
an interface — `LoginEmailSender` in `src/worker/application/auth.ts`, with the
one implementation in `src/worker/infrastructure/email/resend.ts` — so a second
one is a contained piece of work rather than a change to the login flow.

## Behind a reverse proxy

Terminate TLS in front and pass everything through. Two headers matter:

- **`X-Forwarded-For`** is read for the audit trail on sessions and logins. On
  Cloudflare that job is done by `CF-Connecting-IP`, which is preferred when
  present; the fallback takes the first entry of `X-Forwarded-For`.
- **`X-Request-Id`**, if you set one, is carried through logs and error
  responses. One is generated when it is absent.

HTTPS is not optional. Outside `CARNAP_ENV=local` the session cookie is marked
`Secure`, so over plain HTTP the browser accepts it and then never sends it
back — sign-in appears to succeed and the next page is signed out again.

**Run one instance.** A SQLite file is single-node, and the grade-passback sweep
assumes a single ticking clock. Carnap is not built to scale horizontally, and
for a department's course load it does not need to be.

## The database

One file, in the SQLite format, with the schema every Carnap instance has.
Migrations are applied at boot: each file runs in a batch, so a failure leaves
nothing behind, and its name is recorded in the same batch, so there is no window
where the statements ran and the record did not.

That bookkeeping table is `d1_migrations`, which is Wrangler's own table under
Wrangler's own name — deliberately, because it is what makes a database portable
between the two hosts. Export a D1 database and serve it from a file, or the
reverse, and neither host tries to re-run what the other already did.

Back it up the way you back up any SQLite database — `sqlite3 carnap.db ".backup
out.db"` while the server runs, or a plain copy while it does not. Everything
that matters is in there: users, courses, enrollments, content revisions,
submissions, grades.

## Upgrading

Rebuild and restart. Pending migrations apply themselves at boot and the log
line names them. There is no separate migrate step and no maintenance window
beyond the restart.

Migrations are forward-only: nothing here rolls one back, so take the backup
first.

## LTI

An LTI 1.3 tool needs a signing key, as a JSON JWK with `kid` and `alg`, in
`LTI_TOOL_PRIVATE_KEY`. The public half is served at `/lti/jwks` for the
platform to fetch — which means your instance has to be reachable from the LMS
server, not just from the browser. Without the variable set, the LTI routes
report themselves unconfigured and the passback sweep idles without spending
queries.

## What is not here

- **Postgres.** The storage seam admits another dialect, but it would need a
  parallel migration set and a second schema. It is separate work.
- **SMTP**, as above.
- **Clustering, backups, and monitoring.** `/health` answers `{"status":"ok"}`
  without touching storage, which is enough for a restart policy and is not a
  readiness check.
