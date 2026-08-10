import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  like,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import type {
  AddCourseAccommodationInput,
  AddCourseMembershipInput,
  AdminAuditStore,
  AdminStatsStore,
  AppendEvaluationInput,
  AppendSubmissionInput,
  AppStores,
  AssessmentStore,
  AssignmentStore,
  AuthStore,
  BeginAttemptInput,
  ContentStore,
  CourseStore,
  CreateAdminAuditEventInput,
  CreateAssignmentInput,
  CreateAuthSessionInput,
  CreateContentItemInput,
  CreateContentRevisionInput,
  CreateCourseInput,
  CreateEnrollmentLinkInput,
  CreateExternalIdentityInput,
  CreateLtiContextInput,
  CreateLtiDeepLinkRequestInput,
  CreateLtiDeploymentInput,
  CreateLtiLinkChallengeInput,
  CreateLtiLoginStateInput,
  CreateLtiPlatformInput,
  CreateNativeLoginChallengeInput,
  CreateUserInput,
  DeleteAssignmentInput,
  EnqueueLtiGradeJobInput,
  ExcuseAssignmentExerciseInput,
  FailLtiGradeJobInput,
  GrantPlatformCapabilityInput,
  LtiStore,
  PlatformCapabilityStore,
  PublishAssignmentInput,
  RepointPublishedAssignmentInput,
  ResetAttemptInput,
  RevokeEnrollmentLinkInput,
  RevokePlatformCapabilityInput,
  ScoreStore,
  SetCourseArchivedInput,
  SetGradesVisibleAtInput,
  UnpublishAssignmentInput,
  UpdateAssignmentInput,
  UpdateCourseInfoInput,
  UpdateCourseMembershipRoleInput,
  UpdateCourseMembershipStatusInput,
  UpdatePublishedSettingsInput,
  UpdateUserProfileInput,
  UpsertAssignmentOverrideInput,
  UpsertAssignmentScoreInput,
  UpsertCourseMembershipInput,
  UpsertLatePolicyInput,
  UpsertLtiResourceLinkInput,
  UserStore,
} from "../../application/stores";
import type {
  AdminAuditEvent,
  AdminGlobalStats,
  PlatformCapabilityGrant,
} from "../../domain/admin";
import type {
  Attempt,
  Evaluation,
  Submission,
} from "../../domain/assessment";
import type {
  Assignment,
  AssignmentContentVersion,
  AssignmentExerciseExcuse,
  AssignmentLatePolicy,
  AssignmentOverride,
} from "../../domain/assignments";
import type { AuthSession, NativeLoginChallenge } from "../../domain/auth";
import type { ContentItem, ContentRevision } from "../../domain/content";
import type {
  Course,
  CourseAccommodation,
  CourseEnrollmentLink,
  CourseMembership,
} from "../../domain/courses";
import type { AssignmentScore } from "../../domain/grades";
import type { AppId } from "../../domain/ids";
import { assertJsonValue } from "../../domain/json";
import type {
  LtiContext,
  LtiDeepLinkRequest,
  LtiDeployment,
  LtiGradeJob,
  LtiGradeJobStatus,
  LtiLinkChallenge,
  LtiLoginState,
  LtiPlatform,
  LtiResourceLink,
} from "../../domain/lti";
import type { ExternalIdentity, User } from "../../domain/users";
import type { AppDatabase } from "./database";
import {
  adminAuditEvents,
  assignmentContentVersions,
  assignmentExerciseExcuses,
  assignmentLatePolicies,
  assignmentOverrides,
  assignmentScores,
  assignments,
  attempts,
  authSessions,
  contentItems,
  contentRevisions,
  courseAccommodations,
  courseEnrollmentLinks,
  courseMemberships,
  courses,
  evaluations,
  externalIdentities,
  ltiContexts,
  ltiDeepLinkRequests,
  ltiDeployments,
  ltiGradeJobs,
  ltiLinkChallenges,
  ltiLoginStates,
  ltiPlatforms,
  ltiResourceLinks,
  nativeLoginChallenges,
  platformCapabilityGrants,
  submissions,
  users,
} from "./schema";

function single<T>(rows: readonly T[]): T {
  const row = rows[0];

  if (row === undefined) {
    throw new Error("Expected database mutation to return one row.");
  }

  return row;
}

function nullableSingle<T>(rows: readonly T[]): T | null {
  return rows[0] ?? null;
}

function mapContentRevision(row: typeof contentRevisions.$inferSelect) {
  const compiled = row.compiledJson;

  assertJsonValue(compiled);

  return {
    id: row.id,
    itemId: row.itemId,
    revisionNumber: row.revisionNumber,
    details: row.details,
    sourceFormat: row.sourceFormat,
    sourceText: row.sourceText,
    contentHash: row.contentHash,
    compiled,
    createdById: row.createdById,
    createdAt: row.createdAt,
  } satisfies ContentRevision;
}

function mapSubmission(row: typeof submissions.$inferSelect) {
  const answer = row.answerJson;

  assertJsonValue(answer);

  return {
    id: row.id,
    attemptId: row.attemptId,
    userId: row.userId,
    contentRevisionId: row.contentRevisionId,
    exerciseId: row.exerciseId,
    declarationHash: row.declarationHash,
    answerKind: row.answerKind,
    idempotencyKey: row.idempotencyKey,
    answer,
    submittedAt: row.submittedAt,
  } satisfies Submission;
}

function mapAttempt(row: typeof attempts.$inferSelect): Attempt {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    userId: row.userId,
    ordinal: row.ordinal,
    status: row.status,
    openedAt: row.openedAt,
    expiresAt: row.expiresAt,
    submittedAt: row.submittedAt,
    voidedAt: row.voidedAt,
    voidedById: row.voidedById,
    voidReason: row.voidReason,
    createdFrom: row.createdFrom,
  };
}

/**
 * A row from a hand-written `RETURNING *`, translated into the shape the
 * schema describes. Only the query builder maps columns to properties; a
 * statement run through `db.all(sql`…`)` comes back exactly as the driver
 * returned it, under the database's own column names. Deriving the
 * translation from the table keeps it honest — rename a column in
 * `schema.ts` and this follows, where a hand-written twin of the row mapper
 * would quietly rot instead.
 */
function fromReturningRow<T extends SQLiteTable>(
  table: T,
  row: Record<string, unknown>,
): T["$inferSelect"] {
  const mapped: Record<string, unknown> = {};

  for (const [property, column] of Object.entries(getTableColumns(table))) {
    mapped[property] = row[column.name] ?? null;
  }

  return mapped as T["$inferSelect"];
}

function mapRawAttempt(row: Record<string, unknown>): Attempt {
  return mapAttempt(fromReturningRow(attempts, row));
}

/**
 * The single write shape for the grade-passback outbox: insert the row, or —
 * whatever state the existing row is in — re-point it at the newest score as
 * a fresh pending send. Resetting a mid-flight `sending` row is deliberate:
 * the in-flight delivery's completion update is guarded on the claim stamp,
 * so it cannot bury this newer score. The `setWhere` guard is the reverse
 * protection: a refresh that raced a newer one and lost writes nothing, so a
 * fresher queued score is never re-pointed at a stale one.
 */
function gradeJobUpsertQuery(
  db: AppDatabase,
  input: EnqueueLtiGradeJobInput,
) {
  return db
    .insert(ltiGradeJobs)
    .values({
      id: input.id,
      resourceLinkId: input.resourceLinkId,
      userId: input.userId,
      score: input.score,
      maxScore: input.maxScore,
      scoreTimestamp: input.scoreTimestamp,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: input.now,
      lastFailureReason: null,
      lastErrorDetail: null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [ltiGradeJobs.resourceLinkId, ltiGradeJobs.userId],
      set: {
        score: input.score,
        maxScore: input.maxScore,
        scoreTimestamp: input.scoreTimestamp,
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: input.now,
        lastFailureReason: null,
        lastErrorDetail: null,
        updatedAt: input.now,
      },
      setWhere: sql`excluded.score_timestamp >= ${ltiGradeJobs.scoreTimestamp}`,
    })
    .returning();
}

function mapEvaluation(row: typeof evaluations.$inferSelect) {
  const result = row.resultJson;

  assertJsonValue(result);

  return {
    id: row.id,
    submissionId: row.submissionId,
    evaluatorKind: row.evaluatorKind,
    checkerVersion: row.checkerVersion,
    result,
    score: row.score,
    maxScore: row.maxScore,
    createdAt: row.createdAt,
    voidedAt: row.voidedAt,
  } satisfies Evaluation;
}

function mapAssignment(row: typeof assignments.$inferSelect): Assignment {
  return {
    id: row.id,
    courseId: row.courseId,
    contentRevisionId: row.contentRevisionId,
    title: row.title,
    description: row.description,
    state: row.state,
    assessmentMode: row.assessmentMode,
    displayOrder: row.displayOrder,
    availableFrom: row.availableFrom,
    dueAt: row.dueAt,
    availableUntil: row.availableUntil,
    gradesVisibleAt: row.gradesVisibleAt,
    listed: row.listed,
    maxAttempts: row.maxAttempts,
    timeLimitMinutes: row.timeLimitMinutes,
    createdById: row.createdById,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAssignmentContentVersion(
  row: typeof assignmentContentVersions.$inferSelect,
): AssignmentContentVersion {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    contentRevisionId: row.contentRevisionId,
    effectiveAt: row.effectiveAt,
    actorId: row.actorId,
    note: row.note,
  };
}

function mapAssignmentExerciseExcuse(
  row: typeof assignmentExerciseExcuses.$inferSelect,
): AssignmentExerciseExcuse {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    exerciseId: row.exerciseId,
    status: row.status,
    actorId: row.actorId,
    createdAt: row.createdAt,
    reason: row.reason,
  };
}

