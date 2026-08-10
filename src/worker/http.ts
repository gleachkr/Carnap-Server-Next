import type { Context, Hono } from "hono";

import type { AuthenticatedActor } from "./application/auth";
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
}

export interface AppBindings {
  readonly Bindings: Env;
  readonly Variables: AppVariables;
}

export type WorkerApp = Hono<AppBindings>;

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
