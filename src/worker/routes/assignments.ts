import { type Context, Hono } from "hono";

import { AssignmentService } from "../application/assignments";
import { AttemptService } from "../application/attempts";
import type { AuthenticatedActor } from "../application/auth";
import { requireAuthenticated } from "../application/authorization";
import { ContentService } from "../application/content";
import {
  ContentArtifactError,
  contentArtifactFromRevision,
} from "../application/content/artifact";
import {
  componentAssetsForArtifact,
  renderCompiledContent,
} from "../application/content/renderer";
import { CourseService } from "../application/courses";
import { AppHttpError, badRequest } from "../application/errors";
import { GradebookService } from "../application/gradebook";
import { ManualGradingService } from "../application/manual-grading";
import {
  attemptActivity,
  type EffectiveAssignmentPolicy,
  effectiveAssignmentPolicy,
} from "../application/policies";
import {
  type SubmissionHistoryEntry,
  SubmissionService,
} from "../application/submissions";
import {
  type Attempt,
  type Submission,
  submissionNeedsReview,
  type ViewerEvaluation,
} from "../domain/assessment";
import type {
  Assignment,
  AssignmentContentVersion,
  AssignmentExerciseExcuse,
  AssignmentOverride,
} from "../domain/assignments";
import type {
  AnswerEnvelope,
  CompiledContentArtifact,
  ContentItem,
  ContentRevision,
} from "../domain/content";
import {
  resolveExerciseFeedback,
  viewerEvaluation,
} from "../domain/feedback";
import { assertJsonValue } from "../domain/json";
import { timestampNow } from "../domain/time";
import type { AppBindings } from "../http";
import { deferred } from "../i18n/deferred";
import type { Translator } from "../i18n/translator";
import { kickGradePassback } from "../passback";
import { storesForContext } from "../stores";
import {
  type AssignmentDetail,
  type AssignmentRevisionOption,
  activeAttemptFor,
  editAssignmentAction,
  type InlineSubmissionContext,
  type InstructorSubmissionReviewEntry,
  latestExerciseRuntimeState,
  renderAssignmentContentDocument,
  renderAssignmentFormError,
  renderAttemptGatePage,
  renderEditAssignmentPage,
  renderInstructorAssignmentPage,
  renderInstructorAttempts,
  renderInstructorSubmissions,
  renderNewAssignmentPage,
  renderStudentAssignmentPage,
} from "../web/assignment-detail";
import { coursesCrumb } from "../web/breadcrumbs";
import { APP_FRAME_PARAM } from "../web/content-document";
import { renderFormError } from "../web/errors";
import {
  fieldValue,
  isFormSubmission,
  redirect,
  wantsHtml,
} from "../web/html";
import { resolveUsers } from "../web/users";

interface CreateAssignmentBody {
  readonly availableFrom?: unknown;
  readonly availableUntil?: unknown;
  readonly assessmentMode?: unknown;
  readonly contentRevisionId?: unknown;
  readonly displayOrder?: unknown;
  readonly description?: unknown;
  readonly dueAt?: unknown;
  readonly gradesVisibleAt?: unknown;
  readonly gradesVisibility?: unknown;
  readonly listed?: unknown;
  readonly maxAttempts?: unknown;
  readonly timeLimitMinutes?: unknown;
  readonly title?: unknown;
}

interface PublishedSettingsBody {
  readonly availableFrom?: unknown;
  readonly availableUntil?: unknown;
  readonly description?: unknown;
  readonly displayOrder?: unknown;
  readonly dueAt?: unknown;
  readonly listed?: unknown;
  readonly maxAttempts?: unknown;
  readonly timeLimitMinutes?: unknown;
  readonly title?: unknown;
}

interface RepointAssignmentBody {
  readonly contentRevisionId?: unknown;
  readonly note?: unknown;
}

interface ExcuseExerciseBody {
  readonly exerciseId?: unknown;
  readonly reason?: unknown;
}

interface ManualEvaluationBody {
  readonly feedback?: unknown;
  readonly maxScore?: unknown;
  readonly score?: unknown;
}

interface LatePolicyBody {
  readonly graceMinutes?: unknown;
  readonly kind?: unknown;
  readonly maxPercentPenalty?: unknown;
  readonly percentPenalty?: unknown;
}

interface AssignmentOverrideBody {
  readonly availableFrom?: unknown;
  readonly availableUntil?: unknown;
  readonly dueAt?: unknown;
  readonly maxAttempts?: unknown;
  readonly timeLimitMinutes?: unknown;
  readonly userId?: unknown;
}

function assignmentService(context: Context<AppBindings>): AssignmentService {
  return new AssignmentService({ stores: storesForContext(context) });
}

function contentService(context: Context<AppBindings>): ContentService {
  return new ContentService({ stores: storesForContext(context) });
}

function courseService(context: Context<AppBindings>): CourseService {
  return new CourseService({ stores: storesForContext(context) });
}

function attemptService(context: Context<AppBindings>): AttemptService {
  return new AttemptService({ stores: storesForContext(context) });
}

function submissionService(context: Context<AppBindings>): SubmissionService {
  return new SubmissionService({ stores: storesForContext(context) });
}

function manualGradingService(
  context: Context<AppBindings>,
): ManualGradingService {
  return new ManualGradingService({ stores: storesForContext(context) });
}

async function readJsonObject(
  context: Context<AppBindings>,
): Promise<Record<string, unknown>> {
  try {
    const body = await context.req.json();

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw badRequest("invalid_json", "A JSON object is required.");
    }

    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppHttpError) {
      throw error;
    }

    throw badRequest("invalid_json", "A JSON object is required.");
  }
}

function requiredParam(context: Context<AppBindings>, name: string): string {
  const value = context.req.param(name);

  if (value === undefined) {
    throw badRequest(
      "missing_route_parameter",
      "A route parameter is missing.",
    );
  }

  return value;
}

function webActorOrLogin(context: Context<AppBindings>): Response | null {
  if (context.get("actor") !== null) {
    return null;
  }

  const next = new URL(context.req.url).pathname;

  return redirect(`/login?next=${encodeURIComponent(next)}`, 302);
}

async function courseTitleFor(
  context: Context<AppBindings>,
  courseId: string,
): Promise<string> {
  const course = await storesForContext(context).courses.getById(courseId);
  const i18n = context.get("i18n");

  // The fallback is our own word, not the author's, so it is translated: it
  // stands in a breadcrumb beside chrome the reader is already seeing in their
  // language.
  return course?.title ?? i18n.t("Course");
}

async function assignmentTitleFor(
  context: Context<AppBindings>,
  assignmentId: string,
): Promise<string> {
  const assignment =
    await storesForContext(context).assignments.getById(assignmentId);
  const i18n = context.get("i18n");

  return assignment?.title ?? i18n.t("Assignment");
}

function publicAssignment(assignment: Assignment) {
  return {
    availableFrom: assignment.availableFrom,
    availableUntil: assignment.availableUntil,
    assessmentMode: assignment.assessmentMode,
    contentRevisionId: assignment.contentRevisionId,
    courseId: assignment.courseId,
    createdAt: assignment.createdAt,
    createdById: assignment.createdById,
    description: assignment.description,
    displayOrder: assignment.displayOrder,
    dueAt: assignment.dueAt,
    gradesVisibleAt: assignment.gradesVisibleAt,
    id: assignment.id,
    listed: assignment.listed,
    maxAttempts: assignment.maxAttempts,
    publishedAt: assignment.publishedAt,
    state: assignment.state,
    timeLimitMinutes: assignment.timeLimitMinutes,
    title: assignment.title,
    updatedAt: assignment.updatedAt,
  };
}

function publicContentVersion(version: AssignmentContentVersion) {
  return {
    actorId: version.actorId,
    assignmentId: version.assignmentId,
    contentRevisionId: version.contentRevisionId,
    effectiveAt: version.effectiveAt,
    id: version.id,
    note: version.note,
  };
}

function publicExerciseExcuse(excuse: AssignmentExerciseExcuse) {
  return {
    actorId: excuse.actorId,
    assignmentId: excuse.assignmentId,
    createdAt: excuse.createdAt,
    exerciseId: excuse.exerciseId,
    id: excuse.id,
    reason: excuse.reason,
    status: excuse.status,
  };
}

function publicLatePolicy(policy: {
  readonly assignmentId: string;
  readonly kind: string;
  readonly percentPenalty: number;
  readonly maxPercentPenalty: number;
  readonly graceMinutes: number;
}) {
  return {
    assignmentId: policy.assignmentId,
    graceMinutes: policy.graceMinutes,
    kind: policy.kind,
    maxPercentPenalty: policy.maxPercentPenalty,
    percentPenalty: policy.percentPenalty,
  };
}

