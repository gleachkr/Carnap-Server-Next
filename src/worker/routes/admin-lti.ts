import { type Context, Hono } from "hono";

import { requireAuthenticated } from "../application/authorization";
import { AppHttpError, badRequest } from "../application/errors";
import { LtiAdminService } from "../application/lti-admin";
import type { LtiDeployment, LtiPlatform } from "../domain/lti";
import type { AppBindings } from "../http";
import type { Translator } from "../i18n/translator";
import { storesForContext } from "../stores";
import { renderAdminLtiPlatforms } from "../web/admin-lti";
import { adminCrumb } from "../web/breadcrumbs";
import { renderFormError } from "../web/errors";
import {
  fieldValue,
  isFormSubmission,
  redirect,
  wantsHtml,
} from "../web/html";

interface RegisterPlatformBody {
  readonly authorizationEndpoint?: unknown;
  readonly clientId?: unknown;
  readonly issuer?: unknown;
  readonly jwksUri?: unknown;
  readonly name?: unknown;
  readonly tokenEndpoint?: unknown;
}

interface AddDeploymentBody {
  readonly deploymentId?: unknown;
  readonly name?: unknown;
}

function ltiAdminService(context: Context<AppBindings>): LtiAdminService {
  return new LtiAdminService({
    requestId: context.get("requestId"),
    stores: storesForContext(context),
  });
}

