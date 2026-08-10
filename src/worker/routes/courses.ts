import { type Context, Hono } from "hono";

import { AssignmentService } from "../application/assignments";
import { requireAuthenticated } from "../application/authorization";
import { CourseService } from "../application/courses";
import { AppHttpError, badRequest } from "../application/errors";
import { GradePassbackService } from "../application/grade-passback";
import { GradebookService } from "../application/gradebook";
import type {
  Course,
  CourseAccommodation,
  CourseEnrollmentLink,
  CourseMembership,
} from "../domain/courses";
import { timestampNow } from "../domain/time";
import type { AppBindings } from "../http";
import type { Translator } from "../i18n/translator";
import { storesForContext } from "../stores";
import {
  renderCourseDetail,
  renderCourseError,
  renderCourseList,
  renderCourseListError,
  renderEnrollmentPage,
} from "../web/courses";
import {
  fieldValue,
  isFormSubmission,
  redirect,
  wantsHtml,
} from "../web/html";
import { resolveUsers } from "../web/users";
import { ltiServiceForContext } from "./lti";

interface CreateCourseBody {
  readonly title?: unknown;
  readonly timezone?: unknown;
}

interface UpdateCourseBody {
  readonly title?: unknown;
  readonly timezone?: unknown;
}

interface CreateEnrollmentLinkBody {
  readonly expiresAt?: unknown;
}

interface UpdateMembershipStatusBody {
  readonly status?: unknown;
}

interface AddStaffBody {
  readonly role?: unknown;
  readonly userId?: unknown;
}

interface AccommodationBody {
  readonly availableUntilExtensionMinutes?: unknown;
  readonly dueAtExtensionMinutes?: unknown;
  readonly extraAttempts?: unknown;
  readonly timeLimitMultiplier?: unknown;
  readonly userId?: unknown;
}

interface CloneCourseBody {
  readonly title?: unknown;
}

function assignmentService(context: Context<AppBindings>): AssignmentService {
  return new AssignmentService({ stores: storesForContext(context) });
}

function courseService(context: Context<AppBindings>): CourseService {
  return new CourseService({ stores: storesForContext(context) });
}

function gradebookService(context: Context<AppBindings>): GradebookService {
  return new GradebookService({ stores: storesForContext(context) });
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

function publicCourse(course: Course) {
  return {
    id: course.id,
    title: course.title,
    timezone: course.timezone,
    createdById: course.createdById,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    archivedAt: course.archivedAt,
  };
}

function publicMembership(membership: CourseMembership) {
  return {
    id: membership.id,
    courseId: membership.courseId,
    userId: membership.userId,
    role: membership.role,
    status: membership.status,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
}

function publicAccommodation(accommodation: CourseAccommodation) {
  return {
    availableUntilExtensionMinutes:
      accommodation.availableUntilExtensionMinutes,
    courseId: accommodation.courseId,
    dueAtExtensionMinutes: accommodation.dueAtExtensionMinutes,
    extraAttempts: accommodation.extraAttempts,
    id: accommodation.id,
    timeLimitMultiplier: accommodation.timeLimitMultiplier,
    userId: accommodation.userId,
  };
}

function publicEnrollmentLink(
  enrollmentLink: CourseEnrollmentLink,
  token?: string,
) {
  return {
    id: enrollmentLink.id,
    courseId: enrollmentLink.courseId,
    token,
    enrollmentPath: token === undefined ? undefined : `/enrollments/${token}`,
    createdById: enrollmentLink.createdById,
    createdAt: enrollmentLink.createdAt,
    expiresAt: enrollmentLink.expiresAt,
    revokedAt: enrollmentLink.revokedAt,
  };
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

function canCreateCourse(
  actor: NonNullable<AppBindings["Variables"]["actor"]>,
): boolean {
  return actor.capabilities.some(
    (grant) =>
      grant.revokedAt === null &&
      (grant.capability === "course_creator" ||
        grant.capability === "site_admin"),
  );
}

/**
 * The flash notices this page can show, keyed by the query parameter that asks
 * for one — a redirect names a *reason*, so no sentence travels in a URL. A
 * function rather than a table because a reason is only a sentence once a
 * language is known.
 */
function detailNotices(
  i18n: Translator,
): readonly { readonly message: string; readonly param: string }[] {
  return [
    { message: i18n.t("Course created."), param: "created" },
    { message: i18n.t("Course cloned."), param: "cloned" },
    { message: i18n.t("Course updated."), param: "courseUpdated" },
    { message: i18n.t("Course archived."), param: "archived" },
    { message: i18n.t("Course unarchived."), param: "unarchived" },
    { message: i18n.t("You have joined the course."), param: "enrolled" },
    {
      message: i18n.t("Accommodation saved."),
      param: "accommodationSaved",
    },
    { message: i18n.t("Enrollment link revoked."), param: "revoked" },
    { message: i18n.t("Membership updated."), param: "membershipUpdated" },
    { message: i18n.t("Staff member added."), param: "staffAdded" },
    {
      message: i18n.t("Draft assignment deleted."),
      param: "assignmentDeleted",
    },
    {
      message: i18n.t("LMS activity linked to the assignment."),
      param: "ltiLinked",
    },
    {
      message: i18n.t("Grade delivery re-queued."),
      param: "gradeSyncRetried",
    },
  ];
}

function collectDetailNotices(url: URL, i18n: Translator): readonly string[] {
  return detailNotices(i18n)
    .filter((entry) => url.searchParams.has(entry.param))
    .map((entry) => entry.message);
}

async function courseListPage(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const courses = await courseService(context).listCourses(actor);

  return renderCourseList(context, {
    canCreate: canCreateCourse(actor),
    courses,
  });
}

async function createCourseFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const form = await context.req.raw.formData();
  const title = fieldValue(form.get("title"));
  const timezone = fieldValue(form.get("timezone"));

  try {
    const created = await courseService(context).createCourse(actor, {
      timezone,
      title,
    });

    return redirect(`/courses/${created.course.id}?created=1`);
  } catch (error) {
    if (error instanceof AppHttpError) {
      return renderCourseListError(context, {
        message: error.localize(context.get("i18n")),
        status: error.status,
        title,
      });
    }

    throw error;
  }
}

async function updateCourseFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const form = await context.req.raw.formData();
  const title = fieldValue(form.get("title"));
  const timezone = fieldValue(form.get("timezone"));

  try {
    await courseService(context).updateCourse(actor, courseId, {
      timezone,
      title,
    });

    return redirect(`/courses/${courseId}?courseUpdated=1`);
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderCourseError(context, {
        message: error.localize(i18n),
        status: error.status,
        title: i18n.t("Course not updated"),
      });
    }

    throw error;
  }
}

