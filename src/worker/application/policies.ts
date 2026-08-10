import type { Attempt } from "../domain/assessment";
import type { Assignment, AssignmentOverride } from "../domain/assignments";
import type { CourseAccommodation } from "../domain/courses";
import type { Timestamp } from "../domain/time";

export interface PolicyAdjustments {
  readonly accommodation?: CourseAccommodation | null;
  readonly override?: AssignmentOverride | null;
}

export type PolicyAssignment = Pick<
  Assignment,
  | "availableFrom"
  | "availableUntil"
  | "dueAt"
  | "maxAttempts"
  | "state"
  | "timeLimitMinutes"
>;

function addMinutes(
  timestamp: Timestamp | null,
  minutes: number,
): Timestamp | null {
  if (timestamp === null || minutes === 0) {
    return timestamp;
  }

  return new Date(
    new Date(timestamp).getTime() + minutes * 60_000,
  ).toISOString();
}

export function effectivePolicyAssignment(
  assignment: Assignment,
  adjustments: PolicyAdjustments = {},
): PolicyAssignment {
  const accommodation = adjustments.accommodation ?? null;
  const override = adjustments.override ?? null;
  const accommodatedDueAt = addMinutes(
    assignment.dueAt,
    accommodation?.dueAtExtensionMinutes ?? 0,
  );
  const accommodatedUntil = addMinutes(
    assignment.availableUntil,
    accommodation?.availableUntilExtensionMinutes ?? 0,
  );
  const accommodatedMaxAttempts =
    assignment.maxAttempts + (accommodation?.extraAttempts ?? 0);
  const accommodatedTimeLimit =
    assignment.timeLimitMinutes === null
      ? null
      : Math.ceil(
          assignment.timeLimitMinutes *
            (accommodation?.timeLimitMultiplier ?? 1),
        );

  return {
    availableFrom: override?.availableFrom ?? assignment.availableFrom,
    availableUntil: override?.availableUntil ?? accommodatedUntil,
    dueAt: override?.dueAt ?? accommodatedDueAt,
    maxAttempts: override?.maxAttempts ?? accommodatedMaxAttempts,
    state: assignment.state,
    timeLimitMinutes: override?.timeLimitMinutes ?? accommodatedTimeLimit,
  };
}

/**
 * The whole assignment as one student is held to it — {@link
 * effectivePolicyAssignment}'s dates and allowances written back over the
 * assignment they came from.
 *
 * Anything a student is *shown* about their own work should come through here.
 * The assignment row carries the course-wide schedule, and a student with an
 * override or an accommodation is not on it: showing them the row's numbers
 * tells them they have attempts or time that the server will refuse them, and
 * leaves the instructor's own adjustment invisible to the only person it is
 * about. Staff pages keep the raw assignment, which is the thing they edit.
 */
export function assignmentAsAppliedTo(
  assignment: Assignment,
  adjustments: PolicyAdjustments = {},
): Assignment {
  return {
    ...assignment,
    ...effectivePolicyAssignment(assignment, adjustments),
  };
}

export type AssignmentPolicyReason =
  | "active_attempt_exists"
  | "assignment_closed"
  | "assignment_draft"
  | "attempt_limit_reached"
  | "before_available_from";

export type SubmissionPolicyReason =
  | "assignment_closed"
  | "assignment_draft"
  | "attempt_expired"
  | "attempt_not_active"
  | "attempt_submitted"
  | "attempt_voided"
  | "before_available_from";

export interface EffectiveAssignmentPolicy {
  readonly availableFrom: Timestamp | null;
  readonly availableUntil: Timestamp | null;
  readonly canBegin: boolean;
  readonly canView: boolean;
  readonly maxAttempts: number | null;
  readonly reasons: readonly AssignmentPolicyReason[];
  readonly timeLimitMinutes: number | null;
}

export interface AttemptActivity {
  readonly activeAttempt: Attempt | null;
  readonly attemptsUsed: number;
}

