import type { Context } from "hono";
import type { FC } from "hono/jsx";

import type { StudentScorecardEntry } from "../application/gradebook";
import type { Assignment } from "../domain/assignments";
import type { Timestamp } from "../domain/time";
import type { AppBindings } from "../http";
import { splitAtValue, VALUE } from "../i18n/translator";
import { CreateBar, StatusBadge, TableScroll, Time } from "./components";
import {
  ASSESSMENT_MODE_ORDER,
  ASSIGNMENT_STATE_ORDER,
  assessmentModeLabel,
  assignmentStateLabel,
} from "./labels";
import { useI18n } from "./layout";
import { SortHeader, sortNumber, sortRank } from "./table-sort";

const AssignmentStatus: FC<{
  readonly assignment: Assignment;
  readonly instructor: boolean;
}> = ({ assignment, instructor }) => {
  const i18n = useI18n();
  const state = (
    <StatusBadge
      label={assignmentStateLabel(i18n, assignment.state)}
      tone={assignment.state === "published" ? "ok" : "warn"}
    />
  );

  if (!instructor) {
    return state;
  }

  return (
    <>
      {state}{" "}
      {assignment.listed ? (
        <StatusBadge label={i18n.t("Listed")} tone="neutral" />
      ) : (
        <StatusBadge label={i18n.t("Hidden")} tone="warn" />
      )}{" "}
      <StatusBadge
        label={assessmentModeLabel(i18n, assignment.assessmentMode)}
        tone="neutral"
      />
    </>
  );
};

/**
 * A student's combined score cell: earned over worth, where the worth is simply
 * the denominator. An assignment with no recorded work reads as a dash;
 * graded-but-unreleased assignments still show the worth (denominator) but
 * withhold the earned points until the instructor releases grades. Practice and
 * reading scores show immediately but muted, since they do not count toward the
 * course total. Every visible score links through to the results page.
 */
const ScoreCell: FC<{
  readonly assignmentId: string;
  readonly courseId: string;
  readonly entry: StudentScorecardEntry | undefined;
}> = ({ assignmentId, courseId, entry }) => {
  const i18n = useI18n();

  if (entry === undefined) {
    return <>—</>;
  }

  if (!entry.counts) {
    return (
      <a
        class="score-uncounted"
        href={`/courses/${courseId}/assignments/${assignmentId}/results`}
      >
        {entry.earned}/{entry.worth}
      </a>
    );
  }

  if (!entry.released) {
    return <>{i18n.t("—/{worth} (not released)", { worth: entry.worth })}</>;
  }

  return (
    <a href={`/courses/${courseId}/assignments/${assignmentId}/results`}>
      {entry.earned}/{entry.worth}
    </a>
  );
};

type AvailabilityState = "closed" | "open" | "upcoming";

/**
 * Where an assignment sits in its availability window relative to now: "upcoming"
 * before its start date, "closed" past its hard cutoff, or "open" in between (or
 * with no window at all). Only "open" assignments are reachable — the detail page
 * stays gated before an assignment opens and after it closes — so upcoming and
 * closed rows render their title as plain text rather than a dead link.
 */
function availabilityState(
  assignment: Assignment,
  now: Timestamp,
): AvailabilityState {
  if (assignment.availableFrom !== null && assignment.availableFrom > now) {
    return "upcoming";
  }

  if (
    assignment.availableUntil !== null &&
    assignment.availableUntil <= now
  ) {
    return "closed";
  }

  return "open";
}

/**
 * A student's availability cell: "Opens <date>" for upcoming work, "Closed
 * <date>" for work past its cutoff (which lingers, greyed, for reference),
 * "Closes <date>" for an open assignment with a cutoff still ahead (set apart
 * from the softer due date), or "Open" when it stays available indefinitely.
 */