async function setCourseArchivedFromForm(
  context: Context<AppBindings>,
  archived: boolean,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");

  try {
    await courseService(context).setCourseArchived(actor, courseId, archived);

    return redirect(
      `/courses/${courseId}?${archived ? "archived" : "unarchived"}=1`,
    );
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderCourseError(context, {
        message: error.localize(i18n),
        status: error.status,
        title: archived
          ? i18n.t("Course not archived")
          : i18n.t("Course not unarchived"),
      });
    }

    throw error;
  }
}

async function courseDetailPage(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const url = new URL(context.req.url);
  const service = courseService(context);

  try {
    const detail = await service.getCourseDetail(
      actor,
      requiredParam(context, "courseId"),
    );
    const isInstructor =
      detail.membership.role === "instructor" ||
      detail.membership.role === "co_instructor";
    const token = url.searchParams.get("enrollToken");
    const newEnrollmentLinkUrl =
      token === null
        ? null
        : new URL(`/enrollments/${token}`, context.req.url).href;
    const enrollmentLinks = isInstructor
      ? await service.listEnrollmentLinks(actor, detail.course.id)
      : [];
    const assignments = isInstructor
      ? await assignmentService(context).listForInstructor(
          actor,
          detail.course.id,
        )
      : await assignmentService(context).listForStudent(
          actor,
          detail.course.id,
        );
    const scorecard = isInstructor
      ? []
      : await gradebookService(context).getStudentCourseScorecard(
          actor,
          detail.course.id,
        );
    const unmappedLtiLinks = isInstructor
      ? await ltiServiceForContext(context).listUnmappedResourceLinks(
          actor,
          detail.course.id,
        )
      : [];
    const gradeSyncFailures = isInstructor
      ? await new GradePassbackService({
          sender: null,
          stores: storesForContext(context),
        }).listFailedJobs(actor, detail.course.id)
      : [];

    const directory = await resolveUsers(context, [
      detail.course.createdById,
      ...detail.memberships.map((membership) => membership.userId),
    ]);

    return renderCourseDetail(context, {
      accommodations: detail.accommodations,
      assignments,
      course: detail.course,
      directory,
      enrollmentLinks,
      gradeSyncFailures,
      isInstructor,
      membership: detail.membership,
      memberships: detail.memberships,
      newEnrollmentLinkUrl,
      notices: collectDetailNotices(url, context.get("i18n")),
      now: timestampNow(),
      scorecard,
      unmappedLtiLinks,
    });
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderCourseError(context, {
        message: error.localize(i18n),
        status: error.status,
        title: i18n.t("Course unavailable"),
      });
    }

    throw error;
  }
}