function publicOverride(override: {
  readonly assignmentId: string;
  readonly availableFrom: string | null;
  readonly availableUntil: string | null;
  readonly dueAt: string | null;
  readonly id: string;
  readonly maxAttempts: number | null;
  readonly timeLimitMinutes: number | null;
  readonly userId: string;
}) {
  return {
    assignmentId: override.assignmentId,
    availableFrom: override.availableFrom,
    availableUntil: override.availableUntil,
    dueAt: override.dueAt,
    id: override.id,
    maxAttempts: override.maxAttempts,
    timeLimitMinutes: override.timeLimitMinutes,
    userId: override.userId,
  };
}

function publicAttempt(attempt: Attempt) {
  return {
    assignmentId: attempt.assignmentId,
    createdFrom: attempt.createdFrom,
    expiresAt: attempt.expiresAt,
    id: attempt.id,
    openedAt: attempt.openedAt,
    ordinal: attempt.ordinal,
    status: attempt.status,
    submittedAt: attempt.submittedAt,
    userId: attempt.userId,
    voidReason: attempt.voidReason,
    voidedAt: attempt.voidedAt,
    voidedById: attempt.voidedById,
  };
}

function publicSubmission(submission: Submission) {
  return {
    answer: submission.answer,
    answerKind: submission.answerKind,
    attemptId: submission.attemptId,
    contentRevisionId: submission.contentRevisionId,
    declarationHash: submission.declarationHash,
    exerciseId: submission.exerciseId,
    id: submission.id,
    idempotencyKey: submission.idempotencyKey,
    submittedAt: submission.submittedAt,
    userId: submission.userId,
  };
}

function publicEvaluation(evaluation: ViewerEvaluation) {
  return {
    checkerVersion: evaluation.checkerVersion,
    createdAt: evaluation.createdAt,
    evaluatorKind: evaluation.evaluatorKind,
    id: evaluation.id,
    maxScore: evaluation.maxScore,
    result: evaluation.result,
    score: evaluation.score,
    submissionId: evaluation.submissionId,
    verdict: evaluation.verdict,
    voidedAt: evaluation.voidedAt,
  };
}

function publicRevisionSummary(revision: ContentRevision) {
  return {
    contentHash: revision.contentHash,
    createdAt: revision.createdAt,
    id: revision.id,
    itemId: revision.itemId,
    revisionNumber: revision.revisionNumber,
  };
}

function exerciseFallbackMetadata(artifact: CompiledContentArtifact) {
  return artifact.manifest.map((item) => ({
    id: item.id,
    kind: item.kind,
    nominalPoints: item.nominalPoints,
    publicData: item.publicData,
    render: item.render,
    title: item.title ?? null,
  }));
}

function assignmentDetailJson(
  detail: {
    readonly artifact: CompiledContentArtifact;
    readonly assignment: Assignment;
    readonly contentItem: ContentItem;
    readonly contentRevision: ContentRevision;
    readonly contentVersions: readonly AssignmentContentVersion[];
    readonly exerciseExcuses: readonly AssignmentExerciseExcuse[];
  },
  // `renderedHtml` carries the exercises' own chrome — group names, control
  // labels — so this JSON is language-specific even though nothing else in it is.
  i18n: Translator,
) {
  return {
    assignment: publicAssignment(detail.assignment),
    contentItem: {
      id: detail.contentItem.id,
      title: detail.contentItem.title,
    },
    contentRevision: publicRevisionSummary(detail.contentRevision),
    contentVersions: detail.contentVersions.map(publicContentVersion),
    renderedHtml: renderCompiledContent(detail.artifact, i18n, undefined, {
      contentRevisionId: detail.contentRevision.id,
    }),
    requiredComponents: componentAssetsForArtifact(detail.artifact),
    exerciseExcuses: detail.exerciseExcuses.map(publicExerciseExcuse),
    exercises: exerciseFallbackMetadata(detail.artifact),
  };
}

function formTimestamp(form: FormData, name: string): string | null {
  const value = fieldValue(form.get(name));

  return value.length === 0 ? null : value;
}

function formListed(form: FormData): boolean {
  return fieldValue(form.get("listed")) === "1";
}

function formOptionalInteger(form: FormData, name: string): number | null {
  const value = fieldValue(form.get(name));

  return value.length === 0 ? null : Number(value);
}

async function authorRevisionOptions(
  context: Context<AppBindings>,
): Promise<AssignmentRevisionOption[]> {
  const actor = requireAuthenticated(context);
  const service = contentService(context);
  const items = await service.listItems(actor);
  const revisions = await Promise.all(
    items.map(async (item) => ({
      item,
      revisions: await service.listRevisions(actor, item.id),
    })),
  );

  return revisions.flatMap(({ item, revisions }) =>
    revisions.map((revision) => ({
      item,
      revision,
      // The artifact is already in hand, so this costs a walk over data we
      // fetched anyway — and it is the difference between an instructor being
      // told a revision is broken and an instructor selecting it, publishing a
      // correction, and breaking the assignment that was working.
      ...(readableArtifact(revision) ? {} : { unreadable: true }),
    })),
  );
}

function readableArtifact(revision: ContentRevision): boolean {
  try {
    contentArtifactFromRevision(revision);

    return true;
  } catch (error) {
    if (error instanceof ContentArtifactError) {
      return false;
    }

    throw error;
  }
}

function assignmentFormValues(form: FormData) {
  const contentRevisionId = fieldValue(form.get("contentRevisionId"));

  return {
    assessmentMode: fieldValue(form.get("assessmentMode")),
    availableFrom: fieldValue(form.get("availableFrom")),
    availableUntil: fieldValue(form.get("availableUntil")),
    contentRevisionId,
    description: fieldValue(form.get("description")),
    displayOrder: fieldValue(form.get("displayOrder")),
    dueAt: fieldValue(form.get("dueAt")),
    gradesVisibleAt: fieldValue(form.get("gradesVisibleAt")),
    gradesVisibility: fieldValue(form.get("gradesVisibility")),
    listed: formListed(form) ? "1" : "0",
    maxAttempts: fieldValue(form.get("maxAttempts")),
    timeLimitMinutes: fieldValue(form.get("timeLimitMinutes")),
    title: fieldValue(form.get("title")),
  };
}

function assignmentFormCommand(form: FormData) {
  const values = assignmentFormValues(form);

  return {
    assessmentMode:
      values.assessmentMode.length === 0
        ? null
        : (values.assessmentMode as Assignment["assessmentMode"]),
    availableFrom: formTimestamp(form, "availableFrom"),
    availableUntil: formTimestamp(form, "availableUntil"),
    contentRevisionId: values.contentRevisionId,
    description: values.description,
    displayOrder: formOptionalInteger(form, "displayOrder"),
    dueAt: formTimestamp(form, "dueAt"),
    gradesVisibleAt: formTimestamp(form, "gradesVisibleAt"),
    gradesVisibility: values.gradesVisibility,
    listed: formListed(form),
    maxAttempts: formOptionalInteger(form, "maxAttempts"),
    timeLimitMinutes: formOptionalInteger(form, "timeLimitMinutes"),
    title: values.title,
  };
}

function isQuickAssignmentForm(form: FormData): boolean {
  return fieldValue(form.get("quickCreate")) === "1";
}

async function quickAssignmentFormCommand(
  context: Context<AppBindings>,
  form: FormData,
) {
  const [firstRevision] = await authorRevisionOptions(context);

  if (firstRevision === undefined) {
    throw badRequest(
      "missing_content_revision",
      deferred.i18n.t(
        "Create a content revision before creating an assignment.",
      ),
    );
  }

  return {
    contentRevisionId: firstRevision.revision.id,
    // Quick create asks for a title and nothing else, so every other setting is
    // a default it never shows. It takes the same grade-visibility default the
    // full form preselects — an instructor who wanted grades held back can say
    // so on the edit page it lands on, whereas one who never thought about it
    // would otherwise have got an assignment whose grades never appear.
    gradesVisibility: "immediate",
    title: fieldValue(form.get("title")),
  };
}

async function newAssignmentPage(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const courseId = requiredParam(context, "courseId");

  return renderNewAssignmentPage(
    context,
    courseId,
    await courseTitleFor(context, courseId),
    await authorRevisionOptions(context),
  );
}

