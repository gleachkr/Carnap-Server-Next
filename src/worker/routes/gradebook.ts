import { type Context, Hono } from "hono";

import { requireAuthenticated } from "../application/authorization";
import {
  type AssignmentGradebook,
  assignmentGradebookCsv,
  type CourseGradebook,
  courseGradebookCsv,
  GradebookService,
} from "../application/gradebook";
import { SubmissionService } from "../application/submissions";
import type { Assignment } from "../domain/assignments";
import type { AssignmentScore } from "../domain/grades";
import type { AppBindings } from "../http";
import { storesForContext } from "../stores";
import { csvDownloadHeaders } from "../web/download";
import {
  renderAssignmentGradebook,
  renderCourseGradebook,
  renderStudentAssignmentResults,
} from "../web/gradebook";
import { redirect, wantsHtml } from "../web/html";

function gradebookService(context: Context<AppBindings>): GradebookService {
  return new GradebookService({ stores: storesForContext(context) });
}

function submissionService(context: Context<AppBindings>): SubmissionService {
  return new SubmissionService({ stores: storesForContext(context) });
}

function requiredParam(context: Context<AppBindings>, name: string): string {
  const value = context.req.param(name);

  if (value === undefined) {
    throw new Error(`Missing route parameter ${name}.`);
  }

  return value;
}

interface CourseNaming {
  readonly timezone: string;
  readonly title: string;
}

/** What a course is called and which clock it keeps, for a heading or a file. */
async function courseNamingFor(
  context: Context<AppBindings>,
  courseId: string,
): Promise<CourseNaming> {
  const course = await storesForContext(context).courses.getById(courseId);
  const i18n = context.get("i18n");

  return {
    timezone: course?.timezone ?? "UTC",
    // Our own placeholder for a title we could not read, not an author's text —
    // so it belongs in the reader's language like the chrome around it.
    title: course?.title ?? i18n.t("Course"),
  };
}

async function courseTitleFor(
  context: Context<AppBindings>,
  courseId: string,
): Promise<string> {
  return (await courseNamingFor(context, courseId)).title;
}

function publicAssignment(assignment: Assignment) {
  return {
    dueAt: assignment.dueAt,
    gradesVisibleAt: assignment.gradesVisibleAt,
    id: assignment.id,
    title: assignment.title,
  };
}

function publicScore(score: AssignmentScore) {
  return {
    assignmentId: score.assignmentId,
    calculatedAt: score.calculatedAt,
    maxScore: score.maxScore,
    score: score.score,
    status: score.status,
    userId: score.userId,
  };
}

function webActorOrLogin(context: Context<AppBindings>): Response | null {
  if (context.get("actor") !== null) {
    return null;
  }

  const next = new URL(context.req.url).pathname;

  return redirect(`/login?next=${encodeURIComponent(next)}`, 302);
}

function assignmentGradebookJson(gradebook: AssignmentGradebook) {
  return {
    assignment: publicAssignment(gradebook.assignment),
    // The exercises the score is out of, and each row's points against them by
    // the same position — the shape the CSV export writes as columns.
    exercises: gradebook.exercises,
    rows: gradebook.rows.map((row) => ({
      exerciseScores: row.exerciseScores,
      score: publicScore(row.score),
      user: {
        email: row.user.email,
        id: row.user.id,
        name: row.user.name,
      },
    })),
  };
}

function courseGradebookJson(gradebook: CourseGradebook) {
  return {
    assignments: gradebook.assignments.map(publicAssignment),
    rows: gradebook.rows.map((row) => ({
      scores: row.scores.map((score) =>
        score === null ? null : publicScore(score),
      ),
      user: {
        email: row.user.email,
        id: row.user.id,
        name: row.user.name,
      },
    })),
  };
}

async function courseGradebook(context: Context<AppBindings>) {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const gradebook = await gradebookService(context).getCourseGradebook(
    actor,
    courseId,
  );

  if (wantsHtml(context)) {
    return renderCourseGradebook(
      context,
      courseId,
      await courseTitleFor(context, courseId),
      gradebook,
    );
  }

  return context.json(courseGradebookJson(gradebook));
}

async function assignmentGradebook(context: Context<AppBindings>) {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const gradebook = await gradebookService(context).getAssignmentGradebook(
    actor,
    courseId,
    requiredParam(context, "assignmentId"),
  );

  if (wantsHtml(context)) {
    return renderAssignmentGradebook(
      context,
      courseId,
      await courseTitleFor(context, courseId),
      gradebook,
    );
  }

  return context.json(assignmentGradebookJson(gradebook));
}

async function assignmentCsv(context: Context<AppBindings>) {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const gradebook = await gradebookService(context).getAssignmentGradebook(
    actor,
    courseId,
    requiredParam(context, "assignmentId"),
  );
  const course = await courseNamingFor(context, courseId);

  return new Response(assignmentGradebookCsv(gradebook), {
    headers: csvDownloadHeaders({
      at: new Date(),
      parts: [course.title, gradebook.assignment.title],
      timezone: course.timezone,
    }),
  });
}

async function courseCsv(context: Context<AppBindings>) {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const gradebook = await gradebookService(context).getCourseGradebook(
    actor,
    courseId,
  );
  const course = await courseNamingFor(context, courseId);
  const i18n = context.get("i18n");

  return new Response(courseGradebookCsv(gradebook), {
    headers: csvDownloadHeaders({
      at: new Date(),
      // Where the per-assignment export names its assignment. Two files from
      // the same course an hour apart are told apart by the stamp; this is what
      // tells them apart from each other.
      parts: [course.title, i18n.t("All grades")],
      timezone: course.timezone,
    }),
  });
}

async function studentScore(context: Context<AppBindings>) {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");

  if (wantsHtml(context)) {
    return redirect(
      `/courses/${courseId}/assignments/${assignmentId}/results`,
    );
  }

  const result = await gradebookService(context).getStudentAssignmentScore(
    actor,
    courseId,
    assignmentId,
  );

  return context.json({
    released: result.released,
    score: publicScore(result.score),
  });
}

async function studentResults(context: Context<AppBindings>) {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const assignmentId = requiredParam(context, "assignmentId");
  const i18n = context.get("i18n");
  const results = await submissionService(context).listResultsForStudent(
    actor,
    courseId,
    assignmentId,
    i18n,
  );
  const assignment =
    await storesForContext(context).assignments.getById(assignmentId);

  return renderStudentAssignmentResults(context, {
    assignmentId,
    assignmentTitle: assignment?.title ?? i18n.t("Assignment"),
    courseId,
    courseTitle: await courseTitleFor(context, courseId),
    results,
  });
}

export const gradebookRoutes = new Hono<AppBindings>();

gradebookRoutes.get("/:courseId/instructor/gradebook", (context) =>
  courseGradebook(context),
);

gradebookRoutes.get("/:courseId/instructor/grades.csv", (context) =>
  courseCsv(context),
);

gradebookRoutes.get(
  "/:courseId/instructor/assignments/:assignmentId/gradebook",
  (context) => assignmentGradebook(context),
);

gradebookRoutes.get(
  "/:courseId/instructor/assignments/:assignmentId/grades.csv",
  (context) => assignmentCsv(context),
);

gradebookRoutes.get("/:courseId/assignments/:assignmentId/score", (context) =>
  studentScore(context),
);

gradebookRoutes.get(
  "/:courseId/assignments/:assignmentId/results",
  (context) => studentResults(context),
);
