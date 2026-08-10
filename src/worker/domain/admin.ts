import type { Course, CourseMembership } from "./courses";
import type { AppId } from "./ids";
import type { JsonValue } from "./json";
import type { Timestamp } from "./time";
import type { ExternalIdentity, User } from "./users";

export type PlatformCapability =
  | "content_author"
  | "course_creator"
  | "site_admin"
  | "support_operator";

export interface PlatformCapabilityGrant {
  readonly id: AppId;
  readonly userId: AppId;
  readonly capability: PlatformCapability;
  readonly grantedById: AppId | null;
  readonly grantedAt: Timestamp;
  readonly revokedAt: Timestamp | null;
}

export interface AdminAuditEvent {
  readonly id: AppId;
  readonly actorUserId: AppId;
  readonly targetUserId: AppId | null;
  readonly targetCourseId: AppId | null;
  readonly action: string;
  readonly requestId: string;
  readonly metadata: JsonValue;
  readonly createdAt: Timestamp;
}

export interface AdminGlobalStats {
  readonly activeCourses: number;
  readonly assignments: number;
  readonly gradingWork: number;
  readonly submissions: number;
  readonly users: number;
}

export interface AdminUserProfile {
  readonly capabilities: readonly PlatformCapabilityGrant[];
  readonly courses: readonly {
    readonly course: Course;
    readonly membership: CourseMembership;
  }[];
  readonly identities: readonly ExternalIdentity[];
  readonly user: User;
}
