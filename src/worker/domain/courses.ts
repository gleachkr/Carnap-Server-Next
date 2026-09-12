import type { AppId } from "./ids";
import type { Timestamp } from "./time";

export type CourseRole =
  | "student"
  | "teacher_assistant"
  | "co_instructor"
  | "instructor";
export type MembershipStatus = "active" | "invited" | "suspended" | "dropped";

/**
 * The two tiers of course staff, as the pages tell them apart. Instructors and
 * co-instructors manage the course — settings, roster, assignments — and the
 * code never distinguishes the two. A teaching assistant grades: the review
 * queue, the gradebooks, attempt resets, and nothing that changes what the
 * course is. Every "is this person staff?" question a page asks reduces to
 * which tier, or neither, so it is answered once here.
 */
export type CourseStaffTier = "instructor" | "assistant";

export function courseStaffTier(role: CourseRole): CourseStaffTier | null {
  switch (role) {
    case "co_instructor":
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
