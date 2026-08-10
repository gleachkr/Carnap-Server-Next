import type {
  AdminAuditEvent,
  AdminGlobalStats,
  PlatformCapability,
  PlatformCapabilityGrant,
} from "../domain/admin";
import type { Attempt, Evaluation, Submission } from "../domain/assessment";
import type {
  Assignment,
  AssignmentContentVersion,
  AssignmentExerciseExcuse,
  AssignmentLatePolicy,
  AssignmentOverride,
} from "../domain/assignments";
import type { AuthSession, NativeLoginChallenge } from "../domain/auth";
import type { ContentItem, ContentRevision } from "../domain/content";
import type {
  Course,
  CourseAccommodation,
  CourseEnrollmentLink,
  CourseMembership,
} from "../domain/courses";
import type { AssignmentScore } from "../domain/grades";
import type { AppId } from "../domain/ids";
import type { JsonValue } from "../domain/json";
import type {
  LtiContext,
  LtiDeepLinkRequest,
  LtiDeployment,
  LtiGradeFailureReason,
  LtiGradeJob,
  LtiGradeJobStatus,
  LtiLinkChallenge,
  LtiLoginState,
  LtiPlatform,
  LtiResourceLink,
} from "../domain/lti";
import type { Timestamp } from "../domain/time";
import type { ExternalIdentity, User } from "../domain/users";

export interface CreateUserInput {
  readonly id: AppId;
  readonly email: string;
  /** Omitted or null means the address has not been proven (LTI-asserted). */
  readonly emailVerifiedAt?: Timestamp | null;
  readonly name: string | null;
  readonly createdAt: Timestamp;
}

export interface UpdateUserProfileInput {
  /**
   * The interface language this user wants Carnap in, or null to go on
   * following the request's own — its cookie, its `Accept-Language`, an LTI
   * launch's platform locale.
   */
  readonly locale: string | null;
  readonly name: string | null;
}

export interface CreateExternalIdentityInput {
  readonly id: AppId;
  readonly userId: AppId;
  readonly provider: ExternalIdentity["provider"];
  readonly providerSubject: string;
  readonly createdAt: Timestamp;
}

export interface SearchUsersInput {
  readonly limit: number;
  readonly query: string;
}

export interface UserStore {
  create(input: CreateUserInput): Promise<User>;
  disable(id: AppId, disabledAt: Timestamp): Promise<User | null>;
  enable(id: AppId, updatedAt: Timestamp): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  getById(id: AppId): Promise<User | null>;
  /**
   * Record proof of address ownership. Only ever sets a null
   * email_verified_at; returns null when the user is missing or the address
   * was already verified.
   */
  markEmailVerified(id: AppId, verifiedAt: Timestamp): Promise<User | null>;
  /**
   * Rewrite the fields a user controls about themselves — name and language —
   * as one row update, because they are saved as one form.
   */
  updateProfile(
    id: AppId,
    input: UpdateUserProfileInput,
    updatedAt: Timestamp,
  ): Promise<User | null>;
  listExternalIdentitiesForUser(userId: AppId): Promise<ExternalIdentity[]>;
  search(input: SearchUsersInput): Promise<User[]>;
  createExternalIdentity(
    input: CreateExternalIdentityInput,
  ): Promise<ExternalIdentity>;
  deleteExternalIdentity(id: AppId): Promise<boolean>;
  getExternalIdentity(
    provider: ExternalIdentity["provider"],
    providerSubject: string,
  ): Promise<ExternalIdentity | null>;
  /**
   * The user's LTI subject (`sub` claim) on one platform, or null when the
   * account holds no identity there. LTI provider subjects are stored as
   * `{platformRowId}:{sub}`.
   */
  getLtiSubject(userId: AppId, platformId: AppId): Promise<string | null>;
}

export interface CreateNativeLoginChallengeInput {
  readonly id: AppId;
  readonly email: string;
  readonly name: string | null;
  readonly tokenHash: string;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
}