async function createEnrollmentLinkFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const form = await context.req.raw.formData();
  const expiresAt = fieldValue(form.get("expiresAt"));
  const courseId = requiredParam(context, "courseId");

  try {
    const created = await courseService(context).createEnrollmentLink(
      actor,
      courseId,
      { expiresAt: expiresAt.length === 0 ? null : expiresAt },
    );

    return redirect(
      `/courses/${courseId}?enrollToken=${encodeURIComponent(created.token)}`,
    );
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderCourseError(context, {
        message: error.localize(i18n),
        status: error.status,
        title: i18n.t("Enrollment link not created"),
      });
    }

    throw error;
  }
}

async function revokeEnrollmentLinkFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");

  try {
    await courseService(context).revokeEnrollmentLink(
      actor,
      courseId,
      requiredParam(context, "linkId"),
    );

    return redirect(`/courses/${courseId}?revoked=1`);
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderCourseError(context, {
        message: error.localize(i18n),
        status: error.status,
        title: i18n.t("Enrollment link not revoked"),
      });
    }

    throw error;
  }
}

function addStaffCommandFromJson(body: AddStaffBody) {
  if (typeof body.userId !== "string") {
    throw badRequest("invalid_user_id", "User ID must be a string.");
  }

  if (typeof body.role !== "string") {
    throw badRequest("invalid_course_role", "Role must be a string.");
  }

  return {
    role: body.role as "co_instructor" | "instructor" | "teacher_assistant",
    userId: body.userId,
  };
}

function formNumberOrNull(form: FormData, name: string): number | null {
  const value = fieldValue(form.get(name));

  return value.length === 0 ? null : Number(value);
}

function accommodationCommandFromForm(form: FormData) {
  return accommodationCommandFromJson({
    availableUntilExtensionMinutes: formNumberOrNull(
      form,
      "availableUntilExtensionMinutes",
    ),
    dueAtExtensionMinutes: formNumberOrNull(form, "dueAtExtensionMinutes"),
    extraAttempts: formNumberOrNull(form, "extraAttempts"),
    timeLimitMultiplier: formNumberOrNull(form, "timeLimitMultiplier"),
    userId: fieldValue(form.get("userId")),
  });
}

function cloneCourseCommandFromForm(form: FormData) {
  // An empty field reaches `cloneCourse` as an empty title and comes back as
  // `invalid_course_title`, the same answer `POST /courses` gives. The clone bar
  // marks the field `required`, so the browser normally asks first.
  return { title: fieldValue(form.get("title")) };
}

function numberOrNull(value: unknown, code: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "number") {
    throw badRequest(code, "Field must be a number.");
  }

  return value;
}

function accommodationCommandFromJson(body: AccommodationBody) {
  if (typeof body.userId !== "string") {
    throw badRequest("invalid_user_id", "User ID must be a string.");
  }

  return {
    availableUntilExtensionMinutes: numberOrNull(
      body.availableUntilExtensionMinutes,
      "invalid_available_until_extension",
    ),
    dueAtExtensionMinutes: numberOrNull(
      body.dueAtExtensionMinutes,
      "invalid_due_at_extension",
    ),
    extraAttempts: numberOrNull(body.extraAttempts, "invalid_extra_attempts"),
    timeLimitMultiplier: numberOrNull(
      body.timeLimitMultiplier,
      "invalid_time_limit_multiplier",
    ),
    userId: body.userId,
  };
}

function cloneCourseCommandFromJson(body: CloneCourseBody) {
  if (typeof body.title !== "string") {
    throw badRequest("invalid_course_title", "Title must be a string.");
  }

  return { title: body.title };
}

export const courseRoutes = new Hono<AppBindings>();
export const enrollmentRoutes = new Hono<AppBindings>();

courseRoutes.post("/", async (context) => {
  if (isFormSubmission(context)) {
    return createCourseFromForm(context);
  }

  const actor = requireAuthenticated(context);
  const body = (await readJsonObject(context)) as CreateCourseBody;

  if (typeof body.title !== "string") {
    throw badRequest(
      "invalid_course_title",
      "Course title must be a string.",
    );
  }

  if (
    body.timezone !== undefined &&
    body.timezone !== null &&
    typeof body.timezone !== "string"
  ) {
    throw badRequest(
      "invalid_course_timezone",
      "Course timezone must be a string.",
    );
  }

  const created = await courseService(context).createCourse(actor, {
    title: body.title,
    timezone: typeof body.timezone === "string" ? body.timezone : null,
  });

  return context.json(
    {
      course: publicCourse(created.course),
      membership: publicMembership(created.membership),
    },
    201,
  );
});

