import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "../application/auth";
import { cookieSecure } from "../cookies";
import type { AppBindings } from "../http";

export interface SessionCookieOptions {
  /**
   * `Lax` (the default) covers ordinary same-site logins and still survives
   * top-level cross-site navigations, such as an LMS launch that opens in a
   * new window. `None` is needed when the session must also work inside a
   * cross-site iframe (an embedded LTI launch); browsers only accept it on
   * secure cookies, so it downgrades to `Lax` in plain-http local dev.
   *
   * Per-call rather than always `None` — unlike the locale cookie — because
   * this one authenticates: `Lax` is a free defence against cross-site
   * requests riding the reader's session, and it is only worth giving up on
   * the flows that genuinely need to work inside someone else's iframe.
   */
  readonly sameSite?: "Lax" | "None";
}

export function setSessionCookies(
  context: Context<AppBindings>,
  sessionToken: string,
  csrfToken: string,
  options: SessionCookieOptions = {},
): void {
  const secure = cookieSecure(context);
  const sameSite = options.sameSite === "None" && secure ? "None" : "Lax";

  setCookie(context, SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    sameSite,
    secure,
  });
  // `httpOnly` even though this is the CSRF half, because nothing client-side
  // reads it: the token reaches a form as a server-rendered hidden input
  // (`web/components.tsx`), and the scripts that submit through `fetch` take it
  // from that input rather than from `document.cookie`
  // (`web/assignment-scripts.ts`). The cookie's job is to be *sent*, which
  // `httpOnly` does not affect — `middleware/auth.ts` compares it to the
  // submitted token server-side. A double-submit scheme where the page reads
  // the cookie would need this open; ours never did.
  setCookie(context, CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    sameSite,
    secure,
  });
}

export function clearSessionCookies(context: Context<AppBindings>): void {
  deleteCookie(context, SESSION_COOKIE_NAME, { path: "/" });
  deleteCookie(context, CSRF_COOKIE_NAME, { path: "/" });
}
