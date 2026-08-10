import type { Attempt } from "../domain/assessment";
import type { Assignment } from "../domain/assignments";
import type { AppId } from "../domain/ids";
import { createAppId } from "../domain/ids";
import { timestampNow } from "../domain/time";
import { deferred } from "../i18n/deferred";
import type { AuthenticatedActor } from "./auth";
import { requireCourseRole, requireCourseStaff } from "./authorization";
import { AppHttpError, forbidden } from "./errors";
import {
  attemptActivity,
  effectiveAssignmentPolicy,
  effectivePolicyAssignment,
  expiresAtForTimedAttempt,
} from "./policies";
import type { AppStores } from "./stores";

export interface AttemptServiceOptions {
  readonly now?: () => Date;
  readonly stores: AppStores;
}

export interface AttemptBeginResult {
  readonly attempt: Attempt;
  readonly policy: ReturnType<typeof effectiveAssignmentPolicy>;
}

export interface AttemptResetResult {
  readonly newAttempt: Attempt;
  readonly voidedAttempt: Attempt;
}

function assignmentNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "assignment_not_found",
    deferred.i18n.t("The assignment was not found."),
  );
}

function attemptNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "attempt_not_found",
    deferred.i18n.t("The attempt was not found."),
  );
}

function assignmentNotGraded(): AppHttpError {
  return new AppHttpError(
    403,
    "assignment_not_graded",
    deferred.i18n.t("Attempts can only be started for graded assignments."),
  );
}

function beginDenied(reason: string): AppHttpError {
  return new AppHttpError(
    403,
    reason,
    deferred.i18n.t("A new attempt cannot be started for this assignment."),
  );
}

export class AttemptService {
  constructor(private readonly options: AttemptServiceOptions) {}

  async begin(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
  ): Promise<AttemptBeginResult> {
    await requireCourseRole(this.options.stores, actor, courseId, ["member"]);

    const assignment = await this.assignmentInCourse(courseId, assignmentId);

    if (assignment.assessmentMode !== "graded") {
      throw assignmentNotGraded();
    }

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);

    await this.options.stores.assessment.expireOpenAttempts(
      assignment.id,
      actor.user.id,
      now,
    );

    const attempts =
      await this.options.stores.assessment.listAttemptsForAssignmentUser(
        assignment.id,
        actor.user.id,
      );
    const effective = await this.effectiveAssignmentForUser(
      assignment,
      actor.user.id,
    );
    const policy = effectiveAssignmentPolicy(effective, attempts, now);

    if (!policy.canBegin) {
      throw beginDenied(policy.reasons[0] ?? "attempt_begin_denied");
    }

    const attempt = await this.options.stores.assessment.beginAttempt({
      assignmentId: assignment.id,
      createdFrom: "student",
      expiresAt: expiresAtForTimedAttempt(now, effective.timeLimitMinutes),
      id: createAppId(nowDate.getTime()),
      maxAttempts: effective.maxAttempts,
      openedAt: now,
      userId: actor.user.id,
    });

    if (attempt === null) {
      throw beginDenied("attempt_limit_reached");
    }