function mapAssignmentLatePolicy(
  row: typeof assignmentLatePolicies.$inferSelect,
): AssignmentLatePolicy {
  return {
    assignmentId: row.assignmentId,
    kind: row.kind,
    percentPenalty: row.percentPenalty,
    maxPercentPenalty: row.maxPercentPenalty,
    graceMinutes: row.graceMinutes,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAssignmentOverride(
  row: typeof assignmentOverrides.$inferSelect,
): AssignmentOverride {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    userId: row.userId,
    availableFrom: row.availableFrom,
    dueAt: row.dueAt,
    availableUntil: row.availableUntil,
    maxAttempts: row.maxAttempts,
    timeLimitMinutes: row.timeLimitMinutes,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapCourseAccommodation(
  row: typeof courseAccommodations.$inferSelect,
): CourseAccommodation {
  return {
    id: row.id,
    courseId: row.courseId,
    userId: row.userId,
    extraAttempts: row.extraAttempts,
    timeLimitMultiplier: row.timeLimitMultiplier,
    dueAtExtensionMinutes: row.dueAtExtensionMinutes,
    availableUntilExtensionMinutes: row.availableUntilExtensionMinutes,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAssignmentScore(
  row: typeof assignmentScores.$inferSelect,
): AssignmentScore {
  return {
    assignmentId: row.assignmentId,
    userId: row.userId,
    score: row.score,
    maxScore: row.maxScore,
    status: row.status,
    calculatedAt: row.calculatedAt,
  };
}

function mapPlatformCapabilityGrant(
  row: typeof platformCapabilityGrants.$inferSelect,
): PlatformCapabilityGrant {
  return {
    capability: row.capability,
    grantedAt: row.grantedAt,
    grantedById: row.grantedById,
    id: row.id,
    revokedAt: row.revokedAt,
    userId: row.userId,
  };
}

function mapAdminAuditEvent(
  row: typeof adminAuditEvents.$inferSelect,
): AdminAuditEvent {
  const metadata = row.metadataJson;

  assertJsonValue(metadata);

  return {
    action: row.action,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt,
    id: row.id,
    metadata,
    requestId: row.requestId,
    targetCourseId: row.targetCourseId,
    targetUserId: row.targetUserId,
  };
}

class SqliteUserStore implements UserStore {
  constructor(private readonly db: AppDatabase) {}

  async create(input: CreateUserInput): Promise<User> {
    return single(
      await this.db
        .insert(users)
        .values({
          id: input.id,
          email: input.email,
          emailVerifiedAt: input.emailVerifiedAt ?? null,
          name: input.name,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        })
        .returning(),
    );
  }

  async markEmailVerified(
    id: AppId,
    verifiedAt: string,
  ): Promise<User | null> {
    return nullableSingle(
      await this.db
        .update(users)
        .set({ emailVerifiedAt: verifiedAt, updatedAt: verifiedAt })
        .where(and(eq(users.id, id), isNull(users.emailVerifiedAt)))
        .returning(),
    );
  }

  async disable(id: AppId, disabledAt: string): Promise<User | null> {
    return nullableSingle(
      await this.db
        .update(users)
        .set({ disabledAt, updatedAt: disabledAt })
        .where(eq(users.id, id))
        .returning(),
    );
  }

  async enable(id: AppId, updatedAt: string): Promise<User | null> {
    return nullableSingle(
      await this.db
        .update(users)
        .set({ disabledAt: null, updatedAt })
        .where(eq(users.id, id))
        .returning(),
    );
  }

  async updateProfile(
    id: AppId,
    input: UpdateUserProfileInput,
    updatedAt: string,
  ): Promise<User | null> {
    return nullableSingle(
      await this.db
        .update(users)
        .set({ locale: input.locale, name: input.name, updatedAt })
        .where(eq(users.id, id))
        .returning(),
    );
  }

  async getByEmail(email: string): Promise<User | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1),
    );
  }

  async getById(id: AppId): Promise<User | null> {
    return nullableSingle(
      await this.db.select().from(users).where(eq(users.id, id)).limit(1),
    );
  }

  async listExternalIdentitiesForUser(
    userId: AppId,
  ): Promise<ExternalIdentity[]> {
    return this.db
      .select()
      .from(externalIdentities)
      .where(eq(externalIdentities.userId, userId))
      .orderBy(asc(externalIdentities.createdAt), asc(externalIdentities.id));
  }

  async deleteExternalIdentity(id: AppId): Promise<boolean> {
    const deleted = await this.db
      .delete(externalIdentities)
      .where(eq(externalIdentities.id, id))
      .returning();

    return deleted.length > 0;
  }

  async search(input: {
    readonly limit: number;
    readonly query: string;
  }): Promise<User[]> {
    const query = input.query.trim();
    const limit = Math.min(Math.max(input.limit, 1), 50);

    if (query.length === 0) {
      return this.db
        .select()
        .from(users)
        .orderBy(asc(users.email), asc(users.id))
        .limit(limit);
    }

    const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const identityRows = await this.db
      .select({ user: users })
      .from(externalIdentities)
      .innerJoin(users, eq(externalIdentities.userId, users.id))
      .where(like(externalIdentities.providerSubject, pattern))
      .orderBy(asc(users.email), asc(users.id))
      .limit(limit);
    const directRows = await this.db
      .select()
      .from(users)
      .where(
        or(
          eq(users.id, query),
          like(users.email, pattern),
          like(users.name, pattern),
        ),
      )
      .orderBy(asc(users.email), asc(users.id))
      .limit(limit);
    const byId = new Map<string, User>();

    for (const user of directRows) {
      byId.set(user.id, user);
    }

    for (const row of identityRows) {
      byId.set(row.user.id, row.user);
    }

    return [...byId.values()].slice(0, limit);
  }

  async createExternalIdentity(
    input: CreateExternalIdentityInput,
  ): Promise<ExternalIdentity> {
    return single(
      await this.db.insert(externalIdentities).values(input).returning(),
    );
  }

  async getExternalIdentity(
    provider: ExternalIdentity["provider"],
    providerSubject: string,
  ): Promise<ExternalIdentity | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(externalIdentities)
        .where(
          and(
            eq(externalIdentities.provider, provider),
            eq(externalIdentities.providerSubject, providerSubject),
          ),
        )
        .limit(1),
    );
  }

  async getLtiSubject(
    userId: AppId,
    platformId: AppId,
  ): Promise<string | null> {
    // Platform row ids are UUIDs, so the prefix carries no LIKE wildcards.
    const prefix = `${platformId}:`;
    const row = nullableSingle(
      await this.db
        .select({ providerSubject: externalIdentities.providerSubject })
        .from(externalIdentities)
        .where(
          and(
            eq(externalIdentities.userId, userId),
            eq(externalIdentities.provider, "lti"),
            like(externalIdentities.providerSubject, `${prefix}%`),
          ),
        )
        .limit(1),
    );

    return row === null ? null : row.providerSubject.slice(prefix.length);
  }
}

class SqliteAuthStore implements AuthStore {
  constructor(private readonly db: AppDatabase) {}

  async createNativeLoginChallenge(
    input: CreateNativeLoginChallengeInput,
  ): Promise<NativeLoginChallenge> {
    return single(
      await this.db.insert(nativeLoginChallenges).values(input).returning(),
    );
  }

  async consumeNativeLoginChallenge(
    tokenHash: string,
    consumedAt: string,
  ): Promise<NativeLoginChallenge | null> {
    return nullableSingle(
      await this.db
        .update(nativeLoginChallenges)
        .set({ consumedAt })
        .where(
          and(
            eq(nativeLoginChallenges.tokenHash, tokenHash),
            isNull(nativeLoginChallenges.consumedAt),
            gt(nativeLoginChallenges.expiresAt, consumedAt),
          ),
        )
        .returning(),
    );
  }

  async createSession(input: CreateAuthSessionInput): Promise<AuthSession> {
    return single(
      await this.db.insert(authSessions).values(input).returning(),
    );
  }

  async getValidSession(
    tokenHash: string,
    now: string,
  ): Promise<AuthSession | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(authSessions)
        .where(
          and(
            eq(authSessions.tokenHash, tokenHash),
            isNull(authSessions.revokedAt),
            gt(authSessions.expiresAt, now),
          ),
        )
        .limit(1),
    );
  }

  async revokeSession(
    tokenHash: string,
    revokedAt: string,
  ): Promise<AuthSession | null> {
    return nullableSingle(
      await this.db
        .update(authSessions)
        .set({ revokedAt })
        .where(
          and(
            eq(authSessions.tokenHash, tokenHash),
            isNull(authSessions.revokedAt),
          ),
        )
        .returning(),
    );
  }
}

class SqliteCourseStore implements CourseStore {
  constructor(private readonly db: AppDatabase) {}

  async create(input: CreateCourseInput): Promise<Course> {
    return single(
      await this.db
        .insert(courses)
        .values({
          id: input.id,
          title: input.title,
          timezone: input.timezone,
          createdById: input.createdById,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        })
        .returning(),
    );
  }

