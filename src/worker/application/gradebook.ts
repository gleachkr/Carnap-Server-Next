import type { Attempt, Evaluation, Submission } from "../domain/assessment";
import {
  type Assignment,
  type AssignmentLatePolicy,
  gradesReleased,
} from "../domain/assignments";
import type { AssignmentScore } from "../domain/grades";
import type { AppId } from "../domain/ids";
import type { LtiResourceLink } from "../domain/lti";
import { timestampNow } from "../domain/time";
import type { User } from "../domain/users";
import { deferred } from "../i18n/deferred";
import type { AuthenticatedActor } from "./auth";
import { requireCourseRole, requireCourseStaff } from "./authorization";
import { contentArtifactFromRevision } from "./content/artifact";
import { AppHttpError } from "./errors";
import { planGradeJob } from "./grade-passback";
import { effectivePolicyAssignment } from "./policies";
import type {
  AppStores,
  EnqueueLtiGradeJobInput,
  UpsertAssignmentScoreInput,
} from "./stores";

export interface GradebookServiceOptions {
  readonly now?: (() => Date) | undefined;
  readonly stores: AppStores;
}

export interface StudentAssignmentScore {
  readonly released: boolean;
  readonly score: AssignmentScore;
}

export interface StudentScorecardEntry {
  readonly assignmentId: AppId;
  // Whether this score counts toward the course total. Only graded assignments
  // count; practice and reading scores are recorded and shown to the student as
  // a signal but excluded from the total.
  readonly counts: boolean;
  readonly earned: number | null;
  readonly released: boolean;
  readonly status: AssignmentScore["status"] | null;
  readonly worth: number;
}

/**
 * One exercise as this assignment counts it: the manifest's id and title, and
 * what it is worth.
 *
 * Excused exercises are not here. They are worth nothing toward the total — the
 * score calculation drops them before it sums anything — so a column for one
 * would be a column of blanks that no reader could tell from unanswered work.
 * That is what keeps the per-exercise columns summing to the score beside them.
 */
export interface GradebookExercise {
  readonly id: string;
  readonly points: number;
  readonly title: string | null;
}

export interface GradebookStudentRow {
  /**
   * Points earned on each exercise of {@link AssignmentGradebook.exercises}, by
   * position, and `null` where this student has no evaluated submission for it.
   * A zero is a zero the student earned; a null is work that never arrived.
   */
  readonly exerciseScores: readonly (number | null)[];
  readonly score: AssignmentScore;
  readonly user: User;
}

export interface AssignmentGradebook {
  readonly assignment: Assignment;
  readonly exercises: readonly GradebookExercise[];
  readonly rows: readonly GradebookStudentRow[];
}

export interface CourseGradebookRow {
  readonly scores: readonly (AssignmentScore | null)[];
  readonly user: User;
}

export interface CourseGradebook {
  readonly assignments: readonly Assignment[];
  readonly rows: readonly CourseGradebookRow[];
}

function assignmentNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "assignment_not_found",
    deferred.i18n.t("The assignment was not found."),
  );
}

function contentRevisionNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "content_revision_not_found",
    deferred.i18n.t("The content revision was not found."),
  );
}

function assignmentNotGraded(): AppHttpError {
  return new AppHttpError(
    403,
    "assignment_not_graded",
    deferred.i18n.t("Gradebook scores only exist for graded assignments."),
  );
}

function assignmentNotScored(): AppHttpError {
  return new AppHttpError(
    403,
    "assignment_not_scored",
    deferred.i18n.t("A reading records no scores, so it has no gradebook."),
  );
}

function gradeUnreleased(): AppHttpError {
  return new AppHttpError(
    403,
    "grade_unreleased",
    deferred.i18n.t("This grade has not been released."),
  );
}

function bestEvaluation(
  current: Evaluation | undefined,
  candidate: Evaluation,
): Evaluation {
  if (current === undefined) {
    return candidate;
  }

  if (candidate.score > current.score) {
    return candidate;
  }

  if (
    candidate.score === current.score &&
    candidate.createdAt > current.createdAt
  ) {
    return candidate;
  }

  return current;
}

