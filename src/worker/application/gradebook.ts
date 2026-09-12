import type {
  Attempt,
  EvaluationForScoring,
  SubmissionForScoring,
} from "../domain/assessment";
import {
  type Assignment,
  type AssignmentLatePolicy,
  type AssignmentOverride,
  gradesReleased,
} from "../domain/assignments";
import type { CourseAccommodation } from "../domain/courses";
import type { AssignmentScore } from "../domain/grades";
import type { AppId } from "../domain/ids";
import type { LtiResourceLink } from "../domain/lti";
import { timestampNow } from "../domain/time";
import type { User } from "../domain/users";
import { deferred } from "../i18n/deferred";
import type { AuthenticatedActor } from "./auth";
import { requireCourseRole, requireCourseStaff } from "./authorization";
import { parseManifestPoints } from "./content/artifact";
import { AppHttpError } from "./errors";
import { planGradeJob } from "./grade-passback";
import { effectivePolicyAssignment } from "./policies";
import type {
  AppStores,
  EnqueueLtiGradeJobInput,
  ScoringScope,
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
  current: EvaluationForScoring | undefined,
  candidate: EvaluationForScoring,
): EvaluationForScoring {
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
  evaluations: readonly EvaluationForScoring[],
): EvaluationForScoring | null {
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
  evaluations: readonly EvaluationForScoring[],
): EvaluationForScoring | null {
  const manual = latestManualEvaluation(evaluations);

  if (manual !== null) {
    return manual;
  }

  return evaluations.reduce<EvaluationForScoring | null>(
    (current, evaluation) => bestEvaluation(current ?? undefined, evaluation),
    null,
  );
}

/**
 * The evaluation with the late penalty taken off its score. Only the score
 * changes: the penalty is a fact about the assignment's policy and the
 * submission's timing, both of which stay readable where they live, and no
 * reader of a total ever asked for the workings.
 */
function applyLatePolicy(input: {
  readonly dueAt: string | null;
  readonly evaluation: EvaluationForScoring;
  readonly latePolicy: AssignmentLatePolicy | null;
  readonly submittedAt: string;
}): EvaluationForScoring {
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
  // A spreadsheet reads a cell opening with =, +, -, or @ (or a stray tab or
  // carriage return) as a live formula — quoting does not defuse it — and
  // these exports carry text students typed, their own names first among it.
  // The leading apostrophe is the spreadsheets' own "this is text" marker.
  const cell = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

  if (!/[",\n\r]/.test(cell)) {
    return cell;
  }

  return `"${cell.replaceAll('"', '""')}"`;
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
    // The institution's own identifier, when an LMS launch has supplied one —
    // empty otherwise, which is every student who has only ever signed in here.
    // It sits with the other identifying columns rather than at the end because
    // the per-exercise columns after them vary in number per assignment.
    "student_id",
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
      user.studentId ?? "",
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
    "student_id",
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
          user.studentId ?? "",
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

/**
 * Everything a score is summed from, for some assignments and some students,
 * read before any arithmetic starts.
 *
 * A score used to be computed by walking the rows one query at a time — the
 * attempts, then each attempt's submissions, then each submission's
 * evaluations, and the due date over again for every submission — which made
 * a student's course page cost a query per row of their work and the course
 * gradebook a query per row of everyone's. D1 runs statements one after
 * another and counts each toward a per-request cap, so that was both slow and
 * bounded. This reads the same rows in a fixed handful of statements
 * ({@link GradebookService.scoringInputs}) and hands them to the arithmetic
 * grouped the way the walk used to find them: each list in the order the
 * per-row query returned it, which the tie-breaks in {@link bestEvaluation}
 * depend on.
 */
interface ScoringInputs extends ScoringContext, ScoringWork {}

/**
 * The small half of the inputs: what each assignment is out of, and each
 * student's adjustments to it. A few rows per assignment or per student,
 * read in five statements for any number of assignments.
 */
interface ScoringContext {
  /** By {@link pairKey}(courseId, userId). */
  readonly accommodations: ReadonlyMap<string, CourseAccommodation>;
  /** By assignment id: the manifest's exercises less the excused ones. */
  readonly exercises: ReadonlyMap<AppId, readonly GradebookExercise[]>;
  /** By assignment id. */
  readonly latePolicies: ReadonlyMap<AppId, AssignmentLatePolicy>;
  /** By {@link pairKey}(assignmentId, userId). */
  readonly overrides: ReadonlyMap<string, AssignmentOverride>;
}

/**
 * The large half: the work itself, as many rows as there are attempts,
 * submissions and evaluations in the scope, read in three statements. This
 * is the part a course-wide read has to take in pieces — see
 * {@link GradebookService.getCourseGradebook}.
 */
interface ScoringWork {
  /** By {@link pairKey}(assignmentId, userId), in ordinal order, voids included. */
  readonly attempts: ReadonlyMap<string, readonly Attempt[]>;
  /** By submission id, in (createdAt, id) order, voids included. */
  readonly evaluations: ReadonlyMap<AppId, readonly EvaluationForScoring[]>;
  /** By attempt id, in (submittedAt, id) order. */
  readonly submissions: ReadonlyMap<AppId, readonly SubmissionForScoring[]>;
}

function pairKey(first: AppId, second: AppId): string {
  return `${first} ${second}`;
}

/** Byte order — what the database sorts text by — not the locale's. */
function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}

function groupBy<T>(
  rows: readonly T[],
  key: (row: T) => string,
  compare: (left: T, right: T) => number,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    const group = groups.get(key(row));

    if (group === undefined) {
      groups.set(key(row), [row]);
    } else {
      group.push(row);
    }
  }

  for (const group of groups.values()) {
    group.sort(compare);
  }

  return groups;
}