  async getById(id: AppId): Promise<Course | null> {
    return nullableSingle(
      await this.db.select().from(courses).where(eq(courses.id, id)).limit(1),
    );
  }

  async updateInfo(input: UpdateCourseInfoInput): Promise<Course | null> {
    return nullableSingle(
      await this.db
        .update(courses)
        .set({
          title: input.title,
          timezone: input.timezone,
          updatedAt: input.updatedAt,
        })
        .where(eq(courses.id, input.id))
        .returning(),
    );
  }

  async setArchived(input: SetCourseArchivedInput): Promise<Course | null> {
    return nullableSingle(
      await this.db
        .update(courses)
        .set({
          archivedAt: input.archivedAt,
          updatedAt: input.updatedAt,
        })
        .where(eq(courses.id, input.id))
        .returning(),
    );
  }

  async addMembership(
    input: AddCourseMembershipInput,
  ): Promise<CourseMembership> {
    return single(
      await this.db
        .insert(courseMemberships)
        .values({
          id: input.id,
          courseId: input.courseId,
          userId: input.userId,
          role: input.role,
          status: input.status,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        })
        .returning(),
    );
  }

  async getAccommodation(
    courseId: AppId,
    userId: AppId,
  ): Promise<CourseAccommodation | null> {
    const row = nullableSingle(
      await this.db
        .select()
        .from(courseAccommodations)
        .where(
          and(
            eq(courseAccommodations.courseId, courseId),
            eq(courseAccommodations.userId, userId),
          ),
        )
        .limit(1),
    );

    return row === null ? null : mapCourseAccommodation(row);
  }

  async listAccommodationsForCourse(
    courseId: AppId,
  ): Promise<CourseAccommodation[]> {
    const rows = await this.db
      .select()
      .from(courseAccommodations)
      .where(eq(courseAccommodations.courseId, courseId))
      .orderBy(
        asc(courseAccommodations.createdAt),
        asc(courseAccommodations.id),
      );

    return rows.map(mapCourseAccommodation);
  }

  async getMembership(
    courseId: AppId,
    userId: AppId,
  ): Promise<CourseMembership | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(courseMemberships)
        .where(
          and(
            eq(courseMemberships.courseId, courseId),
            eq(courseMemberships.userId, userId),
          ),
        )
        .limit(1),
    );
  }

  async getMembershipById(
    courseId: AppId,
    membershipId: AppId,
  ): Promise<CourseMembership | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(courseMemberships)
        .where(
          and(
            eq(courseMemberships.courseId, courseId),
            eq(courseMemberships.id, membershipId),
          ),
        )
        .limit(1),
    );
  }

  async listForUser(userId: AppId) {
    const rows = await this.db
      .select({ course: courses, membership: courseMemberships })
      .from(courseMemberships)
      .innerJoin(courses, eq(courseMemberships.courseId, courses.id))
      .where(eq(courseMemberships.userId, userId))
      .orderBy(asc(courses.createdAt), asc(courses.id));

    return rows.map((row) => ({
      course: row.course,
      membership: row.membership,
    }));
  }

  async hasStaffMembership(userId: AppId): Promise<boolean> {
    // Archived courses count: somebody who taught last term is still an author,
    // and the term ending is not a reason to take their library away.
    const rows = await this.db
      .select({ id: courseMemberships.id })
      .from(courseMemberships)
      .where(
        and(
          eq(courseMemberships.userId, userId),
          eq(courseMemberships.status, "active"),
          inArray(courseMemberships.role, [
            "co_instructor",
            "instructor",
            "teacher_assistant",
          ]),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  async listAll(): Promise<Course[]> {
    return this.db
      .select()
      .from(courses)
      .orderBy(asc(courses.title), asc(courses.id));
  }

  async listMembershipsForCourse(
    courseId: AppId,
  ): Promise<CourseMembership[]> {
    return this.db
      .select()
      .from(courseMemberships)
      .where(eq(courseMemberships.courseId, courseId))
      .orderBy(asc(courseMemberships.createdAt), asc(courseMemberships.id));
  }

  async updateMembershipStatus(
    input: UpdateCourseMembershipStatusInput,
  ): Promise<CourseMembership | null> {
    return nullableSingle(
      await this.db
        .update(courseMemberships)
        .set({ status: input.status, updatedAt: input.updatedAt })
        .where(
          and(
            eq(courseMemberships.courseId, input.courseId),
            eq(courseMemberships.id, input.membershipId),
          ),
        )
        .returning(),
    );
  }

  async updateMembershipRole(
    input: UpdateCourseMembershipRoleInput,
  ): Promise<CourseMembership | null> {
    return nullableSingle(
      await this.db
        .update(courseMemberships)
        .set({ role: input.role, updatedAt: input.updatedAt })
        .where(
          and(
            eq(courseMemberships.courseId, input.courseId),
            eq(courseMemberships.id, input.membershipId),
          ),
        )
        .returning(),
    );
  }

  async upsertMembership(
    input: UpsertCourseMembershipInput,
  ): Promise<CourseMembership> {
    return single(
      await this.db
        .insert(courseMemberships)
        .values({
          courseId: input.courseId,
          createdAt: input.createdAt,
          id: input.id,
          role: input.role,
          status: input.status,
          updatedAt: input.updatedAt,
          userId: input.userId,
        })
        .onConflictDoUpdate({
          target: [courseMemberships.courseId, courseMemberships.userId],
          set: {
            role: input.role,
            status: input.status,
            updatedAt: input.updatedAt,
          },
        })
        .returning(),
    );
  }

  async createEnrollmentLink(
    input: CreateEnrollmentLinkInput,
  ): Promise<CourseEnrollmentLink> {
    return single(
      await this.db.insert(courseEnrollmentLinks).values(input).returning(),
    );
  }

  async getValidEnrollmentLink(
    tokenHash: string,
    now: string,
  ): Promise<CourseEnrollmentLink | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(courseEnrollmentLinks)
        .where(
          and(
            eq(courseEnrollmentLinks.tokenHash, tokenHash),
            isNull(courseEnrollmentLinks.revokedAt),
            gt(courseEnrollmentLinks.expiresAt, now),
          ),
        )
        .limit(1),
    );
  }

  async listEnrollmentLinksForCourse(
    courseId: AppId,
  ): Promise<CourseEnrollmentLink[]> {
    return this.db
      .select()
      .from(courseEnrollmentLinks)
      .where(eq(courseEnrollmentLinks.courseId, courseId))
      .orderBy(
        asc(courseEnrollmentLinks.createdAt),
        asc(courseEnrollmentLinks.id),
      );
  }

  async revokeEnrollmentLink(
    input: RevokeEnrollmentLinkInput,
  ): Promise<CourseEnrollmentLink | null> {
    return nullableSingle(
      await this.db
        .update(courseEnrollmentLinks)
        .set({ revokedAt: input.revokedAt })
        .where(
          and(
            eq(courseEnrollmentLinks.courseId, input.courseId),
            eq(courseEnrollmentLinks.id, input.linkId),
            isNull(courseEnrollmentLinks.revokedAt),
          ),
        )
        .returning(),
    );
  }

  async upsertAccommodation(
    input: AddCourseAccommodationInput,
  ): Promise<CourseAccommodation> {
    return mapCourseAccommodation(
      single(
        await this.db
          .insert(courseAccommodations)
          .values({
            id: input.id,
            courseId: input.courseId,
            userId: input.userId,
            extraAttempts: input.extraAttempts,
            timeLimitMultiplier: input.timeLimitMultiplier,
            dueAtExtensionMinutes: input.dueAtExtensionMinutes,
            availableUntilExtensionMinutes:
              input.availableUntilExtensionMinutes,
            createdById: input.createdById,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target: [
              courseAccommodations.courseId,
              courseAccommodations.userId,
            ],
            set: {
              availableUntilExtensionMinutes:
                input.availableUntilExtensionMinutes,
              dueAtExtensionMinutes: input.dueAtExtensionMinutes,
              extraAttempts: input.extraAttempts,
              timeLimitMultiplier: input.timeLimitMultiplier,
              updatedAt: input.now,
            },
          })
          .returning(),
      ),
    );
  }
}

class SqliteContentStore implements ContentStore {
  constructor(private readonly db: AppDatabase) {}

  async createItem(input: CreateContentItemInput): Promise<ContentItem> {
    return single(
      await this.db
        .insert(contentItems)
        .values({
          id: input.id,
          ownerUserId: input.ownerUserId,
          title: input.title,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        })
        .returning(),
    );
  }

