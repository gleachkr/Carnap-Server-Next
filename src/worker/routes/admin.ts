import { type Context, Hono } from "hono";

import {
  AdminService,
  type PlatformCapabilityCommand,
  type SupportMembershipCommand,
} from "../application/admin";
import { badRequest } from "../application/errors";
import { resolveUsers } from "../application/users";
import type {
  AdminAuditEvent,
  AdminUserProfile,
  PlatformCapabilityGrant,
} from "../domain/admin";
import type { CourseMembership } from "../domain/courses";
import type { User } from "../domain/users";
import { type AppBindings, requireAuthenticated } from "../http";
import { storesForContext } from "../stores";
import {
  type AuditDirectory,
  renderAdminAudit,
  renderAdminDashboard,
  renderAdminUserProfile,
  renderAdminUsers,
  renderBootstrap,
} from "../web/admin";
import { adminCrumb } from "../web/breadcrumbs";
import {
  fieldValue,
  isFormSubmission,
  redirect,
  wantsHtml,
} from "../web/html";
import {
  type FormErrorChrome,
  formErrorOrThrow,
  readJsonObject,
  requiredParam,
  webActorOrLogin,
} from "./support";

interface BootstrapBody {
  readonly bootstrapToken?: unknown;
}

interface CapabilityBody {
  readonly capability?: unknown;
}

interface MembershipBody {
  readonly courseId?: unknown;
  readonly role?: unknown;
  readonly status?: unknown;
  readonly userId?: unknown;
}

function adminService(context: Context<AppBindings>): AdminService {
  return new AdminService({
    requestId: context.get("requestId"),
    stores: storesForContext(context),
  });
}

/** A failed admin form answers under the admin crumb. */
const ADMIN_CHROME: FormErrorChrome = {
  breadcrumb: (i18n) => [adminCrumb(i18n)],
};

function publicUser(user: User) {
  return {
    createdAt: user.createdAt,
    disabledAt: user.disabledAt,
    email: user.email,
    id: user.id,
    name: user.name,
    updatedAt: user.updatedAt,
  };
}

function publicCapability(grant: PlatformCapabilityGrant) {
  return {
    capability: grant.capability,
    grantedAt: grant.grantedAt,
    grantedById: grant.grantedById,
    id: grant.id,
    revokedAt: grant.revokedAt,
    userId: grant.userId,
  };
}

function publicMembership(membership: CourseMembership) {
  return {
    courseId: membership.courseId,
    createdAt: membership.createdAt,
    id: membership.id,
    role: membership.role,
    status: membership.status,
    updatedAt: membership.updatedAt,
    userId: membership.userId,
  };
}

function publicProfile(profile: AdminUserProfile) {
  return {
    capabilities: profile.capabilities.map(publicCapability),
    courses: profile.courses.map((entry) => ({
      course: {
        archivedAt: entry.course.archivedAt,
        createdAt: entry.course.createdAt,
        createdById: entry.course.createdById,
        id: entry.course.id,
        timezone: entry.course.timezone,
        title: entry.course.title,
        updatedAt: entry.course.updatedAt,
      },
      membership: publicMembership(entry.membership),
    })),
    identities: profile.identities.map((identity) => ({
      createdAt: identity.createdAt,
      id: identity.id,
      provider: identity.provider,
      providerSubject: identity.providerSubject,
      userId: identity.userId,
    })),
    user: publicUser(profile.user),
  };
}

function publicAuditEvent(event: AdminAuditEvent) {
  return {
    action: event.action,
    actorUserId: event.actorUserId,
    createdAt: event.createdAt,
    id: event.id,
    metadata: event.metadata,
    requestId: event.requestId,
    targetCourseId: event.targetCourseId,
    targetUserId: event.targetUserId,
  };
}

function capabilityCommand(body: CapabilityBody): PlatformCapabilityCommand {
  if (typeof body.capability !== "string") {
    throw badRequest(
      "invalid_platform_capability",
      "Platform capability must be a string.",
    );
  }

  return {
    capability: body.capability as PlatformCapabilityCommand["capability"],
  };
}

function capabilityCommandFromForm(
  form: FormData,
): PlatformCapabilityCommand {
  return capabilityCommand({
    capability: fieldValue(form.get("capability")),
  });
}

