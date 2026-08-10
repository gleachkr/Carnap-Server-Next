import { type Assignment, gradesReleased } from "../domain/assignments";
import type { AssignmentScore } from "../domain/grades";
import { type AppId, createAppId } from "../domain/ids";
import type {
  LtiGradeFailureReason,
  LtiGradeJob,
  LtiPlatform,
  LtiResourceLink,
} from "../domain/lti";
import { addSeconds, type Timestamp, timestampNow } from "../domain/time";
import type { User } from "../domain/users";
import { deferred } from "../i18n/deferred";
import type { AuthenticatedActor } from "./auth";
import { requireInstructor } from "./authorization";
import { AppHttpError, badRequest } from "./errors";
import type { AppStores, EnqueueLtiGradeJobInput } from "./stores";

/**
 * How often a job may be attempted before it parks as `failed`: the initial
 * send plus one retry per backoff step below (roughly a day and a half of
 * cover for an LMS outage).
 */
export const GRADE_JOB_MAX_ATTEMPTS = 8;

const RETRY_DELAYS_SECONDS = [
  60,
  5 * 60,
  15 * 60,
  60 * 60,
  4 * 60 * 60,
  12 * 60 * 60,
  24 * 60 * 60,
] as const;

/**
 * A `sending` row older than this was abandoned by a worker that died
 * mid-delivery; the next run reclaims it. Comfortably longer than any
 * plausible pair of HTTP calls.
 */
const RECLAIM_SENDING_AFTER_SECONDS = 120;

/**
 * How often a job whose assignment has no release date at all re-checks for
 * one. A dated release wakes exactly on time; only the open-ended case polls.
 */
const UNRELEASED_POLL_SECONDS = 6 * 60 * 60;

export interface PlanGradeJobInput {
  readonly assignment: Assignment;
  readonly link: LtiResourceLink;
  readonly platformId: AppId;
  readonly score: {
    readonly userId: AppId;
    readonly score: number;
    readonly maxScore: number;
    readonly status: AssignmentScore["status"];
    readonly calculatedAt: Timestamp;
  };
  /**
   * The status the stored score had before this one, or null when unknown
   * (a backfill has no idea what the LMS column already shows).
   */
  readonly previousStatus: AssignmentScore["status"] | null;
  readonly now: Timestamp;
}

/**
 * The one place that decides whether a score is owed to an LMS gradebook
 * column, and what the outbox row looks like — every enqueue path (score
 * change, association backfill, launch self-heal) must go through it so the
 * publishability rules cannot drift apart.
 */
export async function planGradeJob(
  stores: AppStores,
  input: PlanGradeJobInput,
): Promise<EnqueueLtiGradeJobInput | null> {
  const { assignment, link, score } = input;

  if (
    assignment.assessmentMode !== "graded" ||
    link.agsLineItemUrl === null ||
    score.status === "not-started"
  ) {
    return null;
  }

  // "missing" is a student who opened an attempt and submitted nothing.
  // Pushing that fresh zero would render as a real grade for someone who
  // merely peeked — but as a correction to a previously synced value (an
  // attempt reset, say) it must go out or the LMS keeps the old score.
  if (
    score.status === "missing" &&
    input.previousStatus !== "partial" &&
    input.previousStatus !== "complete"
  ) {
    return null;
  }

  // AGS requires a positive scoreMaximum, so a zeroed assignment (every
  // exercise excused) has no representable score.
  if (score.maxScore <= 0) {
    return null;
  }

  const subject = await stores.users.getLtiSubject(
    score.userId,
    input.platformId,
  );

  // A student with no LTI identity on this platform (native-only, or linked
  // elsewhere) has no gradebook row the LMS could accept.
  if (subject === null) {
    return null;
  }

  return {
    id: createAppId(),
    resourceLinkId: link.id,
    userId: score.userId,
    score: score.score,
    maxScore: score.maxScore,
    scoreTimestamp: score.calculatedAt,
    now: input.now,
  };
}

/**
 * A failed delivery to the LMS. `retryable` separates outages (worth backing
 * off and retrying) from rejections that repeating the same request can
 * never fix. `reason` is what gets stored and shown; `detail` is the
 * platform's own words, and `message` exists only for logs.
 */
export class ScoreDeliveryError extends Error {
  constructor(
    readonly reason: LtiGradeFailureReason,
    readonly retryable: boolean,
    readonly detail: string | null = null,
  ) {
    super(detail === null ? reason : `${reason}: ${detail}`);
    this.name = "ScoreDeliveryError";
  }
}

export interface LtiScoreMessage {
  /** The user's LTI subject on the platform — the `sub` claim, not an Carnap id. */
  readonly subject: string;
  readonly scoreGiven: number;
  readonly scoreMaximum: number;
  /**
   * When the score was calculated. The platform orders concurrent deliveries
   * by this value, so a stale score racing a fresh one can never win.
   */
  readonly timestamp: Timestamp;
}

/** The outbound AGS call, implemented in infrastructure; throws ScoreDeliveryError. */
export interface LtiScoreSender {
  postScore(
    platform: LtiPlatform,
    lineItemUrl: string,
    score: LtiScoreMessage,
  ): Promise<void>;
}