function latestManualEvaluation(
  evaluations: readonly Evaluation[],
): Evaluation | null {
  return (
    evaluations
      .filter((evaluation) => evaluation.evaluatorKind === "manual")
      .sort((left, right) =>
        `${right.createdAt} ${right.id}`.localeCompare(
          `${left.createdAt} ${left.id}`,
        ),
      )[0] ?? null
  );
}

function effectiveEvaluationForSubmission(
  evaluations: readonly Evaluation[],
): Evaluation | null {
  const manual = latestManualEvaluation(evaluations);

  if (manual !== null) {
    return manual;
  }

  return evaluations.reduce<Evaluation | null>(
    (current, evaluation) => bestEvaluation(current ?? undefined, evaluation),
    null,
  );
}

function applyLatePolicy(input: {
  readonly dueAt: string | null;
  readonly evaluation: Evaluation;
  readonly latePolicy: AssignmentLatePolicy | null;
  readonly submittedAt: string;
}): Evaluation {
  const policy = input.latePolicy;

  if (policy === null || policy.kind === "none" || input.dueAt === null) {
    return input.evaluation;
  }

  const dueAt = new Date(input.dueAt).getTime();
  const submittedAt = new Date(input.submittedAt).getTime();
  const graceMilliseconds = policy.graceMinutes * 60_000;

  if (submittedAt <= dueAt + graceMilliseconds) {
    return input.evaluation;
  }

  const lateMilliseconds = submittedAt - dueAt - graceMilliseconds;
  const penaltyUnits =
    policy.kind === "percent_once_after_due"
      ? 1
      : Math.ceil(lateMilliseconds / 86_400_000);
  const penaltyPercent = Math.min(
    policy.maxPercentPenalty,
    policy.percentPenalty * penaltyUnits,
  );
  const multiplier = Math.max(0, 1 - penaltyPercent / 100);

  return {
    ...input.evaluation,
    result: {
      latePolicy: {
        dueAt: input.dueAt,
        kind: policy.kind,
        penaltyPercent,
        submittedAt: input.submittedAt,
      },
      rawEvaluation: input.evaluation.result,
    },
    score: input.evaluation.score * multiplier,
  };
}

function scoreStatus(input: {
  readonly attempts: readonly Attempt[];
  readonly maxScore: number;
  readonly score: number;
  readonly submittedExerciseCount: number;
}) {
  if (input.attempts.length === 0) {
    return "not-started";
  }

  if (input.submittedExerciseCount === 0) {
    return "missing";
  }

  if (input.maxScore > 0 && input.score >= input.maxScore) {
    return "complete";
  }

  return "partial";
}

