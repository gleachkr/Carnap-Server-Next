import type {
  AdminAuditEvent,
  AdminGlobalStats,
  AdminUserProfile,
  PlatformCapability,
  PlatformCapabilityGrant,
} from "../domain/admin";
import type { CourseMembership } from "../domain/courses";
import type { AppId } from "../domain/ids";
import { createAppId } from "../domain/ids";
import { assertJsonValue, type JsonValue } from "../domain/json";
import { timestampNow } from "../domain/time";
import type { User } from "../domain/users";
import { deferred } from "../i18n/deferred";
import type { AuthenticatedActor } from "./auth";
import { requirePlatformCapability } from "./authorization";
import { AppHttpError, badRequest, forbidden } from "./errors";
import type { AppStores } from "./stores";

export interface AdminServiceOptions {
  readonly now?: () => Date;
  readonly requestId: string;
  readonly stores: AppStores;
}

export interface BootstrapAdminCommand {
  readonly bootstrapToken?: string | null;
}

export interface PlatformCapabilityCommand {
  readonly capability: PlatformCapability;
}

export interface UserSearchCommand {
  readonly limit?: number | null;
  readonly query?: string | null;
}

export interface SupportMembershipCommand {
  readonly courseId: AppId;
  readonly role: CourseMembership["role"];
  readonly status: CourseMembership["status"];
  readonly userId: AppId;
}

const CAPABILITIES: readonly PlatformCapability[] = [
  "content_author",
  "course_creator",
  "site_admin",
  "support_operator",
];
const COURSE_ROLES: readonly CourseMembership["role"][] = [
  "student",
  "teacher_assistant",
  "co_instructor",
  "instructor",
];
const MEMBERSHIP_STATUSES: readonly CourseMembership["status"][] = [
  "active",
  "invited",
  "suspended",
  "dropped",
];

function assertCapability(
  value: string,
): asserts value is PlatformCapability {
  if (!CAPABILITIES.includes(value as PlatformCapability)) {
    throw badRequest(
      "invalid_platform_capability",
      deferred.i18n.t("Platform capability is not supported."),
    );
  }
}

function assertCourseRole(
  value: string,
): asserts value is CourseMembership["role"] {
  if (!COURSE_ROLES.includes(value as CourseMembership["role"])) {
    throw badRequest(
      "invalid_course_role",
      deferred.i18n.t("Course role is not supported."),
    );
  }
}

function assertMembershipStatus(
  value: string,
): asserts value is CourseMembership["status"] {
  if (!MEMBERSHIP_STATUSES.includes(value as CourseMembership["status"])) {
    throw badRequest(
      "invalid_membership_status",
      deferred.i18n.t("Membership status is not supported."),
    );
  }
}

function userNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "user_not_found",
    deferred.i18n.t("The user was not found."),
  );
}

export class AdminService {
  constructor(private readonly options: AdminServiceOptions) {}

  async bootstrapSiteAdmin(
    actor: AuthenticatedActor,
    command: BootstrapAdminCommand = {},
    expectedToken?: string,
  ): Promise<PlatformCapabilityGrant> {
    const hasAdmin =
      await this.options.stores.platformCapabilities.hasAnyActiveSiteAdmin();

    if (hasAdmin) {
      throw forbidden("site_admin_already_bootstrapped");
    }

    if (
      expectedToken !== undefined &&
      command.bootstrapToken !== expectedToken
    ) {
      throw forbidden("invalid_bootstrap_token");
    }

    return this.grantCapabilityWithoutPermissionCheck(
      actor,
      actor.user.id,
      "site_admin",
      "admin.bootstrap_site_admin",
    );
  }

  async getDashboard(actor: AuthenticatedActor): Promise<{
    readonly auditEvents: readonly AdminAuditEvent[];
    readonly stats: AdminGlobalStats;
  }> {
    requirePlatformCapability(actor, ["site_admin", "support_operator"]);

    const [stats, auditEvents] = await Promise.all([
      this.options.stores.adminStats.getGlobalStats(),
      this.options.stores.adminAudit.listRecent(20),
    ]);

    return { auditEvents, stats };
  }

  async listAuditEvents(
    actor: AuthenticatedActor,
    limit = 50,
  ): Promise<AdminAuditEvent[]> {
    requirePlatformCapability(actor, ["site_admin", "support_operator"]);

    return this.options.stores.adminAudit.listRecent(limit);
  }

  async searchUsers(
    actor: AuthenticatedActor,
    command: UserSearchCommand = {},
  ): Promise<User[]> {
    requirePlatformCapability(actor, ["site_admin", "support_operator"]);

    return this.options.stores.users.search({
      limit: command.limit ?? 20,
      query: command.query ?? "",
    });
  }

  async listAllCourses(actor: AuthenticatedActor) {
    requirePlatformCapability(actor, ["site_admin", "support_operator"]);

    return this.options.stores.courses.listAll();
  }

  async getUserProfile(
    actor: AuthenticatedActor,
    userId: AppId,
  ): Promise<AdminUserProfile> {
    requirePlatformCapability(actor, ["site_admin", "support_operator"]);

    const user = await this.options.stores.users.getById(userId);

    if (user === null) {
      throw userNotFound();
    }

    const [capabilities, courses, identities] = await Promise.all([
      this.options.stores.platformCapabilities.listActiveForUser(user.id),
      this.options.stores.courses.listForUser(user.id),
      this.options.stores.users.listExternalIdentitiesForUser(user.id),
    ]);

    return { capabilities, courses, identities, user };
  }

