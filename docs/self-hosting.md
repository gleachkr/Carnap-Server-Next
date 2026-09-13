# Self-hosting Carnap

The application can run as a Cloudflare Worker or as a Bun server backed by
SQLite. Both use the same routes and store implementation. The standalone
entry point, `src/server/main.ts`, supplies:

- A libsql connection instead of a D1 binding.
- Static asset serving from `public/` instead of Workers Assets.
- Background-task tracking for `waitUntil` calls.
- A five-minute interval for LTI grade passback instead of a cron trigger.

The storage contract suite runs against both database drivers.

## Requirements

Use Podman or Docker, or run from source with Bun 1.3 or later. A local
installation needs no database server or Redis. The container builds browser
assets ahead of time; it does not build them at startup.

Fonts, math fonts, proof engines, and application scripts are served from the
instance. External requests are still needed for configured email delivery,
LTI platforms, optional Turnstile verification, and any remote images or
stylesheets an author includes.

## Quick start: container

For a local test, choose a bootstrap secret and bind the port to loopback:

```sh
export ADMIN_BOOTSTRAP_TOKEN='replace-with-a-random-secret'
podman build -t carnap .
podman run -d --name carnap -p 127.0.0.1:8787:8787 \
  -v carnap-data:/data \
  -e CARNAP_ENV=local \
  -e ADMIN_BOOTSTRAP_TOKEN \
  carnap
```