function membershipCommand(body: MembershipBody): SupportMembershipCommand {
  if (typeof body.courseId !== "string") {
    throw badRequest("invalid_course_id", "Course ID must be a string.");
  }

  if (typeof body.userId !== "string") {
    throw badRequest("invalid_user_id", "User ID must be a string.");
  }

  if (typeof body.role !== "string") {
    throw badRequest("invalid_course_role", "Role must be a string.");
  }

  if (typeof body.status !== "string") {
    throw badRequest("invalid_membership_status", "Status must be a string.");
  }

  return {
    courseId: body.courseId,
    role: body.role as CourseMembership["role"],
    status: body.status as CourseMembership["status"],
    userId: body.userId,
  };
}

function membershipCommandFromForm(form: FormData): SupportMembershipCommand {
  return membershipCommand({
    courseId: fieldValue(form.get("courseId")),
    role: fieldValue(form.get("role")),
    status: fieldValue(form.get("status")),
    userId: fieldValue(form.get("userId")),
  });
}

async function auditDirectory(
  context: Context<AppBindings>,
  events: readonly AdminAuditEvent[],
): Promise<AuditDirectory> {
  const stores = storesForContext(context);
  const userIds = events.flatMap((event) =>
    event.targetUserId === null
      ? [event.actorUserId]
      : [event.actorUserId, event.targetUserId],
  );
  const courseIds = events.flatMap((event) =>
    event.targetCourseId === null ? [] : [event.targetCourseId],
  );
  const [users, courses] = await Promise.all([
    resolveUsers(stores, userIds),
    stores.courses.listByIds(courseIds),
  ]);

  return {
    courseTitles: new Map(courses.map((course) => [course.id, course.title])),
    users,
  };
}

async function dashboardPage(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const url = new URL(context.req.url);
  const dashboard = await adminService(context).getDashboard(actor);

  return renderAdminDashboard(context, {
    auditEvents: dashboard.auditEvents,
    directory: await auditDirectory(context, dashboard.auditEvents),
    saved: url.searchParams.has("saved"),
    stats: dashboard.stats,
  });
}

async function usersPage(context: Context<AppBindings>): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const url = new URL(context.req.url);
  const query = url.searchParams.get("query") ?? "";
  const users = await adminService(context).searchUsers(actor, { query });

  return renderAdminUsers(context, { query, users });
}

async function userProfilePage(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const url = new URL(context.req.url);
  const service = adminService(context);
  const [profile, courses] = await Promise.all([
    service.getUserProfile(actor, requiredParam(context, "userId")),
    service.listAllCourses(actor),
  ]);

  return renderAdminUserProfile(context, {
    courses,
    profile,
    saved: url.searchParams.has("saved"),
  });
}

async function auditPage(context: Context<AppBindings>): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const events = await adminService(context).listAuditEvents(actor, 50);

  return renderAdminAudit(
    context,
    events,
    await auditDirectory(context, events),
  );
}

export const adminRoutes = new Hono<AppBindings>();

adminRoutes.get("/bootstrap", (context) => {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  return renderBootstrap(context);
});

adminRoutes.post("/bootstrap", async (context) => {
  const actor = requireAuthenticated(context);

  try {
    const command = isFormSubmission(context)
      ? {
          bootstrapToken: fieldValue(
            (await context.req.raw.formData()).get("bootstrapToken"),
          ),
        }
      : ((await readJsonObject(context)) as BootstrapBody);
    const grant = await adminService(context).bootstrapSiteAdmin(
      actor,
      {
        bootstrapToken:
          typeof command.bootstrapToken === "string"
            ? command.bootstrapToken
            : null,
      },
      context.env.ADMIN_BOOTSTRAP_TOKEN,
    );

    if (isFormSubmission(context)) {
      return redirect("/admin?saved=1");
    }

    return context.json({ capability: publicCapability(grant) }, 201);
  } catch (error) {
    const i18n = context.get("i18n");

    return formErrorOrThrow(
      context,
      error,
      ADMIN_CHROME,
      i18n.t("Bootstrap failed"),
    );
  }
});

adminRoutes.get("/", async (context) => {
  if (wantsHtml(context)) {
    return dashboardPage(context);
  }

  const actor = requireAuthenticated(context);
  const dashboard = await adminService(context).getDashboard(actor);

  return context.json({ stats: dashboard.stats });
});

adminRoutes.get("/users", async (context) => {
  if (wantsHtml(context)) {
    return usersPage(context);
  }

  const actor = requireAuthenticated(context);
  const url = new URL(context.req.url);
  const query = url.searchParams.get("query") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const users = await adminService(context).searchUsers(actor, {
    limit: Number.isFinite(limit) ? limit : 20,
    query,
  });

  return context.json({ users: users.map(publicUser) });
});