export interface GradePassbackServiceOptions {
  readonly stores: AppStores;
  /** Null when no tool key is configured; pending jobs are left untouched. */
  readonly sender: LtiScoreSender | null;
  readonly now?: () => Date;
  readonly requestId?: string;
}

export interface GradePassbackRunSummary {
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
  readonly superseded: number;
  /** Withheld deliveries: the assignment's grades are not yet released. */
  readonly deferred: number;
}

export interface GradeSyncFailure {
  readonly job: LtiGradeJob;
  readonly activityTitle: string;
  readonly student: User | null;
}

/**
 * Drains the grade-passback outbox: claim due jobs, deliver each score to its
 * platform, and record the outcome — completion, a backed-off retry, or a
 * permanent failure an instructor can inspect and re-queue.
 */
export class GradePassbackService {
  constructor(private readonly options: GradePassbackServiceOptions) {}

  async processDueJobs(limit = 25): Promise<GradePassbackRunSummary> {
    const summary = {
      claimed: 0,
      sent: 0,
      retried: 0,
      failed: 0,
      superseded: 0,
      deferred: 0,
    };

    // Without a signing key no delivery can ever succeed; leaving the jobs
    // pending (rather than burning their retry budget) means configuring the
    // key later releases the backlog untouched.
    if (this.options.sender === null) {
      console.error("lti_grade_passback_skipped", {
        reason: "tool_key_not_configured",
        requestId: this.options.requestId ?? "",
      });

      return summary;
    }

    const nowDate = this.options.now?.() ?? new Date();
    const jobs = await this.options.stores.lti.claimDueGradeJobs(
      timestampNow(nowDate),
      addSeconds(nowDate, -RECLAIM_SENDING_AFTER_SECONDS),
      limit,
    );

    summary.claimed = jobs.length;

    // Sequential on purpose: deliveries to one platform reuse its cached
    // access token, and a cron batch has no latency budget worth racing for.
    for (const job of jobs) {
      const outcome = await this.deliver(this.options.sender, job, nowDate);

      summary[outcome] += 1;
    }

    if (summary.claimed > 0) {
      console.log("lti_grade_passback_run", {
        ...summary,
        requestId: this.options.requestId ?? "",
      });
    }

    return summary;
  }

  private async deliver(
    sender: LtiScoreSender,
    job: LtiGradeJob,
    nowDate: Date,
  ): Promise<"sent" | "retried" | "failed" | "superseded" | "deferred"> {
    const now = timestampNow(nowDate);
    const target = await this.resolveTarget(job);

    if (typeof target === "string") {
      const failed = await this.options.stores.lti.failGradeJob({
        id: job.id,
        claimedAt: job.updatedAt,
        attemptCount: job.attemptCount + 1,
        reason: target,
        detail: null,
        nextAttemptAt: null,
        now,
      });

      if (failed === null) {
        return "superseded";
      }

      this.logFailure(job, target, null, "permanent");

      return "failed";
    }

    // Carnap's grade-release control extends to the LMS: a column the
    // instructor is still holding back in Carnap must not fill in Moodle.
    // The job waits — a dated release wakes exactly on time — and spends no
    // retry budget doing so.
    if (!gradesReleased(target.assignment, now)) {
      const wakeAt =
        target.assignment.gradesVisibleAt !== null &&
        target.assignment.gradesVisibleAt > now
          ? target.assignment.gradesVisibleAt
          : addSeconds(nowDate, UNRELEASED_POLL_SECONDS);
      const deferred = await this.options.stores.lti.deferGradeJob(
        job.id,
        job.updatedAt,
        wakeAt,
        now,
      );

      return deferred === null ? "superseded" : "deferred";
    }

    try {
      await sender.postScore(target.platform, target.lineItemUrl, {
        subject: target.subject,
        scoreGiven: job.score,
        scoreMaximum: job.maxScore,
        timestamp: job.scoreTimestamp,
      });
    } catch (error) {
      return this.recordFailure(job, error, nowDate);
    }

    const completed = await this.options.stores.lti.completeGradeJob(
      job.id,
      job.updatedAt,
      now,
    );

    // Null means the row was re-pointed at a newer score while this one was
    // in flight; that fresh pending send stands.
    return completed === null ? "superseded" : "sent";
  }

