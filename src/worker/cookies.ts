import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { type AppBindings, requestIsSecure } from "./http";

export const LOCALE_COOKIE_NAME = "carnap_locale";

export const PROFILE_PROMPT_COOKIE_NAME = "carnap_profile_prompt";

/**
 * A year. The cookie carries a stated preference, not session state: someone who
 * chose German last term should still get German, and a signed-in user's stored
 * preference outranks it anyway.
 */
const LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Whether our cookies may carry `Secure` — and so whether `SameSite=None` is
 * available at all, since browsers reject `None` without it.
 *
 * The connection answers this, not the environment's name. A browser drops a
 * `Secure` cookie sent over plain http whatever we call the deployment, and it
 * accepts one over https whatever we call it — so `wrangler dev
 * --local-protocol https`, which is how an embedded LTI launch is tested
 * locally (see `design/LTI_TESTING.md`), gets the same cookies production
 * does, and a misconfigured plain-http deployment degrades to `Lax` instead of
 * setting a cookie the browser throws away. Behind a proxy that terminates TLS
 * the connection we see is not the one the browser is on; `requestIsSecure`
 * reads the proxy's word for it, once the operator has said to trust it.
 */
export function cookieSecure(context: Context<AppBindings>): boolean {
  return requestIsSecure(context);
}

/**
 * The session and CSRF cookies' base names. On a secure request each carries
 * the `__Host-` prefix (`authCookiePrefix`), so read and write them only
 * through `readSessionCookie`, `readCsrfCookie` and `session-cookies.ts`.
 */
export const SESSION_COOKIE_NAME = "carnap_session";
export const CSRF_COOKIE_NAME = "carnap_csrf";

/**
 * `"host"` whenever the cookies can be `Secure`: the session and CSRF cookies
 * are then named `__Host-carnap_session` and `__Host-carnap_csrf`. A browser
 * accepts a `__Host-` cookie only if it is `Secure`, has `Path=/`, and names
 * no `Domain`, and only from the host itself — so a sibling site under a
 * shared parent domain, or a plain-http response, cannot plant one for us.
 * Without the prefix such a site could set a domain-wide session cookie and
 * sign a reader in as someone else (session fixation). Plain-http local
 * development keeps the bare names, since there is no `Secure` to require.
 */
export function authCookiePrefix(
  context: Context<AppBindings>,
): "host" | undefined {
  // Quietly: every request reads its session cookie by this name, a bare
  // health check included, so a missing `X-Forwarded-Proto` is reported where
  // the cookies are written instead (`authCookieOptions`).
  return requestIsSecure(context, { quietly: true }) ? "host" : undefined;
}

/** The `secure` and `prefix` options every write of those cookies carries. */
export function authCookieOptions(context: Context<AppBindings>): {
  readonly prefix?: "host";
  readonly secure: boolean;
} {
  return cookieSecure(context)
    ? { prefix: "host", secure: true }
    : { secure: false };
}

export function readSessionCookie(
  context: Context<AppBindings>,
): string | undefined {
  return getCookie(context, SESSION_COOKIE_NAME, authCookiePrefix(context));
}

export function readCsrfCookie(
  context: Context<AppBindings>,
): string | undefined {
  return getCookie(context, CSRF_COOKIE_NAME, authCookiePrefix(context));
}

/** Whether the request already carries a chosen locale. */
export function hasLocaleCookie(context: Context<AppBindings>): boolean {
  return getCookie(context, LOCALE_COOKIE_NAME) !== undefined;
}

/**
 * Record a chosen locale for this browser.
 *
 * `httpOnly` because nothing client-side reads it — the resolved locale reaches
 * the page's scripts through the layout's string payload, and a cookie the page
 * can write is a cookie that can disagree with what was rendered.
 *
 * `SameSite=None` unconditionally (bar local http, where browsers would reject
 * it), which is *not* what the session cookie does. The difference is
 * deliberate: this cookie is a language tag. It authorizes nothing, identifies
 * nobody, and the worst a cross-site request can do with it is render a page in
 * the reader's chosen language — so it has no CSRF surface to defend, and pays
 * none of the price for `Lax` that the session cookie's `Lax` default buys.
 * What it does need is to survive an LTI launch, which is a cross-site POST: a
 * `Lax` cookie is not sent on one, so the launch would see no cookie, conclude
 * the reader had never chosen a language, and overwrite their choice with the
 * platform's.
 */
export function setLocaleCookie(
  context: Context<AppBindings>,
  locale: string,
): void {
  const secure = cookieSecure(context);

  setCookie(context, LOCALE_COOKIE_NAME, locale, {
    httpOnly: true,
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: secure ? "None" : "Lax",
    secure,
  });
}

/**
 * Forget this browser's chosen language, for a reader who has just asked to go
 * back to following their browser. Leaving the cookie in place would keep
 * answering a question they withdrew — and would outrank `Accept-Language`
 * forever, since detection reads the cookie first.
 */
export function clearLocaleCookie(context: Context<AppBindings>): void {
  const secure = cookieSecure(context);

  deleteCookie(context, LOCALE_COOKIE_NAME, {
    path: "/",
    sameSite: secure ? "None" : "Lax",
    secure,
  });
}

/** Whether this browser has waved off the incomplete-profile prompt. */
export function hasProfilePromptDismissed(
  context: Context<AppBindings>,
): boolean {
  return getCookie(context, PROFILE_PROMPT_COOKIE_NAME) !== undefined;
}

/**
 * Put the incomplete-profile prompt away until the browser is closed.
 *
 * No `maxAge`, so this is a session cookie by design rather than by omission:
 * "not now" is an answer about this sitting, not a standing refusal, and the
 * thing it defers — an account whose work shows up under a bare email address
 * in the gradebook — is worth asking about again next time. `Lax` and not
 * `None`: nothing cross-site has any business dismissing it.
 */
export function setProfilePromptDismissedCookie(
  context: Context<AppBindings>,
): void {
  setCookie(context, PROFILE_PROMPT_COOKIE_NAME, "dismissed", {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: cookieSecure(context),
  });
}