adminRoutes.get("/users/:userId", async (context) => {
  if (wantsHtml(context)) {
    return userProfilePage(context);
  }

  const actor = requireAuthenticated(context);
  const profile = await adminService(context).getUserProfile(
    actor,
    requiredParam(context, "userId"),
  );

  return context.json({ profile: publicProfile(profile) });
});

adminRoutes.post("/users/:userId/capabilities", async (context) => {
  const actor = requireAuthenticated(context);

  try {
    const command = isFormSubmission(context)
      ? capabilityCommandFromForm(await context.req.raw.formData())
      : capabilityCommand((await readJsonObject(context)) as CapabilityBody);
    const grant = await adminService(context).grantCapability(
      actor,
      requiredParam(context, "userId"),
      command,
    );

    if (isFormSubmission(context)) {
      return redirect(`/admin/users/${grant.userId}?saved=1`);
    }

    return context.json({ capability: publicCapability(grant) }, 201);
  } catch (error) {
    const i18n = context.get("i18n");

    return formErrorOrThrow(
      context,
      error,
      ADMIN_CHROME,
      i18n.t("Capability not granted"),
    );
  }
});

adminRoutes.post("/users/:userId/capabilities/revoke", async (context) => {
  const actor = requireAuthenticated(context);

  try {
    const command = isFormSubmission(context)
      ? capabilityCommandFromForm(await context.req.raw.formData())
      : capabilityCommand((await readJsonObject(context)) as CapabilityBody);
    const grant = await adminService(context).revokeCapability(
      actor,
      requiredParam(context, "userId"),
      command,
    );

    if (isFormSubmission(context)) {
      return redirect(`/admin/users/${grant.userId}?saved=1`);
    }

    return context.json({ capability: publicCapability(grant) });
  } catch (error) {
    const i18n = context.get("i18n");

    return formErrorOrThrow(
      context,
      error,
      ADMIN_CHROME,
      i18n.t("Capability not revoked"),
    );
  }
});

adminRoutes.post("/users/:userId/suspend", async (context) => {
  const actor = requireAuthenticated(context);

  try {
    const user = await adminService(context).suspendUser(
      actor,
      requiredParam(context, "userId"),
    );

    if (isFormSubmission(context)) {
      return redirect(`/admin/users/${user.id}?saved=1`);
    }

    return context.json({ user: publicUser(user) });
  } catch (error) {
    const i18n = context.get("i18n");

    return formErrorOrThrow(
      context,
      error,
      ADMIN_CHROME,
      i18n.t("User not suspended"),
    );
  }
});

adminRoutes.post("/users/:userId/reactivate", async (context) => {
  const actor = requireAuthenticated(context);

  try {
    const user = await adminService(context).reactivateUser(
      actor,
      requiredParam(context, "userId"),
    );

    if (isFormSubmission(context)) {
      return redirect(`/admin/users/${user.id}?saved=1`);
    }

    return context.json({ user: publicUser(user) });
  } catch (error) {
    const i18n = context.get("i18n");

    return formErrorOrThrow(
      context,
      error,
      ADMIN_CHROME,
      i18n.t("User not reactivated"),
    );
  }
});

adminRoutes.post("/memberships", async (context) => {
  const actor = requireAuthenticated(context);

  try {
    const command = isFormSubmission(context)
      ? membershipCommandFromForm(await context.req.raw.formData())
      : membershipCommand((await readJsonObject(context)) as MembershipBody);
    const membership = await adminService(context).changeMembership(
      actor,
      command,
    );

    if (isFormSubmission(context)) {
      return redirect(`/admin/users/${membership.userId}?saved=1`);
    }

    return context.json({ membership: publicMembership(membership) });
  } catch (error) {
    const i18n = context.get("i18n");

    return formErrorOrThrow(
      context,
      error,
      ADMIN_CHROME,
      i18n.t("Membership not changed"),
    );
  }
});

adminRoutes.get("/audit", async (context) => {
  if (wantsHtml(context)) {
    return auditPage(context);
  }

  const actor = requireAuthenticated(context);
  const limit = Number(
    new URL(context.req.url).searchParams.get("limit") ?? "50",
  );
  const events = await adminService(context).listAuditEvents(
    actor,
    Number.isFinite(limit) ? limit : 50,
  );

  return context.json({ events: events.map(publicAuditEvent) });
});
