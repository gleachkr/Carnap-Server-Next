import type {
  Assignment,
  AssignmentContentVersion,
  AssignmentExerciseExcuse,
  AssignmentLatePolicy,
  AssignmentOverride,
  GradesVisibility,
} from "../domain/assignments";
import type {
  CompiledContentArtifact,
  ContentItem,
  ContentRevision,
} from "../domain/content";
import type { CourseRole } from "../domain/courses";
import type { AppId } from "../domain/ids";
import { createAppId } from "../domain/ids";
import type { Timestamp } from "../domain/time";
import { isTimestamp, timestampNow } from "../domain/time";
import { deferred } from "../i18n/deferred";
import type { TranslatableMessage } from "../i18n/translator";
import type { AuthenticatedActor } from "./auth";
import { requireCourseRole, requireInstructor } from "./authorization";
import {
  ContentArtifactError,
  contentArtifactFromRevision,
} from "./content/artifact";
import { AppHttpError, badRequest, forbidden } from "./errors";
import {
  assignmentAsAppliedTo,
  attemptActivity,
  effectiveAssignmentPolicy,
} from "./policies";
import type { AppStores } from "./stores";

const ASSIGNMENT_TITLE_MAX_LENGTH = 200;
const ASSIGNMENT_DESCRIPTION_MAX_LENGTH = 4000;
const ASSIGNMENT_MAX_ATTEMPTS_LIMIT = 100;
const ASSIGNMENT_TIME_LIMIT_MINUTES_LIMIT = 7 * 24 * 60;
const ASSIGNMENT_CORRECTION_NOTE_MAX_LENGTH = 2000;
const ASSIGNMENT_EXERCISE_ID_MAX_LENGTH = 200;

export interface AssignmentServiceOptions {
  readonly now?: () => Date;
  readonly stores: AppStores;
}

export interface CreateAssignmentCommand {
  readonly availableFrom?: string | null;
  readonly availableUntil?: string | null;
  readonly assessmentMode?: Assignment["assessmentMode"] | null;
  readonly contentRevisionId: AppId;
  readonly description?: string | null;
  readonly displayOrder?: number | null;
  readonly dueAt?: string | null;
  /**
   * The timestamp itself. Read directly when no {@link CreateAssignmentCommand.gradesVisibility}
   * accompanies it — that is the shape the API has always accepted, where a
   * missing value means "not released" — and read as the time to schedule when
   * one does.
   */
  readonly gradesVisibleAt?: string | null;
  readonly gradesVisibility?: string | null;
  readonly listed?: boolean | null;
  readonly maxAttempts?: number | null;
  readonly timeLimitMinutes?: number | null;
  readonly title: string;
}

export type UpdateAssignmentCommand = CreateAssignmentCommand;

/**
 * The subset of assignment properties an instructor may change after the
 * assignment is published: scheduling and presentation only. Content
 * (`contentRevisionId`) has its own controlled path (repointing), grade
 * visibility has the release control, and the assessment mode stays frozen —
 * changing any of those on a live assignment would invalidate existing work.
 */
export type UpdatePublishedSettingsCommand = Pick<
  CreateAssignmentCommand,
  | "availableFrom"
  | "availableUntil"
  | "description"
  | "displayOrder"
  | "dueAt"
  | "listed"
  | "maxAttempts"
  | "timeLimitMinutes"
  | "title"
>;

export interface RepointPublishedAssignmentCommand {
  readonly contentRevisionId: AppId;
  readonly note?: string | null;
}

export interface ExcuseAssignmentExerciseCommand {
  readonly exerciseId: string;
  readonly reason?: string | null;
}

export interface LatePolicyCommand {
  readonly graceMinutes?: number | null;
  readonly kind: AssignmentLatePolicy["kind"];
  readonly maxPercentPenalty?: number | null;
  readonly percentPenalty?: number | null;
}

export interface AssignmentOverrideCommand {
  readonly availableFrom?: string | null;
  readonly availableUntil?: string | null;
  readonly dueAt?: string | null;
  readonly maxAttempts?: number | null;
  readonly timeLimitMinutes?: number | null;
  readonly userId: AppId;
}

export interface AssignmentDetail {
  readonly artifact: CompiledContentArtifact;
  /**
   * Set only when the stored artifact could not be read, and only on the
   * instructor's own page — the English diagnosis from
   * {@link ContentArtifactError}, so the page can say what is wrong where the
   * content would have been. When it is set, `artifact` is an empty stand-in
   * and means nothing; when it is absent, `artifact` is the real thing.
   */
  readonly artifactDefect?: string;
  readonly assignment: Assignment;
  readonly contentItem: ContentItem;
  readonly contentRevision: ContentRevision;
  readonly contentVersions: readonly AssignmentContentVersion[];
  readonly exerciseExcuses: readonly AssignmentExerciseExcuse[];
}

