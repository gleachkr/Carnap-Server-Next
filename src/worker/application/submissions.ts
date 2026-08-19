import type {
  AttemptStatus,
  Evaluation,
  Submission,
  ViewerEvaluation,
} from "../domain/assessment";
import type { Assignment } from "../domain/assignments";
import type {
  AnswerEnvelope,
  AutomaticEvaluationStatus,
  ExerciseAnswerReview,
  ExerciseManifestItem,
  ExerciseReviewAudience,
  NormalizedAnswer,
} from "../domain/content";
import {
  exerciseScoreVisible,
  gradesWithheld,
  resolveExerciseExam,
  studentEvaluation,
  verdictSealed,
  viewerEvaluation,
} from "../domain/feedback";
import type { AppId } from "../domain/ids";
import { createAppId } from "../domain/ids";
import { assertJsonValue, type JsonValue } from "../domain/json";
import { type Timestamp, timestampNow } from "../domain/time";
import { deferred } from "../i18n/deferred";
import type { Translator } from "../i18n/translator";
import type { AuthenticatedActor } from "./auth";
import { requireCourseRole, requireCourseStaff } from "./authorization";
import { contentArtifactFromRevision } from "./content/artifact";
import {
  type AssessmentExerciseRegistry,
  createDefaultExerciseKindRegistry,
} from "./content/registry";
import { AppHttpError, badRequest } from "./errors";
import { GradebookService } from "./gradebook";
import {
  effectivePolicyAssignment,
  effectiveSubmissionPolicy,
} from "./policies";
import type { AppStores } from "./stores";

export interface SubmissionServiceOptions {
  readonly exerciseRegistry?: AssessmentExerciseRegistry;
  readonly now?: () => Date;
  readonly stores: AppStores;
}

export interface SubmitAnswerCommand {
  readonly answer: AnswerEnvelope;
  readonly exerciseId: string;
  readonly idempotencyKey: string | null;
}

export interface SubmissionResult {
  readonly evaluation: ViewerEvaluation | null;
  readonly idempotent: boolean;
  readonly policy: ReturnType<typeof effectiveSubmissionPolicy>;
  readonly recorded: true;
  readonly submission: Submission;
}

/**
 * The outcome of an autograded answer that was checked but not stored:
 * outside exam exercises, only fully correct work is recorded, so the
 * student is free to keep working until the checker accepts it.
 */
export interface SubmissionCheckResult {
  /**
   * What the checker made of the work it then threw away — absent where the
   * exercise says nothing, since the refusal is the whole message there.
   *
   * The numbers travel with the same seal as a recorded evaluation's: they are
   * a grade whichever branch produced them, and this branch used to be reached
   * only when nothing was being withheld, so it had never had to be careful.
   */
  readonly check?: {
    readonly maxScore: number | null;
    readonly score: number | null;
    readonly status: AutomaticEvaluationStatus;
  };
  readonly policy: ReturnType<typeof effectiveSubmissionPolicy>;
  readonly recorded: false;
}

export type SubmitAnswerResult = SubmissionResult | SubmissionCheckResult;

export interface SubmissionHistoryEntry {
  readonly attemptId: AppId;
  readonly answerReview: ExerciseAnswerReview | null;
  readonly evaluation: ViewerEvaluation | null;
  /**
   * What the exercise is worth, as its author declared it — what a hand grade
   * is out of unless the grader says otherwise. Null where the exercise is no
   * longer in the assignment's content, which is the one case nothing can
   * answer it.
   */
  readonly nominalPoints: number | null;
  readonly submission: Submission;
}

export interface StudentAttemptResult {
  readonly entries: readonly SubmissionHistoryEntry[];
  readonly ordinal: number;
  readonly status: AttemptStatus;
}

export interface StudentAssignmentResults {
  readonly attempts: readonly StudentAttemptResult[];
  readonly released: boolean;
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

function contentRevisionNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "content_revision_not_found",
    deferred.i18n.t("The content revision was not found."),
  );
}

function exerciseNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "exercise_not_found",
    deferred.i18n.t("The exercise was not found in this assignment."),
  );
}

function submitDenied(reason: string): AppHttpError {
  return new AppHttpError(
    403,
    reason,
    deferred.i18n.t("A submission cannot be accepted for this attempt."),
  );
}

/**
 * A reading records nothing — no attempts, no submissions, no evaluations, no
 * scores. Its exercises are still fully interactive and still check themselves
 * locally; they simply have nowhere to submit to.
 *
 * The route already withholds the form (there is no attempt to address it to),
 * so this guards the pipeline itself: an attempt id left over from before the
 * item was a reading must not become a way to write work into one.
 */
function assignmentNotAssessed(): AppHttpError {
  return new AppHttpError(
    403,
    "assignment_not_assessed",
    deferred.i18n.t("This item does not record work."),
  );
}

function normalizeIdempotencyKey(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    return null;
  }

  if (normalized.length > 200) {
    throw badRequest(
      "invalid_idempotency_key",
      deferred.i18n.t("Idempotency keys must be 200 characters or fewer."),
    );
  }

  return normalized;
}

function automaticResult(value: unknown): JsonValue {
  assertJsonValue(value);

  return value;
}

/**
 * The evaluation a student should see for a submission: the latest manual grade
 * if one exists (it carries the instructor's comment and overrides), otherwise
 * the highest-scoring automatic evaluation. Voided evaluations are ignored. This
 * mirrors the gradebook's per-exercise selection so the results page agrees with
 * the recorded score.
 */
function effectiveEvaluation(
  evaluations: readonly Evaluation[],
): Evaluation | null {
  const live = evaluations.filter(
    (evaluation) => evaluation.voidedAt === null,
  );
  const manual = live
    .filter((evaluation) => evaluation.evaluatorKind === "manual")
    .sort((left, right) =>
      `${right.createdAt} ${right.id}`.localeCompare(
        `${left.createdAt} ${left.id}`,
      ),
    )[0];

  if (manual !== undefined) {
    return manual;
  }

  return live.reduce<Evaluation | null>((best, evaluation) => {
    if (best === null || evaluation.score > best.score) {
      return evaluation;
    }

    if (
      evaluation.score === best.score &&
      evaluation.createdAt > best.createdAt
    ) {
      return evaluation;
    }

    return best;
  }, null);
}

export class SubmissionService {
  private readonly exerciseRegistry: AssessmentExerciseRegistry;

  constructor(private readonly options: SubmissionServiceOptions) {
    this.exerciseRegistry =
      options.exerciseRegistry ?? createDefaultExerciseKindRegistry();
  }

  async submit(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    attemptId: AppId,
    command: SubmitAnswerCommand,
  ): Promise<SubmitAnswerResult> {
    await requireCourseRole(this.options.stores, actor, courseId, ["member"]);

    const assignment = await this.assignmentInCourse(courseId, assignmentId);

    if (assignment.assessmentMode === "none") {
      throw assignmentNotAssessed();
    }

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);

    await this.options.stores.assessment.expireOpenAttempts(
      assignment.id,
      actor.user.id,
      now,
    );

    const attempt =
      await this.options.stores.assessment.getAttempt(attemptId);

    if (
      attempt === null ||
      attempt.assignmentId !== assignment.id ||
      attempt.userId !== actor.user.id
    ) {
      throw attemptNotFound();
    }

    const idempotencyKey = normalizeIdempotencyKey(command.idempotencyKey);
    const existing = await this.findIdempotentSubmission(
      attempt.id,
      idempotencyKey,
    );
    const policy = effectiveSubmissionPolicy(
      await this.effectiveAssignmentForUser(assignment, actor.user.id),
      attempt,
      now,
    );

