import type { Context } from "hono";
import { raw } from "hono/html";
import type { Child, FC } from "hono/jsx";
import type { OutdatedTheory } from "../application/content";
import { createDefaultExerciseRegistry } from "../application/content/registry";
import { jsonScriptContent } from "../application/content/render-support";
import {
  componentAssetsForArtifact,
  exerciseHydrationForArtifact,
  exerciseOutline,
  renderCompiledContent,
} from "../application/content/renderer";
import { renderTheoryPanel } from "../application/content/theory-panel";
import type {
  AttemptActivity,
  EffectiveAssignmentPolicy,
} from "../application/policies";
import type {
  QueueExercise,
  SubmissionHistoryEntry,
} from "../application/submissions";
import type { UserDirectory } from "../application/users";
import {
  type Attempt,
  type EvaluationVerdict,
  type Submission,
  storedPointsDrift,
  type ViewerEvaluation,
} from "../domain/assessment";
import {
  type Assignment,
  type AssignmentContentVersion,
  type AssignmentExerciseExcuse,
  type AssignmentLatePolicy,
  type AssignmentOverride,
  assignmentAvailability,
  gradesReleased,
} from "../domain/assignments";
import type {
  CompiledContentArtifact,
  ContentItem,
  ContentNode,
  ContentRevision,
  ContentRevisionSummary,
  ExerciseAnswerReview,
} from "../domain/content";
import type { CourseMembership, CourseStaffTier } from "../domain/courses";
import type { JsonValue } from "../domain/json";
import type { Timestamp } from "../domain/time";
import type { User } from "../domain/users";
import { exerciseActionsHtml } from "../exercise-kit/actions";
import {
  EXERCISE_HYDRATION_VERSION,
  type ExerciseHydration,
  type ExerciseHydrationOptions,
  exerciseHydrationScript,
} from "../exercise-kit/hydration";
import type {
  ExerciseRenderContext,
  ExerciseType,
} from "../exercise-kit/type";
import type { AppBindings } from "../http";
import { splitAtValue, type Translator, VALUE } from "../i18n/translator";
import {
  courseCrumb,
  coursesCrumb,
  instructorAssignmentCrumb,
  staffAssignmentCrumb,
} from "./breadcrumbs";
import {
  AnswerReview,
  ContentFrame,
  ContentSplit,
  CourseViewSwitch,
  CsrfInput,
  ErrorSummary,
  LinkStrip,
  ModalDialog,
  Notice,
  PointsDriftNote,
  Sheet,
  type SummaryItem,
  SummaryStrip,
  TableScroll,
  Time,
  TimestampInput,
} from "./components";
import {
  artifactDocumentProps,
  renderContentDocument,
} from "./content-document";
import { FilterIcon } from "./icons";
import {
  assessmentModeLabel,
  assessmentModeOptions,
  assignmentStateLabel,
  attemptStatusLabel,
  evaluatorKindLabel,
  gradesVisibilityOptions,
  latePolicyKindOptions,
  reviewStateLabel,
  reviewStateOf,
  type SelectOption,
  workVisibilityLabel,
  workVisibilityOptions,
} from "./labels";
import { type PageStatus, renderShell, useI18n } from "./layout";
import {
  outdatedTheoryText,
  revisionDetailsText,
  revisionOptionLabel,
  revisionOptionTimeAttributes,
} from "./revisions";
import { EXERCISE_SCRIPT_ASSET, REVIEW_SCRIPT_ASSET } from "./script-assets";
import { utcTimestampText } from "./timestamp-formats";
import {
  EXERCISE_UI_STRINGS_ATTRIBUTE,
  exerciseUiStrings,
  REVIEW_UI_STRINGS_ATTRIBUTE,
  reviewUiStrings,
  uiStringsScript,
} from "./ui-strings";
import { UserLabel, userDisplayMeta, userDisplayName } from "./users";

/** The types, for the forms: which element a node gets, and what it posts as. */
const exercises = createDefaultExerciseRegistry();

export interface AssignmentFormValues {
  readonly assessmentMode?: string;
  readonly availableFrom?: string;
  readonly availableUntil?: string;
  readonly contentRevisionId?: string;
  readonly description?: string;
  readonly displayOrder?: string;
  readonly dueAt?: string;
  readonly gradesVisibleAt?: string;
  readonly gradesVisibility?: string;
  readonly listed?: string;
  readonly maxAttempts?: string;
  readonly timeLimitMinutes?: string;
  readonly title?: string;
  readonly workVisibility?: string;
  readonly workVisibleAt?: string;
}

/**
 * A choice of when something becomes visible, and the time its "At the time
 * below" option needs. A blank form preselects the first option the order
 * tuple lists.
 *
 * The time is not "optional": the choice that points at it requires it, and
 * the others ignore it. The option's own wording is what ties them without
 * script; with it, the gate script disables the field under every other
 * choice (`data-gates-field`).
 */