function normalizeTitle(title: string): string {
  return title.trim();
}

function normalizeDescription(
  description: string | null | undefined,
): string {
  return description?.trim() ?? "";
}

function normalizeCorrectionNote(note: string | null | undefined): string {
  const normalized = note?.trim() ?? "";

  if (normalized.length > ASSIGNMENT_CORRECTION_NOTE_MAX_LENGTH) {
    throw badRequest(
      "invalid_assignment_correction_note",
      deferred.i18n.t("Correction notes must be 2000 characters or fewer."),
    );
  }

  return normalized;
}

function normalizeExerciseId(value: string): string {
  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized.length > ASSIGNMENT_EXERCISE_ID_MAX_LENGTH
  ) {
    throw badRequest(
      "invalid_exercise_id",
      deferred.i18n.t("Exercise IDs must be between 1 and 200 characters."),
    );
  }

  return normalized;
}

function normalizeTimestamp(
  value: string | null | undefined,
  fieldName: string,
): Timestamp | null {
  if (value === undefined || value === null || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim();

  if (!isTimestamp(normalized)) {
    throw badRequest(
      `invalid_assignment_${fieldName}`,
      deferred.i18n.t("Assignment timestamps must be ISO UTC timestamps."),
    );
  }

  return normalized;
}

function assertTitle(title: string): void {
  if (title.length === 0 || title.length > ASSIGNMENT_TITLE_MAX_LENGTH) {
    throw badRequest(
      "invalid_assignment_title",
      deferred.i18n.t(
        "Assignment title must be between 1 and 200 characters.",
      ),
    );
  }
}

function assertDescription(description: string): void {
  if (description.length > ASSIGNMENT_DESCRIPTION_MAX_LENGTH) {
    throw badRequest(
      "invalid_assignment_description",
      deferred.i18n.t(
        "Assignment description must be 4000 characters or less.",
      ),
    );
  }
}

function assertTimestampOrder(
  availableFrom: Timestamp | null,
  dueAt: Timestamp | null,
  availableUntil: Timestamp | null,
): void {
  if (availableFrom !== null && availableUntil !== null) {
    if (availableFrom >= availableUntil) {
      throw badRequest(
        "invalid_assignment_availability",
        deferred.i18n.t("Available-from must be before available-until."),
      );
    }
  }

  if (dueAt !== null && availableUntil !== null && dueAt > availableUntil) {
    throw badRequest(
      "invalid_assignment_due_at",
      deferred.i18n.t("Due time cannot be after available-until."),
    );
  }
}

function assignmentNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "assignment_not_found",
    deferred.i18n.t("The assignment was not found."),
  );
}

function contentRevisionNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "content_revision_not_found",
    deferred.i18n.t("The content revision was not found."),
  );
}

function contentItemNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "content_item_not_found",
    deferred.i18n.t("The content item was not found."),
  );
}

/**
 * A structurally valid artifact stripped of its content: no document nodes and
 * an empty exercise manifest. Used to withhold the questions of a graded
 * assignment until the student has an active attempt, so they can't be read
 * ahead of time through either the rendered page or the JSON endpoint (both
 * derive everything they expose from the artifact).
 */
function withheldContentArtifact(
  artifact: CompiledContentArtifact,
): CompiledContentArtifact {
  // Built field-by-field rather than spread so authored material can never
  // ride along: the `css` stylesheet in particular can carry authored text
  // in `content:` rules.
  return {
    componentRegistryVersion: artifact.componentRegistryVersion,
    document: { ...artifact.document, nodes: [] },
    manifest: [],
    manifestVersion: artifact.manifestVersion,
    sourceProfile: artifact.sourceProfile,
  };
}

/**
 * The stand-in for an artifact that could not be read at all: structurally
 * valid, and empty. It exists so the instructor's page can render everything
 * that is not the content — the record, the schedule, and above all the control
 * that repoints the assignment at a different revision.
 *
 * That control is the whole point. Reading an assignment renders its artifact,
 * so before this an instructor whose assignment held a bad artifact could not
 * open the one page that could repair it: they were locked out by the defect,
 * with a 500 that named neither the assignment nor the revision.
 */
function unreadableContentArtifact(): CompiledContentArtifact {
  return {
    componentRegistryVersion: "",
    document: { nodes: [], profile: "carnap-markdown-v1" },
    manifest: [],
    manifestVersion: 1,
    sourceProfile: "carnap-markdown-v1",
  };
}