    if (existing !== null) {
      await this.refreshScore(assignment, actor.user.id);

      const declarations = await this.declarationsForAssignment(assignment);
      const replayedDeclaration =
        existing.submission.exerciseId === null
          ? undefined
          : declarations.get(existing.submission.exerciseId);

      return {
        ...existing,
        evaluation: studentEvaluation(
          existing.evaluation,
          replayedDeclaration,
          assignment,
          now,
        ),
        idempotent: true,
        policy,
        recorded: true,
      };
    }

    if (!policy.canSubmit) {
      throw submitDenied(policy.reasons[0] ?? "submission_denied");
    }

    const revision = await this.options.stores.content.getRevision(
      assignment.contentRevisionId,
    );

    if (revision === null) {
      throw contentRevisionNotFound();
    }

    const artifact = contentArtifactFromRevision(revision);
    const declaration = artifact.manifest.find(
      (item) => item.id === command.exerciseId,
    );

    if (declaration === undefined) {
      throw exerciseNotFound();
    }

    const normalized = this.exerciseRegistry.normalizeAnswer(
      declaration,
      command.answer,
    );

    if (!normalized.ok) {
      throw badRequest(
        "invalid_answer",
        deferred.i18n.t("The answer is invalid."),
      );
    }

    const automatic = await this.exerciseRegistry.evaluateAutomatic(
      declaration,
      normalized.answer,
      { actorId: actor.user.id, now },
    );

    // Outside exam exercises, autograded work only counts once it is fully
    // correct: anything less is checked and refused, never stored, so students
    // keep working and instructors never review wrong tries. Manual-review
    // kinds (automatic === null) always record — there is nothing to check
    // them against.
    //
    // One condition, and it is `exam`. This used to also record whenever the
    // verdict was sealed, on the reasoning that refusing the work *and* saying
    // nothing leaves a student with no signal at all. It does not: the refusal
    // is itself the signal, and the runtime says so in as many words. Keeping
    // the extra condition meant a sealed exercise recorded whatever `exam`
    // said, which is a default quietly overruling something an author wrote.
    if (
      automatic !== null &&
      automatic.status !== "correct" &&
      !resolveExerciseExam(declaration, assignment, now)
    ) {
      const numbers = exerciseScoreVisible(declaration, assignment, now);

      return {
        // Sealed, the refusal travels alone: `recorded: false` is the only
        // thing a student is owed here, and the runtime says it in words.
        ...(this.evaluationSealed(assignment, declaration, now)
          ? {}
          : {
              check: {
                maxScore: numbers ? automatic.nominalMaxScore : null,
                score: numbers ? automatic.awardedScore : null,
                status: automatic.status,
              },
            }),
        policy,
        recorded: false,
      };
    }

    const submissionId = createAppId(nowDate.getTime());
    const submissionInput = {
      answer: normalized.answer.data,
      answerKind: normalized.answer.kind,
      attemptId: attempt.id,
      contentRevisionId: revision.id,
      declarationHash: declaration.declarationHash,
      exerciseId: declaration.id,
      id: submissionId,
      idempotencyKey,
      submittedAt: now,
      userId: actor.user.id,
    };

    if (automatic === null) {
      const submission =
        await this.options.stores.assessment.appendSubmission(
          submissionInput,
        );

      await this.refreshScore(assignment, actor.user.id);

      return {
        evaluation: null,
        idempotent: false,
        policy,
        recorded: true,
        submission,
      };
    }

    const evaluationId = createAppId(nowDate.getTime());
    const result = automaticResult({
      ...automatic,
      answerKind: normalized.answer.kind,
      contentRevisionId: revision.id,
      exerciseId: declaration.id,
    });
    const created =
      await this.options.stores.assessment.appendSubmissionWithEvaluation(
        submissionInput,
        {
          checkerVersion: automatic.evaluatorVersion,
          createdAt: now,
          evaluatorKind: "automatic",
          id: evaluationId,
          maxScore: automatic.nominalMaxScore,
          result,
          score: automatic.awardedScore,
          submissionId,
        },
      );