async function readJsonObject(
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

function requiredParam(context: Context<AppBindings>, name: string): string {
  const value = context.req.param(name);

  if (value === undefined) {
    throw badRequest(
      "missing_route_parameter",
      "A route parameter is missing.",
    );
  }

  return value;
}

function webActorOrLogin(context: Context<AppBindings>): Response | null {
  if (context.get("actor") !== null) {
    return null;
  }

  const next = new URL(context.req.url).pathname;

  return redirect(`/login?next=${encodeURIComponent(next)}`, 302);
}

function formErrorOrThrow(
  context: Context<AppBindings>,
  error: unknown,
  title: string,
): Response {
  if (error instanceof AppHttpError && isFormSubmission(context)) {
    const i18n = context.get("i18n");

    return renderFormError(context, {
      breadcrumb: [
        adminCrumb(i18n),
        {
          href: "/admin/lti",
          label: i18n.t("LTI platforms"),
        },
      ],
      message: error.localize(i18n),
      status: error.status,
      title,
    });
  }

  throw error;
}

function requiredString(value: unknown, code: string, label: string): string {
  if (typeof value !== "string") {
    throw badRequest(code, `${label} is required.`);
  }

  return value;
}

function publicPlatform(platform: LtiPlatform) {
  return {
    authorizationEndpoint: platform.authorizationEndpoint,
    clientId: platform.clientId,
    createdAt: platform.createdAt,
    disabledAt: platform.disabledAt,
    id: platform.id,
    issuer: platform.issuer,
    jwksUri: platform.jwksUri,
    name: platform.name,
    tokenEndpoint: platform.tokenEndpoint,
    updatedAt: platform.updatedAt,
  };
}

function publicDeployment(deployment: LtiDeployment) {
  return {
    createdAt: deployment.createdAt,
    deploymentId: deployment.deploymentId,
    id: deployment.id,
    name: deployment.name,
    platformId: deployment.platformId,
  };
}

/**
 * The flash notices this page can show, keyed by the query parameter that asks
 * for one — a redirect names a *reason*, so no sentence travels in a URL. A
 * function rather than a table because a reason is only a sentence once a
 * language is known.
 */
function platformNotices(
  i18n: Translator,
): readonly { readonly message: string; readonly param: string }[] {
  return [
    { message: i18n.t("Platform registered."), param: "registered" },
    { message: i18n.t("Deployment added."), param: "deploymentAdded" },
    { message: i18n.t("Deployment removed."), param: "deploymentRemoved" },
    { message: i18n.t("Platform disabled."), param: "disabled" },
    { message: i18n.t("Platform enabled."), param: "enabled" },
  ];
}

export const adminLtiRoutes = new Hono<AppBindings>();

adminLtiRoutes.get("/", async (context) => {
  if (wantsHtml(context)) {
    const loginRedirect = webActorOrLogin(context);

    if (loginRedirect !== null) {
      return loginRedirect;
    }
  }

  const actor = requireAuthenticated(context);
  const overviews = await ltiAdminService(context).listPlatforms(actor);

  if (!wantsHtml(context)) {
    return context.json({
      platforms: overviews.map((overview) => ({
        deployments: overview.deployments.map(publicDeployment),
        platform: publicPlatform(overview.platform),
      })),
    });
  }

  const url = new URL(context.req.url);

  return renderAdminLtiPlatforms(context, {
    notices: platformNotices(context.get("i18n"))
      .filter((entry) => url.searchParams.has(entry.param))
      .map((entry) => entry.message),
    origin: url.origin,
    overviews,
  });
});

adminLtiRoutes.post("/platforms", async (context) => {
  const actor = requireAuthenticated(context);

  try {
    if (isFormSubmission(context)) {
      const form = await context.req.raw.formData();
      await ltiAdminService(context).registerPlatform(actor, {
        authorizationEndpoint: fieldValue(form.get("authorizationEndpoint")),
        clientId: fieldValue(form.get("clientId")),
        issuer: fieldValue(form.get("issuer")),
        jwksUri: fieldValue(form.get("jwksUri")),
        name: fieldValue(form.get("name")),
        tokenEndpoint: fieldValue(form.get("tokenEndpoint")),
      });

      return redirect("/admin/lti?registered=1");
    }

    const body = (await readJsonObject(context)) as RegisterPlatformBody;
    const platform = await ltiAdminService(context).registerPlatform(actor, {
      authorizationEndpoint: requiredString(
        body.authorizationEndpoint,
        "invalid_platform_authorization_endpoint",
        "Authentication request URL",
      ),
      clientId: requiredString(
        body.clientId,
        "invalid_platform_client_id",
        "Client ID",
      ),
      issuer: requiredString(
        body.issuer,
        "invalid_platform_issuer",
        "Issuer",
      ),
      jwksUri: requiredString(
        body.jwksUri,
        "invalid_platform_jwks_uri",
        "Public keyset URL",
      ),
      name: requiredString(body.name, "invalid_platform_name", "Name"),
      tokenEndpoint: requiredString(
        body.tokenEndpoint,
        "invalid_platform_token_endpoint",
        "Access token URL",
      ),
    });

    return context.json({ platform: publicPlatform(platform) }, 201);
  } catch (error) {
    const i18n = context.get("i18n");

    return formErrorOrThrow(
      context,
      error,
      i18n.t("Platform not registered"),
    );
  }
});

adminLtiRoutes.post("/platforms/:platformId/disable", async (context) => {
  const actor = requireAuthenticated(context);

  try {
    const platform = await ltiAdminService(context).setPlatformDisabled(
      actor,
      requiredParam(context, "platformId"),
      true,
    );

    if (isFormSubmission(context)) {
      return redirect("/admin/lti?disabled=1");
    }

    return context.json({ platform: publicPlatform(platform) });
  } catch (error) {
    const i18n = context.get("i18n");

    return formErrorOrThrow(context, error, i18n.t("Platform not disabled"));
  }
});

adminLtiRoutes.post("/platforms/:platformId/enable", async (context) => {
  const actor = requireAuthenticated(context);

  try {
    const platform = await ltiAdminService(context).setPlatformDisabled(
      actor,
      requiredParam(context, "platformId"),
      false,
    );

    if (isFormSubmission(context)) {
      return redirect("/admin/lti?enabled=1");
    }

    return context.json({ platform: publicPlatform(platform) });
  } catch (error) {
    const i18n = context.get("i18n");

    return formErrorOrThrow(context, error, i18n.t("Platform not enabled"));
  }
});

adminLtiRoutes.post("/platforms/:platformId/deployments", async (context) => {
  const actor = requireAuthenticated(context);

  try {
    if (isFormSubmission(context)) {
      const form = await context.req.raw.formData();

      await ltiAdminService(context).addDeployment(
        actor,
        requiredParam(context, "platformId"),
        {
          deploymentId: fieldValue(form.get("deploymentId")),
          name: fieldValue(form.get("name")),
        },
      );

      return redirect("/admin/lti?deploymentAdded=1");
    }

    const body = (await readJsonObject(context)) as AddDeploymentBody;
    const deployment = await ltiAdminService(context).addDeployment(
      actor,
      requiredParam(context, "platformId"),
      {
        deploymentId: requiredString(
          body.deploymentId,
          "invalid_deployment_id",
          "Deployment ID",
        ),
        name: typeof body.name === "string" ? body.name : null,
      },
    );

    return context.json({ deployment: publicDeployment(deployment) }, 201);
  } catch (error) {
    const i18n = context.get("i18n");

    return formErrorOrThrow(context, error, i18n.t("Deployment not added"));
  }
});

adminLtiRoutes.post(
  "/platforms/:platformId/deployments/:deploymentId/remove",
  async (context) => {
    const actor = requireAuthenticated(context);

    try {
      await ltiAdminService(context).removeDeployment(
        actor,
        requiredParam(context, "platformId"),
        requiredParam(context, "deploymentId"),
      );

      if (isFormSubmission(context)) {
        return redirect("/admin/lti?deploymentRemoved=1");
      }

      return context.body(null, 204);
    } catch (error) {
      const i18n = context.get("i18n");

      return formErrorOrThrow(
        context,
        error,
        i18n.t("Deployment not removed"),
      );
    }
  },
);
