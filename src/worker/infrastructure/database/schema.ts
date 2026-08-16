import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// The one domain import here, and deliberate: reading the reason list from its
// single definition means the column's type and the domain union cannot drift.
import { LTI_GRADE_FAILURE_REASONS } from "../../domain/lti";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    emailVerifiedAt: text("email_verified_at"),
    name: text("name"),
    locale: text("locale"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    disabledAt: text("disabled_at"),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const nativeLoginChallenges = sqliteTable(
  "native_login_challenges",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    tokenHash: text("token_hash").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
  },
  (table) => [
    uniqueIndex("native_login_challenges_token_hash_unique").on(
      table.tokenHash,
    ),
    index("native_login_challenges_email_idx").on(table.email),
  ],
);

/**
 * The login throttle's counter: one row per login email sent, keyed by a
 * scope-tagged hash of the address or the client IP rather than by either in
 * the clear. See `0024_login_rate_limit.sql` for why it is hashed, and
 * `application/login-rate-limit.ts` for the windows it is counted over.
 */
export const loginRateLimitHits = sqliteTable(
  "login_rate_limit_hits",
  {
    id: text("id").primaryKey(),
    bucket: text("bucket").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("login_rate_limit_hits_bucket_idx").on(
      table.bucket,
      table.createdAt,
    ),
    index("login_rate_limit_hits_created_at_idx").on(table.createdAt),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    csrfTokenHash: text("csrf_token_hash").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    lastSeenAt: text("last_seen_at"),
  },
  (table) => [
    index("auth_sessions_user_id_idx").on(table.userId),
    index("auth_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const externalIdentities = sqliteTable(
  "external_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["native", "lti"] }).notNull(),
    providerSubject: text("provider_subject").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("external_identities_user_id_idx").on(table.userId),
    uniqueIndex("external_identities_provider_subject_unique").on(
      table.provider,
      table.providerSubject,
    ),
  ],
);

export const courses = sqliteTable(
  "courses",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [index("courses_created_by_id_idx").on(table.createdById)],
);

export const courseMemberships = sqliteTable(
  "course_memberships",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", {
      enum: ["student", "teacher_assistant", "co_instructor", "instructor"],
    }).notNull(),
    status: text("status", {
      enum: ["active", "invited", "suspended", "dropped"],
    }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("course_memberships_user_id_idx").on(table.userId),
    uniqueIndex("course_memberships_course_user_unique").on(
      table.courseId,
      table.userId,
    ),
  ],
);

export const courseEnrollmentLinks = sqliteTable(
  "course_enrollment_links",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    index("course_enrollment_links_course_id_idx").on(table.courseId),
    uniqueIndex("course_enrollment_links_token_hash_unique").on(
      table.tokenHash,
    ),
  ],
);

export const courseAccommodations = sqliteTable(
  "course_accommodations",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    extraAttempts: integer("extra_attempts").notNull().default(0),
    timeLimitMultiplier: real("time_limit_multiplier").notNull().default(1),
    dueAtExtensionMinutes: integer("due_at_extension_minutes")
      .notNull()
      .default(0),
    availableUntilExtensionMinutes: integer(
      "available_until_extension_minutes",
    )
      .notNull()
      .default(0),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("course_accommodations_course_user_unique").on(
      table.courseId,
      table.userId,
    ),
  ],
);

export const contentItems = sqliteTable(
  "content_items",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("content_items_owner_user_id_idx").on(table.ownerUserId)],
);

export const contentRevisions = sqliteTable(
  "content_revisions",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "restrict" }),
    revisionNumber: integer("revision_number").notNull(),
    sourceFormat: text("source_format", { enum: ["markdown"] }).notNull(),
    sourceText: text("source_text").notNull(),
    /** Why this revision was made, as the author described it; empty when unsaid. */
    details: text("details").notNull().default(""),
    contentHash: text("content_hash").notNull(),
    compiledJson: text("compiled_json", { mode: "json" }).notNull(),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("content_revisions_item_number_unique").on(
      table.itemId,
      table.revisionNumber,
    ),
    uniqueIndex("content_revisions_item_hash_unique").on(
      table.itemId,
      table.contentHash,
    ),
  ],
);

