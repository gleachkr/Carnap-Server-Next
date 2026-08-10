import { type Context, Hono } from "hono";

import {
  AdminService,
  type PlatformCapabilityCommand,
  type SupportMembershipCommand,
} from "../application/admin";
import { requireAuthenticated } from "../application/authorization";
import { AppHttpError, badRequest } from "../application/errors";
import type {
  AdminAuditEvent,
  AdminUserProfile,
  PlatformCapabilityGrant,
} from "../domain/admin";
import type { CourseMembership } from "../domain/courses";
import type { User } from "../domain/users";
import type { AppBindings } from "../http";
import { storesForContext } from "../stores";
import {
  renderAdminAudit,
  renderAdminDashboard,
  renderAdminUserProfile,
  renderAdminUsers,
  renderBootstrap,
} from "../web/admin";
import { adminCrumb } from "../web/breadcrumbs";
import { renderFormError } from "../web/errors";
import {
  fieldValue,
  isFormSubmission,
  redirect,
  wantsHtml,
} from "../web/html";
import { resolveUsers, type UserDirectory } from "../web/users";

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

/**
 * On a form submission, render a friendly HTML error page instead of leaking a
 * JSON envelope; JSON API callers re-throw to the global JSON error handler.
 */
function formErrorOrThrow(
  context: Context<AppBindings>,
  error: unknown,
  title: string,
): Response {
  if (error instanceof AppHttpError && isFormSubmission(context)) {
    return renderFormError(context, {
      breadcrumb: [adminCrumb(context.get("i18n"))],
      message: error.localize(context.get("i18n")),
      status: error.status,
      title,
    });
  }

  throw error;
}

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

function auditUserDirectory(
  context: Context<AppBindings>,
  events: readonly AdminAuditEvent[],
): Promise<UserDirectory> {
  const ids = events.flatMap((event) =>
    event.targetUserId === null
      ? [event.actorUserId]
      : [event.actorUserId, event.targetUserId],
  );

  return resolveUsers(context, ids);
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
    directory: await auditUserDirectory(context, dashboard.auditEvents),
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
    await auditUserDirectory(context, events),
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

    return formErrorOrThrow(context, error, i18n.t("Bootstrap failed"));
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

    return formErrorOrThrow(context, error, i18n.t("Capability not granted"));
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

    return formErrorOrThrow(context, error, i18n.t("Capability not revoked"));
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

    return formErrorOrThrow(context, error, i18n.t("User not suspended"));
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

    return formErrorOrThrow(context, error, i18n.t("User not reactivated"));
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

    return formErrorOrThrow(context, error, i18n.t("Membership not changed"));
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