  /**
   * Everything a delivery needs, or the reason the job can never be delivered
   * (an unlinked activity, a disabled platform, a student who removed their
   * LMS identity). A bare reason code is the failure branch; the object is the
   * success branch.
   */
  private async resolveTarget(job: LtiGradeJob): Promise<
    | {
        readonly assignment: Assignment;
        readonly platform: LtiPlatform;
        readonly lineItemUrl: string;
        readonly subject: string;
      }
    | LtiGradeFailureReason
  > {
    const stores = this.options.stores;
    const link = await stores.lti.getResourceLinkById(job.resourceLinkId);

    if (link === null || link.assignmentId === null) {
      return "resource_link_unlinked";
    }

    if (link.agsLineItemUrl === null) {
      return "line_item_missing";
    }

    const assignment = await stores.assignments.getById(link.assignmentId);

    if (assignment === null) {
      return "assignment_missing";
    }

    if (assignment.assessmentMode !== "graded") {
      return "assignment_not_graded";
    }

    const context = await stores.lti.getContextById(link.contextId);
    const deployment =
      context === null
        ? null
        : await stores.lti.getDeploymentById(context.deploymentId);
    const platform =
      deployment === null
        ? null
        : await stores.lti.getPlatformById(deployment.platformId);

    if (platform === null) {
      return "platform_missing";
    }

    if (platform.disabledAt !== null) {
      return "platform_disabled";
    }

    const subject = await stores.users.getLtiSubject(job.userId, platform.id);

    if (subject === null) {
      return "student_unlinked";
    }

    return {
      assignment,
      platform,
      lineItemUrl: link.agsLineItemUrl,
      subject,
    };
  }

  private async recordFailure(
    job: LtiGradeJob,
    error: unknown,
    nowDate: Date,
  ): Promise<"retried" | "failed" | "superseded"> {
    const attemptCount = job.attemptCount + 1;
    // An unexpected exception is treated as transient: a bug or outage on
    // our side should not permanently park a grade.
    const retryable =
      error instanceof ScoreDeliveryError ? error.retryable : true;
    const reason: LtiGradeFailureReason =
      error instanceof ScoreDeliveryError ? error.reason : "unexpected";
    const detail =
      error instanceof ScoreDeliveryError
        ? error.detail
        : error instanceof Error
          ? error.message
          : null;
    const nextAttemptAt =
      retryable && attemptCount < GRADE_JOB_MAX_ATTEMPTS
        ? addSeconds(
            nowDate,
            RETRY_DELAYS_SECONDS[
              Math.min(attemptCount, RETRY_DELAYS_SECONDS.length) - 1
            ] ?? 0,
          )
        : null;

    const failed = await this.options.stores.lti.failGradeJob({
      id: job.id,
      claimedAt: job.updatedAt,
      attemptCount,
      reason,
      detail,
      nextAttemptAt,
      now: timestampNow(nowDate),
    });

    // The row was re-pointed at a newer score (or reclaimed) while this
    // delivery was failing; that fresh send owns the row now, and recording
    // this attempt against it would misdescribe the newer score.
    if (failed === null) {
      return "superseded";
    }

    this.logFailure(
      job,
      reason,
      detail,
      nextAttemptAt === null ? "permanent" : "retry_scheduled",
    );

    return nextAttemptAt === null ? "failed" : "retried";
  }

  private logFailure(
    job: LtiGradeJob,
    reason: LtiGradeFailureReason,
    detail: string | null,
    disposition: "permanent" | "retry_scheduled",
  ): void {
    console.error("lti_grade_passback_failed", {
      attemptCount: job.attemptCount + 1,
      detail: detail ?? "",
      disposition,
      jobId: job.id,
      reason,
      requestId: this.options.requestId ?? "",
      resourceLinkId: job.resourceLinkId,
    });
  }

  /**
   * Permanently failed deliveries for a course, enriched for the instructor
   * panel: which student, which LMS activity, what went wrong.
   */
  async listFailedJobs(
    actor: AuthenticatedActor,
    courseId: string,
  ): Promise<GradeSyncFailure[]> {
    await requireInstructor(this.options.stores, actor, courseId);

    const jobs = await this.options.stores.lti.listGradeJobsForCourse(
      courseId,
      "failed",
    );
    const failures: GradeSyncFailure[] = [];

    for (const job of jobs) {
      const link = await this.options.stores.lti.getResourceLinkById(
        job.resourceLinkId,
      );
      const student = await this.options.stores.users.getById(job.userId);

      failures.push({
        activityTitle:
          link === null || link.title === "" ? "LMS activity" : link.title,
        job,
        student,
      });
    }

    return failures;
  }

  /** Re-queue a permanently failed delivery, instructor-gated by its course. */
  async retryJob(
    actor: AuthenticatedActor,
    jobId: string,
  ): Promise<LtiGradeJob> {
    const stores = this.options.stores;
    const job = await stores.lti.getGradeJobById(jobId);
    const link =
      job === null
        ? null
        : await stores.lti.getResourceLinkById(job.resourceLinkId);
    const context =
      link === null ? null : await stores.lti.getContextById(link.contextId);

    if (job === null || context === null) {
      throw new AppHttpError(
        404,
        "grade_job_not_found",
        deferred.i18n.t("The grade sync record was not found."),
      );
    }

    await requireInstructor(this.options.stores, actor, context.courseId);

    const nowDate = this.options.now?.() ?? new Date();
    const retried = await stores.lti.retryGradeJob(
      job.id,
      timestampNow(nowDate),
    );

    if (retried === null) {
      throw badRequest(
        "grade_job_not_failed",
        deferred.i18n.t("Only a failed grade sync can be retried."),
      );
    }

    return retried;
  }
}
