import type { Context } from "hono";
import type { FC } from "hono/jsx";

import type { GradeSyncFailure } from "../application/grade-passback";
import type { StudentScorecardEntry } from "../application/gradebook";
import type { Assignment } from "../domain/assignments";
import type {
  Course,
  CourseAccommodation,
  CourseEnrollmentLink,
  CourseMembership,
} from "../domain/courses";
import type { LtiGradeFailureReason, LtiResourceLink } from "../domain/lti";
import type { Timestamp } from "../domain/time";
import type { AppBindings } from "../http";
import type { Translator } from "../i18n/translator";
import { AssignmentCreateBar, AssignmentsTable } from "./assignments";
import { coursesCrumb } from "./breadcrumbs";
import {
  BrowserTimezoneInput,
  ContentSplit,
  CopyField,
  CreateBar,
  CsrfInput,
  ErrorSummary,
  LinkStrip,
  Notice,
  Sheet,
  StatusBadge,
  SummaryStrip,
  TableScroll,
  Time,
  TimestampInput,
} from "./components";
import { AccessibilityIcon, CrownIcon, SettingsIcon } from "./icons";
import {
  COURSE_ROLE_ORDER,
  courseRoleLabel,
  membershipStatusLabel,
  membershipStatusOptions,
} from "./labels";
import { renderShell, useI18n } from "./layout";
import { type UserDirectory, UserLabel, userDisplayName } from "./users";

const DEFAULT_TIMEZONE = "UTC";
const FALLBACK_TIMEZONES = [
  "UTC",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/New_York",
  "America/Phoenix",
  "America/Sao_Paulo",
  "America/Toronto",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jerusalem",
  "Asia/Kolkata",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Melbourne",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
] as const;

interface IntlWithSupportedValues {
  supportedValuesOf?: (key: "timeZone") => string[];
}

function supportedTimezones(): readonly string[] {
  const intl = Intl as IntlWithSupportedValues;
  const timezones = intl.supportedValuesOf?.("timeZone") ?? [];

  if (timezones.length === 0) {
    return FALLBACK_TIMEZONES;
  }

  return timezones.includes(DEFAULT_TIMEZONE)
    ? timezones
    : [DEFAULT_TIMEZONE, ...timezones];
}

const MEMBERSHIP_STATUS_TONES: Record<
  CourseMembership["status"],
  "danger" | "neutral" | "ok" | "warn"
> = {
  active: "ok",
  dropped: "neutral",
  invited: "warn",
  suspended: "danger",
};

const MembershipStatusBadge: FC<{
  readonly status: CourseMembership["status"];
}> = ({ status }) => {
  const i18n = useI18n();

  return (
    <StatusBadge
      label={membershipStatusLabel(i18n, status)}
      tone={MEMBERSHIP_STATUS_TONES[status]}
    />
  );
};

const TimezoneSelect: FC<{
  readonly form?: string;
  readonly id: string;
  readonly selected?: string;
}> = ({ form, id, selected }) => {
  const i18n = useI18n();
  const normalized =
    selected === undefined || selected.length === 0
      ? DEFAULT_TIMEZONE
      : selected;
  const timezones = supportedTimezones();
  const options = timezones.includes(normalized)
    ? timezones
    : [normalized, ...timezones];

  return (
    <select
      aria-label={i18n.t("Timezone")}
      id={id}
      {...(form === undefined ? {} : { form })}
      name="timezone"
    >
      {options.map((timezone) => (
        <option selected={timezone === normalized} value={timezone}>
          {timezone}
        </option>
      ))}
    </select>
  );
};

export const CreateCourseForm: FC<{
  readonly context: Context<AppBindings>;
  readonly title?: string;
}> = ({ context, title }) => {
  const i18n = useI18n();

  return (
    <form action="/courses" method="post">
      <CsrfInput context={context} />
      <label>
        {i18n.t("Title")}
        <br />
        <input name="title" required value={title ?? ""} />
      </label>
      <BrowserTimezoneInput name="timezone" />
      <button type="submit">{i18n.t("Create course")}</button>
    </form>
  );
};

const CourseRow: FC<{
  readonly entry: {
    readonly course: Course;
    readonly membership: CourseMembership;
  };
}> = ({ entry }) => {
  const i18n = useI18n();

  return (
    <tr>
      <td>
        <a href={`/courses/${entry.course.id}`}>{entry.course.title}</a>
      </td>
      <td>{entry.course.timezone}</td>
      <td>{courseRoleLabel(i18n, entry.membership.role)}</td>
      <td>
        <MembershipStatusBadge status={entry.membership.status} />
      </td>
    </tr>
  );
};