export interface CreateAuthSessionInput {
  readonly tokenHash: string;
  readonly userId: AppId;
  readonly csrfTokenHash: string;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
}

export interface AuthStore {
  createNativeLoginChallenge(
    input: CreateNativeLoginChallengeInput,
  ): Promise<NativeLoginChallenge>;
  consumeNativeLoginChallenge(
    tokenHash: string,
    consumedAt: Timestamp,
  ): Promise<NativeLoginChallenge | null>;
  createSession(input: CreateAuthSessionInput): Promise<AuthSession>;
  getValidSession(
    tokenHash: string,
    now: Timestamp,
  ): Promise<AuthSession | null>;
  revokeSession(
    tokenHash: string,
    revokedAt: Timestamp,
  ): Promise<AuthSession | null>;
}

export interface CreateCourseInput {
  readonly id: AppId;
  readonly title: string;
  readonly timezone: string;
  readonly createdById: AppId;
  readonly createdAt: Timestamp;
}

export interface UpdateCourseInfoInput {
  readonly id: AppId;
  readonly title: string;
  readonly timezone: string;
  readonly updatedAt: Timestamp;
}

export interface SetCourseArchivedInput {
  readonly id: AppId;
  readonly archivedAt: Timestamp | null;
  readonly updatedAt: Timestamp;
}

export interface AddCourseMembershipInput {
  readonly id: AppId;
  readonly courseId: AppId;
  readonly userId: AppId;
  readonly role: CourseMembership["role"];
  readonly status: CourseMembership["status"];
  readonly createdAt: Timestamp;
}

export interface UpdateCourseMembershipStatusInput {
  readonly courseId: AppId;
  readonly membershipId: AppId;
  readonly status: CourseMembership["status"];
  readonly updatedAt: Timestamp;
}

export interface UpdateCourseMembershipRoleInput {
  readonly courseId: AppId;
  readonly membershipId: AppId;
  readonly role: CourseMembership["role"];
  readonly updatedAt: Timestamp;
}

export interface UpsertCourseMembershipInput {
  readonly courseId: AppId;
  readonly createdAt: Timestamp;
  readonly id: AppId;
  readonly role: CourseMembership["role"];
  readonly status: CourseMembership["status"];
  readonly updatedAt: Timestamp;
  readonly userId: AppId;
}

export interface CourseListEntry {
  readonly course: Course;
  readonly membership: CourseMembership;
}

export interface CreateEnrollmentLinkInput {
  readonly id: AppId;
  readonly courseId: AppId;
  readonly tokenHash: string;
  readonly createdById: AppId;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
}

export interface RevokeEnrollmentLinkInput {
  readonly courseId: AppId;
  readonly linkId: AppId;
  readonly revokedAt: Timestamp;
}

export interface AddCourseAccommodationInput {
  readonly id: AppId;
  readonly courseId: AppId;
  readonly userId: AppId;
  readonly extraAttempts: number;
  readonly timeLimitMultiplier: number;
  readonly dueAtExtensionMinutes: number;
  readonly availableUntilExtensionMinutes: number;
  readonly createdById: AppId;
  readonly now: Timestamp;
}

