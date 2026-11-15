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
[the Caddy example](#example-using-caddy-as-a-reverse-proxy).

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

## Quick start: Cloudflare Workers

`wrangler.jsonc` is the local-development configuration and the template for
a deployment. Copy it to `wrangler.<name>.jsonc` (gitignored, so upgrades do
not touch it), then in the copy set `name`, replace the D1 entry with the
database `wrangler d1 create` reports, and set `CARNAP_ENV` to anything but
`local`; the comments in the file walk through each field. Secrets go in with
`wrangler secret put`. Every command then takes the copy:

```sh
bun run build:client
npx wrangler deploy -c wrangler.<name>.jsonc
bun run db:migrate:remote -- -c wrangler.<name>.jsonc
```

The environment variables below apply to the Worker as `vars` or secrets,
except `PORT` and the database URL and token: the Worker's database is its D1
binding.

### Choosing a Cloudflare plan

Deploy on Workers Paid. The free plan cannot run a course of useful size:

- A request gets 10 ms of CPU. Building a course gradebook exceeds that at
  almost any class size.
- A request may make 50 D1 queries. The course gradebook costs about 16
  queries, plus 3 for each assignment and 1 for every 50 students, so it
  passes the limit at about a dozen assignments.
- An account may read 5 million D1 rows a day and write 100,000. Each view of
  the course gradebook reads every attempt, submission, and evaluation in the
  course. A few dozen views of a large course's gradebook can use up a day's
  reads.

Workers Paid raises the per-request limits to 30 seconds of CPU by default and
1,000 D1 queries.

The free plan's CPU limit is lenient at first: an isolate tolerates the
occasional request that runs over, then cuts off the next one with error 1102
("Worker exceeded resource limits"). Saving a lesson takes half a second to a
second of CPU, so on the free plan saves and proof checks fail now and then
rather than always.

Memory is limited the same way on every plan: 128 MB per isolate, shared by
the requests it serves and including WebAssembly memory. Carnap stays inside
it by refusing request bodies over 4 MiB before reading them, and truth-tree
certificates over 2 MiB, whose verification would hold the most memory.

As of September 2026, Workers Paid costs $5 a month. That includes 10 million
requests and 30 million CPU milliseconds. Beyond those allowances, requests
cost $0.30 per million and CPU time $0.02 per million milliseconds. D1 has no
base fee. The plan includes 25 billion rows read, 50 million rows written, and
5 GB of storage. Beyond those, reads cost $0.001 per million rows, writes $1 per
million rows, and storage $0.75 per GB-month. Check
[Cloudflare's pricing pages](https://developers.cloudflare.com/workers/platform/pricing/)
for current figures.

Storage is the limit to watch. On Workers Paid, a D1 database cannot grow
beyond 10 GB; on the free plan, the cap is 500 MB. Content revisions and
submissions account for most of the growth, and nothing expires them. Check the database size with
`npx wrangler d1 info <database> -c wrangler.<name>.jsonc`. If one instance
will approach the cap, divide institutions or terms among separate instances,
as described under [Capacity planning](#capacity-planning).

## First run: becoming the site administrator

A fresh database has no user who can create courses. To grant your account
administrative access:

1. Start the server with a secret `ADMIN_BOOTSTRAP_TOKEN`.
2. Sign in as yourself.
3. Open `/admin/bootstrap` and submit the token.
4. Remove the variable from the deployment and restart.

This grants `site_admin` and records `admin.bootstrap_site_admin` in the
audit log. Bootstrap is refused while no token is configured (an empty value
counts as none), and refused again once any active site administrator exists,
whatever the token. Remove the secret after setup and use the administration
interface for later capability grants.

## Account registration

The admin page's **Account registration** setting decides who can create an
account by signing in with an email link. Only a site administrator can change
it, and each change is recorded in the audit log as
`admin.change_native_registration`.

- **Anyone** (the default): the first email sign-in from
  a new address creates its account.
- **Enrollment links only**: a new address gets an account only
  when its owner signs in from a valid enrollment link. Anyone holding a link
  can create an account with it, so revoke a link that has been shared beyond
  its course.
- **LMS only**: email sign-in never creates an account. Accounts
  are created when someone opens Carnap from an LMS course.

Under every setting, an existing account, including one an LMS launch created,
can still sign in by email, and LMS launches still create accounts. The login
form answers every address in the same way. A refused sign-in is reported only
after the emailed link is opened, so the form cannot be used to find out which
addresses have accounts.

The default is open because the first administrator signs in by email before
anyone can invite them. Change the setting after
[becoming the site administrator](#first-run-becoming-the-site-administrator).

## About page

Every page with a footer links to `/about`, which anyone can read without
signing in. It says what Carnap is, links the source on GitHub, and names the
commit the instance runs when `CARNAP_COMMIT` is set (see
[Configuration](#configuration)).

Above that, the page shows the instance's own text: the place for an
Impressum, a privacy notice, or whom to contact. A site administrator writes
it at **Admin › About page** (`/admin/about`) in Carnap Markdown, the language
of a lesson's prose. Headings, lists, links, tables, footnotes and math work
as they do in a lesson. Raw HTML, exercises, theory blocks and `:::style`
blocks are refused, with the same diagnostics the lesson editor gives. Saving
an empty text removes the instance's part. Each change is recorded in the
audit log as `admin.change_about_page`.

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
- `ADMIN_BOOTSTRAP_TOKEN`: administrator setup secret; required to bootstrap
  the first site administrator, and to be removed after use.
- `CARNAP_TRUST_PROXY`: set to `1` when a trusted reverse proxy supplies the
  public scheme, host and client address. See
  [Reverse proxy setup](#behind-a-reverse-proxy).
- `CARNAP_COMMIT`: the Git commit the build was made from, which the
  [About page](#about-page) names and links. Neither host reads Git at run
  time, so set it when building or deploying:
  `podman build --build-arg CARNAP_COMMIT=$(git rev-parse HEAD) .` for the
  container, or
  `npx wrangler deploy -c wrangler.<name>.jsonc --var CARNAP_COMMIT:$(git rev-parse HEAD)`
  on Workers. A value that is not a commit hash is ignored.

### Email and login

- `RESEND_API_KEY`: required for native email sign-in outside local mode.
- `AUTH_LOGIN_EMAIL_FROM`: sender address, for example
  `Carnap <login@example.edu>`. Required with `RESEND_API_KEY`: without it,
  no mail is sent.
- `AUTH_LOGIN_CONFIRM_URL`: optional public confirmation URL. Defaults to
  the request's resolved origin followed by `/login/confirm`.
- `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`: optional human
  verification. Configure both or neither.

### LTI

- `LTI_TOOL_PRIVATE_KEY`: a JSON JWK used to sign LTI messages. Configure it
  only when using LMS integration. See [LTI](#lti).

## Signing in

Native login is passwordless. Users request a single-use link by email.
Delivery uses [Resend](https://resend.com). Outside local mode, a missing
`RESEND_API_KEY` or `AUTH_LOGIN_EMAIL_FROM` prevents native email sign-in.
It also stops an LMS launch from linking to an existing account with the
same email, since that link is confirmed by email. Other LMS launches need
no mail and sign in as usual, so an LMS-only instance can run without it.
The standalone server warns at startup, naming the missing variable, but
continues serving; it does not refuse to start.

Email links are built from the request's public origin, which behind a
proxy needs `CARNAP_TRUST_PROXY` (see
[Behind a reverse proxy](#behind-a-reverse-proxy)). Otherwise they can
contain an internal hostname or an HTTP URL. `AUTH_LOGIN_CONFIRM_URL`
overrides the sign-in link alone; account-link and address-change links
always follow the request origin.

The same configuration sends the mail behind an address change: the
confirmation link to a new address, and the notice to the old one, which
carries a seven-day undo link. Without it, account holders cannot change
their own address, and no changed address is told or can be undone. The
change requests share the login throttle. A site administrator can still
change an address from the user's admin record. That change is audited and
needs no mail.

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

The client address comes from the same setting. With `CARNAP_TRUST_PROXY`
enabled, the application reads the last `X-Forwarded-For` entry, which is the
one your proxy adds; earlier entries are whatever the client sent. Without
it, the application uses the address of the connection itself and ignores
`X-Forwarded-For` and `CF-Connecting-IP`, which any client can send. The login
limiter's per-address bucket, the human check and the log all use this
address. If the setting is on but `X-Forwarded-For` is missing, the login
limiter has only its email-address limit.

With the setting on, a request that needs the client address or the scheme
but arrives without `X-Forwarded-For` or `X-Forwarded-Proto` writes a
`proxy_header_missing` warning to the log. It says which header was missing,
what needed it, and whether the request carried `Forwarded` or `X-Real-IP`
instead, which the application does not read. Each header is reported at
most once an hour, with a count of the times it was missed since its last
report.
Requests that use neither value, such as a load balancer's health check,
are not reported. A missing `X-Forwarded-Host` is never reported, since a
proxy that preserves `Host` does not need to send it.

If your proxy is itself behind another proxy or CDN, the last entry names
that outer hop, not the browser. Have the proxy nearest the application
replace `X-Forwarded-For` with the client address it resolved.

Only the trusted proxy should be able to reach the application port. Do not
let public clients bypass it or supply trusted forwarding headers directly.
A proxy always sends `Host`, so `request_target_rejected` lines in the log
(see [Logging](#logging)) mean that something reached the port without
going through it. The line's `ip` is the connection's own address, which
names the sender.

### Example: Using Caddy as a reverse proxy

Like the local container example, this setup binds the application port to
loopback. It leaves `CARNAP_ENV` unset for production mode and sets
`CARNAP_TRUST_PROXY=1` so the application uses the proxy's public scheme and
host. Caddy must run on the same host or share a pod with the application.

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

Protect the file with `chmod 600 env`, keep it out of version control, and
start the container:

```sh
podman build -t carnap .
podman run -d --name carnap --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v carnap-data:/data \
  --env-file ./env \
  carnap
```

Container environment variables are fixed at creation. After administrator
setup, remove `ADMIN_BOOTSTRAP_TOKEN` from the file, remove the container with
`podman rm -f carnap`, and recreate it with the command above. This briefly
stops the service. `podman restart` does not reread the file. The database
volume survives container replacement.

With [Caddy](https://caddyserver.com), you can use this site block:

```caddyfile
carnap.example.edu {
	reverse_proxy 127.0.0.1:8787 {
		header_up X-Request-Id {http.request.uuid}
	}
}
```

Caddy obtains and renews the certificate and redirects HTTP to HTTPS.
Its reverse proxy preserves `Host` and supplies `X-Forwarded-For`,
`X-Forwarded-Proto`, and `X-Forwarded-Host`. By default, it ignores incoming
copies of those forwarding headers unless the sender is a configured trusted
proxy.

The `header_up` line adds an optional request ID. If Caddy is itself behind
another proxy or CDN, configure that hop in Caddy's `trusted_proxies` (see
also `trusted_proxies_strict`) and add `header_up X-Forwarded-For {client_ip}`,
so the application receives the browser's address rather than the CDN's.

With the scheme and host forwarded, leave `AUTH_LOGIN_CONFIRM_URL` unset;
login links resolve to `https://carnap.example.edu/login/confirm`.
Do not add `X-Frame-Options`; see [Cookies and framing](#cookies-and-framing).

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

Over HTTPS the session and CSRF cookies are named `__Host-carnap_session` and
`__Host-carnap_csrf`. Browsers accept a `__Host-` cookie only from this exact
host, with `Secure`, `Path=/` and no `Domain`, so another site under the same
parent domain cannot plant a session cookie on Carnap's host. Over plain HTTP
the cookies keep the bare names `carnap_session` and `carnap_csrf`. Both
cookies are `HttpOnly` and last 14 days; the database stores only hashes of
the session and CSRF tokens.
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

## Logging

The application writes one JSON object per line: errors to stderr, everything
else to stdout. Every line has `time` (UTC, ISO 8601), `level` (`info`,
`warn` or `error`) and `event`, plus fields that depend on the event. Lines
name people by Carnap user ID, which the admin page resolves at
`/admin/users/<id>`. The sign-in lines and the address-change lines also carry
the email address, since that is what a security team searches by. No line
carries a secret: login links, session and CSRF tokens, the bootstrap token,
keys and JWTs never reach the log.

```json
{"time":"2026-10-22T14:03:11.204Z","level":"warn","event":"sign_in_failed","ip":"203.0.113.7","requestId":"0b5c…","email":"ada@example.edu","reason":"login_rate_limited","stage":"request","userId":"01a1…"}
```

Because these lines hold email addresses, the logs are personal data. Who can
read them, and how long they are kept, is yours to set, as for any other
system's authentication logs.

`ip` is the client address: on Cloudflare, `CF-Connecting-IP` from the edge;
behind a trusted proxy, the entry it added to `X-Forwarded-For`; otherwise,
the address of the connection. See
[Behind a reverse proxy](#behind-a-reverse-proxy).

### Security and audit events

| Event | Level | Written when | Fields |
| --- | --- | --- | --- |
| `sign_in` | info | A session starts: by email link (`method: "email"`), by LMS launch (`"lti"`), or by the link that confirms or undoes an address change (`"email_change"`, `"email_undo"`). | `userId`, `email`, `method`, `issuer` and `subject` (the LMS's own ID for the user; LTI only), `ip`, `requestId` |
| `sign_out` | info | A signed-in user signs out. | `userId`, `ip`, `requestId` |
| `sign_in_failed` | warn | A sign-in is refused: at `stage: "request"` for an invalid address, the throttle (`login_rate_limited`) or the human check; at `stage: "confirm"` for an expired or used link (`invalid_login_token`) or closed registration (`registration_closed`); at `stage: "session"` for a suspended account (`disabled_user`), whichever way it signed in. | `stage`, `reason`, `email` (the address asked for or the link was sent to, when known), `userId` (when the address has an account), `method` (session stage), `ip`, `requestId` |
| `email_changed` | info | An account's address changes, however it was made: the holder's confirmed request (`by: "user"`), its undo (`"undo"`), the LMS (`"lms"`), or an administrator (`"admin"`, which also writes an `audit` line). | `userId`, `from`, `to`, `by`, `actorUserId` (admin), `platformId` (LMS), `ip`, `requestId` |
| `audit` | info | Any audited action: platform capability grants and revocations, the first administrator, account suspension and email changes, admin course-membership changes, the registration setting, LTI platform and deployment changes, courses an LMS creates, and staff changes instructors make (`course.staff_added`, `course.membership_role_changed`, `course.membership_status_changed`). The same event appears in the admin audit log. | `action`, `actorUserId`, `targetUserId`, `targetCourseId`, `metadata`, `auditEventId`, `requestId` |
| `csrf_rejected` | warn | A signed-in, state-changing request fails the CSRF check. | `userId`, `method`, `path`, `ip`, `requestId` |
| `bootstrap_refused` | warn | `/admin/bootstrap` refuses: no token configured, a wrong token, or an administrator already exists. | `reason`, `userId`, `ip`, `requestId` |
| `request_target_rejected` | warn | The standalone server answers 400 to a request it cannot route: one without a usable `Host` (an HTTP/1.0 probe, an empty `Host:`) or a `CONNECT`. Browsers and proxies never send these, so the sender is usually a scanner talking to the port directly. | `method`, `target` (the request line's path or authority, up to 512 characters), `ip` (always the connection's address), `userAgent` |
| `lti_launch_failed` | warn | An LTI login, launch, deep-linking or link step is refused. Once the platform's token has been verified, the line names the LMS user (`subject`), and a suspended account also its `userId`. | `code`, `issuer` and related identifiers, `subject`, `ip`, `requestId` |

Operational events include `request_failed` (an unexpected server error, with
its stack and the signed-in user's `userId`), the `lti_grade_passback_*`
events, `lti_tool_key_invalid`, `email_change_notice_failed`,
`proxy_header_missing` (see [Behind a reverse proxy](#behind-a-reverse-proxy)),
and, for the standalone server, `server_started`, `migrations_applied` and
`server_stopping`.

### Collecting the logs

Under Docker or Podman, the container's output is the log: `docker logs
<container>` or `podman logs <container>`. The default `json-file` driver
keeps everything and does not rotate, so limit it:

```sh
docker run --log-opt max-size=50m --log-opt max-file=5 …
```

To send the lines to a SIEM, choose a logging driver that forwards them, such
as `syslog`, `journald`, `fluentd`, `gelf` or `splunk`, with `--log-driver`
and its `--log-opt` settings, or point a collector at the `journald` or
`json-file` output. Each line is a complete JSON object, so the collector can
parse it without a custom pattern. On Cloudflare Workers, the lines appear in
Workers Logs (observability is enabled in `wrangler.jsonc`), and Logpush can
export them.

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
pages. Query counts alone do not establish capacity. Proof checking, storage
latency, lesson size, concurrent reads, and hardware all affect throughput.

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

Set `LTI_TOOL_PRIVATE_KEY` to a signing JWK with `kid` and `alg`. The value
is the private key itself as one line of JSON, not a path to a file. The
public key is computed from the private key and served at `/lti/jwks`.

This command, run from the repository root after `bun install`, prints a
suitable RSA key:

```sh
bun -e '
const { generateKeyPair, exportJWK } = await import("jose");
const { privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = await exportJWK(privateKey);
console.log(JSON.stringify({ ...jwk, alg: "RS256", use: "sig",
  kid: "carnap-" + Date.now().toString(36) }));
'
```

Copy the whole line into the environment file, unquoted:

```sh
LTI_TOOL_PRIVATE_KEY=<paste the complete one-line JSON output here>
```

Keep the key with the other secrets and out of version control. The `kid`
is what an LMS uses to select the key from `/lti/jwks`, so give a
replacement key a different `kid`; platforms registered against the old one
will need to refetch the keyset.

Registration is manual on both sides. `/admin/lti` shows the three tool
URLs the LMS asks for (initiate login, launch, and public keyset) and takes
the platform's issuer, client ID, authentication and token URLs, keyset
URL, and deployment ID in return.

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