async function createAssignmentFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const form = await context.req.raw.formData();
  const quickCreate = isQuickAssignmentForm(form);
  const values = assignmentFormValues(form);

  try {
    const command = quickCreate
      ? await quickAssignmentFormCommand(context, form)
      : assignmentFormCommand(form);
    const detail = await assignmentService(context).createDraft(
      actor,
      courseId,
      command,
    );
    const location = quickCreate
      ? `/courses/${courseId}/instructor/assignments/${detail.assignment.id}/edit?created=1`
      : `/courses/${courseId}/instructor/assignments/${detail.assignment.id}?created=1`;

    return redirect(location);
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderAssignmentFormError(context, {
        // Nothing was created, so the way back is the course it would have
        // joined — the same place the form was opened from.
        cancelHref: `/courses/${courseId}`,
        courseId,
        courseTitle: await courseTitleFor(context, courseId),
        message: error.localize(i18n),
        revisions: await authorRevisionOptions(context),
        status: error.status,
        title: i18n.t("Assignment not created"),
        values,
      });
    }

    throw error;
  }
}

async function editAssignmentPage(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  // "describe": the settings editor does not render the content at all, so a
  // revision it cannot read is no reason to keep an instructor off it.
  const detail = await assignmentService(context).getForInstructor(
    actor,
    courseId,
    assignmentId,
    "describe",
  );

  return renderEditAssignmentPage(context, {
    assignment: detail.assignment,
    assignmentId,
    courseId,
    courseTitle: await courseTitleFor(context, courseId),
    revisions:
      detail.assignment.state === "draft"
        ? await authorRevisionOptions(context)
        : [],
  });
}

async function updateAssignmentFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const form = await context.req.raw.formData();
  const values = assignmentFormValues(form);

  try {
    const detail = await assignmentService(context).updateDraft(
      actor,
      courseId,
      assignmentId,
      assignmentFormCommand(form),
    );

    return redirect(
      `/courses/${courseId}/instructor/assignments/${detail.assignment.id}?updated=1`,
    );
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderAssignmentFormError(context, {
        action: editAssignmentAction(courseId, assignmentId),
        // The assignment still exists and is unchanged, so Cancel goes back to
        // it. Its page and the form's POST target are the same path.
        cancelHref: editAssignmentAction(courseId, assignmentId),
        courseId,
        courseTitle: await courseTitleFor(context, courseId),
        message: error.localize(i18n),
        revisions: await authorRevisionOptions(context),
        status: error.status,
        submitLabel: i18n.t("Save assignment"),
        title: i18n.t("Assignment not updated"),
        values,
      });
    }

    throw error;
  }
}

async function updateAssignmentFromJson(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const detail = await assignmentService(context).updateDraft(
    actor,
    requiredParam(context, "courseId"),
    requiredParam(context, "assignmentId"),
    commandFromJson((await readJsonObject(context)) as CreateAssignmentBody),
  );

  return context.json(assignmentDetailJson(detail, context.get("i18n")));
}

async function updateAssignment(
  context: Context<AppBindings>,
): Promise<Response> {
  return isFormSubmission(context)
    ? updateAssignmentFromForm(context)
    : updateAssignmentFromJson(context);
}

async function updatePublishedSettingsFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const form = await context.req.raw.formData();

  try {
    const detail = await assignmentService(context).updatePublishedSettings(
      actor,
      courseId,
      assignmentId,
      assignmentFormCommand(form),
    );

    // Due dates feed late penalties and the release date anchors deferred
    // deliveries, so published-settings changes resync like other edits.
    await refreshScoresAfterInstructorChange(context, assignmentId);
    await storesForContext(context).lti.rescheduleGradeJobsForAssignment(
      assignmentId,
      timestampNow(new Date()),
    );

    return redirect(
      `/courses/${courseId}/instructor/assignments/${detail.assignment.id}?updated=1`,
    );
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderAssignmentFormError(context, {
        action: `${editAssignmentAction(courseId, assignmentId)}/settings`,
        cancelHref: editAssignmentAction(courseId, assignmentId),
        courseId,
        courseTitle: await courseTitleFor(context, courseId),
        message: error.localize(i18n),
        mode: "published",
        revisions: [],
        status: error.status,
        submitLabel: i18n.t("Save settings"),
        title: i18n.t("Settings not updated"),
        values: assignmentFormValues(form),
      });
    }

    throw error;
  }
}

async function updatePublishedSettingsFromJson(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const assignmentId = requiredParam(context, "assignmentId");
  const detail = await assignmentService(context).updatePublishedSettings(
    actor,
    requiredParam(context, "courseId"),
    assignmentId,
    publishedSettingsCommandFromJson(
      (await readJsonObject(context)) as PublishedSettingsBody,
    ),
  );

  await refreshScoresAfterInstructorChange(context, assignmentId);
  await storesForContext(context).lti.rescheduleGradeJobsForAssignment(
    assignmentId,
    timestampNow(new Date()),
  );

  return context.json(assignmentDetailJson(detail, context.get("i18n")));
}

async function updatePublishedSettings(
  context: Context<AppBindings>,
): Promise<Response> {
  return isFormSubmission(context)
    ? updatePublishedSettingsFromForm(context)
    : updatePublishedSettingsFromJson(context);
}

function repointCommandFromForm(form: FormData) {
  return {
    contentRevisionId: fieldValue(form.get("contentRevisionId")),
    note: fieldValue(form.get("note")) || null,
  };
}

function excuseCommandFromForm(form: FormData) {
  return {
    exerciseId: fieldValue(form.get("exerciseId")),
    reason: fieldValue(form.get("reason")) || null,
  };
}

function repointCommandFromJson(body: RepointAssignmentBody) {
  if (typeof body.contentRevisionId !== "string") {
    throw badRequest(
      "invalid_content_revision",
      "Content revision ID must be a string.",
    );
  }

  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") {
      throw badRequest(
        "invalid_assignment_correction_note",
        "Correction note must be a string.",
      );
    }
  }

  return {
    contentRevisionId: body.contentRevisionId,
    note: typeof body.note === "string" ? body.note : null,
  };
}

function excuseCommandFromJson(body: ExcuseExerciseBody) {
  if (typeof body.exerciseId !== "string") {
    throw badRequest("invalid_exercise_id", "Exercise ID must be a string.");
  }

  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== "string") {
      throw badRequest(
        "invalid_excuse_reason",
        "Exercise excuse reason must be a string.",
      );
    }
  }

  return {
    exerciseId: body.exerciseId,
    reason: typeof body.reason === "string" ? body.reason : null,
  };
}

function formNullableNumber(form: FormData, name: string): number | null {
  const value = fieldValue(form.get(name));

  return value.length === 0 ? null : Number(value);
}

function manualEvaluationCommandFromForm(form: FormData) {
  const feedback = fieldValue(form.get("feedback"));

  return {
    feedback: feedback.length === 0 ? null : feedback,
    maxScore: Number(fieldValue(form.get("maxScore"))),
    score: Number(fieldValue(form.get("score"))),
  };
}

function latePolicyCommandFromForm(form: FormData) {
  return latePolicyCommandFromJson({
    graceMinutes: formNullableNumber(form, "graceMinutes"),
    kind: fieldValue(form.get("kind")),
    maxPercentPenalty: formNullableNumber(form, "maxPercentPenalty"),
    percentPenalty: formNullableNumber(form, "percentPenalty"),
  });
}

function overrideCommandFromForm(form: FormData) {
  return overrideCommandFromJson({
    availableFrom: formTimestamp(form, "availableFrom"),
    availableUntil: formTimestamp(form, "availableUntil"),
    dueAt: formTimestamp(form, "dueAt"),
    maxAttempts: formNullableNumber(form, "maxAttempts"),
    timeLimitMinutes: formNullableNumber(form, "timeLimitMinutes"),
    userId: fieldValue(form.get("userId")),
  });
}

function manualEvaluationCommandFromJson(body: ManualEvaluationBody) {
  if (typeof body.score !== "number") {
    throw badRequest("invalid_score", "Score must be a number.");
  }

  if (typeof body.maxScore !== "number") {
    throw badRequest("invalid_max_score", "Max score must be a number.");
  }

  const feedback = body.feedback ?? null;

  try {
    assertJsonValue(feedback);
  } catch (_error) {
    throw badRequest("invalid_feedback", "Feedback must be JSON.");
  }

  return { feedback, maxScore: body.maxScore, score: body.score };
}

function nullableString(value: unknown, code: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw badRequest(code, "Field must be a string.");
  }

  return value;
}

