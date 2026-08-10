import type { Context } from "hono";
import type { FC } from "hono/jsx";

import type {
  AssignmentGradebook,
  CourseGradebook,
} from "../application/gradebook";
import type {
  StudentAssignmentResults,
  SubmissionHistoryEntry,
} from "../application/submissions";
import type { ViewerEvaluation } from "../domain/assessment";
import type { AssignmentScore } from "../domain/grades";
import type { AppBindings } from "../http";
import {
  courseCrumb,
  coursesCrumb,
  instructorAssignmentCrumb,
  studentAssignmentCrumb,
} from "./breadcrumbs";
import { AnswerReview, LinkStrip, Sheet, TableScroll } from "./components";
import { renderShell, useI18n } from "./layout";

const ScoreCell: FC<{ readonly score: AssignmentScore | null }> = ({
  score,
}) => {
  if (score === null) {
    return null;
  }

  // A not-started assignment (no attempts) reads as a dash, and a missing one
  // (attempted but nothing submitted) as a question mark, over the possible
  // points — so neither is confused with a genuine zero the student earned.
  if (score.status === "not-started") {
    return <>—/{score.maxScore}</>;
  }

  if (score.status === "missing") {
    return <>?/{score.maxScore}</>;
  }

  return (
    <>
      {score.score}/{score.maxScore}
    </>
  );
};

/**
 * A student's course total: earned points over the points possible, summed
 * across every assignment that has a score record. Assignments with no score
 * for this student (a null cell) contribute nothing to either side.
 */
const TotalCell: FC<{
  readonly scores: readonly (AssignmentScore | null)[];
}> = ({ scores }) => {
  let earned = 0;
  let possible = 0;

  for (const score of scores) {
    if (score === null) {
      continue;
    }

    earned += score.score;
    possible += score.maxScore;
  }

  return (
    <>
      {earned}/{possible}
    </>
  );
};