  async getItem(id: AppId): Promise<ContentItem | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(contentItems)
        .where(eq(contentItems.id, id))
        .limit(1),
    );
  }

  async listItemsForOwner(ownerUserId: AppId): Promise<ContentItem[]> {
    return this.db
      .select()
      .from(contentItems)
      .where(eq(contentItems.ownerUserId, ownerUserId))
      .orderBy(asc(contentItems.updatedAt), asc(contentItems.id));
  }

  async createRevision(
    input: CreateContentRevisionInput,
  ): Promise<ContentRevision> {
    const insertRevision = this.db
      .insert(contentRevisions)
      .values({
        id: input.id,
        itemId: input.itemId,
        revisionNumber: input.revisionNumber,
        details: input.details,
        sourceFormat: input.sourceFormat,
        sourceText: input.sourceText,
        contentHash: input.contentHash,
        compiledJson: input.compiled,
        createdById: input.createdById,
        createdAt: input.createdAt,
      })
      .returning();
    const updateItem = this.db
      .update(contentItems)
      .set({ updatedAt: input.createdAt })
      .where(eq(contentItems.id, input.itemId))
      .returning();
    const [revisionRows] = await this.db.batch([insertRevision, updateItem]);

    return mapContentRevision(single(revisionRows));
  }

  async getRevision(id: AppId): Promise<ContentRevision | null> {
    const row = nullableSingle(
      await this.db
        .select()
        .from(contentRevisions)
        .where(eq(contentRevisions.id, id))
        .limit(1),
    );

    return row === null ? null : mapContentRevision(row);
  }

  async listRevisionsForItem(itemId: AppId): Promise<ContentRevision[]> {
    const rows = await this.db
      .select()
      .from(contentRevisions)
      .where(eq(contentRevisions.itemId, itemId))
      .orderBy(desc(contentRevisions.revisionNumber));

    return rows.map(mapContentRevision);
  }
}

class SqliteAssignmentStore implements AssignmentStore {
  constructor(private readonly db: AppDatabase) {}

  async create(input: CreateAssignmentInput): Promise<Assignment> {
    return mapAssignment(
      single(
        await this.db
          .insert(assignments)
          .values({
            id: input.id,
            courseId: input.courseId,
            contentRevisionId: input.contentRevisionId,
            title: input.title,
            description: input.description,
            state: "draft",
            assessmentMode: input.assessmentMode,
            displayOrder: input.displayOrder,
            availableFrom: input.availableFrom,
            dueAt: input.dueAt,
            availableUntil: input.availableUntil,
            gradesVisibleAt: input.gradesVisibleAt,
            listed: input.listed,
            maxAttempts: input.maxAttempts,
            timeLimitMinutes: input.timeLimitMinutes,
            createdById: input.createdById,
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
          })
          .returning(),
      ),
    );
  }

  async excuseExercise(input: ExcuseAssignmentExerciseInput) {
    return mapAssignmentExerciseExcuse(
      single(
        await this.db
          .insert(assignmentExerciseExcuses)
          .values({
            id: input.id,
            assignmentId: input.assignmentId,
            exerciseId: input.exerciseId,
            status: "excused",
            actorId: input.actorId,
            createdAt: input.createdAt,
            reason: input.reason,
          })
          .returning(),
      ),
    );
  }

  async getById(id: AppId): Promise<Assignment | null> {
    const row = nullableSingle(
      await this.db
        .select()
        .from(assignments)
        .where(eq(assignments.id, id))
        .limit(1),
    );

    return row === null ? null : mapAssignment(row);
  }

  async listContentVersions(
    assignmentId: AppId,
  ): Promise<AssignmentContentVersion[]> {
    const rows = await this.db
      .select()
      .from(assignmentContentVersions)
      .where(eq(assignmentContentVersions.assignmentId, assignmentId))
      .orderBy(
        asc(assignmentContentVersions.effectiveAt),
        asc(assignmentContentVersions.id),
      );

    return rows.map(mapAssignmentContentVersion);
  }

  async getLatePolicy(
    assignmentId: AppId,
  ): Promise<AssignmentLatePolicy | null> {
    const row = nullableSingle(
      await this.db
        .select()
        .from(assignmentLatePolicies)
        .where(eq(assignmentLatePolicies.assignmentId, assignmentId))
        .limit(1),
    );

    return row === null ? null : mapAssignmentLatePolicy(row);
  }

  async getOverrideForAssignmentUser(
    assignmentId: AppId,
    userId: AppId,
  ): Promise<AssignmentOverride | null> {
    const row = nullableSingle(
      await this.db
        .select()
        .from(assignmentOverrides)
        .where(
          and(
            eq(assignmentOverrides.assignmentId, assignmentId),
            eq(assignmentOverrides.userId, userId),
          ),
        )
        .limit(1),
    );

    return row === null ? null : mapAssignmentOverride(row);
  }

  async listOverridesForCourseUser(
    courseId: AppId,
    userId: AppId,
  ): Promise<AssignmentOverride[]> {
    const rows = await this.db
      .select({ override: assignmentOverrides })
      .from(assignmentOverrides)
      .innerJoin(
        assignments,
        eq(assignments.id, assignmentOverrides.assignmentId),
      )
      .where(
        and(
          eq(assignments.courseId, courseId),
          eq(assignmentOverrides.userId, userId),
        ),
      );

    return rows.map((row) => mapAssignmentOverride(row.override));
  }

  async listExerciseExcuses(
    assignmentId: AppId,
  ): Promise<AssignmentExerciseExcuse[]> {
    const rows = await this.db
      .select()
      .from(assignmentExerciseExcuses)
      .where(eq(assignmentExerciseExcuses.assignmentId, assignmentId))
      .orderBy(
        asc(assignmentExerciseExcuses.createdAt),
        asc(assignmentExerciseExcuses.id),
      );

    return rows.map(mapAssignmentExerciseExcuse);
  }

  async listForCourse(courseId: AppId): Promise<Assignment[]> {
    const rows = await this.db
      .select()
      .from(assignments)
      .where(eq(assignments.courseId, courseId))
      .orderBy(
        asc(assignments.displayOrder),
        asc(assignments.createdAt),
        asc(assignments.id),
      );

    return rows.map(mapAssignment);
  }

  async upsertLatePolicy(
    input: UpsertLatePolicyInput,
  ): Promise<AssignmentLatePolicy> {
    return mapAssignmentLatePolicy(
      single(
        await this.db
          .insert(assignmentLatePolicies)
          .values({
            assignmentId: input.assignmentId,
            kind: input.kind,
            percentPenalty: input.percentPenalty,
            maxPercentPenalty: input.maxPercentPenalty,
            graceMinutes: input.graceMinutes,
            createdById: input.createdById,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target: assignmentLatePolicies.assignmentId,
            set: {
              graceMinutes: input.graceMinutes,
              kind: input.kind,
              maxPercentPenalty: input.maxPercentPenalty,
              percentPenalty: input.percentPenalty,
              updatedAt: input.now,
            },
          })
          .returning(),
      ),
    );
  }

  async upsertOverride(
    input: UpsertAssignmentOverrideInput,
  ): Promise<AssignmentOverride> {
    return mapAssignmentOverride(
      single(
        await this.db
          .insert(assignmentOverrides)
          .values({
            id: input.id,
            assignmentId: input.assignmentId,
            userId: input.userId,
            availableFrom: input.availableFrom,
            dueAt: input.dueAt,
            availableUntil: input.availableUntil,
            maxAttempts: input.maxAttempts,
            timeLimitMinutes: input.timeLimitMinutes,
            createdById: input.createdById,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target: [
              assignmentOverrides.assignmentId,
              assignmentOverrides.userId,
            ],
            set: {
              availableFrom: input.availableFrom,
              availableUntil: input.availableUntil,
              dueAt: input.dueAt,
              maxAttempts: input.maxAttempts,
              timeLimitMinutes: input.timeLimitMinutes,
              updatedAt: input.now,
            },
          })
          .returning(),
      ),
    );
  }

  async publish(input: PublishAssignmentInput): Promise<Assignment | null> {
    const assignmentQuery = this.db
      .update(assignments)
      .set({
        state: "published",
        publishedAt: input.publishedAt,
        updatedAt: input.publishedAt,
      })
      .where(
        and(eq(assignments.id, input.id), eq(assignments.state, "draft")),
      )
      .returning();
    const versionQuery = this.db
      .insert(assignmentContentVersions)
      .values({
        id: input.versionId,
        assignmentId: input.id,
        contentRevisionId: input.contentRevisionId,
        effectiveAt: input.publishedAt,
        actorId: input.actorId,
        // `note` is what an author wrote about a change, and nobody was asked
        // anything here. A sentence of ours in that column reads as their words,
        // and — being stored, not translated at render — reads as English to
        // every reader whatever their language. That this version is the
        // publication's own is said by where it sits in the ledger instead.
        note: "",
      })
      .returning();
    const [assignmentRows] = await this.db.batch([
      assignmentQuery,
      versionQuery,
    ]);
    const row = nullableSingle(assignmentRows);

    return row === null ? null : mapAssignment(row);
  }

  async unpublish(
    input: UnpublishAssignmentInput,
  ): Promise<Assignment | null> {
    const row = nullableSingle(
      await this.db
        .update(assignments)
        .set({
          state: "draft",
          publishedAt: null,
          updatedAt: input.updatedAt,
        })
        .where(
          and(
            eq(assignments.id, input.id),
            eq(assignments.state, "published"),
          ),
        )
        .returning(),
    );

    return row === null ? null : mapAssignment(row);
  }

  async delete(input: DeleteAssignmentInput): Promise<Assignment | null> {
    const row = nullableSingle(
      await this.db
        .delete(assignments)
        .where(
          and(eq(assignments.id, input.id), eq(assignments.state, "draft")),
        )
        .returning(),
    );

    return row === null ? null : mapAssignment(row);
  }