function normalizeAssessmentMode(
  value: Assignment["assessmentMode"] | null | undefined,
): Assignment["assessmentMode"] {
  if (value === undefined || value === null) {
    return "graded";
  }

  if (value !== "none" && value !== "practice" && value !== "graded") {
    throw badRequest(
      "invalid_assessment_mode",
      deferred.i18n.t("Assessment mode must be none, practice, or graded."),
    );
  }

  return value;
}

function normalizeGradesVisibility(
  value: string | null | undefined,
): GradesVisibility | null {
  if (value === undefined || value === null || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim();

  if (
    normalized !== "immediate" &&
    normalized !== "manual" &&
    normalized !== "scheduled"
  ) {
    throw badRequest(
      "invalid_assignment_grades_visibility",
      deferred.i18n.t(
        "Grade visibility must be immediate, manual, or scheduled.",
      ),
    );
  }

  return normalized;
}

/**
 * When this assignment's grades become visible, as a stored timestamp.
 *
 * Three named choices collapse to one nullable column, which is why the choice
 * is resolved here rather than in the form: `immediate` needs the clock, and
 * only the service has one. A command that names no choice keeps the older
 * reading — whatever timestamp it carries, null included — so an API caller that
 * has always sent `gradesVisibleAt` alone is unaffected.
 *
 * `scheduled` with nothing to schedule is refused rather than quietly demoted to
 * "never", which is the mistake the whole control exists to stop.
 */
function resolveGradesVisibleAt(
  command: Pick<
    CreateAssignmentCommand,
    "gradesVisibleAt" | "gradesVisibility"
  >,
  now: Timestamp,
): Timestamp | null {
  const at = normalizeTimestamp(command.gradesVisibleAt, "grades_visible_at");
  const visibility = normalizeGradesVisibility(command.gradesVisibility);

  switch (visibility) {
    case "immediate":
      return now;
    case "manual":
      return null;
    case "scheduled":
      if (at === null) {
        throw badRequest(
          "invalid_assignment_grades_visibility",
          deferred.i18n.t(
            "Give the time when grades become visible, or choose another option.",
          ),
        );
      }

      return at;
    case null:
      return at;
  }
}

function normalizeDisplayOrder(value: number | null | undefined): number {
  if (value === undefined || value === null) {
    return 0;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw badRequest(
      "invalid_display_order",
      deferred.i18n.t("Display order must be a non-negative integer."),
    );
  }

  return value;
}

/**
 * The whole sentence comes from the caller, not an English noun phrase spliced
 * into a template here: a fragment like "Late policy" would reach the catalog on
 * its own, with this sentence's English word order already baked in.
 */
function gradedOnly(
  assignment: Assignment,
  message: TranslatableMessage,
): void {
  if (assignment.assessmentMode === "graded") {
    return;
  }

  throw badRequest("assignment_not_graded", message);
}

function normalizeMaxAttempts(value: number | null | undefined): number {
  if (value === undefined || value === null) {
    return 1;
  }

  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > ASSIGNMENT_MAX_ATTEMPTS_LIMIT
  ) {
    throw badRequest(
      "invalid_assignment_max_attempts",
      deferred.i18n.t("Max attempts must be an integer between 1 and 100."),
    );
  }

  return value;
}

function normalizeTimeLimitMinutes(
  value: number | null | undefined,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > ASSIGNMENT_TIME_LIMIT_MINUTES_LIMIT
  ) {
    throw badRequest(
      "invalid_assignment_time_limit_minutes",
      deferred.i18n.t(
        "Time limit must be an integer between 1 and 10080 minutes.",
      ),
    );
  }

  return value;
}

function normalizePercent(value: number | null | undefined): number {
  if (value === undefined || value === null) {
    return 0;
  }

  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw badRequest(
      "invalid_late_policy_percent",
      deferred.i18n.t("Late policy percentages must be between 0 and 100."),
    );
  }

  return value;
}

function normalizeNonNegativeInteger(
  value: number | null | undefined,
  code: string,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw badRequest(
      code,
      deferred.i18n.t("Value must be a non-negative integer."),
    );
  }

  return value;
}

function normalizeLatePolicyKind(
  value: string,
): AssignmentLatePolicy["kind"] {
  if (
    value !== "none" &&
    value !== "percent_once_after_due" &&
    value !== "percent_per_day"
  ) {
    throw badRequest(
      "invalid_late_policy_kind",
      deferred.i18n.t("Late policy kind is not supported."),
    );
  }

  return value;
}

export class AssignmentService {
  constructor(private readonly options: AssignmentServiceOptions) {}

