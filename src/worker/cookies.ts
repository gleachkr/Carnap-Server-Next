import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import type { AppBindings } from "./http";

export const LOCALE_COOKIE_NAME = "carnap_locale";

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
 * setting a cookie the browser throws away.
 */
export function cookieSecure(context: Context<AppBindings>): boolean {
  return new URL(context.req.url).protocol === "https:";
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
