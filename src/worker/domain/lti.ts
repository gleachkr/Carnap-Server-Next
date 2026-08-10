import type { AppId } from "./ids";
import type { Timestamp } from "./time";

/**
 * A registered LTI 1.3 platform: one (issuer, client_id) pair on an LMS. The
 * endpoints come from the LMS's tool registration screen. These records are
 * plain registration data — JWT claim structures never appear in the domain.
 */
export interface LtiPlatform {
  readonly id: AppId;
  readonly name: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly authorizationEndpoint: string;
  /** Where the AGS client trades its signed assertion for an access token. */
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly disabledAt: Timestamp | null;
}

/**
 * One tool deployment inside a platform. The deployment is the tenant
 * boundary on multi-tenant LMSes, so launches from unregistered deployments
 * are rejected even when the issuer and client match.
 */
export interface LtiDeployment {
  readonly id: AppId;
  readonly platformId: AppId;
  readonly deploymentId: string;
  readonly name: string;
  readonly createdAt: Timestamp;
}

/** A mapping from an LMS course (LTI context) to an Carnap course. */
export interface LtiContext {
  readonly id: AppId;
  readonly deploymentId: AppId;
  readonly contextId: string;
  readonly courseId: AppId;
  readonly createdAt: Timestamp;
}

/**
 * A resource link the platform has launched, mapped to an assignment once an
 * instructor associates it. A null `assignmentId` means "seen but unmapped";
 * such launches land on the course page. The AGS line-item URL is captured
 * when present so milestone 11 grade passback can use it.
 */
export interface LtiResourceLink {
  readonly id: AppId;
  readonly contextId: AppId;
  readonly resourceLinkId: string;
  readonly title: string;
  readonly assignmentId: AppId | null;
  readonly agsLineItemUrl: string | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/**
 * One in-flight OIDC login. The state and nonce values travel through the
 * platform; only their hashes are stored, and consuming the state (a single
 * atomic update) also retires the nonce recorded on the same row.
 */
export interface LtiLoginState {
  readonly stateHash: string;
  readonly nonceHash: string;
  readonly platformId: AppId;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly consumedAt: Timestamp | null;
}

/**
 * One in-flight Deep Linking selection. The platform's return URL and opaque
 * `data` value must round-trip untouched, so they live server-side keyed by a
 * single-use token instead of in tamperable form fields.
 */
export interface LtiDeepLinkRequest {
  readonly tokenHash: string;
  readonly platformId: AppId;
  readonly deploymentId: AppId;
  readonly courseId: AppId;
  readonly userId: AppId;
  readonly returnUrl: string;
  readonly data: string | null;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly consumedAt: Timestamp | null;
}

export type LtiGradeJobStatus = "pending" | "sending" | "complete" | "failed";

/**
 * Why a grade delivery failed, as a stable code rather than a sentence. A
 * failed job is kept until an instructor resolves it and retries, so its reason
 * is read long after it was written — and prose stored at write time can only
 * ever be in the language the Worker happened to be built with. The code is
 * resolved into the reader's language at render time instead.
 *
 * The `lms_*` reasons come from the platform's own responses; the rest are
 * conditions Carnap detects before attempting a delivery at all.
 */
export const LTI_GRADE_FAILURE_REASONS = [
  "assignment_missing",
  "assignment_not_graded",
  "line_item_missing",
  "lms_rejected",
  "lms_token_refused",
  "lms_token_unreadable",
  "lms_unreachable",
  "platform_disabled",
  "platform_missing",
  "resource_link_unlinked",
  "student_unlinked",
  "unexpected",
] as const;

export type LtiGradeFailureReason =
  (typeof LTI_GRADE_FAILURE_REASONS)[number];

/**
 * The grade-passback outbox: one row per (resource link, user) holding the
 * latest score owed to the LMS. A score change re-points the existing row at
 * the new value rather than queueing a second send, so the LMS can never
 * receive a stale score after a fresh one. Completed rows are kept — they
 * record when the LMS last confirmed the score.
 */
export interface LtiGradeJob {
  readonly id: AppId;
  readonly resourceLinkId: AppId;
  readonly userId: AppId;
  readonly score: number;
  readonly maxScore: number;
  /** The score's calculation time; sent as the AGS score timestamp. */
  readonly scoreTimestamp: Timestamp;
  readonly status: LtiGradeJobStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt: Timestamp;
  readonly lastFailureReason: LtiGradeFailureReason | null;
  /**
   * Free text from the platform or the fetch layer for the last failure — a
   * status line, a rejection body. Diagnostic detail shown alongside the
   * reason, never in place of it: it is whatever the LMS said, in whatever
   * language the LMS said it.
   */
  readonly lastErrorDetail: string | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/**
 * A pending request to attach an LTI identity to an existing Carnap account
 * whose email the launch asserted. The link is only created after the account
 * owner clicks the token emailed to that address.
 */
export interface LtiLinkChallenge {
  readonly tokenHash: string;
  readonly platformId: AppId;
  readonly subject: string;
  readonly email: string;
  readonly name: string | null;
  readonly userId: AppId;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly consumedAt: Timestamp | null;
}
