import { createAppId } from "../domain/ids";
import { assertJsonValue, type JsonValue } from "../domain/json";
import type { LtiDeployment, LtiPlatform } from "../domain/lti";
import { timestampNow } from "../domain/time";
import { deferred } from "../i18n/deferred";
import type { TranslatableMessage } from "../i18n/translator";
import type { AuthenticatedActor } from "./auth";
import { requirePlatformCapability } from "./authorization";
import { AppHttpError, badRequest } from "./errors";
import type { AppStores } from "./stores";

export interface LtiAdminServiceOptions {
  readonly now?: () => Date;
  readonly requestId: string;
  readonly stores: AppStores;
}

export interface RegisterLtiPlatformCommand {
  readonly authorizationEndpoint: string;
  readonly clientId: string;
  readonly issuer: string;
  readonly jwksUri: string;
  readonly name: string;
  readonly tokenEndpoint: string;
}

export interface AddLtiDeploymentCommand {
  readonly deploymentId: string;
  readonly name?: string | null;
}

export interface LtiPlatformOverview {
  readonly deployments: readonly LtiDeployment[];
  readonly platform: LtiPlatform;
}

/**
 * `label` is itself a message, not a word: it is nested as a parameter so the
 * field name is translated along with the sentence quoting it, instead of
 * arriving in the catalog as a loose English noun phrase.
 */
function requiredText(
  value: string,
  code: string,
  label: TranslatableMessage,
): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw badRequest(
      code,
      deferred.i18n.t("{label} is required.", { label }),
    );
  }

  return trimmed;
}

/**
 * Endpoints must parse as http(s) URLs. Plain http is deliberately allowed:
 * the canonical local test surface is an LMS on localhost.
 */
function requiredUrl(
  value: string,
  code: string,
  label: TranslatableMessage,
): string {
  const trimmed = requiredText(value, code, label);

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch (_error) {
    throw badRequest(
      code,
      deferred.i18n.t("{label} must be a valid URL.", { label }),
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw badRequest(
      code,
      deferred.i18n.t("{label} must be an http(s) URL.", { label }),
    );
  }

  return trimmed;
}

function platformNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "lti_platform_not_found",
    deferred.i18n.t("The LTI platform was not found."),
  );
}

/**
 * Registration records for LTI platforms and deployments. Follows the
 * platform-administration conventions: site_admin-gated mutations, every one
 * of them audited; support operators may read.
 */
export class LtiAdminService {
  constructor(private readonly options: LtiAdminServiceOptions) {}

  async listPlatforms(
    actor: AuthenticatedActor,
  ): Promise<LtiPlatformOverview[]> {
    requirePlatformCapability(actor, ["site_admin", "support_operator"]);

    const platforms = await this.options.stores.lti.listPlatforms();

    return Promise.all(
      platforms.map(async (platform) => ({
        deployments: await this.options.stores.lti.listDeploymentsForPlatform(
          platform.id,
        ),
        platform,
      })),
    );
  }

  async registerPlatform(
    actor: AuthenticatedActor,
    command: RegisterLtiPlatformCommand,
  ): Promise<LtiPlatform> {
    requirePlatformCapability(actor, ["site_admin"]);

    const name = requiredText(
      command.name,
      "invalid_platform_name",
      deferred.i18n.t("Name"),
    );
    const issuer = requiredText(
      command.issuer,
      "invalid_platform_issuer",
      deferred.i18n.t("Issuer"),
    );
    const clientId = requiredText(
      command.clientId,
      "invalid_platform_client_id",
      deferred.i18n.t("Client ID"),
    );
    const authorizationEndpoint = requiredUrl(
      command.authorizationEndpoint,
      "invalid_platform_authorization_endpoint",
      deferred.i18n.t("Authentication request URL"),
    );
    const tokenEndpoint = requiredUrl(
      command.tokenEndpoint,
      "invalid_platform_token_endpoint",
      deferred.i18n.t("Access token URL"),
    );
    const jwksUri = requiredUrl(
      command.jwksUri,
      "invalid_platform_jwks_uri",
      deferred.i18n.t("Public keyset URL"),
    );

    const existing =
      await this.options.stores.lti.getPlatformByIssuerClientId(
        issuer,
        clientId,
      );

    if (existing !== null) {
      throw badRequest(
        "lti_platform_duplicate",
        deferred.i18n.t(
          "A platform with this issuer and client ID is already registered.",
        ),
      );
    }

    const now = this.now();
    const platform = await this.options.stores.lti.createPlatform({
      id: createAppId(now.date.getTime()),
      name,
      issuer,
      clientId,
      authorizationEndpoint,
      tokenEndpoint,
      jwksUri,
      createdAt: now.timestamp,
    });

    await this.audit({
      action: "admin.lti_platform_registered",
      actorUserId: actor.user.id,
      metadata: { clientId, issuer, name, platformId: platform.id },
      timestamp: now.timestamp,
    });

    return platform;
  }