  async repointPublished(
    input: RepointPublishedAssignmentInput,
  ): Promise<Assignment | null> {
    const assignmentQuery = this.db
      .update(assignments)
      .set({
        contentRevisionId: input.contentRevisionId,
        updatedAt: input.effectiveAt,
      })
      .where(
        and(
          eq(assignments.id, input.assignmentId),
          eq(assignments.state, "published"),
        ),
      )
      .returning();
    const versionQuery = this.db
      .insert(assignmentContentVersions)
      .values({
        id: input.versionId,
        assignmentId: input.assignmentId,
        contentRevisionId: input.contentRevisionId,
        effectiveAt: input.effectiveAt,
        actorId: input.actorId,
        note: input.note,
      })
      .returning();
    const [assignmentRows] = await this.db.batch([
      assignmentQuery,
      versionQuery,
    ]);
    const row = nullableSingle(assignmentRows);

    return row === null ? null : mapAssignment(row);
  }

  async setGradesVisibleAt(
    input: SetGradesVisibleAtInput,
  ): Promise<Assignment | null> {
    const row = nullableSingle(
      await this.db
        .update(assignments)
        .set({
          gradesVisibleAt: input.gradesVisibleAt,
          updatedAt: input.updatedAt,
        })
        .where(
          and(
            eq(assignments.id, input.assignmentId),
            eq(assignments.state, "published"),
          ),
        )
        .returning(),
    );

    return row === null ? null : mapAssignment(row);
  }

  async updatePublishedSettings(
    input: UpdatePublishedSettingsInput,
  ): Promise<Assignment | null> {
    const row = nullableSingle(
      await this.db
        .update(assignments)
        .set({
          availableFrom: input.availableFrom,
          availableUntil: input.availableUntil,
          description: input.description,
          displayOrder: input.displayOrder,
          dueAt: input.dueAt,
          listed: input.listed,
          maxAttempts: input.maxAttempts,
          timeLimitMinutes: input.timeLimitMinutes,
          title: input.title,
          updatedAt: input.updatedAt,
        })
        .where(
          and(
            eq(assignments.id, input.assignmentId),
            eq(assignments.state, "published"),
          ),
        )
        .returning(),
    );

    return row === null ? null : mapAssignment(row);
  }

  async updateDraft(
    input: UpdateAssignmentInput,
  ): Promise<Assignment | null> {
    const row = nullableSingle(
      await this.db
        .update(assignments)
        .set({
          assessmentMode: input.assessmentMode,
          displayOrder: input.displayOrder,
          availableFrom: input.availableFrom,
          availableUntil: input.availableUntil,
          gradesVisibleAt: input.gradesVisibleAt,
          contentRevisionId: input.contentRevisionId,
          description: input.description,
          dueAt: input.dueAt,
          listed: input.listed,
          maxAttempts: input.maxAttempts,
          timeLimitMinutes: input.timeLimitMinutes,
          title: input.title,
          updatedAt: input.updatedAt,
        })
        .where(
          and(eq(assignments.id, input.id), eq(assignments.state, "draft")),
        )
        .returning(),
    );

    return row === null ? null : mapAssignment(row);
  }
}

class SqliteAssessmentStore implements AssessmentStore {
  constructor(private readonly db: AppDatabase) {}

  /**
   * Allocating an attempt is one statement on purpose: the next ordinal and
   * the cap check both read `attempts` inside the same `INSERT ... SELECT`,
   * so two concurrent begins cannot each see the same count and both write.
   * The query builder cannot express that, so it stays hand-written SQL, run
   * through the same connection as every other read and write.
   */
  async beginAttempt(input: BeginAttemptInput): Promise<Attempt | null> {
    const rows = await this.db.all<Record<string, unknown>>(sql`
      INSERT INTO attempts (
        id,
        assignment_id,
        user_id,
        ordinal,
        opened_at,
        expires_at,
        created_from,
        status
      )
      SELECT
        ${input.id},
        ${input.assignmentId},
        ${input.userId},
        COALESCE((
          SELECT MAX(ordinal)
          FROM attempts
          WHERE assignment_id = ${input.assignmentId}
            AND user_id = ${input.userId}
        ), 0) + 1,
        ${input.openedAt},
        ${input.expiresAt},
        ${input.createdFrom},
        'active'
      WHERE ${input.maxAttempts} IS NULL OR (
        SELECT COUNT(1)
        FROM attempts
        WHERE assignment_id = ${input.assignmentId}
          AND user_id = ${input.userId}
          AND status <> 'voided'
      ) < ${input.maxAttempts}
      RETURNING *`);
    const row = nullableSingle(rows);

    return row === null ? null : mapRawAttempt(row);
  }

  async expireOpenAttempts(
    assignmentId: AppId,
    userId: AppId,
    now: string,
  ): Promise<Attempt[]> {
    const rows = await this.db
      .update(attempts)
      .set({ status: "expired" })
      .where(
        and(
          eq(attempts.assignmentId, assignmentId),
          eq(attempts.userId, userId),
          eq(attempts.status, "active"),
          lte(attempts.expiresAt, now),
        ),
      )
      .returning();

    return rows.map(mapAttempt);
  }

  async getAttempt(id: AppId): Promise<Attempt | null> {
    const row = nullableSingle(
      await this.db
        .select()
        .from(attempts)
        .where(eq(attempts.id, id))
        .limit(1),
    );

    return row === null ? null : mapAttempt(row);
  }

  async getSubmission(id: AppId): Promise<Submission | null> {
    const row = nullableSingle(
      await this.db
        .select()
        .from(submissions)
        .where(eq(submissions.id, id))
        .limit(1),
    );

    return row === null ? null : mapSubmission(row);
  }

  async listAttemptsForAssignment(assignmentId: AppId): Promise<Attempt[]> {
    const rows = await this.db
      .select()
      .from(attempts)
      .where(eq(attempts.assignmentId, assignmentId))
      .orderBy(asc(attempts.userId), asc(attempts.ordinal));

    return rows.map(mapAttempt);
  }

  async listAttemptsForAssignmentUser(
    assignmentId: AppId,
    userId: AppId,
  ): Promise<Attempt[]> {
    const rows = await this.db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.assignmentId, assignmentId),
          eq(attempts.userId, userId),
        ),
      )
      .orderBy(asc(attempts.ordinal));

    return rows.map(mapAttempt);
  }

  /**
   * Void an attempt and open its replacement, together or not at all.
   *
   * `supersedes_attempt_id` being unique is what makes the pair safe: a
   * second reset of the same attempt cannot insert, so it cannot leave a
   * replacement standing over a void that never happened, and because the
   * batch is one transaction the failed insert takes the void down with it.
   * That covers the race the caller cannot — two staff resetting the same
   * attempt at once, both past their own checks.
   *
   * What it does not cover is being called about an attempt that is not this
   * assignment's or not this user's: the void then matches nothing while the
   * insert still lands, and this returns null having written a row. The
   * caller establishes that much first (`AttemptService.reset` reads the
   * attempt and checks both), so treat those fields as a precondition rather
   * than something to pass hopefully.
   */
  async resetAttempt(input: ResetAttemptInput): Promise<{
    readonly newAttempt: Attempt;
    readonly voidedAttempt: Attempt;
  } | null> {
    const voidStatement = this.db
      .update(attempts)
      .set({
        status: "voided",
        voidReason: "reset",
        voidedAt: input.voidedAt,
        voidedById: input.voidedById,
      })
      .where(
        and(
          eq(attempts.id, input.oldAttemptId),
          eq(attempts.assignmentId, input.assignmentId),
          eq(attempts.userId, input.userId),
          ne(attempts.status, "voided"),
        ),
      )
      .returning();
    // What keeps the pair honest is `supersedes_attempt_id` being unique: a
    // second reset of the same attempt cannot insert, so it cannot leave a
    // replacement behind for a void that never happened. The guard clause
    // this replaces had to name the exact `voided_at` the update above wrote,
    // which is why it could only ever be hand-written SQL.
    //
    // The ordinal is still read inside the statement rather than fetched and
    // incremented here — two resets racing must not compute the same next
    // number, and `attempts_assignment_user_ordinal_unique` would catch it
    // but only by failing.
    const newStatement = this.db
      .insert(attempts)
      .values({
        assignmentId: input.assignmentId,
        createdFrom: "reset",
        expiresAt: input.expiresAt,
        id: input.newAttemptId,
        openedAt: input.openedAt,
        ordinal: sql`COALESCE((
          SELECT MAX(${attempts.ordinal})
          FROM ${attempts}
          WHERE ${attempts.assignmentId} = ${input.assignmentId}
            AND ${attempts.userId} = ${input.userId}
        ), 0) + 1`,
        status: "active",
        supersedesAttemptId: input.oldAttemptId,
        userId: input.userId,
      })
      .returning();
    const [voidRows, newRows] = await this.db.batch([
      voidStatement,
      newStatement,
    ]);
    const voidedRow = nullableSingle(voidRows);
    const newRow = nullableSingle(newRows);

    if (voidedRow === null || newRow === null) {
      return null;
    }

    return {
      newAttempt: mapAttempt(newRow),
      voidedAttempt: mapAttempt(voidedRow),
    };
  }

  async appendSubmission(input: AppendSubmissionInput): Promise<Submission> {
    return mapSubmission(
      single(
        await this.db
          .insert(submissions)
          .values({
            id: input.id,
            attemptId: input.attemptId,
            userId: input.userId,
            contentRevisionId: input.contentRevisionId ?? null,
            exerciseId: input.exerciseId ?? null,
            declarationHash: input.declarationHash ?? null,
            answerKind: input.answerKind ?? null,
            idempotencyKey: input.idempotencyKey,
            answerJson: input.answer,
            submittedAt: input.submittedAt,
          })
          .returning(),
      ),
    );
  }

  async listSubmissionsForAttempt(attemptId: AppId): Promise<Submission[]> {
    const rows = await this.db
      .select()
      .from(submissions)
      .where(eq(submissions.attemptId, attemptId))
      .orderBy(asc(submissions.submittedAt), asc(submissions.id));

    return rows.map(mapSubmission);
  }

  async appendEvaluation(input: AppendEvaluationInput): Promise<Evaluation> {
    return mapEvaluation(
      single(
        await this.db
          .insert(evaluations)
          .values({
            id: input.id,
            submissionId: input.submissionId,
            evaluatorKind: input.evaluatorKind,
            checkerVersion: input.checkerVersion,
            resultJson: input.result,
            score: input.score,
            maxScore: input.maxScore,
            createdAt: input.createdAt,
          })
          .returning(),
      ),
    );
  }

  async listEvaluationsForSubmission(
    submissionId: AppId,
  ): Promise<Evaluation[]> {
    const rows = await this.db
      .select()
      .from(evaluations)
      .where(eq(evaluations.submissionId, submissionId))
      .orderBy(asc(evaluations.createdAt), asc(evaluations.id));

    return rows.map(mapEvaluation);
  }

  async appendSubmissionWithEvaluation(
    submission: AppendSubmissionInput,
    evaluation: AppendEvaluationInput,
  ): Promise<{
    readonly evaluation: Evaluation;
    readonly submission: Submission;
  }> {
    const submissionQuery = this.db
      .insert(submissions)
      .values({
        id: submission.id,
        attemptId: submission.attemptId,
        userId: submission.userId,
        contentRevisionId: submission.contentRevisionId ?? null,
        exerciseId: submission.exerciseId ?? null,
        declarationHash: submission.declarationHash ?? null,
        answerKind: submission.answerKind ?? null,
        idempotencyKey: submission.idempotencyKey,
        answerJson: submission.answer,
        submittedAt: submission.submittedAt,
      })
      .returning();
    const evaluationQuery = this.db
      .insert(evaluations)
      .values({
        id: evaluation.id,
        submissionId: evaluation.submissionId,
        evaluatorKind: evaluation.evaluatorKind,
        checkerVersion: evaluation.checkerVersion,
        resultJson: evaluation.result,
        score: evaluation.score,
        maxScore: evaluation.maxScore,
        createdAt: evaluation.createdAt,
      })
      .returning();
    const [submissionRows, evaluationRows] = await this.db.batch([
      submissionQuery,
      evaluationQuery,
    ]);

    return {
      submission: mapSubmission(single(submissionRows)),
      evaluation: mapEvaluation(single(evaluationRows)),
    };
  }
}