const AvailabilityCell: FC<{
  readonly assignment: Assignment;
  readonly state: AvailabilityState;
}> = ({ assignment, state }) => {
  const i18n = useI18n();

  if (state === "upcoming") {
    const [before, after] = splitAtValue(
      i18n.t("Opens {when}", { when: VALUE }),
    );

    return (
      <>
        {before}
        <Time value={assignment.availableFrom} />
        {after}
      </>
    );
  }

  if (state === "closed") {
    const [before, after] = splitAtValue(
      i18n.t("Closed {when}", { when: VALUE }),
    );

    return (
      <>
        {before}
        <Time value={assignment.availableUntil} />
        {after}
      </>
    );
  }

  if (assignment.availableUntil !== null) {
    const [before, after] = splitAtValue(
      i18n.t("Closes {when}", { when: VALUE }),
    );

    return (
      <>
        {before}
        <Time value={assignment.availableUntil} />
        {after}
      </>
    );
  }

  return (
    <>
      {i18n.t(
        "Open (assignment availability)",
        {},
        {
          comment:
            "Disambiguating id; only the word Open is shown. An assignment available now, with no closing date.",
          message: "Open",
        },
      )}
    </>
  );
};

const AssignmentRow: FC<{
  readonly assignment: Assignment;
  readonly courseId: string;
  readonly instructor: boolean;
  readonly now: Timestamp;
  readonly score: StudentScorecardEntry | undefined;
}> = ({ assignment, courseId, instructor, now, score }) => {
  const i18n = useI18n();
  const href = instructor
    ? `/courses/${courseId}/instructor/assignments/${assignment.id}`
    : `/courses/${courseId}/assignments/${assignment.id}`;
  const state = availabilityState(assignment, now);
  // Instructors always link through; for students only open assignments are
  // reachable, and closed ones linger greyed out for reference.
  const linked = instructor || state === "open";
  const closed = !instructor && state === "closed";

  return (
    <tr class={closed ? "assignment-closed" : undefined}>
      <td>
        {linked ? <a href={href}>{assignment.title}</a> : assignment.title}
      </td>
      {instructor ? (
        // Three badges in the cell, so its sort value settles all three: live
        // work before drafts, listed before hidden, then by mode. Ordering on
        // the first alone would leave the column looking half-sorted.
        <td data-sort-value={statusSortValue(assignment)}>
          <AssignmentStatus assignment={assignment} instructor={instructor} />
        </td>
      ) : (
        <td
          data-sort-value={sortRank(
            ASSESSMENT_MODE_ORDER,
            assignment.assessmentMode,
          )}
        >
          {assessmentModeLabel(i18n, assignment.assessmentMode)}
        </td>
      )}
      {/* The instant, not the date the reader sees: the cell is localized on
          load, and "Jul 6" does not sort. */}
      <td data-sort-value={assignment.dueAt ?? ""}>
        <Time fallback={i18n.t("None")} value={assignment.dueAt} />
      </td>
      {instructor ? null : (
        <td data-sort-value={sortRank(AVAILABILITY_ORDER, state)}>
          <AvailabilityCell assignment={assignment} state={state} />
        </td>
      )}
      {instructor ? (
        <td>
          {/* A practice set has a table of its own too, and the word changes
              with the mode: what it holds are scores, which reach no course
              total. A reading has neither, and gets no link. */}
          {assignment.assessmentMode === "none" ? null : (
            <a
              href={`/courses/${courseId}/instructor/assignments/${assignment.id}/gradebook`}
            >
              {assignment.assessmentMode === "graded"
                ? i18n.t("Grades")
                : i18n.t("Scores")}
            </a>
          )}
        </td>
      ) : (
        <td data-sort-value={sortNumber(scoreFraction(score))}>
          <ScoreCell
            assignmentId={assignment.id}
            courseId={courseId}
            entry={score}
          />
        </td>
      )}
    </tr>
  );
};

/**
 * A student's cumulative course total, summed over the released graded
 * assignments — the same entries whose earned/worth cells are visible above.
 * Unreleased grades are withheld from the running total just as they are from
 * the per-assignment cells. Renders nothing until at least one grade is
 * released, so the footer stays quiet early in a term.
 */