export const assignments = sqliteTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    contentRevisionId: text("content_revision_id")
      .notNull()
      .references(() => contentRevisions.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    state: text("state", { enum: ["draft", "published"] }).notNull(),
    assessmentMode: text("assessment_mode", {
      enum: ["none", "practice", "graded"],
    })
      .notNull()
      .default("graded"),
    displayOrder: integer("display_order").notNull().default(0),
    availableFrom: text("available_from"),
    dueAt: text("due_at"),
    availableUntil: text("available_until"),
    gradesVisibleAt: text("grades_visible_at"),
    listed: integer("listed", { mode: "boolean" }).notNull().default(true),
    maxAttempts: integer("max_attempts").notNull().default(1),
    timeLimitMinutes: integer("time_limit_minutes"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("assignments_course_id_idx").on(table.courseId),
    index("assignments_content_revision_id_idx").on(table.contentRevisionId),
    index("assignments_course_order_idx").on(
      table.courseId,
      table.displayOrder,
      table.id,
    ),
  ],
);

export const assignmentContentVersions = sqliteTable(
  "assignment_content_versions",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    contentRevisionId: text("content_revision_id")
      .notNull()
      .references(() => contentRevisions.id, { onDelete: "restrict" }),
    effectiveAt: text("effective_at").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    note: text("note").notNull().default(""),
  },
  (table) => [
    index("assignment_content_versions_assignment_id_idx").on(
      table.assignmentId,
    ),
    index("assignment_content_versions_revision_id_idx").on(
      table.contentRevisionId,
    ),
  ],
);

export const assignmentExerciseExcuses = sqliteTable(
  "assignment_exercise_excuses",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id").notNull(),
    status: text("status", { enum: ["excused"] })
      .notNull()
      .default("excused"),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    reason: text("reason").notNull().default(""),
  },
  (table) => [
    uniqueIndex("assignment_exercise_excuses_assignment_exercise_unique").on(
      table.assignmentId,
      table.exerciseId,
    ),
    index("assignment_exercise_excuses_assignment_id_idx").on(
      table.assignmentId,
    ),
  ],
);

export const assignmentLatePolicies = sqliteTable(
  "assignment_late_policies",
  {
    assignmentId: text("assignment_id")
      .primaryKey()
      .references(() => assignments.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["none", "percent_once_after_due", "percent_per_day"],
    }).notNull(),
    percentPenalty: real("percent_penalty").notNull(),
    maxPercentPenalty: real("max_percent_penalty").notNull(),
    graceMinutes: integer("grace_minutes").notNull().default(0),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

export const assignmentOverrides = sqliteTable(
  "assignment_overrides",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    availableFrom: text("available_from"),
    dueAt: text("due_at"),
    availableUntil: text("available_until"),
    maxAttempts: integer("max_attempts"),
    timeLimitMinutes: integer("time_limit_minutes"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("assignment_overrides_assignment_user_unique").on(
      table.assignmentId,
      table.userId,
    ),
  ],
);

export const attempts = sqliteTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    status: text("status", {
      enum: ["active", "submitted", "expired", "voided"],
    }).notNull(),
    openedAt: text("opened_at").notNull(),
    expiresAt: text("expires_at"),
    submittedAt: text("submitted_at"),
    voidedAt: text("voided_at"),
    voidedById: text("voided_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    voidReason: text("void_reason"),
    createdFrom: text("created_from", {
      enum: ["student", "reset"],
    }).notNull(),
    /**
     * The attempt this one replaced, for an attempt born of a reset; null for
     * one a student opened. Unique, and that is the point: voiding an attempt
     * and opening its replacement are two writes, and this is what stops the
     * pair happening twice. A reset is the only thing that ever voids an
     * attempt, so "voided" and "superseded exactly once" are the same fact,
     * and the constraint says so where a guard clause used to.
     */
    supersedesAttemptId: text("supersedes_attempt_id").references(
      (): AnySQLiteColumn => attempts.id,
      { onDelete: "set null" },
    ),
  },
  (table) => [
    index("attempts_assignment_user_idx").on(
      table.assignmentId,
      table.userId,
    ),
    uniqueIndex("attempts_assignment_user_ordinal_unique").on(
      table.assignmentId,
      table.userId,
      table.ordinal,
    ),
    uniqueIndex("attempts_supersedes_unique").on(table.supersedesAttemptId),
  ],
);

