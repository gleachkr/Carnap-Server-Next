import type { Context } from "hono";
import type { PlatformCapability } from "../domain/admin";
import type { CourseMembership, CourseRole } from "../domain/courses";
import type { AppId } from "../domain/ids";
import type { AppBindings } from "../http";
import { forbidden, unauthorized } from "./errors";
import type { AppStores } from "./stores";

export type RequiredCourseRole = CourseRole | "member";

export function requireAuthenticated(
  context: Context<AppBindings>,
): NonNullable<AppBindings["Variables"]["actor"]> {
  const failure = context.get("authFailure");

  if (failure === "disabled_user") {
    throw forbidden("disabled_user");
  }

  const actor = context.get("actor");

  if (actor === null) {
    throw unauthorized();
  }

  return actor;
}

export async function requireCourseRole(
  stores: AppStores,
  actor: NonNullable<AppBindings["Variables"]["actor"]>,
  courseId: AppId,
  allowedRoles: readonly RequiredCourseRole[],
): Promise<CourseMembership> {
  const membership = await stores.courses.getMembership(
    courseId,
    actor.user.id,
  );

  if (membership === null || membership.status !== "active") {
    throw forbidden("course_role_required");
  }

  if (allowedRoles.includes("member")) {
    return membership;
  }

  if (!allowedRoles.includes(membership.role)) {
    throw forbidden("course_role_required");
  }

  return membership;
}

export async function requireInstructor(
  stores: AppStores,
  actor: NonNullable<AppBindings["Variables"]["actor"]>,
  courseId: AppId,
): Promise<CourseMembership> {
  return requireCourseRole(stores, actor, courseId, [
    "co_instructor",
    "instructor",
  ]);
}

export async function requireCourseStaff(
  stores: AppStores,
  actor: NonNullable<AppBindings["Variables"]["actor"]>,
  courseId: AppId,
): Promise<CourseMembership> {
  return requireCourseRole(stores, actor, courseId, [
    "co_instructor",
    "instructor",
    "teacher_assistant",
  ]);
}

export function hasPlatformCapability(
  actor: NonNullable<AppBindings["Variables"]["actor"]>,
  capability: PlatformCapability,
): boolean {
  return actor.capabilities.some(
    (grant) => grant.capability === capability && grant.revokedAt === null,
  );
}

export function hasAnyPlatformCapability(
  actor: NonNullable<AppBindings["Variables"]["actor"]>,
  capabilities: readonly PlatformCapability[],
): boolean {
  return capabilities.some((capability) =>
    hasPlatformCapability(actor, capability),
  );
}

export function requirePlatformCapability(
  actor: NonNullable<AppBindings["Variables"]["actor"]>,
  capabilities: readonly PlatformCapability[],
): void {
  if (!hasAnyPlatformCapability(actor, capabilities)) {
    throw forbidden("platform_capability_required");
  }
}

/**
 * Whether the actor may write content: create an item, or save a revision into
 * one.
 *
 * Two arms rather than a capability alone. The grant is the deliberate route —
 * an administrator naming an author who has no course of their own. The
 * membership is the automatic one, and it is what keeps the platform usable:
 * an instructor arriving through an LTI launch is handed a course by their LMS
 * and never passes through the admin screen at all, so a capability-only rule
 * would leave them unable to write a lesson for the course they are already
 * teaching.
 *
 * Students hold neither, which is the point — writing content, and in
 * particular uploading a file, is not something the least trusted accounts on
 * the platform should fall into by default.
 */
export function canAuthorContent(
  actor: NonNullable<AppBindings["Variables"]["actor"]>,
): boolean {
  return (
    actor.isCourseStaff ||
    hasAnyPlatformCapability(actor, ["content_author", "site_admin"])
  );
}

export function requireContentAuthor(
  actor: NonNullable<AppBindings["Variables"]["actor"]>,
): void {
  if (!canAuthorContent(actor)) {
    throw forbidden("content_author_required");
  }
}
