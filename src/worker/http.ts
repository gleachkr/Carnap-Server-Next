import type { Context, Hono } from "hono";

import type {
  AuthenticatedActor,
  TurnstileVerifier,
} from "./application/auth";
import { forbidden, unauthorized } from "./application/errors";
import type { LtiPlatformKeyResolver } from "./application/lti";
import type { AppStores } from "./application/stores";
import type { Env } from "./env";
import type { SupportedLocale } from "./i18n/locales";
import type { Translator } from "./i18n/translator";

export const REQUEST_ID_HEADER = "X-Request-Id";

export interface AppVariables {
  readonly actor: AuthenticatedActor | null;
  readonly authFailure: "disabled_user" | null;
  /**
   * An origin this response's forms may post to, beyond our own. Unset on all
   * but the handful of responses that carry a cross-origin form; see
   * `allowFormActionTo` in `middleware/security-headers.ts`, which is the only
   * thing that should write it.
   */
  readonly formActionOrigin?: string;
  /**
   * An origin that may frame this response, beyond our own — set only on the
   * responses an LTI launch renders before its session cookie has come back to
   * us. Every later page in that session takes the answer from the session
   * itself. See `allowFrameAncestor` in `middleware/security-headers.ts`, which
   * is the only thing that should write it.
   */
  readonly frameAncestorOrigin?: string;
  /**
   * The viewer's translator for this request. Views reach it through
   * `useI18n()`; anything outside a render (a service, a module shared with a
   * browser bundle) takes it as a `Translator` parameter named `i18n`.
   *
   * Non-optional, and `localeDetectorMiddleware` is what makes that true: it
   * sets a translator from the request's own evidence before authentication
   * runs, so a request rejected on the way in still has one to word its error
   * page with. Only `requestIdMiddleware` precedes it, and that does nothing
   * that can throw.
   */
  readonly i18n: Translator;
  /**
   * The resolved locale tag, always one we actually serve — the same locale
   * {@link i18n} translates for, kept beside it because `<html lang>` and the
   * client scripts' `Intl` need the tag rather than the words.
   *
   * Written twice per request, by the same code both times (`applyLocale`):
   * once from the cookie and `Accept-Language`, then again once the actor is
   * known, which is the first moment a stored preference can outrank them.
   */
  readonly language: SupportedLocale;
  /** Set by tests to verify launch tokens against a local key set. */
  readonly ltiKeyResolver?: LtiPlatformKeyResolver;
  readonly requestId: string;
  readonly stores?: AppStores;
  /**
   * Set by tests to stand in for the Turnstile siteverify call; production
   * requests build theirs from the environment. Read only through
   * `turnstileForContext` in `infrastructure/turnstile.ts`.
   */
  readonly turnstileVerifier?: TurnstileVerifier;
  /**
   * Set when this response renders the Turnstile widget, whose script and
   * challenge iframe come from Cloudflare — the one foreign origin any page is
   * allowed to run. See `allowTurnstileWidget` in
   * `middleware/security-headers.ts`, which is the only thing that should
   * write it.
   */
  readonly turnstileWidget?: boolean;
}

export interface AppBindings {
  readonly Bindings: Env;
  readonly Variables: AppVariables;
}

export type WorkerApp = Hono<AppBindings>;

/**
 * The actor the auth middleware resolved, or the error a signed-out request
 * gets: 403 for a disabled account that presented a live session, 401 for no
 * session at all. Here rather than in `application/`, because it reads the
 * request — the services take the actor as a parameter and never see one.
 */
export function requireAuthenticated(
  context: Context<AppBindings>,
): AuthenticatedActor {
  if (context.get("authFailure") === "disabled_user") {
    throw forbidden("disabled_user");
  }

  const actor = context.get("actor");

  if (actor === null) {
    throw unauthorized();
  }

  return actor;
}

/**
 * Who a request came from, for the audit trail — null when nothing credible
 * says.
 *
 * `CF-Connecting-IP` first, because on Cloudflare it is set by the edge and
 * cannot be spoofed by the client. Off Cloudflare there is no such header, and
 * a self-hosted instance sits behind whatever proxy its operator chose, so
 * `X-Forwarded-For` is the fallback: its first entry is the original client
 * and the rest are the proxies that relayed it.
 *
 * A client can put anything in `X-Forwarded-For` — this is a hint for a human
 * reading a login record, not an authorization input, and nothing decides
 * anything on it.
 */
export function clientIpAddress(
  context: Context<AppBindings>,
): string | null {
  const edge = context.req.header("CF-Connecting-IP");

  if (edge !== undefined) {
    return edge;
  }

  const forwarded = context.req
    .header("X-Forwarded-For")
    ?.split(",")[0]
    ?.trim();

  return forwarded === undefined || forwarded.length === 0 ? null : forwarded;
}

/**
 * Whether `CARNAP_TRUST_PROXY` is on: the operator has put a reverse proxy in
 * front of this instance and vouches that `X-Forwarded-*` reach us from it
 * alone. `1` or `true`; anything else, including unset, is off.
 *
 * Tolerates a missing environment altogether — `app.request(path)` in a test
 * binds none — since this runs on every response, from the security-headers
 * middleware, and a missing binding must read as "off", not as a 500.
 */
function trustsProxy(env: Env | undefined): boolean {
  const value = env?.CARNAP_TRUST_PROXY?.trim().toLowerCase();

  return value === "1" || value === "true";
}

/**
 * The URL the browser asked for, which behind a TLS-terminating proxy is not
 * the one this server received: the proxy speaks https to the browser and
 * plain http to us, so `context.req.url` says `http://` for every request an
 * instance behind nginx or Caddy will ever see. Read the request's protocol
 * (and host) from here, not from `context.req.url`, wherever the answer
 * reaches the browser — a cookie's `Secure`, HSTS, an emailed login link, the
 * `redirect_uri` an LMS is told to send its launch back to.
 *
 * Honours `X-Forwarded-Proto` and `X-Forwarded-Host` (first entry of each)
 * only under `CARNAP_TRUST_PROXY`. Without the opt-in the headers are what any
 * client can type, and an unproxied plain-http instance told it was https
 * would mint `Secure` cookies the browser then throws away — the exact failure
 * the protocol-based rule in `cookieSecure` exists to avoid. On Cloudflare the
 * edge hands the Worker a real https URL and the flag stays unset.
 */
export function publicRequestUrl(context: Context<AppBindings>): URL {
  const url = new URL(context.req.url);

  if (!trustsProxy(context.env)) {
    return url;
  }

  const protocol = forwardedEntry(
    context,
    "X-Forwarded-Proto",
  )?.toLowerCase();
  const host = forwardedEntry(context, "X-Forwarded-Host");

  if (protocol === "https" || protocol === "http") {
    url.protocol = `${protocol}:`;
  }

  if (host !== undefined) {
    url.host = host;
  }

  return url;
}

/** Whether the browser is talking to us over https; see `publicRequestUrl`. */
export function requestIsSecure(context: Context<AppBindings>): boolean {
  return publicRequestUrl(context).protocol === "https:";
}

/**
 * The first entry of a comma-separated forwarding header, or undefined when
 * it is absent or empty. Proxies chain by appending, so the first entry is
 * the one nearest the browser.
 */
function forwardedEntry(
  context: Context<AppBindings>,
  name: string,
): string | undefined {
  const first = context.req.header(name)?.split(",")[0]?.trim();

  return first === undefined || first.length === 0 ? undefined : first;
}
