# Carnap Server

Carnap is a platform for teaching and practicing formal logic: courses,
assignments, and machine-checked exercises — truth tables, counterexamples, and
proofs in several styles — authored in a Markdown dialect of its own. This
repository is the server, written in TypeScript against Bun and Hono.

It runs in two places from one codebase. As a **Cloudflare Worker** on D1, which
is what `bun run dev` and `wrangler deploy` target. And as an **ordinary
long-running process** against a SQLite file, which is `bun run serve` and the
`Dockerfile` — see [`docs/self-hosting.md`](docs/self-hosting.md). The
application layer does not know which one it is in; the storage contract test
runs its whole body against both drivers to keep that honest.

## Carnap and Aufbau

Two names live side by side here, and the difference is load-bearing.

**Carnap** is this platform — the courses, assignments, grading, and the
`carnap-markdown-v1` authoring format. Everything the platform owns is named
for it: the `carnap_session` cookie, the `CARNAP_ENV` binding, the
`<carnap-…>` custom elements. Authoring directives are the exception — they
are written plain (`multiple-choice`, `truth-table`), since an author writing
for Carnap gains nothing from being told so on every block.

**Aufbau** is the proof engine ([`gleachkr/Aufbau`](https://github.com/gleachkr/Aufbau),
published as `@aufbau/compiler` and `@aufbau/verifier`). Three exercise types
are checked by it and keep its name: the `aufbau-proof`, `aufbau-proof-tree`,
and `aufbau-proof-fitch` directives, their `aufbau-proof@1`-style kinds, and
`src/worker/exercises/aufbau-proof*/`. Their custom elements carry both —
`<carnap-aufbau-proof>` is Carnap's element for an Aufbau-checked proof.

So an `aufbau` in this tree is not a missed rename. It means the Aufbau engine.

## Local development

Enter the Nix development shell before running project tooling:

```sh
nix develop
```

Install dependencies:

```sh
bun install
```

Run the test suite:

```sh
bun test
```

Run TypeScript checking:

```sh
bun run check
```

Run formatting and lint checks:

```sh
bun run format:check
bun run lint:check
```

Run everything the way a commit is gated:

```sh
bun run validate
```

Start the Worker locally:

```sh
bun run dev
```

Apply local D1 migrations before using routes that touch storage:

```sh
bun run db:migrate:local
```

Check the health endpoint once Wrangler is running:

```sh
curl http://localhost:8787/health
```

Or start the same application as a plain server on a SQLite file, which needs no
Wrangler and applies its own migrations at boot:

```sh
CARNAP_ENV=local bun run serve
```

Both listen on port 8787, so run one at a time or set `PORT`. The rest of this
file assumes the Worker; everything in it works the same either way.

## Local native login

The native login flow is passwordless. A client starts a login challenge, then
confirms it with a one-time token. In local development only, the JSON start
route returns that token in the response body so no email service is required.

```sh
curl -s http://localhost:8787/auth/login/start \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.test","name":"Ada Lovelace"}'
```

Use the returned `login.loginToken` to create a session:

```sh
curl -i http://localhost:8787/auth/login/confirm \
  -H 'Content-Type: application/json' \
  -d '{"loginToken":"alt_..."}'
```

The confirm route sets `carnap_session` and `carnap_csrf` cookies. Unsafe
requests made with the session cookie must send `X-CSRF-Token` with the value
from the `carnap_csrf` cookie. Local cookies use `SameSite=Lax`, `HttpOnly` on
the session cookie, and no `Secure` flag so they work over local HTTP. Preview
and production cookies are marked `Secure`.

## Browser course workflow

After applying migrations and starting Wrangler, open this page:

```text
http://localhost:8787/login
```

In local mode, the login page creates a development login link in the browser
when Resend is not configured. Follow that link to sign in, then use
`/courses` to create a course. The course page can create enrollment links,
show the newly created browser enrollment URL, and revoke active links.

An empty database has nobody who may create one, so the first account has to
grant itself the capability: start the server with `ADMIN_BOOTSTRAP_TOKEN` set,
sign in, and submit that token at `/admin/bootstrap`. Unset the variable once it
has been spent.

To test the student path, use a second browser profile or clear cookies, sign
in as a different email address, and open the enrollment URL. The student can
join the course and then view the course page without JavaScript.

For Resend-backed login delivery, configure these variables:

```sh
AUTH_LOGIN_CONFIRM_URL="http://localhost:8787/login/confirm"
AUTH_LOGIN_EMAIL_FROM="Carnap <login@example.test>"
RESEND_API_KEY="re_..."
```

`AUTH_LOGIN_CONFIRM_URL` may point at localhost, a tunnel, a temporary
preview, or production. Preview and production login starts fail with a clear
configuration error if Resend settings are missing.

## Documentation

| Document | What it covers |
|---|---|
| [`docs/carnap-markdown-v1.md`](docs/carnap-markdown-v1.md) | The authoring dialect: directives, exercises, mathematics, diagnostics |
| [`docs/exercise-runtime-api.md`](docs/exercise-runtime-api.md) | The browser-facing contract every exercise widget implements |
| [`docs/course-items-and-assessment.md`](docs/course-items-and-assessment.md) | How content, assignments, and attempts fit together |
| [`docs/grading-model.md`](docs/grading-model.md) | Scoring, release, regrades, and LMS passback |
| [`docs/self-hosting.md`](docs/self-hosting.md) | Running Carnap off Cloudflare: configuration, first run, upgrades |
| [`docs/i18n.md`](docs/i18n.md) | Translation with Lingui, and the failure modes that are silent |
| [`docs/a11y.md`](docs/a11y.md) | The WCAG 2.2 AA testing tiers; [`docs/a11y-manual.md`](docs/a11y-manual.md) is the by-hand checklist |

Update the first two whenever supported Markdown syntax or exercise runtime
behavior changes.

## Conventions

Local, preview, and production environments use the `CARNAP_ENV` variable.
Request IDs are carried in the `X-Request-ID` header. Error responses use this
shape:

```json
{
  "error": {
    "code": "internal_error",
    "message": "An unexpected error occurred.",
    "requestId": "..."
  }
}
```
