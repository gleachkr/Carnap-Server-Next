import type { Assignment } from "../domain/assignments";
import type { AppId } from "../domain/ids";
import { assignmentNotFound } from "./errors";
import {
  effectivePolicyAssignment,
  type PolicyAdjustments,
  type PolicyAssignment,
} from "./policies";
import type { AppStores } from "./stores";

/**
 * The two reads every service that acts on one assignment starts with: the
 * assignment itself, checked to be the course's, and the adjustments one
 * student is held to it under. Five services had each spelled both.
 */

/**
 * The assignment, or a 404 — the same 404 whether it does not exist or
 * belongs to another course, so a URL cannot be used to learn which.
 */
export async function assignmentInCourse(
  stores: AppStores,
  courseId: AppId,
  assignmentId: AppId,
): Promise<Assignment> {
  const assignment = await stores.assignments.getById(assignmentId);

  if (assignment === null || assignment.courseId !== courseId) {
    throw assignmentNotFound();
  }

  return assignment;
}

/** One student's accommodation and override on an assignment, read together. */
export async function adjustmentsForUser(
  stores: AppStores,
  assignment: Assignment,
  userId: AppId,
): Promise<PolicyAdjustments> {
  const [accommodation, override] = await Promise.all([
    stores.courses.getAccommodation(assignment.courseId, userId),
    stores.assignments.getOverrideForAssignmentUser(assignment.id, userId),
  ]);

  return { accommodation, override };
}

/** The assignment's dates and allowances as one student is held to them. */
export async function effectiveAssignmentForUser(
  stores: AppStores,
  assignment: Assignment,
  userId: AppId,
): Promise<PolicyAssignment> {
  return effectivePolicyAssignment(
    assignment,
    await adjustmentsForUser(stores, assignment, userId),
  );
}
