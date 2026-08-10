import type { Context } from "hono";
import type { FC } from "hono/jsx";

import type { LtiPlatformOverview } from "../application/lti-admin";
import type { AppBindings } from "../http";
import { adminCrumb } from "./breadcrumbs";
import {
  CopyField,
  CreateBar,
  CsrfInput,
  Notice,
  Sheet,
  StatusBadge,
  TableScroll,
  Time,
} from "./components";
import { renderShell, useI18n } from "./layout";

/**
 * The tool-side URLs an LMS administrator pastes into their platform's
 * external-tool registration form.
 */
const ToolEndpoints: FC<{ readonly origin: string }> = ({ origin }) => {
  const i18n = useI18n();

  return (
    <div class="field-grid wide-fields">
      {/* `for` names the input `CopyField` renders, which is also nested
          here. Naming it explicitly is what the linter can check, and what
          keeps the association true if the field ever moves out of the
          label. */}
      <label for="lti-tool-login">
        {i18n.t("Initiate login URL")}
        <CopyField id="lti-tool-login" value={`${origin}/lti/login`} />
      </label>
      <label for="lti-tool-launch">
        {i18n.t("Redirection (launch) URL")}
        <CopyField id="lti-tool-launch" value={`${origin}/lti/launch`} />
      </label>
      <label for="lti-tool-jwks">
        {i18n.t("Public keyset URL")}
        <CopyField id="lti-tool-jwks" value={`${origin}/lti/jwks`} />
      </label>
    </div>
  );
};

const RegisterPlatformForm: FC<{
  readonly context: Context<AppBindings>;
}> = ({ context }) => {
  const i18n = useI18n();

  return (
    <form action="/admin/lti/platforms" method="post">
      <CsrfInput context={context} />
      <div class="field-grid wide-fields">
        <label>
          {i18n.t("Name")}
          <br />
          <input name="name" placeholder={i18n.t("Campus Moodle")} required />
        </label>
        <label>
          {i18n.t("Issuer")}
          <br />
          <input
            name="issuer"
            placeholder="https://lms.example.edu"
            required
          />
        </label>
        <label>
          {i18n.t("Client ID")}
          <br />
          <input name="clientId" required />
        </label>
        <label>
          {i18n.t("Authentication request URL")}
          <br />
          <input
            name="authorizationEndpoint"
            placeholder="https://lms.example.edu/mod/lti/auth.php"
            required
          />
        </label>
        <label>
          {i18n.t("Access token URL")}
          <br />
          <input
            name="tokenEndpoint"
            placeholder="https://lms.example.edu/mod/lti/token.php"
            required
          />
        </label>
        <label>
          {i18n.t("Public keyset URL")}
          <br />
          <input
            name="jwksUri"
            placeholder="https://lms.example.edu/mod/lti/certs.php"
            required
          />
        </label>
      </div>
      <button type="submit">{i18n.t("Register platform")}</button>
    </form>
  );
};

const PlatformSheet: FC<{
  readonly context: Context<AppBindings>;
  readonly overview: LtiPlatformOverview;
}> = ({ context, overview }) => {
  const i18n = useI18n();
  const { deployments, platform } = overview;
  const disabled = platform.disabledAt !== null;

  return (
    <Sheet
      badge={
        disabled ? (
          <StatusBadge label={i18n.t("Disabled")} tone="danger" />
        ) : (
          <StatusBadge label={i18n.t("Active")} tone="ok" />
        )
      }
      description={i18n.t("Issuer {issuer} · client ID {clientId}", {
        clientId: platform.clientId,
        issuer: platform.issuer,
      })}
      footer={
        <CreateBar
          action={`/admin/lti/platforms/${platform.id}/deployments`}
          context={context}
          submitLabel={i18n.t("Add deployment")}
        >
          <input
            aria-label={i18n.t("Deployment ID")}
            name="deploymentId"
            placeholder={i18n.t("Deployment ID from the LMS")}
            required
          />
          <input
            aria-label={i18n.t("Deployment name")}
            name="name"
            placeholder={i18n.t("Name, optional")}
          />
        </CreateBar>
      }
      title={platform.name}
    >
      <TableScroll>
        <tbody>
          <tr>
            <th>{i18n.t("Authentication request URL")}</th>
            <td>{platform.authorizationEndpoint}</td>
          </tr>
          <tr>
            <th>{i18n.t("Access token URL")}</th>
            <td>{platform.tokenEndpoint}</td>
          </tr>
          <tr>
            <th>{i18n.t("Public keyset URL")}</th>
            <td>{platform.jwksUri}</td>
          </tr>
        </tbody>
      </TableScroll>
      {deployments.length === 0 ? (
        <p class="small">
          {i18n.t(
            "No deployments registered yet. Launches are rejected until the deployment ID shown by the LMS is added here.",
          )}
        </p>
      ) : (
        <TableScroll>
          <thead>
            <tr>
              <th>{i18n.t("Deployment ID")}</th>
              <th>{i18n.t("Name")}</th>
              <th>{i18n.t("Added")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {deployments.map((deployment) => (
              <tr>
                <td>{deployment.deploymentId}</td>
                <td>{deployment.name}</td>
                <td>
                  <Time value={deployment.createdAt} />
                </td>
                <td>
                  <form
                    action={`/admin/lti/platforms/${platform.id}/deployments/${deployment.id}/remove`}
                    method="post"
                  >
                    <CsrfInput context={context} />
                    <button class="danger" type="submit">
                      {i18n.t("Remove")}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
      <form
        action={`/admin/lti/platforms/${platform.id}/${disabled ? "enable" : "disable"}`}
        method="post"
      >
        <CsrfInput context={context} />
        <button class={disabled ? "secondary" : "danger"} type="submit">
          {disabled ? i18n.t("Enable platform") : i18n.t("Disable platform")}
        </button>
      </form>
    </Sheet>
  );
};

export function renderAdminLtiPlatforms(
  context: Context<AppBindings>,
  model: {
    readonly notices: readonly string[];
    readonly origin: string;
    readonly overviews: readonly LtiPlatformOverview[];
  },
): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    { breadcrumb: [adminCrumb(i18n)], title: i18n.t("LTI platforms") },
    <>
      {model.notices.map((message) => (
        <Notice>{message}</Notice>
      ))}
      <Sheet
        description={i18n.t(
          "Paste these Carnap endpoints into the LMS when registering the external tool.",
        )}
        title={i18n.t("Carnap tool endpoints")}
      >
        <ToolEndpoints origin={model.origin} />
      </Sheet>
      {model.overviews.map((overview) => (
        <PlatformSheet context={context} overview={overview} />
      ))}
      <Sheet
        description={i18n.t(
          "Copy these values from the LMS after it issues a client ID for the tool. Launches also require registering the LMS deployment ID on the platform.",
        )}
        title={i18n.t("Register a platform")}
      >
        <RegisterPlatformForm context={context} />
      </Sheet>
    </>,
  );
}