    return { attempt, policy };
  }

  /**
   * The open attempt a practice assignment collects work into, creating one if
   * the student has none yet. Practice has no begin-attempt ceremony: the
   * exercises are interactive inline, so the detail page ensures a single
   * perpetual attempt (no time limit, unlimited resubmission — best-of scoring
   * keeps the highest per exercise).
   *
   * Returns null for every other mode, or when the assignment is not currently
   * available to the student. A graded assignment uses {@link begin} instead. A
   * reading has no assessment at all — that is what the mode means — so it gets
   * no attempt to collect work into, and its inline exercises stay interactive
   * but unrecorded, the way an author's preview is.
   */
  async ensureOpenAttempt(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
  ): Promise<Attempt | null> {
    await requireCourseRole(this.options.stores, actor, courseId, ["member"]);

    const assignment = await this.assignmentInCourse(courseId, assignmentId);

    if (assignment.assessmentMode !== "practice") {
      return null;
    }

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    const attempts =
      await this.options.stores.assessment.listAttemptsForAssignmentUser(
        assignment.id,
        actor.user.id,
      );
    const activity = attemptActivity(attempts, now);

    if (activity.activeAttempt !== null) {
      return activity.activeAttempt;
    }

    const effective = await this.effectiveAssignmentForUser(
      assignment,
      actor.user.id,
    );
    const policy = effectiveAssignmentPolicy(effective, attempts, now);

    if (!policy.canView) {
      return null;
    }

    return this.options.stores.assessment.beginAttempt({
      assignmentId: assignment.id,
      createdFrom: "student",
      expiresAt: null,
      id: createAppId(nowDate.getTime()),
      maxAttempts: null,
      openedAt: now,
      userId: actor.user.id,
    });
  }

  async listForStudent(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
  ): Promise<Attempt[]> {
    await requireCourseRole(this.options.stores, actor, courseId, ["member"]);

    const assignment = await this.assignmentInCourse(courseId, assignmentId);

    if (assignment.assessmentMode !== "graded") {
      return [];
    }

    const now = timestampNow(this.options.now?.() ?? new Date());

    await this.options.stores.assessment.expireOpenAttempts(
      assignment.id,
      actor.user.id,
      now,
    );

    return this.options.stores.assessment.listAttemptsForAssignmentUser(
      assignment.id,
      actor.user.id,
    );
  }

  async listForInstructor(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
  ): Promise<Attempt[]> {
    await requireCourseStaff(this.options.stores, actor, courseId);

    const assignment = await this.assignmentInCourse(courseId, assignmentId);

    if (assignment.assessmentMode !== "graded") {
      return [];
    }

    const now = timestampNow(this.options.now?.() ?? new Date());

    await this.expireAllOpenAttempts(assignment, now);

    return this.options.stores.assessment.listAttemptsForAssignment(
      assignment.id,
    );
  }

  async reset(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    attemptId: AppId,
  ): Promise<AttemptResetResult> {
    await requireCourseStaff(this.options.stores, actor, courseId);

    const assignment = await this.assignmentInCourse(courseId, assignmentId);

    if (assignment.assessmentMode !== "graded") {
      throw assignmentNotGraded();
    }

    const oldAttempt =
      await this.options.stores.assessment.getAttempt(attemptId);

    if (oldAttempt === null || oldAttempt.assignmentId !== assignment.id) {
      throw attemptNotFound();
    }

    if (oldAttempt.status === "voided") {
      throw forbidden("attempt_already_voided");
    }

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    const effective = await this.effectiveAssignmentForUser(
      assignment,
      oldAttempt.userId,
    );
    const reset = await this.options.stores.assessment.resetAttempt({
      assignmentId: assignment.id,
      expiresAt: expiresAtForTimedAttempt(now, effective.timeLimitMinutes),
      newAttemptId: createAppId(nowDate.getTime()),
      oldAttemptId: oldAttempt.id,
      openedAt: now,
      userId: oldAttempt.userId,
      voidedAt: now,
      voidedById: actor.user.id,
    });

    if (reset === null) {
      throw attemptNotFound();
    }

    return reset;
  }

  private async effectiveAssignmentForUser(
    assignment: Assignment,
    userId: AppId,
  ) {
    const [accommodation, override] = await Promise.all([
      this.options.stores.courses.getAccommodation(
        assignment.courseId,
        userId,
      ),
      this.options.stores.assignments.getOverrideForAssignmentUser(
        assignment.id,
        userId,
      ),
    ]);

    return effectivePolicyAssignment(assignment, {
      accommodation,
      override,
    });
  }

  private async assignmentInCourse(
    courseId: AppId,
    assignmentId: AppId,
  ): Promise<Assignment> {
    const assignment =
      await this.options.stores.assignments.getById(assignmentId);

    if (assignment === null || assignment.courseId !== courseId) {
      throw assignmentNotFound();
    }

    return assignment;
  }

  private async expireAllOpenAttempts(
    assignment: Assignment,
    now: string,
  ): Promise<void> {
    const attempts =
      await this.options.stores.assessment.listAttemptsForAssignment(
        assignment.id,
      );
    const userIds = new Set(
      attempts
        .filter((attempt) => attempt.status === "active")
        .map((attempt) => attempt.userId),
    );

    await Promise.all(
      [...userIds].map((userId) =>
        this.options.stores.assessment.expireOpenAttempts(
          assignment.id,
          userId,
          now,
        ),
      ),
    );
  }
}