  async createDraft(
    actor: AuthenticatedActor,
    courseId: AppId,
    command: CreateAssignmentCommand,
  ): Promise<AssignmentDetail> {
    await requireInstructor(this.options.stores, actor, courseId);

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    const title = normalizeTitle(command.title);
    const description = normalizeDescription(command.description);
    const assessmentMode = normalizeAssessmentMode(command.assessmentMode);
    const displayOrder = normalizeDisplayOrder(command.displayOrder);
    const availableFrom = normalizeTimestamp(
      command.availableFrom,
      "available_from",
    );
    const dueAt =
      assessmentMode === "graded"
        ? normalizeTimestamp(command.dueAt, "due_at")
        : null;
    const availableUntil = normalizeTimestamp(
      command.availableUntil,
      "available_until",
    );
    const gradesVisibleAt =
      assessmentMode === "graded"
        ? resolveGradesVisibleAt(command, now)
        : null;
    const maxAttempts =
      assessmentMode === "graded"
        ? normalizeMaxAttempts(command.maxAttempts)
        : 1;
    const timeLimitMinutes =
      assessmentMode === "graded"
        ? normalizeTimeLimitMinutes(command.timeLimitMinutes)
        : null;

    assertTitle(title);
    assertDescription(description);
    assertTimestampOrder(availableFrom, dueAt, availableUntil);

    const revision = await this.options.stores.content.getRevision(
      command.contentRevisionId,
    );

    if (revision === null) {
      throw contentRevisionNotFound();
    }

    const item = await this.options.stores.content.getItem(revision.itemId);

    if (item === null) {
      throw contentItemNotFound();
    }

    if (item.ownerUserId !== actor.user.id) {
      throw forbidden("content_owner_required");
    }

    const assignment = await this.options.stores.assignments.create({
      assessmentMode,
      displayOrder,
      availableFrom,
      availableUntil,
      contentRevisionId: revision.id,
      courseId,
      createdAt: now,
      createdById: actor.user.id,
      description,
      dueAt,
      gradesVisibleAt,
      id: createAppId(nowDate.getTime()),
      listed: command.listed ?? true,
      maxAttempts,
      timeLimitMinutes,
      title,
    });

    return {
      artifact: contentArtifactFromRevision(revision),
      assignment,
      contentItem: item,
      contentRevision: revision,
      contentVersions: [],
      exerciseExcuses: [],
    };
  }

  async updateDraft(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    command: UpdateAssignmentCommand,
  ): Promise<AssignmentDetail> {
    await requireInstructor(this.options.stores, actor, courseId);

    const existing = await this.getAssignmentInCourse(courseId, assignmentId);

    if (existing.state !== "draft") {
      throw badRequest(
        "assignment_not_draft",
        deferred.i18n.t("Only draft assignments can be edited."),
      );
    }

    const updatedAt = timestampNow(this.options.now?.() ?? new Date());
    const title = normalizeTitle(command.title);
    const description = normalizeDescription(command.description);
    const assessmentMode = normalizeAssessmentMode(command.assessmentMode);
    const displayOrder = normalizeDisplayOrder(command.displayOrder);
    const availableFrom = normalizeTimestamp(
      command.availableFrom,
      "available_from",
    );
    const dueAt =
      assessmentMode === "graded"
        ? normalizeTimestamp(command.dueAt, "due_at")
        : null;
    const availableUntil = normalizeTimestamp(
      command.availableUntil,
      "available_until",
    );
    // A draft has no work recorded against it, so "immediate" on an edit means
    // the same thing it meant at creation: visible from the moment it is live.
    const gradesVisibleAt =
      assessmentMode === "graded"
        ? resolveGradesVisibleAt(command, updatedAt)
        : null;
    const maxAttempts =
      assessmentMode === "graded"
        ? normalizeMaxAttempts(command.maxAttempts)
        : 1;
    const timeLimitMinutes =
      assessmentMode === "graded"
        ? normalizeTimeLimitMinutes(command.timeLimitMinutes)
        : null;

    assertTitle(title);
    assertDescription(description);
    assertTimestampOrder(availableFrom, dueAt, availableUntil);

    const revision = await this.options.stores.content.getRevision(
      command.contentRevisionId,
    );

    if (revision === null) {
      throw contentRevisionNotFound();
    }

    const item = await this.options.stores.content.getItem(revision.itemId);

    if (item === null) {
      throw contentItemNotFound();
    }

    if (item.ownerUserId !== actor.user.id) {
      throw forbidden("content_owner_required");
    }

    const updated = await this.options.stores.assignments.updateDraft({
      assessmentMode,
      displayOrder,
      availableFrom,
      availableUntil,
      contentRevisionId: revision.id,
      description,
      dueAt,
      gradesVisibleAt,
      id: existing.id,
      listed: command.listed ?? true,
      maxAttempts,
      timeLimitMinutes,
      title,
      updatedAt,
    });

    if (updated === null) {
      throw badRequest(
        "assignment_not_draft",
        deferred.i18n.t("Only draft assignments can be edited."),
      );
    }

    return {
      artifact: contentArtifactFromRevision(revision),
      assignment: updated,
      contentItem: item,
      contentRevision: revision,
      contentVersions: [],
      exerciseExcuses: [],
    };
  }

