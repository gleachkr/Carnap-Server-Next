import {
  type Evaluation,
  evaluationVerdict,
  type ViewerEvaluation,
} from "./assessment";
import { type Assignment, gradesReleased } from "./assignments";
import type { ExerciseFeedback, ExerciseManifestItem } from "./exercises";

/**
 * What an author wrote on an exercise, as far as any of this cares.
 *
 * Both fields are optional and their absence is the interesting case: a
 * compiled artifact is shared across assignments, so "the author said nothing"
 * can only be resolved where an assignment and a clock are in scope.
 */
type Declaration = Pick<ExerciseManifestItem, "exam" | "feedback">;

/**
 * Whether this assignment is holding its grades back right now.
 *
 * The single predicate the three questions below are all defaulted from, and
 * the reason it is a function rather than `!gradesReleased(...)`: only a
 * `graded` assignment has a release gate at all. `practice` and `none` force
 * `gradesVisibleAt` to null, so asking `gradesReleased` about them answers
 * "no" — and a default keyed on that bare answer would switch feedback off for
 * every practice set and every reading in the system. Content viewed outside
 * an assignment is the author's own preview and is never withheld.
 */
export function gradesWithheld(
  assignment: Assignment | null,
  now: string,
): boolean {
  return (
    assignment !== null &&
    assignment.assessmentMode === "graded" &&
    !gradesReleased(assignment, now)
  );
}

/**
 * Whether this exercise keeps a wrong answer.
 *
 * Withholding grades makes an exam and releasing them makes homework, so that
 * is what an author who says nothing gets. Writing `exam` either way overrides
 * it, and the explicit `false` is the whole reason this resolves at all: until
 * it did, "unset" and "false" were the same value, and an author had no way to
 * say "let them keep trying" on an assignment whose grades are still sealed.
 *
 * Resolved here rather than baked in at compile time because one compiled
 * artifact serves many assignments, and only the assignment knows whether it is
 * graded or whether its grades are out yet.
 */
export function resolveExerciseExam(
  declaration: Declaration | undefined,
  assignment: Assignment | null,
  now: string,
): boolean {
  return declaration?.exam ?? gradesWithheld(assignment, now);
}

/**
 * How much this reader may be told about this exercise, here, now.
 *
 * Its own leaf module because both halves of the app need it and neither should
 * import the other: the submission service asks it whether to hand back an
 * evaluation, and the render path asks it what to put in the widget's hydration
 * payload. Everything it needs is a declaration, an assignment, and a clock.
 *
 * Release is a *default*, not an override. It used to be checked first, which
 * meant that releasing grades clobbered an author who had written
 * `feedback="none"` on their own account — so an exercise reused across terms
 * handed out its answer key the moment the term's grades went out. What the
 * author wrote now stands in every configuration; release only settles what
 * they left unsaid.
 */
export function resolveExerciseFeedback(
  declaration: Declaration | undefined,
  assignment: Assignment | null,
  now: string,
): ExerciseFeedback {
  return (
    declaration?.feedback ??
    (gradesWithheld(assignment, now) ? "none" : "full")
  );
}

/**
 * Whether this reader must not be told whether the work is right.
 *
 * The same condition as `resolveExerciseFeedback(...) === "none"`, named for
 * what its callers do with it. It governs verdicts only — whether the recorded
 * evaluation's verdict comes back, and whether a review page marks the work up.
 * It does *not* govern what is recorded (that is `resolveExerciseExam`) and it
 * does not govern the numbers, which belong to grade release however loudly the
 * feedback setting is turned up.
 */
export function verdictSealed(
  declaration: Declaration | undefined,
  assignment: Assignment | null,
  now: string,
): boolean {
  return resolveExerciseFeedback(declaration, assignment, now) === "none";
}

/**
 * Whether this student may see this exercise's score, as a number.
 *
 * Two conditions, because a per-exercise score answers two questions at once.
 * It is a grade, so it waits for the release date — no `feedback` setting can
 * hand a number over early, which is the whole job the release date has. And it
 * is a verdict in numeric clothing, so an exercise that withholds the verdict
 * withholds this too, or `0 of 2` would say what `feedback="none"` refused to.
 *
 * The assignment total is the release date's alone: it is an aggregate, and it
 * stays visible over a sealed exercise. Which does mean a lone sealed exercise
 * can be read off the total by arithmetic — `feedback` is a display setting and
 * has never been a security boundary, and this is that same limit.
 */
export function exerciseScoreVisible(
  declaration: Declaration | undefined,
  assignment: Assignment | null,
  now: string,
): boolean {
  return (
    !verdictSealed(declaration, assignment, now) &&
    !gradesWithheld(assignment, now)
  );
}

/**
 * A stored evaluation as this student may see it, or null where they may not
 * see one at all.
 *
 * The one place the seal is applied, so the submit reply, the replay of an
 * idempotent submit, and the attempt history cannot drift apart on what a
 * student is owed. Instructors do not come through here — {@link viewerEvaluation}
 * is their way in, and it withholds nothing.
 */
export function studentEvaluation(
  evaluation: Evaluation | null,
  declaration: Declaration | undefined,
  assignment: Assignment | null,
  now: string,
): ViewerEvaluation | null {
  if (evaluation === null || verdictSealed(declaration, assignment, now)) {
    return null;
  }

  if (exerciseScoreVisible(declaration, assignment, now)) {
    return viewerEvaluation(evaluation);
  }

  return {
    ...viewerEvaluation(evaluation),
    maxScore: null,
    result: null,
    score: null,
  };
}

/**
 * A stored evaluation shown whole, with the verdict spelled out rather than
 * left to be inferred from the numbers. What an instructor sees, and what a
 * student sees once nothing is being withheld.
 */
export function viewerEvaluation(evaluation: Evaluation): ViewerEvaluation {
  return { ...evaluation, verdict: evaluationVerdict(evaluation) };
}
