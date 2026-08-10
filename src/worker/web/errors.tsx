import type { Context } from "hono";

import type { AppErrorStatus } from "../application/errors";
import type { AppBindings } from "../http";
import type { Translator } from "../i18n/translator";
import { ErrorSummary, Sheet } from "./components";
import type { Crumb } from "./layout";
import { renderShell } from "./layout";

/**
 * Standalone HTML error page for a failed form submission. Form POST handlers
 * catch `AppHttpError` and render this so a browser interaction (e.g. a typo or
 * a rejected action) is answered in the page's own terms — with the breadcrumb
 * and heading of wherever the reader was — rather than by the generic
 * {@link renderErrorPage} the global handler falls back to.
 */
export function renderFormError(
  context: Context<AppBindings>,
  options: {
    readonly breadcrumb?: readonly Crumb[];
    /** Answer a chrome-free page in kind (see `ShellOptions.chromeless`). */
    readonly chromeless?: boolean;
    readonly message: string;
    readonly status: AppErrorStatus;
    readonly title: string;
  },
): Response {
  return renderShell(
    context,
    {
      ...(options.breadcrumb === undefined
        ? {}
        : { breadcrumb: options.breadcrumb }),
      ...(options.chromeless === true ? { chromeless: true } : {}),
      status: options.status,
      title: options.title,
    },
    <ErrorSummary>{options.message}</ErrorSummary>,
  );
}

/**
 * What went wrong, in the reader's words. The status is the only thing the
 * global handler knows about an error it did not raise itself, so the heading
 * says the kind of thing that happened and the message below it says the rest.
 */
function errorHeading(status: AppErrorStatus, i18n: Translator): string {
  switch (status) {
    case 401:
      return i18n.t("Please log in");
    case 403:
      return i18n.t("Not allowed");
    case 404:
      return i18n.t("Page not found");
    case 429:
      return i18n.t("Too many requests");
    default:
      return i18n.t("Something went wrong");
  }
}

/**
 * The generic HTML error page, rendered by the global error and not-found
 * handlers when the request came from a browser. Without it a mistyped URL, an
 * expired link, or an unhandled failure answers a reader with the raw JSON
 * envelope meant for API clients.
 *
 * It always offers somewhere to go next, because the reader arrived here by
 * following a link that did not work and the browser's back button returns them
 * to the same dead end.
 */
export function renderErrorPage(
  context: Context<AppBindings>,
  options: {
    readonly message: string;
    readonly status: AppErrorStatus;
  },
): Response {
  const i18n = context.get("i18n");
  const signedIn = context.get("actor") !== null;
  const heading = errorHeading(options.status, i18n);

  return renderShell(
    context,
    { showTitle: false, status: options.status, title: heading },
    <Sheet title={heading}>
      <ErrorSummary>{options.message}</ErrorSummary>
      <p class="error-next">
        <a href={signedIn ? "/courses" : "/login"}>
          {signedIn
            ? i18n.t("Go to your courses")
            : i18n.t("Go to the login page")}
          {/* Outside the message, and hidden, the way every other onward link
              in the app carries its arrow: it is direction, not a word. */}
          <span aria-hidden="true"> →</span>
        </a>
      </p>
      {options.status === 500 ? (
        // The one status where the reader has nothing to act on and support
        // does: the request id is what ties their report to a log line.
        <p class="small">
          {i18n.t("Reference: {requestId}", {
            requestId: context.get("requestId") ?? "unknown",
          })}
        </p>
      ) : null}
    </Sheet>,
  );
}