  async publish(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
  ): Promise<AssignmentDetail> {
    await requireInstructor(this.options.stores, actor, courseId);

    const existing = await this.getAssignmentInCourse(courseId, assignmentId);

    if (existing.state !== "draft") {
      throw badRequest(
        "assignment_already_published",
        deferred.i18n.t("Only draft assignments can be published."),
      );
    }

    const nowDate = this.options.now?.() ?? new Date();
    const published = await this.options.stores.assignments.publish({
      actorId: actor.user.id,
      contentRevisionId: existing.contentRevisionId,
      id: existing.id,
      publishedAt: timestampNow(nowDate),
      versionId: createAppId(nowDate.getTime()),
    });

    if (published === null) {
      throw assignmentNotFound();
    }

    return this.detailForAssignment(published);
  }

  /**
   * Return a published assignment to draft so it can be edited again. Blocked
   * once any student has an attempt, since reverting would strand their
   * attempts and scores; the instructor must reset attempts first.
   */
  async unpublish(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
  ): Promise<AssignmentDetail> {
    await requireInstructor(this.options.stores, actor, courseId);

    const existing = await this.getAssignmentInCourse(courseId, assignmentId);

    if (existing.state !== "published") {
      throw badRequest(
        "assignment_not_published",
        deferred.i18n.t("Only published assignments can be unpublished."),
      );
    }

    const attempts =
      await this.options.stores.assessment.listAttemptsForAssignment(
        existing.id,
      );

    if (attempts.length > 0) {
      throw badRequest(
        "assignment_has_attempts",
        deferred.i18n.t(
          "Unpublish is blocked once a student has an attempt; reset attempts first.",
        ),
      );
    }

    const unpublished = await this.options.stores.assignments.unpublish({
      id: existing.id,
      updatedAt: timestampNow(this.options.now?.() ?? new Date()),
    });

    if (unpublished === null) {
      throw assignmentNotFound();
    }

    return this.detailForAssignment(unpublished);
  }

  /**
   * Permanently discard a draft assignment. Restricted to drafts: a draft has
   * never been published, so no student has ever seen it and it carries no
   * attempts or scores to strand. Published assignments stay as permanent
   * records and must be unpublished first (which is itself attempt-guarded).
   */
  async deleteDraft(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
  ): Promise<void> {
    await requireInstructor(this.options.stores, actor, courseId);

    const existing = await this.getAssignmentInCourse(courseId, assignmentId);

    if (existing.state !== "draft") {
      throw badRequest(
        "assignment_not_draft",
        deferred.i18n.t("Only draft assignments can be deleted."),
      );
    }

    const deleted = await this.options.stores.assignments.delete({
      id: existing.id,
    });

    if (deleted === null) {
      throw assignmentNotFound();
    }
  }

  async repointPublishedContent(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    command: RepointPublishedAssignmentCommand,
  ): Promise<AssignmentDetail> {
    await requireInstructor(this.options.stores, actor, courseId);

    const existing = await this.getAssignmentInCourse(courseId, assignmentId);

    if (existing.state !== "published") {
      throw badRequest(
        "assignment_not_published",
        deferred.i18n.t("Only published assignments can be repointed."),
      );
    }

    const currentRevision = await this.options.stores.content.getRevision(
      existing.contentRevisionId,
    );

    if (currentRevision === null) {
      throw contentRevisionNotFound();
    }

    const revision = await this.options.stores.content.getRevision(
      command.contentRevisionId,
    );

    if (revision === null) {
      throw contentRevisionNotFound();
    }

    if (revision.itemId !== currentRevision.itemId) {
      throw badRequest(
        "assignment_revision_item_mismatch",
        deferred.i18n.t(
          "Published assignments can only be repointed to a revision of the same content item.",
        ),
      );
    }

    const item = await this.options.stores.content.getItem(revision.itemId);

    if (item === null) {
      throw contentItemNotFound();
    }

    if (item.ownerUserId !== actor.user.id) {
      throw forbidden("content_owner_required");
    }

    const nowDate = this.options.now?.() ?? new Date();
    const updated = await this.options.stores.assignments.repointPublished({
      actorId: actor.user.id,
      assignmentId: existing.id,
      contentRevisionId: revision.id,
      effectiveAt: timestampNow(nowDate),
      note: normalizeCorrectionNote(command.note),
      versionId: createAppId(nowDate.getTime()),
    });

    if (updated === null) {
      throw assignmentNotFound();
    }

    return this.detailForAssignment(updated);
  }

