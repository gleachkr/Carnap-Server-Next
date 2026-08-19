import type { PlatformCapability } from "../domain/admin";
import type { AttemptStatus, EvaluatorKind } from "../domain/assessment";
import type {
  AssessmentMode,
  AssignmentState,
  GradesVisibility,
} from "../domain/assignments";
import type { CourseRole, MembershipStatus } from "../domain/courses";
import type { ExternalIdentityProvider } from "../domain/users";
import type { Translator } from "../i18n/translator";

/**
 * Prose for the domain enums that more than one page renders.
 *
 * These used to be spelled out at each use site — four copies of the
 * assessment-mode names, two of Published/Draft, two lists of the course roles —
 * and several places rendered the raw enum value (`graded`, `lti`, `site_admin`)
 * straight into the page. Translating that per file would have multiplied the
 * inconsistency by every locale, so the words live here once.
 *
 * An enum may legitimately be worded twice, in two registers: a badge beside the
 * thing it describes can say "Graded", while a `<select>` an author reads cold
 * needs "Graded assignment". Both wordings still belong here, derived from the
 * same member list, so neither can go missing.
 *
 * A `switch` rather than a record so a new enum member is a type error at the
 * one place that has to answer for it — and every picker is built by mapping an
 * order tuple over such a `switch`, never by hand-writing `<option>`s, so the
 * error is raised for the pickers too.
 */
export function assignmentStateLabel(
  i18n: Translator,
  state: AssignmentState,
): string {
  switch (state) {
    case "draft":
      return i18n.t("Draft");
    case "published":
      return i18n.t("Published");
  }
}

/** Student-facing names for the assessment modes (the assignment "type"). */
export function assessmentModeLabel(
  i18n: Translator,
  mode: AssessmentMode,
): string {
  switch (mode) {
    case "graded":
      return i18n.t("Graded");
    case "none":
      return i18n.t("Reading");
    case "practice":
      return i18n.t("Practice");
  }
}

/**
 * The same modes as an author picking one sees them: a whole noun phrase rather
 * than {@link assessmentModeLabel}'s one word, because a `<select>` option has
 * no assignment beside it to make "Reading" mean anything.
 */
function assessmentModeOptionLabel(
  i18n: Translator,
  mode: AssessmentMode,
): string {
  switch (mode) {
    case "graded":
      return i18n.t("Graded assignment");
    case "none":
      return i18n.t("Reading / resource");
    case "practice":
      return i18n.t("Practice activity");
  }
}

/**
 * The three ways of answering "when do students see their grades?", worded for
 * the author choosing between them.
 *
 * They are phrased as answers to that question rather than as settings, because
 * the thing they replaced — one optional timestamp — left the common case
 * (weekly homework, students should see how they did) looking like the field an
 * instructor could safely skip. Blank meant "never, until I come back", which no
 * label said out loud.
 */
function gradesVisibilityLabel(
  i18n: Translator,
  visibility: GradesVisibility,
): string {
  switch (visibility) {
    case "immediate":
      return i18n.t("As soon as work is checked");
    case "manual":
      return i18n.t("When I release them");
    case "scheduled":
      return i18n.t("At the time below");
  }
}

export function courseRoleLabel(i18n: Translator, role: CourseRole): string {
  switch (role) {
    case "co_instructor":
      return i18n.t("Co-instructor");
    case "instructor":
      return i18n.t("Instructor");
    case "student":
      return i18n.t("Student");
    case "teacher_assistant":
      return i18n.t("Teaching assistant");
  }
}

export function membershipStatusLabel(
  i18n: Translator,
  status: MembershipStatus,
): string {
  switch (status) {
    case "active":
      return i18n.t("Active");
    case "dropped":
      return i18n.t("Dropped");
    case "invited":
      return i18n.t("Invited");
    case "suspended":
      return i18n.t("Suspended");
  }
}

export function attemptStatusLabel(
  i18n: Translator,
  status: AttemptStatus,
): string {
  switch (status) {
    case "active":
      return i18n.t(
        "Active (attempt)",
        {},
        {
          comment:
            "Disambiguating id; only the word Active is shown. An attempt still in progress.",
          message: "Active",
        },
      );
    case "expired":
      return i18n.t("Expired");
    case "submitted":
      return i18n.t("Submitted");
    case "voided":
      return i18n.t("Voided");
  }
}

