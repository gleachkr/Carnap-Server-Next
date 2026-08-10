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