function nullableNumber(value: unknown, code: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "number") {
    throw badRequest(code, "Field must be a number.");
  }

  return value;
}

function latePolicyCommandFromJson(body: LatePolicyBody) {
  if (typeof body.kind !== "string") {
    throw badRequest(
      "invalid_late_policy_kind",
      "Late policy kind must be a string.",
    );
  }

  return {
    graceMinutes: nullableNumber(
      body.graceMinutes,
      "invalid_late_policy_grace",
    ),
    kind: body.kind as "none",
    maxPercentPenalty: nullableNumber(
      body.maxPercentPenalty,
      "invalid_late_policy_max_percent",
    ),
    percentPenalty: nullableNumber(
      body.percentPenalty,
      "invalid_late_policy_percent",
    ),
  };
}

function overrideCommandFromJson(body: AssignmentOverrideBody) {
  if (typeof body.userId !== "string") {
    throw badRequest("invalid_user_id", "User ID must be a string.");
  }

  return {
    availableFrom: nullableString(
      body.availableFrom,
      "invalid_override_available_from",
    ),
    availableUntil: nullableString(
      body.availableUntil,
      "invalid_override_available_until",
    ),
    dueAt: nullableString(body.dueAt, "invalid_override_due_at"),
    maxAttempts: nullableNumber(
      body.maxAttempts,
      "invalid_override_max_attempts",
    ),
    timeLimitMinutes: nullableNumber(
      body.timeLimitMinutes,
      "invalid_override_time_limit",
    ),
    userId: body.userId,
  };
}

async function createManualEvaluation(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const formSubmission = isFormSubmission(context);
  const command = formSubmission
    ? manualEvaluationCommandFromForm(await context.req.raw.formData())
    : manualEvaluationCommandFromJson(
        (await readJsonObject(context)) as ManualEvaluationBody,
      );
  const result = await manualGradingService(context).evaluateSubmission(
    actor,
    courseId,
    assignmentId,
    requiredParam(context, "submissionId"),
    command,
  );

  kickGradePassback(context);

  if (formSubmission) {
    return redirect(
      `/courses/${courseId}/instructor/assignments/${assignmentId}` +
        "/submissions?manualEvaluation=1",
    );
  }

  return context.json(
    {
      evaluation: publicEvaluation(viewerEvaluation(result.evaluation)),
      submission: publicSubmission(result.submission),
    },
    201,
  );
}

async function approveSubmission(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const result = await manualGradingService(context).approveAutomaticScore(
    actor,
    courseId,
    assignmentId,
    requiredParam(context, "submissionId"),
  );

  kickGradePassback(context);

  if (isFormSubmission(context)) {
    return redirect(
      `/courses/${courseId}/instructor/assignments/${assignmentId}` +
        "/submissions?approved=1",
    );
  }

  return context.json(
    {
      evaluation: publicEvaluation(viewerEvaluation(result.evaluation)),
      submission: publicSubmission(result.submission),
    },
    201,
  );
}

async function upsertLatePolicy(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const formSubmission = isFormSubmission(context);
  const command = formSubmission
    ? latePolicyCommandFromForm(await context.req.raw.formData())
    : latePolicyCommandFromJson(
        (await readJsonObject(context)) as LatePolicyBody,
      );
  const policy = await assignmentService(context).upsertLatePolicy(
    actor,
    courseId,
    assignmentId,
    command,
  );

  await refreshScoresAfterInstructorChange(context, assignmentId);

  if (formSubmission) {
    return redirect(
      `/courses/${courseId}/instructor/assignments/${assignmentId}` +
        "?latePolicy=1",
    );
  }

  return context.json({ latePolicy: publicLatePolicy(policy) });
}

/**
 * Instructor actions that change what a score *evaluates to* (excuses,
 * overrides, repoints, attempt resets) recompute the stored rows right away,
 * so the change reaches any linked LMS gradebook now — not whenever someone
 * next opens an Carnap gradebook view. `userId` narrows the recompute where
 * the action touched one student. Scoped to graded assignments: they are the
 * only ones with passback, and other modes keep their lazy refresh.
 */
async function refreshScoresAfterInstructorChange(
  context: Context<AppBindings>,
  assignmentId: string,
  userId?: string,
): Promise<void> {
  const stores = storesForContext(context);
  const assignment = await stores.assignments.getById(assignmentId);

  if (assignment === null || assignment.assessmentMode !== "graded") {
    return;
  }

  const gradebook = new GradebookService({ stores });

  if (userId === undefined) {
    const scores = await stores.scores.listAssignmentScores(assignment.id);

    await Promise.all(
      scores.map((score) =>
        gradebook.refreshStudentAssignmentScore(assignment, score.userId),
      ),
    );
  } else {
    await gradebook.refreshStudentAssignmentScore(assignment, userId);
  }

  kickGradePassback(context);
}

async function upsertAssignmentOverride(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const formSubmission = isFormSubmission(context);
  const command = formSubmission
    ? overrideCommandFromForm(await context.req.raw.formData())
    : overrideCommandFromJson(
        (await readJsonObject(context)) as AssignmentOverrideBody,
      );
  const override = await assignmentService(context).upsertOverride(
    actor,
    courseId,
    assignmentId,
    command,
  );

  await refreshScoresAfterInstructorChange(
    context,
    assignmentId,
    override.userId,
  );

  if (formSubmission) {
    return redirect(
      `/courses/${courseId}/instructor/assignments/${assignmentId}` +
        "?override=1",
    );
  }

  return context.json({ override: publicOverride(override) });
}

async function setGradeVisibility(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const formSubmission = isFormSubmission(context);
  const release = formSubmission
    ? fieldValue((await context.req.raw.formData()).get("intent")) ===
      "release"
    : ((await readJsonObject(context)) as { readonly release?: unknown })
        .release === true;
  const detail = await assignmentService(context).setGradeVisibility(
    actor,
    courseId,
    assignmentId,
    release,
  );

  // Deliveries deferred while grades were withheld are parked on the old
  // release date; re-anchor them to now so the delivery re-reads the new
  // one (an unreleased assignment just re-defers).
  await storesForContext(context).lti.rescheduleGradeJobsForAssignment(
    assignmentId,
    timestampNow(new Date()),
  );
  kickGradePassback(context);

  if (formSubmission) {
    return redirect(
      `/courses/${courseId}/instructor/assignments/${assignmentId}` +
        (release ? "?gradesReleased=1" : "?gradesHidden=1"),
    );
  }

  return context.json(assignmentDetailJson(detail, context.get("i18n")));
}

async function repointPublishedAssignment(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const formSubmission = isFormSubmission(context);
  const command = formSubmission
    ? repointCommandFromForm(await context.req.raw.formData())
    : repointCommandFromJson(
        (await readJsonObject(context)) as RepointAssignmentBody,
      );
  const detail = await assignmentService(context).repointPublishedContent(
    actor,
    courseId,
    assignmentId,
    command,
  );

  await refreshScoresAfterInstructorChange(context, assignmentId);

  if (formSubmission) {
    return redirect(
      `/courses/${courseId}/instructor/assignments/${assignmentId}?repointed=1`,
    );
  }

  return context.json(assignmentDetailJson(detail, context.get("i18n")));
}

async function excuseAssignmentExercise(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const formSubmission = isFormSubmission(context);
  const command = formSubmission
    ? excuseCommandFromForm(await context.req.raw.formData())
    : excuseCommandFromJson(
        (await readJsonObject(context)) as ExcuseExerciseBody,
      );
  const excuse = await assignmentService(context).excuseExercise(
    actor,
    courseId,
    assignmentId,
    command,
  );

  await refreshScoresAfterInstructorChange(context, assignmentId);

  if (formSubmission) {
    return redirect(
      `/courses/${courseId}/instructor/assignments/${assignmentId}?excused=1`,
    );
  }

  return context.json({ exerciseExcuse: publicExerciseExcuse(excuse) }, 201);
}

interface StudentAssignmentView {
  readonly attempts: readonly Attempt[];
  readonly attemptsUsed: number;
  readonly detail: AssignmentDetail;
  readonly policy: EffectiveAssignmentPolicy;
  readonly showWorkView: boolean;
  readonly submissionContext: InlineSubmissionContext | null;
}

/**
 * The shared plumbing behind the student assignment page and its content
 * document: content withholding (via `getForStudent`), the ensured open
 * attempt for practice/reading modes, and the submission context that makes
 * exercises live. Both routes must run all of it — a document fetched without
 * the ensured attempt would render practice exercises read-only.
 */