courseRoutes.get("/", async (context) => {
  if (wantsHtml(context)) {
    return courseListPage(context);
  }

  const actor = requireAuthenticated(context);
  const courses = await courseService(context).listCourses(actor);

  return context.json({
    courses: courses.map((entry) => ({
      course: publicCourse(entry.course),
      membership: publicMembership(entry.membership),
    })),
  });
});

courseRoutes.get("/:courseId", async (context) => {
  if (wantsHtml(context)) {
    return courseDetailPage(context);
  }

  const actor = requireAuthenticated(context);
  const detail = await courseService(context).getCourseDetail(
    actor,
    requiredParam(context, "courseId"),
  );

  return context.json({
    course: publicCourse(detail.course),
    membership: publicMembership(detail.membership),
    memberships: detail.memberships.map(publicMembership),
  });
});

courseRoutes.post("/:courseId", async (context) => {
  if (isFormSubmission(context)) {
    return updateCourseFromForm(context);
  }

  const actor = requireAuthenticated(context);
  const body = (await readJsonObject(context)) as UpdateCourseBody;

  if (typeof body.title !== "string") {
    throw badRequest(
      "invalid_course_title",
      "Course title must be a string.",
    );
  }

  if (
    body.timezone !== undefined &&
    body.timezone !== null &&
    typeof body.timezone !== "string"
  ) {
    throw badRequest(
      "invalid_course_timezone",
      "Course timezone must be a string.",
    );
  }

  const course = await courseService(context).updateCourse(
    actor,
    requiredParam(context, "courseId"),
    {
      title: body.title,
      timezone: typeof body.timezone === "string" ? body.timezone : null,
    },
  );

  return context.json({ course: publicCourse(course) });
});

courseRoutes.post("/:courseId/archive", async (context) => {
  if (isFormSubmission(context)) {
    return setCourseArchivedFromForm(context, true);
  }

  const actor = requireAuthenticated(context);
  const course = await courseService(context).setCourseArchived(
    actor,
    requiredParam(context, "courseId"),
    true,
  );

  return context.json({ course: publicCourse(course) });
});

courseRoutes.post("/:courseId/unarchive", async (context) => {
  if (isFormSubmission(context)) {
    return setCourseArchivedFromForm(context, false);
  }

  const actor = requireAuthenticated(context);
  const course = await courseService(context).setCourseArchived(
    actor,
    requiredParam(context, "courseId"),
    false,
  );

  return context.json({ course: publicCourse(course) });
});

courseRoutes.post("/:courseId/enrollment-links", async (context) => {
  if (isFormSubmission(context)) {
    return createEnrollmentLinkFromForm(context);
  }

  const actor = requireAuthenticated(context);
  const body = (await readJsonObject(context)) as CreateEnrollmentLinkBody;

  if (
    body.expiresAt !== undefined &&
    body.expiresAt !== null &&
    typeof body.expiresAt !== "string"
  ) {
    throw badRequest(
      "invalid_enrollment_link_expiration",
      "Enrollment link expiration must be a string.",
    );
  }

  const created = await courseService(context).createEnrollmentLink(
    actor,
    requiredParam(context, "courseId"),
    { expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null },
  );

  return context.json(
    {
      enrollmentLink: publicEnrollmentLink(
        created.enrollmentLink,
        created.token,
      ),
    },
    201,
  );
});

courseRoutes.post(
  "/:courseId/enrollment-links/:linkId/revoke",
  async (context) => {
    if (isFormSubmission(context)) {
      return revokeEnrollmentLinkFromForm(context);
    }

    const actor = requireAuthenticated(context);
    const enrollmentLink = await courseService(context).revokeEnrollmentLink(
      actor,
      requiredParam(context, "courseId"),
      requiredParam(context, "linkId"),
    );

    return context.json({
      enrollmentLink: publicEnrollmentLink(enrollmentLink),
    });
  },
);

async function addStaffFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");

  try {
    const form = await context.req.raw.formData();

    await courseService(context).addStaffByEmail(actor, courseId, {
      email: fieldValue(form.get("email")),
      role: fieldValue(form.get("role")) as
        | "co_instructor"
        | "instructor"
        | "teacher_assistant",
    });

    return redirect(`/courses/${courseId}?staffAdded=1`);
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderCourseError(context, {
        message: error.localize(i18n),
        status: error.status,
        title: i18n.t("Staff member not added"),
      });
    }

    throw error;
  }
}