function userSortKey(user: User): string {
  return `${user.name ?? ""}\u0000${user.email}\u0000${user.id}`;
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function percent(score: AssignmentScore): string {
  if (score.maxScore === 0) {
    return "";
  }

  return ((score.score / score.maxScore) * 100).toFixed(2);
}

/**
 * What an exercise's column is called: the title the author gave it, with the
 * id that identifies it either way.
 *
 * Both, because neither alone survives the spreadsheet. A title is what the
 * instructor recognizes but need not be unique and need not exist; an id is
 * unique and always there but is what the *system* calls the problem. The worth
 * rides along because a column of raw points is unreadable without it — "1" out
 * of what? — and a CSV has one header row to say it in.
 */
function exerciseColumn(exercise: GradebookExercise): string {
  const name =
    exercise.title === null || exercise.title.length === 0
      ? exercise.id
      : `${exercise.title} (${exercise.id})`;

  return `${name} /${exercise.points}`;
}

/**
 * One row per student: the assignment total, then the points earned on each
 * exercise that counts toward it, in the order the content declares them.
 *
 * The per-exercise cells sum to `score` and their column headings' worths sum
 * to `max_score` — excused exercises are in neither, which is what makes the
 * two halves of a row reconcilable. An empty cell is work with no evaluation
 * behind it, and is deliberately not a zero: a student who never answered a
 * problem and one who answered it wrongly are the same number in the total and
 * two different conversations.
 */
export function assignmentGradebookCsv(
  gradebook: AssignmentGradebook,
): string {
  const header = [
    "student_name",
    "student_email",
    "user_id",
    "score",
    "max_score",
    "percent",
    "status",
    "calculated_at",
    ...gradebook.exercises.map(exerciseColumn),
  ];
  const rows = gradebook.rows.map(({ exerciseScores, score, user }) =>
    [
      user.name ?? "",
      user.email,
      user.id,
      score.score.toString(),
      score.maxScore.toString(),
      percent(score),
      score.status,
      score.calculatedAt,
      ...exerciseScores.map((earned) =>
        earned === null ? "" : earned.toString(),
      ),
    ]
      .map(csvCell)
      .join(","),
  );

  // The header is quoted like any other row. Every other column name here is a
  // literal, but an exercise column carries the author's title and ID, and a
  // comma in either would otherwise shift every column after it — silently, in
  // the one row a reader uses to know what the numbers mean.
  return `${header.map(csvCell).join(",")}\n${rows.join("\n")}\n`;
}

/**
 * Every graded assignment score for every active student in the course, in a
 * tidy long format — one row per (student, assignment) score record. Columns
 * mirror {@link assignmentGradebookCsv}'s own with the assignment prepended, so
 * the per-assignment and whole-course exports read the same. Per-exercise
 * columns stop at that export: two assignments share no exercises, so a course
 * file carrying them would be one row of blanks per assignment per student. The
 * per-assignment export is where a problem breakdown lives. Rows are grouped by
 * student (in the gradebook's row order) then by assignment (in column order),
 * making the output deterministic. Null cells — a student with no score record
 * for an assignment — are skipped.
 */
export function courseGradebookCsv(gradebook: CourseGradebook): string {
  const header = [
    "assignment_id",
    "assignment_title",
    "student_name",
    "student_email",
    "user_id",
    "score",
    "max_score",
    "percent",
    "status",
    "calculated_at",
  ];
  const rows: string[] = [];

  for (const { scores, user } of gradebook.rows) {
    scores.forEach((score, index) => {
      if (score === null) {
        return;
      }

      const assignment = gradebook.assignments[index];

      if (assignment === undefined) {
        return;
      }

      rows.push(
        [
          assignment.id,
          assignment.title,
          user.name ?? "",
          user.email,
          user.id,
          score.score.toString(),
          score.maxScore.toString(),
          percent(score),
          score.status,
          score.calculatedAt,
        ]
          .map(csvCell)
          .join(","),
      );
    });
  }

  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

/** A student's score, and the per-exercise points it was summed from. */
interface CalculatedAssignmentScore {
  readonly exercises: readonly GradebookExercise[];
  /** Keyed by exercise id; an exercise with no evaluated work is absent. */
  readonly exerciseScores: ReadonlyMap<string, number>;
  readonly score: AssignmentScore;
}

export class GradebookService {
  private readonly contextPlatformMemo = new Map<AppId, AppId | null>();
  private readonly exercisesMemo = new Map<
    AppId,
    readonly GradebookExercise[]
  >();
  private readonly resourceLinksMemo = new Map<
    AppId,
    readonly LtiResourceLink[]
  >();

  constructor(private readonly options: GradebookServiceOptions) {}

  async refreshAssignmentScores(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
  ): Promise<AssignmentGradebook> {
    await requireCourseStaff(this.options.stores, actor, courseId);

    const assignment = await this.assignmentInCourse(courseId, assignmentId);
    this.assertScored(assignment);

    return {
      assignment,
      ...(await this.refreshRowsForAssignment(assignment)),
    };
  }

  async refreshStudentAssignmentScore(
    assignment: Assignment,
    userId: AppId,
  ): Promise<AssignmentScore> {
    return (await this.refreshStudentRow(assignment, userId)).score;
  }

  /**
   * The same refresh, keeping the per-exercise points the total was summed
   * from — which is what a gradebook needs to say *where* a student lost marks
   * rather than only that they did.
   */
  private async refreshStudentRow(
    assignment: Assignment,
    userId: AppId,
  ): Promise<CalculatedAssignmentScore> {
    // Scores are recorded for every mode — practice and reading work too, so an
    // instructor and student both have a signal — but only graded scores count
    // toward the course total (enforced by the callers that aggregate them).
    const now = timestampNow(this.options.now?.() ?? new Date());
    const computed = await this.calculateAssignmentScore(
      assignment,
      userId,
      now,
    );
    // Re-stamped after the reads above so `calculatedAt` orders projections
    // by data recency: the upserts refuse to let an older stamp overwrite a
    // newer one, and the LMS orders deliveries by the same value.
    const projection = {
      ...computed.score,
      calculatedAt: timestampNow(this.options.now?.() ?? new Date()),
    };
    const jobs = await this.gradeJobsForScoreChange(assignment, projection);

    return {
      ...computed,
      score:
        await this.options.stores.scores.upsertAssignmentScoreWithGradeJobs(
          projection,
          jobs,
        ),
    };
  }

  /**
   * The grade-passback outbox rows owed to LMSes for this score write, queued
   * in the same transaction as the score itself (PLAN §11.4). Refreshes run
   * on every gradebook read, so only a *changed* score queues a send; the
   * publishability rules themselves live in planGradeJob.
   */
  private async gradeJobsForScoreChange(
    assignment: Assignment,
    projection: UpsertAssignmentScoreInput,
  ): Promise<EnqueueLtiGradeJobInput[]> {
    if (
      assignment.assessmentMode !== "graded" ||
      projection.status === "not-started"
    ) {
      return [];
    }

    const links = await this.resourceLinksForAssignment(assignment.id);
    const syncable = links.filter((link) => link.agsLineItemUrl !== null);

    if (syncable.length === 0) {
      return [];
    }

    const previous = await this.options.stores.scores.getAssignmentScore(
      projection.assignmentId,
      projection.userId,
    );

    if (
      previous !== null &&
      previous.score === projection.score &&
      previous.maxScore === projection.maxScore &&
      previous.status === projection.status
    ) {
      return [];
    }

    const jobs: EnqueueLtiGradeJobInput[] = [];

    for (const link of syncable) {
      const platformId = await this.platformIdForContext(link.contextId);

      if (platformId === null) {
        continue;
      }

      const job = await planGradeJob(this.options.stores, {
        assignment,
        link,
        platformId,
        score: projection,
        previousStatus: previous?.status ?? null,
        now: projection.calculatedAt,
      });

      if (job !== null) {
        jobs.push(job);
      }
    }

    return jobs;
  }

  /**
   * Course gradebook refreshes call this once per student × assignment cell,
   * and the answer only depends on the assignment — memoized per service
   * instance (one request), like the context → platform hop below.
   */
  private async resourceLinksForAssignment(
    assignmentId: AppId,
  ): Promise<readonly LtiResourceLink[]> {
    const memoized = this.resourceLinksMemo.get(assignmentId);

    if (memoized !== undefined) {
      return memoized;
    }

    const links =
      await this.options.stores.lti.listResourceLinksForAssignment(
        assignmentId,
      );

    this.resourceLinksMemo.set(assignmentId, links);

    return links;
  }

  /**
   * Course gradebook refreshes call this per student against the same few
   * links, so the context → platform hop is memoized per service instance
   * (one request).
   */
  private async platformIdForContext(
    contextRowId: AppId,
  ): Promise<AppId | null> {
    const memoized = this.contextPlatformMemo.get(contextRowId);

    if (memoized !== undefined) {
      return memoized;
    }

    const context =
      await this.options.stores.lti.getContextById(contextRowId);
    const deployment =
      context === null
        ? null
        : await this.options.stores.lti.getDeploymentById(
            context.deploymentId,
          );
    const platformId = deployment?.platformId ?? null;

    this.contextPlatformMemo.set(contextRowId, platformId);

    return platformId;
  }

  async getAssignmentGradebook(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
  ): Promise<AssignmentGradebook> {
    await requireCourseStaff(this.options.stores, actor, courseId);

    const assignment = await this.assignmentInCourse(courseId, assignmentId);
    this.assertScored(assignment);

    return {
      assignment,
      ...(await this.refreshRowsForAssignment(assignment)),
    };
  }

  async getCourseGradebook(
    actor: AuthenticatedActor,
    courseId: AppId,
  ): Promise<CourseGradebook> {
    await requireCourseStaff(this.options.stores, actor, courseId);

    // Graded only, unlike the per-assignment gradebook. Every column here is
    // summed into a course total, and a practice column would either inflate it
    // or need a "does not count" flag the table has no way to show — the
    // student's own scorecard carries one, this does not. Until it does, a
    // practice set is read on its own page.
    const assignments = (
      await this.options.stores.assignments.listForCourse(courseId)
    ).filter(
      (assignment) =>
        assignment.state === "published" &&
        assignment.assessmentMode === "graded",
    );
    const students = await this.activeStudents(courseId);
    const rows = await Promise.all(
      students.map(async (user) => ({
        user,
        scores: await Promise.all(
          assignments.map((assignment) =>
            this.refreshStudentAssignmentScore(assignment, user.id),
          ),
        ),
      })),
    );

    return { assignments, rows };
  }

  async getStudentAssignmentScore(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
  ): Promise<StudentAssignmentScore> {
    await requireCourseRole(this.options.stores, actor, courseId, ["member"]);

    const assignment = await this.assignmentInCourse(courseId, assignmentId);
    this.assertGraded(assignment);

    const now = timestampNow(this.options.now?.() ?? new Date());

    if (!gradesReleased(assignment, now)) {
      throw gradeUnreleased();
    }

    return {
      released: true,
      score: await this.refreshStudentAssignmentScore(
        assignment,
        actor.user.id,
      ),
    };
  }

  async getStudentCourseScorecard(
    actor: AuthenticatedActor,
    courseId: AppId,
  ): Promise<StudentScorecardEntry[]> {
    await requireCourseRole(this.options.stores, actor, courseId, ["member"]);

    const assignments = (
      await this.options.stores.assignments.listForCourse(courseId)
    ).filter((assignment) => assignment.state === "published");
    const now = timestampNow(this.options.now?.() ?? new Date());

    const entries = await Promise.all(
      assignments.map(
        async (assignment): Promise<StudentScorecardEntry | null> => {
          const score = await this.refreshStudentAssignmentScore(
            assignment,
            actor.user.id,
          );

          if (assignment.assessmentMode === "graded") {
            const isReleased = gradesReleased(assignment, now);

            return {
              assignmentId: assignment.id,
              counts: true,
              earned: isReleased ? score.score : null,
              released: isReleased,
              status: isReleased ? score.status : null,
              worth: score.maxScore,
            } satisfies StudentScorecardEntry;
          }

          // Practice and reading show their recorded score immediately, but only
          // once the student has answered something — an untouched assignment
          // reads as a dash rather than a misleading 0.
          if (score.status !== "partial" && score.status !== "complete") {
            return null;
          }

          return {
            assignmentId: assignment.id,
            counts: false,
            earned: score.score,
            released: true,
            status: score.status,
            worth: score.maxScore,
          } satisfies StudentScorecardEntry;
        },
      ),
    );

    return entries.filter(
      (entry): entry is StudentScorecardEntry => entry !== null,
    );
  }

  private assertGraded(assignment: Assignment): void {
    if (assignment.assessmentMode !== "graded") {
      throw assignmentNotGraded();
    }
  }

  /**
   * The gradebook reads are open to anything that records a score, which is
   * practice as well as graded — the calculation never distinguished them, and
   * withholding the result from the instructor only meant the points a practice
   * set awards were visible to the student and to nobody else.
   *
   * A reading is the one mode this refuses. It takes no submissions at all
   * ({@link SubmissionService} rejects them), so its gradebook would be a table
   * of zeros no reader could tell from work nobody did.
   */
  private assertScored(assignment: Assignment): void {
    if (assignment.assessmentMode === "none") {
      throw assignmentNotScored();
    }
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

  private async activeStudents(courseId: AppId): Promise<User[]> {
    const memberships =
      await this.options.stores.courses.listMembershipsForCourse(courseId);
    const users = await Promise.all(
      memberships
        .filter(
          (membership) =>
            membership.role === "student" && membership.status === "active",
        )
        .map((membership) =>
          this.options.stores.users.getById(membership.userId),
        ),
    );

    return users
      .filter((user): user is User => user !== null)
      .sort((left, right) =>
        userSortKey(left).localeCompare(userSortKey(right)),
      );
  }

  private async refreshRowsForAssignment(assignment: Assignment): Promise<{
    readonly exercises: readonly GradebookExercise[];
    readonly rows: GradebookStudentRow[];
  }> {
    const students = await this.activeStudents(assignment.courseId);
    // Read once here rather than taken from a row, so an assignment with no
    // students still names its exercises — an empty gradebook that also claimed
    // the assignment had no problems in it would be two different emptinesses
    // wearing one face.
    const exercises = await this.countedExercises(assignment);
    const rows = await Promise.all(
      students.map(async (user) => {
        const refreshed = await this.refreshStudentRow(assignment, user.id);

        return {
          exerciseScores: exercises.map(
            (exercise) => refreshed.exerciseScores.get(exercise.id) ?? null,
          ),
          score: refreshed.score,
          user,
        };
      }),
    );

    return { exercises, rows };
  }

  /**
   * The exercises this assignment's score is out of, in the order the content
   * declares them. Memoized per service instance (one request), since a course
   * gradebook otherwise re-reads one revision per student.
   */
  private async countedExercises(
    assignment: Assignment,
  ): Promise<readonly GradebookExercise[]> {
    const memoized = this.exercisesMemo.get(assignment.id);

    if (memoized !== undefined) {
      return memoized;
    }

    const revision = await this.options.stores.content.getRevision(
      assignment.contentRevisionId,
    );

    if (revision === null) {
      throw contentRevisionNotFound();
    }

    const artifact = contentArtifactFromRevision(revision);
    const excuses = await this.options.stores.assignments.listExerciseExcuses(
      assignment.id,
    );
    const excusedIds = new Set(excuses.map((excuse) => excuse.exerciseId));
    const exercises = artifact.manifest
      .filter((item) => !excusedIds.has(item.id))
      .map((item) => ({
        id: item.id,
        points: item.nominalPoints,
        title: item.title ?? null,
      }));

    this.exercisesMemo.set(assignment.id, exercises);

    return exercises;
  }

  private async calculateAssignmentScore(
    assignment: Assignment,
    userId: AppId,
    calculatedAt: string,
  ): Promise<CalculatedAssignmentScore> {
    const exercises = await this.countedExercises(assignment);
    const latePolicy = await this.options.stores.assignments.getLatePolicy(
      assignment.id,
    );
    const pointByExercise = new Map(
      exercises.map((exercise) => [exercise.id, exercise.points]),
    );
    const maxScore = exercises.reduce(
      (sum, exercise) => sum + exercise.points,
      0,
    );
    const attempts = (
      await this.options.stores.assessment.listAttemptsForAssignmentUser(
        assignment.id,
        userId,
      )
    ).filter((attempt) => attempt.status !== "voided");
    const bestByExercise = new Map<string, Evaluation>();

    for (const attempt of attempts) {
      const submissions =
        await this.options.stores.assessment.listSubmissionsForAttempt(
          attempt.id,
        );

      await this.collectEvaluations(
        assignment,
        submissions,
        pointByExercise,
        bestByExercise,
        latePolicy,
      );
    }

    const score = [...bestByExercise.values()].reduce(
      (sum, evaluation) => sum + evaluation.score,
      0,
    );

    return {
      exercises,
      exerciseScores: new Map(
        [...bestByExercise].map(([exerciseId, evaluation]) => [
          exerciseId,
          evaluation.score,
        ]),
      ),
      score: {
        assignmentId: assignment.id,
        calculatedAt,
        maxScore,
        score,
        status: scoreStatus({
          attempts,
          maxScore,
          score,
          submittedExerciseCount: bestByExercise.size,
        }),
        userId,
      },
    };
  }

  private async effectiveDueAt(
    assignment: Assignment,
    userId: AppId,
  ): Promise<string | null> {
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
    }).dueAt;
  }

  private async collectEvaluations(
    assignment: Assignment,
    submissions: readonly Submission[],
    pointByExercise: ReadonlyMap<string, number>,
    bestByExercise: Map<string, Evaluation>,
    latePolicy: AssignmentLatePolicy | null,
  ): Promise<void> {
    for (const submission of submissions) {
      if (
        submission.exerciseId === null ||
        !pointByExercise.has(submission.exerciseId)
      ) {
        continue;
      }

      const evaluations = (
        await this.options.stores.assessment.listEvaluationsForSubmission(
          submission.id,
        )
      ).filter((evaluation) => evaluation.voidedAt === null);
      const effective = effectiveEvaluationForSubmission(evaluations);

      if (effective === null) {
        continue;
      }

      const dueAt = await this.effectiveDueAt(assignment, submission.userId);
      const adjusted = applyLatePolicy({
        dueAt,
        evaluation: effective,
        latePolicy,
        submittedAt: submission.submittedAt,
      });

      bestByExercise.set(
        submission.exerciseId,
        bestEvaluation(bestByExercise.get(submission.exerciseId), adjusted),
      );
    }
  }
}
