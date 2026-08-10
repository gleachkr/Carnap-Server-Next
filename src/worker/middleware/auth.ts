import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import {
  AuthService,
  CSRF_COOKIE_NAME,
  hashAuthToken,
  SESSION_COOKIE_NAME,
} from "../application/auth";
import { AppHttpError } from "../application/errors";
import type { AppBindings } from "../http";
import { deferred } from "../i18n/deferred";
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
  // The picker's single-use selection token — short-lived and bound to the
  // launching instructor's user — is the proof. Tying it to a session's
  // CSRF token instead would 403 whenever the session rotates between the
  // launch that rendered the picker and the selection POST.
  "/lti/deep-link/respond",
]);

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
      getCookie(context, SESSION_COOKIE_NAME) ?? null,
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
    if (
      SAFE_METHODS.has(context.req.method) ||
      CSRF_EXEMPT_PATHS.has(new URL(context.req.url).pathname)
    ) {
      await next();
      return;
    }

    const actor = context.get("actor");

    if (actor === null) {
      await next();
      return;
    }

    const submittedToken = await submittedCsrfToken(context);
    const csrfCookie = getCookie(context, CSRF_COOKIE_NAME);

    if (
      submittedToken === undefined ||
      csrfCookie === undefined ||
      submittedToken !== csrfCookie ||
      (await hashAuthToken(submittedToken)) !== actor.session.csrfTokenHash
    ) {
      throw new AppHttpError(
        403,
        "csrf_token_invalid",
        deferred.i18n.t("A valid CSRF token is required."),
      );
    }

    await next();
  };
}