class SqlitePlatformCapabilityStore implements PlatformCapabilityStore {
  constructor(private readonly db: AppDatabase) {}

  async grant(
    input: GrantPlatformCapabilityInput,
  ): Promise<PlatformCapabilityGrant> {
    const existing = nullableSingle(
      await this.db
        .select()
        .from(platformCapabilityGrants)
        .where(
          and(
            eq(platformCapabilityGrants.userId, input.userId),
            eq(platformCapabilityGrants.capability, input.capability),
            isNull(platformCapabilityGrants.revokedAt),
          ),
        )
        .limit(1),
    );

    if (existing !== null) {
      return mapPlatformCapabilityGrant(existing);
    }

    return mapPlatformCapabilityGrant(
      single(
        await this.db
          .insert(platformCapabilityGrants)
          .values(input)
          .returning(),
      ),
    );
  }

  async hasAnyActiveSiteAdmin(): Promise<boolean> {
    const row = nullableSingle(
      await this.db
        .select({ id: platformCapabilityGrants.id })
        .from(platformCapabilityGrants)
        .where(
          and(
            eq(platformCapabilityGrants.capability, "site_admin"),
            isNull(platformCapabilityGrants.revokedAt),
          ),
        )
        .limit(1),
    );

    return row !== null;
  }

  async listActiveForUser(userId: AppId): Promise<PlatformCapabilityGrant[]> {
    const rows = await this.db
      .select()
      .from(platformCapabilityGrants)
      .where(
        and(
          eq(platformCapabilityGrants.userId, userId),
          isNull(platformCapabilityGrants.revokedAt),
        ),
      )
      .orderBy(
        asc(platformCapabilityGrants.capability),
        asc(platformCapabilityGrants.grantedAt),
      );

    return rows.map(mapPlatformCapabilityGrant);
  }

  async revoke(
    input: RevokePlatformCapabilityInput,
  ): Promise<PlatformCapabilityGrant | null> {
    const row = nullableSingle(
      await this.db
        .update(platformCapabilityGrants)
        .set({ revokedAt: input.revokedAt })
        .where(
          and(
            eq(platformCapabilityGrants.userId, input.userId),
            eq(platformCapabilityGrants.capability, input.capability),
            isNull(platformCapabilityGrants.revokedAt),
          ),
        )
        .returning(),
    );

    return row === null ? null : mapPlatformCapabilityGrant(row);
  }
}

class SqliteAdminAuditStore implements AdminAuditStore {
  constructor(private readonly db: AppDatabase) {}

  async append(input: CreateAdminAuditEventInput): Promise<AdminAuditEvent> {
    return mapAdminAuditEvent(
      single(
        await this.db
          .insert(adminAuditEvents)
          .values({
            action: input.action,
            actorUserId: input.actorUserId,
            createdAt: input.createdAt,
            id: input.id,
            metadataJson: input.metadata,
            requestId: input.requestId,
            targetCourseId: input.targetCourseId,
            targetUserId: input.targetUserId,
          })
          .returning(),
      ),
    );
  }

  async listRecent(limit: number): Promise<AdminAuditEvent[]> {
    const rows = await this.db
      .select()
      .from(adminAuditEvents)
      .orderBy(desc(adminAuditEvents.createdAt), desc(adminAuditEvents.id))
      .limit(Math.min(Math.max(limit, 1), 100));

    return rows.map(mapAdminAuditEvent);
  }
}

class SqliteAdminStatsStore implements AdminStatsStore {
  constructor(private readonly db: AppDatabase) {}

  async getGlobalStats(): Promise<AdminGlobalStats> {
    const [
      usersRows,
      activeCoursesRows,
      assignmentsRows,
      submissionsRows,
      gradingWorkRows,
    ] = await this.db.batch([
      this.db.select({ count: count() }).from(users),
      this.db
        .select({ count: count() })
        .from(courses)
        .where(isNull(courses.archivedAt)),
      this.db.select({ count: count() }).from(assignments),
      this.db.select({ count: count() }).from(submissions),
      this.db
        .select({ count: count() })
        .from(evaluations)
        .where(eq(evaluations.evaluatorKind, "manual")),
    ]);

    return {
      activeCourses: single(activeCoursesRows).count,
      assignments: single(assignmentsRows).count,
      gradingWork: single(gradingWorkRows).count,
      submissions: single(submissionsRows).count,
      users: single(usersRows).count,
    };
  }
}

class SqliteScoreStore implements ScoreStore {
  constructor(private readonly db: AppDatabase) {}

  async getAssignmentScore(
    assignmentId: AppId,
    userId: AppId,
  ): Promise<AssignmentScore | null> {
    const row = nullableSingle(
      await this.db
        .select()
        .from(assignmentScores)
        .where(
          and(
            eq(assignmentScores.assignmentId, assignmentId),
            eq(assignmentScores.userId, userId),
          ),
        )
        .limit(1),
    );

    return row === null ? null : mapAssignmentScore(row);
  }

  async listAssignmentScores(
    assignmentId: AppId,
  ): Promise<AssignmentScore[]> {
    const rows = await this.db
      .select()
      .from(assignmentScores)
      .where(eq(assignmentScores.assignmentId, assignmentId))
      .orderBy(asc(assignmentScores.userId));

    return rows.map(mapAssignmentScore);
  }

  async upsertAssignmentScore(
    input: UpsertAssignmentScoreInput,
  ): Promise<AssignmentScore> {
    const rows = await this.scoreUpsertQuery(input);

    return this.upsertedScore(rows, input);
  }

  async upsertAssignmentScoreWithGradeJobs(
    input: UpsertAssignmentScoreInput,
    jobs: readonly EnqueueLtiGradeJobInput[],
  ): Promise<AssignmentScore> {
    if (jobs.length === 0) {
      return this.upsertAssignmentScore(input);
    }

    const [scoreRows] = await this.db.batch([
      this.scoreUpsertQuery(input),
      ...jobs.map((job) => gradeJobUpsertQuery(this.db, job)),
    ]);

    return this.upsertedScore(scoreRows, input);
  }

  /**
   * The `setWhere` guard keeps a refresh that lost a race from regressing
   * the stored score: projections are stamped after their reads, so an
   * older `calculatedAt` means older data.
   */
  private scoreUpsertQuery(input: UpsertAssignmentScoreInput) {
    return this.db
      .insert(assignmentScores)
      .values(input)
      .onConflictDoUpdate({
        target: [assignmentScores.assignmentId, assignmentScores.userId],
        set: {
          calculatedAt: input.calculatedAt,
          maxScore: input.maxScore,
          score: input.score,
          status: input.status,
        },
        setWhere: sql`excluded.calculated_at >= ${assignmentScores.calculatedAt}`,
      })
      .returning();
  }

