import type { AppId } from "./ids";
import type { Timestamp } from "./time";

export type AssignmentScoreStatus =
  | "complete"
  | "missing"
  | "not-started"
  | "partial";

export interface AssignmentScore {
  readonly assignmentId: AppId;
  readonly userId: AppId;
  readonly score: number;
  readonly maxScore: number;
  readonly status: AssignmentScoreStatus;
  readonly calculatedAt: Timestamp;
}

/**
 * Points to the hundredth, which is as fine as a grade is entered: the
 * grading form steps by 0.01. Every sum of points and every late penalty
 * passes through here, so a page, a CSV and an LMS show the same number, and
 * none of them shows binary-float noise like 2.3000000000000003.
 *
 * The product is first cut to twelve significant digits so that a value
 * lying a hair under a half-hundredth only because of its binary spelling
 * (1.005 is stored as 1.00499…) rounds the way its decimal spelling reads.
 */
export function roundPoints(points: number): number {
  return Math.round(Number((points * 100).toPrecision(12))) / 100;
}