  async updatePublishedSettings(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    command: UpdatePublishedSettingsCommand,
  ): Promise<AssignmentDetail> {
    await requireInstructor(this.options.stores, actor, courseId);

    const existing = await this.getAssignmentInCourse(courseId, assignmentId);

    if (existing.state !== "published") {
      throw badRequest(
        "assignment_not_published",
        deferred.i18n.t(
          "Only published assignments can have their settings edited.",
        ),
      );
    }

    const graded = existing.assessmentMode === "graded";
    const title = normalizeTitle(command.title);
    const description = normalizeDescription(command.description);
    const displayOrder = normalizeDisplayOrder(command.displayOrder);
    const availableFrom = normalizeTimestamp(
      command.availableFrom,
      "available_from",
    );
    const availableUntil = normalizeTimestamp(
      command.availableUntil,
      "available_until",
    );
    const dueAt = graded
      ? normalizeTimestamp(command.dueAt, "due_at")
      : existing.dueAt;
    const maxAttempts = graded
      ? normalizeMaxAttempts(command.maxAttempts)
      : existing.maxAttempts;
    const timeLimitMinutes = graded
      ? normalizeTimeLimitMinutes(command.timeLimitMinutes)
      : existing.timeLimitMinutes;

    assertTitle(title);
    assertDescription(description);
    assertTimestampOrder(availableFrom, dueAt, availableUntil);

    const updatedAt = timestampNow(this.options.now?.() ?? new Date());
    const updated =
      await this.options.stores.assignments.updatePublishedSettings({
        assignmentId: existing.id,
        availableFrom,
        availableUntil,
        description,
        displayOrder,
        dueAt,
        listed: command.listed ?? true,
        maxAttempts,
        timeLimitMinutes,
        title,
        updatedAt,
      });

    if (updated === null) {
      throw badRequest(
        "assignment_not_published",
        deferred.i18n.t(
          "Only published assignments can have their settings edited.",
        ),
      );
    }

    return this.detailForAssignment(updated);
  }

  async setGradeVisibility(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    release: boolean,
  ): Promise<AssignmentDetail> {
    await requireInstructor(this.options.stores, actor, courseId);

    const existing = await this.getAssignmentInCourse(courseId, assignmentId);

    if (existing.state !== "published") {
      throw badRequest(
        "assignment_not_published",
        deferred.i18n.t("Only published assignments can release grades."),
      );
    }

    if (existing.assessmentMode !== "graded") {
      throw badRequest(
        "assignment_not_graded",
        deferred.i18n.t("Only graded assignments have releasable grades."),
      );
    }

    const now = timestampNow(this.options.now?.() ?? new Date());
    const updated = await this.options.stores.assignments.setGradesVisibleAt({
      assignmentId: existing.id,
      gradesVisibleAt: release ? now : null,
      updatedAt: now,
    });

    if (updated === null) {
      throw assignmentNotFound();
    }

    return this.detailForAssignment(updated);
  }

  async excuseExercise(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    command: ExcuseAssignmentExerciseCommand,
  ): Promise<AssignmentExerciseExcuse> {
    await requireInstructor(this.options.stores, actor, courseId);

    const assignment = await this.getAssignmentInCourse(
      courseId,
      assignmentId,
    );

    gradedOnly(
      assignment,
      deferred.i18n.t(
        "Excusing exercises is only available for graded assignments.",
      ),
    );

    if (assignment.state !== "published") {
      throw badRequest(
        "assignment_not_published",
        deferred.i18n.t(
          "Only published assignments can have excused exercises.",
        ),
      );
    }

    const exerciseId = normalizeExerciseId(command.exerciseId);
    const existing = (
      await this.options.stores.assignments.listExerciseExcuses(assignment.id)
    ).find((excuse) => excuse.exerciseId === exerciseId);

    if (existing !== undefined) {
      return existing;
    }

    const nowDate = this.options.now?.() ?? new Date();

    return this.options.stores.assignments.excuseExercise({
      actorId: actor.user.id,
      assignmentId: assignment.id,
      createdAt: timestampNow(nowDate),
      exerciseId,
      id: createAppId(nowDate.getTime()),
      reason: normalizeCorrectionNote(command.reason),
    });
  }

  async listForInstructor(
    actor: AuthenticatedActor,
    courseId: AppId,
  ): Promise<Assignment[]> {
    await requireInstructor(this.options.stores, actor, courseId);

    return this.options.stores.assignments.listForCourse(courseId);
  }