  /** An empty upsert result means a newer projection already won the row. */
  private async upsertedScore(
    rows: (typeof assignmentScores.$inferSelect)[],
    input: UpsertAssignmentScoreInput,
  ): Promise<AssignmentScore> {
    if (rows.length > 0) {
      return mapAssignmentScore(single(rows));
    }

    const current = await this.getAssignmentScore(
      input.assignmentId,
      input.userId,
    );

    if (current === null) {
      throw new Error("assignment score upsert wrote no row");
    }

    return current;
  }
}

class SqliteLtiStore implements LtiStore {
  constructor(private readonly db: AppDatabase) {}

  async createPlatform(input: CreateLtiPlatformInput): Promise<LtiPlatform> {
    return single(
      await this.db
        .insert(ltiPlatforms)
        .values({
          id: input.id,
          name: input.name,
          issuer: input.issuer,
          clientId: input.clientId,
          authorizationEndpoint: input.authorizationEndpoint,
          tokenEndpoint: input.tokenEndpoint,
          jwksUri: input.jwksUri,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        })
        .returning(),
    );
  }

  async getPlatformById(id: AppId): Promise<LtiPlatform | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(ltiPlatforms)
        .where(eq(ltiPlatforms.id, id))
        .limit(1),
    );
  }

  async getPlatformByIssuerClientId(
    issuer: string,
    clientId: string,
  ): Promise<LtiPlatform | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(ltiPlatforms)
        .where(
          and(
            eq(ltiPlatforms.issuer, issuer),
            eq(ltiPlatforms.clientId, clientId),
          ),
        )
        .limit(1),
    );
  }

  async listPlatforms(): Promise<LtiPlatform[]> {
    return this.db
      .select()
      .from(ltiPlatforms)
      .orderBy(asc(ltiPlatforms.name), asc(ltiPlatforms.id));
  }

  async listPlatformsByIssuer(issuer: string): Promise<LtiPlatform[]> {
    return this.db
      .select()
      .from(ltiPlatforms)
      .where(eq(ltiPlatforms.issuer, issuer))
      .orderBy(asc(ltiPlatforms.id));
  }

  async setPlatformDisabled(
    id: AppId,
    disabledAt: string | null,
    updatedAt: string,
  ): Promise<LtiPlatform | null> {
    return nullableSingle(
      await this.db
        .update(ltiPlatforms)
        .set({ disabledAt, updatedAt })
        .where(eq(ltiPlatforms.id, id))
        .returning(),
    );
  }

  async createDeployment(
    input: CreateLtiDeploymentInput,
  ): Promise<LtiDeployment> {
    return single(
      await this.db.insert(ltiDeployments).values(input).returning(),
    );
  }

  async deleteDeployment(platformId: AppId, id: AppId): Promise<boolean> {
    const deleted = await this.db
      .delete(ltiDeployments)
      .where(
        and(
          eq(ltiDeployments.id, id),
          eq(ltiDeployments.platformId, platformId),
        ),
      )
      .returning();

    return deleted.length > 0;
  }

  async getDeployment(
    platformId: AppId,
    deploymentId: string,
  ): Promise<LtiDeployment | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(ltiDeployments)
        .where(
          and(
            eq(ltiDeployments.platformId, platformId),
            eq(ltiDeployments.deploymentId, deploymentId),
          ),
        )
        .limit(1),
    );
  }

  async listDeploymentsForPlatform(
    platformId: AppId,
  ): Promise<LtiDeployment[]> {
    return this.db
      .select()
      .from(ltiDeployments)
      .where(eq(ltiDeployments.platformId, platformId))
      .orderBy(asc(ltiDeployments.createdAt), asc(ltiDeployments.id));
  }

  async createContext(input: CreateLtiContextInput): Promise<LtiContext> {
    return single(
      await this.db.insert(ltiContexts).values(input).returning(),
    );
  }

  async getContext(
    deploymentId: AppId,
    contextId: string,
  ): Promise<LtiContext | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(ltiContexts)
        .where(
          and(
            eq(ltiContexts.deploymentId, deploymentId),
            eq(ltiContexts.contextId, contextId),
          ),
        )
        .limit(1),
    );
  }

  async getContextById(id: AppId): Promise<LtiContext | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(ltiContexts)
        .where(eq(ltiContexts.id, id))
        .limit(1),
    );
  }

  async getResourceLinkById(id: AppId): Promise<LtiResourceLink | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(ltiResourceLinks)
        .where(eq(ltiResourceLinks.id, id))
        .limit(1),
    );
  }

  async listUnmappedResourceLinksForCourse(
    courseId: AppId,
  ): Promise<LtiResourceLink[]> {
    const rows = await this.db
      .select({ link: ltiResourceLinks })
      .from(ltiResourceLinks)
      .innerJoin(ltiContexts, eq(ltiResourceLinks.contextId, ltiContexts.id))
      .where(
        and(
          eq(ltiContexts.courseId, courseId),
          isNull(ltiResourceLinks.assignmentId),
        ),
      )
      .orderBy(asc(ltiResourceLinks.createdAt), asc(ltiResourceLinks.id));

    return rows.map((row) => row.link);
  }

  async getResourceLink(
    contextRowId: AppId,
    resourceLinkId: string,
  ): Promise<LtiResourceLink | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(ltiResourceLinks)
        .where(
          and(
            eq(ltiResourceLinks.contextId, contextRowId),
            eq(ltiResourceLinks.resourceLinkId, resourceLinkId),
          ),
        )
        .limit(1),
    );
  }

  async setResourceLinkAssignment(
    id: AppId,
    assignmentId: AppId | null,
    updatedAt: string,
  ): Promise<LtiResourceLink | null> {
    return nullableSingle(
      await this.db
        .update(ltiResourceLinks)
        .set({ assignmentId, updatedAt })
        .where(eq(ltiResourceLinks.id, id))
        .returning(),
    );
  }

  async upsertResourceLink(
    input: UpsertLtiResourceLinkInput,
  ): Promise<LtiResourceLink> {
    // The launch refreshes the platform-owned fields (title, AGS line item)
    // but must never touch the Carnap-owned assignment mapping. Both claims
    // are optional per launch — an instructor preview often omits the AGS
    // endpoint — so an absent value never erases one captured earlier.
    const refresh: {
      updatedAt: string;
      title?: string;
      agsLineItemUrl?: string;
    } = { updatedAt: input.now };

    if (input.title !== "") {
      refresh.title = input.title;
    }

    if (input.agsLineItemUrl !== null) {
      refresh.agsLineItemUrl = input.agsLineItemUrl;
    }

    return single(
      await this.db
        .insert(ltiResourceLinks)
        .values({
          id: input.id,
          contextId: input.contextId,
          resourceLinkId: input.resourceLinkId,
          title: input.title,
          assignmentId: null,
          agsLineItemUrl: input.agsLineItemUrl,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: [
            ltiResourceLinks.contextId,
            ltiResourceLinks.resourceLinkId,
          ],
          set: refresh,
        })
        .returning(),
    );
  }

  async createLoginState(
    input: CreateLtiLoginStateInput,
  ): Promise<LtiLoginState> {
    // Nothing else ever deletes these rows, so each initiation sweeps out the
    // expired ones — one row per launch attempt would otherwise accumulate
    // forever.
    await this.db
      .delete(ltiLoginStates)
      .where(lte(ltiLoginStates.expiresAt, input.createdAt));

    return single(
      await this.db.insert(ltiLoginStates).values(input).returning(),
    );
  }

  async consumeLoginState(
    stateHash: string,
    now: string,
  ): Promise<LtiLoginState | null> {
    return nullableSingle(
      await this.db
        .update(ltiLoginStates)
        .set({ consumedAt: now })
        .where(
          and(
            eq(ltiLoginStates.stateHash, stateHash),
            isNull(ltiLoginStates.consumedAt),
            gt(ltiLoginStates.expiresAt, now),
          ),
        )
        .returning(),
    );
  }

  async createLinkChallenge(
    input: CreateLtiLinkChallengeInput,
  ): Promise<LtiLinkChallenge> {
    // Same sweep as login states: expired challenges have no readers.
    await this.db
      .delete(ltiLinkChallenges)
      .where(lte(ltiLinkChallenges.expiresAt, input.createdAt));

    return single(
      await this.db.insert(ltiLinkChallenges).values(input).returning(),
    );
  }

  async consumeLinkChallenge(
    tokenHash: string,
    now: string,
  ): Promise<LtiLinkChallenge | null> {
    return nullableSingle(
      await this.db
        .update(ltiLinkChallenges)
        .set({ consumedAt: now })
        .where(
          and(
            eq(ltiLinkChallenges.tokenHash, tokenHash),
            isNull(ltiLinkChallenges.consumedAt),
            gt(ltiLinkChallenges.expiresAt, now),
          ),
        )
        .returning(),
    );
  }

  async deleteLinkChallenge(tokenHash: string): Promise<void> {
    await this.db
      .delete(ltiLinkChallenges)
      .where(eq(ltiLinkChallenges.tokenHash, tokenHash));
  }

  async getLinkChallenge(
    tokenHash: string,
    now: string,
  ): Promise<LtiLinkChallenge | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(ltiLinkChallenges)
        .where(
          and(
            eq(ltiLinkChallenges.tokenHash, tokenHash),
            isNull(ltiLinkChallenges.consumedAt),
            gt(ltiLinkChallenges.expiresAt, now),
          ),
        )
        .limit(1),
    );
  }

  async getPendingLinkChallenge(
    platformId: AppId,
    subject: string,
    userId: AppId,
    now: string,
  ): Promise<LtiLinkChallenge | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(ltiLinkChallenges)
        .where(
          and(
            eq(ltiLinkChallenges.platformId, platformId),
            eq(ltiLinkChallenges.subject, subject),
            eq(ltiLinkChallenges.userId, userId),
            isNull(ltiLinkChallenges.consumedAt),
            gt(ltiLinkChallenges.expiresAt, now),
          ),
        )
        .limit(1),
    );
  }

  async getDeploymentById(id: AppId): Promise<LtiDeployment | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(ltiDeployments)
        .where(eq(ltiDeployments.id, id))
        .limit(1),
    );
  }

  async listResourceLinksForAssignment(
    assignmentId: AppId,
  ): Promise<LtiResourceLink[]> {
    return this.db
      .select()
      .from(ltiResourceLinks)
      .where(eq(ltiResourceLinks.assignmentId, assignmentId))
      .orderBy(asc(ltiResourceLinks.createdAt), asc(ltiResourceLinks.id));
  }

  async createDeepLinkRequest(
    input: CreateLtiDeepLinkRequestInput,
  ): Promise<LtiDeepLinkRequest> {
    // Same sweep as login states: expired requests have no readers.
    await this.db
      .delete(ltiDeepLinkRequests)
      .where(lte(ltiDeepLinkRequests.expiresAt, input.createdAt));

    return single(
      await this.db.insert(ltiDeepLinkRequests).values(input).returning(),
    );
  }

  async getDeepLinkRequest(
    tokenHash: string,
    now: string,
  ): Promise<LtiDeepLinkRequest | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(ltiDeepLinkRequests)
        .where(
          and(
            eq(ltiDeepLinkRequests.tokenHash, tokenHash),
            isNull(ltiDeepLinkRequests.consumedAt),
            gt(ltiDeepLinkRequests.expiresAt, now),
          ),
        )
        .limit(1),
    );
  }

  async consumeDeepLinkRequest(
    tokenHash: string,
    now: string,
  ): Promise<LtiDeepLinkRequest | null> {
    return nullableSingle(
      await this.db
        .update(ltiDeepLinkRequests)
        .set({ consumedAt: now })
        .where(
          and(
            eq(ltiDeepLinkRequests.tokenHash, tokenHash),
            isNull(ltiDeepLinkRequests.consumedAt),
            gt(ltiDeepLinkRequests.expiresAt, now),
          ),
        )
        .returning(),
    );
  }

  async enqueueGradeJob(
    input: EnqueueLtiGradeJobInput,
  ): Promise<LtiGradeJob | null> {
    return nullableSingle(await gradeJobUpsertQuery(this.db, input));
  }

  async getGradeJob(
    resourceLinkId: AppId,
    userId: AppId,
  ): Promise<LtiGradeJob | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(ltiGradeJobs)
        .where(
          and(
            eq(ltiGradeJobs.resourceLinkId, resourceLinkId),
            eq(ltiGradeJobs.userId, userId),
          ),
        )
        .limit(1),
    );
  }

  async claimDueGradeJobs(
    now: string,
    reclaimSendingBefore: string,
    limit: number,
  ): Promise<LtiGradeJob[]> {
    // One statement so concurrent processors can never claim the same job.
    // `sending` rows older than the reclaim horizon were abandoned by a
    // worker that died mid-delivery and go back into the batch. The stamped
    // `updatedAt` doubles as the claim's ownership token.
    const due = this.db
      .select({ id: ltiGradeJobs.id })
      .from(ltiGradeJobs)
      .where(
        or(
          and(
            eq(ltiGradeJobs.status, "pending"),
            lte(ltiGradeJobs.nextAttemptAt, now),
          ),
          and(
            eq(ltiGradeJobs.status, "sending"),
            lte(ltiGradeJobs.updatedAt, reclaimSendingBefore),
          ),
        ),
      )
      .orderBy(asc(ltiGradeJobs.nextAttemptAt))
      .limit(limit);

    return this.db
      .update(ltiGradeJobs)
      .set({ status: "sending", updatedAt: now })
      .where(inArray(ltiGradeJobs.id, due))
      .returning();
  }

  async completeGradeJob(
    id: AppId,
    claimedAt: string,
    now: string,
  ): Promise<LtiGradeJob | null> {
    // Guarded on the claim stamp: an enqueue that re-pointed the row at a
    // newer score mid-flight (or another claimant that took the row over)
    // rewrote `updatedAt`, and that state must survive this delivery.
    return nullableSingle(
      await this.db
        .update(ltiGradeJobs)
        .set({
          status: "complete",
          lastFailureReason: null,
          lastErrorDetail: null,
          updatedAt: now,
        })
        .where(this.claimGuard(id, claimedAt))
        .returning(),
    );
  }

  async failGradeJob(
    input: FailLtiGradeJobInput,
  ): Promise<LtiGradeJob | null> {
    // Same claim guard as completeGradeJob.
    return nullableSingle(
      await this.db
        .update(ltiGradeJobs)
        .set(
          input.nextAttemptAt === null
            ? {
                status: "failed",
                attemptCount: input.attemptCount,
                lastFailureReason: input.reason,
                lastErrorDetail: input.detail,
                updatedAt: input.now,
              }
            : {
                status: "pending",
                attemptCount: input.attemptCount,
                nextAttemptAt: input.nextAttemptAt,
                lastFailureReason: input.reason,
                lastErrorDetail: input.detail,
                updatedAt: input.now,
              },
        )
        .where(this.claimGuard(input.id, input.claimedAt))
        .returning(),
    );
  }

  async deferGradeJob(
    id: AppId,
    claimedAt: string,
    nextAttemptAt: string,
    now: string,
  ): Promise<LtiGradeJob | null> {
    return nullableSingle(
      await this.db
        .update(ltiGradeJobs)
        .set({ status: "pending", nextAttemptAt, updatedAt: now })
        .where(this.claimGuard(id, claimedAt))
        .returning(),
    );
  }

  private claimGuard(id: AppId, claimedAt: string) {
    return and(
      eq(ltiGradeJobs.id, id),
      eq(ltiGradeJobs.status, "sending"),
      eq(ltiGradeJobs.updatedAt, claimedAt),
    );
  }

  async deleteGradeJobsForResourceLink(resourceLinkId: AppId): Promise<void> {
    await this.db
      .delete(ltiGradeJobs)
      .where(eq(ltiGradeJobs.resourceLinkId, resourceLinkId));
  }

  async rescheduleGradeJobsForAssignment(
    assignmentId: AppId,
    now: string,
  ): Promise<void> {
    const links = this.db
      .select({ id: ltiResourceLinks.id })
      .from(ltiResourceLinks)
      .where(eq(ltiResourceLinks.assignmentId, assignmentId));

    await this.db
      .update(ltiGradeJobs)
      .set({ nextAttemptAt: now, updatedAt: now })
      .where(
        and(
          eq(ltiGradeJobs.status, "pending"),
          inArray(ltiGradeJobs.resourceLinkId, links),
        ),
      );
  }

  async retryGradeJob(id: AppId, now: string): Promise<LtiGradeJob | null> {
    return nullableSingle(
      await this.db
        .update(ltiGradeJobs)
        .set({
          status: "pending",
          attemptCount: 0,
          nextAttemptAt: now,
          updatedAt: now,
        })
        .where(
          and(eq(ltiGradeJobs.id, id), eq(ltiGradeJobs.status, "failed")),
        )
        .returning(),
    );
  }

  async getGradeJobById(id: AppId): Promise<LtiGradeJob | null> {
    return nullableSingle(
      await this.db
        .select()
        .from(ltiGradeJobs)
        .where(eq(ltiGradeJobs.id, id))
        .limit(1),
    );
  }

  async listGradeJobsForCourse(
    courseId: AppId,
    status: LtiGradeJobStatus,
  ): Promise<LtiGradeJob[]> {
    const rows = await this.db
      .select({ job: ltiGradeJobs })
      .from(ltiGradeJobs)
      .innerJoin(
        ltiResourceLinks,
        eq(ltiGradeJobs.resourceLinkId, ltiResourceLinks.id),
      )
      .innerJoin(ltiContexts, eq(ltiResourceLinks.contextId, ltiContexts.id))
      .where(
        and(
          eq(ltiContexts.courseId, courseId),
          eq(ltiGradeJobs.status, status),
        ),
      )
      .orderBy(asc(ltiGradeJobs.updatedAt), asc(ltiGradeJobs.id));

    return rows.map((row) => row.job);
  }
}

/**
 * Every store, over one database handle. The handle's provenance — a
 * Cloudflare D1 binding, a libsql file — is settled by the caller (`d1.ts`,
 * `libsql.ts`) and is not knowable from here, which is the point.
 */
export function createStores(db: AppDatabase): AppStores {
  return {
    adminAudit: new SqliteAdminAuditStore(db),
    adminStats: new SqliteAdminStatsStore(db),
    assignments: new SqliteAssignmentStore(db),
    assessment: new SqliteAssessmentStore(db),
    auth: new SqliteAuthStore(db),
    content: new SqliteContentStore(db),
    courses: new SqliteCourseStore(db),
    lti: new SqliteLtiStore(db),
    platformCapabilities: new SqlitePlatformCapabilityStore(db),
    scores: new SqliteScoreStore(db),
    users: new SqliteUserStore(db),
  };
}