export interface CourseStore {
  create(input: CreateCourseInput): Promise<Course>;
  getById(id: AppId): Promise<Course | null>;
  updateInfo(input: UpdateCourseInfoInput): Promise<Course | null>;
  setArchived(input: SetCourseArchivedInput): Promise<Course | null>;
  addMembership(input: AddCourseMembershipInput): Promise<CourseMembership>;
  getAccommodation(
    courseId: AppId,
    userId: AppId,
  ): Promise<CourseAccommodation | null>;
  listAccommodationsForCourse(
    courseId: AppId,
  ): Promise<CourseAccommodation[]>;
  getMembership(
    courseId: AppId,
    userId: AppId,
  ): Promise<CourseMembership | null>;
  getMembershipById(
    courseId: AppId,
    membershipId: AppId,
  ): Promise<CourseMembership | null>;
  listForUser(userId: AppId): Promise<CourseListEntry[]>;
  /**
   * Whether the user actively staffs any course at all — instructor,
   * co-instructor, or teaching assistant. Asked of every signed-in request, so
   * it answers with a boolean rather than making the caller sift a list of
   * memberships it does not otherwise want.
   */
  hasStaffMembership(userId: AppId): Promise<boolean>;
  listAll(): Promise<Course[]>;
  listMembershipsForCourse(courseId: AppId): Promise<CourseMembership[]>;
  updateMembershipStatus(
    input: UpdateCourseMembershipStatusInput,
  ): Promise<CourseMembership | null>;
  updateMembershipRole(
    input: UpdateCourseMembershipRoleInput,
  ): Promise<CourseMembership | null>;
  upsertMembership(
    input: UpsertCourseMembershipInput,
  ): Promise<CourseMembership>;
  createEnrollmentLink(
    input: CreateEnrollmentLinkInput,
  ): Promise<CourseEnrollmentLink>;
  getValidEnrollmentLink(
    tokenHash: string,
    now: Timestamp,
  ): Promise<CourseEnrollmentLink | null>;
  listEnrollmentLinksForCourse(
    courseId: AppId,
  ): Promise<CourseEnrollmentLink[]>;
  revokeEnrollmentLink(
    input: RevokeEnrollmentLinkInput,
  ): Promise<CourseEnrollmentLink | null>;
  upsertAccommodation(
    input: AddCourseAccommodationInput,
  ): Promise<CourseAccommodation>;
}

export interface CreateContentItemInput {
  readonly id: AppId;
  readonly ownerUserId: AppId;
  readonly title: string;
  readonly createdAt: Timestamp;
}

export interface CreateContentRevisionInput {
  readonly id: AppId;
  readonly itemId: AppId;
  readonly revisionNumber: number;
  /** Required, not optional-with-a-default: the column defaults to `''`, and a
   * caller that forgets the field should have to say so rather than inherit it. */
  readonly details: string;
  readonly sourceFormat: ContentRevision["sourceFormat"];
  readonly sourceText: string;
  readonly contentHash: string;
  readonly compiled: JsonValue;
  readonly createdById: AppId;
  readonly createdAt: Timestamp;
}

export interface ContentStore {
  createItem(input: CreateContentItemInput): Promise<ContentItem>;
  getItem(id: AppId): Promise<ContentItem | null>;
  listItemsForOwner(ownerUserId: AppId): Promise<ContentItem[]>;
  createRevision(input: CreateContentRevisionInput): Promise<ContentRevision>;
  getRevision(id: AppId): Promise<ContentRevision | null>;
  /**
   * Newest first. A revision list is a history, and the revision anyone is
   * looking for is nearly always the last one saved — so it reads the way a
   * history reads, and every picker's default option is the current text
   * rather than the first draft. Callers that want the latest take `[0]`.
   */
  listRevisionsForItem(itemId: AppId): Promise<ContentRevision[]>;
}

export interface CreateAssignmentInput {
  readonly id: AppId;
  readonly courseId: AppId;
  readonly contentRevisionId: AppId;
  readonly title: string;
  readonly description: string;
  readonly assessmentMode: Assignment["assessmentMode"];
  readonly displayOrder: number;
  readonly availableFrom: Timestamp | null;
  readonly dueAt: Timestamp | null;
  readonly availableUntil: Timestamp | null;
  readonly gradesVisibleAt: Timestamp | null;
  readonly listed: boolean;
  readonly maxAttempts: number;
  readonly timeLimitMinutes: number | null;
  readonly createdById: AppId;
  readonly createdAt: Timestamp;
}

