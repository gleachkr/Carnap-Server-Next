import type { Context } from "hono";
import type { FC } from "hono/jsx";

import type { StudentScorecardEntry } from "../application/gradebook";
import {
  type Assignment,
  type AssignmentAvailability,
  assignmentAvailability,
} from "../domain/assignments";
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

/**
 * The instructor's Type cell: the mode, which every row has, as plain text,
 * and a badge only for what makes a row an exception — a draft students cannot
 * see yet, or a published assignment left off their list.
 */
const AssignmentType: FC<{ readonly assignment: Assignment }> = ({
  assignment,
}) => {
  const i18n = useI18n();

  return (
    <>
      {assessmentModeLabel(i18n, assignment.assessmentMode)}
      {assignment.state === "draft" ? (
        <>
          {" "}
          <StatusBadge
            label={assignmentStateLabel(i18n, assignment.state)}
            tone="warn"
          />
        </>
      ) : null}
      {assignment.listed ? null : (
        <>
          {" "}
          <StatusBadge label={i18n.t("Hidden")} tone="warn" />
        </>
      )}
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

/**
 * What a student's title carries besides the title: nothing while the
 * assignment is open, which is the ordinary case, and a badge only for the
 * exception — "Closed" for work past its cutoff (the row lingers, greyed, for
 * reference) and "Opens <date>" for work not yet available.
 */
const AvailabilityBadge: FC<{
  readonly assignment: Assignment;
  readonly state: AssignmentAvailability;
}> = ({ assignment, state }) => {
  const i18n = useI18n();

  if (state === "upcoming") {
    const [before, after] = splitAtValue(
      i18n.t("Opens {when}", { when: VALUE }),
    );

    return (
      <>
        {" "}
        <StatusBadge
          label={
            <>
              {before}
              <Time value={assignment.availableFrom} />
              {after}
            </>
          }
          tone="warn"
        />
      </>
    );
  }

  if (state === "closed") {
    return (
      <>
        {" "}
        <StatusBadge
          label={i18n.t(
            "Closed (assignment availability)",
            {},
            {
              comment:
                "Disambiguating id; only the word Closed is shown. A badge beside an assignment past its closing date.",
              message: "Closed",
            },
          )}
        />
      </>
    );
  }

  return null;
};

/**
 * A due date, or a faint dash where there is none, so that the rows with a
 * date stand out from the ones without instead of every cell reading "None".
 */
const DueDate: FC<{ readonly value: Timestamp | null }> = ({ value }) =>
  value === null ? (
    <span class="table-empty">—</span>
  ) : (
    <Time value={value} />
  );

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
  // Only "open" assignments are reachable — the detail page stays gated
  // before an assignment opens and after it closes, by the same reading of
  // the window — so upcoming and closed rows render their title as plain
  // text rather than a dead link.
  const state = assignmentAvailability(assignment, now);
  // Instructors always link through; for students only open assignments are
  // reachable, and closed ones linger greyed out for reference.
  const linked = instructor || state === "open";
  const closed = !instructor && state === "closed";

  return (
    <tr class={closed ? "assignment-closed" : undefined}>
      <td>
        {linked ? <a href={href}>{assignment.title}</a> : assignment.title}
        {instructor ? null : (
          <AvailabilityBadge assignment={assignment} state={state} />
        )}
      </td>
      {instructor ? (
        // The mode first, since that is what the column is named for; within
        // a mode, the ordinary rows before the flagged ones.
        <td data-sort-value={typeSortValue(assignment)}>
          <AssignmentType assignment={assignment} />
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
        <DueDate value={assignment.dueAt} />
      </td>
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
        <td colspan={3}>
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
 * The instructor's Type cell as one number: the mode, then published before
 * draft, then listed before hidden — the same order the cell reads in.
 */
function typeSortValue(assignment: Assignment): string {
  const mode = ASSESSMENT_MODE_ORDER.indexOf(assignment.assessmentMode);
  const state = ASSIGNMENT_STATE_ORDER.indexOf(assignment.state);

  return String(mode * 100 + state * 10 + (assignment.listed ? 0 : 1));
}

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
          <SortHeader label={i18n.t("Type")} />
          <SortHeader label={i18n.t("Due")} />
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

/**
 * A teaching assistant's assignments: what there is to grade. One row per
 * published assignment, and the two places a grader goes — the review queue
 * and the assignment's grade table — as links in their own columns rather
 * than behind the title, because the title's usual destination, the
 * assignment's settings page, is an instructor's and would answer a
 * forbidden. A reading collects nothing and so has neither link; the row
 * still appears, since the list is the course's assignments and not only
 * the ones with work in them.
 */
export const GradingTable: FC<{
  readonly assignments: readonly Assignment[];
  readonly courseId: string;
}> = ({ assignments, courseId }) => {
  const i18n = useI18n();

  if (assignments.length === 0) {
    return <p>{i18n.t("No assignments have been published yet.")}</p>;
  }

  return (
    <TableScroll>
      <thead>
        <tr>
          <SortHeader label={i18n.t("Title")} />
          <SortHeader label={i18n.t("Type")} />
          <SortHeader label={i18n.t("Due")} />
          <th scope="col">{i18n.t("Submissions")}</th>
          <th scope="col">{i18n.t("Scores")}</th>
        </tr>
      </thead>
      <tbody>
        {assignments.map((assignment) => {
          const base = `/courses/${courseId}/instructor/assignments/${assignment.id}`;
          const collects = assignment.assessmentMode !== "none";

          return (
            <tr>
              <td>{assignment.title}</td>
              <td
                data-sort-value={sortRank(
                  ASSESSMENT_MODE_ORDER,
                  assignment.assessmentMode,
                )}
              >
                {assessmentModeLabel(i18n, assignment.assessmentMode)}
              </td>
              <td data-sort-value={assignment.dueAt ?? ""}>
                <DueDate value={assignment.dueAt} />
              </td>
              <td>
                {collects ? (
                  <a href={`${base}/submissions`}>
                    {i18n.t("Review submissions")}
                  </a>
                ) : null}
              </td>
              <td>
                {collects ? (
                  <a href={`${base}/gradebook`}>
                    {assignment.assessmentMode === "graded"
                      ? i18n.t("Grades")
                      : i18n.t("Scores")}
                  </a>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
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
