import type { Context } from "hono";

import type { AuthenticatedActor } from "../application/auth";
import { courseStaffTierFor } from "../application/authorization";
import { AppHttpError, badRequest } from "../application/errors";
import type { CourseStaffTier } from "../domain/courses";
import type { AppBindings } from "../http";
import type { Translator } from "../i18n/translator";
import { storesForContext } from "../stores";
import { renderFormError } from "../web/errors";
import { isFormSubmission, redirect } from "../web/html";
import type { Crumb } from "../web/layout";

/**
 * What every route module does on the way into a handler: read the request,
 * name the actor, and answer a failed form with a page. Each of these was
 * copied into the route files that needed it, and the copies drifted — one
 * `requiredParam` answered a missing parameter with a 500 for a while.
 */

/** The request body as a JSON object; anything else is a 400. */
export async function readJsonObject(
  context: Context<AppBindings>,
): Promise<Record<string, unknown>> {
  try {
    const body = await context.req.json();

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw badRequest("invalid_json", "A JSON object is required.");
    }

    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppHttpError) {
      throw error;
    }

    throw badRequest("invalid_json", "A JSON object is required.");
  }
}

/**
 * A route parameter the pattern promises. Hono types `param()` as possibly
 * undefined for a name the pattern might not carry; a miss here is a
 * mismatch between the pattern and the handler, answered as a 400 rather
 * than left to surface as a 500 somewhere downstream.
 */
export function requiredParam(
  context: Context<AppBindings>,
  name: string,
): string {
  const value = context.req.param(name);

  if (value === undefined) {
    throw badRequest(
      "missing_route_parameter",
      "A route parameter is missing.",
    );
  }

  return value;
}

/**
 * For a page: the redirect to the login form, with this page as the way
 * back, when nobody is signed in — or null when someone is. A JSON route
 * throws 401 instead; a person navigating to a page should be shown the
 * form, not the envelope.
 */
export function webActorOrLogin(
  context: Context<AppBindings>,
): Response | null {
  if (context.get("actor") !== null) {
    return null;
  }

  const next = new URL(context.req.url).pathname;

  return redirect(`/login?next=${encodeURIComponent(next)}`, 302);
}

/** A course's title for a heading or a breadcrumb. */
export async function courseTitleFor(
  context: Context<AppBindings>,
  courseId: string,
): Promise<string> {
  const course = await storesForContext(context).courses.getById(courseId);
  const i18n = context.get("i18n");

  // The fallback is our own word, not the author's, so it is translated: it
  // stands in a breadcrumb beside chrome the reader is already seeing in their
  // language.
  return course?.title ?? i18n.t("Course");
}

/**
 * The tier of a staff member a service has already admitted to a staff page —
 * so a null here is unreachable, and read as an instructor rather than as a
 * state the page could mean anything by.
 */
export async function staffTierFor(
  context: Context<AppBindings>,
  actor: AuthenticatedActor,
  courseId: string,
): Promise<CourseStaffTier> {
  return (
    (await courseStaffTierFor(storesForContext(context), actor, courseId)) ??
    "instructor"
  );
}

/**
 * Where a failed form's error page sits: the breadcrumb above it, or none at
 * all for a page framed by an LMS, whose error page has to be chrome-free
 * too — a breadcrumb up to the course list is exactly the navigation such a
 * page is chrome-free in order not to offer.
 */
export interface FormErrorChrome {
  readonly breadcrumb?: (i18n: Translator) => readonly Crumb[];
  readonly chromeless?: boolean;
}

/**
 * On a form submission, answer an {@link AppHttpError} with an HTML error
 * page under the given chrome instead of leaking the JSON envelope. Anything
 * else — a JSON API caller's error, or a failure that is not an
 * `AppHttpError` — is re-thrown to the global error handler.
 */
export function formErrorOrThrow(
  context: Context<AppBindings>,
  error: unknown,
  chrome: FormErrorChrome,
  title: string,
): Response {
  if (error instanceof AppHttpError && isFormSubmission(context)) {
    const i18n = context.get("i18n");

    return renderFormError(context, {
      ...(chrome.breadcrumb === undefined
        ? {}
        : { breadcrumb: chrome.breadcrumb(i18n) }),
      ...(chrome.chromeless === true ? { chromeless: true } : {}),
      message: error.localize(i18n),
      status: error.status,
      title,
    });
  }

  throw error;
}

/**
 * {@link formErrorOrThrow} as a wrapper around a whole handler.
 *
 * `title` is a function of the translator rather than a string because these
 * wrappers are applied when the routes are *registered* — once per isolate,
 * with no request and so no reader's language in sight. Resolving it inside
 * the handler is what keeps the heading in the same language as the error
 * beneath it.
 */
export function withFormErrorPage(
  handler: (context: Context<AppBindings>) => Promise<Response>,
  chrome: FormErrorChrome,
  title: (i18n: Translator) => string,
): (context: Context<AppBindings>) => Promise<Response> {
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      return formErrorOrThrow(
        context,
        error,
        chrome,
        title(context.get("i18n")),
      );
    }
  };
}
