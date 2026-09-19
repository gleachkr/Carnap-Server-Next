# Carnap Server

Carnap is a platform for teaching and practicing formal logic. Instructors
write lessons and exercises in Markdown, publish them in courses, and review
student work. Exercises include truth tables, models, translations, and
machine-checked proofs.

This TypeScript and Hono application runs on either host:

- A Cloudflare Worker backed by D1, using `bun run dev` locally and Wrangler
  for deployment.
- A standalone Bun process backed by SQLite, using `bun run serve` or the
  `Dockerfile`. See [Self-hosting](docs/self-hosting.md).

Both hosts use the same routes and stores. The storage contract tests run
against both database drivers.

## Carnap and Aufbau

Carnap names the platform and its `carnap-markdown-v1` authoring format.
Platform identifiers include `carnap_session`, `CARNAP_ENV`, and the
`<carnap-…>` custom elements. Most authoring directives use plain names such
as `multiple-choice` and `truth-table`.

Aufbau is the [logic engine](https://github.com/gleachkr/Aufbau), including
`@aufbau/compiler`, `@aufbau/verifier`, and `@aufbau/syntax`. Its four proof
directives retain the engine name: `aufbau-proof`, `aufbau-proof-tree`,
`aufbau-proof-fitch`, and `aufbau-proof-prawitz`. Their browser elements use
both names, as in `<carnap-aufbau-proof>`.

## Local development

Enter the Nix development shell before running project tooling:

```sh
nix develop
```

Install dependencies:

```sh
bun install
```

Build the browser assets, then run the test suite. Some tests inspect the
built bundles:

```sh
bun run build:client
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

Run the client build, tests, typechecking, and Biome checks together.
These checks are manual; no CI or git hook runs them automatically:

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

Alternatively, start the standalone server with a SQLite file. It needs no
Wrangler and applies pending migrations at startup:

```sh
CARNAP_ENV=local bun run serve
```

Both default to port 8787. Run one at a time, set `PORT` for the standalone
server, or pass `--port` to Wrangler. The login and course workflows below
apply to both hosts.

## Local native login

The native login flow is passwordless. A client starts a login challenge, then
confirms it with a one-time token. In local development only, the JSON start
route returns that token in the response body so no email service is required.

```sh
curl -s http://localhost:8787/auth/login/start \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.test"}'
```

Use the returned `login.loginToken` to create a session:

```sh
curl -i http://localhost:8787/auth/login/confirm \
  -H 'Content-Type: application/json' \
  -d '{"loginToken":"alt_..."}'
```

The confirm route sets `carnap_session` and `carnap_csrf` cookies. Unsafe
session-authenticated requests must send `X-CSRF-Token` with the CSRF token.
Both cookies are `HttpOnly`. API clients can use `csrfToken` from the login
confirmation response; page scripts receive it through rendered markup.

Cookie `Secure` follows the resolved request protocol, not `CARNAP_ENV`.
Native login uses `SameSite=Lax`; HTTPS LTI sessions use `SameSite=None` for
embedding. See [Self-hosting](docs/self-hosting.md) for proxy configuration.

Do not expose `CARNAP_ENV=local` to other users: its disclosed login tokens
allow anyone who can reach the server to sign in as any email address.

## Browser course workflow

After applying migrations and starting Wrangler, open this page:

```text
http://localhost:8787/login
```

In local mode, the login page creates a development login link in the browser
when Resend is not configured. Follow that link to sign in, then use
`/courses` to create a course. The course page can create enrollment links,
show the newly created browser enrollment URL, and revoke active links.

On a fresh database, first obtain administrator access: start the server with
`ADMIN_BOOTSTRAP_TOKEN` set to a secret, sign in, and submit it at
`/admin/bootstrap`. Remove the variable after setup. Configure the token
before exposing a fresh instance; without it, any signed-in user can
bootstrap while no active administrator exists.

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

## Developer scripts

`scripts/` holds tools that are run by hand rather than by `validate`. The
`bun run` entries (`a11y:*`, `i18n:*`) are listed in `package.json`; the rest
are invoked directly with `bun run scripts/<name>.ts`.

Seeding a running local server (`bun run dev`, signed in as the local
`site_admin` through the passwordless flow) with a lesson, as a published
practice assignment in a fresh course:

| Script | Lesson |
| --- | --- |
| `seed-lesson.ts <path>` | any carnap-markdown file |
| `seed-showcase-demo.ts` | every exercise type, each beside its source |
| `seed-forallx-demo.ts` | forallx: Calgary Fitch proofs |
| `seed-prawitz-demo.ts` | forallx natural deduction as Prawitz trees |
| `seed-gentzen-demo.ts` | Gentzen LK sequent-calculus trees |
| `seed-gentzen-starter-demo.ts` | the LK demo with starters, into an existing course |
| `seed-lti-fixture.ts` | re-author the LTI acceptance fixture's content |

Engine batteries, which compile every worked proof in a suite with the real
`@aufbau/compiler` and verify the result. They are typechecked with the rest
of the tree but kept out of `bun test` for their cost; run the relevant one
after touching a theory, a translator, or its cases:

| Script | Checks |
| --- | --- |
| `forallx-verify.ts` | the Calgary Fitch cases |
| `magnus-verify.ts` | the Magnus Fitch cases and playgrounds |
| `prawitz-verify.ts` | the Prawitz cases |
| `gentzen-verify.ts` | the LK tree cases |
| `showcase-verify.ts` | every proof in the showcase lesson |

`copy-fonts.ts` is part of `build:client` and `a11y-audit.mjs` is behind
`a11y:audit`; neither is run on its own.

## Documentation

- [Authoring](docs/carnap-markdown-v1.md): Markdown, directives, exercises,
  mathematics, and diagnostics.
- [Exercise runtime](docs/exercise-runtime-api.md): widget and submission
  contracts.
- [Course items](docs/course-items-and-assessment.md): content, publication,
  assessment modes, and attempts.
- [Grading](docs/grading-model.md): score calculation, release, and passback.
- [Self-hosting](docs/self-hosting.md): configuration, setup, and upgrades.
- [Internationalization](docs/i18n.md): Lingui extraction and translation.
- [Accessibility](docs/a11y.md): automated checks, with a separate
  [manual checklist](docs/a11y-manual.md).

Update the first two whenever supported Markdown syntax or exercise runtime
behavior changes.

## Conventions

Local, preview, and production environments use the `CARNAP_ENV` variable.
Request IDs are carried in the `X-Request-ID` header. JSON errors use this
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