export interface UpdateAssignmentInput {
  readonly id: AppId;
  readonly contentRevisionId: AppId;
  readonly title: string;
  readonly description: string;
  readonly assessmentMode: Assignment["assessmentMode"];
  readonly displayOrder: number;
  readonly availableFrom: Timestamp | null;
  readonly dueAt: Timestamp | null;
  readonly availableUntil: Timestamp | null;
  readonly gradesVisibleAt: Timestamp | null;
  readonly listed: boolean;
  readonly maxAttempts: number;
  readonly timeLimitMinutes: number | null;
  readonly updatedAt: Timestamp;
}

export interface PublishAssignmentInput {
  readonly actorId: AppId;
  readonly contentRevisionId: AppId;
  readonly id: AppId;
  readonly publishedAt: Timestamp;
  readonly versionId: AppId;
}

export interface UnpublishAssignmentInput {
  readonly id: AppId;
  readonly updatedAt: Timestamp;
}

export interface DeleteAssignmentInput {
  readonly id: AppId;
}

export interface RepointPublishedAssignmentInput {
  readonly actorId: AppId;
  readonly assignmentId: AppId;
  readonly contentRevisionId: AppId;
  readonly effectiveAt: Timestamp;
  readonly note: string;
  readonly versionId: AppId;
}

export interface ExcuseAssignmentExerciseInput {
  readonly actorId: AppId;
  readonly assignmentId: AppId;
  readonly createdAt: Timestamp;
  readonly exerciseId: string;
  readonly id: AppId;
  readonly reason: string;
}

export interface UpsertLatePolicyInput {
  readonly assignmentId: AppId;
  readonly kind: AssignmentLatePolicy["kind"];
  readonly percentPenalty: number;
  readonly maxPercentPenalty: number;
  readonly graceMinutes: number;
  readonly createdById: AppId;
  readonly now: Timestamp;
}

export interface UpsertAssignmentOverrideInput {
  readonly id: AppId;
  readonly assignmentId: AppId;
  readonly userId: AppId;
  readonly availableFrom: Timestamp | null;
  readonly dueAt: Timestamp | null;
  readonly availableUntil: Timestamp | null;
  readonly maxAttempts: number | null;
  readonly timeLimitMinutes: number | null;
  readonly createdById: AppId;
  readonly now: Timestamp;
}

export interface SetGradesVisibleAtInput {
  readonly assignmentId: AppId;
  readonly gradesVisibleAt: Timestamp | null;
  readonly updatedAt: Timestamp;
}

export interface UpdatePublishedSettingsInput {
  readonly assignmentId: AppId;
  readonly availableFrom: Timestamp | null;
  readonly availableUntil: Timestamp | null;
  readonly description: string;
  readonly displayOrder: number;
  readonly dueAt: Timestamp | null;
  readonly listed: boolean;
  readonly maxAttempts: number;
  readonly timeLimitMinutes: number | null;
  readonly title: string;
  readonly updatedAt: Timestamp;
}

