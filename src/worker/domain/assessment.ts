import type { AppId } from "./ids";
import type { JsonValue } from "./json";
import type { Timestamp } from "./time";

export type AttemptCreatedFrom = "student" | "reset";
export type AttemptStatus = "active" | "submitted" | "expired" | "voided";
export type EvaluatorKind = "automatic" | "manual";

export interface Attempt {
  readonly id: AppId;
  readonly assignmentId: AppId;
  readonly userId: AppId;
  readonly ordinal: number;
  readonly status: AttemptStatus;
  readonly openedAt: Timestamp;
  readonly expiresAt: Timestamp | null;
  readonly submittedAt: Timestamp | null;
  readonly voidedAt: Timestamp | null;
  readonly voidedById: AppId | null;
  readonly voidReason: string | null;
  readonly createdFrom: AttemptCreatedFrom;
}

export interface Submission {
  readonly id: AppId;
  readonly attemptId: AppId;
  readonly userId: AppId;
  readonly contentRevisionId: AppId | null;
  readonly exerciseId: string | null;
  readonly declarationHash: string | null;
  readonly answerKind: string | null;
  readonly idempotencyKey: string | null;
  readonly answer: JsonValue;
  readonly submittedAt: Timestamp;
}

export interface Evaluation {
  readonly id: AppId;
  readonly submissionId: AppId;
  readonly evaluatorKind: EvaluatorKind;
  readonly checkerVersion: string | null;
  readonly result: JsonValue;
  readonly score: number;
  /**
   * What the work was graded out of: the exercise's declared points, copied
   * from the assignment's pinned revision at grading time. Every writer copies
   * that same figure — the autograder via `nominalMaxScore`, hand grading via
   * `nominalPointsFor`, approval from the automatic evaluation it stands
   * behind — so this is never a number anyone typed.
   *
   * It is a historical record, not a cache. Repointing the assignment at a
   * revision with different points does not restamp it: the verdict, the
   * review queue, and every "4/5" display keep reading the denominator the
   * student actually faced, while assignment totals divide by the current
   * manifest's points (`calculateAssignmentScore`). When the two disagree,
   * {@link storedPointsDrift} is how a view says so.
   */
  readonly maxScore: number;
  readonly createdAt: Timestamp;
  readonly voidedAt: Timestamp | null;
}

/**
 * The columns of a submission that scoring reads.
 *
 * A gradebook sums every submission a class has made, and the one column it
 * never looks at — `answer` — is the one that carries the weight: a proof
 * certificate, a filled truth table, an essay. This is the same row without
 * it, so a bulk read for scoring moves ids and timestamps and not the work.
 */
export type SubmissionForScoring = Pick<
  Submission,
  "attemptId" | "exerciseId" | "id" | "submittedAt" | "userId"
>;

/**
 * The columns of an evaluation that scoring reads. `result` — the checker's
 * whole payload — stays behind for the same reason `answer` does above, and
 * `maxScore` because a total divides by the manifest's points, not by what
 * the work was graded out of (see {@link Evaluation.maxScore}).
 */
export type EvaluationForScoring = Pick<
  Evaluation,
  "createdAt" | "evaluatorKind" | "id" | "score" | "submissionId" | "voidedAt"
>;

export type EvaluationVerdict = "correct" | "partial" | "incorrect";

/**
 * Whether what the server holds is right, said without saying by how much.
 *
 * Partial credit is not correct, which is the same line the correctness mark
 * has always drawn. It exists so that a reader who may be told the verdict but
 * not the numbers can be told the verdict: derived here, where the numbers are
 * still in hand, rather than in a browser that no longer has them.
 */
export function evaluationVerdict(
  evaluation: Pick<Evaluation, "maxScore" | "score">,
): EvaluationVerdict {
  if (evaluation.maxScore > 0 && evaluation.score >= evaluation.maxScore) {
    return "correct";
  }

  return evaluation.score > 0 ? "partial" : "incorrect";
}

/**
 * An evaluation as some particular reader may see it.
 *
 * The stored {@link Evaluation} always has its numbers; this is what survives
 * being shown to someone. A score is a grade, and grades belong to the release
 * date however loudly an exercise's `feedback` is turned up — so a student
 * working a graded assignment before release can be told their proof is wrong
 * (`feedback="full"`) while the 0 of 2 stays behind the release. The nulls are
 * the point of the type: a caller cannot read a number without deciding what to
 * do when it is not there.
 *
 * `result` goes with them. It is the raw checker payload, and it carries the
 * awarded score inside it, so leaving it whole would hand back through the side
 * door exactly what the nulls closed the front one on.
 */
export interface ViewerEvaluation
  extends Omit<Evaluation, "maxScore" | "result" | "score"> {
  readonly maxScore: number | null;
  readonly result: JsonValue | null;
  readonly score: number | null;
  readonly verdict: EvaluationVerdict;
}

/**
 * How an evaluation's stored denominator disagrees with what the assignment
 * counts the exercise at today, or null when it does not.
 *
 * The disagreement is real and deliberate: after a repoint that changed an
 * exercise's points, the evaluation keeps saying what the work was graded out
 * of while the total divides by the current figure. This is where a view asks
 * so it can say so out loud — a tint and a note on the score, a banner over
 * the page — rather than leaving a reader to reconcile "4/5" against a total
 * out of 2 by arithmetic.
 *
 * A sealed evaluation (`maxScore: null`) never drifts: numbers a reader may
 * not see cannot be annotated without being disclosed.
 */
export type StoredPointsDrift =
  | { readonly kind: "changed"; readonly nominalPoints: number }
  | { readonly kind: "removed" };

export function storedPointsDrift(
  evaluation: Pick<ViewerEvaluation, "maxScore"> | null,
  nominalPoints: number | null,
): StoredPointsDrift | null {
  if (evaluation === null || evaluation.maxScore === null) {
    return null;
  }

  if (nominalPoints === null) {
    return { kind: "removed" };
  }

  return evaluation.maxScore === nominalPoints
    ? null
    : { kind: "changed", nominalPoints };
}

/**
 * Whether an instructor still needs to look at a submission, given its
 * effective (live, manual-preferred) evaluation. The autograder is trusted for
 * full marks, so a full-credit automatic score drops off the review queue; a
 * manual evaluation means an instructor has already signed off. Everything
 * else wants a human's eye: partial or zero autograded credit, and
 * manually graded kinds (free response) that have no evaluation yet.
 */
export function submissionNeedsReview(
  evaluation: Pick<
    ViewerEvaluation,
    "evaluatorKind" | "maxScore" | "score"
  > | null,
): boolean {
  if (evaluation === null) {
    return true;
  }

  if (evaluation.evaluatorKind === "manual") {
    return false;
  }

  // Numbers a reader may not see cannot clear a submission off the queue —
  // though in practice only instructors ask this, and nothing is kept from
  // them.
  if (evaluation.score === null || evaluation.maxScore === null) {
    return true;
  }

  return evaluation.score < evaluation.maxScore;
}