  async grantCapability(
    actor: AuthenticatedActor,
    userId: AppId,
    command: PlatformCapabilityCommand,
  ): Promise<PlatformCapabilityGrant> {
    requirePlatformCapability(actor, ["site_admin"]);
    assertCapability(command.capability);

    return this.grantCapabilityWithoutPermissionCheck(
      actor,
      userId,
      command.capability,
      "admin.grant_platform_capability",
    );
  }

  async revokeCapability(
    actor: AuthenticatedActor,
    userId: AppId,
    command: PlatformCapabilityCommand,
  ): Promise<PlatformCapabilityGrant> {
    requirePlatformCapability(actor, ["site_admin"]);
    assertCapability(command.capability);

    const now = this.now();
    const revoked = await this.options.stores.platformCapabilities.revoke({
      capability: command.capability,
      revokedAt: now.timestamp,
      userId,
    });

    if (revoked === null) {
      throw new AppHttpError(
        404,
        "platform_capability_not_found",
        deferred.i18n.t("The active platform capability was not found."),
      );
    }

    await this.audit({
      action: "admin.revoke_platform_capability",
      actorUserId: actor.user.id,
      metadata: { capability: command.capability },
      targetCourseId: null,
      targetUserId: userId,
      timestamp: now.timestamp,
    });

    return revoked;
  }

  async suspendUser(actor: AuthenticatedActor, userId: AppId): Promise<User> {
    requirePlatformCapability(actor, ["site_admin"]);

    if (userId === actor.user.id) {
      throw badRequest(
        "cannot_suspend_self",
        deferred.i18n.t(
          "Site administrators cannot suspend their own account.",
        ),
      );
    }

    const now = this.now();
    const user = await this.options.stores.users.disable(
      userId,
      now.timestamp,
    );

    if (user === null) {
      throw userNotFound();
    }

    await this.audit({
      action: "admin.suspend_user",
      actorUserId: actor.user.id,
      metadata: {},
      targetCourseId: null,
      targetUserId: userId,
      timestamp: now.timestamp,
    });

    return user;
  }

  async reactivateUser(
    actor: AuthenticatedActor,
    userId: AppId,
  ): Promise<User> {
    requirePlatformCapability(actor, ["site_admin"]);

    const now = this.now();
    const user = await this.options.stores.users.enable(
      userId,
      now.timestamp,
    );

    if (user === null) {
      throw userNotFound();
    }

    await this.audit({
      action: "admin.reactivate_user",
      actorUserId: actor.user.id,
      metadata: {},
      targetCourseId: null,
      targetUserId: userId,
      timestamp: now.timestamp,
    });

    return user;
  }

  async changeMembership(
    actor: AuthenticatedActor,
    command: SupportMembershipCommand,
  ): Promise<CourseMembership> {
    requirePlatformCapability(actor, ["site_admin", "support_operator"]);
    assertCourseRole(command.role);
    assertMembershipStatus(command.status);

    const [course, user] = await Promise.all([
      this.options.stores.courses.getById(command.courseId),
      this.options.stores.users.getById(command.userId),
    ]);

    if (course === null) {
      throw new AppHttpError(
        404,
        "course_not_found",
        deferred.i18n.t("The course was not found."),
      );
    }

    if (user === null) {
      throw userNotFound();
    }

    const now = this.now();
    const membership = await this.options.stores.courses.upsertMembership({
      courseId: command.courseId,
      createdAt: now.timestamp,
      id: createAppId(now.date.getTime()),
      role: command.role,
      status: command.status,
      updatedAt: now.timestamp,
      userId: command.userId,
    });

    await this.audit({
      action: "admin.change_course_membership",
      actorUserId: actor.user.id,
      metadata: {
        membershipId: membership.id,
        role: command.role,
        status: command.status,
      },
      targetCourseId: command.courseId,
      targetUserId: command.userId,
      timestamp: now.timestamp,
    });

    return membership;
  }

  private async grantCapabilityWithoutPermissionCheck(
    actor: AuthenticatedActor,
    userId: AppId,
    capability: PlatformCapability,
    action: string,
  ): Promise<PlatformCapabilityGrant> {
    const user = await this.options.stores.users.getById(userId);

    if (user === null) {
      throw userNotFound();
    }

    const now = this.now();
    const grant = await this.options.stores.platformCapabilities.grant({
      capability,
      grantedAt: now.timestamp,
      grantedById: actor.user.id,
      id: createAppId(now.date.getTime()),
      userId,
    });

    await this.audit({
      action,
      actorUserId: actor.user.id,
      metadata: { capability },
      targetCourseId: null,
      targetUserId: userId,
      timestamp: now.timestamp,
    });

    return grant;
  }

  private now() {
    const date = this.options.now?.() ?? new Date();

    return { date, timestamp: timestampNow(date) };
  }

  private async audit(input: {
    readonly action: string;
    readonly actorUserId: AppId;
    readonly metadata: JsonValue;
    readonly targetCourseId: AppId | null;
    readonly targetUserId: AppId | null;
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
      targetCourseId: input.targetCourseId,
      targetUserId: input.targetUserId,
    });
  }
}