const CoursesCreateBar: FC<{ readonly context: Context<AppBindings> }> = ({
  context,
}) => {
  const i18n = useI18n();

  return (
    <CreateBar
      action="/courses"
      context={context}
      submitLabel={i18n.t("Create course")}
    >
      <input
        aria-label={i18n.t("Course title")}
        name="title"
        placeholder={i18n.t("Title of new course")}
        required
      />
      {/* Not a picker: the browser knows the reader's zone, and the course
          record's form is where the rare disagreement gets settled. */}
      <BrowserTimezoneInput name="timezone" />
    </CreateBar>
  );
};

const CoursesTable: FC<{
  readonly canCreate: boolean;
  readonly courses: readonly {
    readonly course: Course;
    readonly membership: CourseMembership;
  }[];
  /** Whether the drawer below holds anything, which changes what empty means. */
  readonly hasArchived: boolean;
}> = ({ canCreate, courses, hasArchived }) => {
  const i18n = useI18n();

  if (courses.length === 0) {
    // Four whole sentences rather than one with a clause spliced in: "you have
    // none" and "the ones you have are all archived" are different facts, and
    // a reader whose every course sits in the drawer below must not be told
    // they have no courses — the sheet above has just promised them their
    // historical memberships.
    if (canCreate) {
      return (
        <p class="small">
          {hasArchived
            ? i18n.t("All of your courses are archived.")
            : i18n.t("You have not created any courses yet.")}
        </p>
      );
    }

    return (
      <p>
        {hasArchived
          ? i18n.t("Every course you are enrolled in has been archived.")
          : i18n.t("You are not enrolled in any courses yet.")}
      </p>
    );
  }

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("Course")}</th>
          <th>{i18n.t("Timezone")}</th>
          <th>{i18n.t("Role")}</th>
          {/* Whose status: the reader's membership, not the course's. Under a
              bare "Status" an instructor who had just archived a course read
              the neighbouring rows' "Active" as the courses' own state and
              concluded that archiving had done nothing. */}
          <th>{i18n.t("Your status")}</th>
        </tr>
      </thead>
      <tbody>
        {courses.map((entry) => (
          <CourseRow entry={entry} />
        ))}
      </tbody>
    </TableScroll>
  );
};

const AccommodationDialog: FC<{
  readonly accommodation: CourseAccommodation | null;
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly dialogId: string;
  readonly directory: UserDirectory;
  readonly membership: CourseMembership;
}> = ({
  accommodation,
  context,
  courseId,
  dialogId,
  directory,
  membership,
}) => {
  const i18n = useI18n();
  const description =
    accommodation === null
      ? i18n.t("No accommodation is recorded for this member.")
      : i18n.t("These values are currently recorded for this member.");

  return (
    <dialog class="modal-dialog" id={dialogId}>
      <form action={`/courses/${courseId}/accommodations`} method="post">
        <CsrfInput context={context} />
        <header class="modal-dialog-header">
          <h3>
            {i18n.t("Accommodations for {name}", {
              name: userDisplayName(
                i18n,
                directory.get(membership.userId) ?? null,
                membership.userId,
              ),
            })}
          </h3>
          <button
            aria-label={i18n.t("Close")}
            formmethod="dialog"
            formnovalidate
            type="submit"
          >
            ×
          </button>
        </header>
        <p class="small">{description}</p>
        <input name="userId" type="hidden" value={membership.userId} />
        <fieldset class="input-group">
          <legend>{i18n.t("Accommodation limits")}</legend>
          <label>
            {i18n.t("Due extension minutes")}
            <br />
            <input
              min="0"
              name="dueAtExtensionMinutes"
              type="number"
              value={accommodation?.dueAtExtensionMinutes ?? 0}
            />
          </label>
          <label>
            {i18n.t("Available-until extension minutes")}
            <br />
            <input
              min="0"
              name="availableUntilExtensionMinutes"
              type="number"
              value={accommodation?.availableUntilExtensionMinutes ?? 0}
            />
          </label>
          <label>
            {i18n.t("Extra attempts")}
            <br />
            <input
              min="0"
              name="extraAttempts"
              type="number"
              value={accommodation?.extraAttempts ?? 0}
            />
          </label>
          <label>
            {i18n.t("Time-limit multiplier")}
            <br />
            <input
              min="0.1"
              name="timeLimitMultiplier"
              step="0.1"
              type="number"
              value={accommodation?.timeLimitMultiplier ?? 1}
            />
          </label>
        </fieldset>
        <button type="submit">{i18n.t("Save accommodation")}</button>
      </form>
    </dialog>
  );
};

const AccommodationDialogControl: FC<{
  readonly accommodation: CourseAccommodation | null;
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly directory: UserDirectory;
  readonly membership: CourseMembership;
}> = ({ accommodation, context, courseId, directory, membership }) => {
  const i18n = useI18n();
  const dialogId = `accommodations-${membership.id}`;
  const label = i18n.t("Manage accommodations for {name}", {
    name: userDisplayName(
      i18n,
      directory.get(membership.userId) ?? null,
      membership.userId,
    ),
  });

  return (
    <>
      <button
        aria-label={label}
        class="icon-button"
        data-dialog-target={dialogId}
        title={label}
        type="button"
      >
        <AccessibilityIcon />
      </button>
      <AccommodationDialog
        accommodation={accommodation}
        context={context}
        courseId={courseId}
        dialogId={dialogId}
        directory={directory}
        membership={membership}
      />
    </>
  );
};

