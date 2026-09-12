export type EnvironmentName = "local" | "preview" | "production";

export interface Env {
  readonly CARNAP_ENV?: EnvironmentName | string;
  readonly ADMIN_BOOTSTRAP_TOKEN?: string;
  readonly AUTH_LOGIN_CONFIRM_URL?: string;
  readonly AUTH_LOGIN_EMAIL_FROM?: string;
  /**
   * `1` when a reverse proxy terminates TLS in front of a self-hosted
   * instance, which makes `X-Forwarded-Proto` and `X-Forwarded-Host` the
   * truth about what the browser sees. Read only through `publicRequestUrl`
   * in `http.ts`. Unset on Cloudflare, where the edge hands over a real URL.
   */
  readonly CARNAP_TRUST_PROXY?: string;
  /**
   * Cloudflare's D1 binding, and optional because a self-hosted instance has
   * no such thing: it opens its own database and hands the stores straight to
   * each request (see `src/server/main.ts`), so nothing here is bound. Every
   * reader already guarded for this being absent; the type now says so too.
   */
  readonly DB?: D1Database;
  /**
   * The tool's private signing key as a JSON JWK (with `kid` and `alg`),
   * set via `wrangler secret put` in deployed environments. Only its public
   * half is served (at /lti/jwks); signing starts with milestone 11.
   */
  readonly LTI_TOOL_PRIVATE_KEY?: string;
  readonly RESEND_API_KEY?: string;
  /**
   * Cloudflare Turnstile, the human-verification gate on asking for a login
   * email. The two keys travel together: the secret is what enforces (the
   * server refuses ungated requests whenever it is set), the site key is what
   * renders the widget that lets people pass. Set via `wrangler secret put` /
   * the process environment; both unset means the gate is off and the tight
   * per-IP throttle carries the login form alone.
   */
  readonly TURNSTILE_SECRET_KEY?: string;
  readonly TURNSTILE_SITE_KEY?: string;
}