export interface AssignmentStore {
  create(input: CreateAssignmentInput): Promise<Assignment>;
  excuseExercise(
    input: ExcuseAssignmentExerciseInput,
  ): Promise<AssignmentExerciseExcuse>;
  getById(id: AppId): Promise<Assignment | null>;
  listContentVersions(
    assignmentId: AppId,
  ): Promise<AssignmentContentVersion[]>;
  getLatePolicy(assignmentId: AppId): Promise<AssignmentLatePolicy | null>;
  getOverrideForAssignmentUser(
    assignmentId: AppId,
    userId: AppId,
  ): Promise<AssignmentOverride | null>;
  /**
   * Every override one student has anywhere in one course, so a course-wide
   * listing can show each assignment as it applies to them without a query per
   * row.
   */
  listOverridesForCourseUser(
    courseId: AppId,
    userId: AppId,
  ): Promise<AssignmentOverride[]>;
  listExerciseExcuses(
    assignmentId: AppId,
  ): Promise<AssignmentExerciseExcuse[]>;
  listForCourse(courseId: AppId): Promise<Assignment[]>;
  upsertLatePolicy(
    input: UpsertLatePolicyInput,
  ): Promise<AssignmentLatePolicy>;
  upsertOverride(
    input: UpsertAssignmentOverrideInput,
  ): Promise<AssignmentOverride>;
  publish(input: PublishAssignmentInput): Promise<Assignment | null>;
  unpublish(input: UnpublishAssignmentInput): Promise<Assignment | null>;
  delete(input: DeleteAssignmentInput): Promise<Assignment | null>;
  repointPublished(
    input: RepointPublishedAssignmentInput,
  ): Promise<Assignment | null>;
  setGradesVisibleAt(
    input: SetGradesVisibleAtInput,
  ): Promise<Assignment | null>;
  updateDraft(input: UpdateAssignmentInput): Promise<Assignment | null>;
  updatePublishedSettings(
    input: UpdatePublishedSettingsInput,
  ): Promise<Assignment | null>;
}

export interface BeginAttemptInput {
  readonly id: AppId;
  readonly assignmentId: AppId;
  readonly userId: AppId;
  readonly openedAt: Timestamp;
  readonly expiresAt: Timestamp | null;
  readonly createdFrom: Attempt["createdFrom"];
  readonly maxAttempts: number | null;
}

export interface ResetAttemptInput {
  readonly oldAttemptId: AppId;
  readonly newAttemptId: AppId;
  readonly assignmentId: AppId;
  readonly userId: AppId;
  readonly openedAt: Timestamp;
  readonly expiresAt: Timestamp | null;
  readonly voidedAt: Timestamp;
  readonly voidedById: AppId;
}

export interface AppendSubmissionInput {
  readonly id: AppId;
  readonly attemptId: AppId;
  readonly userId: AppId;
  readonly contentRevisionId?: AppId;
  readonly exerciseId?: string;
  readonly declarationHash?: string;
  readonly answerKind?: string;
  readonly idempotencyKey: string | null;
  readonly answer: JsonValue;
  readonly submittedAt: Timestamp;
}

export interface AppendEvaluationInput {
  readonly id: AppId;
  readonly submissionId: AppId;
  readonly evaluatorKind: Evaluation["evaluatorKind"];
  readonly checkerVersion: string | null;
  readonly result: JsonValue;
  readonly score: number;
  readonly maxScore: number;
  readonly createdAt: Timestamp;
}

export interface UpsertAssignmentScoreInput {
  readonly assignmentId: AppId;
  readonly userId: AppId;
  readonly score: number;
  readonly maxScore: number;
  readonly status: AssignmentScore["status"];
  readonly calculatedAt: Timestamp;
}

export interface ScoreStore {
  getAssignmentScore(
    assignmentId: AppId,
    userId: AppId,
  ): Promise<AssignmentScore | null>;
  listAssignmentScores(assignmentId: AppId): Promise<AssignmentScore[]>;
  upsertAssignmentScore(
    input: UpsertAssignmentScoreInput,
  ): Promise<AssignmentScore>;
  /**
   * Write the score and its outbound grade-passback jobs in one transaction,
   * so a grade can never change without the LMS send being queued (PLAN §11.4).
   */
  upsertAssignmentScoreWithGradeJobs(
    input: UpsertAssignmentScoreInput,
    jobs: readonly EnqueueLtiGradeJobInput[],
  ): Promise<AssignmentScore>;
}