async function loadStudentAssignmentView(
  context: Context<AppBindings>,
  actor: AuthenticatedActor,
  courseId: string,
  assignmentId: string,
): Promise<StudentAssignmentView> {
  const detail = await assignmentService(context).getForStudent(
    actor,
    courseId,
    assignmentId,
  );
  // Graded assignments use the explicit begin-attempt flow; a practice
  // assignment is interactive inline, so ensure its single open attempt exists
  // (when the assignment is available) to render live exercises. A reading
  // assesses nothing and so collects nothing: it falls through with no attempt,
  // which renders its exercises the way a preview does — fully interactive,
  // self-checking, with nothing to submit to.
  const practiceAttempt =
    detail.assignment.assessmentMode === "practice"
      ? await attemptService(context).ensureOpenAttempt(
          actor,
          courseId,
          assignmentId,
        )
      : null;
  const attempts =
    detail.assignment.assessmentMode === "graded"
      ? await attemptService(context).listForStudent(
          actor,
          courseId,
          assignmentId,
        )
      : practiceAttempt === null
        ? []
        : [practiceAttempt];
  const activeAttempt = activeAttemptFor(attempts);
  const showWorkView = activeAttempt !== null;
  // `detail.assignment` is already this student's own (getForStudent applies
  // their override and accommodation), so the policy computed from it is the
  // one the begin-attempt route will enforce — which is what lets the briefing
  // stop offering a button that would be refused.
  const now = timestampNow(new Date());
  const activity = attemptActivity(attempts, now);
  const policy = effectiveAssignmentPolicy(detail.assignment, attempts, now);
  const runtimeState =
    activeAttempt === null
      ? {}
      : latestExerciseRuntimeState(
          await submissionService(context).listForStudentAttempt(
            actor,
            courseId,
            assignmentId,
            activeAttempt.id,
            context.get("i18n"),
          ),
        );
  const submissionContext =
    activeAttempt === null
      ? null
      : {
          assignmentId,
          attemptId: activeAttempt.id,
          contentRevisionId: detail.contentRevision.id,
          context,
          courseId,
          // Resolved here rather than in the view: how much a widget may tell
          // this student is a policy question about *this* assignment, and the
          // content nodes the view walks carry no `exam` or `feedback` — those
          // live in the manifest beside them.
          feedbackByExercise: new Map(
            detail.artifact.manifest.map((item) => [
              item.id,
              resolveExerciseFeedback(item, detail.assignment, now),
            ]),
          ),
          runtimeState,
        };

  return {
    attempts,
    attemptsUsed: activity.attemptsUsed,
    detail,
    policy,
    showWorkView,
    submissionContext,
  };
}

async function studentDetailPage(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const url = new URL(context.req.url);
  const view = await loadStudentAssignmentView(
    context,
    actor,
    courseId,
    assignmentId,
  );

  return renderStudentAssignmentPage(context, {
    assignmentId,
    attempts: view.attempts,
    attemptsUsed: view.attemptsUsed,
    courseId,
    courseTitle: await courseTitleFor(context, courseId),
    detail: view.detail,
    notRecorded: url.searchParams.has("notRecorded"),
    policy: view.policy,
    showWorkView: view.showWorkView,
    started: !view.showWorkView && url.searchParams.has("attemptStarted"),
    submissionContext: view.submissionContext,
    submitted: !view.showWorkView && url.searchParams.has("submitted"),
  });
}

/** Where a graded assignment sends a reader who has no attempt open yet. */
function attemptGatePath(courseId: string, assignmentId: string): string {
  return `/courses/${courseId}/assignments/${assignmentId}/start`;
}

function studentContentPath(courseId: string, assignmentId: string): string {
  return `/courses/${courseId}/assignments/${assignmentId}/content`;
}

/**
 * The attempt gate. A graded assignment has nothing to show until an attempt
 * is open, so this is where an LTI launch lands and what the content view
 * bounces to; starting from here comes back to the content view.
 *
 * Every other case falls through to the content: an ungraded assignment is
 * interactive on sight, and a graded one with an attempt already open has been
 * through this page already.
 */
async function attemptGatePage(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const view = await loadStudentAssignmentView(
    context,
    actor,
    courseId,
    assignmentId,
  );

  if (
    view.detail.assignment.assessmentMode !== "graded" ||
    view.showWorkView
  ) {
    return redirect(studentContentPath(courseId, assignmentId), 302);
  }

  return renderAttemptGatePage(context, {
    assignmentId,
    attempts: view.attempts,
    attemptsUsed: view.attemptsUsed,
    courseId,
    detail: view.detail,
    policy: view.policy,
  });
}

/**
 * Start an attempt from the gate. The same operation the assignment page's
 * button performs, landing somewhere else: back to the chrome-free content
 * view the reader came from, rather than to the full page, which inside an
 * LMS frame would put our navbar under theirs at the moment they commit.
 */
async function beginAttemptFromGate(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");

  await attemptService(context).begin(actor, courseId, assignmentId);

  return redirect(studentContentPath(courseId, assignmentId));
}

/**
 * The student's content document: the iframe body behind the assignment
 * page's content card, and — for a launch from an LMS — the landing page
 * itself. An expired session renders the login page inside the frame
 * (accepted; the parent page redirects on its own next load).
 */
async function studentContentDocument(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const view = await loadStudentAssignmentView(
    context,
    actor,
    courseId,
    assignmentId,
  );

  // Graded content is withheld until an attempt is open, so what there is to
  // render here is an empty document. That is the right artifact and the wrong
  // page: send the reader to the gate that starts the attempt instead. The
  // assignment page never reaches this — it hides the frame in the same state —
  // so the reader who does is either launching from an LMS or holding the URL.
  if (
    view.detail.assignment.assessmentMode === "graded" &&
    !view.showWorkView
  ) {
    return redirect(attemptGatePath(courseId, assignmentId), 302);
  }

  return renderAssignmentContentDocument(context, {
    detail: view.detail,
    submission: view.submissionContext,
  });
}

async function instructorContentDocument(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const detail = await assignmentService(context).getForInstructor(
    actor,
    requiredParam(context, "courseId"),
    requiredParam(context, "assignmentId"),
  );

  return renderAssignmentContentDocument(context, {
    detail,
    submission: null,
  });
}

/**
 * The target of a compiled `item:` link: resolve a content item to the
 * assignment publishing it in this course and redirect there, instructors to
 * the instructor page and everyone else to the student page. Registered at
 * both `go` depths so the relative `../../go/<id>` in compiled content
 * resolves here from the student and instructor content documents alike. An
 * unresolvable item renders a friendly page instead of the JSON envelope —
 * this is always a browser navigation.
 */
/**
 * Was this link followed from a content document standing on its own — a
 * fullscreen tab, or a lesson framed by an LMS — rather than from one sitting
 * in a card on an assignment page?
 *
 * It decides which view of the next item to hand back, and the referrer is
 * what knows: our own frames mark their document's URL (see
 * `APP_FRAME_PARAM`), and from one of those the link is following `_top` out
 * to a page with chrome, which is where the reader already was. A standalone
 * document has no page around it to return to, so the answer there is the next
 * document.
 *
 * Same-origin navigations carry the full URL under our `Referrer-Policy`. When
 * one does not — a privacy extension, an odd proxy — the answer is the page,
 * which is where every one of these went before.
 */
function fromStandaloneContentDocument(
  context: Context<AppBindings>,
): boolean {
  const referrer = context.req.header("Referer");

  if (referrer === undefined) {
    return false;
  }

  try {
    const url = new URL(referrer);

    return (
      url.pathname.endsWith("/content") &&
      !url.searchParams.has(APP_FRAME_PARAM)
    );
  } catch {
    // A malformed Referer is no answer at all, and the fallback is the same.
    return false;
  }
}

async function contentItemRedirect(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");

  try {
    const resolved = await assignmentService(context).resolveContentItem(
      actor,
      courseId,
      requiredParam(context, "itemId"),
    );
    const base =
      resolved.role === "instructor" || resolved.role === "co_instructor"
        ? `/courses/${courseId}/instructor/assignments`
        : `/courses/${courseId}/assignments`;
    const suffix = fromStandaloneContentDocument(context) ? "/content" : "";

    return redirect(`${base}/${resolved.assignment.id}${suffix}`, 302);
  } catch (error) {
    if (error instanceof AppHttpError && error.status === 404) {
      const i18n = context.get("i18n");

      return renderFormError(context, {
        breadcrumb: [coursesCrumb(i18n)],
        message: error.localize(i18n),
        status: 404,
        title: i18n.t("Content not available"),
      });
    }

    throw error;
  }
}