/** Who produced a score: the autograder, or a person. */
export function evaluatorKindLabel(
  i18n: Translator,
  kind: EvaluatorKind,
): string {
  switch (kind) {
    case "automatic":
      return i18n.t("automatic", undefined, {
        comment:
          "Lowercase, mid-line: the tail of a line like 12/15 · automatic. The score came from the autograder.",
      });
    case "manual":
      return i18n.t("manual", undefined, {
        comment:
          "Lowercase, mid-line: the tail of a line like 12/15 · manual. A person set the score.",
      });
  }
}

/**
 * A submission's review state as a value rather than a word.
 *
 * Not a domain enum but a view of one — how the assignment page's review queue
 * classifies an `Evaluation`. It is here rather than beside the queue because
 * the queue's enhancement script needs the same words: that script counts the
 * cards still awaiting review and drops the ones that no longer are, and it used
 * to do so by comparing a card's rendered label against the literal "Needs
 * review" — which works only while the page is in English, and fails silently in
 * every other language, freezing the count and stranding reviewed cards. The
 * state travels in a `data-review-state` attribute instead, and both sides look
 * the prose up from it here.
 */
export type ReviewState = "auto-graded" | "needs-review" | "reviewed";

export function reviewStateLabel(
  i18n: Translator,
  state: ReviewState,
): string {
  switch (state) {
    case "auto-graded":
      return i18n.t("Auto-graded");
    case "needs-review":
      return i18n.t("Needs review");
    case "reviewed":
      return i18n.t("Reviewed");
  }
}

export function capabilityLabel(
  i18n: Translator,
  capability: PlatformCapability,
): string {
  switch (capability) {
    case "content_author":
      return i18n.t("Content author");
    case "course_creator":
      return i18n.t("Course creator");
    case "site_admin":
      return i18n.t("Site administrator");
    case "support_operator":
      return i18n.t("Support operator");
  }
}

export function identityProviderLabel(
  i18n: Translator,
  provider: ExternalIdentityProvider,
): string {
  switch (provider) {
    case "native":
      return i18n.t("Email");
    case "lti":
      return i18n.t("LMS (LTI)");
  }
}

/**
 * The order the modes, roles and statuses appear in a `<select>`: the default
 * mode first, then least to most privileged, then active to inactive. Kept next
 * to the labels so a new member of any of these enums shows up in the pickers
 * without a second edit.
 */
export const ASSESSMENT_MODE_ORDER: readonly AssessmentMode[] = [
  "graded",
  "practice",
  "none",
];

/** Live work before drafts, on the same "most current first" principle. */
export const ASSIGNMENT_STATE_ORDER: readonly AssignmentState[] = [
  "published",
  "draft",
];

export const GRADES_VISIBILITY_ORDER: readonly GradesVisibility[] = [
  "immediate",
  "manual",
  "scheduled",
];

export const COURSE_ROLE_ORDER: readonly CourseRole[] = [
  "student",
  "teacher_assistant",
  "co_instructor",
  "instructor",
];

export const MEMBERSHIP_STATUS_ORDER: readonly MembershipStatus[] = [
  "active",
  "invited",
  "suspended",
  "dropped",
];

export interface SelectOption {
  readonly label: string;
  readonly value: string;
}

export function assessmentModeOptions(
  i18n: Translator,
): readonly SelectOption[] {
  return ASSESSMENT_MODE_ORDER.map((mode) => ({
    label: assessmentModeOptionLabel(i18n, mode),
    value: mode,
  }));
}

export function gradesVisibilityOptions(
  i18n: Translator,
): readonly SelectOption[] {
  return GRADES_VISIBILITY_ORDER.map((visibility) => ({
    label: gradesVisibilityLabel(i18n, visibility),
    value: visibility,
  }));
}

export function courseRoleOptions(i18n: Translator): readonly SelectOption[] {
  return COURSE_ROLE_ORDER.map((role) => ({
    label: courseRoleLabel(i18n, role),
    value: role,
  }));
}

export function membershipStatusOptions(
  i18n: Translator,
): readonly SelectOption[] {
  return MEMBERSHIP_STATUS_ORDER.map((status) => ({
    label: membershipStatusLabel(i18n, status),
    value: status,
  }));
}