/**
 * A badge flagging that a member has custom accommodations, shown beside their
 * membership status. Members on the default accommodation carry no badge.
 */
const AccommodationBadge: FC<{
  readonly accommodation: CourseAccommodation | null;
}> = ({ accommodation }) => {
  const i18n = useI18n();

  return accommodation === null ? null : (
    <StatusBadge label={i18n.t("Accommodations")} tone="ok" />
  );
};

/**
 * The membership editor: a modal letting an instructor set a member's role
 * (promoting a student to teaching assistant or co-instructor, or the reverse)
 * and their status (active, suspended, dropped). It posts to the course's
 * membership route, which applies both changes and redirects back.
 */
const MemberManageDialog: FC<{
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly dialogId: string;
  readonly directory: UserDirectory;
  readonly membership: CourseMembership;
}> = ({ context, courseId, dialogId, directory, membership }) => {
  const i18n = useI18n();

  return (
    <dialog class="modal-dialog" id={dialogId}>
      <form
        action={`/courses/${courseId}/memberships/${membership.id}`}
        method="post"
      >
        <CsrfInput context={context} />
        <header class="modal-dialog-header">
          <h3>
            {i18n.t("Membership for {name}", {
              name: userDisplayName(
                i18n,
                directory.get(membership.userId) ?? null,
                membership.userId,
              ),
            })}
          </h3>
          <button
            aria-label={i18n.t("Close")}
            formmethod="dialog"
            formnovalidate
            type="submit"
          >
            ×
          </button>
        </header>
        <p class="small">
          {i18n.t(
            "Promote a member to course staff by raising their role. Suspending or dropping a member keeps their record but removes their active access.",
          )}
        </p>
        <label>
          {i18n.t("Role")}
          <br />
          <select name="role" required>
            {COURSE_ROLE_ORDER.map((role) => (
              <option selected={role === membership.role} value={role}>
                {courseRoleLabel(i18n, role)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {i18n.t("Status")}
          <br />
          <select name="status" required>
            {membershipStatusOptions(i18n).map((option) => (
              <option
                selected={option.value === membership.status}
                value={option.value}
              >
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">{i18n.t("Update membership")}</button>
      </form>
    </dialog>
  );
};

const MemberManageControl: FC<{
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly directory: UserDirectory;
  readonly membership: CourseMembership;
}> = ({ context, courseId, directory, membership }) => {
  const i18n = useI18n();
  const dialogId = `membership-${membership.id}`;
  const label = i18n.t("Manage membership for {name}", {
    name: userDisplayName(
      i18n,
      directory.get(membership.userId) ?? null,
      membership.userId,
    ),
  });

  return (
    <>
      <button
        aria-label={label}
        class="icon-button"
        data-dialog-target={dialogId}
        title={label}
        type="button"
      >
        <SettingsIcon />
      </button>
      <MemberManageDialog
        context={context}
        courseId={courseId}
        dialogId={dialogId}
        directory={directory}
        membership={membership}
      />
    </>
  );
};

const MembersTable: FC<{
  readonly accommodations: readonly CourseAccommodation[];
  readonly context: Context<AppBindings>;
  readonly course: Course;
  readonly directory: UserDirectory;
  readonly memberships: readonly CourseMembership[];
}> = ({ accommodations, context, course, directory, memberships }) => {
  const i18n = useI18n();

  if (memberships.length === 0) {
    return null;
  }

  const accommodationsByUserId = new Map(
    accommodations.map((accommodation) => [
      accommodation.userId,
      accommodation,
    ]),
  );

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("User")}</th>
          <th>{i18n.t("Role")}</th>
          <th>{i18n.t("Status")}</th>
          <th>{i18n.t("Actions")}</th>
        </tr>
      </thead>
      <tbody>
        {memberships.map((membership) => (
          <tr>
            <td>
              <UserLabel directory={directory} userId={membership.userId} />
              {membership.userId === course.createdById ? (
                <OwnerCrown />
              ) : null}
            </td>
            <td>{courseRoleLabel(i18n, membership.role)}</td>
            <td>
              <MembershipStatusBadge status={membership.status} />{" "}
              <AccommodationBadge
                accommodation={
                  accommodationsByUserId.get(membership.userId) ?? null
                }
              />
            </td>
            <td>
              <AccommodationDialogControl
                accommodation={
                  accommodationsByUserId.get(membership.userId) ?? null
                }
                context={context}
                courseId={course.id}
                directory={directory}
                membership={membership}
              />
              <MemberManageControl
                context={context}
                courseId={course.id}
                directory={directory}
                membership={membership}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};

/** The staff roles, least to most privileged; a student is not staff. */
const STAFF_ROLE_ORDER: readonly (
  | "co_instructor"
  | "instructor"
  | "teacher_assistant"
)[] = ["teacher_assistant", "co_instructor", "instructor"];

/**
 * Add course staff by account email. A person who is already a member (for
 * example a student who joined via an enrollment link) is promoted in place;
 * the email must belong to an existing account.
 */
const AddStaffBar: FC<{
  readonly context: Context<AppBindings>;
  readonly courseId: string;
}> = ({ context, courseId }) => {
  const i18n = useI18n();

  return (
    <CreateBar
      action={`/courses/${courseId}/staff`}
      context={context}
      submitLabel={i18n.t("Add staff")}
    >
      <input
        aria-label={i18n.t("Staff member email")}
        name="email"
        placeholder={i18n.t("person@example.edu", undefined, {
          comment:
            "Example address in the add-staff field. Translate the local " +
            "part; the example.edu domain is reserved for documentation.",
        })}
        required
        type="email"
      />
      <select aria-label={i18n.t("Staff role")} name="role">
        {STAFF_ROLE_ORDER.map((role) => (
          <option value={role}>{courseRoleLabel(i18n, role)}</option>
        ))}
      </select>
    </CreateBar>
  );
};

const EnrollmentCreateBar: FC<{
  readonly context: Context<AppBindings>;
  readonly courseId: string;
}> = ({ context, courseId }) => {
  const i18n = useI18n();

  return (
    <CreateBar
      action={`/courses/${courseId}/enrollment-links`}
      context={context}
      submitLabel={i18n.t("Create enrollment link")}
    >
      <TimestampInput
        label={i18n.t("Expires at, optional")}
        labelHidden
        name="expiresAt"
      />
    </CreateBar>
  );
};

const EnrollmentLinksTable: FC<{
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly links: readonly CourseEnrollmentLink[];
}> = ({ context, courseId, links }) => {
  const i18n = useI18n();

  if (links.length === 0) {
    return (
      <p class="small">
        {i18n.t("No enrollment links have been created yet.")}
      </p>
    );
  }

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("Created")}</th>
          <th>{i18n.t("Expires")}</th>
          <th>{i18n.t("Revoked")}</th>
        </tr>
      </thead>
      <tbody>
        {links.map((link) => (
          <tr>
            <td>
              <Time value={link.createdAt} />
            </td>
            <td>
              <Time value={link.expiresAt} />
            </td>
            <td>
              {link.revokedAt !== null ? (
                <Time value={link.revokedAt} />
              ) : (
                <form
                  action={`/courses/${courseId}/enrollment-links/${link.id}/revoke`}
                  method="post"
                >
                  <CsrfInput context={context} />
                  <button class="danger" type="submit">
                    {i18n.t("Revoke")}
                  </button>
                </form>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};

/**
 * A small crown marking the course owner (its creator) inline after the name,
 * so ownership reads at a glance without spending a whole table column on a
 * marker that applies to exactly one row.
 */
const OwnerCrown: FC = () => {
  const i18n = useI18n();
  const label = i18n.t("Course owner");

  return (
    <span aria-label={label} class="owner-crown" role="img" title={label}>
      {" "}
      <CrownIcon />
    </span>
  );
};

/**
 * One seen-but-unmapped LMS activity link with a picker to attach it to an
 * assignment. Until an instructor makes the association, launches of the LMS
 * activity land on the course page instead of an assignment.
 */
const LtiLinkRow: FC<{
  readonly assignments: readonly Assignment[];
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly link: LtiResourceLink;
}> = ({ assignments, context, courseId, link }) => {
  const i18n = useI18n();

  return (
    <tr>
      <td>{link.title.length === 0 ? link.resourceLinkId : link.title}</td>
      <td>
        <Time value={link.createdAt} />
      </td>
      <td>
        <form
          action={`/lti/resource-links/${link.id}/assignment`}
          class="create-bar"
          method="post"
        >
          <CsrfInput context={context} />
          <input name="courseId" type="hidden" value={courseId} />
          <select
            aria-label={i18n.t("Assignment")}
            name="assignmentId"
            required
          >
            <option value="">{i18n.t("Choose an assignment…")}</option>
            {assignments.map((assignment) => (
              <option value={assignment.id}>{assignment.title}</option>
            ))}
          </select>
          <button class="secondary" type="submit">
            {i18n.t("Link")}
          </button>
        </form>
      </td>
    </tr>
  );
};

const LtiLinksSheet: FC<{
  readonly assignments: readonly Assignment[];
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly links: readonly LtiResourceLink[];
}> = ({ assignments, context, courseId, links }) => {
  const i18n = useI18n();

  return (
    <Sheet
      description={i18n.t(
        "Activities in your LMS that launched into this course but are not yet connected to an assignment. Link them so those launches land directly on the right assignment.",
      )}
      title={i18n.t("LMS activity links")}
    >
      <TableScroll>
        <thead>
          <tr>
            <th>{i18n.t("LMS activity")}</th>
            <th>{i18n.t("First seen")}</th>
            <th>{i18n.t("Assignment")}</th>
          </tr>
        </thead>
        <tbody>
          {links.map((link) => (
            <LtiLinkRow
              assignments={assignments}
              context={context}
              courseId={courseId}
              link={link}
            />
          ))}
        </tbody>
      </TableScroll>
    </Sheet>
  );
};

/**
 * Grade deliveries to the LMS that ran out of retries. Surfacing them here —
 * next to the LMS activity links they belong to — is how an instructor
 * learns a student's LMS gradebook is stale, and the retry re-queues the
 * delivery after the underlying problem is fixed.
 */
/**
 * What a stored grade-delivery reason code means to an instructor. The prose
 * lives here, in the view, rather than in the record: a failed job is read long
 * after it was written, so its explanation must be produced in the reader's
 * language at render time.
 */
function gradeFailureReasonLabel(
  i18n: Translator,
  reason: LtiGradeFailureReason,
): string {
  switch (reason) {
    case "assignment_missing":
      return i18n.t("The linked assignment no longer exists.");
    case "assignment_not_graded":
      return i18n.t("The linked assignment is no longer graded.");
    case "line_item_missing":
      return i18n.t(
        "The LMS activity has no gradebook column (no AGS line item).",
      );
    case "lms_rejected":
      return i18n.t("The LMS rejected the score.");
    case "lms_token_refused":
      return i18n.t("The LMS refused Carnap's request for an access token.");
    case "lms_token_unreadable":
      return i18n.t("The LMS returned an unreadable access token.");
    case "lms_unreachable":
      return i18n.t("Carnap could not reach the LMS.");
    case "platform_disabled":
      return i18n.t("The LMS connection is disabled.");
    case "platform_missing":
      return i18n.t(
        "The LMS registration for this activity no longer exists.",
      );
    case "resource_link_unlinked":
      return i18n.t("The LMS activity is no longer linked to an assignment.");
    case "student_unlinked":
      return i18n.t("The student is no longer linked to this LMS.");
    case "unexpected":
      return i18n.t("Unexpected delivery failure.");
  }
}

/** The reason, plus whatever the LMS itself said about it. */
const GradeFailureReason: FC<{ readonly job: GradeSyncFailure["job"] }> = ({
  job,
}) => {
  const i18n = useI18n();

  return (
    <>
      {job.lastFailureReason === null
        ? i18n.t("Delivery failed.")
        : gradeFailureReasonLabel(i18n, job.lastFailureReason)}
      {job.lastErrorDetail === null ? null : (
        <>
          {" "}
          <span class="muted">{job.lastErrorDetail}</span>
        </>
      )}
    </>
  );
};

const GradeSyncSheet: FC<{
  readonly context: Context<AppBindings>;
  readonly courseId: string;
  readonly failures: readonly GradeSyncFailure[];
}> = ({ context, courseId, failures }) => {
  const i18n = useI18n();

  return (
    <Sheet
      description={i18n.t(
        "Grades Carnap could not deliver to your LMS. Retry once the problem described below is resolved; grades in Carnap itself are unaffected.",
      )}
      title={i18n.t("LMS grade sync problems")}
    >
      <TableScroll>
        <thead>
          <tr>
            <th>{i18n.t("Student")}</th>
            <th>{i18n.t("LMS activity")}</th>
            <th>{i18n.t("Problem")}</th>
            <th>{i18n.t("Last attempt")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {failures.map((failure) => (
            <tr>
              <td>
                {failure.student === null
                  ? i18n.t("Removed user")
                  : (failure.student.name ?? failure.student.email)}
              </td>
              <td>{failure.activityTitle}</td>
              <td>
                <GradeFailureReason job={failure.job} />
              </td>
              <td>
                <Time value={failure.job.updatedAt} />
              </td>
              <td>
                <form
                  action={`/lti/grade-jobs/${failure.job.id}/retry`}
                  method="post"
                >
                  <CsrfInput context={context} />
                  <input name="courseId" type="hidden" value={courseId} />
                  <button class="secondary" type="submit">
                    {i18n.t("Retry")}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
    </Sheet>
  );
};

/**
 * The course editor: a modal letting an instructor rename the course or change
 * its timezone, plus archive/unarchive it. Archiving keeps the record and all
 * its data but moves it out of the active course list. It posts to the course
 * update route, which redirects back with a notice.
 */
const CourseEditDialog: FC<{
  readonly context: Context<AppBindings>;
  readonly course: Course;
  readonly dialogId: string;
}> = ({ context, course, dialogId }) => {
  const i18n = useI18n();

  return (
    <dialog class="modal-dialog" id={dialogId}>
      <form action={`/courses/${course.id}`} method="post">
        <CsrfInput context={context} />
        <header class="modal-dialog-header">
          <h3>{i18n.t("Edit course")}</h3>
          <button
            aria-label={i18n.t("Close")}
            formmethod="dialog"
            formnovalidate
            type="submit"
          >
            ×
          </button>
        </header>
        <label>
          {i18n.t("Title")}
          <br />
          <input name="title" required value={course.title} />
        </label>
        <label for={`course-edit-timezone-${course.id}`}>
          {i18n.t("Timezone")}
          <br />
          <TimezoneSelect
            id={`course-edit-timezone-${course.id}`}
            selected={course.timezone}
          />
        </label>
        <button type="submit">{i18n.t("Save changes")}</button>
      </form>
      <form
        action={`/courses/${course.id}/${
          course.archivedAt === null ? "archive" : "unarchive"
        }`}
        method="post"
      >
        <CsrfInput context={context} />
        <p class="small">
          {course.archivedAt === null
            ? i18n.t(
                "Archiving moves this course out of the active list without deleting anything. You can unarchive it later.",
              )
            : i18n.t(
                "This course is archived. Unarchive it to return it to the active list.",
              )}
        </p>
        <button
          class={course.archivedAt === null ? "danger" : "secondary"}
          type="submit"
        >
          {course.archivedAt === null
            ? i18n.t("Archive course")
            : i18n.t("Unarchive course")}
        </button>
      </form>
    </dialog>
  );
};

const CourseEditControl: FC<{
  readonly context: Context<AppBindings>;
  readonly course: Course;
}> = ({ context, course }) => {
  const i18n = useI18n();
  const dialogId = `course-edit-${course.id}`;

  return (
    <>
      <button class="secondary" data-dialog-target={dialogId} type="button">
        {i18n.t("Edit")}
      </button>
      <CourseEditDialog
        context={context}
        course={course}
        dialogId={dialogId}
      />
    </>
  );
};

function canUnarchive(membership: CourseMembership): boolean {
  return (
    membership.role === "instructor" || membership.role === "co_instructor"
  );
}

/**
 * Archived courses, listed inside the drawer below the active ones. A student
 * sees the same list read-only: it is the only route back to the work they did
 * in a course whose term is over, since nothing else on the site links to it.
 * The actions column is dropped entirely when the reader can unarchive none of
 * them, rather than standing empty beside every row.
 */
const ArchivedCoursesTable: FC<{
  readonly context: Context<AppBindings>;
  readonly courses: readonly {
    readonly course: Course;
    readonly membership: CourseMembership;
  }[];
}> = ({ context, courses }) => {
  const i18n = useI18n();
  const showActions = courses.some((entry) => canUnarchive(entry.membership));

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("Course")}</th>
          <th>{i18n.t("Role")}</th>
          {showActions ? <th>{i18n.t("Actions")}</th> : null}
        </tr>
      </thead>
      <tbody>
        {courses.map((entry) => (
          <tr>
            <td>
              <a href={`/courses/${entry.course.id}`}>{entry.course.title}</a>
            </td>
            <td>{courseRoleLabel(i18n, entry.membership.role)}</td>
            {showActions ? (
              <td>
                {canUnarchive(entry.membership) ? (
                  <form
                    action={`/courses/${entry.course.id}/unarchive`}
                    method="post"
                  >
                    <CsrfInput context={context} />
                    <button class="secondary" type="submit">
                      {i18n.t("Unarchive")}
                    </button>
                  </form>
                ) : null}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};

const CloneCourseBar: FC<{
  readonly context: Context<AppBindings>;
  readonly course: Course;
}> = ({ context, course }) => {
  const i18n = useI18n();

  return (
    <CreateBar
      action={`/courses/${course.id}/clone`}
      context={context}
      submitLabel={i18n.t("Clone course")}
    >
      {/* A hint rather than a value, like every other field on this page: a
          prefilled input has to be cleared before it can be typed over. It is
          only a hint — `required`, and no server-side default, so the name a
          clone gets is always one somebody chose. */}
      <input
        aria-label={i18n.t("New course title")}
        name="title"
        placeholder={i18n.t("{title} copy", { title: course.title })}
        required
      />
    </CreateBar>
  );
};

export interface CourseListViewModel {
  readonly canCreate: boolean;
  readonly courses: readonly {
    readonly course: Course;
    readonly membership: CourseMembership;
  }[];
}

export interface CourseDetailViewModel {
  readonly accommodations: readonly CourseAccommodation[];
  readonly assignments: readonly Assignment[];
  readonly course: Course;
  readonly directory: UserDirectory;
  readonly enrollmentLinks: readonly CourseEnrollmentLink[];
  readonly isInstructor: boolean;
  readonly membership: CourseMembership;
  readonly memberships: readonly CourseMembership[];
  readonly newEnrollmentLinkUrl: string | null;
  readonly notices: readonly string[];
  readonly now: Timestamp;
  readonly scorecard: readonly StudentScorecardEntry[];
  readonly unmappedLtiLinks: readonly LtiResourceLink[];
  readonly gradeSyncFailures: readonly GradeSyncFailure[];
}

export function renderCourseList(
  context: Context<AppBindings>,
  model: CourseListViewModel,
): Response {
  const i18n = context.get("i18n");
  // Whole sentences per branch rather than a sentence with a sentence spliced
  // into it: the second half changes the first half's grammar in some
  // languages, and a translator cannot see the seam from inside a fragment.
  const description = model.canCreate
    ? i18n.t(
        "Courses where you have an active or historical membership. Use the row below the table to create a new course.",
      )
    : i18n.t(
        "Courses where you have an active or historical membership. You do not have permission to create new courses.",
      );
  const activeCourses = model.courses.filter(
    (entry) => entry.course.archivedAt === null,
  );
  const archivedCourses = model.courses.filter(
    (entry) => entry.course.archivedAt !== null,
  );

  return renderShell(
    context,
    { title: i18n.t("Courses") },
    <>
      <Sheet
        description={description}
        footer={
          model.canCreate ? <CoursesCreateBar context={context} /> : undefined
        }
        title={i18n.t("Your courses")}
      >
        <CoursesTable
          canCreate={model.canCreate}
          courses={activeCourses}
          hasArchived={archivedCourses.length > 0}
        />
      </Sheet>
      {archivedCourses.length > 0 ? (
        // A drawer rather than a second full table: an archived course is
        // reference material, opened to unarchive something and otherwise in
        // the way — and on a list of thirty courses the expanded version was
        // simply another screenful nobody scrolled to. Closed, the count on
        // the summary is the answer to "where did that course go?".
        <details class="sheet archived-sheet">
          <summary class="sheet-header">
            <h2>
              {i18n.t("Archived courses ({count})", {
                count: archivedCourses.length,
              })}
            </h2>
          </summary>
          <div class="sheet-section">
            <p class="small">
              {/* Whether the reader archived any of these is the difference
                  between housekeeping they can undo and a term that has
                  ended. A reader who is staff on even one of them gets the
                  staff sentence; the table's actions column follows the same
                  rule. */}
              {archivedCourses.some((entry) => canUnarchive(entry.membership))
                ? i18n.t(
                    "Courses you have archived. They keep all their data and can be returned to the active list at any time.",
                  )
                : i18n.t(
                    "Courses that have been archived. They keep all your work — open one to look back over it.",
                  )}
            </p>
            <ArchivedCoursesTable
              context={context}
              courses={archivedCourses}
            />
          </div>
        </details>
      ) : null}
    </>,
  );
}

export function renderCourseListError(
  context: Context<AppBindings>,
  options: {
    readonly message: string;
    readonly status: 200 | 400 | 401 | 403 | 404 | 429 | 500;
    readonly title: string;
  },
): Response {
  // Hoisted, not `context.get("i18n").t(...)`: the extractor matches the
  // receiver by name, so a call expression there extracts nothing at all.
  const i18n = context.get("i18n");

  return renderShell(
    context,
    { status: options.status, title: i18n.t("Courses") },
    <>
      <ErrorSummary>{options.message}</ErrorSummary>
      <CreateCourseForm context={context} title={options.title} />
    </>,
  );
}

export function renderCourseDetail(
  context: Context<AppBindings>,
  model: CourseDetailViewModel,
): Response {
  const i18n = context.get("i18n");
  const courseRecord = (
    <Sheet
      description={i18n.t("Course status, membership, and timezone.")}
      footer={
        model.isInstructor ? (
          <div class="footer-row">
            <CloneCourseBar context={context} course={model.course} />
            <CourseEditControl context={context} course={model.course} />
          </div>
        ) : undefined
      }
      summary={
        // Two statuses, each said whose it is. The course's own comes first
        // and exists in both states: it is what an instructor checks after
        // archiving, and a cell that appeared only once a course was archived
        // would leave a reader who saw no change with nothing to read. The
        // membership's used to be the only one here, labelled plainly
        // "Status" — so archiving a course left the page's one status still
        // reading "Active", which is a true fact about the wrong thing.
        <SummaryStrip
          items={[
            { label: i18n.t("Timezone"), value: model.course.timezone },
            {
              label: i18n.t("Course status"),
              value:
                model.course.archivedAt === null
                  ? i18n.t("Active")
                  : i18n.t("Archived"),
            },
            {
              label: i18n.t("Your role"),
              value: courseRoleLabel(i18n, model.membership.role),
            },
            {
              label: i18n.t("Your status"),
              value: membershipStatusLabel(i18n, model.membership.status),
            },
          ]}
        />
      }
      title={i18n.t("Course record")}
    />
  );

  if (!model.isInstructor) {
    return renderShell(
      context,
      { breadcrumb: [coursesCrumb(i18n)], title: model.course.title },
      <>
        {model.notices.map((message) => (
          <Notice>{message}</Notice>
        ))}
        {courseRecord}
        <Sheet
          description={i18n.t(
            "Published assignments available to you in this course.",
          )}
          title={i18n.t("Assignments")}
        >
          <AssignmentsTable
            assignments={model.assignments}
            courseId={model.course.id}
            instructor={false}
            now={model.now}
            scores={model.scorecard}
          />
        </Sheet>
      </>,
    );
  }

  // On wide screens the members roster moves into its own right-hand column
  // (the content split's "doc" slot), with every administrative sheet stacked
  // in the left rail beside it.
  return renderShell(
    context,
    { breadcrumb: [coursesCrumb(i18n)], title: model.course.title },
    <>
      {model.notices.map((message) => (
        <Notice>{message}</Notice>
      ))}
      <ContentSplit
        className="course-split"
        content={
          <Sheet
            description={i18n.t(
              "Course roles and membership states. Promote a member to staff or adjust their access from the manage control. The course owner is marked with a crown.",
            )}
            footer={
              <AddStaffBar context={context} courseId={model.course.id} />
            }
            title={i18n.t("Members")}
          >
            <MembersTable
              accommodations={model.accommodations}
              context={context}
              course={model.course}
              directory={model.directory}
              memberships={model.memberships}
            />
          </Sheet>
        }
        rail={
          <>
            {courseRecord}
            <Sheet
              description={i18n.t(
                "Draft and published assignment records for this course.",
              )}
              footer={
                <AssignmentCreateBar
                  context={context}
                  courseId={model.course.id}
                />
              }
              title={i18n.t("Assignment management")}
            >
              <AssignmentsTable
                assignments={model.assignments}
                courseId={model.course.id}
                instructor={true}
                now={model.now}
              />
              <LinkStrip
                links={[
                  {
                    hint: i18n.t("Scores across every graded assignment"),
                    href: `/courses/${model.course.id}/instructor/gradebook`,
                    label: i18n.t("Course gradebook"),
                  },
                  {
                    hint: i18n.t("CSV of the whole course's grades"),
                    href: `/courses/${model.course.id}/instructor/grades.csv`,
                    label: i18n.t("Download CSV"),
                  },
                ]}
              />
            </Sheet>
            {model.unmappedLtiLinks.length > 0 ? (
              <LtiLinksSheet
                assignments={model.assignments}
                context={context}
                courseId={model.course.id}
                links={model.unmappedLtiLinks}
              />
            ) : null}
            {model.gradeSyncFailures.length > 0 ? (
              <GradeSyncSheet
                context={context}
                courseId={model.course.id}
                failures={model.gradeSyncFailures}
              />
            ) : null}
            <Sheet
              description={i18n.t(
                "Create and revoke links students can use to join this course.",
              )}
              footer={
                <EnrollmentCreateBar
                  context={context}
                  courseId={model.course.id}
                />
              }
              title={i18n.t("Enrollment links")}
            >
              {model.newEnrollmentLinkUrl === null ? null : (
                <div class="notice" role="status">
                  <p>
                    {i18n.t(
                      "Enrollment link created. Copy it now — for security it is not stored and cannot be shown again.",
                    )}
                  </p>
                  <CopyField
                    id="new-enrollment-link"
                    value={model.newEnrollmentLinkUrl}
                  />
                </div>
              )}
              <EnrollmentLinksTable
                context={context}
                courseId={model.course.id}
                links={model.enrollmentLinks}
              />
            </Sheet>
          </>
        }
      />
    </>,
  );
}

export function renderCourseError(
  context: Context<AppBindings>,
  options: {
    readonly message: string;
    readonly status: 200 | 400 | 401 | 403 | 404 | 429 | 500;
    readonly title: string;
  },
): Response {
  return renderShell(
    context,
    {
      breadcrumb: [coursesCrumb(context.get("i18n"))],
      status: options.status,
      title: options.title,
    },
    <ErrorSummary>{options.message}</ErrorSummary>,
  );
}

export function renderEnrollmentPage(
  context: Context<AppBindings>,
  token: string,
): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    { breadcrumb: [coursesCrumb(i18n)], title: i18n.t("Join course") },
    <>
      <p>
        {i18n.t("You are about to join a course with an enrollment link.")}
      </p>
      <form action={`/enrollments/${token}`} method="post">
        <CsrfInput context={context} />
        <button type="submit">{i18n.t("Join course")}</button>
      </form>
    </>,
  );
}