export interface EffectiveSubmissionPolicy {
  readonly canSubmit: boolean;
  readonly cutoff: Timestamp | null;
  readonly reasons: readonly SubmissionPolicyReason[];
}

function isActiveAttempt(attempt: Attempt, now: Timestamp): boolean {
  return (
    attempt.status === "active" &&
    (attempt.expiresAt === null || attempt.expiresAt > now)
  );
}

export function attemptActivity(
  attempts: readonly Attempt[],
  now: Timestamp,
): AttemptActivity {
  const activeAttempt = attempts.find((attempt) =>
    isActiveAttempt(attempt, now),
  );
  const attemptsUsed = attempts.filter(
    (attempt) => attempt.status !== "voided",
  ).length;

  return {
    activeAttempt: activeAttempt ?? null,
    attemptsUsed,
  };
}

export function effectiveAssignmentPolicy(
  assignment: PolicyAssignment,
  attempts: readonly Attempt[],
  now: Timestamp,
): EffectiveAssignmentPolicy {
  const reasons: AssignmentPolicyReason[] = [];
  const maxAttempts = assignment.maxAttempts;
  const activity = attemptActivity(attempts, now);

  if (assignment.state !== "published") {
    reasons.push("assignment_draft");
  }

  if (assignment.availableFrom !== null && assignment.availableFrom > now) {
    reasons.push("before_available_from");
  }

  if (
    assignment.availableUntil !== null &&
    assignment.availableUntil <= now
  ) {
    reasons.push("assignment_closed");
  }

  if (activity.activeAttempt !== null) {
    reasons.push("active_attempt_exists");
  }

  if (maxAttempts > 0 && activity.attemptsUsed >= maxAttempts) {
    reasons.push("attempt_limit_reached");
  }

  const availabilityReasons = reasons.filter(
    (reason) =>
      reason !== "attempt_limit_reached" &&
      reason !== "active_attempt_exists",
  );

  return {
    availableFrom: assignment.availableFrom,
    availableUntil: assignment.availableUntil,
    canBegin: reasons.length === 0,
    canView: availabilityReasons.length === 0,
    maxAttempts,
    reasons,
    timeLimitMinutes: assignment.timeLimitMinutes,
  };
}

function earlierTimestamp(
  first: Timestamp | null,
  second: Timestamp | null,
): Timestamp | null {
  if (first === null) {
    return second;
  }

  if (second === null) {
    return first;
  }

  return first <= second ? first : second;
}

export function effectiveSubmissionPolicy(
  assignment: PolicyAssignment,
  attempt: Attempt,
  now: Timestamp,
): EffectiveSubmissionPolicy {
  const reasons: SubmissionPolicyReason[] = [];
  const cutoff = earlierTimestamp(
    assignment.availableUntil,
    attempt.expiresAt,
  );

  if (assignment.state !== "published") {
    reasons.push("assignment_draft");
  }

  if (assignment.availableFrom !== null && assignment.availableFrom > now) {
    reasons.push("before_available_from");
  }

  if (
    assignment.availableUntil !== null &&
    assignment.availableUntil <= now
  ) {
    reasons.push("assignment_closed");
  }

  if (attempt.status === "submitted") {
    reasons.push("attempt_submitted");
  } else if (attempt.status === "voided") {
    reasons.push("attempt_voided");
  } else if (attempt.status === "expired") {
    reasons.push("attempt_expired");
  } else if (attempt.status !== "active") {
    reasons.push("attempt_not_active");
  }

  if (attempt.expiresAt !== null && attempt.expiresAt <= now) {
    reasons.push("attempt_expired");
  }

  return {
    canSubmit: reasons.length === 0,
    cutoff,
    reasons: [...new Set(reasons)],
  };
}

export function expiresAtForTimedAttempt(
  openedAt: Timestamp,
  timeLimitMinutes: number | null,
): Timestamp | null {
  if (timeLimitMinutes === null) {
    return null;
  }

  return new Date(
    new Date(openedAt).getTime() + timeLimitMinutes * 60_000,
  ).toISOString();
}