export const submissions = sqliteTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentRevisionId: text("content_revision_id").references(
      () => contentRevisions.id,
      { onDelete: "restrict" },
    ),
    exerciseId: text("exercise_id"),
    declarationHash: text("declaration_hash"),
    answerKind: text("answer_kind"),
    idempotencyKey: text("idempotency_key"),
    answerJson: text("answer_json", { mode: "json" }).notNull(),
    submittedAt: text("submitted_at").notNull(),
  },
  (table) => [
    index("submissions_attempt_id_idx").on(table.attemptId),
    uniqueIndex("submissions_attempt_idempotency_unique").on(
      table.attemptId,
      table.idempotencyKey,
    ),
  ],
);

export const evaluations = sqliteTable(
  "evaluations",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    evaluatorKind: text("evaluator_kind", {
      enum: ["automatic", "manual"],
    }).notNull(),
    checkerVersion: text("checker_version"),
    resultJson: text("result_json", { mode: "json" }).notNull(),
    score: real("score").notNull(),
    maxScore: real("max_score").notNull(),
    createdAt: text("created_at").notNull(),
    voidedAt: text("voided_at"),
  },
  (table) => [index("evaluations_submission_id_idx").on(table.submissionId)],
);

export const assignmentScores = sqliteTable(
  "assignment_scores",
  {
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    maxScore: real("max_score").notNull(),
    status: text("status", {
      enum: ["complete", "missing", "not-started", "partial"],
    })
      .notNull()
      .default("not-started"),
    calculatedAt: text("calculated_at").notNull(),
  },
  (table) => [
    uniqueIndex("assignment_scores_assignment_user_unique").on(
      table.assignmentId,
      table.userId,
    ),
  ],
);

export const enableForeignKeys = sql`PRAGMA foreign_keys = ON`;

export const platformCapabilityGrants = sqliteTable(
  "platform_capability_grants",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    capability: text("capability", {
      enum: [
        "content_author",
        "course_creator",
        "site_admin",
        "support_operator",
      ],
    }).notNull(),
    grantedById: text("granted_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    grantedAt: text("granted_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    index("platform_capability_grants_user_id_idx").on(table.userId),
    index("platform_capability_grants_capability_idx").on(table.capability),
  ],
);

export const ltiPlatforms = sqliteTable(
  "lti_platforms",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    issuer: text("issuer").notNull(),
    clientId: text("client_id").notNull(),
    authorizationEndpoint: text("authorization_endpoint").notNull(),
    tokenEndpoint: text("token_endpoint").notNull(),
    jwksUri: text("jwks_uri").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    disabledAt: text("disabled_at"),
  },
  (table) => [
    uniqueIndex("lti_platforms_issuer_client_unique").on(
      table.issuer,
      table.clientId,
    ),
  ],
);

export const ltiDeployments = sqliteTable(
  "lti_deployments",
  {
    id: text("id").primaryKey(),
    platformId: text("platform_id")
      .notNull()
      .references(() => ltiPlatforms.id, { onDelete: "cascade" }),
    deploymentId: text("deployment_id").notNull(),
    name: text("name").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("lti_deployments_platform_deployment_unique").on(
      table.platformId,
      table.deploymentId,
    ),
  ],
);

