import type { AppId } from "./ids";
import type { Timestamp } from "./time";

/** The roles a course membership can carry, least to most privileged. */
export const COURSE_ROLES = [
  "student",
  "teacher_assistant",
  "instructor",
] as const;
export type CourseRole = (typeof COURSE_ROLES)[number];

export const MEMBERSHIP_STATUSES = [
  "active",
  "invited",
  "suspended",
  "dropped",
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export function isCourseRole(value: string): value is CourseRole {
  return (COURSE_ROLES as readonly string[]).includes(value);
}

export function isMembershipStatus(value: string): value is MembershipStatus {
  return (MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}

/**
 * The two tiers of course staff, as the pages tell them apart. An instructor
 * manages the course — settings, roster, assignments; there can be several,
 * and the course's creator is one of them. A teaching assistant grades: the review
 * queue, the gradebooks, attempt resets, and nothing that changes what the
 * course is. Every "is this person staff?" question a page asks reduces to
 * which tier, or neither, so it is answered once here.
 */
export type CourseStaffTier = "instructor" | "assistant";

export function courseStaffTier(role: CourseRole): CourseStaffTier | null {
  switch (role) {
    case "instructor":
      return "instructor";
    case "teacher_assistant":
      return "assistant";
    case "student":
      return null;
  }
}

export interface Course {
  readonly id: AppId;
  readonly title: string;
  readonly timezone: string;
  readonly createdById: AppId;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt: Timestamp | null;
}

export interface CourseMembership {
  readonly id: AppId;
  readonly courseId: AppId;
  readonly userId: AppId;
  readonly role: CourseRole;
  readonly status: MembershipStatus;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface CourseEnrollmentLink {
  readonly id: AppId;
  readonly courseId: AppId;
  readonly tokenHash: string;
  readonly createdById: AppId;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly revokedAt: Timestamp | null;
}

export interface CourseAccommodation {
  readonly id: AppId;
  readonly courseId: AppId;
  readonly userId: AppId;
  readonly extraAttempts: number;
  readonly timeLimitMultiplier: number;
  readonly dueAtExtensionMinutes: number;
  readonly availableUntilExtensionMinutes: number;
  readonly createdById: AppId;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}