    await this.refreshScore(assignment, actor.user.id);

    return {
      ...created,
      evaluation: studentEvaluation(
        created.evaluation,
        declaration,
        assignment,
        now,
      ),
      idempotent: false,
      policy,
      recorded: true,
    };
  }

  async listForStudentAttempt(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    attemptId: AppId,
    i18n: Translator,
  ): Promise<SubmissionHistoryEntry[]> {
    await requireCourseRole(this.options.stores, actor, courseId, ["member"]);

    const assignment = await this.assignmentInCourse(courseId, assignmentId);

    const attempt =
      await this.options.stores.assessment.getAttempt(attemptId);

    if (
      attempt === null ||
      attempt.assignmentId !== assignment.id ||
      attempt.userId !== actor.user.id
    ) {
      throw attemptNotFound();
    }

    return this.historyForAttempt(attempt.id, "student", i18n);
  }

  async listResultsForStudent(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    i18n: Translator,
  ): Promise<StudentAssignmentResults> {
    await requireCourseRole(this.options.stores, actor, courseId, ["member"]);

    const assignment = await this.assignmentInCourse(courseId, assignmentId);

    const now = timestampNow(this.options.now?.() ?? new Date());

    // The page used to be empty until grades were released, which meant a
    // student could be getting live feedback in the widget and find nothing at
    // all in their own history. What release actually holds is the numbers, and
    // `historyForAttempt` withholds those per exercise; the work itself is
    // theirs to read back either way. `released` is what the view uses to say
    // the grades are still to come.
    const released = !gradesWithheld(assignment, now);

    const attempts = (
      await this.options.stores.assessment.listAttemptsForAssignmentUser(
        assignment.id,
        actor.user.id,
      )
    )
      .filter((attempt) => attempt.status !== "voided")
      .sort((left, right) => left.ordinal - right.ordinal);

    const results = await Promise.all(
      attempts.map(async (attempt) => ({
        entries: await this.historyForAttempt(
          attempt.id,
          "student",
          i18n,
          true,
        ),
        ordinal: attempt.ordinal,
        status: attempt.status,
      })),
    );

    return { attempts: results, released };
  }

  async listForInstructorAssignment(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    i18n: Translator,
  ): Promise<SubmissionHistoryEntry[]> {
    await requireCourseStaff(this.options.stores, actor, courseId);

    const assignment = await this.assignmentInCourse(courseId, assignmentId);
    // Every mode that collects work is listed, practice included. A reading
    // takes no submissions, so it needs no guard of its own: the attempt query
    // finds nothing and the page says so, which is true rather than merely
    // empty. The graded-only rule that used to sit here made a practice set
    // read as "no submissions have been recorded" while its work sat in the
    // database.
    const attempts =
      await this.options.stores.assessment.listAttemptsForAssignment(
        assignment.id,
      );
    // Instructor review shows the effective grade (latest manual, else best
    // automatic) so the review queue and the gradebook agree, and so an
    // approved or overridden score reads correctly rather than the raw
    // autograde it replaced.
    const histories = await Promise.all(
      attempts.map((attempt) =>
        this.historyForAttempt(attempt.id, "instructor", i18n, true),
      ),
    );

    return histories.flat();
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

  private async refreshScore(
    assignment: Assignment,
    userId: AppId,
  ): Promise<void> {
    await new GradebookService({
      now: this.options.now,
      stores: this.options.stores,
    }).refreshStudentAssignmentScore(assignment, userId);
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

  private async findIdempotentSubmission(
    attemptId: AppId,
    idempotencyKey: string | null,
  ): Promise<{
    readonly evaluation: Evaluation | null;
    readonly submission: Submission;
  } | null> {
    if (idempotencyKey === null) {
      return null;
    }

    const submissions =
      await this.options.stores.assessment.listSubmissionsForAttempt(
        attemptId,
      );
    const submission = submissions.find(
      (item) => item.idempotencyKey === idempotencyKey,
    );

    if (submission === undefined) {
      return null;
    }

    const evaluations =
      await this.options.stores.assessment.listEvaluationsForSubmission(
        submission.id,
      );
    return { evaluation: evaluations[0] ?? null, submission };
  }

  private async historyForAttempt(
    attemptId: AppId,
    audience: ExerciseReviewAudience,
    i18n: Translator,
    preferEffective = false,
  ): Promise<SubmissionHistoryEntry[]> {
    const attempt =
      await this.options.stores.assessment.getAttempt(attemptId);

    if (attempt === null) {
      throw attemptNotFound();
    }

    const assignment = await this.options.stores.assignments.getById(
      attempt.assignmentId,
    );
    const declarations =
      assignment === null
        ? new Map<string, ExerciseManifestItem>()
        : await this.declarationsForAssignment(assignment);
    const submissions =
      await this.options.stores.assessment.listSubmissionsForAttempt(
        attemptId,
      );
    const now = timestampNow(this.options.now?.() ?? new Date());

    return Promise.all(
      submissions.map(async (submission) => {
        const evaluations =
          await this.options.stores.assessment.listEvaluationsForSubmission(
            submission.id,
          );
        const declaration =
          submission.exerciseId === null
            ? undefined
            : declarations.get(submission.exerciseId);
        const evaluation = preferEffective
          ? effectiveEvaluation(evaluations)
          : (evaluations[0] ?? null);
        // One condition, asked once, for the two things that have to agree: the
        // recorded verdict, and the review that would otherwise recompute it.
        const sealed =
          audience === "student" &&
          this.evaluationSealed(assignment, declaration, now);

        return {
          answerReview: this.answerReviewForSubmission(
            submission,
            declarations,
            audience,
            i18n,
            !sealed,
          ),
          attemptId,
          evaluation:
            audience === "instructor"
              ? evaluation === null
                ? null
                : viewerEvaluation(evaluation)
              : studentEvaluation(evaluation, declaration, assignment, now),
          nominalPoints: declaration?.nominalPoints ?? null,
          submission,
        };
      }),
    );
  }

  /**
   * Whether a student must not see this exercise's verdict yet.
   *
   * This used to ask about `exam` directly. It now asks the shared feedback
   * setting, which defaults to silence on an assignment still holding its
   * grades back — committing to an answer means nothing if the checker's score
   * comes straight back — and honours an author who wrote `feedback` on their
   * own account, in either direction and whether or not grades are out.
   */
  private evaluationSealed(
    assignment: Assignment | null,
    declaration: ExerciseManifestItem | undefined,
    now: Timestamp,
  ): boolean {
    return verdictSealed(declaration, assignment, now);
  }

  private answerReviewForSubmission(
    submission: Submission,
    declarations: ReadonlyMap<string, ExerciseManifestItem>,
    audience: ExerciseReviewAudience,
    i18n: Translator,
    revealCorrectness: boolean,
  ): ExerciseAnswerReview | null {
    if (submission.exerciseId === null || submission.answerKind === null) {
      return null;
    }

    const declaration = declarations.get(submission.exerciseId);

    if (declaration === undefined) {
      return null;
    }

    const answer: NormalizedAnswer = {
      data: submission.answer,
      kind: submission.answerKind,
      schemaVersion: declaration.schemaVersion,
    };

    return this.exerciseRegistry.reviewAnswer(declaration, answer, {
      audience,
      i18n,
      revealCorrectness,
    });
  }

  private async declarationsForAssignment(
    assignment: Assignment,
  ): Promise<Map<string, ExerciseManifestItem>> {
    const revision = await this.options.stores.content.getRevision(
      assignment.contentRevisionId,
    );

    if (revision === null) {
      return new Map();
    }

    const artifact = contentArtifactFromRevision(revision);

    return new Map(artifact.manifest.map((item) => [item.id, item]));
  }
}