/**
 * The flash notices this page can show, keyed by the query parameter that asks
 * for one — a redirect names a *reason*, so no sentence travels in a URL. A
 * function rather than a table because a reason is only a sentence once a
 * language is known.
 */
function instructorNotices(
  i18n: Translator,
): readonly { readonly message: string; readonly param: string }[] {
  return [
    { message: i18n.t("Draft assignment created."), param: "created" },
    { message: i18n.t("Assignment published."), param: "published" },
    { message: i18n.t("Assignment updated."), param: "updated" },
    {
      message: i18n.t("Assignment content correction published."),
      param: "repointed",
    },
    { message: i18n.t("Exercise excused."), param: "excused" },
    { message: i18n.t("Late policy saved."), param: "latePolicy" },
    { message: i18n.t("Assignment override saved."), param: "override" },
    {
      message: i18n.t("Grades released to students."),
      param: "gradesReleased",
    },
    {
      message: i18n.t("Grades hidden from students."),
      param: "gradesHidden",
    },
    { message: i18n.t("Assignment unpublished."), param: "unpublished" },
  ];
}

async function instructorDetailPage(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const url = new URL(context.req.url);
  const courseId = requiredParam(context, "courseId");
  // "describe": this is the page carrying the control that repoints the
  // assignment at another revision, so it is the one page that must render
  // even when the revision it is pointed at cannot be read.
  const detail = await assignmentService(context).getForInstructor(
    actor,
    courseId,
    requiredParam(context, "assignmentId"),
    "describe",
  );
  const revisions =
    detail.assignment.state === "published"
      ? await authorRevisionOptions(context)
      : [];

  // Overrides target a single enrolled student, so surface the course roster
  // as a picker instead of asking the instructor to paste a raw user ID.
  const courseDetail = await courseService(context).getCourseDetail(
    actor,
    courseId,
  );
  const students = courseDetail.memberships.filter(
    (membership) => membership.role === "student",
  );
  const directory = await resolveUsers(
    context,
    students.map((membership) => membership.userId),
  );

  // Load each student's existing override so the roster can flag it and the
  // modal can open pre-filled with the current values.
  const assignments = storesForContext(context).assignments;
  const overrideList = await Promise.all(
    students.map((membership) =>
      assignments.getOverrideForAssignmentUser(
        detail.assignment.id,
        membership.userId,
      ),
    ),
  );
  const overrides = new Map(
    overrideList
      .filter((override): override is AssignmentOverride => override !== null)
      .map((override) => [override.userId, override] as const),
  );
  // The late policy form replaces the whole policy on save, so it has to open
  // showing the one in force: without this an instructor changing the grace
  // period would post the form's own defaults over the penalty they set
  // earlier, and the sheet would claim there was no late penalty when there
  // was one.
  const latePolicy = await assignments.getLatePolicy(detail.assignment.id);

  return renderInstructorAssignmentPage(context, {
    courseId,
    courseTitle: await courseTitleFor(context, courseId),
    detail,
    directory,
    latePolicy,
    notices: instructorNotices(context.get("i18n"))
      .filter((entry) => url.searchParams.has(entry.param))
      .map((entry) => entry.message),
    overrides,
    revisions,
    students,
  });
}

async function listStudentSubmissions(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const entries = await submissionService(context).listForStudentAttempt(
    actor,
    requiredParam(context, "courseId"),
    requiredParam(context, "assignmentId"),
    requiredParam(context, "attemptId"),
    context.get("i18n"),
  );

  return context.json({
    submissions: entries.map((entry) => ({
      answerReview: entry.answerReview,
      attemptId: entry.attemptId,
      evaluation:
        entry.evaluation === null ? null : publicEvaluation(entry.evaluation),
      submission: publicSubmission(entry.submission),
    })),
  });
}

async function instructorSubmissionReviewEntries(
  context: Context<AppBindings>,
  entries: readonly SubmissionHistoryEntry[],
): Promise<InstructorSubmissionReviewEntry[]> {
  const directory = await resolveUsers(
    context,
    entries.map((entry) => entry.submission.userId),
  );

  return entries.map((entry) => ({
    ...entry,
    user: directory.get(entry.submission.userId) ?? null,
  }));
}

async function listInstructorSubmissions(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (wantsHtml(context) && loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const entries = await submissionService(
    context,
  ).listForInstructorAssignment(
    actor,
    courseId,
    assignmentId,
    context.get("i18n"),
  );

  if (wantsHtml(context)) {
    const url = new URL(context.req.url);

    return renderInstructorSubmissions(context, {
      approved: url.searchParams.has("approved"),
      assignmentId,
      assignmentTitle: await assignmentTitleFor(context, assignmentId),
      courseId,
      courseTitle: await courseTitleFor(context, courseId),
      entries: await instructorSubmissionReviewEntries(context, entries),
      filter:
        url.searchParams.get("review") === "all" ? "all" : "needs-review",
      manualEvaluation: url.searchParams.has("manualEvaluation"),
    });
  }

  return context.json({
    submissions: entries.map((entry) => ({
      answerReview: entry.answerReview,
      attemptId: entry.attemptId,
      evaluation:
        entry.evaluation === null ? null : publicEvaluation(entry.evaluation),
      needsReview: submissionNeedsReview(entry.evaluation),
      submission: publicSubmission(entry.submission),
    })),
  });
}

async function listStudentAttempts(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const attempts = await attemptService(context).listForStudent(
    actor,
    requiredParam(context, "courseId"),
    requiredParam(context, "assignmentId"),
  );

  return context.json({ attempts: attempts.map(publicAttempt) });
}

async function listInstructorAttempts(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (wantsHtml(context) && loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const attempts = await attemptService(context).listForInstructor(
    actor,
    courseId,
    assignmentId,
  );

  if (wantsHtml(context)) {
    const url = new URL(context.req.url);

    return renderInstructorAttempts(context, {
      assignmentId,
      assignmentTitle: await assignmentTitleFor(context, assignmentId),
      attemptReset: url.searchParams.has("attemptReset"),
      attempts,
      courseId,
      courseTitle: await courseTitleFor(context, courseId),
      directory: await resolveUsers(
        context,
        attempts.map((attempt) => attempt.userId),
      ),
    });
  }

  return context.json({ attempts: attempts.map(publicAttempt) });
}

async function resetAttempt(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const result = await attemptService(context).reset(
    actor,
    courseId,
    assignmentId,
    requiredParam(context, "attemptId"),
  );

  await refreshScoresAfterInstructorChange(
    context,
    assignmentId,
    result.newAttempt.userId,
  );

  if (isFormSubmission(context)) {
    return redirect(
      `/courses/${courseId}/instructor/assignments/${assignmentId}` +
        "/attempts?attemptReset=1",
    );
  }

  return context.json({
    newAttempt: publicAttempt(result.newAttempt),
    voidedAttempt: publicAttempt(result.voidedAttempt),
  });
}

async function publishAssignmentFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const published = await assignmentService(context).publish(
    actor,
    courseId,
    requiredParam(context, "assignmentId"),
  );

  return redirect(
    `/courses/${courseId}/instructor/assignments/${published.assignment.id}?published=1`,
  );
}

async function unpublishAssignmentFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const unpublished = await assignmentService(context).unpublish(
    actor,
    courseId,
    requiredParam(context, "assignmentId"),
  );

  return redirect(
    `/courses/${courseId}/instructor/assignments/${unpublished.assignment.id}?unpublished=1`,
  );
}

async function deleteDraftAssignmentFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  await assignmentService(context).deleteDraft(
    actor,
    courseId,
    requiredParam(context, "assignmentId"),
  );

  // The assignment is gone, so land back on the course page's assignment list
  // rather than its now-dead detail route.
  return redirect(`/courses/${courseId}?assignmentDeleted=1`);
}

function publishedSettingsCommandFromJson(body: PublishedSettingsBody) {
  if (typeof body.title !== "string") {
    throw badRequest(
      "invalid_assignment_title",
      "Assignment title must be a string.",
    );
  }

  return {
    ...(body.listed === undefined ? {} : { listed: body.listed === true }),
    availableFrom: nullableString(
      body.availableFrom,
      "invalid_assignment_available_from",
    ),
    availableUntil: nullableString(
      body.availableUntil,
      "invalid_assignment_available_until",
    ),
    description: nullableString(
      body.description,
      "invalid_assignment_description",
    ),
    displayOrder: nullableNumber(
      body.displayOrder,
      "invalid_assignment_display_order",
    ),
    dueAt: nullableString(body.dueAt, "invalid_assignment_due_at"),
    maxAttempts: nullableNumber(
      body.maxAttempts,
      "invalid_assignment_max_attempts",
    ),
    timeLimitMinutes: nullableNumber(
      body.timeLimitMinutes,
      "invalid_assignment_time_limit",
    ),
    title: body.title,
  };
}

