import type { AppId } from "./ids";
import type { Timestamp } from "./time";

export type AssignmentState = "draft" | "published";
export type AssessmentMode = "none" | "practice" | "graded";
export type AssignmentExerciseExcuseStatus = "excused";

export interface Assignment {
  readonly id: AppId;
  readonly courseId: AppId;
  readonly contentRevisionId: AppId;
  readonly title: string;
  readonly description: string;
  readonly state: AssignmentState;
  readonly assessmentMode: AssessmentMode;
  readonly displayOrder: number;
  readonly availableFrom: Timestamp | null;
  readonly dueAt: Timestamp | null;
  readonly availableUntil: Timestamp | null;
  readonly gradesVisibleAt: Timestamp | null;
  readonly listed: boolean;
  readonly maxAttempts: number;
  readonly timeLimitMinutes: number | null;
  readonly createdById: AppId;
  readonly publishedAt: Timestamp | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/**
 * The three ways an author can answer "when do students see their grades?".
 *
 * Not stored, and deliberately so: the assignment keeps only `gradesVisibleAt`,
 * and this is the vocabulary for arriving at it — `immediate` writes the instant
 * the assignment is created, `manual` writes null and leaves it to the release
 * control, `scheduled` writes the timestamp the author gave. It exists because a
 * bare optional timestamp cannot say which of `immediate` and `manual` a blank
 * field meant, and blank silently meant `manual`: no results, no score, ever,
 * until someone came back and released them.
 */
export type GradesVisibility = "immediate" | "manual" | "scheduled";

/**
 * Whether the assignment's grades are visible to students. A null
 * `gradesVisibleAt` means the instructor has not released them at all.
 *
 * Releasing does more than reveal a number: it is also what reopens withheld
 * per-exercise feedback, since an exam has nothing left to protect once the
 * answers are out. See `resolveExerciseFeedback` in `domain/feedback.ts`.
 */
export function gradesReleased(
  assignment: Assignment,
  now: Timestamp,
): boolean {
  return (
    assignment.gradesVisibleAt !== null && assignment.gradesVisibleAt <= now
  );
}

export interface AssignmentContentVersion {
  readonly id: AppId;
  readonly assignmentId: AppId;
  readonly contentRevisionId: AppId;
  readonly effectiveAt: Timestamp;
  readonly actorId: AppId;
  readonly note: string;
}

export interface AssignmentExerciseExcuse {
  readonly id: AppId;
  readonly assignmentId: AppId;
  readonly exerciseId: string;
  readonly status: AssignmentExerciseExcuseStatus;
  readonly actorId: AppId;
  readonly createdAt: Timestamp;
  readonly reason: string;
}

export type LatePolicyKind =
  | "none"
  | "percent_once_after_due"
  | "percent_per_day";

export interface AssignmentLatePolicy {
  readonly assignmentId: AppId;
  readonly kind: LatePolicyKind;
  readonly percentPenalty: number;
  readonly maxPercentPenalty: number;
  readonly graceMinutes: number;
  readonly createdById: AppId;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface AssignmentOverride {
  readonly id: AppId;
  readonly assignmentId: AppId;
  readonly userId: AppId;
  readonly availableFrom: Timestamp | null;
  readonly dueAt: Timestamp | null;
  readonly availableUntil: Timestamp | null;
  readonly maxAttempts: number | null;
  readonly timeLimitMinutes: number | null;
  readonly createdById: AppId;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}
