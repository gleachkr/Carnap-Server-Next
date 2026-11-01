import type { MiddlewareHandler } from "hono";

import { AuthService } from "../application/auth";
import { AppHttpError } from "../application/errors";
import { hashAuthToken } from "../application/tokens";
import { readCsrfCookie, readSessionCookie } from "../cookies";
import { type AppBindings, publicRequestUrl } from "../http";
import { deferred } from "../i18n/deferred";
import { logRequestEvent } from "../request-log";
import { optionalStoresForContext } from "../stores";

const CSRF_HEADER_NAME = "X-CSRF-Token";
const CSRF_FORM_FIELD_NAME = "csrfToken";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_EXEMPT_PATHS = new Set([
  "/auth/login/start",
  "/auth/login/confirm",
  // LTI messages are cross-site POSTs from the LMS by design; the stored
  // launch state plays the anti-forgery role a CSRF token plays elsewhere.
  "/lti/login",
  "/lti/launch",
  // The emailed single-use token is the proof here, and the person often
  // holds no Carnap session yet when they click it.
  "/lti/link/confirm",
  // The same for an address change's links: the confirmation is opened from
  // the new mailbox and the undo from the old one, often on a device with no
  // session, or with someone else's. Both sign the clicker in, so they also
  // take a same-origin check (`SAME_ORIGIN_PATHS`) instead.
  "/profile/email/confirm",
  "/profile/email/undo",
  // A login link's button, likewise: the token is the proof, the clicker
  // usually has no session yet, and it signs them in.
  "/login/confirm",
  // The picker's single-use selection token — short-lived and bound to the
  // launching instructor's user — is the proof. Tying it to a session's
  // CSRF token instead would 403 whenever the session rotates between the
  // launch that rendered the picker and the selection POST.
  "/lti/deep-link/respond",
]);

/**
 * Exempt paths whose POST signs the browser in, and so must come from our own
 * page: otherwise another site could post a token for an account of its own
 * and sign a visitor into it — login CSRF — so that their work lands there.
 * The emailed link opens the page with a GET; only its button posts.
 */
const SAME_ORIGIN_PATHS = new Set([
  "/login/confirm",
  "/profile/email/confirm",
  "/profile/email/undo",
]);

/**
 * Whether a request plainly came from another site. `Sec-Fetch-Site` where
 * the browser sends it, else `Origin`; a request with neither is not a
 * browser's cross-site form post, so it passes.
 */
function crossSite(context: Parameters<MiddlewareHandler<AppBindings>>[0]) {
  const site = context.req.header("Sec-Fetch-Site");

  if (site !== undefined) {
    return site !== "same-origin";
  }

  const origin = context.req.header("Origin");

  return origin !== undefined && origin !== publicRequestUrl(context).origin;
}

export function actorMiddleware(): MiddlewareHandler<AppBindings> {
  return async (context, next) => {
    context.set("actor", null);
    context.set("authFailure", null);

    // No storage at all means nobody can be signed in, and this middleware
    // runs ahead of the routes that would say so properly — so leave the actor
    // null and let them answer. Asking for the stores rather than for the `DB`
    // binding matters: a self-hosted instance has the first and never the
    // second, and testing for the binding signed every one of its requests out.
    const stores = optionalStoresForContext(context);

    if (stores === null) {
      await next();
      return;
    }

    const service = new AuthService({ stores });
    const result = await service.resolveActor(
      readSessionCookie(context) ?? null,
    );

    context.set("actor", result.actor);
    context.set("authFailure", result.failure);

    await next();
  };
}

async function submittedCsrfToken(
  context: Parameters<MiddlewareHandler<AppBindings>>[0],
): Promise<string | undefined> {
  const headerToken = context.req.header(CSRF_HEADER_NAME);

  if (headerToken !== undefined) {
    return headerToken;
  }

  const contentType = context.req.header("Content-Type") ?? "";

  if (
    !contentType.includes("application/x-www-form-urlencoded") &&
    !contentType.includes("multipart/form-data")
  ) {
    return undefined;
  }

  const form = await context.req.raw.clone().formData();
  const token = form.get(CSRF_FORM_FIELD_NAME);

  return typeof token === "string" ? token : undefined;
}

export function csrfMiddleware(): MiddlewareHandler<AppBindings> {
  return async (context, next) => {
    if (SAFE_METHODS.has(context.req.method)) {
      await next();
      return;
    }

    const { pathname } = new URL(context.req.url);

    if (SAME_ORIGIN_PATHS.has(pathname) && crossSite(context)) {
      throw new AppHttpError(
        403,
        "cross_site_request",
        deferred.i18n.t("Open the link from your email and use its button."),
      );
    }

    if (CSRF_EXEMPT_PATHS.has(pathname)) {
      await next();
      return;
    }

    const actor = context.get("actor");

    if (actor === null) {
      await next();
      return;
    }

    const submittedToken = await submittedCsrfToken(context);
    const csrfCookie = readCsrfCookie(context);

    if (
      submittedToken === undefined ||
      csrfCookie === undefined ||
      submittedToken !== csrfCookie ||
      (await hashAuthToken(submittedToken)) !== actor.session.csrfTokenHash
    ) {
      logRequestEvent(context, "warn", "csrf_rejected", {
        method: context.req.method,
        path: new URL(context.req.url).pathname,
        userId: actor.user.id,
      });

      throw new AppHttpError(
        403,
        "csrf_token_invalid",
        deferred.i18n.t("A valid CSRF token is required."),
      );
    }

    await next();
  };
}
