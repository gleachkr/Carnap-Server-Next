import type { Context } from "hono";

import type { AppErrorStatus } from "../application/errors";
import type { Assignment } from "../domain/assignments";
import type { AppBindings } from "../http";
import { allowFormActionTo } from "../middleware/security-headers";
import { ErrorSummary, Notice, Sheet, TableScroll } from "./components";
import { assessmentModeLabel, assignmentStateLabel } from "./labels";
import { renderShell } from "./layout";

/**
 * A failed LMS launch. The person arrived mid-navigation from their LMS, so
 * this page stands alone: a plain explanation, plus the error code and
 * request ID so an administrator can find the structured log line.
 */
export function renderLtiError(
  context: Context<AppBindings>,
  options: {
    readonly code: string;
    readonly message: string;
    readonly status: AppErrorStatus;
  },
): Response {
  const i18n = context.get("i18n");
  const title = i18n.t("Launch failed");

  return renderShell(
    context,
    { showTitle: false, status: options.status, title },
    <Sheet title={title}>
      <ErrorSummary>{options.message}</ErrorSummary>
      <p class="small">
        {i18n.t("Error code {code} · request {requestId}", {
          code: options.code,
          requestId: context.get("requestId"),
        })}
      </p>
    </Sheet>,
  );
}

/**
 * The launch matched an existing Carnap account by email, and a confirmation
 * link is on its way to that address. In local development (no email
 * delivery) the confirmation URL is shown directly, mirroring the native
 * login flow.
 */
export function renderLtiLinkPending(
  context: Context<AppBindings>,
  model: {
    readonly email: string;
    readonly localConfirmUrl: string | null;
  },
): Response {
  const i18n = context.get("i18n");
  const title = i18n.t("Confirm account link");

  return renderShell(
    context,
    { showTitle: false, title },
    <Sheet title={title}>
      <Notice>
        {i18n.t(
          "An Carnap account already exists for {email}. We sent a confirmation link to that address — open it to connect your LMS identity to the account, then launch again from your LMS.",
          { email: model.email },
        )}
      </Notice>
      {model.localConfirmUrl === null ? null : (
        <p class="token">
          <a href={model.localConfirmUrl}>
            {i18n.t("Continue with this local confirmation link")}
          </a>
        </p>
      )}
    </Sheet>,
  );
}

/**
 * The emailed confirmation link, before anything happens. Linking must take
 * an explicit POST: email scanners prefetch GET URLs, and a prefetch that
 * completed the link would grant the LMS identity access without the account
 * owner's consent.
 */
export function renderLtiLinkConfirm(
  context: Context<AppBindings>,
  model: {
    readonly email: string;
    readonly platformName: string;
    readonly token: string;
  },
): Response {
  const i18n = context.get("i18n");
  const title = i18n.t("Confirm account link");

  return renderShell(
    context,
    { showTitle: false, title },
    <Sheet title={title}>
      <p>
        {i18n.t(
          "An LMS launch from {platform} wants to connect to the Carnap account for {email}. If this was you, confirm the link below; if not, close this page and nothing will be linked.",
          { email: model.email, platform: model.platformName },
        )}
      </p>
      <form action="/lti/link/confirm" method="post">
        <input name="token" type="hidden" value={model.token} />
        <button type="submit">{i18n.t("Link accounts")}</button>
      </form>
    </Sheet>,
  );
}

/**
 * The Deep Linking picker, rendered directly as the launch response. Every
 * form carries the single-use selection token, which is the anti-forgery
 * proof here — the respond route is CSRF-exempt, because the session (and
 * with it any CSRF token) can rotate while the picker sits open.
 */
export function renderLtiDeepLinkSelect(
  context: Context<AppBindings>,
  model: {
    readonly assignments: readonly Assignment[];
    readonly selectionToken: string;
  },
): Response {
  const i18n = context.get("i18n");
  const title = i18n.t("Choose an assignment");
  const hidden = (
    <input name="token" type="hidden" value={model.selectionToken} />
  );

  return renderShell(
    context,
    { showTitle: false, title },
    <Sheet
      description={i18n.t(
        "The activity you are adding in your LMS will open the assignment you choose here.",
      )}
      title={title}
    >
      {model.assignments.length === 0 ? (
        <p>
          {i18n.t(
            "This course has no assignments yet. Create one in Carnap first, then choose content from your LMS again.",
          )}
        </p>
      ) : (
        <TableScroll>
          <thead>
            <tr>
              <th>{i18n.t("Assignment")}</th>
              <th>{i18n.t("Status")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {model.assignments.map((assignment) => (
              <tr>
                <td>{assignment.title}</td>
                <td>
                  {i18n.t("{state} · {type}", {
                    state: assignmentStateLabel(i18n, assignment.state),
                    type: assessmentModeLabel(
                      i18n,
                      assignment.assessmentMode,
                    ),
                  })}
                </td>
                <td>
                  <form action="/lti/deep-link/respond" method="post">
                    {hidden}
                    <input
                      name="assignmentId"
                      type="hidden"
                      value={assignment.id}
                    />
                    <button class="secondary" type="submit">
                      {i18n.t("Select")}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
      <form action="/lti/deep-link/respond" method="post">
        {hidden}
        <button class="secondary" type="submit">
          {i18n.t("Return without selecting")}
        </button>
      </form>
    </Sheet>,
  );
}

/**
 * Hand the signed Deep Linking response back to the LMS: an auto-submitting
 * form_post to the platform's return URL, with a visible button in case
 * scripts are unavailable.
 */
export function renderLtiDeepLinkReturn(
  context: Context<AppBindings>,
  model: { readonly jwt: string; readonly returnUrl: string },
): Response {
  const i18n = context.get("i18n");
  const title = i18n.t("Returning to your LMS");

  // The one form in Carnap that posts off-origin, and so the one response whose
  // `form-action` has to name somewhere else. `returnUrl` is the platform's own
  // `deep_link_return_url`, stored at launch.
  allowFormActionTo(context, model.returnUrl);

  return renderShell(
    context,
    { showTitle: false, title },
    <Sheet title={title}>
      <p>{i18n.t("Sending your selection back to the LMS…")}</p>
      {/* Submitted for the reader by the shell script, which looks for this id.
          The button is what happens when that never runs. */}
      <form action={model.returnUrl} id="lti-deep-link-return" method="post">
        <input name="JWT" type="hidden" value={model.jwt} />
        <button type="submit">{i18n.t("Continue to your LMS")}</button>
      </form>
    </Sheet>,
  );
}

/** The emailed confirmation link succeeded. */
export function renderLtiLinkConfirmed(
  context: Context<AppBindings>,
  model: { readonly email: string; readonly platformName: string },
): Response {
  const i18n = context.get("i18n");
  const title = i18n.t("Accounts linked");

  return renderShell(
    context,
    { showTitle: false, title },
    <Sheet title={title}>
      <Notice>
        {i18n.t(
          "Your {platform} identity is now connected to the Carnap account for {email}. Return to your LMS and launch again to sign in.",
          { email: model.email, platform: model.platformName },
        )}
      </Notice>
    </Sheet>,
  );
}