export const ltiContexts = sqliteTable(
  "lti_contexts",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => ltiDeployments.id, { onDelete: "cascade" }),
    contextId: text("context_id").notNull(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("lti_contexts_deployment_context_unique").on(
      table.deploymentId,
      table.contextId,
    ),
    index("lti_contexts_course_id_idx").on(table.courseId),
  ],
);

export const ltiResourceLinks = sqliteTable(
  "lti_resource_links",
  {
    id: text("id").primaryKey(),
    contextId: text("context_id")
      .notNull()
      .references(() => ltiContexts.id, { onDelete: "cascade" }),
    resourceLinkId: text("resource_link_id").notNull(),
    title: text("title").notNull().default(""),
    assignmentId: text("assignment_id").references(() => assignments.id, {
      onDelete: "set null",
    }),
    agsLineItemUrl: text("ags_line_item_url"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("lti_resource_links_context_link_unique").on(
      table.contextId,
      table.resourceLinkId,
    ),
    index("lti_resource_links_assignment_id_idx").on(table.assignmentId),
  ],
);

export const ltiLoginStates = sqliteTable(
  "lti_login_states",
  {
    stateHash: text("state_hash").primaryKey(),
    nonceHash: text("nonce_hash").notNull(),
    platformId: text("platform_id")
      .notNull()
      .references(() => ltiPlatforms.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
  },
  (table) => [index("lti_login_states_expires_at_idx").on(table.expiresAt)],
);

export const ltiLinkChallenges = sqliteTable(
  "lti_link_challenges",
  {
    tokenHash: text("token_hash").primaryKey(),
    platformId: text("platform_id")
      .notNull()
      .references(() => ltiPlatforms.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
  },
  (table) => [
    index("lti_link_challenges_platform_subject_idx").on(
      table.platformId,
      table.subject,
    ),
  ],
);

export const ltiDeepLinkRequests = sqliteTable(
  "lti_deep_link_requests",
  {
    tokenHash: text("token_hash").primaryKey(),
    platformId: text("platform_id")
      .notNull()
      .references(() => ltiPlatforms.id, { onDelete: "cascade" }),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => ltiDeployments.id, { onDelete: "cascade" }),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    returnUrl: text("return_url").notNull(),
    data: text("data"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
  },
  (table) => [
    index("lti_deep_link_requests_expires_at_idx").on(table.expiresAt),
  ],
);

export const ltiGradeJobs = sqliteTable(
  "lti_grade_jobs",
  {
    id: text("id").primaryKey(),
    resourceLinkId: text("resource_link_id")
      .notNull()
      .references(() => ltiResourceLinks.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    maxScore: real("max_score").notNull(),
    scoreTimestamp: text("score_timestamp").notNull(),
    status: text("status", {
      enum: ["pending", "sending", "complete", "failed"],
    }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: text("next_attempt_at").notNull(),
    lastFailureReason: text("last_failure_reason", {
      enum: LTI_GRADE_FAILURE_REASONS,
    }),
    // Named for what it now holds: the platform's own words about the last
    // failure, not Carnap's. The reason code above is the translatable part.
    lastErrorDetail: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("lti_grade_jobs_link_user_unique").on(
      table.resourceLinkId,
      table.userId,
    ),
    index("lti_grade_jobs_status_next_attempt_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

export const adminAuditEvents = sqliteTable(
  "admin_audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    targetUserId: text("target_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    targetCourseId: text("target_course_id").references(() => courses.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    requestId: text("request_id").notNull(),
    metadataJson: text("metadata_json", { mode: "json" }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("admin_audit_events_created_at_idx").on(table.createdAt),
    index("admin_audit_events_actor_user_id_idx").on(table.actorUserId),
    index("admin_audit_events_target_user_id_idx").on(table.targetUserId),
  ],
);