function commandFromJson(body: CreateAssignmentBody) {
  if (typeof body.title !== "string") {
    throw badRequest(
      "invalid_assignment_title",
      "Assignment title must be a string.",
    );
  }

  if (typeof body.contentRevisionId !== "string") {
    throw badRequest(
      "invalid_content_revision",
      "Content revision ID must be a string.",
    );
  }

  for (const field of [
    "description",
    "availableFrom",
    "assessmentMode",
    "dueAt",
    "gradesVisibleAt",
    "gradesVisibility",
  ] as const) {
    const value = body[field];

    if (value !== undefined && value !== null && typeof value !== "string") {
      throw badRequest(
        `invalid_assignment_${field}`,
        "Assignment field must be a string.",
      );
    }
  }

  if (
    body.availableUntil !== undefined &&
    body.availableUntil !== null &&
    typeof body.availableUntil !== "string"
  ) {
    throw badRequest(
      "invalid_assignment_available_until",
      "Assignment field must be a string.",
    );
  }

  for (const field of ["listed"] as const) {
    const value = body[field];

    if (value !== undefined && value !== null && typeof value !== "boolean") {
      throw badRequest(
        `invalid_assignment_${field}`,
        "Assignment boolean fields must be booleans.",
      );
    }
  }

  for (const field of [
    "displayOrder",
    "maxAttempts",
    "timeLimitMinutes",
  ] as const) {
    const value = body[field];

    if (value !== undefined && value !== null && typeof value !== "number") {
      throw badRequest(
        `invalid_assignment_${field}`,
        "Assignment policy fields must be numbers.",
      );
    }
  }

  return {
    assessmentMode:
      typeof body.assessmentMode === "string"
        ? (body.assessmentMode as Assignment["assessmentMode"])
        : null,
    availableFrom:
      typeof body.availableFrom === "string" ? body.availableFrom : null,
    availableUntil:
      typeof body.availableUntil === "string" ? body.availableUntil : null,
    contentRevisionId: body.contentRevisionId,
    description:
      typeof body.description === "string" ? body.description : null,
    displayOrder:
      typeof body.displayOrder === "number" ? body.displayOrder : null,
    dueAt: typeof body.dueAt === "string" ? body.dueAt : null,
    gradesVisibleAt:
      typeof body.gradesVisibleAt === "string" ? body.gradesVisibleAt : null,
    gradesVisibility:
      typeof body.gradesVisibility === "string"
        ? body.gradesVisibility
        : null,
    listed: typeof body.listed === "boolean" ? body.listed : null,
    maxAttempts:
      typeof body.maxAttempts === "number" ? body.maxAttempts : null,
    timeLimitMinutes:
      typeof body.timeLimitMinutes === "number"
        ? body.timeLimitMinutes
        : null,
    title: body.title,
  };
}

function envelopeFromJson(body: Record<string, unknown>): {
  readonly answer: AnswerEnvelope;
  readonly exerciseId: string;
  readonly idempotencyKey: string | null;
} {
  if (typeof body.exerciseId !== "string") {
    throw badRequest("invalid_exercise_id", "Exercise ID must be a string.");
  }

  if (
    typeof body.answer !== "object" ||
    body.answer === null ||
    Array.isArray(body.answer)
  ) {
    throw badRequest("invalid_answer", "Answer must be an object.");
  }

  const answer = body.answer as Record<string, unknown>;

  if (typeof answer.kind !== "string") {
    throw badRequest("invalid_answer_kind", "Answer kind must be a string.");
  }

  if (typeof answer.schemaVersion !== "number") {
    throw badRequest(
      "invalid_answer_schema_version",
      "Answer schema version must be a number.",
    );
  }

  try {
    assertJsonValue(answer.data);
  } catch (_error) {
    throw badRequest(
      "invalid_answer_data",
      "Answer data must be JSON-serializable.",
    );
  }

  return {
    answer: {
      data: answer.data,
      kind: answer.kind,
      schemaVersion: answer.schemaVersion,
    },
    exerciseId: body.exerciseId,
    idempotencyKey:
      typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
  };
}

function idempotencyKeyFromHeaders(
  context: Context<AppBindings>,
): string | null {
  return context.req.header("Idempotency-Key") ?? null;
}

async function beginAttempt(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const result = await attemptService(context).begin(
    actor,
    courseId,
    assignmentId,
  );

  if (isFormSubmission(context)) {
    return redirect(
      `/courses/${courseId}/assignments/${assignmentId}?attemptStarted=1`,
    );
  }

  return context.json(
    {
      attempt: publicAttempt(result.attempt),
      policy: result.policy,
    },
    201,
  );
}

async function submitAnswer(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const attemptId = requiredParam(context, "attemptId");
  // Answers are submitted exclusively as JSON by the exercise runtime, which
  // always intercepts the form's native submit. Carnap requires JavaScript for
  // exercises (see design/component-system-v2.md D1/D2), so there is no no-JS
  // form-encoded path to accept here.
  const command = envelopeFromJson(await readJsonObject(context));
  const result = await submissionService(context).submit(
    actor,
    courseId,
    assignmentId,
    attemptId,
    {
      ...command,
      idempotencyKey:
        command.idempotencyKey ?? idempotencyKeyFromHeaders(context),
    },
  );

  if (result.recorded) {
    kickGradePassback(context);
  }

  if (!result.recorded) {
    return context.json(
      { check: result.check, policy: result.policy, recorded: false },
      200,
    );
  }

  return context.json(
    {
      evaluation:
        result.evaluation === null
          ? null
          : publicEvaluation(result.evaluation),
      idempotent: result.idempotent,
      policy: result.policy,
      recorded: true,
      submission: publicSubmission(result.submission),
    },
    result.idempotent ? 200 : 201,
  );
}

export const assignmentRoutes = new Hono<AppBindings>();

assignmentRoutes.get("/:courseId/instructor/assignments/new", (context) => {
  return newAssignmentPage(context);
});

assignmentRoutes.get(
  "/:courseId/instructor/assignments/:assignmentId/attempts",
  (context) => listInstructorAttempts(context),
);

assignmentRoutes.get(
  "/:courseId/instructor/assignments/:assignmentId/content",
  (context) => instructorContentDocument(context),
);

/**
 * Wrap a form-capable handler so a rejected browser submission renders an HTML
 * error page instead of leaking the JSON error envelope. JSON API callers
 * re-throw to the global JSON error handler.
 *
 * `title` is a function of the translator rather than a string because these
 * wrappers are applied when the routes are *registered* — once per isolate,
 * with no request and so no reader's language in sight. Resolving it inside the
 * handler is what keeps the heading in the same language as the error beneath
 * it.
 */
function withFormErrorPage(
  handler: (context: Context<AppBindings>) => Promise<Response>,
  title: (i18n: Translator) => string,
  options: { readonly chromeless?: boolean } = {},
): (context: Context<AppBindings>) => Promise<Response> {
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      if (error instanceof AppHttpError && isFormSubmission(context)) {
        const i18n = context.get("i18n");

        return renderFormError(context, {
          // A chrome-free page's error page has to be chrome-free too, and a
          // breadcrumb up to the course list is exactly the navigation it is
          // chrome-free in order not to offer.
          ...(options.chromeless === true
            ? { chromeless: true }
            : { breadcrumb: [coursesCrumb(i18n)] }),
          message: error.localize(i18n),
          status: error.status,
          title: title(i18n),
        });
      }

      throw error;
    }
  };
}

assignmentRoutes.post(
  "/:courseId/instructor/assignments/:assignmentId/late-policy",
  withFormErrorPage(upsertLatePolicy, (i18n) =>
    i18n.t("Late policy not saved"),
  ),
);

assignmentRoutes.post(
  "/:courseId/instructor/assignments/:assignmentId/overrides",
  withFormErrorPage(upsertAssignmentOverride, (i18n) =>
    i18n.t("Override not saved"),
  ),
);