  /**
   * `onUnreadableArtifact` is the caller's to choose because being an
   * instructor is not by itself a reason to be shown a broken page: the JSON
   * endpoint and the content document both want the error, and only the two
   * pages that can actually repair the assignment — its record page and its
   * settings editor, neither of which needs the artifact for anything else —
   * ask to be handed the diagnosis instead.
   */
  async getForInstructor(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    onUnreadableArtifact: "describe" | "throw" = "throw",
  ): Promise<AssignmentDetail> {
    await requireInstructor(this.options.stores, actor, courseId);

    return this.detailForAssignment(
      await this.getAssignmentInCourse(courseId, assignmentId),
      onUnreadableArtifact,
    );
  }

  async listForStudent(
    actor: AuthenticatedActor,
    courseId: AppId,
  ): Promise<Assignment[]> {
    await requireCourseRole(this.options.stores, actor, courseId, ["member"]);

    const [assignments, accommodation, overrides] = await Promise.all([
      this.options.stores.assignments.listForCourse(courseId),
      this.options.stores.courses.getAccommodation(courseId, actor.user.id),
      this.options.stores.assignments.listOverridesForCourseUser(
        courseId,
        actor.user.id,
      ),
    ]);
    const overrideByAssignment = new Map(
      overrides.map((override) => [override.assignmentId, override] as const),
    );

    // Students see every published, listed assignment regardless of timing: the
    // view labels each as upcoming, open, or closed, and closed ones linger for
    // reference. Only drafts and unlisted assignments stay hidden, and the detail
    // page remains gated outside the open window (getForStudent requires canView).
    //
    // Each row is the assignment as it applies to this student, so the dates the
    // list labels are the ones they are actually held to — and so a row stays
    // linked when an override keeps their window open past the course's.
    return assignments
      .filter(
        (assignment) => assignment.listed && assignment.state === "published",
      )
      .map((assignment) =>
        assignmentAsAppliedTo(assignment, {
          accommodation,
          override: overrideByAssignment.get(assignment.id) ?? null,
        }),
      );
  }

  /**
   * Resolve a content item to the assignment publishing it in this course:
   * the target of an `item:` link followed from a content document. Staff can
   * land on drafts (published still wins); everyone else resolves published
   * assignments only. When several assignments publish revisions of the same
   * item, listed ones win, then course display order (the `listForCourse`
   * ordering) decides. The returned role lets the route pick the instructor
   * or student assignment page.
   */
  async resolveContentItem(
    actor: AuthenticatedActor,
    courseId: AppId,
    contentItemId: AppId,
  ): Promise<{ assignment: Assignment; role: CourseRole }> {
    const membership = await requireCourseRole(
      this.options.stores,
      actor,
      courseId,
      ["member"],
    );
    const revisionIds = new Set(
      (
        await this.options.stores.content.listRevisionsForItem(contentItemId)
      ).map((revision) => revision.id),
    );
    const candidates = (
      await this.options.stores.assignments.listForCourse(courseId)
    ).filter((assignment) => revisionIds.has(assignment.contentRevisionId));
    const staff =
      membership.role === "instructor" || membership.role === "co_instructor";
    const pool = staff
      ? candidates
      : candidates.filter((assignment) => assignment.state === "published");
    const resolved =
      pool.find(
        (assignment) => assignment.state === "published" && assignment.listed,
      ) ??
      pool.find((assignment) => assignment.state === "published") ??
      pool[0];

    if (resolved === undefined) {
      throw new AppHttpError(
        404,
        "content_not_available",
        deferred.i18n.t("This content is not available in this course."),
      );
    }

    return { assignment: resolved, role: membership.role };
  }

  async getForStudent(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
  ): Promise<AssignmentDetail> {
    await requireCourseRole(this.options.stores, actor, courseId, ["member"]);

    const now = timestampNow(this.options.now?.() ?? new Date());
    const stored = await this.getAssignmentInCourse(courseId, assignmentId);

    // The student's own assignment, not the course's: an override that moves
    // their window has to govern whether they may open the page, not merely be
    // recorded next to a decision made without it. Everything downstream — the
    // briefing's dates, attempt allowance, and time limit — reads it from here.
    const [attempts, accommodation, override] = await Promise.all([
      this.options.stores.assessment.listAttemptsForAssignmentUser(
        stored.id,
        actor.user.id,
      ),
      this.options.stores.courses.getAccommodation(courseId, actor.user.id),
      this.options.stores.assignments.getOverrideForAssignmentUser(
        stored.id,
        actor.user.id,
      ),
    ]);
    const assignment = assignmentAsAppliedTo(stored, {
      accommodation,
      override,
    });
    const policy = effectiveAssignmentPolicy(assignment, attempts, now);

    if (!policy.canView) {
      throw assignmentNotFound();
    }

    const detail = await this.detailForAssignment(assignment);
    const activity = attemptActivity(attempts, now);
    const contentReleased =
      assignment.assessmentMode !== "graded" ||
      activity.activeAttempt !== null;

    if (contentReleased) {
      return detail;
    }

    return { ...detail, artifact: withheldContentArtifact(detail.artifact) };
  }