const ScheduledChoice: FC<{
  readonly at: string | undefined;
  readonly atLabel: string;
  readonly atName: string;
  readonly choice: string | undefined;
  readonly label: string;
  readonly name: string;
  readonly options: readonly SelectOption[];
}> = ({ at, atLabel, atName, choice, label, name, options }) => (
  <>
    <label>
      {label}
      <br />
      <select
        data-gates-field={atName}
        data-gates-value="scheduled"
        name={name}
        required
      >
        {options.map((option, index) => (
          <option
            selected={
              choice === undefined ? index === 0 : option.value === choice
            }
            value={option.value}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
    <TimestampInput label={atLabel} name={atName} value={at} />
  </>
);

export interface AssignmentRevisionOption {
  readonly item: ContentItem;
  /** No text: an option is a date and a note, never the lesson itself. */
  readonly revision: ContentRevisionSummary;
}

export interface AssignmentDetail {
  readonly artifact: CompiledContentArtifact;
  /**
   * Why `artifact` above is an empty stand-in rather than the real thing. Set
   * only by `AssignmentService.getForInstructor`; see the same field on the
   * service's `AssignmentDetail`, which this mirrors structurally.
   */
  readonly artifactDefect?: string;
  readonly assignment: Assignment;
  readonly contentItem: ContentItem;
  readonly contentRevision: ContentRevision;
  readonly contentVersions: readonly AssignmentContentVersion[];
  readonly exerciseExcuses: readonly AssignmentExerciseExcuse[];
}

/**
 * What the browser is told about a recorded evaluation.
 *
 * The numbers are nullable because a score is a grade: an exercise may be
 * telling this student their work is wrong while the release date still holds
 * the 0 of 2 back. `verdict` is what survives that, and is why the correctness
 * mark is no longer inferred from `score >= maxScore` in the page script — with
 * the numbers gone there would be nothing to infer it from.
 */
interface RuntimeEvaluation {
  readonly maxScore: number | null;
  readonly score: number | null;
  readonly verdict: EvaluationVerdict;
}

/**
 * An exercise's latest submission in the open attempt, as the page needs it:
 * the answer seeds the widget's hydration, the rest draws the status line and
 * the correctness mark. Only the rest goes to the browser as runtime state
 * (`exerciseRuntimeStateScript`); the answer is already in the widget's own
 * payload, and the submission id, answer kind and rendered review this once
 * carried too were read by nothing — the review was being rendered, per
 * submission, on every load of the page to be thrown away.
 */
interface ExerciseRuntimeSubmissionState {
  readonly evaluation: RuntimeEvaluation | null;
  readonly submission: {
    readonly answer: JsonValue;
    readonly exerciseId: string;
    readonly submittedAt: string;
  };
}

export type ExerciseRuntimeState = Record<
  string,
  ExerciseRuntimeSubmissionState
>;

export interface InlineSubmissionContext {
  readonly assignmentId: string;
  readonly attemptId: string;
  readonly contentRevisionId: string;
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  /**
   * Each exercise's server-decided render options — how much it may tell this
   * student, and whether it is an exam — already resolved against this
   * assignment (see `resolveExerciseFeedback` and `resolveExerciseExam`).
   * Keyed by exercise id, because the content nodes this view walks carry the
   * author's public render data but not the manifest entry the settings live
   * on. Only what differs from the defaults is present, so an ordinary
   * exercise's entry is empty.
   */
  readonly optionsByExercise: ReadonlyMap<string, ExerciseHydrationOptions>;
  readonly runtimeState: ExerciseRuntimeState;
}

export interface InstructorSubmissionReviewEntry {
  readonly answerReview: ExerciseAnswerReview | null;
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  /** The attempt was reset: the work is a record, with nothing to grade. */
  readonly attemptVoided: boolean;
  /** The score takes this exercise's points from this try, or may yet. */
  readonly counts: boolean;
  readonly evaluation: ViewerEvaluation | null;
  /** The question the answer is to, as the lesson asked it; null for none. */
  readonly exercisePromptHtml: string | null;
  /** What the exercise is worth — the hand-grading form's max score. */
  readonly nominalPoints: number | null;
  readonly submission: Submission;
  readonly user: User | null;
}

function runtimeEvaluation(evaluation: ViewerEvaluation): RuntimeEvaluation {
  return {
    maxScore: evaluation.maxScore,
    score: evaluation.score,
    verdict: evaluation.verdict,
  };
}

function publicRuntimeSubmissionState(
  entry: SubmissionHistoryEntry,
): ExerciseRuntimeSubmissionState | null {
  const exerciseId = entry.submission.exerciseId;

  if (exerciseId === null) {
    return null;
  }

  return {
    evaluation:
      entry.evaluation === null ? null : runtimeEvaluation(entry.evaluation),
    submission: {
      answer: entry.submission.answer,
      exerciseId,
      submittedAt: entry.submission.submittedAt,
    },
  };
}

export function latestExerciseRuntimeState(
  entries: readonly SubmissionHistoryEntry[],
): ExerciseRuntimeState {
  const state: ExerciseRuntimeState = {};

  for (const entry of entries) {
    const publicState = publicRuntimeSubmissionState(entry);

    if (publicState !== null) {
      state[publicState.submission.exerciseId] = publicState;
    }
  }

  return state;
}

export function editAssignmentAction(
  courseId: string,
  assignmentId: string,
): string {
  return `/courses/${courseId}/instructor/assignments/${assignmentId}`;
}

export function assignmentValues(
  assignment: Assignment,
): AssignmentFormValues {
  return {
    assessmentMode: assignment.assessmentMode,
    availableFrom: assignment.availableFrom ?? "",
    availableUntil: assignment.availableUntil ?? "",
    contentRevisionId: assignment.contentRevisionId,
    description: assignment.description,
    displayOrder: assignment.displayOrder.toString(),
    dueAt: assignment.dueAt ?? "",
    gradesVisibleAt: assignment.gradesVisibleAt ?? "",
    // A stored assignment knows only its timestamp, so the choice is read back
    // out of it: no timestamp is the release control's job, and any timestamp —
    // including one this form wrote as "immediate" — round-trips as the time it
    // holds, which is what it will do next time it is saved.
    gradesVisibility:
      assignment.gradesVisibleAt === null ? "manual" : "scheduled",
    listed: assignment.listed ? "1" : "0",
    maxAttempts: assignment.maxAttempts.toString(),
    timeLimitMinutes: assignment.timeLimitMinutes?.toString() ?? "",
    title: assignment.title,
    workVisibility: assignment.workVisibility,
    workVisibleAt: assignment.workVisibleAt ?? "",
  };
}

/**
 * The exercise status line. Two whole messages rather than a stem plus an
 * appended score: a translator needs to control the word order and the
 * separator, which a concatenation decides for them. The client half of this
 * (`EXERCISE_RUNTIME_SCRIPT` in `./assignment-scripts`) uses the same two ids,
 * so the line reads identically
 * whether the server rendered it or the runtime replaced it after a submit.
 */
function exerciseStatusText(
  i18n: Translator,
  state: ExerciseRuntimeSubmissionState | undefined,
): string {
  if (state === undefined) {
    return i18n.t("No submission in this attempt.");
  }

  const evaluation = state.evaluation;
  // In UTC, zone named: the script rewrites the line in the reader's own clock
  // on load, so this is only what shows before it runs, or without it.
  const when = utcTimestampText(state.submission.submittedAt, i18n.locale);

  // Either no evaluation, or one whose numbers are still behind the release
  // date. The script's `statusText` draws the same line; both have to, since
  // this renders the first paint and that one every paint after.
  // A zero-point exercise has no score worth a line: `0/0` says nothing.
  if (
    evaluation === null ||
    evaluation.score === null ||
    evaluation.maxScore === 0
  ) {
    return i18n.t("Submitted at {when}.", { when });
  }

  return i18n.t("Submitted at {when} · {score}/{maxScore}.", {
    maxScore: evaluation.maxScore,
    score: evaluation.score,
    when,
  });
}

/**
 * One revision in a picker, named by when it was saved and what its author
 * wrote about it.
 *
 * The label is formatted here, on the server, in UTC — but carries the instant
 * it came from, so the shell's timestamp script can rewrite it in the reader's
 * own clock (see `REVISION_OPTION_SCRIPT`). An `<option>` is the one place a
 * `<time>` element cannot go, and a picker offering "Aug 6, 2026, 11:24 PM UTC"
 * to someone whose revisions list says "Aug 6, 2026, 5:24 PM" leaves them
 * matching one against the other by arithmetic. Whoever has no script keeps the
 * UTC form, which is why the zone is named in both.
 *
 * `withItemTitle` is for the pickers that span several content items; the
 * correction picker is filtered to one already, so repeating its title in every
 * option would add nothing.
 */
const RevisionOption: FC<{
  readonly context: Context<AppBindings>;
  readonly option: AssignmentRevisionOption;
  readonly selected: boolean;
  readonly withItemTitle?: boolean;
}> = ({ context, option, selected, withItemTitle = false }) => {
  const i18n = useI18n();
  const locale = context.get("language");
  const { item, revision } = option;

  return (
    <option
      selected={selected}
      value={revision.id}
      {...revisionOptionTimeAttributes(revision.createdAt, locale)}
    >
      {revisionOptionLabel(
        i18n,
        locale,
        revision,
        withItemTitle ? item.title : undefined,
      )}
    </option>
  );
};

/**
 * The assignment authoring form: a sheet whose body groups related fields
 * side by side (what to publish, schedule, attempts, presentation) and whose
 * footer carries the submit. Published assignments only expose scheduling
 * and presentation: content (repointing), grade visibility (the release
 * control), and the assessment mode stay out of this form.
 */
const AssignmentForm: FC<{
  readonly action?: string;
  /**
   * Where Cancel goes: the page this form was opened from, which is also the
   * last crumb in the trail above it. Required rather than defaulted, because
   * the form serves both creating (the course) and editing (the assignment) and
   * a default would silently send half the cases to the wrong place.
   */
  readonly cancelHref: string;
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly description?: string;
  readonly mode?: "draft" | "published";
  readonly revisions: readonly AssignmentRevisionOption[];
  readonly submitLabel?: string;
  readonly title?: string;
  readonly values?: AssignmentFormValues;
}> = ({
  action,
  cancelHref,
  context,
  courseId,
  description,
  mode,
  revisions,
  submitLabel,
  title,
  values = {},
}) => {
  const i18n = useI18n();
  const published = mode === "published";
  const graded =
    values.assessmentMode === "graded" || values.assessmentMode === undefined;
  const showGradedTiming = !published || graded;

  return (
    <form action={action ?? `/courses/${courseId}/assignments`} method="post">
      <Sheet
        footer={
          <div class="sheet-actions">
            <div class="action-pair">
              <a class="button ghost" href={cancelHref}>
                {i18n.t("Cancel")}
              </a>
              <button type="submit">
                {submitLabel ?? i18n.t("Create draft assignment")}
              </button>
            </div>
          </div>
        }
        {...(description === undefined ? {} : { description })}
        {...(title === undefined ? {} : { title })}
      >
        <CsrfInput context={context} />
        <label>
          {i18n.t("Title")}
          <br />
          <input name="title" required value={values.title ?? ""} />
        </label>
        <label>
          {i18n.t("Description")}
          <br />
          <textarea name="description" rows={4}>
            {values.description ?? ""}
          </textarea>
        </label>
        {published ? null : (
          <div class="field-grid wide-fields">
            <label>
              {i18n.t("Content revision")}
              <br />
              <select name="contentRevisionId" required>
                {revisions.map((option) => (
                  <RevisionOption
                    context={context}
                    option={option}
                    selected={values.contentRevisionId === option.revision.id}
                    withItemTitle
                  />
                ))}
              </select>
            </label>
            <label>
              {i18n.t("Publication type")}
              <br />
              <select name="assessmentMode" required>
                {assessmentModeOptions(i18n).map((option, index) => (
                  <option
                    selected={
                      // A blank form preselects the first mode the order tuple
                      // lists, rather than naming a default a second time.
                      values.assessmentMode === undefined
                        ? index === 0
                        : option.value === values.assessmentMode
                    }
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <fieldset>
          <legend>{i18n.t("Schedule")}</legend>
          <div class="field-grid time-fields">
            <TimestampInput
              label={i18n.t("Available from, optional")}
              name="availableFrom"
              value={values.availableFrom}
            />
            {showGradedTiming ? (
              <TimestampInput
                label={i18n.t("Due at, optional")}
                name="dueAt"
                value={values.dueAt}
              />
            ) : null}
            <TimestampInput
              label={i18n.t("Available until, optional")}
              name="availableUntil"
              value={values.availableUntil}
            />
            {/* Grades are set here only before publishing; a published
                assignment releases them with its own buttons, which also
                schedule the passback. Releasing grades by default as work is
                checked is what ordinary homework wants, and what the bare
                timestamp this replaced could never say. */}
            {published ? null : (
              <ScheduledChoice
                at={values.gradesVisibleAt}
                atLabel={i18n.t("Grades visible at")}
                atName="gradesVisibleAt"
                choice={values.gradesVisibility}
                label={i18n.t("Grades visible")}
                name="gradesVisibility"
                options={gradesVisibilityOptions(i18n)}
              />
            )}
            {/* Work visibility stays editable once published: it moves no
                score and sends nothing to the LMS, and "never" is often a
                choice to revisit once every section has sat the exam. */}
            {showGradedTiming ? (
              <ScheduledChoice
                at={values.workVisibleAt}
                atLabel={i18n.t("Submitted work visible at")}
                atName="workVisibleAt"
                choice={values.workVisibility}
                label={i18n.t("Submitted work visible")}
                name="workVisibility"
                options={workVisibilityOptions(i18n)}
              />
            ) : null}
          </div>
        </fieldset>
        {showGradedTiming ? (
          <fieldset>
            <legend>{i18n.t("Attempts")}</legend>
            <div class="field-grid">
              <label>
                {i18n.t("Max attempts")}
                <br />
                <input
                  max="100"
                  min="1"
                  name="maxAttempts"
                  type="number"
                  value={values.maxAttempts ?? "1"}
                />
              </label>
              <label>
                {i18n.t("Time limit in minutes, optional")}
                <br />
                <input
                  max="10080"
                  min="1"
                  name="timeLimitMinutes"
                  type="number"
                  value={values.timeLimitMinutes ?? ""}
                />
              </label>
            </div>
          </fieldset>
        ) : null}
        <fieldset>
          <legend>{i18n.t("Presentation")}</legend>
          <div class="field-grid">
            <label>
              {i18n.t("Display order")}
              <br />
              <input
                min="0"
                name="displayOrder"
                type="number"
                value={values.displayOrder ?? "0"}
              />
            </label>
          </div>
          <label>
            <input
              checked={values.listed !== "0"}
              name="listed"
              type="checkbox"
              value="1"
            />
            {i18n.t("Show in student assignment lists")}
          </label>
        </fieldset>
      </Sheet>
    </form>
  );
};

/**
 * The runtime's bootstrap: what `assignment-scripts.ts` reads for each
 * exercise, and nothing else — see docs/exercise-runtime-api.md.
 */
function exerciseRuntimeStateScript(state: ExerciseRuntimeState): string {
  const exercises = Object.fromEntries(
    Object.entries(state).map(([exerciseId, entry]) => [
      exerciseId,
      {
        evaluation: entry.evaluation,
        submission: {
          exerciseId: entry.submission.exerciseId,
          submittedAt: entry.submission.submittedAt,
        },
      },
    ]),
  );

  return `<script type="application/json" data-carnap-exercise-runtime-state>${jsonScriptContent(
    { exercises, version: 1 },
  )}</script>`;
}

function exerciseFormAction(submission: InlineSubmissionContext): string {
  return (
    `/courses/${submission.courseId}` +
    `/assignments/${submission.assignmentId}` +
    `/attempts/${submission.attemptId}/submissions`
  );
}

function exerciseHydration(
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  submission: InlineSubmissionContext,
): ExerciseHydration {
  const priorState = submission.runtimeState[node.exerciseId];

  return {
    mode: "answer",
    options: submission.optionsByExercise.get(node.exerciseId) ?? {},
    priorAnswer: priorState?.submission.answer ?? null,
    publicData: node.publicData,
    strings: exercises.strings(
      node.render.assetId,
      submission.context.get("i18n"),
    ),
    version: EXERCISE_HYDRATION_VERSION,
  };
}

/**
 * The action bar for one exercise, resolved for the viewer.
 *
 * `slotted` is what projects the bar into an element's shadow card. The two text
 * kinds have no card to project into, so theirs sits in the light DOM beside the
 * fields — the same row, in the same place, either way.
 */
function exerciseActions(
  submission: InlineSubmissionContext,
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  slotted: boolean,
): string {
  const i18n = submission.context.get("i18n");

  return exerciseActionsHtml(i18n, {
    slotted,
    status: exerciseStatusText(
      i18n,
      submission.runtimeState[node.exerciseId],
    ),
  });
}

/**
 * The envelope that lets one exercise post an answer: the form, its hidden
 * fields, and the hydration payload the element reads on connect. Nothing more
 * — the exercise itself is `children`, and it is `children` that carries
 * `class="exercise"` (see `exerciseRootAttributes`), on this path exactly as on
 * a preview or a saved revision.
 *
 * Hence `exercise-submission` rather than `exercise` on the form. The class had
 * been doing two jobs: naming the exercise's box for the stylesheet and finding
 * the posting form for the runtime. Only a graded attempt has a form, so the
 * second job kept the first from ever being uniform — and an author's
 * `.exercise` rule, which the style docs invite, drew itself twice here and
 * once everywhere else.
 */
const ExerciseFormShell: FC<{
  readonly children: Child;
  readonly node: Extract<ContentNode, { readonly kind: "exercise" }>;
  readonly submission: InlineSubmissionContext;
}> = ({ children, node, submission }) => {
  return (
    <form
      action={exerciseFormAction(submission)}
      class="exercise-submission"
      data-component={node.render.component}
      data-component-version={node.render.componentVersion}
      data-content-revision-id={submission.contentRevisionId}
      data-exercise-id={node.exerciseId}
      data-exercise-kind={node.exerciseKind}
      method="post"
    >
      <CsrfInput context={submission.context} />
      <input name="exerciseId" type="hidden" value={node.exerciseId} />
      {/* An enhancing custom element mirrors its answer here; the runtime prefers
        this field, falling back to a native text field for the text types. */}
      <input name="answerData" type="hidden" />
      {/* The single hydration payload the element reads on connect: publicData to
        render from, and the student's own prior answer to restore. */}
      {raw(exerciseHydrationScript(exerciseHydration(node, submission)))}
      {children}
    </form>
  );
};

/**
 * One exercise's form: the type renders the same markup a preview shows, with
 * the viewer's action bar in place of the preview's inert one.
 *
 * A type with a client element renders its chrome into a Declarative Shadow
 * Root (inert until it upgrades); the prompt is slotted from light DOM so
 * author CSS and the document's math font still reach it. The element's own
 * controls — Check, a counterexample, Help — share the light-DOM action bar the
 * element fills on upgrade, and every such widget looks for `.exercise-actions`
 * in **its own light DOM**. That is why the bar is handed to the type's
 * renderer here rather than laid beside the element: beside it, the element
 * cannot reach it, and its buttons silently never appear.
 * `tests/exercise-contract.test.ts` checks that every type puts the bar it is
 * given inside what it renders.
 *
 * The two text types have no element: they render a native field the runtime
 * reads directly, and their bar sits beside it in the light DOM, unslotted —
 * there is no shadow card to project into. Which is `slotted` below: the one
 * thing the form knows about a type's shape, and the same thing the type's own
 * preview bar knows.
 */
function exerciseSubmissionForm(
  type: ExerciseType,
  submission: InlineSubmissionContext,
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  naming: ExerciseNaming,
): Child {
  return (
    <ExerciseFormShell node={node} submission={submission}>
      <input name="answerKind" type="hidden" value={type.answerKind} />
      <input name="schemaVersion" type="hidden" value={type.schemaVersion} />
      {raw(
        type.render(node, {
          actions: exerciseActions(
            submission,
            node,
            type.component.clientModule,
          ),
          contentRevisionId: submission.contentRevisionId,
          i18n: submission.context.get("i18n"),
          ...naming,
        }),
      )}
    </ExerciseFormShell>
  );
}

/**
 * The submission form for one exercise: the shell, and inside it whatever the
 * type renders when handed the viewer's action bar. Null for a node no type
 * claims, which the caller renders read-only instead.
 */
function submissionFormNode(
  submission: InlineSubmissionContext,
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  naming: ExerciseNaming,
): Child | null {
  const type = exercises.typeForAssetId(node.render.assetId);

  return type === null
    ? null
    : exerciseSubmissionForm(type, submission, node, naming);
}

/** What names an exercise's group and heading: its title and its place. */
type ExerciseNaming = Pick<ExerciseRenderContext, "heading" | "title">;

function renderAssignmentContent(
  detail: {
    readonly artifact: CompiledContentArtifact;
    readonly contentRevision: ContentRevision;
  },
  submission: InlineSubmissionContext | null,
  i18n: Translator,
): Child {
  if (submission === null) {
    return raw(
      renderCompiledContent(detail.artifact, i18n, undefined, {
        contentRevisionId: detail.contentRevision.id,
      }),
    );
  }

  const outline = exerciseOutline();

  return (
    <>
      {detail.artifact.document.nodes.map((node) => {
        if (node.kind === "markdown") {
          outline.read(node.html);
          return raw(node.html);
        }

        if (node.kind === "theory") {
          return raw(renderTheoryPanel(node, i18n));
        }

        const manifestItem = detail.artifact.manifest.find(
          (item) => item.id === node.exerciseId,
        );
        const naming: ExerciseNaming = {
          heading: outline.next(),
          title: manifestItem?.title ?? null,
        };

        return (
          submissionFormNode(submission, node, naming) ??
          raw(
            exercises.renderExercise(node, {
              contentRevisionId: detail.contentRevision.id,
              i18n,
              ...naming,
            }),
          )
        );
      })}
    </>
  );
}

function assignmentSummaryItems(
  i18n: Translator,
  assignment: Assignment,
): SummaryItem[] {
  const notSet = i18n.t("Not set");
  const items: SummaryItem[] = [
    {
      label: i18n.t("State"),
      value: assignmentStateLabel(i18n, assignment.state),
    },
    {
      label: i18n.t("Type"),
      value: assessmentModeLabel(i18n, assignment.assessmentMode),
    },
    {
      label: i18n.t("Available from"),
      value: <Time fallback={notSet} value={assignment.availableFrom} />,
    },
    {
      label: i18n.t("Available until"),
      value: <Time fallback={notSet} value={assignment.availableUntil} />,
    },
  ];

  if (assignment.assessmentMode === "graded") {
    items.splice(
      3,
      0,
      {
        label: i18n.t("Due"),
        value: <Time fallback={i18n.t("None")} value={assignment.dueAt} />,
      },
      {
        label: i18n.t("Grades visible at"),
        value: <Time fallback={notSet} value={assignment.gradesVisibleAt} />,
      },
      {
        label: i18n.t("Submitted work visible"),
        value:
          assignment.workVisibility === "scheduled" ? (
            <Time fallback={notSet} value={assignment.workVisibleAt} />
          ) : (
            workVisibilityLabel(i18n, assignment.workVisibility)
          ),
      },
      {
        label: i18n.t("Max attempts"),
        value: assignment.maxAttempts.toString(),
      },
      {
        label: i18n.t("Time limit"),
        value:
          assignment.timeLimitMinutes === null
            ? i18n.t("None")
            : i18n.t("{minutes} min", {
                minutes: assignment.timeLimitMinutes,
              }),
      },
    );
  }

  return items;
}

/**
 * The rendered assignment content on its own: the compiled markdown/exercises
 * and — when a submission context is present — the runtime scripts that make
 * the exercises submittable. No metadata or chrome, so the same helper drives
 * the instructor preview (submission null, no submit path) and the student view
 * (submission present, submittable). The component bundles are loaded by the
 * enclosing content document, which both paths need.
 */
const AssignmentContent: FC<{
  readonly detail: AssignmentDetail;
  readonly submission: InlineSubmissionContext | null;
}> = ({ detail, submission }) => {
  const i18n = useI18n();

  return (
    <>
      {renderAssignmentContent(detail, submission, i18n)}
      {submission === null ? null : (
        <>
          {raw(exerciseRuntimeStateScript(submission.runtimeState))}
          {raw(
            uiStringsScript(
              EXERCISE_UI_STRINGS_ATTRIBUTE,
              exerciseUiStrings(i18n),
            ),
          )}
          {/* In the body rather than the head because whether this page has a
              runtime at all is decided here, by the submission. `defer` still
              holds execution until the payloads above are parsed; only the
              fetch starts later than it would from the head, which is where
              these bytes sat when they were inline anyway. */}
          <script defer src={EXERCISE_SCRIPT_ASSET.href} />
        </>
      )}
    </>
  );
};

/**
 * The assignment content as a standalone document — the target of the content
 * iframes and their fullscreen links on the student and instructor pages.
 * The exercise runtime is self-contained (it queries its own document and
 * submits with the form's embedded CSRF token), so interactive exercises work
 * inside the frame exactly as they did inline.
 *
 * Both paths load the component bundles: an exercise is inert markup until its
 * element upgrades, so the instructor preview needs them just as much as the
 * student view. Only the preview carries a document hydration table — the
 * student's forms each embed their own payload (with their prior answer).
 */
export function renderAssignmentContentDocument(
  context: Context<AppBindings>,
  model: {
    readonly detail: AssignmentDetail;
    readonly submission: InlineSubmissionContext | null;
  },
): Response {
  return renderContentDocument(context, {
    body: (
      <AssignmentContent
        detail={model.detail}
        submission={model.submission}
      />
    ),
    componentAssets: componentAssetsForArtifact(model.detail.artifact),
    ...(model.submission === null
      ? {
          exerciseHydration: exerciseHydrationForArtifact(
            model.detail.artifact,
            context.get("i18n"),
          ),
        }
      : {}),
    ...artifactDocumentProps(model.detail.artifact),
    title: model.detail.assignment.title,
  });
}

/**
 * The attempt line of the briefing, as a count against an allowance rather than
 * an allowance alone.
 *
 * "Attempts allowed: 9" is exactly the reading that leaves a student stuck: it
 * is a number they can compare against nothing, so a refusal to start looks
 * like a fault rather than the limit arriving. `assignment` here is theirs (see
 * `assignmentAsAppliedTo`), so the allowance is the one the server will hold
 * them to, and the used count excludes voided attempts because the limit does.
 */
function attemptCountText(
  i18n: Translator,
  assignment: Assignment,
  attemptsUsed: number,
): string {
  if (assignment.maxAttempts === 0) {
    return i18n.t(
      "{count, plural, one {# attempt used} other {# attempts used}}",
      { count: attemptsUsed },
    );
  }

  return i18n.t("{used} of {allowed}", {
    allowed: assignment.maxAttempts,
    used: attemptsUsed,
  });
}

function attemptBriefingItems(
  i18n: Translator,
  assignment: Assignment,
  attemptsUsed: number,
): SummaryItem[] {
  const items: SummaryItem[] = [
    {
      label: i18n.t("Due"),
      value: (
        <Time fallback={i18n.t("No due date")} value={assignment.dueAt} />
      ),
    },
    {
      label: i18n.t("Time limit"),
      value:
        assignment.timeLimitMinutes === null
          ? i18n.t("None")
          : i18n.t("{minutes} min", { minutes: assignment.timeLimitMinutes }),
    },
    {
      label: i18n.t("Attempts"),
      value: attemptCountText(i18n, assignment, attemptsUsed),
    },
  ];

  if (assignment.availableUntil !== null) {
    items.push({
      label: i18n.t("Closes"),
      value: <Time value={assignment.availableUntil} />,
    });
  }

  return items;
}

/**
 * Why there is no button, in the student's terms. Only reached when the policy
 * refuses and no attempt is open, which in practice means the allowance is
 * spent; the other refusals (draft, outside the window) keep the page itself
 * from loading. The fallback covers them anyway rather than rendering nothing,
 * since a panel with neither a button nor a reason is the state being fixed
 * here.
 */
function attemptRefusalText(
  i18n: Translator,
  policy: EffectiveAssignmentPolicy,
): string {
  if (policy.reasons.includes("attempt_limit_reached")) {
    return i18n.t(
      "You have used all of your attempts on this assignment. Ask your instructor if you need another.",
    );
  }

  return i18n.t("This assignment is not accepting new attempts.");
}

const StudentAttemptPanel: FC<{
  /** Where "Start attempt" posts — which decides where it comes back to. */
  readonly action: string;
  readonly activity: AttemptActivity;
  readonly attempts: readonly Attempt[];
  readonly context: Context<AppBindings>;
  readonly policy: EffectiveAssignmentPolicy;
}> = ({ action, activity, attempts, context, policy }) => {
  const i18n = useI18n();

  return (
    <>
      {attempts.length === 0 ? null : (
        <ol>
          {attempts.map((attempt) => (
            <li>
              {i18n.t("Attempt {ordinal}: {status}", {
                ordinal: attempt.ordinal,
                status: attemptStatusLabel(i18n, attempt.status),
              })}
            </li>
          ))}
        </ol>
      )}
      {activity.activeAttempt !== null ? (
        <p>{i18n.t("Use the exercise controls above to submit answers.")}</p>
      ) : policy.canBegin ? (
        <form action={action} method="post">
          <CsrfInput context={context} />
          <button type="submit">{i18n.t("Start attempt")}</button>
        </form>
      ) : (
        // The button used to be offered whatever the policy said, so a student
        // out of attempts clicked it and got a bare 403 error page with nothing
        // to do next. Say the thing the server would have said, here, where the
        // count above already explains it.
        <p>{attemptRefusalText(i18n, policy)}</p>
      )}
    </>
  );
};

/**
 * The briefing a graded assignment shows before its attempt begins: what the
 * student is about to commit to, and the button that commits. Shared by the
 * assignment page and the chrome-free gate below, because the two are the same
 * moment reached from different places — from the course, or from an LMS.
 */
const AttemptBriefing: FC<{
  readonly action: string;
  /** Which attempt is open now and how many have been used — the policy's
   *  own reading of `attempts`, so the panel and the button agree on it. */
  readonly activity: AttemptActivity;
  readonly assignment: Assignment;
  readonly attempts: readonly Attempt[];
  readonly context: Context<AppBindings>;
  readonly policy: EffectiveAssignmentPolicy;
  readonly title: string;
}> = ({ action, activity, assignment, attempts, context, policy, title }) => {
  const i18n = useI18n();

  return (
    <Sheet
      description={i18n.t(
        "Review the details, then start your attempt. The questions appear once you begin.",
      )}
      summary={
        <SummaryStrip
          items={attemptBriefingItems(
            i18n,
            assignment,
            activity.attemptsUsed,
          )}
        />
      }
      title={title}
    >
      {assignment.description.trim().length === 0 ? null : (
        <p>{assignment.description}</p>
      )}
      <StudentAttemptPanel
        action={action}
        activity={activity}
        attempts={attempts}
        context={context}
        policy={policy}
      />
    </Sheet>
  );
};

/**
 * The attempt gate: the same briefing with the page's chrome taken away, for a
 * student who arrived by LTI launch and is looking at us inside their LMS.
 *
 * It exists because the launch lands on the content document — the canonical
 * no-navigation view, and the one the author's CSS governs — and a graded
 * assignment has no content to show until an attempt is open. Its own page
 * rather than a state of that document, so that the boundary stays where it is:
 * the content is the author's, the attempt lifecycle is ours. `:::style{reset}`
 * can unstyle a lesson completely, and it must never be able to unstyle the
 * button that starts the clock.
 *
 * Starting from here returns to the content view rather than to the assignment
 * page, which is what keeps our navbar out of the LMS's frame at the moment the
 * student commits.
 */
export function renderAttemptGatePage(
  context: Context<AppBindings>,
  model: {
    readonly activity: AttemptActivity;
    readonly assignmentId: string;
    readonly attempts: readonly Attempt[];
    readonly courseId: string;
    readonly detail: AssignmentDetail;
    readonly policy: EffectiveAssignmentPolicy;
  },
): Response {
  const { assignment } = model.detail;

  return renderShell(
    context,
    { chromeless: true, title: assignment.title },
    <AttemptBriefing
      action={`/courses/${model.courseId}/assignments/${model.assignmentId}/start`}
      activity={model.activity}
      assignment={assignment}
      attempts={model.attempts}
      context={context}
      policy={model.policy}
      // The assignment's own name, since there is no breadcrumb above it to say
      // which one this is and the LMS frame may be showing very little.
      title={assignment.title}
    />,
  );
}

/**
 * Every content version and excused exercise this assignment has had, oldest
 * first.
 *
 * No row is dropped for carrying no note. A correction published without one is
 * still a correction — the content changed under students who may already have
 * answered it — so hiding it left the ledger asserting a change had never
 * happened, and left the one row that did show, the publication's own, looking
 * like the only content this assignment ever had. The note says what the author
 * chose to write about a change, not whether it occurred; an empty one reads as
 * "No details given", the same words the revision list uses for a revision saved
 * without any.
 *
 * The first row is the version the publish itself wrote, so it names the
 * publication rather than a correction. That belongs in the Change column: it
 * used to be stored in the note, where it both impersonated the author's own
 * words and reached every reader in English. Which row it is, is positional —
 * versions arrive in the order they took effect and the publish writes the
 * first — since a version carries no kind of its own.
 */
const CorrectionsLedger: FC<{
  readonly detail: {
    readonly artifact: CompiledContentArtifact;
    readonly contentVersions: readonly AssignmentContentVersion[];
    readonly exerciseExcuses: readonly AssignmentExerciseExcuse[];
  };
}> = ({ detail }) => {
  const i18n = useI18n();
  const contentRows = detail.contentVersions;
  // The same name the form above excuses it by. An excuse stores the exercise's
  // id, which is what the grader needs and not what anyone picked: the author
  // chose a title, chose it from a list of titles, and then read back a row
  // naming something they never typed. The id survives as the fallback for the
  // two cases where no title can be found — an exercise the author left
  // untitled, and one a later content correction has since removed.
  const exerciseNames = new Map(
    detail.artifact.manifest.map((item) => [item.id, item.title ?? item.id]),
  );

  if (contentRows.length === 0 && detail.exerciseExcuses.length === 0) {
    return (
      <p>
        {i18n.t("No corrections have been published for this assignment.")}
      </p>
    );
  }

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("Change")}</th>
          <th>{i18n.t("Detail")}</th>
          <th>{i18n.t("When")}</th>
        </tr>
      </thead>
      <tbody>
        {contentRows.map((version, index) => (
          <tr>
            <td>
              {index === 0
                ? i18n.t("Initial revision")
                : i18n.t("Content update")}
            </td>
            <td>{revisionDetailsText(i18n, version.note)}</td>
            <td>
              <Time value={version.effectiveAt} />
            </td>
          </tr>
        ))}
        {detail.exerciseExcuses.map((excuse) => (
          <tr>
            <td>{i18n.t("Excused exercise")}</td>
            <td>
              {excuse.reason.length === 0
                ? (exerciseNames.get(excuse.exerciseId) ?? excuse.exerciseId)
                : i18n.t("{exercise} — {reason}", {
                    exercise:
                      exerciseNames.get(excuse.exerciseId) ??
                      excuse.exerciseId,
                    reason: excuse.reason,
                  })}
            </td>
            <td>
              <Time value={excuse.createdAt} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};

/**
 * What stands where the content would be when the stored artifact cannot be
 * read — instructors only, and only on their own page.
 *
 * Rendering the frame anyway would show an empty document, which says the
 * lesson is blank rather than that it is broken. The point of the sheet is the
 * two sentences after the diagnosis: the way out is the correction control
 * further down this same page, which is precisely the control an instructor
 * could not reach while this page answered 500.
 *
 * The defect line stays English, deliberately. It is an identifier, like a
 * stack frame — it names fields of a stored artifact, it is what a bug report
 * should quote, and a translated version of it would be harder to search for,
 * not easier to read.
 */
const UnreadableContent: FC<{
  readonly contentItemId: string;
  readonly defect: string;
  readonly revisionId: string;
}> = ({ contentItemId, defect, revisionId }) => {
  const i18n = useI18n();

  return (
    <Sheet
      description={i18n.t(
        "The saved form of this revision does not match what the compiler produces, so the content cannot be shown or answered.",
      )}
      footer={
        <div class="sheet-actions">
          <a class="button" href={`/content/${contentItemId}`}>
            {i18n.t("Open the content item")}
          </a>
        </div>
      }
      title={i18n.t("This content could not be read")}
    >
      <p>
        {i18n.t(
          "Publish a correction below that points this assignment at a different revision, or open the content item and save its source again to compile a fresh one.",
        )}
      </p>
      <ul class="diagnostics">
        <li>
          <code>{revisionId}</code>: {defect}
        </li>
      </ul>
    </Sheet>
  );
};

const CorrectionForms: FC<{
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly detail: {
    readonly artifact: CompiledContentArtifact;
    readonly assignment: Assignment;
    readonly contentItem: ContentItem;
    readonly contentRevision: ContentRevision;
  };
  readonly gradedWorkExists: boolean;
  readonly revisions: readonly AssignmentRevisionOption[];
}> = ({ context, courseId, detail, gradedWorkExists, revisions }) => {
  const i18n = useI18n();
  const baseAction = `/courses/${courseId}/instructor/assignments/${detail.assignment.id}`;

  return (
    <>
      {/* The before-the-fact half of the points-drift story: with graded
          work recorded, publishing a correction asks once before it goes,
          saying what it will and will not change — the review and results
          pages mark each affected score after. Only rendered while it can
          matter, so the ordinary no-grades repoint stays one click. Without
          JS the form posts directly, like every enhancement in the shell. */}
      {gradedWorkExists ? (
        <ModalDialog
          id="confirm-correction"
          title={i18n.t("Publish this correction?")}
        >
          <form method="dialog">
            <p>
              {i18n.t(
                "Scores have already been recorded on this assignment. A correction keeps each recorded score and the points it was graded out of; assignment totals will count every exercise at the new revision's points.",
              )}
            </p>
            <div class="sheet-actions">
              <button data-confirm-submit="repoint-form" type="button">
                {i18n.t("Publish correction")}
              </button>
              <button class="secondary" type="submit">
                {i18n.t("Cancel")}
              </button>
            </div>
          </form>
        </ModalDialog>
      ) : null}
      <div class="correction-bars">
        <form
          action={`${baseAction}/content-revision`}
          class="create-bar"
          data-confirm-dialog={
            gradedWorkExists ? "confirm-correction" : undefined
          }
          id="repoint-form"
          method="post"
        >
          <CsrfInput context={context} />
          <select
            aria-label={i18n.t("Content revision to publish")}
            name="contentRevisionId"
            required
          >
            {revisions
              .filter(({ item }) => item.id === detail.contentItem.id)
              .map((option) => (
                <RevisionOption
                  context={context}
                  option={option}
                  selected={option.revision.id === detail.contentRevision.id}
                />
              ))}
          </select>
          <input
            aria-label={i18n.t("Correction note")}
            name="note"
            placeholder={i18n.t("What changed, optional")}
          />
          <button class="secondary" type="submit">
            {i18n.t("Publish correction")}
          </button>
        </form>
        {/* No exercises to name means no excuse to make — and a `required`
          select with no options is a control that cannot be satisfied. That is
          the ordinary case for a prose-only assignment, and also what an
          unreadable artifact leaves behind, where the repoint form above is
          the only one that can help. */}
        {detail.artifact.manifest.length === 0 ? null : (
          <form
            action={`${baseAction}/excuses`}
            class="create-bar"
            method="post"
          >
            <CsrfInput context={context} />
            <select
              aria-label={i18n.t("Exercise to excuse")}
              name="exerciseId"
              required
            >
              {detail.artifact.manifest.map((item) => (
                <option value={item.id}>{item.title ?? item.id}</option>
              ))}
            </select>
            <input
              aria-label={i18n.t("Excuse reason")}
              name="reason"
              placeholder={i18n.t("Reason, optional")}
            />
            <button class="secondary" type="submit">
              {i18n.t("Excuse exercise")}
            </button>
          </form>
        )}
      </div>
    </>
  );
};

/**
 * The assignment's late policy, as an editor over the one in force.
 *
 * Saving replaces the whole policy rather than patching it, so every field has
 * to open on its stored value: a form that always showed its own defaults would
 * both misreport the assignment as having no late penalty and quietly erase the
 * penalty on the next save of any other field. An assignment with no policy
 * saved yet falls back to the same defaults the server applies.
 */
const LatePolicyForm: FC<{
  readonly assignmentId: string;
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly policy: AssignmentLatePolicy | null;
}> = ({ assignmentId, context, courseId, policy }) => {
  const i18n = useI18n();
  const kind = policy?.kind ?? "none";

  return (
    <form
      action={`/courses/${courseId}/instructor/assignments/${assignmentId}/late-policy`}
      method="post"
    >
      <CsrfInput context={context} />
      <div class="field-grid">
        <label>
          {i18n.t("Assignment late policy")}
          <br />
          <select name="kind" required>
            {latePolicyKindOptions(i18n).map((option) => (
              <option selected={option.value === kind} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {i18n.t("Grace minutes")}
          <br />
          <input
            min="0"
            name="graceMinutes"
            type="number"
            value={(policy?.graceMinutes ?? 0).toString()}
          />
        </label>
        <label>
          {i18n.t("Percent penalty")}
          <br />
          <input
            max="100"
            min="0"
            name="percentPenalty"
            type="number"
            value={(policy?.percentPenalty ?? 0).toString()}
          />
        </label>
        <label>
          {i18n.t("Max percent penalty")}
          <br />
          <input
            max="100"
            min="0"
            name="maxPercentPenalty"
            type="number"
            value={(policy?.maxPercentPenalty ?? 100).toString()}
          />
        </label>
        <button type="submit">{i18n.t("Save late policy")}</button>
      </div>
    </form>
  );
};

function overrideNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : value.toString();
}

const OverrideDialog: FC<{
  readonly assignmentId: string;
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly directory: UserDirectory;
  readonly membership: CourseMembership;
  readonly override: AssignmentOverride | undefined;
}> = ({
  assignmentId,
  context,
  courseId,
  directory,
  membership,
  override,
}) => {
  const i18n = useI18n();
  const user = directory.get(membership.userId) ?? null;
  const name = userDisplayName(i18n, user, membership.userId);

  return (
    <ModalDialog
      id={`override-${membership.id}`}
      title={i18n.t("Override for {name}", { name })}
    >
      <form
        action={`/courses/${courseId}/instructor/assignments/${assignmentId}/overrides`}
        method="post"
      >
        <CsrfInput context={context} />
        <p class="small">
          {override === undefined
            ? i18n.t(
                "Leave a field blank to keep the assignment default for this student.",
              )
            : i18n.t(
                "Leave a field blank to keep the assignment default for this student. Clearing the override returns the student to the assignment's own schedule.",
              )}
        </p>
        <input name="userId" type="hidden" value={membership.userId} />
        <div class="field-grid time-fields">
          <TimestampInput
            label={i18n.t("Available from override")}
            name="availableFrom"
            value={override?.availableFrom}
          />
          <TimestampInput
            label={i18n.t("Due at override")}
            name="dueAt"
            value={override?.dueAt}
          />
          <TimestampInput
            label={i18n.t("Available until override")}
            name="availableUntil"
            value={override?.availableUntil}
          />
          <label>
            {i18n.t("Max attempts override")}
            <br />
            <input
              min="0"
              name="maxAttempts"
              type="number"
              value={overrideNumber(override?.maxAttempts)}
            />
          </label>
          <label>
            {i18n.t("Time limit minutes override")}
            <br />
            <input
              min="0"
              name="timeLimitMinutes"
              type="number"
              value={overrideNumber(override?.timeLimitMinutes)}
            />
          </label>
        </div>
        {/* Clear sits at the far left, apart from Save in the corner, but
            belongs to the hidden form below: a button owned by another form
            is never this one's default, so Enter in a field still saves
            and the tab order can follow the eye. */}
        <div class="sheet-actions">
          {override === undefined ? null : (
            <button
              class="danger"
              form={`override-${membership.id}-clear`}
              type="submit"
            >
              {i18n.t("Clear")}
            </button>
          )}
          <button type="submit">{i18n.t("Save")}</button>
        </div>
      </form>
      {override === undefined ? null : (
        <form
          action={`/courses/${courseId}/instructor/assignments/${assignmentId}/overrides/clear`}
          hidden
          id={`override-${membership.id}-clear`}
          method="post"
        >
          <CsrfInput context={context} />
          <input name="userId" type="hidden" value={membership.userId} />
        </form>
      )}
    </ModalDialog>
  );
};

/**
 * What an override actually changes, as a short line of plain text, so the
 * roster tells the instructor at a glance which students are on a custom
 * schedule and how — rather than a bare "Custom" badge that says only that
 * something differs. A student with no override reads as a quiet default.
 */
const OverrideSummary: FC<{
  readonly override: AssignmentOverride | undefined;
}> = ({ override }) => {
  const i18n = useI18n();

  if (override === undefined) {
    return <span class="small">{i18n.t("Course default")}</span>;
  }

  const parts: Child[] = [];

  /** One "<word> <date>" fact, with the date element where the message puts it. */
  const dated = (message: string, value: string): Child => {
    const [before, after] = splitAtValue(message);

    return (
      <>
        {before}
        <Time value={value} />
        {after}
      </>
    );
  };

  if (override.availableFrom !== null) {
    parts.push(
      dated(i18n.t("Opens {when}", { when: VALUE }), override.availableFrom),
    );
  }

  if (override.dueAt !== null) {
    parts.push(dated(i18n.t("Due {when}", { when: VALUE }), override.dueAt));
  }

  if (override.availableUntil !== null) {
    parts.push(
      dated(
        i18n.t("Closes {when}", { when: VALUE }),
        override.availableUntil,
      ),
    );
  }

  if (override.maxAttempts !== null) {
    parts.push(
      override.maxAttempts === 0
        ? i18n.t("Unlimited attempts")
        : i18n.t("{count, plural, one {# attempt} other {# attempts}}", {
            count: override.maxAttempts,
          }),
    );
  }

  if (override.timeLimitMinutes !== null) {
    parts.push(
      i18n.t("{minutes} min limit", {
        minutes: override.timeLimitMinutes,
      }),
    );
  }

  if (parts.length === 0) {
    return (
      <span class="small">{i18n.t("Override set, no fields differ")}</span>
    );
  }

  return (
    <span>
      {parts.map((part, index) => (
        <>
          {index === 0 ? null : " · "}
          {part}
        </>
      ))}
    </span>
  );
};

const OverrideRoster: FC<{
  readonly assignmentId: string;
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly directory: UserDirectory;
  readonly overrides: ReadonlyMap<string, AssignmentOverride>;
  readonly students: readonly CourseMembership[];
}> = ({
  assignmentId,
  context,
  courseId,
  directory,
  overrides,
  students,
}) => {
  const i18n = useI18n();

  if (students.length === 0) {
    return (
      <p class="small">
        {i18n.t("No students are enrolled in this course yet.")}
      </p>
    );
  }

  return (
    <>
      <TableScroll>
        <thead>
          <tr>
            <th>{i18n.t("Student")}</th>
            <th>{i18n.t("Override")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {students.map((membership) => {
            const user = directory.get(membership.userId) ?? null;
            const name = userDisplayName(i18n, user, membership.userId);
            const override = overrides.get(membership.userId);
            const buttonLabel =
              override === undefined
                ? i18n.t("Set override")
                : i18n.t("Edit override");
            const buttonTitle =
              override === undefined
                ? i18n.t("Set an override for {name}", { name })
                : i18n.t("Edit the override for {name}", { name });

            return (
              <tr>
                <td>
                  <UserLabel
                    directory={directory}
                    identified={true}
                    userId={membership.userId}
                  />
                </td>
                <td>
                  <OverrideSummary override={override} />
                </td>
                <td>
                  <button
                    data-dialog-target={`override-${membership.id}`}
                    title={buttonTitle}
                    type="button"
                  >
                    {buttonLabel}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableScroll>
      {students.map((membership) => (
        <OverrideDialog
          assignmentId={assignmentId}
          context={context}
          courseId={courseId}
          directory={directory}
          membership={membership}
          override={overrides.get(membership.userId)}
        />
      ))}
    </>
  );
};

/**
 * Grading by hand asks for one number. What it is out of is the exercise's to
 * say — the label says which number that is, and there is no field for it,
 * because a grader who edited it would be editing the wording of this card and
 * nothing else: an assignment's total divides by the author's declared points
 * whatever an evaluation records.
 *
 * The score is deliberately not capped at that figure. Marking above it is how
 * bonus is awarded, and it works — the extra lands in the numerator over an
 * unchanged denominator, so it offsets a low score elsewhere. Capping the field
 * would take that away in exchange for nothing.
 */
const ManualEvaluationForm: FC<{
  readonly assignmentId: string;
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly maxScore: number | null;
  readonly submissionId: string;
  /** The queue's view, which a grade posted without script returns to. */
  readonly viewQuery: string;
}> = ({
  assignmentId,
  context,
  courseId,
  maxScore,
  submissionId,
  viewQuery,
}) => {
  const i18n = useI18n();

  return (
    <form
      action={`/courses/${courseId}/instructor/assignments/${assignmentId}/submissions/${submissionId}/evaluations${viewQuery}`}
      class="manual-evaluation-form"
      method="post"
    >
      <CsrfInput context={context} />
      <label>
        {maxScore === null
          ? i18n.t("Score")
          : i18n.t("Score out of {maxScore}", { maxScore })}
        <br />
        <input min="0" name="score" required step="0.01" type="number" />
      </label>
      <label>
        {i18n.t("Feedback")}
        <br />
        <textarea name="feedback" rows={2} />
      </label>
      <button type="submit">{i18n.t("Add manual evaluation")}</button>
    </form>
  );
};

/**
 * The review queue's tabs. `active` is every try that counts toward a grade;
 * `needs-review` is the part of it still waiting for a grader; `all` adds the
 * tries that do not count and a reset attempt's work, kept as a record.
 */
export type SubmissionReviewFilter = "needs-review" | "active" | "all";

/**
 * What the review queue is showing: a tab, narrowed to one exercise, one
 * student, both or neither. Null is every exercise, or every student.
 */
export interface SubmissionReviewQuery {
  readonly exercise: string | null;
  readonly review: SubmissionReviewFilter;
  readonly student: string | null;
}

/**
 * The query string that reopens the queue on `query`, led by its `?`, or
 * empty for the default view. `notice` names a one-time flag to add, such as
 * the one a grade posted without script returns with.
 */
export function reviewQueryString(
  query: SubmissionReviewQuery,
  notice?: string,
): string {
  const params = new URLSearchParams();

  if (query.review !== "needs-review") {
    params.set("review", query.review);
  }

  if (query.exercise !== null) {
    params.set("exercise", query.exercise);
  }

  if (query.student !== null) {
    params.set("student", query.student);
  }

  if (notice !== undefined) {
    params.set(notice, "1");
  }

  const text = params.toString();

  return text === "" ? "" : `?${text}`;
}

/**
 * The score line on a review card. The evaluator used to print as its raw enum
 * value (`automatic`), which no locale ever translated; the review script builds
 * the same line from `reviewUiStrings`, using these same two ids.
 */
function evaluationText(
  i18n: Translator,
  evaluation: ViewerEvaluation | null,
): string {
  if (evaluation === null || evaluation.score === null) {
    return i18n.t("Not graded");
  }

  return i18n.t("{score}/{maxScore} · {evaluator}", {
    evaluator: evaluatorKindLabel(i18n, evaluation.evaluatorKind),
    maxScore: evaluation.maxScore,
    score: evaluation.score,
  });
}

const ApproveScoreForm: FC<{
  readonly assignmentId: string;
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly submissionId: string;
  readonly viewQuery: string;
}> = ({ assignmentId, context, courseId, submissionId, viewQuery }) => {
  const i18n = useI18n();

  return (
    <form
      action={`/courses/${courseId}/instructor/assignments/${assignmentId}/submissions/${submissionId}/approve${viewQuery}`}
      class="approve-score-form"
      method="post"
    >
      <CsrfInput context={context} />
      <button
        class="approve-score"
        title={i18n.t("Approve the autograded score as final")}
        type="submit"
      >
        <span aria-hidden="true">✓</span> {i18n.t("Approve score")}
      </button>
    </form>
  );
};

const SubmissionReviewCard: FC<{
  readonly assignmentId: string;
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly entry: InstructorSubmissionReviewEntry;
  /**
   * How the student's live tries at this exercise stand, as rendered. Absent
   * on a reset attempt's card, which is not one of them and offers no grade.
   */
  readonly tries?: TriesAtExercise | undefined;
  readonly viewQuery: string;
}> = ({ assignmentId, context, courseId, entry, tries, viewQuery }) => {
  const i18n = useI18n();
  const submission = entry.submission;
  const state = reviewStateOf(entry);
  // A one-click approval only makes sense when there is an autograded score to
  // stand behind; a free-response awaiting its first grade has nothing to
  // approve, so it falls through to the manual form. Nor does it for a try
  // that does not count: approving it would record a grade for nothing. A
  // hand grade still can, since one above the counting try's makes it count.
  const canApprove =
    state === "needs-review" &&
    entry.evaluation?.evaluatorKind === "automatic";
  // Three independent facts on one meta line, not one sentence: each keeps its
  // own word order around the element that carries its value.
  const [exerciseIdBefore, exerciseIdAfter] = splitAtValue(
    i18n.t("Exercise {id}", { id: VALUE }),
  );
  const [submittedBefore, submittedAfter] = splitAtValue(
    i18n.t("Submitted {when}", { when: VALUE }),
  );
  // Drift is a warning about grades that count.
  const drift = entry.counts
    ? storedPointsDrift(entry.evaluation, entry.nominalPoints)
    : null;

  return (
    <Sheet className="submission-review-card">
      <header class="submission-review-header">
        <div>
          <h2>{userDisplayName(i18n, entry.user, submission.userId)}</h2>
          <p class="small">
            {userDisplayMeta(i18n, entry.user, submission.userId)}
          </p>
        </div>
        {/* The data attribute is for the review script, which re-derives the
            drift after grading in place: a fresh manual grade is stamped with
            the current points, so its rewrite clears the mark, while an
            approval copies the old figure and keeps it. */}
        <span
          class={
            drift === null
              ? "submission-review-status"
              : "submission-review-status points-drift"
          }
          data-nominal-points={entry.nominalPoints ?? ""}
        >
          {evaluationText(i18n, entry.evaluation)}
          {drift === null ? null : <PointsDriftNote drift={drift} />}
        </span>
      </header>
      <p class="submission-review-meta">
        {exerciseIdBefore}
        <code>{submission.exerciseId ?? i18n.t("not recorded")}</code>
        {exerciseIdAfter}
        {" · "}
        {submittedBefore}
        <Time value={submission.submittedAt} />
        {submittedAfter}
        {" · "}
        {/* Beside the state, so a reset card reads "Attempt 1 · Reset". */}
        {i18n.t("Attempt {ordinal}", { ordinal: entry.attemptOrdinal })}
        {" · "}
        <span
          class="review-state-label"
          data-review-state={state}
          data-submission-id={submission.id}
        >
          {reviewStateLabel(i18n, state)}
        </span>
      </p>
      {/* The question, behind a disclosure: a queue is many answers to the
          same few exercises, and the grader wrote them, so it is there to
          check rather than to read on every card. Compiled and sanitized at
          save time, as it is in the lesson. */}
      {entry.exercisePromptHtml === null ? null : (
        <details class="submission-review-prompt">
          <summary>{i18n.t("Prompt")}</summary>
          <div class="result-exercise-prompt">
            {raw(entry.exercisePromptHtml)}
          </div>
        </details>
      )}
      {entry.answerReview === null ? (
        <p class="small">{i18n.t("No answer review is available.")}</p>
      ) : (
        <AnswerReview review={entry.answerReview} />
      )}
      {/* A reset attempt's work counts toward nothing, and the server refuses
          a grade for it, so its card has no tries to stand among and offers
          no grade. */}
      {tries === undefined ? null : (
        // A grade from here can move which of the student's tries counts.
        // The reply names each try's new state; these say how the tries stood
        // before, so the script can keep the tab counts right — some of the
        // tries may be on other tabs.
        <div
          class="submission-review-footer"
          data-group-counting={tries.counting}
          data-group-needs={tries.needsReview}
          data-try-group={tries.key}
        >
          {/* Open where a grade is wanted, so the queue's real work takes no
              click; shut on a try that already has its grade, where opening
              it is the exception. */}
          <details class="manual-evaluation" open={state === "needs-review"}>
            <summary>{i18n.t("Add a manual evaluation")}</summary>
            <ManualEvaluationForm
              assignmentId={assignmentId}
              context={context}
              courseId={courseId}
              // The current declared points, preferred over the evaluation's
              // stored figure: `nominalPointsFor` will stamp the new grade with
              // the manifest's number, and the label must say the number the
              // grade will actually be out of.
              maxScore={
                entry.nominalPoints ?? entry.evaluation?.maxScore ?? null
              }
              submissionId={submission.id}
              viewQuery={viewQuery}
            />
          </details>
          {canApprove ? (
            <ApproveScoreForm
              assignmentId={assignmentId}
              context={context}
              courseId={courseId}
              submissionId={submission.id}
              viewQuery={viewQuery}
            />
          ) : null}
        </div>
      )}
    </Sheet>
  );
};

const ReviewFilterBar: FC<{
  readonly activeCount: number;
  readonly base: string;
  readonly needsReviewCount: number;
  readonly query: SubmissionReviewQuery;
  readonly total: number;
}> = ({ activeCount, base, needsReviewCount, query, total }) => {
  const i18n = useI18n();
  // The counts are live elements the review script rewrites, so each label is
  // split around its count rather than assembled from the word plus
  // punctuation.
  const [countBefore, countAfter] = splitAtValue(
    i18n.t("Needs review ({count})", { count: VALUE }),
  );
  const [activeBefore, activeAfter] = splitAtValue(
    i18n.t("Active ({count})", { count: VALUE }),
  );
  // Each tab keeps the exercise and student the grader narrowed to.
  const tab = (review: SubmissionReviewFilter) => ({
    href: `${base}${reviewQueryString({ ...query, review })}`,
    ...(query.review === review ? { "aria-current": "page" as const } : {}),
  });

  return (
    <nav
      aria-label={i18n.t("Filter submissions")}
      class="segmented review-filter"
      data-filter={query.review}
    >
      <a {...tab("needs-review")}>
        {countBefore}
        <span class="review-count-needs">{needsReviewCount}</span>
        {countAfter}
      </a>
      <a {...tab("active")}>
        {activeBefore}
        <span class="review-count-active">{activeCount}</span>
        {activeAfter}
      </a>
      <a {...tab("all")}>{i18n.t("All ({count})", { count: total })}</a>
    </nav>
  );
};

interface ReviewChoice {
  readonly label: string;
  readonly value: string;
}

/**
 * Narrow the queue to one exercise, one student, or both, behind a funnel at
 * the end of the tab row. A native disclosure, so it opens without script,
 * and a plain GET form: the result is a link a grader can keep, and changing
 * a select does not move the page under anyone — Apply does. It is open
 * whenever the queue is narrowed, so a narrowed queue never passes for the
 * whole of it. The tab rides along, so narrowing keeps the tab the grader is
 * on.
 */
const ReviewNarrowForm: FC<{
  readonly base: string;
  readonly exercises: readonly ReviewChoice[];
  readonly query: SubmissionReviewQuery;
  readonly students: readonly ReviewChoice[];
}> = ({ base, exercises, query, students }) => {
  const i18n = useI18n();
  const narrowed = query.exercise !== null || query.student !== null;
  const toggle = i18n.t("Filter by exercise or student");

  return (
    <details class="review-narrow" open={narrowed}>
      <summary class="icon-button review-narrow-toggle" title={toggle}>
        <FilterIcon />
        <span class="visually-hidden">{toggle}</span>
      </summary>
      <form action={base} method="get">
        {query.review === "needs-review" ? null : (
          <input name="review" type="hidden" value={query.review} />
        )}
        <label>
          {i18n.t("Exercise")}
          <select name="exercise">
            <option value="">{i18n.t("All exercises")}</option>
            {exercises.map((choice) => (
              <option
                selected={choice.value === query.exercise}
                value={choice.value}
              >
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {i18n.t("Student")}
          <select name="student">
            <option value="">{i18n.t("All students")}</option>
            {students.map((choice) => (
              <option
                selected={choice.value === query.student}
                value={choice.value}
              >
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <div class="review-narrow-actions">
          <button type="submit">{i18n.t("Apply")}</button>
          {/* Both selects back to "All", and applied: the same box as Apply,
              since it does the same kind of thing. */}
          {narrowed ? (
            <a
              class="button"
              href={`${base}${reviewQueryString({
                exercise: null,
                review: query.review,
                student: null,
              })}`}
            >
              {i18n.t("Clear (review filters)", undefined, {
                comment:
                  "Button on the review queue that sets the exercise and student filters back to all.",
                message: "Clear",
              })}
            </a>
          ) : null}
        </div>
      </form>
    </details>
  );
};

/**
 * One student's live tries at one exercise, as the page was drawn: how many
 * count, and how many of those wait for review. Grading any of them can move
 * both numbers.
 */
interface TriesAtExercise {
  readonly counting: number;
  /** The student and the exercise; the same on every card of the group. */
  readonly key: string;
  readonly needsReview: number;
}

function triesKey(entry: InstructorSubmissionReviewEntry): string {
  return `${entry.submission.userId} ${entry.submission.exerciseId ?? ""}`;
}

/** Each student's display name, by user id, worked out once for the queue. */
function studentNames(
  i18n: Translator,
  entries: readonly InstructorSubmissionReviewEntry[],
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();

  for (const entry of entries) {
    const id = entry.submission.userId;

    if (!names.has(id)) {
      names.set(id, userDisplayName(i18n, entry.user, id));
    }
  }

  return names;
}

/**
 * The queue in the order a grader works through it: exercise by exercise as
 * the lesson asks them, each exercise's answers by student name, and a
 * student's tries oldest first. An exercise the lesson no longer has follows
 * the ones it does, and work with no exercise recorded comes last.
 */
function reviewOrder(
  entries: readonly InstructorSubmissionReviewEntry[],
  exercises: readonly QueueExercise[],
  names: ReadonlyMap<string, string>,
  collator: Intl.Collator,
): InstructorSubmissionReviewEntry[] {
  const position = new Map(
    exercises.map((exercise, index) => [exercise.id, index]),
  );
  const exerciseRank = (entry: InstructorSubmissionReviewEntry) => {
    const id = entry.submission.exerciseId;

    return id === null
      ? exercises.length + 1
      : (position.get(id) ?? exercises.length);
  };
  const name = (entry: InstructorSubmissionReviewEntry) =>
    names.get(entry.submission.userId) ?? "";

  return [...entries].sort(
    (left, right) =>
      exerciseRank(left) - exerciseRank(right) ||
      (left.submission.exerciseId ?? "").localeCompare(
        right.submission.exerciseId ?? "",
      ) ||
      collator.compare(name(left), name(right)) ||
      // Two students of one name stay apart, each with their tries together.
      left.submission.userId.localeCompare(right.submission.userId) ||
      left.submission.submittedAt.localeCompare(
        right.submission.submittedAt,
      ) ||
      left.submission.id.localeCompare(right.submission.id),
  );
}

/**
 * The choices the narrowing form offers, drawn from the work on file: each
 * exercise in queue order, by its title where it has one, else its id; each
 * student by name, with their email or id beside it where two share one.
 */
function reviewChoices(
  i18n: Translator,
  ordered: readonly InstructorSubmissionReviewEntry[],
  exercises: readonly QueueExercise[],
  names: ReadonlyMap<string, string>,
  collator: Intl.Collator,
): {
  readonly exercises: readonly ReviewChoice[];
  readonly students: readonly ReviewChoice[];
} {
  const titles = new Map(
    exercises.map((exercise) => [exercise.id, exercise.title]),
  );
  const exerciseChoices = new Map<string, ReviewChoice>();
  const studentEntries = new Map<string, InstructorSubmissionReviewEntry>();

  for (const entry of ordered) {
    const id = entry.submission.exerciseId;

    if (id !== null && !exerciseChoices.has(id)) {
      exerciseChoices.set(id, { label: titles.get(id) ?? id, value: id });
    }

    if (!studentEntries.has(entry.submission.userId)) {
      studentEntries.set(entry.submission.userId, entry);
    }
  }

  const holders = new Map<string, number>();

  for (const name of names.values()) {
    holders.set(name, (holders.get(name) ?? 0) + 1);
  }

  // Sorted by name in their own right: a student who skipped the first
  // exercise first turns up later in the queue.
  const students = [...studentEntries.values()].map((entry) => ({
    entry,
    name: names.get(entry.submission.userId) ?? "",
  }));

  return {
    exercises: [...exerciseChoices.values()],
    students: students
      .sort(
        (left, right) =>
          collator.compare(left.name, right.name) ||
          left.entry.submission.userId.localeCompare(
            right.entry.submission.userId,
          ),
      )
      .map(({ entry, name }) => ({
        label:
          (holders.get(name) ?? 0) > 1
            ? i18n.t("{name} ({detail})", {
                detail: userDisplayMeta(
                  i18n,
                  entry.user,
                  entry.submission.userId,
                ),
                name,
              })
            : name,
        value: entry.submission.userId,
      })),
  };
}

const SubmissionsReview: FC<{
  readonly assignmentId: string;
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly entries: readonly InstructorSubmissionReviewEntry[];
  readonly exercises: readonly QueueExercise[];
  readonly query: SubmissionReviewQuery;
}> = ({
  assignmentId,
  context,
  courseId,
  entries,
  exercises,
  query: asked,
}) => {
  const i18n = useI18n();

  if (entries.length === 0) {
    return (
      <Sheet>
        <p>{i18n.t("No submissions have been recorded.")}</p>
      </Sheet>
    );
  }

  const names = studentNames(i18n, entries);
  const collator = new Intl.Collator(i18n.locale);
  const ordered = reviewOrder(entries, exercises, names, collator);
  const choices = reviewChoices(i18n, ordered, exercises, names, collator);
  // A choice the work on file does not offer — a stale link, a hand-edited
  // address — narrows nothing, as the form would show it.
  const query: SubmissionReviewQuery = {
    exercise: choices.exercises.some(
      (choice) => choice.value === asked.exercise,
    )
      ? asked.exercise
      : null,
    review: asked.review,
    student: choices.students.some((choice) => choice.value === asked.student)
      ? asked.student
      : null,
  };
  // Narrowing goes by student and by exercise, which is how tries group, so
  // every try in a group is in view or none is: the counts and the review
  // script's group arithmetic hold within the narrowed queue as without it.
  const narrowed = ordered.filter(
    (entry) =>
      (query.exercise === null ||
        entry.submission.exerciseId === query.exercise) &&
      (query.student === null || entry.submission.userId === query.student),
  );

  // Active is the work a grade is drawn from: for each student and exercise,
  // the try the score takes, and the latest while it waits for a grade. The
  // other tries, and a reset attempt's work, are on file under All. Needs
  // review is the part of Active still waiting for a grader.
  const active = narrowed.filter((entry) => entry.counts);
  const needsReview = active.filter(
    (entry) => reviewStateOf(entry) === "needs-review",
  );
  const waiting = new Set(needsReview);
  const tries = new Map<string, TriesAtExercise>();

  for (const entry of narrowed) {
    if (entry.attemptVoided) {
      continue;
    }

    const key = triesKey(entry);
    const group = tries.get(key) ?? { counting: 0, key, needsReview: 0 };

    tries.set(key, {
      counting: group.counting + (entry.counts ? 1 : 0),
      key,
      needsReview: group.needsReview + (waiting.has(entry) ? 1 : 0),
    });
  }

  const visible =
    query.review === "needs-review"
      ? needsReview
      : query.review === "active"
        ? active
        : narrowed;
  // Counted over every live entry, not the view: the banner announces a fact
  // about the assignment's grades, which does not come and go with the tabs
  // or the narrowing.
  const anyDrift = entries.some(
    (entry) =>
      entry.counts &&
      storedPointsDrift(entry.evaluation, entry.nominalPoints) !== null,
  );
  const base = `/courses/${courseId}/instructor/assignments/${assignmentId}/submissions`;
  const viewQuery = reviewQueryString(query);

  return (
    <>
      {anyDrift ? (
        <Notice tone="warn">
          {i18n.t(
            "Some scores here were graded when their exercises were worth different points. Each shows the points it was graded out of; the assignment total counts every exercise at its current points.",
          )}
        </Notice>
      ) : null}
      {/* One block, so the page's gap falls around the controls rather than
          between each of them, and around an empty status line besides. The
          narrowing panel opens under the tabs; its funnel sits at the end of
          their row. */}
      <div class="review-controls">
        <ReviewFilterBar
          activeCount={active.length}
          base={base}
          needsReviewCount={needsReview.length}
          query={query}
          total={narrowed.length}
        />
        <ReviewNarrowForm
          base={base}
          exercises={choices.exercises}
          query={query}
          students={choices.students}
        />
        <p class="small review-other-try" role="status" />
      </div>
      {visible.length === 0 ? (
        <Sheet>
          <p>
            {narrowed.length === 0
              ? i18n.t("No submissions match these choices.")
              : query.review === "needs-review"
                ? i18n.t("Every submission that counts has been reviewed.")
                : i18n.t(
                    "None of the recorded submissions counts toward a grade. They are listed under All.",
                  )}
          </p>
        </Sheet>
      ) : (
        <div class="submission-review-list">
          {visible.map((entry) => (
            <SubmissionReviewCard
              assignmentId={assignmentId}
              context={context}
              courseId={courseId}
              entry={entry}
              // A reset attempt's work is not among the student's tries.
              tries={
                entry.attemptVoided ? undefined : tries.get(triesKey(entry))
              }
              viewQuery={viewQuery}
            />
          ))}
        </div>
      )}
    </>
  );
};

/**
 * One row's Reset, which asks first: nothing in the interface undoes a void.
 * The dialog names whose attempt it is, since the button sits in a table row
 * among many alike. Without JS the form posts directly.
 */
const ResetAttemptForm: FC<{
  readonly action: string;
  readonly attempt: Attempt;
  readonly context: Context<AppBindings>;
  readonly studentName: string;
}> = ({ action, attempt, context, studentName }) => {
  const i18n = useI18n();
  const formId = `reset-attempt-${attempt.id}`;
  const dialogId = `confirm-${formId}`;

  return (
    <>
      <ModalDialog id={dialogId} title={i18n.t("Reset this attempt?")}>
        <form method="dialog">
          <p>
            {i18n.t(
              "Resetting attempt {ordinal} by {name} keeps their work on file, but it no longer counts toward a grade. They can then start a new attempt.",
              { name: studentName, ordinal: attempt.ordinal },
            )}
          </p>
          <div class="sheet-actions">
            <button class="danger" data-confirm-submit={formId} type="button">
              {i18n.t("Reset attempt")}
            </button>
            <button class="secondary" type="submit">
              {i18n.t("Cancel")}
            </button>
          </div>
        </form>
      </ModalDialog>
      <form
        action={action}
        data-confirm-dialog={dialogId}
        id={formId}
        method="post"
      >
        <CsrfInput context={context} />
        <button class="danger" type="submit">
          {i18n.t("Reset")}
        </button>
      </form>
    </>
  );
};

const AttemptsTable: FC<{
  readonly assignmentId: string;
  readonly attempts: readonly Attempt[];
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly directory: UserDirectory;
}> = ({ assignmentId, attempts, context, courseId, directory }) => {
  const i18n = useI18n();

  if (attempts.length === 0) {
    return <p>{i18n.t("No attempts have been opened.")}</p>;
  }

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("User")}</th>
          <th>{i18n.t("Attempt")}</th>
          <th>{i18n.t("Status")}</th>
          <th>{i18n.t("Opened")}</th>
          <th>{i18n.t("Expires")}</th>
          <th>{i18n.t("Voided")}</th>
          <th>{i18n.t("Reset")}</th>
        </tr>
      </thead>
      <tbody>
        {attempts.map((attempt) => (
          <tr>
            <td>
              <UserLabel
                directory={directory}
                identified={true}
                userId={attempt.userId}
              />
            </td>
            <td>{attempt.ordinal}</td>
            <td>{attemptStatusLabel(i18n, attempt.status)}</td>
            <td>
              <Time value={attempt.openedAt} />
            </td>
            <td>
              <Time value={attempt.expiresAt} />
            </td>
            <td>
              <Time value={attempt.voidedAt} />
              {attempt.voidedById === null ? null : (
                <>
                  <br />
                  <span class="small">
                    {i18n.t("Reset by {name}", {
                      name: userDisplayName(
                        i18n,
                        directory.get(attempt.voidedById) ?? null,
                        attempt.voidedById,
                      ),
                    })}
                  </span>
                </>
              )}
            </td>
            <td>
              {attempt.status === "voided" ? null : (
                <ResetAttemptForm
                  action={`/courses/${courseId}/instructor/assignments/${assignmentId}/attempts/${attempt.id}/reset`}
                  attempt={attempt}
                  context={context}
                  studentName={userDisplayName(
                    i18n,
                    directory.get(attempt.userId) ?? null,
                    attempt.userId,
                  )}
                />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};

export function renderNewAssignmentPage(
  context: Context<AppBindings>,
  courseId: string,
  courseTitle: string,
  revisions: readonly AssignmentRevisionOption[],
): Response {
  const i18n = context.get("i18n");
  const parent = courseCrumb(courseId, courseTitle);

  return renderShell(
    context,
    {
      breadcrumb: [coursesCrumb(i18n), parent],
      title: i18n.t("Create assignment"),
    },
    <AssignmentForm
      cancelHref={parent.href}
      context={context}
      courseId={courseId}
      description={i18n.t("Create a draft before publishing it to students.")}
      revisions={revisions}
      title={i18n.t("Assignment draft")}
    />,
  );
}

export function renderAssignmentFormError(
  context: Context<AppBindings>,
  options: {
    readonly action?: string;
    /** See {@link AssignmentForm}: the page the rejected form was opened from. */
    readonly cancelHref: string;
    readonly courseId: string;
    readonly courseTitle: string;
    readonly message: string;
    readonly mode?: "draft" | "published";
    readonly revisions: readonly AssignmentRevisionOption[];
    readonly status: PageStatus;
    readonly submitLabel?: string;
    readonly title: string;
    readonly values: AssignmentFormValues;
  },
): Response {
  return renderShell(
    context,
    {
      breadcrumb: [
        coursesCrumb(context.get("i18n")),
        courseCrumb(options.courseId, options.courseTitle),
      ],
      status: options.status,
      title: options.title,
    },
    <>
      <ErrorSummary>{options.message}</ErrorSummary>
      <AssignmentForm
        cancelHref={options.cancelHref}
        context={context}
        courseId={options.courseId}
        revisions={options.revisions}
        values={options.values}
        {...(options.action === undefined ? {} : { action: options.action })}
        {...(options.mode === undefined ? {} : { mode: options.mode })}
        {...(options.submitLabel === undefined
          ? {}
          : { submitLabel: options.submitLabel })}
      />
    </>,
  );
}

export function renderEditAssignmentPage(
  context: Context<AppBindings>,
  model: {
    readonly assignment: Assignment;
    readonly assignmentId: string;
    readonly courseId: string;
    readonly courseTitle: string;
    readonly revisions: readonly AssignmentRevisionOption[];
  },
): Response {
  const i18n = context.get("i18n");
  const published = model.assignment.state === "published";
  const base = editAssignmentAction(model.courseId, model.assignmentId);
  const parent = instructorAssignmentCrumb(
    model.courseId,
    model.assignmentId,
    model.assignment.title,
  );

  return renderShell(
    context,
    {
      breadcrumb: [
        coursesCrumb(i18n),
        courseCrumb(model.courseId, model.courseTitle),
        parent,
      ],
      title: published ? i18n.t("Edit settings") : i18n.t("Edit assignment"),
    },
    <AssignmentForm
      action={published ? `${base}/settings` : base}
      cancelHref={parent.href}
      context={context}
      courseId={model.courseId}
      description={
        published
          ? i18n.t(
              "Scheduling and presentation can be changed after publishing. Content and grading type stay fixed.",
            )
          : i18n.t("Only draft assignments can be changed in place.")
      }
      revisions={model.revisions}
      submitLabel={
        published ? i18n.t("Save settings") : i18n.t("Save assignment")
      }
      title={
        published ? i18n.t("Published settings") : i18n.t("Draft settings")
      }
      values={assignmentValues(model.assignment)}
      {...(published ? { mode: "published" as const } : {})}
    />,
  );
}

export function renderStudentAssignmentPage(
  context: Context<AppBindings>,
  model: {
    readonly activity: AttemptActivity;
    readonly assignmentId: string;
    readonly attempts: readonly Attempt[];
    readonly courseId: string;
    readonly courseTitle: string;
    readonly detail: AssignmentDetail;
    readonly notRecorded: boolean;
    readonly policy: EffectiveAssignmentPolicy;
    readonly showWorkView: boolean;
    /** The reader's staff tier, for the switch back; null for a student. */
    readonly staffTier: CourseStaffTier | null;
    readonly started: boolean;
    readonly submissionContext: InlineSubmissionContext | null;
    readonly submitted: boolean;
  },
): Response {
  const i18n = context.get("i18n");
  const { detail, showWorkView } = model;
  const isGraded = detail.assignment.assessmentMode === "graded";
  const showAttemptPanel = !showWorkView && isGraded;
  // Graded content is withheld by the service until an attempt is active (so
  // students can't preview the questions before committing); only render the
  // content sheet when it is actually released.
  const showContent = !isGraded || showWorkView;
  const studentBase = `/courses/${model.courseId}/assignments/${model.assignmentId}`;
  const studentContentUrl = `${studentBase}/content`;
  const staffBase = `/courses/${model.courseId}/instructor/assignments/${model.assignmentId}`;

  return renderShell(
    context,
    {
      breadcrumb: [
        coursesCrumb(i18n),
        courseCrumb(model.courseId, model.courseTitle),
      ],
      // The way back to the staff side, for a staff member trying the
      // assignment: the record page for an instructor, the review queue for
      // an assistant — each tier's own page for this assignment.
      headerAside:
        model.staffTier === null ? null : (
          <CourseViewSwitch
            current="student"
            staffHref={
              model.staffTier === "instructor"
                ? staffBase
                : `${staffBase}/submissions`
            }
            studentHref={studentBase}
          />
        ),
      title: detail.assignment.title,
    },
    <>
      {model.submitted ? (
        <Notice>{i18n.t("Answer submitted.")}</Notice>
      ) : null}
      {model.notRecorded ? (
        // The same sentence the runtime's status line uses, borrowed rather
        // than reworded: this is the no-JS POST-redirect telling a reader the
        // identical thing on the identical page, and as two catalog entries the
        // two had already drifted into differently-worded German.
        <Notice>{exerciseUiStrings(i18n).notRecorded}</Notice>
      ) : null}
      {model.started ? <Notice>{i18n.t("Attempt started.")}</Notice> : null}
      {showContent ? (
        <ContentFrame
          fullscreenHref={studentContentUrl}
          src={studentContentUrl}
          title={i18n.t("{title} content", {
            title: detail.assignment.title,
          })}
        />
      ) : null}
      {showAttemptPanel ? (
        <AttemptBriefing
          action={`/courses/${model.courseId}/assignments/${model.assignmentId}/attempts`}
          activity={model.activity}
          assignment={detail.assignment}
          attempts={model.attempts}
          context={context}
          policy={model.policy}
          title={i18n.t("Before you start")}
        />
      ) : null}
    </>,
  );
}

/**
 * The instructor's grade-release button(s) for a published graded assignment,
 * for the Assignment record footer. The label carries the current state:
 * releasing sets `gradesVisibleAt` to now (one click, no timestamp to type),
 * hiding clears it, and a future `gradesVisibleAt` (set while drafting) offers
 * both "Release now" and "Hide grades".
 *
 * Releasing does more than publish a number: it is also the moment an
 * assignment stops being an exam. Exercises that said nothing switch from
 * keeping every submission and saying nothing to retry-until-correct with the
 * reasons shown, so a student who has not finished yet gets an easier run at it
 * than the ones who sat it. That is a legitimate thing to want — late work
 * earns reduced credit under the late policy — so the page says it rather than
 * refusing, and only while there is still a window for anyone to work in.
 */
const GradeReleaseButtons: FC<{
  readonly assignment: Assignment;
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly now: Timestamp;
}> = ({ assignment, context, courseId, now }) => {
  const i18n = useI18n();
  const action = `/courses/${courseId}/instructor/assignments/${assignment.id}/grade-visibility`;
  const form = (intent: "release" | "hide", label: string) => (
    <form action={action} method="post">
      <CsrfInput context={context} />
      <input name="intent" type="hidden" value={intent} />
      <button type="submit">{label}</button>
    </form>
  );
  const openWarning =
    assignmentAvailability(assignment, now) === "closed" ? null : (
      <Notice tone="warn">
        {i18n.t(
          "Submissions are still open. Releasing grades now lets students keep working with feedback the others did not have.",
        )}
      </Notice>
    );

  if (assignment.gradesVisibleAt === null) {
    return (
      <>
        {openWarning}
        {form("release", i18n.t("Release grades"))}
      </>
    );
  }

  if (gradesReleased(assignment, now)) {
    return form("hide", i18n.t("Hide grades"));
  }

  return (
    <>
      {openWarning}
      {form("release", i18n.t("Release now"))}
      {form("hide", i18n.t("Hide grades"))}
    </>
  );
};

/** The dialog the Unpublish button opens while live attempts block it. */
const UNPUBLISH_DIALOG_ID = "confirm-unpublish";

export function renderInstructorAssignmentPage(
  context: Context<AppBindings>,
  model: {
    /** Whether any attempt exists, voided ones included. */
    readonly attemptsExist: boolean;
    readonly courseId: string;
    readonly courseTitle: string;
    readonly detail: AssignmentDetail;
    readonly directory: UserDirectory;
    /** Whether any student's score already sums recorded evaluations. */
    readonly gradedWorkExists: boolean;
    readonly latePolicy: AssignmentLatePolicy | null;
    readonly notices: readonly string[];
    /** The request's clock — what the release controls read the window and
     *  the release date against, so the view keeps none of its own. */
    readonly now: Timestamp;
    /** The theories its revision was built on that have changed since. */
    readonly outdatedTheories: readonly OutdatedTheory[];
    readonly overrides: ReadonlyMap<string, AssignmentOverride>;
    readonly revisions: readonly AssignmentRevisionOption[];
    readonly students: readonly CourseMembership[];
    /** Students an unpublish would reset; see `AssignmentCorrections`. */
    readonly studentsWithLiveAttempts: number;
    readonly syncsToLms: boolean;
  },
): Response {
  const i18n = context.get("i18n");
  const { courseId, detail } = model;
  const assignment = detail.assignment;
  const isDraft = assignment.state === "draft";
  const isPublishedGraded =
    assignment.state === "published" &&
    assignment.assessmentMode === "graded";

  const gradingBase = `/courses/${courseId}/instructor/assignments/${assignment.id}`;
  // Live attempts block an unpublish, so the button asks instead of posting:
  // the dialog's form is the one that resets them all on the way. Without JS
  // the plain form posts and is refused with the reason, as before.
  const unpublishDialog =
    model.studentsWithLiveAttempts > 0 ? (
      <ModalDialog
        id={UNPUBLISH_DIALOG_ID}
        title={i18n.t("Reset all attempts and unpublish?")}
      >
        <form action={`${gradingBase}/unpublish`} method="post">
          <CsrfInput context={context} />
          <input name="resetAttempts" type="hidden" value="1" />
          <p>
            {i18n.t(
              "{count, plural, one {# student has an attempt on this assignment.} other {# students have attempts on this assignment.}} Unpublishing resets them all: their work stays on file but no longer counts toward a grade.",
              { count: model.studentsWithLiveAttempts },
            )}
          </p>
          {model.syncsToLms ? (
            <p>
              {i18n.t(
                "Scores already sent to the LMS are corrected to zero.",
              )}
            </p>
          ) : null}
          <div class="sheet-actions">
            <button class="danger" type="submit">
              {i18n.t("Reset all attempts and unpublish")}
            </button>
            <button class="secondary" formmethod="dialog" type="submit">
              {i18n.t("Cancel")}
            </button>
          </div>
        </form>
      </ModalDialog>
    ) : null;

  // Editing, publishing, and grade release live in the Assignment record
  // footer: an "Edit" link plus, for a draft, the publish action, and for a
  // published assignment, the grade-release button (when graded) alongside an
  // Unpublish control that returns it to draft (server-blocked while an
  // attempt that is not voided exists).
  const recordFooter = (
    <>
      {unpublishDialog}
      <div class="sheet-actions">
        <a class="button" href={`${gradingBase}/edit`}>
          {isDraft ? i18n.t("Edit assignment") : i18n.t("Edit settings")}
        </a>
        {isDraft ? (
          <>
            <form action={`${gradingBase}/publish`} method="post">
              <CsrfInput context={context} />
              <button type="submit">{i18n.t("Publish assignment")}</button>
            </form>
            <form action={`${gradingBase}/delete`} method="post">
              <CsrfInput context={context} />
              <button class="danger" type="submit">
                {i18n.t("Delete draft")}
              </button>
            </form>
          </>
        ) : (
          <>
            {isPublishedGraded ? (
              <GradeReleaseButtons
                assignment={assignment}
                context={context}
                courseId={courseId}
                now={model.now}
              />
            ) : null}
            <form
              action={`${gradingBase}/unpublish`}
              data-confirm-dialog={
                model.studentsWithLiveAttempts > 0
                  ? UNPUBLISH_DIALOG_ID
                  : undefined
              }
              method="post"
            >
              <CsrfInput context={context} />
              <button class="secondary" type="submit">
                {i18n.t("Unpublish")}
              </button>
            </form>
          </>
        )}
      </div>
    </>
  );

  // Overrides and the late policy are settings, not results: they are rows
  // keyed by assignment, nothing about them depends on students being able to
  // see the assignment, and the server has only ever required `graded` for
  // either one. So the sheet follows the server and appears for a draft too —
  // setting a due-date exception or a late penalty before an assignment goes
  // live is the natural order to work in, not something to be made to wait for.
  //
  // Grade export and submission review live on the gradebook page itself, so the
  // strip here carries only the two destinations that don't: the gradebook and
  // the attempt ledger. Those two are about student work. A draft usually has
  // none, but one unpublished with a reset keeps its voided attempts, and the
  // ledger is where they are on record; the gradebook, which counts none of
  // them, waits for publication. The strip sits at the foot of the body —
  // divided from the roster by a ruled line with breathing room — rather than
  // flush under the header, for a softer "lines on paper" feel.
  const workLinks = [
    ...(isPublishedGraded
      ? [
          {
            hint: i18n.t("Scores, export, and submission review"),
            href: `${gradingBase}/gradebook`,
            label: i18n.t("Grades"),
          },
        ]
      : []),
    ...(isPublishedGraded || model.attemptsExist
      ? [
          {
            hint: i18n.t("Inspect and reset student attempts"),
            href: `${gradingBase}/attempts`,
            label: i18n.t("Attempts"),
          },
        ]
      : []),
  ];
  const policyControls =
    assignment.assessmentMode === "graded" ? (
      <Sheet
        description={i18n.t(
          "Per-student overrides and the late policy for this assignment.",
        )}
        footer={
          <LatePolicyForm
            assignmentId={assignment.id}
            context={context}
            courseId={courseId}
            policy={model.latePolicy}
          />
        }
        title={i18n.t("Policy and grading controls")}
      >
        <OverrideRoster
          assignmentId={assignment.id}
          context={context}
          courseId={courseId}
          directory={model.directory}
          overrides={model.overrides}
          students={model.students}
        />
        {workLinks.length > 0 ? <LinkStrip links={workLinks} /> : null}
      </Sheet>
    ) : null;
  // A practice set records points too, but has no policy sheet to hang its
  // gradebook link from: overrides, late penalties, and the attempt ledger all
  // belong to work with a deadline and a limited number of tries, and practice
  // has neither. The one destination it does have gets a sheet of its own,
  // rather than being reachable only by typing the URL.
  const practiceResults =
    assignment.state === "published" &&
    assignment.assessmentMode === "practice" ? (
      <Sheet
        description={i18n.t(
          "Practice scores are recorded, and do not count toward the course total.",
        )}
        title={i18n.t("Practice results")}
      >
        <LinkStrip
          links={[
            {
              hint: i18n.t("Scores, export, and submission review"),
              href: `${gradingBase}/gradebook`,
              label: i18n.t("Scores"),
            },
          ]}
        />
      </Sheet>
    ) : null;
  const correctionControls =
    assignment.state === "published" ? (
      <Sheet
        description={i18n.t(
          "Content updates and excused exercises for this assignment.",
        )}
        footer={
          <CorrectionForms
            context={context}
            courseId={courseId}
            detail={detail}
            gradedWorkExists={model.gradedWorkExists}
            revisions={model.revisions}
          />
        }
        title={i18n.t("Published assignment corrections")}
      >
        <CorrectionsLedger detail={detail} />
      </Sheet>
    ) : null;

  const recordProps = {
    footer: recordFooter,
    summary: (
      <SummaryStrip items={assignmentSummaryItems(i18n, assignment)} />
    ),
    title: i18n.t("Assignment record"),
    ...(assignment.description.trim().length === 0
      ? {}
      : { description: assignment.description }),
  };

  return renderShell(
    context,
    {
      breadcrumb: [
        coursesCrumb(i18n),
        courseCrumb(courseId, model.courseTitle),
      ],
      // A draft has no student side yet — the student page answers 404 until
      // it is published — so the switch waits for one.
      headerAside: isDraft ? null : (
        <CourseViewSwitch
          current="staff"
          staffHref={gradingBase}
          studentHref={`/courses/${courseId}/assignments/${assignment.id}`}
        />
      ),
      title: assignment.title,
    },
    <>
      {model.notices.map((message) => (
        <Notice>{message}</Notice>
      ))}
      {model.outdatedTheories.map((theory) => (
        <Notice tone="warn">
          {outdatedTheoryText(i18n, theory, "assignment")}
        </Notice>
      ))}
      <ContentSplit
        content={
          detail.artifactDefect === undefined ? (
            <ContentFrame
              fullscreenHref={`${gradingBase}/content`}
              src={`${gradingBase}/content`}
              title={i18n.t("{title} content", { title: assignment.title })}
            />
          ) : (
            <UnreadableContent
              contentItemId={detail.contentItem.id}
              defect={detail.artifactDefect}
              revisionId={detail.contentRevision.id}
            />
          )
        }
        rail={
          <>
            <Sheet {...recordProps} />
            {policyControls}
            {practiceResults}
            {correctionControls}
          </>
        }
      />
    </>,
  );
}

export function renderInstructorSubmissions(
  context: Context<AppBindings>,
  model: {
    readonly approved: boolean;
    readonly assignmentId: string;
    readonly assignmentTitle: string;
    readonly courseId: string;
    readonly courseTitle: string;
    readonly entries: readonly InstructorSubmissionReviewEntry[];
    readonly exercises: readonly QueueExercise[];
    readonly manualEvaluation: boolean;
    readonly query: SubmissionReviewQuery;
    readonly staffTier: CourseStaffTier;
  },
): Response {
  const i18n = context.get("i18n");
  const base = `/courses/${model.courseId}`;

  return renderShell(
    context,
    {
      breadcrumb: [
        coursesCrumb(i18n),
        courseCrumb(model.courseId, model.courseTitle),
        staffAssignmentCrumb(
          model.staffTier,
          model.courseId,
          model.assignmentId,
          model.assignmentTitle,
          { onReviewPage: true },
        ),
      ],
      // For an assistant only. The switch is a round trip — the student
      // page's staff half returns to the page a tier calls the assignment's
      // own, and for an assistant that is this one. An instructor's is the
      // record page, which carries the switch; a second one here would go
      // across and come back somewhere else. The staff half is this page:
      // pressed, and a link to itself, as the review filter's halves are.
      headerAside:
        model.staffTier === "assistant" ? (
          <CourseViewSwitch
            current="staff"
            staffHref={`${base}/instructor/assignments/${model.assignmentId}/submissions`}
            studentHref={`${base}/assignments/${model.assignmentId}`}
          />
        ) : null,
      title: i18n.t("Review submissions"),
    },
    <>
      {model.manualEvaluation ? (
        <Notice>{i18n.t("Manual evaluation added.")}</Notice>
      ) : null}
      {model.approved ? (
        <Notice>{i18n.t("Autograded score approved.")}</Notice>
      ) : null}
      <SubmissionsReview
        assignmentId={model.assignmentId}
        context={context}
        courseId={model.courseId}
        entries={model.entries}
        exercises={model.exercises}
        query={model.query}
      />
      {/* Must precede the script, which reads it. */}
      {raw(
        uiStringsScript(REVIEW_UI_STRINGS_ATTRIBUTE, reviewUiStrings(i18n)),
      )}
      <script defer src={REVIEW_SCRIPT_ASSET.href} />
    </>,
  );
}

export function renderInstructorAttempts(
  context: Context<AppBindings>,
  model: {
    readonly assignmentId: string;
    readonly assignmentTitle: string;
    readonly attemptReset: boolean;
    readonly attempts: readonly Attempt[];
    readonly courseId: string;
    readonly courseTitle: string;
    readonly directory: UserDirectory;
    readonly staffTier: CourseStaffTier;
  },
): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    {
      breadcrumb: [
        coursesCrumb(i18n),
        courseCrumb(model.courseId, model.courseTitle),
        staffAssignmentCrumb(
          model.staffTier,
          model.courseId,
          model.assignmentId,
          model.assignmentTitle,
        ),
      ],
      title: i18n.t("Review attempts"),
    },
    <>
      {model.attemptReset ? (
        <Notice>
          {i18n.t(
            "Attempt reset. The student can start a new attempt, and the old one remains in the audit trail.",
          )}
        </Notice>
      ) : null}
      <Sheet title={i18n.t("Attempt ledger")}>
        <AttemptsTable
          assignmentId={model.assignmentId}
          attempts={model.attempts}
          context={context}
          courseId={model.courseId}
          directory={model.directory}
        />
      </Sheet>
    </>,
  );
}
