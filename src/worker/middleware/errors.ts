import type { ErrorHandler, NotFoundHandler } from "hono";

import { type AppErrorStatus, AppHttpError } from "../application/errors";
import type { AppBindings } from "../http";
import type { Translator } from "../i18n/translator";
import { renderErrorPage } from "../web/errors";
import { wantsHtmlErrorPage } from "../web/html";

interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}

function requestId(
  context: Parameters<NotFoundHandler<AppBindings>>[0],
): string {
  return context.get("requestId") ?? "unknown";
}

/**
 * Answer a request that failed. A browser navigation gets the HTML error page;
 * everything else gets the JSON envelope exactly as before — that envelope is
 * the API's contract, and a scripted client left unable to parse a failure is
 * worse off than a reader shown prose meant for a program.
 *
 * The two carry different words on purpose. `message` is the English the
 * envelope has always held, for logs and clients; `readerMessage` is the same
 * fact worded for a person, in their language. It is a thunk so that reaching
 * for the translator — and rendering with it — happens only on the path that
 * shows prose, inside the guard below: this handler answers requests that were
 * rejected on their way in, and it may not assume the middleware that would have
 * put a translator on the context ever ran.
 */
function errorResponse(
  context: Parameters<NotFoundHandler<AppBindings>>[0],
  status: AppErrorStatus,
  code: string,
  message: string,
  readerMessage: (i18n: Translator) => string,
) {
  if (wantsHtmlErrorPage(context)) {
    try {
      return renderErrorPage(context, {
        message: readerMessage(context.get("i18n")),
        status,
      });
    } catch {
      // Rendering is the one step here that can fail on its own, and a handler
      // that throws leaves the reader with a blank response instead of a page.
      // Falling through to the envelope is worse prose but always an answer.
    }
  }

  const body: ErrorEnvelope = {
    error: {
      code,
      message,
      requestId: requestId(context),
    },
  };

  return context.json(body, status);
}

export const notFoundHandler: NotFoundHandler<AppBindings> = (context) => {
  return errorResponse(
    context,
    404,
    "not_found",
    "The requested resource was not found.",
    (i18n) =>
      i18n.t(
        "We could not find that page. The link may be out of date, or the page may have been deleted.",
      ),
  );
};

/**
 * Say, once, that a request failed on our side.
 *
 * Only 500s. A 4xx is this application working — a refusal, a stale link, a
 * malformed request — and logging those buries the one line an operator wants
 * under thousands they don't. A 500 is the opposite: it is always a defect, and
 * until this existed the `requestId` in the envelope appeared in no log at all,
 * so the identifier we hand the reader to quote back correlated with nothing.
 *
 * The pathname without its query, deliberately: a login confirmation link
 * carries its single-use token there, and a log is the last place that should
 * come to rest. Ids in the path are not secrets and are what make a line
 * actionable.
 */
function logServerError(
  context: Parameters<ErrorHandler<AppBindings>>[1],
  code: string,
  error: unknown,
): void {
  console.error("request_failed", {
    code,
    message: error instanceof Error ? error.message : String(error),
    method: context.req.method,
    path: new URL(context.req.url).pathname,
    requestId: requestId(context),
    ...(error instanceof Error && error.stack !== undefined
      ? { stack: error.stack }
      : {}),
  });
}

export const errorHandler: ErrorHandler<AppBindings> = (error, context) => {
  if (error instanceof AppHttpError) {
    if (error.status === 500) {
      logServerError(context, error.code, error);
    }

    return errorResponse(
      context,
      error.status,
      error.code,
      error.message,
      (i18n) => error.localize(i18n),
    );
  }

  logServerError(context, "internal_error", error);

  return errorResponse(
    context,
    500,
    "internal_error",
    "An unexpected error occurred.",
    (i18n) => i18n.t("Something went wrong on our end. Please try again."),
  );
};