  async upsertLatePolicy(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    command: LatePolicyCommand,
  ): Promise<AssignmentLatePolicy> {
    await requireInstructor(this.options.stores, actor, courseId);

    const assignment = await this.getAssignmentInCourse(
      courseId,
      assignmentId,
    );
    gradedOnly(
      assignment,
      deferred.i18n.t(
        "Late policy is only available for graded assignments.",
      ),
    );

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    const percentPenalty = normalizePercent(command.percentPenalty);
    const maxPercentPenalty =
      command.maxPercentPenalty === undefined ||
      command.maxPercentPenalty === null
        ? 100
        : normalizePercent(command.maxPercentPenalty);

    return this.options.stores.assignments.upsertLatePolicy({
      assignmentId: assignment.id,
      createdById: actor.user.id,
      graceMinutes:
        normalizeNonNegativeInteger(
          command.graceMinutes,
          "invalid_late_policy_grace",
        ) ?? 0,
      kind: normalizeLatePolicyKind(command.kind),
      maxPercentPenalty,
      now,
      percentPenalty,
    });
  }

  async upsertOverride(
    actor: AuthenticatedActor,
    courseId: AppId,
    assignmentId: AppId,
    command: AssignmentOverrideCommand,
  ): Promise<AssignmentOverride> {
    await requireInstructor(this.options.stores, actor, courseId);

    const assignment = await this.getAssignmentInCourse(
      courseId,
      assignmentId,
    );
    gradedOnly(
      assignment,
      deferred.i18n.t("Overrides are only available for graded assignments."),
    );

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);

    return this.options.stores.assignments.upsertOverride({
      assignmentId: assignment.id,
      availableFrom: normalizeTimestamp(
        command.availableFrom,
        "override_available_from",
      ),
      availableUntil: normalizeTimestamp(
        command.availableUntil,
        "override_available_until",
      ),
      createdById: actor.user.id,
      dueAt: normalizeTimestamp(command.dueAt, "override_due_at"),
      id: createAppId(nowDate.getTime()),
      maxAttempts: normalizeNonNegativeInteger(
        command.maxAttempts,
        "invalid_override_max_attempts",
      ),
      now,
      timeLimitMinutes: normalizeNonNegativeInteger(
        command.timeLimitMinutes,
        "invalid_override_time_limit",
      ),
      userId: command.userId,
    });
  }

  private async getAssignmentInCourse(
    courseId: AppId,
    assignmentId: AppId,
  ): Promise<Assignment> {
    const assignment =
      await this.options.stores.assignments.getById(assignmentId);

    if (assignment === null || assignment.courseId !== courseId) {
      throw assignmentNotFound();
    }

    return assignment;
  }

  /**
   * `onUnreadableArtifact` decides what an artifact that will not parse means
   * here. It is `throw` everywhere by default, because a page that quietly
   * renders an empty lesson is worse than an error: a student sees an
   * assignment with nothing in it and no reason to doubt that, and grading
   * computed from an empty manifest is a wrong number rather than a failure.
   * The one caller that passes `describe` is the instructor's own page, where
   * the alternative is not seeing anything at all — see
   * {@link unreadableContentArtifact}.
   */
  private async detailForAssignment(
    assignment: Assignment,
    onUnreadableArtifact: "describe" | "throw" = "throw",
  ): Promise<AssignmentDetail> {
    const revision = await this.options.stores.content.getRevision(
      assignment.contentRevisionId,
    );

    if (revision === null) {
      throw contentRevisionNotFound();
    }

    const item = await this.options.stores.content.getItem(revision.itemId);

    if (item === null) {
      throw contentItemNotFound();
    }

    const [contentVersions, exerciseExcuses] = await Promise.all([
      this.options.stores.assignments.listContentVersions(assignment.id),
      this.options.stores.assignments.listExerciseExcuses(assignment.id),
    ]);

    const base = {
      assignment,
      contentItem: item,
      contentRevision: revision,
      contentVersions,
      exerciseExcuses,
    };

    try {
      return { ...base, artifact: contentArtifactFromRevision(revision) };
    } catch (error) {
      if (
        onUnreadableArtifact === "throw" ||
        !(error instanceof ContentArtifactError)
      ) {
        throw error;
      }

      return {
        ...base,
        artifact: unreadableContentArtifact(),
        artifactDefect: error.defect,
      };
    }
  }
}
