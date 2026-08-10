export type EnvironmentName = "local" | "preview" | "production";

export interface Env {
  readonly CARNAP_ENV?: EnvironmentName | string;
  readonly ADMIN_BOOTSTRAP_TOKEN?: string;
  readonly AUTH_LOGIN_CONFIRM_URL?: string;
  readonly AUTH_LOGIN_EMAIL_FROM?: string;
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
}
