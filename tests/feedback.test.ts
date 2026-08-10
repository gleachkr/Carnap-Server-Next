import { describe, expect, test } from "bun:test";
import type {
  AssessmentMode,
  Assignment,
} from "../src/worker/domain/assignments";
import type {
  ExerciseFeedback,
  ExerciseManifestItem,
} from "../src/worker/domain/exercises";
import {
  gradesWithheld,
  resolveExerciseExam,
  resolveExerciseFeedback,
  verdictSealed,
} from "../src/worker/domain/feedback";

const NOW = "2026-08-07T12:00:00.000Z";
const PAST = "2026-08-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

function assignment(
  assessmentMode: AssessmentMode,
  gradesVisibleAt: string | null = null,
): Assignment {
  return {
    assessmentMode,
    availableFrom: null,
    availableUntil: null,
    contentRevisionId: "revision",
    courseId: "course",
    createdAt: NOW,
    createdById: "author",
    description: "",
    displayOrder: 0,
    dueAt: null,
    gradesVisibleAt,
    id: "assignment",
    listed: true,
    maxAttempts: 0,
    publishedAt: NOW,
    state: "published",
    timeLimitMinutes: null,
    title: "Problem set",
    updatedAt: NOW,
  } as Assignment;
}

type Declaration = Pick<ExerciseManifestItem, "exam" | "feedback">;

/**
 * One row of the authored matrix: what the author wrote, and what the two
 * resolvers must make of it.
 *
 * Written out rather than computed from the same expression the resolvers use.
 * A test that re-derives the answer only proves the formula equals itself; this
 * one states the intended behaviour of every reachable cell, so changing the
 * formula has to argue with the table.
 */
type Row = readonly [
  exam: boolean | undefined,
  feedback: ExerciseFeedback | undefined,
  resolvedExam: boolean,
  resolvedFeedback: ExerciseFeedback,
];

/**
 * Grades withheld: the assignment is an exam until told otherwise. Nothing
 * written means every submission is kept and the student is told nothing.
 */
const WITHHELD: readonly Row[] = [
  [undefined, undefined, true, "none"],
  [undefined, "none", true, "none"],
  [undefined, "terse", true, "terse"],
  [undefined, "full", true, "full"],
  [true, undefined, true, "none"],
  [true, "none", true, "none"],
  [true, "terse", true, "terse"],
  [true, "full", true, "full"],
  // The pair that used to be a compile error: work thrown away rather than
  // recorded, and no verdict, so pressing Submit and watching whether it sticks
  // is the whole of what the student learns.
  [false, undefined, false, "none"],
  [false, "none", false, "none"],
  [false, "terse", false, "terse"],
  [false, "full", false, "full"],
];

/**
 * Grades released — and every practice set, reading and preview, which have no
 * release gate to be behind. The assignment is homework: retry until correct,
 * and say why.
 */
const RELEASED: readonly Row[] = [
  [undefined, undefined, false, "full"],
  [undefined, "none", false, "none"],
  [undefined, "terse", false, "terse"],
  [undefined, "full", false, "full"],
  [true, undefined, true, "full"],
  [true, "none", true, "none"],
  [true, "terse", true, "terse"],
  [true, "full", true, "full"],
  [false, undefined, false, "full"],
  [false, "none", false, "none"],
  [false, "terse", false, "terse"],
  [false, "full", false, "full"],
];

function check(
  rows: readonly Row[],
  target: Assignment | null,
  where: string,
): void {
  for (const [exam, feedback, resolvedExam, resolvedFeedback] of rows) {
    // Absent means an absent key, not a key holding undefined — which is what
    // the manifest actually produces, and what `??` is reading.
    const declaration: Declaration = {
      ...(exam === undefined ? {} : { exam }),
      ...(feedback === undefined ? {} : { feedback }),
    };
    const wrote = `exam=${String(exam)} feedback=${String(feedback)}`;

    expect(
      [where, wrote, resolveExerciseExam(declaration, target, NOW)],
      `${where}: ${wrote}`,
    ).toEqual([where, wrote, resolvedExam]);
    expect(
      [where, wrote, resolveExerciseFeedback(declaration, target, NOW)],
      `${where}: ${wrote}`,
    ).toEqual([where, wrote, resolvedFeedback]);
  }
}

describe("the exam and feedback matrix", () => {
  test("an assignment holding its grades back is an exam", () => {
    check(WITHHELD, assignment("graded"), "never released");
    check(WITHHELD, assignment("graded", FUTURE), "release still ahead");
  });

  test("an assignment that has released them is homework", () => {
    check(RELEASED, assignment("graded", PAST), "released");
  });

  test("practice, readings and previews are never withheld", () => {
    // These force `gradesVisibleAt` to null, so a default keyed on the bare
    // `gradesReleased` would read them as sealed forever.
    check(RELEASED, assignment("practice"), "practice");
    check(RELEASED, assignment("none"), "reading");
    check(RELEASED, null, "no assignment");
  });

  test("an author who says nothing at all still resolves", () => {
    expect(resolveExerciseExam(undefined, assignment("graded"), NOW)).toBe(
      true,
    );
    expect(
      resolveExerciseFeedback(undefined, assignment("graded"), NOW),
    ).toBe("none");
    expect(resolveExerciseExam(undefined, null, NOW)).toBe(false);
    expect(resolveExerciseFeedback(undefined, null, NOW)).toBe("full");
  });
});

describe("grades withheld", () => {
  test("is a graded assignment whose release has not arrived", () => {
    expect(gradesWithheld(assignment("graded"), NOW)).toBe(true);
    expect(gradesWithheld(assignment("graded", FUTURE), NOW)).toBe(true);
    expect(gradesWithheld(assignment("graded", PAST), NOW)).toBe(false);
    expect(gradesWithheld(assignment("practice"), NOW)).toBe(false);
    expect(gradesWithheld(assignment("none"), NOW)).toBe(false);
    expect(gradesWithheld(null, NOW)).toBe(false);
  });
});

describe("the verdict seal", () => {
  test("is exactly feedback none, released or not", () => {
    const withheld = assignment("graded");
    const released = assignment("graded", PAST);

    expect(verdictSealed({ feedback: "none" }, withheld, NOW)).toBe(true);
    expect(verdictSealed({ feedback: "terse" }, withheld, NOW)).toBe(false);

    // The point of taking release out of the override position: an author who
    // never wants the answer key handed out keeps it shut after the grades go
    // out, and an exercise reused next term still works.
    expect(verdictSealed({ feedback: "none" }, released, NOW)).toBe(true);
    expect(verdictSealed({}, released, NOW)).toBe(false);

    // And the default seals a withheld assignment without the author lifting a
    // finger, which is the report this whole setting came from.
    expect(verdictSealed({}, withheld, NOW)).toBe(true);
  });
});