Open <http://localhost:8787/login>, then complete
[administrator setup](#first-run-becoming-the-site-administrator).
Use `docker` in place of `podman` if preferred.

**Do not expose `CARNAP_ENV=local` to other users.** It displays the sign-in
link in the login page and returns login tokens through the API. Anyone who
can reach it can sign in as any email address. For a shared deployment, use
production mode, real email delivery, and HTTPS; see
[the Caddy example](#example-caddy-in-front-of-the-container).

The database is stored in the `carnap-data` volume at `/data/carnap.db`.
Replacing the container preserves the database if the volume is retained.
Pending migrations run at startup and are listed in the log.

You can run this beside the original Carnap with separate volumes and host
ports. Volume names are exact: `carnap_data` and `carnap-data` are different
volumes. For a second port, use `127.0.0.1:8788:8787`.

### Podman notes

- Use `podman build --format docker` if you need the image's `HEALTHCHECK`.
  OCI format drops that field.
- Rootless Podman normally needs subordinate UID mappings in `/etc/subuid`
  to run the image's non-root user. If only your own UID can be mapped,
  `--user 0` is a workaround under rootless Podman: container root maps to
  your host account. Do not apply this workaround to a rootful deployment.

## Quick start: source

From the repository root:

```sh
nix develop
bun install
export ADMIN_BOOTSTRAP_TOKEN='replace-with-a-random-secret'
CARNAP_ENV=local bun run serve
```

`serve` builds `public/` and starts the server on port 8787 using
`file:./data/carnap.db`. It creates the data directory if needed.
Unlike the loopback container example, the server does not configure a
loopback-only bind address. Restrict access before using local mode.

## First run: becoming the site administrator

A fresh database has no user who can create courses. To grant your account
administrative access:

1. Start the server with a secret `ADMIN_BOOTSTRAP_TOKEN`.
2. Sign in as yourself.
3. Open `/admin/bootstrap` and submit the token.
4. Remove the variable from the deployment and restart.

This grants `site_admin`. The bootstrap service refuses further grants while
any active site administrator exists. Set the token before exposing a fresh
instance: if no token is configured and no administrator exists, any signed-in
user can bootstrap themselves. Remove the secret after setup and use the
administration interface for later capability grants.

## Configuration

The standalone server reads environment variables at startup. Unset a
variable to disable it; an empty value is not always equivalent to absence.

### Server and database

- `CARNAP_ENV`: defaults to `production`. Only the exact value `local`
  enables local login-token disclosure. Other values use normal delivery.
- `PORT`: defaults to `8787`.
- `CARNAP_DATABASE_URL`: defaults to `file:./data/carnap.db`. Accepts a local
  file URL or a remote URL supported by libsql.
- `CARNAP_DATABASE_AUTH_TOKEN`: authentication for a remote libsql database.
- `ADMIN_BOOTSTRAP_TOKEN`: administrator setup secret; remove after use.
- `CARNAP_TRUST_PROXY`: set to `1` when a trusted reverse proxy supplies the
  public scheme and host. See [Reverse proxy setup](#behind-a-reverse-proxy).

### Email and login

- `RESEND_API_KEY`: required for native email sign-in outside local mode.
- `AUTH_LOGIN_EMAIL_FROM`: sender address, for example
  `Carnap <login@example.edu>`.
- `AUTH_LOGIN_CONFIRM_URL`: public confirmation URL. Defaults to the
  request's resolved origin followed by `/login/confirm`.
- `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`: optional human
  verification. Configure both or neither.

### LTI

- `LTI_TOOL_PRIVATE_KEY`: a JSON JWK used to sign LTI messages. Configure it
  only when using LMS integration. See [LTI](#lti).

## Signing in

Native login is passwordless. Users request a single-use link by email.
Delivery uses [Resend](https://resend.com). Outside local mode, missing
`RESEND_API_KEY` prevents native email sign-in. The standalone server warns
at startup but continues serving; it does not refuse to start.

Set `AUTH_LOGIN_CONFIRM_URL` to the public confirmation address if the
request URL cannot be reconstructed correctly behind your proxy. Otherwise
emails can contain an internal hostname or an HTTP URL.

SMTP is not implemented. A different delivery provider would implement
`LoginEmailSender` in `src/worker/application/auth.ts`; the current adapter is
`src/worker/infrastructure/email/resend.ts`.

### The login throttle

The database-backed limiter uses a rolling fifteen-minute window:

- 5 login requests per email address.
- 40 per client IP without a verified Turnstile challenge.
- 300 per client IP with a verified challenge.

A request over either applicable limit receives HTTP 429. Refused requests
do not add another rate-limit hit. Hits use scope-prefixed SHA-256 hashes
rather than plaintext addresses or IPs, and expired hits are pruned.
Hashing reduces plaintext retention; it does not make low-entropy IP
addresses anonymous.

Limits are constants in `src/worker/application/login-rate-limit.ts`, not
runtime settings. The read-and-write check is not atomic, so concurrent
requests can slightly exceed the limit. It is an abuse throttle, not an
exact delivery quota.

### Human verification: Turnstile

For a shared classroom network, Turnstile allows the higher per-IP limit
while retaining the per-address limit. Create a widget in Cloudflare's
Turnstile dashboard and configure both keys. The application does not need
to be hosted on Cloudflare to use it.

The login form renders the challenge, and the server verifies its token
with `challenges.cloudflare.com` before allowing the login request.
Verification fails closed.

A secret without a site key enforces a challenge the form cannot provide.
A site key without a secret does not enforce verification. An isolated
network should leave both unset and retain the normal throttle.

## Behind a reverse proxy

Use HTTPS for a shared deployment. Terminate TLS at the proxy and set
`CARNAP_TRUST_PROXY=1` on the application.

Configure the proxy to supply:

- `X-Forwarded-Proto`: the browser-facing scheme.
- `X-Forwarded-Host`, or a preserved `Host`: the public hostname.
- `X-Forwarded-For`: the original client address.
- Optionally `X-Request-Id`: an ID to carry through logs and error responses.

Scheme and host forwarding are trusted only with `CARNAP_TRUST_PROXY` enabled.
They affect secure cookies, HSTS, login links, and LTI callback URLs. Nginx
normally rewrites `Host` to the upstream host, so explicitly preserve it or
set `X-Forwarded-Host`.

Client-IP handling is separate: the application prefers `CF-Connecting-IP`,
then the first `X-Forwarded-For` entry. These headers are read as hints even
without the proxy-trust setting. At a self-hosted edge, strip untrusted
client-supplied copies and set the address yourself. If no address header is
present, the login limiter has only its email-address limit.

Only the trusted proxy should be able to reach the application port. Do not
let public clients bypass it or supply trusted forwarding headers directly.

### Example: Using Caddy as a reverse proxy

A proxied deployment differs from the quick start in three ways: the
application port is bound only loopback rather than a network IP, so only the 
proxy can reach it, `CARNAP_ENV` is left unset so production mode applies, and
`CARNAP_TRUST_PROXY=1` tells the application to trust the proxy's 
`X-Forwarded-Proto` and `X-Forwarded-Host`.

Put the settings in an environment file so the secrets do not appear in
shell history or the process list. Values are taken literally after the
first `=`, without shell quoting:

```sh
# env
CARNAP_TRUST_PROXY=1
RESEND_API_KEY=re_replace_me
AUTH_LOGIN_EMAIL_FROM=Carnap <login@example.edu>
ADMIN_BOOTSTRAP_TOKEN=replace-with-a-random-secret
```

Then start the container:

```sh
podman build -t carnap .
podman run -d --name carnap --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v carnap-data:/data \
  --env-file ./env \
  carnap
```

The environment is fixed when the container is created, so removing
`ADMIN_BOOTSTRAP_TOKEN` after setup requires running `podman rm -f carnap`, 
editing the environment file, and running the command above again with the 
edited file; `podman restart` does not reread the environment. The database is 
on the volume and survives the replacement.

With [Caddy](https://caddyserver.com), you can use this site block:

```caddyfile
carnap.example.edu {
	reverse_proxy 127.0.0.1:8787 {
		header_up X-Request-Id {http.request.uuid}
	}
}
```

Caddy obtains and renews the certificate itself, redirects HTTP to HTTPS,
and passes the browser's `Host` header to the application unchanged. Its
`reverse_proxy` sets `X-Forwarded-For`, `X-Forwarded-Proto`, and
`X-Forwarded-Host` on every upstream request, replacing any copies a client
sent (unless the client is listed in the Caddy option `trusted_proxies`). That 
satisfies the header list above without further configuration. The `header_up` 
line adds the optional request ID. Leave `AUTH_LOGIN_CONFIRM_URL` unset: with 
the scheme and host forwarded, login links resolve to
`https://carnap.example.edu/login/confirm`. Do not add an `X-Frame-Options`
header in the site block; see [Cookies and framing](#cookies-and-framing).

To confirm the forwarding took effect:

```sh
curl -sI https://carnap.example.edu/health | grep -i strict-transport
```

The application sends `Strict-Transport-Security` only when it resolved the
request as HTTPS. If the line is missing, the proxy is not forwarding the
scheme or `CARNAP_TRUST_PROXY` is not set, and sign-in cookies will not be
marked `Secure`.

If Caddy also runs as a container, put both containers in one pod so that
`127.0.0.1:8787` still names the application, and publish ports 80 and 443 on
the pod instead of 8787 on the container.

### Cookies and framing

Cookie `Secure` follows the resolved request scheme, not `CARNAP_ENV`.
HTTP can support ordinary sign-in but does not protect sessions in transit.
Embedded LTI also needs an HTTPS `SameSite=None` session cookie; a launch in
a separate window does not have the same cross-site-cookie requirement.

HTTPS responses send:

```text
Strict-Transport-Security: max-age=31536000
```

Add `includeSubDomains` or `preload` only after reviewing their effect on
the rest of your domain.

**Do not add `X-Frame-Options` at the proxy.** The application's CSP
`frame-ancestors` policy permits its own pages to frame content, and permits
the launching LMS for LTI-created sessions. `X-Frame-Options: SAMEORIGIN`
cannot express that LMS exception and will break embedded launches.

## The database

Use one standalone server process per local SQLite database. Horizontal
clustering is not a supported deployment model.

Migrations under `src/worker/infrastructure/database/migrations/` run at
startup. Each migration and its bookkeeping entry are applied in one batch.
The bookkeeping table is `d1_migrations`, matching Wrangler's table so that
migration history can be retained when moving a database between hosts.
Test any D1/libsql export and import procedure before relying on it.

The database contains users, courses, memberships, content revisions,
submissions, and grades. Back it up before upgrading. For a running local
SQLite database, use SQLite's backup command:

```sh
sqlite3 data/carnap.db '.backup backup.db'
```

A plain file copy is suitable only with the database stopped and its SQLite
journal state accounted for. Keep backups outside the container volume and
test restoration.

### Capacity planning

Database throughput limits the whole instance, across all courses. A local
SQLite database has one writer; a D1 database also has a finite query
capacity even when Workers scale out.

The repository has query-count regression tests for submissions and course
pages. Historical laptop measurements of multiple-choice submissions were
about 190 per second against a local file, but that is not a production
capacity guarantee. Proof checking, storage latency, lesson size, concurrent
reads, and hardware all affect throughput.

Measure realistic workloads before changing deployment architecture. On D1,
inspect query durations and Worker request timings. D1 read replication
through the Sessions API is a possible future optimization, not something
this guide assumes the application already uses. Separate instances and
databases per institution are another way to divide load.

## Upgrading

1. Back up the database and verify that the backup is usable.
2. Build the new image or update the source and dependencies.
3. Restart with the existing database volume and configuration.
4. Check startup logs for applied migrations and errors.
5. Verify sign-in, course access, and any configured LTI integration.

Migrations are forward-only; there is no automatic rollback command. A
failed upgrade may require restoring the pre-upgrade backup.

## LTI

Set `LTI_TOOL_PRIVATE_KEY` to a signing JWK with `kid` and `alg`. The public
key is served at `/lti/jwks`. The instance must be reachable from the LMS
server as well as from students' browsers.

Without a tool key, LTI reports itself unconfigured and the passback sweep
returns without querying for jobs. With LTI configured, the server runs the
same outbox delivery service as the Worker's scheduled handler every five
minutes. An overlapping standalone sweep is skipped.

### How Carnap identifies itself to your LMS

Outbound JWKS, token, and score requests use the shared `OUTBOUND_USER_AGENT`
in `src/worker/user-agent.ts`. Preserve that header when changing the LTI
adapter. Canvas can reject requests without a User-Agent at its edge, before
returning an API response. Workers do not supply this header automatically.

Change the shared constant if you rebrand outbound requests, rather than
editing individual call sites.

### Student IDs

The LTI `lis.person_sourcedid` claim supplies the institution's student ID.
It appears on the profile and in the `student_id` column of grade exports.
On Moodle, set the user's **ID number**; other platforms may require privacy
or claim settings.

A later launch with an ID replaces the stored value. A launch with no ID
leaves it unchanged. Users cannot edit the ID through a profile field;
correct it in the LMS and launch again. An account without one exports an
empty cell. Unlike student IDs, a display name chosen by the user is not
overwritten by later launches.

## Operational limits

- PostgreSQL is not implemented; it would need its own schema and migrations.
- SMTP is not implemented.
- Backup scheduling, monitoring, and clustering are operator responsibilities
  or separate development work.
- `/health` returns `{"status":"ok"}` without accessing storage. It is a
  liveness check, not database readiness verification.