  async setPlatformDisabled(
    actor: AuthenticatedActor,
    platformId: string,
    disabled: boolean,
  ): Promise<LtiPlatform> {
    requirePlatformCapability(actor, ["site_admin"]);

    const now = this.now();
    const platform = await this.options.stores.lti.setPlatformDisabled(
      platformId,
      disabled ? now.timestamp : null,
      now.timestamp,
    );

    if (platform === null) {
      throw platformNotFound();
    }

    await this.audit({
      action: disabled
        ? "admin.lti_platform_disabled"
        : "admin.lti_platform_enabled",
      actorUserId: actor.user.id,
      metadata: {
        clientId: platform.clientId,
        issuer: platform.issuer,
        platformId: platform.id,
      },
      timestamp: now.timestamp,
    });

    return platform;
  }

  async addDeployment(
    actor: AuthenticatedActor,
    platformId: string,
    command: AddLtiDeploymentCommand,
  ): Promise<LtiDeployment> {
    requirePlatformCapability(actor, ["site_admin"]);

    const deploymentId = requiredText(
      command.deploymentId,
      "invalid_deployment_id",
      deferred.i18n.t("Deployment ID"),
    );
    const platform =
      await this.options.stores.lti.getPlatformById(platformId);

    if (platform === null) {
      throw platformNotFound();
    }

    const existing = await this.options.stores.lti.getDeployment(
      platform.id,
      deploymentId,
    );

    if (existing !== null) {
      throw badRequest(
        "lti_deployment_duplicate",
        deferred.i18n.t(
          "This deployment is already registered for the platform.",
        ),
      );
    }

    const now = this.now();
    const deployment = await this.options.stores.lti.createDeployment({
      id: createAppId(now.date.getTime()),
      platformId: platform.id,
      deploymentId,
      name: command.name?.trim() ?? "",
      createdAt: now.timestamp,
    });

    await this.audit({
      action: "admin.lti_deployment_added",
      actorUserId: actor.user.id,
      metadata: {
        deploymentId,
        issuer: platform.issuer,
        platformId: platform.id,
      },
      timestamp: now.timestamp,
    });

    return deployment;
  }

  async removeDeployment(
    actor: AuthenticatedActor,
    platformId: string,
    deploymentRowId: string,
  ): Promise<void> {
    requirePlatformCapability(actor, ["site_admin"]);

    const platform =
      await this.options.stores.lti.getPlatformById(platformId);

    if (platform === null) {
      throw platformNotFound();
    }

    const removed = await this.options.stores.lti.deleteDeployment(
      platform.id,
      deploymentRowId,
    );

    if (!removed) {
      throw new AppHttpError(
        404,
        "lti_deployment_not_found",
        deferred.i18n.t("The LTI deployment was not found."),
      );
    }

    const now = this.now();

    await this.audit({
      action: "admin.lti_deployment_removed",
      actorUserId: actor.user.id,
      metadata: {
        deploymentRowId,
        issuer: platform.issuer,
        platformId: platform.id,
      },
      timestamp: now.timestamp,
    });
  }

  private now() {
    const date = this.options.now?.() ?? new Date();

    return { date, timestamp: timestampNow(date) };
  }

  private async audit(input: {
    readonly action: string;
    readonly actorUserId: string;
    readonly metadata: JsonValue;
    readonly timestamp: string;
  }): Promise<void> {
    assertJsonValue(input.metadata);

    await this.options.stores.adminAudit.append({
      action: input.action,
      actorUserId: input.actorUserId,
      createdAt: input.timestamp,
      id: createAppId(new Date(input.timestamp).getTime()),
      metadata: input.metadata,
      requestId: this.options.requestId,
      targetCourseId: null,
      targetUserId: null,
    });
  }
}