export interface AssessmentStore {
  beginAttempt(input: BeginAttemptInput): Promise<Attempt | null>;
  expireOpenAttempts(
    assignmentId: AppId,
    userId: AppId,
    now: Timestamp,
  ): Promise<Attempt[]>;
  getAttempt(id: AppId): Promise<Attempt | null>;
  getSubmission(id: AppId): Promise<Submission | null>;
  listAttemptsForAssignment(assignmentId: AppId): Promise<Attempt[]>;
  listAttemptsForAssignmentUser(
    assignmentId: AppId,
    userId: AppId,
  ): Promise<Attempt[]>;
  resetAttempt(input: ResetAttemptInput): Promise<{
    readonly newAttempt: Attempt;
    readonly voidedAttempt: Attempt;
  } | null>;
  appendSubmission(input: AppendSubmissionInput): Promise<Submission>;
  listSubmissionsForAttempt(attemptId: AppId): Promise<Submission[]>;
  appendEvaluation(input: AppendEvaluationInput): Promise<Evaluation>;
  listEvaluationsForSubmission(submissionId: AppId): Promise<Evaluation[]>;
  appendSubmissionWithEvaluation(
    submission: AppendSubmissionInput,
    evaluation: AppendEvaluationInput,
  ): Promise<{
    readonly evaluation: Evaluation;
    readonly submission: Submission;
  }>;
}

export interface GrantPlatformCapabilityInput {
  readonly capability: PlatformCapability;
  readonly grantedAt: Timestamp;
  readonly grantedById: AppId | null;
  readonly id: AppId;
  readonly userId: AppId;
}

export interface RevokePlatformCapabilityInput {
  readonly capability: PlatformCapability;
  readonly revokedAt: Timestamp;
  readonly userId: AppId;
}

export interface PlatformCapabilityStore {
  grant(
    input: GrantPlatformCapabilityInput,
  ): Promise<PlatformCapabilityGrant>;
  hasAnyActiveSiteAdmin(): Promise<boolean>;
  listActiveForUser(userId: AppId): Promise<PlatformCapabilityGrant[]>;
  revoke(
    input: RevokePlatformCapabilityInput,
  ): Promise<PlatformCapabilityGrant | null>;
}

export interface CreateLtiPlatformInput {
  readonly id: AppId;
  readonly name: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly createdAt: Timestamp;
}

export interface CreateLtiDeploymentInput {
  readonly id: AppId;
  readonly platformId: AppId;
  readonly deploymentId: string;
  readonly name: string;
  readonly createdAt: Timestamp;
}

export interface CreateLtiContextInput {
  readonly id: AppId;
  readonly deploymentId: AppId;
  readonly contextId: string;
  readonly courseId: AppId;
  readonly createdAt: Timestamp;
}

export interface UpsertLtiResourceLinkInput {
  readonly id: AppId;
  readonly contextId: AppId;
  readonly resourceLinkId: string;
  readonly title: string;
  readonly agsLineItemUrl: string | null;
  readonly now: Timestamp;
}

export interface CreateLtiDeepLinkRequestInput {
  readonly tokenHash: string;
  readonly platformId: AppId;
  readonly deploymentId: AppId;
  readonly courseId: AppId;
  readonly userId: AppId;
  readonly returnUrl: string;
  readonly data: string | null;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
}

export interface EnqueueLtiGradeJobInput {
  /** Used only when no row exists yet for (resourceLinkId, userId). */
  readonly id: AppId;
  readonly resourceLinkId: AppId;
  readonly userId: AppId;
  readonly score: number;
  readonly maxScore: number;
  readonly scoreTimestamp: Timestamp;
  readonly now: Timestamp;
}

export interface FailLtiGradeJobInput {
  readonly id: AppId;
  /**
   * The `updatedAt` the claim stamped on the row. The failure only lands if
   * the row still carries it — any other value means another claimant (or a
   * re-pointing enqueue) owns the row now.
   */
  readonly claimedAt: Timestamp;
  readonly attemptCount: number;
  readonly reason: LtiGradeFailureReason;
  /** The platform's own words, when it had any; null otherwise. */
  readonly detail: string | null;
  /** Null marks the job permanently failed instead of scheduling a retry. */
  readonly nextAttemptAt: Timestamp | null;
  readonly now: Timestamp;
}