const CourseGradebookTable: FC<{ readonly gradebook: CourseGradebook }> = ({
  gradebook,
}) => {
  const i18n = useI18n();

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("Name")}</th>
          <th>{i18n.t("Email")}</th>
          {gradebook.assignments.map((assignment) => (
            <th>{assignment.title}</th>
          ))}
          <th>{i18n.t("Total")}</th>
        </tr>
      </thead>
      <tbody>
        {gradebook.rows.map((row) => (
          <tr>
            <td>{row.user.name ?? ""}</td>
            <td>{row.user.email}</td>
            {row.scores.map((score) => (
              <td>
                <ScoreCell score={score} />
              </td>
            ))}
            <td>
              <strong>
                <TotalCell scores={row.scores} />
              </strong>
            </td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};

const AssignmentGradebookTable: FC<{
  readonly gradebook: AssignmentGradebook;
}> = ({ gradebook }) => {
  const i18n = useI18n();

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("Name")}</th>
          <th>{i18n.t("Email")}</th>
          <th>{i18n.t("Score")}</th>
        </tr>
      </thead>
      <tbody>
        {gradebook.rows.map((row) => (
          <tr>
            <td>{row.user.name ?? ""}</td>
            <td>{row.user.email}</td>
            <td>
              <ScoreCell score={row.score} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};

export function renderCourseGradebook(
  context: Context<AppBindings>,
  courseId: string,
  courseTitle: string,
  gradebook: CourseGradebook,
): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    {
      breadcrumb: [coursesCrumb(i18n), courseCrumb(courseId, courseTitle)],
      // Scored twice over: this page and the one for a single assignment are
      // both a table of names and numbers under a trail whose middle crumbs
      // can read alike, so each says which of the two it is rather than
      // leaving "Gradebook" and "Grades" to carry the distinction alone.
      title: i18n.t("Course gradebook"),
    },
    <Sheet
      description={i18n.t("Course scores across published assignments.")}
      title={i18n.t("Course gradebook")}
    >
      <CourseGradebookTable gradebook={gradebook} />
    </Sheet>,
  );
}

export function renderAssignmentGradebook(
  context: Context<AppBindings>,
  courseId: string,
  courseTitle: string,
  gradebook: AssignmentGradebook,
): Response {
  const i18n = context.get("i18n");
  const graded = gradebook.assignment.assessmentMode === "graded";
  // Same table for both modes, so the words around it carry the difference. A
  // practice set's points are scores and not grades — they reach no course
  // total and no LMS — and a page headed "grades" over a sheet that says the
  // opposite is how an instructor comes away unsure which they are looking at.
  const title = graded
    ? i18n.t("Assignment grades")
    : i18n.t("Practice scores");

  return renderShell(
    context,
    {
      breadcrumb: [
        coursesCrumb(i18n),
        courseCrumb(courseId, courseTitle),
        instructorAssignmentCrumb(
          courseId,
          gradebook.assignment.id,
          gradebook.assignment.title,
        ),
      ],
      title,
    },
    <Sheet
      description={
        graded
          ? i18n.t("Scores, status, and export controls for this assignment.")
          : i18n.t(
              "Practice scores are recorded, and do not count toward the course total.",
            )
      }
      title={title}
    >
      <AssignmentGradebookTable gradebook={gradebook} />
      <LinkStrip
        links={[
          {
            hint: graded
              ? i18n.t("CSV of the current grades")
              : i18n.t("CSV of the current scores"),
            href: `/courses/${courseId}/instructor/assignments/${gradebook.assignment.id}/grades.csv`,
            label: i18n.t("Export CSV"),
          },
          {
            hint: i18n.t("Newest submissions and manual grading"),
            href: `/courses/${courseId}/instructor/assignments/${gradebook.assignment.id}/submissions`,
            label: i18n.t("Review submissions"),
          },
        ]}
      />
    </Sheet>,
  );
}

/**
 * The instructor's free-text comment on a submission, stored on a manual
 * evaluation's `result.feedback`. Automatic evaluations carry no comment.
 */
function instructorComment(
  evaluation: ViewerEvaluation | null,
): string | null {
  if (evaluation === null || evaluation.evaluatorKind !== "manual") {
    return null;
  }

  const result = evaluation.result;

  if (
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result)
  ) {
    return null;
  }

  const feedback = (result as Record<string, unknown>).feedback;

  return typeof feedback === "string" && feedback.length > 0
    ? feedback
    : null;
}

const ResultExercise: FC<{ readonly entry: SubmissionHistoryEntry }> = ({
  entry,
}) => {
  const i18n = useI18n();
  const comment = instructorComment(entry.evaluation);

  return (
    <div class="result-exercise">
      <div class="result-exercise-header">
        <strong>{entry.submission.exerciseId ?? i18n.t("Exercise")}</strong>
        {/* Three states, not two. No evaluation means nothing has graded this
            yet — a free response waiting on an instructor, or an exercise
            withholding its verdict, which are deliberately the same silence.
            An evaluation with no number means it *is* graded and the score is
            behind the release date, which "Not yet graded" would misreport. */}
        {entry.evaluation === null ? (
          <span class="small">{i18n.t("Not yet graded")}</span>
        ) : entry.evaluation.score === null ? (
          <span class="small">{i18n.t("Score not released yet")}</span>
        ) : (
          <span>
            {entry.evaluation.score}/{entry.evaluation.maxScore}
          </span>
        )}
      </div>
      {entry.answerReview === null ? null : (
        <AnswerReview review={entry.answerReview} />
      )}
      {comment === null ? null : (
        <div class="instructor-comment">
          <h4>{i18n.t("Instructor comment")}</h4>
          <p>{comment}</p>
        </div>
      )}
    </div>
  );
};

export function renderStudentAssignmentResults(
  context: Context<AppBindings>,
  model: {
    readonly assignmentId: string;
    readonly assignmentTitle: string;
    readonly courseId: string;
    readonly courseTitle: string;
    readonly results: StudentAssignmentResults;
  },
): Response {
  const i18n = context.get("i18n");
  const breadcrumb = [
    coursesCrumb(i18n),
    courseCrumb(model.courseId, model.courseTitle),
    studentAssignmentCrumb(
      model.courseId,
      model.assignmentId,
      model.assignmentTitle,
    ),
  ];

  if (model.results.attempts.length === 0) {
    return renderShell(
      context,
      { breadcrumb, title: i18n.t("Results") },
      <Sheet title={i18n.t("Results")}>
        <p>
          {i18n.t("You have not submitted any work for this assignment.")}
        </p>
      </Sheet>,
    );
  }

  return renderShell(
    context,
    { breadcrumb, title: i18n.t("Results") },
    // The work is theirs to read back whether or not the grades are out; what
    // is missing while they are not is every number, withheld per exercise
    // upstream. Saying so once at the top beats a page of "Not yet graded"
    // with nothing to explain it.
    <>
      {model.results.released ? null : (
        <Sheet title={i18n.t("Results")}>
          <p>
            {i18n.t("Grades for this assignment have not been released yet.")}
          </p>
        </Sheet>
      )}
      {model.results.attempts.map((attempt) => (
        <Sheet
          description={i18n.t(
            "Your answers, the expected results, and instructor comments.",
          )}
          title={i18n.t("Attempt {ordinal}", { ordinal: attempt.ordinal })}
        >
          {attempt.entries.length === 0 ? (
            <p class="small">
              {i18n.t("No submissions were recorded in this attempt.")}
            </p>
          ) : (
            attempt.entries.map((entry) => <ResultExercise entry={entry} />)
          )}
        </Sheet>
      ))}
    </>,
  );
}
