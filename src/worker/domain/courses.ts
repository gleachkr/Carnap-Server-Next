import type { AppId } from "./ids";
import type { Timestamp } from "./time";

export type CourseRole =
  | "student"
  | "teacher_assistant"
  | "co_instructor"
  | "instructor";
export type MembershipStatus = "active" | "invited" | "suspended" | "dropped";

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
