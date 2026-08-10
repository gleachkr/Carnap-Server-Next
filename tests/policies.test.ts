import { describe, expect, test } from "bun:test";

import { effectiveAssignmentPolicy } from "../src/worker/application/policies";
import type { Attempt } from "../src/worker/domain/assessment";
import type { Assignment } from "../src/worker/domain/assignments";

const NOW = "2026-01-02T03:04:05.000Z";

function assignment(fields: Partial<Assignment> = {}): Assignment {
  return {
    assessmentMode: "graded",
    displayOrder: 0,
    availableFrom: null,
    availableUntil: null,
    contentRevisionId: "revision-1",
    courseId: "course-1",
    createdAt: NOW,
    createdById: "instructor-1",
    description: "Practice.",
    dueAt: null,
    gradesVisibleAt: null,
    id: "assignment-1",
    listed: true,
    maxAttempts: 1,
    publishedAt: NOW,
    state: "published",
    timeLimitMinutes: null,
    title: "Homework",
    updatedAt: NOW,
    ...fields,
  };
}

function attempt(fields: Partial<Attempt> = {}): Attempt {
  return {
    assignmentId: "assignment-1",
    createdFrom: "student",
    expiresAt: null,
    id: "attempt-1",
    openedAt: NOW,
    ordinal: 1,
    status: "submitted",
    submittedAt: NOW,
    userId: "student-1",
    voidReason: null,
    voidedAt: null,
    voidedById: null,
    ...fields,
  };
}

describe("assignment policy", () => {
  test("availability opens inclusively and closes exclusively", () => {
    const opensNow = effectiveAssignmentPolicy(
      assignment({ availableFrom: NOW }),
      [],
      NOW,
    );
    const closesNow = effectiveAssignmentPolicy(
      assignment({ availableUntil: NOW }),
      [],
      NOW,
    );

    expect(opensNow.canView).toBe(true);
    expect(opensNow.canBegin).toBe(true);
    expect(closesNow.canView).toBe(false);
    expect(closesNow.reasons).toContain("assignment_closed");
  });

  test("max attempts counts non-voided history", () => {
    const reached = effectiveAssignmentPolicy(
      assignment({ maxAttempts: 1 }),
      [attempt()],
      NOW,
    );
    const reset = effectiveAssignmentPolicy(
      assignment({ maxAttempts: 1 }),
      [attempt({ status: "voided", voidedAt: NOW })],
      NOW,
    );

    expect(reached.canBegin).toBe(false);
    expect(reached.reasons).toContain("attempt_limit_reached");
    expect(reset.canBegin).toBe(true);
  });

  test("expired active attempts do not block a new begin decision", () => {
    const policy = effectiveAssignmentPolicy(
      assignment({ maxAttempts: 2 }),
      [
        attempt({
          expiresAt: "2026-01-02T03:04:04.000Z",
          status: "active",
          submittedAt: null,
        }),
      ],
      NOW,
    );

    expect(policy.canBegin).toBe(true);
    expect(policy.reasons).not.toContain("active_attempt_exists");
  });
});
