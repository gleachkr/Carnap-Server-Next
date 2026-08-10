import type { Evaluation, Submission } from "../domain/assessment";
import type { Assignment } from "../domain/assignments";
import type { AppId } from "../domain/ids";
import { createAppId } from "../domain/ids";
import { assertJsonValue, type JsonValue } from "../domain/json";
import { timestampNow } from "../domain/time";
import { deferred } from "../i18n/deferred";
import type { AuthenticatedActor } from "./auth";
import { requireCourseStaff } from "./authorization";
import { AppHttpError, badRequest } from "./errors";
import { GradebookService } from "./gradebook";
import type { AppStores } from "./stores";

export interface ManualGradingServiceOptions {
  readonly now?: () => Date;
  readonly stores: AppStores;
}

export interface ManualEvaluationCommand {
  readonly feedback?: JsonValue | null;
  readonly maxScore: number;
  readonly score: number;
}

export interface ManualEvaluationResult {
  readonly evaluation: Evaluation;
  readonly submission: Submission;
}

function assignmentNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "assignment_not_found",
    deferred.i18n.t("The assignment was not found."),
  );
}

/**
 * Hand grading follows the work, not the grade. A practice set collects real
 * answers — a free response, a proof an autograder scored zero on a technicality
 * — and an instructor reading them has the same reasons to write back and to
 * correct a score as on a graded assignment. What practice does not do with the
 * result is count it toward the course total or send it to an LMS, and neither
 * of those is decided here.
 *
 * A reading is refused. It takes no submissions at all, so there is nothing to
 * grade and this is unreachable through the UI; it stays as the honest answer
 * for anything that finds the route another way.
 */
function assignmentNotScored(): AppHttpError {
  return new AppHttpError(
    403,
    "assignment_not_scored",
    deferred.i18n.t("A reading records no work to grade."),
  );
}

function submissionNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "submission_not_found",
    deferred.i18n.t("The submission was not found."),
  );
}

function assertScore(command: ManualEvaluationCommand): void {
  if (!Number.isFinite(command.score) || command.score < 0) {
    throw badRequest(
      "invalid_score",
      deferred.i18n.t("Score must be zero or greater."),
    );
  }

  if (!Number.isFinite(command.maxScore) || command.maxScore < 0) {
    throw badRequest(
      "invalid_max_score",
      deferred.i18n.t("Max score must be zero or greater."),
    );
  }
}

export class ManualGradingService {
  constructor(private readonly options: ManualGradingServiceOptions) {}

  async evaluateSubmission(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    submissionId: AppId,
    command: ManualEvaluationCommand,
  ): Promise<ManualEvaluationResult> {
    await requireCourseStaff(this.options.stores, actor, courseId);
    assertScore(command);

    const { assignment, submission } = await this.gradableSubmission(
      courseId,
      assignmentId,
      submissionId,
    );
    const feedback = command.feedback ?? null;

    assertJsonValue(feedback);

    return this.appendManualEvaluation(assignment, submission, {
      feedback,
      gradedById: actor.user.id,
      maxScore: command.maxScore,
      score: command.score,
    });
  }

  /**
   * Sign off on a submission's autograded score in one click: record a manual
   * evaluation that copies the current effective automatic score, so the
   * submission counts as reviewed and its verdict is an instructor's, not just
   * the checker's. A submission with no autograded score to stand behind (a
   * free-response awaiting a grade) cannot be approved this way — there is
   * nothing to approve; and one already carrying a manual evaluation is
   * returned unchanged rather than stamped twice.
   */
  async approveAutomaticScore(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    submissionId: AppId,
  ): Promise<ManualEvaluationResult> {
    await requireCourseStaff(this.options.stores, actor, courseId);

    const { assignment, submission } = await this.gradableSubmission(
      courseId,
      assignmentId,
      submissionId,
    );

    const evaluations =
      await this.options.stores.assessment.listEvaluationsForSubmission(
        submission.id,
      );
    const live = evaluations.filter(
      (evaluation) => evaluation.voidedAt === null,
    );
    const existingManual = live.find(
      (evaluation) => evaluation.evaluatorKind === "manual",
    );

    if (existingManual !== undefined) {
      return { evaluation: existingManual, submission };
    }

    const automatic = live
      .filter((evaluation) => evaluation.evaluatorKind === "automatic")
      .reduce<(typeof live)[number] | undefined>((best, evaluation) => {
        if (best === undefined || evaluation.score > best.score) {
          return evaluation;
        }

        return best;
      }, undefined);

    if (automatic === undefined) {
      throw badRequest(
        "no_automatic_score",
        deferred.i18n.t(
          "There is no autograded score to approve on this submission.",
        ),
      );
    }

    return this.appendManualEvaluation(assignment, submission, {
      feedback: null,
      gradedById: actor.user.id,
      maxScore: automatic.maxScore,
      score: automatic.score,
    });
  }

  private async gradableSubmission(
    courseId: AppId,
    assignmentId: AppId,
    submissionId: AppId,
  ): Promise<{
    readonly assignment: Assignment;
    readonly submission: Submission;
  }> {
    const assignment = await this.assignmentInCourse(courseId, assignmentId);

    if (assignment.assessmentMode === "none") {
      throw assignmentNotScored();
    }

    const submission =
      await this.options.stores.assessment.getSubmission(submissionId);

    if (submission === null) {
      throw submissionNotFound();
    }

    const attempt = await this.options.stores.assessment.getAttempt(
      submission.attemptId,
    );

    if (attempt === null || attempt.assignmentId !== assignment.id) {
      throw submissionNotFound();
    }

    return { assignment, submission };
  }

  private async appendManualEvaluation(
    assignment: Assignment,
    submission: Submission,
    input: {
      readonly feedback: JsonValue | null;
      readonly gradedById: AppId;
      readonly maxScore: number;
      readonly score: number;
    },
  ): Promise<ManualEvaluationResult> {
    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);

    const evaluation = await this.options.stores.assessment.appendEvaluation({
      checkerVersion: null,
      createdAt: now,
      evaluatorKind: "manual",
      id: createAppId(nowDate.getTime()),
      maxScore: input.maxScore,
      result: {
        feedback: input.feedback,
        gradedById: input.gradedById,
        kind: "manual-evaluation@1",
      },
      score: input.score,
      submissionId: submission.id,
    });

    await new GradebookService({
      now: this.options.now,
      stores: this.options.stores,
    }).refreshStudentAssignmentScore(assignment, submission.userId);

    return { evaluation, submission };
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
}