const StudentTotalFooter: FC<{
  readonly scores: readonly StudentScorecardEntry[];
}> = ({ scores }) => {
  const i18n = useI18n();
  let earned = 0;
  let possible = 0;
  let released = 0;

  for (const entry of scores) {
    if (!entry.counts || !entry.released || entry.earned === null) {
      continue;
    }

    earned += entry.earned;
    possible += entry.worth;
    released += 1;
  }

  if (released === 0) {
    return null;
  }

  return (
    <tfoot>
      <tr>
        <td colspan={4}>
          <strong>{i18n.t("Course total")}</strong>
        </td>
        <td>
          <strong>
            {earned}/{possible}
          </strong>
        </td>
      </tr>
    </tfoot>
  );
};

/**
 * The instructor's status cell as one number: state first, then whether it is
 * listed, then the mode — the same order the three badges read in.
 */
function statusSortValue(assignment: Assignment): string {
  const state = ASSIGNMENT_STATE_ORDER.indexOf(assignment.state);
  const mode = ASSESSMENT_MODE_ORDER.indexOf(assignment.assessmentMode);

  return String(state * 100 + (assignment.listed ? 0 : 10) + mode);
}

/** Open work first, then what is yet to open, then what is over. */
const AVAILABILITY_ORDER: readonly AvailabilityState[] = [
  "open",
  "upcoming",
  "closed",
];

/**
 * What a student's score sorts on: the fraction they earned. A score they
 * cannot see yet is not a number to be ordered by — it sorts as absent, with
 * the assignments they have never opened.
 */
function scoreFraction(
  entry: StudentScorecardEntry | undefined,
): number | null {
  if (entry === undefined || entry.earned === null) {
    return null;
  }

  if (entry.counts && !entry.released) {
    return null;
  }

  return entry.worth === 0 ? 0 : entry.earned / entry.worth;
}

export const AssignmentsTable: FC<{
  readonly assignments: readonly Assignment[];
  readonly courseId: string;
  readonly instructor: boolean;
  readonly now: Timestamp;
  readonly scores?: readonly StudentScorecardEntry[];
}> = ({ assignments, courseId, instructor, now, scores }) => {
  const i18n = useI18n();

  if (assignments.length === 0 && !instructor) {
    return <p>{i18n.t("No assignments are available.")}</p>;
  }

  if (assignments.length === 0) {
    return <p>{i18n.t("No assignments have been created yet.")}</p>;
  }

  const scoreByAssignment = new Map(
    (scores ?? []).map((entry) => [entry.assignmentId, entry]),
  );
  return (
    <TableScroll>
      <thead>
        <tr>
          <SortHeader label={i18n.t("Title")} />
          {instructor ? (
            <SortHeader label={i18n.t("Status")} />
          ) : (
            <SortHeader label={i18n.t("Type")} />
          )}
          <SortHeader label={i18n.t("Due")} />
          {instructor ? null : <SortHeader label={i18n.t("Availability")} />}
          {/* The column holds a link per row, and what it leads to is a table
              of grades for one assignment and of practice scores for another,
              so the heading takes the word that covers both. There is nothing
              in it to sort. */}
          {instructor ? (
            <th scope="col">{i18n.t("Scores")}</th>
          ) : (
            <SortHeader label={i18n.t("Score")} />
          )}
        </tr>
      </thead>
      <tbody>
        {assignments.map((assignment) => (
          <AssignmentRow
            assignment={assignment}
            courseId={courseId}
            instructor={instructor}
            now={now}
            score={scoreByAssignment.get(assignment.id)}
          />
        ))}
      </tbody>
      {instructor ? null : <StudentTotalFooter scores={scores ?? []} />}
    </TableScroll>
  );
};

export const AssignmentCreateBar: FC<{
  readonly context: Context<AppBindings>;
  readonly courseId: string;
}> = ({ context, courseId }) => {
  const i18n = useI18n();

  return (
    <CreateBar
      action={`/courses/${courseId}/assignments`}
      context={context}
      submitLabel={i18n.t("Create assignment")}
    >
      <input name="quickCreate" type="hidden" value="1" />
      <input
        aria-label={i18n.t("New assignment title")}
        maxlength={200}
        name="title"
        placeholder={i18n.t("new assignment")}
        required
      />
    </CreateBar>
  );
};