courseRoutes.post("/:courseId/staff", async (context) => {
  if (isFormSubmission(context)) {
    return addStaffFromForm(context);
  }

  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const command = addStaffCommandFromJson(
    (await readJsonObject(context)) as AddStaffBody,
  );
  const membership = await courseService(context).addStaff(
    actor,
    courseId,
    command,
  );

  return context.json({ membership: publicMembership(membership) }, 201);
});

async function upsertAccommodationFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");

  try {
    const command = accommodationCommandFromForm(
      await context.req.raw.formData(),
    );
    await courseService(context).upsertAccommodation(
      actor,
      courseId,
      command,
    );

    return redirect(`/courses/${courseId}?accommodationSaved=1`);
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderCourseError(context, {
        message: error.localize(i18n),
        status: error.status,
        title: i18n.t("Accommodation not saved"),
      });
    }

    throw error;
  }
}

courseRoutes.post("/:courseId/accommodations", async (context) => {
  if (isFormSubmission(context)) {
    return upsertAccommodationFromForm(context);
  }

  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const command = accommodationCommandFromJson(
    (await readJsonObject(context)) as AccommodationBody,
  );
  const accommodation = await courseService(context).upsertAccommodation(
    actor,
    courseId,
    command,
  );

  return context.json({ accommodation: publicAccommodation(accommodation) });
});

async function cloneCourseFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");

  try {
    const command = cloneCourseCommandFromForm(
      await context.req.raw.formData(),
    );
    const cloned = await courseService(context).cloneCourse(
      actor,
      courseId,
      command,
    );

    return redirect(`/courses/${cloned.course.id}?cloned=1`);
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderCourseError(context, {
        message: error.localize(i18n),
        status: error.status,
        title: i18n.t("Course not cloned"),
      });
    }

    throw error;
  }
}

courseRoutes.post("/:courseId/clone", async (context) => {
  if (isFormSubmission(context)) {
    return cloneCourseFromForm(context);
  }

  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const command = cloneCourseCommandFromJson(
    (await readJsonObject(context)) as CloneCourseBody,
  );
  const cloned = await courseService(context).cloneCourse(
    actor,
    courseId,
    command,
  );

  return context.json(
    {
      assignmentsCloned: cloned.assignmentsCloned,
      course: publicCourse(cloned.course),
      membership: publicMembership(cloned.membership),
    },
    201,
  );
});

courseRoutes.patch(
  "/:courseId/memberships/:membershipId",
  async (context) => {
    const actor = requireAuthenticated(context);
    const body = (await readJsonObject(
      context,
    )) as UpdateMembershipStatusBody;

    if (typeof body.status !== "string") {
      throw badRequest(
        "invalid_membership_status",
        "Membership status must be a string.",
      );
    }

    const membership = await courseService(context).updateMembershipStatus(
      actor,
      requiredParam(context, "courseId"),
      requiredParam(context, "membershipId"),
      { status: body.status as CourseMembership["status"] },
    );

    return context.json({ membership: publicMembership(membership) });
  },
);

courseRoutes.post("/:courseId/memberships/:membershipId", async (context) => {
  const actor = requireAuthenticated(context);
  const courseId = requiredParam(context, "courseId");
  const membershipId = requiredParam(context, "membershipId");
  const service = courseService(context);

  try {
    const form = await context.req.raw.formData();

    await service.updateMembershipRole(actor, courseId, membershipId, {
      role: fieldValue(form.get("role")) as CourseMembership["role"],
    });
    await service.updateMembershipStatus(actor, courseId, membershipId, {
      status: fieldValue(form.get("status")) as CourseMembership["status"],
    });

    return redirect(`/courses/${courseId}?membershipUpdated=1`);
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderCourseError(context, {
        message: error.localize(i18n),
        status: error.status,
        title: i18n.t("Membership not updated"),
      });
    }

    throw error;
  }
});

enrollmentRoutes.get("/:token", (context) => {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  return renderEnrollmentPage(context, requiredParam(context, "token"));
});

enrollmentRoutes.post("/:token", async (context) => {
  const actor = requireAuthenticated(context);
  const accepted = await courseService(context).acceptEnrollmentLink(
    actor,
    requiredParam(context, "token"),
  );

  if (isFormSubmission(context)) {
    return redirect(`/courses/${accepted.course.id}?enrolled=1`);
  }

  return context.json({
    course: publicCourse(accepted.course),
    membership: publicMembership(accepted.membership),
  });
});