function exercisesFor(
  inputs: ScoringInputs,
  assignment: Assignment,
): readonly GradebookExercise[] {
  const exercises = inputs.exercises.get(assignment.id);

  if (exercises === undefined) {
    // Not a user-facing condition: the inputs were read for a different set
    // of assignments than they are being used for, which is a bug here.
    throw new Error(
      `Scoring inputs were not read for assignment ${assignment.id}.`,
    );
  }

  return exercises;
}

function effectiveDueAt(
  assignment: Assignment,
  userId: AppId,
  inputs: ScoringInputs,
): string | null {
  return effectivePolicyAssignment(assignment, {
    accommodation:
      inputs.accommodations.get(pairKey(assignment.courseId, userId)) ?? null,
    override: inputs.overrides.get(pairKey(assignment.id, userId)) ?? null,
  }).dueAt;
}

function collectEvaluations(
  assignment: Assignment,
  submissions: readonly SubmissionForScoring[],
  pointByExercise: ReadonlyMap<string, number>,
  bestByExercise: Map<string, EvaluationForScoring>,
  latePolicy: AssignmentLatePolicy | null,
  inputs: ScoringInputs,
): void {
  for (const submission of submissions) {
    if (
      submission.exerciseId === null ||
      !pointByExercise.has(submission.exerciseId)
    ) {
      continue;
    }

    const evaluations = (inputs.evaluations.get(submission.id) ?? []).filter(
      (evaluation) => evaluation.voidedAt === null,
    );
    const effective = effectiveEvaluationForSubmission(evaluations);

    if (effective === null) {
      continue;
    }

    const dueAt = effectiveDueAt(assignment, submission.userId, inputs);
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

/**
 * One student's score on one assignment, from rows already in hand. Pure:
 * everything it reads is in `inputs`, so the same inputs give the same score
 * whether a page is showing it or the ledger is recording it.
 */
function calculateAssignmentScore(
  assignment: Assignment,
  userId: AppId,
  inputs: ScoringInputs,
  calculatedAt: string,
): CalculatedAssignmentScore {
  const exercises = exercisesFor(inputs, assignment);
  const latePolicy = inputs.latePolicies.get(assignment.id) ?? null;
  const pointByExercise = new Map(
    exercises.map((exercise) => [exercise.id, exercise.points]),
  );
  const maxScore = exercises.reduce(
    (sum, exercise) => sum + exercise.points,
    0,
  );
  const attempts = (
    inputs.attempts.get(pairKey(assignment.id, userId)) ?? []
  ).filter((attempt) => attempt.status !== "voided");
  const bestByExercise = new Map<string, EvaluationForScoring>();

  for (const attempt of attempts) {
    collectEvaluations(
      assignment,
      inputs.submissions.get(attempt.id) ?? [],
      pointByExercise,
      bestByExercise,
      latePolicy,
      inputs,
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

/**
 * Scores, two ways.
 *
 * Everything a person is shown — a student's scorecard, the gradebooks, the
 * CSVs — is computed from the live attempts, submissions and evaluations at
 * the moment of reading, and nothing else. There is no cached number a page
 * could show that the rows would not agree with.
 *
 * The `assignment_scores` table is the grade-passback ledger, and only that.
 * It records what a score last evaluated to so that a change can be told
 * from a repeat (an unchanged score must not re-send to an LMS) and so that
 * deliveries can be ordered by data recency (`calculatedAt`). It is written
 * by the `refresh*` methods here, which every path that changes what a score
 * evaluates to calls — a submission, a hand-written grade, an instructor's
 * excuse, override, repoint, reset, late policy or accommodation — and by
 * nothing a reader does. A write path that misses it delays an LMS sync
 * until the next one; it cannot show anyone a wrong number.
 */
export class GradebookService {
  private readonly contextPlatformMemo = new Map<AppId, AppId | null>();
  private readonly resourceLinksMemo = new Map<
    AppId,
    readonly LtiResourceLink[]
  >();

  constructor(private readonly options: GradebookServiceOptions) {}

  /**
   * Recompute one student's ledger row for one assignment, queueing whatever
   * an LMS is owed for the change.
   */
  async refreshStudentAssignmentScore(
    assignment: Assignment,
    userId: AppId,
  ): Promise<AssignmentScore> {
    const inputs = await this.scoringInputs([assignment], userId);

    return (await this.writeLedgerRow(assignment, userId, inputs)).score;
  }

  /**
   * The same for several students at once, over one read of the assignment's
   * work — what an instructor's change to the assignment itself calls for.
   */
  async refreshAssignmentScoresForUsers(
    assignment: Assignment,
    userIds: readonly AppId[],
  ): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    const inputs = await this.scoringInputs([assignment]);

    for (const userId of userIds) {
      await this.writeLedgerRow(assignment, userId, inputs);
    }
  }

  /**
   * One student's ledger rows across a course's graded assignments — what an
   * accommodation changes, since its due-date extension reaches every one of
   * them.
   */
  async refreshCourseScoresForUser(
    courseId: AppId,
    userId: AppId,
  ): Promise<void> {
    const assignments = (
      await this.options.stores.assignments.listForCourse(courseId)
    ).filter(
      (assignment) =>
        assignment.state === "published" &&
        assignment.assessmentMode === "graded",
    );

    if (assignments.length === 0) {
      return;
    }

    const inputs = await this.scoringInputs(assignments, userId);

    for (const assignment of assignments) {
      await this.writeLedgerRow(assignment, userId, inputs);
    }
  }

  private async writeLedgerRow(
    assignment: Assignment,
    userId: AppId,
    inputs: ScoringInputs,
  ): Promise<CalculatedAssignmentScore> {
    // Scores are recorded for every mode — practice and reading work too, so
    // the passback rules have one shape of row to read — but only graded
    // scores are ever sent (planGradeJob) or counted toward the course total.
    // Stamped after the reads, so `calculatedAt` orders projections by data
    // recency: the upserts refuse to let an older stamp overwrite a newer one,
    // and the LMS orders deliveries by the same value.
    const computed = calculateAssignmentScore(
      assignment,
      userId,
      inputs,
      timestampNow(this.options.now?.() ?? new Date()),
    );
    const jobs = await this.gradeJobsForScoreChange(
      assignment,
      computed.score,
    );

    return {
      ...computed,
      score:
        await this.options.stores.scores.upsertAssignmentScoreWithGradeJobs(
          computed.score,
          jobs,
        ),
    };
  }

  /**
   * The grade-passback outbox rows owed to LMSes for this score write, queued
   * in the same transaction as the score itself (PLAN §11.4). Only a
   * *changed* score queues a send; the publishability rules themselves live
   * in planGradeJob.
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
   * A bulk refresh calls this once per student against the same assignment,
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
   * A bulk refresh calls this per student against the same few links, so the
   * context → platform hop is memoized per service instance (one request).
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

    const [students, inputs] = await Promise.all([
      this.activeStudents(assignment.courseId),
      this.scoringInputs([assignment]),
    ]);
    // Taken from the inputs rather than from a row, so an assignment with no
    // students still names its exercises — an empty gradebook that also
    // claimed the assignment had no problems in it would be two different
    // emptinesses wearing one face.
    const exercises = exercisesFor(inputs, assignment);
    const now = timestampNow(this.options.now?.() ?? new Date());

    return {
      assignment,
      exercises,
      rows: students.map((user) => {
        const computed = calculateAssignmentScore(
          assignment,
          user.id,
          inputs,
          now,
        );

        return {
          exerciseScores: exercises.map(
            (exercise) => computed.exerciseScores.get(exercise.id) ?? null,
          ),
          score: computed.score,
          user,
        };
      }),
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
    const [students, context] = await Promise.all([
      this.activeStudents(courseId),
      this.scoringContext(assignments),
    ]);
    const now = timestampNow(this.options.now?.() ?? new Date());
    // One assignment's work at a time, and only its scores kept: the rows a
    // column is summed from are let go before the next column's are read, so
    // what this holds at once is bounded by the largest assignment, not by
    // every submission the course has ever taken. Three statements a column
    // on top of the context read once above — a count that grows with the
    // assignments and not with the class.
    const columns: AssignmentScore[][] = [];

    for (const assignment of assignments) {
      const inputs = {
        ...context,
        ...(await this.scoringWork({ assignmentIds: [assignment.id] })),
      };

      columns.push(
        students.map(
          (user) =>
            calculateAssignmentScore(assignment, user.id, inputs, now).score,
        ),
      );
    }

    return {
      assignments,
      rows: students.map((user, index) => ({
        user,
        scores: columns.map((column) => column[index] ?? null),
      })),
    };
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

    const inputs = await this.scoringInputs([assignment], actor.user.id);

    return {
      released: true,
      score: calculateAssignmentScore(assignment, actor.user.id, inputs, now)
        .score,
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
    const inputs = await this.scoringInputs(assignments, actor.user.id);

    const entries = assignments.map(
      (assignment): StudentScorecardEntry | null => {
        const score = calculateAssignmentScore(
          assignment,
          actor.user.id,
          inputs,
          now,
        ).score;

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

  /**
   * Read everything {@link calculateAssignmentScore} needs for these
   * assignments, for one student or for all of them, in eight statements
   * however much work there is: the manifests' points and the excuses (the
   * exercises that count), the late policies, the attempts, their
   * submissions, those submissions' evaluations, the overrides, and the
   * accommodations. See {@link ScoringInputs} for why it is done this way.
   */
  private async scoringInputs(
    assignments: readonly Assignment[],
    userId?: AppId,
  ): Promise<ScoringInputs> {
    const [context, work] = await Promise.all([
      this.scoringContext(assignments, userId),
      this.scoringWork({
        assignmentIds: assignments.map((assignment) => assignment.id),
        userId,
      }),
    ]);

    return { ...context, ...work };
  }

  /** The {@link ScoringContext} half of the inputs: five statements. */
  private async scoringContext(
    assignments: readonly Assignment[],
    userId?: AppId,
  ): Promise<ScoringContext> {
    const stores = this.options.stores;
    const assignmentIds = assignments.map((assignment) => assignment.id);
    const [exercises, latePolicies, overrides, accommodations] =
      await Promise.all([
        this.countedExercises(assignments),
        stores.assignments.listLatePolicies(assignmentIds),
        stores.assignments.listOverridesForScoring({ assignmentIds, userId }),
        this.accommodations(
          [...new Set(assignments.map((assignment) => assignment.courseId))],
          userId,
        ),
      ]);

    return {
      accommodations: new Map(
        accommodations.map((accommodation) => [
          pairKey(accommodation.courseId, accommodation.userId),
          accommodation,
        ]),
      ),
      exercises,
      latePolicies: new Map(
        latePolicies.map((policy) => [policy.assignmentId, policy]),
      ),
      overrides: new Map(
        overrides.map((override) => [
          pairKey(override.assignmentId, override.userId),
          override,
        ]),
      ),
    };
  }

  /**
   * The {@link ScoringWork} half: three statements, grouped and sorted here
   * the way the arithmetic's tie-breaks expect, in byte order like the
   * per-row reads this replaced.
   */
  private async scoringWork(scope: ScoringScope): Promise<ScoringWork> {
    const stores = this.options.stores;
    const [attempts, submissions, evaluations] = await Promise.all([
      stores.assessment.listAttemptsForScoring(scope),
      stores.assessment.listSubmissionsForScoring(scope),
      stores.assessment.listEvaluationsForScoring(scope),
    ]);

    return {
      attempts: groupBy(
        attempts,
        (attempt) => pairKey(attempt.assignmentId, attempt.userId),
        (left, right) => left.ordinal - right.ordinal,
      ),
      evaluations: groupBy(
        evaluations,
        (evaluation) => evaluation.submissionId,
        (left, right) =>
          compareText(left.createdAt, right.createdAt) ||
          compareText(left.id, right.id),
      ),
      submissions: groupBy(
        submissions,
        (submission) => submission.attemptId,
        (left, right) =>
          compareText(left.submittedAt, right.submittedAt) ||
          compareText(left.id, right.id),
      ),
    };
  }

  private async accommodations(
    courseIds: readonly AppId[],
    userId: AppId | undefined,
  ): Promise<CourseAccommodation[]> {
    const perCourse = await Promise.all(
      courseIds.map((courseId) =>
        userId === undefined
          ? this.options.stores.courses.listAccommodationsForCourse(courseId)
          : this.options.stores.courses
              .getAccommodation(courseId, userId)
              .then((accommodation) =>
                accommodation === null ? [] : [accommodation],
              ),
      ),
    );

    return perCourse.flat();
  }

  /**
   * The exercises each assignment's score is out of, in the order the content
   * declares them: the manifest's items, read by projection rather than by
   * loading the artifacts (see `parseManifestPoints`), less the excused ones.
   */
  private async countedExercises(
    assignments: readonly Assignment[],
  ): Promise<Map<AppId, readonly GradebookExercise[]>> {
    const [manifests, excuses] = await Promise.all([
      this.options.stores.content
        .listManifestPoints([
          ...new Set(
            assignments.map((assignment) => assignment.contentRevisionId),
          ),
        ])
        .then(parseManifestPoints),
      this.options.stores.assignments.listExerciseExcusesForAssignments(
        assignments.map((assignment) => assignment.id),
      ),
    ]);
    const excusedIds = new Map<AppId, Set<string>>();

    for (const excuse of excuses) {
      const ids = excusedIds.get(excuse.assignmentId) ?? new Set<string>();

      ids.add(excuse.exerciseId);
      excusedIds.set(excuse.assignmentId, ids);
    }

    return new Map(
      assignments.map((assignment) => {
        const manifest = manifests.get(assignment.contentRevisionId);

        if (manifest === undefined) {
          throw contentRevisionNotFound();
        }

        const excused = excusedIds.get(assignment.id);

        return [
          assignment.id,
          manifest
            .filter((item) => excused === undefined || !excused.has(item.id))
            .map((item) => ({
              id: item.id,
              points: item.nominalPoints,
              title: item.title,
            })),
        ];
      }),
    );
  }
}