assignmentRoutes.post(
  "/:courseId/instructor/assignments/:assignmentId/grade-visibility",
  withFormErrorPage(setGradeVisibility, (i18n) =>
    i18n.t("Grades not updated"),
  ),
);

assignmentRoutes.post(
  "/:courseId/instructor/assignments/:assignmentId/submissions/:submissionId/evaluations",
  withFormErrorPage(createManualEvaluation, (i18n) =>
    i18n.t("Evaluation not saved"),
  ),
);

assignmentRoutes.post(
  "/:courseId/instructor/assignments/:assignmentId/submissions/:submissionId/approve",
  withFormErrorPage(approveSubmission, (i18n) =>
    i18n.t("Submission not approved"),
  ),
);

assignmentRoutes.get(
  "/:courseId/instructor/assignments/:assignmentId/submissions",
  (context) => listInstructorSubmissions(context),
);

assignmentRoutes.post(
  "/:courseId/instructor/assignments/:assignmentId/attempts/:attemptId/reset",
  withFormErrorPage(resetAttempt, (i18n) => i18n.t("Attempt not reset")),
);

assignmentRoutes.get(
  "/:courseId/instructor/assignments/:assignmentId/edit",
  (context) => editAssignmentPage(context),
);

assignmentRoutes.post(
  "/:courseId/instructor/assignments/:assignmentId",
  (context) => updateAssignment(context),
);

assignmentRoutes.post(
  "/:courseId/instructor/assignments/:assignmentId/settings",
  (context) => updatePublishedSettings(context),
);

assignmentRoutes.post(
  "/:courseId/instructor/assignments/:assignmentId/content-revision",
  withFormErrorPage(repointPublishedAssignment, (i18n) =>
    i18n.t("Assignment not updated"),
  ),
);

assignmentRoutes.post(
  "/:courseId/instructor/assignments/:assignmentId/excuses",
  withFormErrorPage(excuseAssignmentExercise, (i18n) =>
    i18n.t("Excuse not saved"),
  ),
);

assignmentRoutes.get(
  "/:courseId/instructor/assignments/:assignmentId",
  async (context) => {
    if (wantsHtml(context)) {
      return instructorDetailPage(context);
    }

    const actor = requireAuthenticated(context);
    const detail = await assignmentService(context).getForInstructor(
      actor,
      requiredParam(context, "courseId"),
      requiredParam(context, "assignmentId"),
    );

    return context.json(assignmentDetailJson(detail, context.get("i18n")));
  },
);

assignmentRoutes.post(
  "/:courseId/instructor/assignments/:assignmentId/publish",
  withFormErrorPage(
    async (context) => {
      if (isFormSubmission(context)) {
        return publishAssignmentFromForm(context);
      }

      const actor = requireAuthenticated(context);
      const detail = await assignmentService(context).publish(
        actor,
        requiredParam(context, "courseId"),
        requiredParam(context, "assignmentId"),
      );

      return context.json(assignmentDetailJson(detail, context.get("i18n")));
    },
    (i18n) => i18n.t("Assignment not published"),
  ),
);

assignmentRoutes.post(
  "/:courseId/instructor/assignments/:assignmentId/unpublish",
  withFormErrorPage(
    async (context) => {
      if (isFormSubmission(context)) {
        return unpublishAssignmentFromForm(context);
      }

      const actor = requireAuthenticated(context);
      const detail = await assignmentService(context).unpublish(
        actor,
        requiredParam(context, "courseId"),
        requiredParam(context, "assignmentId"),
      );

      return context.json(assignmentDetailJson(detail, context.get("i18n")));
    },
    (i18n) => i18n.t("Assignment not unpublished"),
  ),
);

assignmentRoutes.post(
  "/:courseId/instructor/assignments/:assignmentId/delete",
  withFormErrorPage(
    async (context) => {
      if (isFormSubmission(context)) {
        return deleteDraftAssignmentFromForm(context);
      }

      const actor = requireAuthenticated(context);
      await assignmentService(context).deleteDraft(
        actor,
        requiredParam(context, "courseId"),
        requiredParam(context, "assignmentId"),
      );

      return context.json({ deleted: true });
    },
    (i18n) => i18n.t("Assignment not deleted"),
  ),
);

assignmentRoutes.get("/:courseId/items", async (context) => {
  const actor = requireAuthenticated(context);
  const assignments = await assignmentService(context).listForStudent(
    actor,
    requiredParam(context, "courseId"),
  );

  return context.json({ items: assignments.map(publicAssignment) });
});

assignmentRoutes.post("/:courseId/items", async (context) => {
  if (isFormSubmission(context)) {
    return createAssignmentFromForm(context);
  }

  const actor = requireAuthenticated(context);
  const body = (await readJsonObject(context)) as CreateAssignmentBody;
  const detail = await assignmentService(context).createDraft(
    actor,
    requiredParam(context, "courseId"),
    commandFromJson(body),
  );

  return context.json(assignmentDetailJson(detail, context.get("i18n")), 201);
});

assignmentRoutes.get("/:courseId/items/:assignmentId", async (context) => {
  if (wantsHtml(context)) {
    return studentDetailPage(context);
  }

  const actor = requireAuthenticated(context);
  const detail = await assignmentService(context).getForStudent(
    actor,
    requiredParam(context, "courseId"),
    requiredParam(context, "assignmentId"),
  );

  return context.json(assignmentDetailJson(detail, context.get("i18n")));
});

assignmentRoutes.get("/:courseId/assignments", async (context) => {
  const actor = requireAuthenticated(context);
  const assignments = await assignmentService(context).listForStudent(
    actor,
    requiredParam(context, "courseId"),
  );

  return context.json({ assignments: assignments.map(publicAssignment) });
});

assignmentRoutes.post("/:courseId/assignments", async (context) => {
  if (isFormSubmission(context)) {
    return createAssignmentFromForm(context);
  }

  const actor = requireAuthenticated(context);
  const body = (await readJsonObject(context)) as CreateAssignmentBody;
  const detail = await assignmentService(context).createDraft(
    actor,
    requiredParam(context, "courseId"),
    commandFromJson(body),
  );

  return context.json(assignmentDetailJson(detail, context.get("i18n")), 201);
});

assignmentRoutes.get(
  "/:courseId/assignments/:assignmentId/attempts",
  (context) => listStudentAttempts(context),
);

assignmentRoutes.post(
  "/:courseId/assignments/:assignmentId/attempts",
  withFormErrorPage(beginAttempt, (i18n) =>
    i18n.t("Attempt could not start"),
  ),
);

assignmentRoutes.get(
  "/:courseId/assignments/:assignmentId/attempts/:attemptId/submissions",
  (context) => listStudentSubmissions(context),
);

assignmentRoutes.post(
  "/:courseId/assignments/:assignmentId/attempts/:attemptId/submissions",
  withFormErrorPage(submitAnswer, (i18n) =>
    i18n.t("Answer could not be submitted"),
  ),
);

assignmentRoutes.get(
  "/:courseId/assignments/:assignmentId/content",
  (context) => studentContentDocument(context),
);

assignmentRoutes.get(
  "/:courseId/assignments/:assignmentId/start",
  (context) => attemptGatePage(context),
);

assignmentRoutes.post(
  "/:courseId/assignments/:assignmentId/start",
  withFormErrorPage(
    beginAttemptFromGate,
    (i18n) => i18n.t("Attempt could not start"),
    // The gate is framed by an LMS; so is anything it renders in its place.
    { chromeless: true },
  ),
);

// Two registrations, one per content-document depth: `../../go/<id>` lands on
// the first from student documents and on the second from instructor ones.
assignmentRoutes.get("/:courseId/go/:itemId", contentItemRedirect);

assignmentRoutes.get("/:courseId/instructor/go/:itemId", contentItemRedirect);

assignmentRoutes.get(
  "/:courseId/assignments/:assignmentId",
  async (context) => {
    if (wantsHtml(context)) {
      return studentDetailPage(context);
    }

    const actor = requireAuthenticated(context);
    const detail = await assignmentService(context).getForStudent(
      actor,
      requiredParam(context, "courseId"),
      requiredParam(context, "assignmentId"),
    );

    return context.json(assignmentDetailJson(detail, context.get("i18n")));
  },
);

assignmentRoutes.post(
  "/:courseId/assignments/:assignmentId/publish",
  async (context) => {
    const actor = requireAuthenticated(context);
    const detail = await assignmentService(context).publish(
      actor,
      requiredParam(context, "courseId"),
      requiredParam(context, "assignmentId"),
    );

    return context.json(assignmentDetailJson(detail, context.get("i18n")));
  },
);
