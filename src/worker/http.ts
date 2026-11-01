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
import { logEvent } from "./log";

export const REQUEST_ID_HEADER = "X-Request-Id";

export interface AppVariables {
  readonly actor: AuthenticatedActor | null;
  readonly authFailure: "disabled_user" | null;
  /**
   * The host's word for where this request came from: the socket's peer under
   * the Bun server, the edge's `CF-Connecting-IP` on Cloudflare. Set from
   * `CreateAppOptions.connectingAddress`, and read only through
   * `clientIpAddress`, which prefers a trusted proxy's word to it.
   */
  readonly connectingAddress: string | null;
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
 * Who a request came from, for the login throttle's per-address bucket, the
 * Turnstile check and the log — null when nothing credible says.
 *
 * Behind a trusted proxy (`CARNAP_TRUST_PROXY`), the last `X-Forwarded-For`
 * entry: proxies chain by appending the peer they saw, so the last entry is
 * the one our own proxy wrote, and everything before it is whatever the
 * client claimed. Otherwise the host's word for it (`connectingAddress`),
 * which a client cannot choose: on Cloudflare the edge overwrites
 * `CF-Connecting-IP`, and under Bun it is the socket's peer. Neither header is
 * read otherwise, because off Cloudflare and without a proxy either one is
 * what any client can type — a fresh value per request would be a fresh
 * throttle bucket. A trusted proxy that sent no address leaves none, and the
 * log says so (`reportMissingForwarding`).
 */
export function clientIpAddress(
  context: Context<AppBindings>,
): string | null {
  if (trustsProxy(context.env)) {
    const address = forwardedEntry(context, "X-Forwarded-For", "last");

    if (address === undefined) {
      reportMissingForwarding(context, "X-Forwarded-For", "client_address");
    }

    return address ?? null;
  }

  return context.get("connectingAddress");
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
  return forwardedUrl(context, "public_url");
}

/**
 * Whether the browser is talking to us over https; see `publicRequestUrl`.
 *
 * `quietly` for the questions every response asks — whether to send HSTS,
 * which name the session cookie goes by — and so a load balancer's bare
 * health check asks too. A missing `X-Forwarded-Proto` is reported where it
 * costs something (a cookie written, a link minted), not wherever it is
 * consulted, or a health check would spend the report.
 */
export function requestIsSecure(
  context: Context<AppBindings>,
  options: { readonly quietly?: boolean } = {},
): boolean {
  return (
    forwardedUrl(
      context,
      options.quietly === true ? undefined : "secure_cookie",
    ).protocol === "https:"
  );
}

/**
 * `publicRequestUrl`, reporting a missing `X-Forwarded-Proto` as a failure of
 * `use`, unless `use` is undefined. A missing `X-Forwarded-Host` is not
 * reported: a proxy that preserves `Host` has no need to send it, and nothing
 * here can tell a preserved `Host` from an internal one.
 */
function forwardedUrl(
  context: Context<AppBindings>,
  use: ForwardingUse | undefined,
): URL {
  const url = new URL(context.req.url);

  if (!trustsProxy(context.env)) {
    return url;
  }

  const protocol = forwardedEntry(
    context,
    "X-Forwarded-Proto",
    "first",
  )?.toLowerCase();
  const host = forwardedEntry(context, "X-Forwarded-Host", "first");

  if (protocol === "https" || protocol === "http") {
    url.protocol = `${protocol}:`;
  } else if (use !== undefined) {
    reportMissingForwarding(context, "X-Forwarded-Proto", use);
  }

  if (host !== undefined) {
    url.host = host;
  }

  return url;
}

/**
 * What a missing forwarding header broke, for the report's `use` field: the
 * client address (login throttle, human check, log lines), a URL that reaches
 * the browser (login and LTI links, the same-origin check), or a cookie's
 * `Secure`.
 */
type ForwardingUse = "client_address" | "public_url" | "secure_cookie";

type ForwardingHeader = "X-Forwarded-For" | "X-Forwarded-Proto";

/**
 * At most one report per header in this window, per process (on Workers, per
 * isolate). A misconfigured proxy is wrong on every request, so a report per
 * request would bury the log; one per process would be spent by whatever
 * request came first and then say nothing about the ones that matter.
 */
const MISSING_FORWARDING_REPORT_INTERVAL_MS = 60 * 60 * 1000;

/** Headers a proxy may send instead, which we do not read. */
const UNREAD_FORWARDING_HEADERS = ["Forwarded", "X-Real-IP"] as const;

const missingForwarding = new Map<
  ForwardingHeader,
  { readonly reportedAt: number; unreported: number }
>();

/**
 * Log that `CARNAP_TRUST_PROXY` is on but this request lacked `header`, which
 * `use` needed — at most once per header per interval, with the number of
 * times since the last report it was needed and missing (uses, not requests:
 * one request may build several links). Called only where the value is used
 * for something, never on arrival, so a health check that reaches the port
 * without the headers neither raises nor spends it.
 */
function reportMissingForwarding(
  context: Context<AppBindings>,
  header: ForwardingHeader,
  use: ForwardingUse,
): void {
  const now = Date.now();
  const previous = missingForwarding.get(header);

  if (
    previous !== undefined &&
    now - previous.reportedAt < MISSING_FORWARDING_REPORT_INTERVAL_MS
  ) {
    previous.unreported += 1;
    return;
  }

  missingForwarding.set(header, { reportedAt: now, unreported: 0 });

  const unread = UNREAD_FORWARDING_HEADERS.filter(
    (name) => context.req.header(name) !== undefined,
  );

  logEvent("warn", "proxy_header_missing", {
    header,
    use,
    occurrences: (previous?.unreported ?? 0) + 1,
    path: new URL(context.req.url).pathname,
    unreadHeaders: unread.length === 0 ? undefined : unread,
    requestId: context.get("requestId"),
  });
}

/** Forget the reports made so far, for a test that needs a fresh window. */
export function resetMissingForwardingReports(): void {
  missingForwarding.clear();
}

/**
 * One end of a comma-separated forwarding header, or undefined when it is
 * absent or empty. Proxies chain by appending, so the first entry is the one
 * nearest the browser and the last is the one our own proxy wrote.
 */
function forwardedEntry(
  context: Context<AppBindings>,
  name: string,
  end: "first" | "last",
): string | undefined {
  const entries = context.req.header(name)?.split(",");
  const entry = (end === "first" ? entries?.[0] : entries?.at(-1))?.trim();

  return entry === undefined || entry.length === 0 ? undefined : entry;
}