export interface CreateLtiLoginStateInput {
  readonly stateHash: string;
  readonly nonceHash: string;
  readonly platformId: AppId;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
}

export interface CreateLtiLinkChallengeInput {
  readonly tokenHash: string;
  readonly platformId: AppId;
  readonly subject: string;
  readonly email: string;
  readonly name: string | null;
  readonly userId: AppId;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
}

export interface LtiStore {
  createPlatform(input: CreateLtiPlatformInput): Promise<LtiPlatform>;
  getPlatformById(id: AppId): Promise<LtiPlatform | null>;
  getPlatformByIssuerClientId(
    issuer: string,
    clientId: string,
  ): Promise<LtiPlatform | null>;
  listPlatforms(): Promise<LtiPlatform[]>;
  listPlatformsByIssuer(issuer: string): Promise<LtiPlatform[]>;
  setPlatformDisabled(
    id: AppId,
    disabledAt: Timestamp | null,
    updatedAt: Timestamp,
  ): Promise<LtiPlatform | null>;
  createDeployment(input: CreateLtiDeploymentInput): Promise<LtiDeployment>;
  deleteDeployment(platformId: AppId, id: AppId): Promise<boolean>;
  getDeployment(
    platformId: AppId,
    deploymentId: string,
  ): Promise<LtiDeployment | null>;
  listDeploymentsForPlatform(platformId: AppId): Promise<LtiDeployment[]>;
  createContext(input: CreateLtiContextInput): Promise<LtiContext>;
  getContext(
    deploymentId: AppId,
    contextId: string,
  ): Promise<LtiContext | null>;
  getContextById(id: AppId): Promise<LtiContext | null>;
  getResourceLinkById(id: AppId): Promise<LtiResourceLink | null>;
  getResourceLink(
    contextRowId: AppId,
    resourceLinkId: string,
  ): Promise<LtiResourceLink | null>;
  listUnmappedResourceLinksForCourse(
    courseId: AppId,
  ): Promise<LtiResourceLink[]>;
  setResourceLinkAssignment(
    id: AppId,
    assignmentId: AppId | null,
    updatedAt: Timestamp,
  ): Promise<LtiResourceLink | null>;
  upsertResourceLink(
    input: UpsertLtiResourceLinkInput,
  ): Promise<LtiResourceLink>;
  createLoginState(input: CreateLtiLoginStateInput): Promise<LtiLoginState>;
  consumeLoginState(
    stateHash: string,
    now: Timestamp,
  ): Promise<LtiLoginState | null>;
  createLinkChallenge(
    input: CreateLtiLinkChallengeInput,
  ): Promise<LtiLinkChallenge>;
  consumeLinkChallenge(
    tokenHash: string,
    now: Timestamp,
  ): Promise<LtiLinkChallenge | null>;
  deleteLinkChallenge(tokenHash: string): Promise<void>;
  /** Look up a still-pending challenge by token without consuming it. */
  getLinkChallenge(
    tokenHash: string,
    now: Timestamp,
  ): Promise<LtiLinkChallenge | null>;
  getPendingLinkChallenge(
    platformId: AppId,
    subject: string,
    userId: AppId,
    now: Timestamp,
  ): Promise<LtiLinkChallenge | null>;
  getDeploymentById(id: AppId): Promise<LtiDeployment | null>;
  listResourceLinksForAssignment(
    assignmentId: AppId,
  ): Promise<LtiResourceLink[]>;
  createDeepLinkRequest(
    input: CreateLtiDeepLinkRequestInput,
  ): Promise<LtiDeepLinkRequest>;
  /** Look up a still-pending deep link request without consuming it. */
  getDeepLinkRequest(
    tokenHash: string,
    now: Timestamp,
  ): Promise<LtiDeepLinkRequest | null>;
  consumeDeepLinkRequest(
    tokenHash: string,
    now: Timestamp,
  ): Promise<LtiDeepLinkRequest | null>;
  /**
   * Queue (or re-point) the outbox row for one (resource link, user). An
   * existing row is reset to a fresh pending send carrying the new score,
   * whatever state it was in — including mid-flight `sending`, whose
   * completion update is guarded so the newer score wins. Returns null when
   * the existing row already carries a newer score than this one.
   */
  enqueueGradeJob(
    input: EnqueueLtiGradeJobInput,
  ): Promise<LtiGradeJob | null>;
  getGradeJob(
    resourceLinkId: AppId,
    userId: AppId,
  ): Promise<LtiGradeJob | null>;
  /**
   * Atomically move due pending jobs (and stale `sending` jobs abandoned by
   * a dead worker) to `sending` and return them for delivery. The claim
   * stamps `updatedAt`, which the completion updates below require back —
   * that is what makes a claim owned rather than shared.
   */
  claimDueGradeJobs(
    now: Timestamp,
    reclaimSendingBefore: Timestamp,
    limit: number,
  ): Promise<LtiGradeJob[]>;
  /** Returns null when the job was superseded or reclaimed while in flight. */
  completeGradeJob(
    id: AppId,
    claimedAt: Timestamp,
    now: Timestamp,
  ): Promise<LtiGradeJob | null>;
  /** Returns null when the job was superseded or reclaimed while in flight. */
  failGradeJob(input: FailLtiGradeJobInput): Promise<LtiGradeJob | null>;
  /**
   * Put a claimed job back in the queue for a later attempt without spending
   * retry budget — the delivery was withheld (e.g. grades not yet released),
   * not attempted. Returns null when the job was superseded while claimed.
   */
  deferGradeJob(
    id: AppId,
    claimedAt: Timestamp,
    nextAttemptAt: Timestamp,
    now: Timestamp,
  ): Promise<LtiGradeJob | null>;
  /** Reset a permanently failed job for another delivery attempt. */
  retryGradeJob(id: AppId, now: Timestamp): Promise<LtiGradeJob | null>;
  /**
   * Drop every outbox row for a resource link — for re-pointing the link at
   * a different assignment, where queued scores describe the old one.
   */
  deleteGradeJobsForResourceLink(resourceLinkId: AppId): Promise<void>;
  /** Make every pending job for an assignment's links due now. */
  rescheduleGradeJobsForAssignment(
    assignmentId: AppId,
    now: Timestamp,
  ): Promise<void>;
  getGradeJobById(id: AppId): Promise<LtiGradeJob | null>;
  listGradeJobsForCourse(
    courseId: AppId,
    status: LtiGradeJobStatus,
  ): Promise<LtiGradeJob[]>;
}

export interface CreateAdminAuditEventInput {
  readonly action: string;
  readonly actorUserId: AppId;
  readonly createdAt: Timestamp;
  readonly id: AppId;
  readonly metadata: JsonValue;
  readonly requestId: string;
  readonly targetCourseId: AppId | null;
  readonly targetUserId: AppId | null;
}

export interface AdminAuditStore {
  append(input: CreateAdminAuditEventInput): Promise<AdminAuditEvent>;
  listRecent(limit: number): Promise<AdminAuditEvent[]>;
}

export interface AdminStatsStore {
  getGlobalStats(): Promise<AdminGlobalStats>;
}

export interface AppStores {
  readonly adminAudit: AdminAuditStore;
  readonly adminStats: AdminStatsStore;
  readonly assignments: AssignmentStore;
  readonly assessment: AssessmentStore;
  readonly auth: AuthStore;
  readonly content: ContentStore;
  readonly courses: CourseStore;
  readonly lti: LtiStore;
  readonly platformCapabilities: PlatformCapabilityStore;
  readonly scores: ScoreStore;
  readonly users: UserStore;
}
