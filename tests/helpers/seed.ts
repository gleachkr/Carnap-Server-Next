import type { AppStores } from "../../src/worker/application/stores";

export const SEED_NOW = "2026-01-01T00:00:00.000Z";

/**
 * The compiled column of a revision with nothing in it — valid, and empty.
 *
 * Worth spelling out rather than seeding `{}`: this used to be `{ blocks: [] }`,
 * which is not an artifact at all and is the exact shape of the hand-inserted
 * row that task #182 was filed about. It read back as a silent cast on one
 * route and an unhandled `TypeError` on another, and a helper that plants it in
 * every fixture is a helper that teaches the wrong shape.
 */
export const EMPTY_ARTIFACT = {
  componentRegistryVersion: "component-registry-v1",
  document: { nodes: [], profile: "carnap-markdown-v1" },
  manifest: [],
  manifestVersion: 1,
  sourceProfile: "carnap-markdown-v1",
};

export async function seedUser(stores: AppStores, id: string): Promise<void> {
  await stores.users.create({
    createdAt: SEED_NOW,
    email: `${id}@example.test`,
    id,
    name: id,
  });
}

/**
 * A course with one assignment on it, and the item and revision an assignment
 * cannot exist without. Returns the assignment id so the caller can hang
 * attempts off it.
 */
export async function seedCourseWithAssignment(
  stores: AppStores,
  key: string,
  ownerId: string,
  options: {
    readonly archived?: boolean;
    readonly maxAttempts?: number;
  } = {},
): Promise<string> {
  await stores.courses.create({
    createdAt: SEED_NOW,
    createdById: ownerId,
    id: `course-${key}`,
    timezone: "UTC",
    title: `Course ${key}`,
  });

  if (options.archived === true) {
    await stores.courses.setArchived({
      archivedAt: SEED_NOW,
      id: `course-${key}`,
      updatedAt: SEED_NOW,
    });
  }

  await stores.content.createItem({
    createdAt: SEED_NOW,
    id: `item-${key}`,
    ownerUserId: ownerId,
    title: `Item ${key}`,
  });
  await stores.content.createRevision({
    compiled: EMPTY_ARTIFACT,
    contentHash: `hash-${key}`,
    createdAt: SEED_NOW,
    createdById: ownerId,
    details: "",
    id: `revision-${key}`,
    itemId: `item-${key}`,
    revisionNumber: 1,
    sourceFormat: "markdown",
    sourceText: "# Seed",
  });
  await stores.assignments.create({
    assessmentMode: "graded",
    availableFrom: null,
    availableUntil: null,
    contentRevisionId: `revision-${key}`,
    courseId: `course-${key}`,
    createdAt: SEED_NOW,
    createdById: ownerId,
    description: "",
    displayOrder: 0,
    dueAt: null,
    gradesVisibleAt: null,
    id: `assignment-${key}`,
    listed: true,
    maxAttempts: options.maxAttempts ?? 5,
    timeLimitMinutes: null,
    title: `Assignment ${key}`,
  });

  return `assignment-${key}`;
}

/** An attempt with one submission on it, optionally graded. */
export async function seedSubmission(
  stores: AppStores,
  key: string,
  assignmentId: string,
  userId: string,
  evaluatorKind: "automatic" | "manual" | null,
): Promise<void> {
  const attempt = await stores.assessment.beginAttempt({
    assignmentId,
    createdFrom: "student",
    expiresAt: null,
    id: `attempt-${key}`,
    maxAttempts: null,
    openedAt: SEED_NOW,
    userId,
  });

  if (attempt === null) {
    throw new Error(`Seeding attempt ${key} did not insert.`);
  }

  await stores.assessment.appendSubmission({
    answer: { value: key },
    attemptId: attempt.id,
    id: `submission-${key}`,
    idempotencyKey: null,
    submittedAt: SEED_NOW,
    userId,
  });

  if (evaluatorKind === null) {
    return;
  }

  await stores.assessment.appendEvaluation({
    checkerVersion: null,
    createdAt: SEED_NOW,
    evaluatorKind,
    id: `evaluation-${key}`,
    maxScore: 1,
    result: {},
    score: 1,
    submissionId: `submission-${key}`,
  });
}
