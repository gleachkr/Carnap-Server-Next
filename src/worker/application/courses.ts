import type {
  Course,
  CourseAccommodation,
  CourseEnrollmentLink,
  CourseMembership,
} from "../domain/courses";
import type { AppId } from "../domain/ids";
import { createAppId } from "../domain/ids";
import { addSeconds, isTimestamp, timestampNow } from "../domain/time";
import { deferred } from "../i18n/deferred";
import type { AuthenticatedActor } from "./auth";
import {
  requireCourseRole,
  requireInstructor,
  requirePlatformCapability,
} from "./authorization";
import { AppHttpError, badRequest, forbidden } from "./errors";
import type { AppStores } from "./stores";
import { createAuthToken, hashAuthToken } from "./tokens";

export const ENROLLMENT_LINK_TTL_SECONDS = 60 * 60 * 24 * 14;

const COURSE_TITLE_MAX_LENGTH = 200;
const TIMEZONE_MAX_LENGTH = 100;

export interface CreateCourseCommand {
  readonly title: string;
  readonly timezone?: string | null;
}

export interface UpdateCourseCommand {
  readonly title: string;
  readonly timezone?: string | null;
}

export interface CreatedCourseResult {
  readonly course: Course;
  readonly membership: CourseMembership;
}

export interface ListedCourse {
  readonly course: Course;
  readonly membership: CourseMembership;
}

export interface CourseDetail {
  readonly accommodations: readonly CourseAccommodation[];
  readonly course: Course;
  readonly membership: CourseMembership;
  readonly memberships: readonly CourseMembership[];
}

export interface CreatedEnrollmentLink {
  readonly enrollmentLink: CourseEnrollmentLink;
  readonly token: string;
}

export interface CreateEnrollmentLinkCommand {
  readonly expiresAt?: string | null;
}

export interface UpdateMembershipStatusCommand {
  readonly status: CourseMembership["status"];
}

export interface UpdateMembershipRoleCommand {
  readonly role: CourseMembership["role"];
}

export interface AddCourseStaffCommand {
  readonly role: "co_instructor" | "instructor" | "teacher_assistant";
  readonly userId: AppId;
}

export interface AddCourseStaffByEmailCommand {
  readonly email: string;
  readonly role: "co_instructor" | "instructor" | "teacher_assistant";
}

export interface UpsertAccommodationCommand {
  readonly availableUntilExtensionMinutes?: number | null;
  readonly dueAtExtensionMinutes?: number | null;
  readonly extraAttempts?: number | null;
  readonly timeLimitMultiplier?: number | null;
  readonly userId: AppId;
}

export interface CloneCourseCommand {
  readonly title: string;
}

export interface ClonedCourseResult {
  readonly assignmentsCloned: number;
  readonly course: Course;
  readonly membership: CourseMembership;
}

export interface CourseServiceOptions {
  readonly stores: AppStores;
  readonly now?: () => Date;
}

function normalizeTitle(title: string): string {
  return title.trim();
}

function assertTitle(title: string): void {
  if (title.length === 0 || title.length > COURSE_TITLE_MAX_LENGTH) {
    throw badRequest(
      "invalid_course_title",
      deferred.i18n.t("Course title must be between 1 and 200 characters."),
    );
  }
}

function normalizeTimezone(timezone: string | null | undefined): string {
  const normalized = timezone?.trim() ?? "UTC";

  return normalized.length === 0 ? "UTC" : normalized;
}

function assertTimezone(timezone: string): void {
  if (timezone.length > TIMEZONE_MAX_LENGTH) {
    throw badRequest(
      "invalid_course_timezone",
      deferred.i18n.t("Course timezone must be 100 characters or less."),
    );
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(
      new Date(0),
    );
  } catch (_error) {
    throw badRequest(
      "invalid_course_timezone",
      deferred.i18n.t("Course timezone must be a valid IANA timezone name."),
    );
  }
}

function assertExpiresAt(expiresAt: string): void {
  if (!isTimestamp(expiresAt)) {
    throw badRequest(
      "invalid_enrollment_link_expiration",
      deferred.i18n.t("Enrollment link expiration must be an ISO timestamp."),
    );
  }
}

function assertStatus(
  status: string,
): asserts status is CourseMembership["status"] {
  if (!["active", "invited", "suspended", "dropped"].includes(status)) {
    throw badRequest(
      "invalid_membership_status",
      deferred.i18n.t("Membership status is not supported."),
    );
  }
}

function enrollmentLinkUnavailable(): AppHttpError {
  return new AppHttpError(
    404,
    "enrollment_link_invalid",
    deferred.i18n.t("The enrollment link is invalid or expired."),
  );
}

function courseNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "course_not_found",
    deferred.i18n.t("The course was not found."),
  );
}

function assertStaffRole(
  role: string,
): asserts role is AddCourseStaffCommand["role"] {
  if (
    role !== "co_instructor" &&
    role !== "instructor" &&
    role !== "teacher_assistant"
  ) {
    throw badRequest(
      "invalid_course_role",
      deferred.i18n.t("Course role is not supported."),
    );
  }
}

function assertMembershipRole(
  role: string,
): asserts role is CourseMembership["role"] {
  if (
    role !== "co_instructor" &&
    role !== "instructor" &&
    role !== "student" &&
    role !== "teacher_assistant"
  ) {
    throw badRequest(
      "invalid_course_role",
      deferred.i18n.t("Course role is not supported."),
    );
  }
}

/**
 * An active membership that can manage the course — an instructor or
 * co-instructor who has not been suspended or dropped. Used to guard against
 * demoting or deactivating the last such member and orphaning the course.
 */
function managesCourse(membership: CourseMembership): boolean {
  return (
    membership.status === "active" &&
    (membership.role === "instructor" || membership.role === "co_instructor")
  );
}

function nonNegativeInteger(
  value: number | null | undefined,
  fallback: number,
  code: string,
): number {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw badRequest(
      code,
      deferred.i18n.t("Value must be a non-negative integer."),
    );
  }

  return value;
}

function positiveNumber(
  value: number | null | undefined,
  fallback: number,
  code: string,
): number {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw badRequest(
      code,
      deferred.i18n.t("Value must be greater than zero."),
    );
  }

  return value;
}

export class CourseService {
  constructor(private readonly options: CourseServiceOptions) {}

  async createCourse(
    actor: AuthenticatedActor,
    command: CreateCourseCommand,
  ): Promise<CreatedCourseResult> {
    requirePlatformCapability(actor, ["course_creator", "site_admin"]);

    const title = normalizeTitle(command.title);
    const timezone = normalizeTimezone(command.timezone);

    assertTitle(title);
    assertTimezone(timezone);

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    const course = await this.options.stores.courses.create({
      id: createAppId(nowDate.getTime()),
      title,
      timezone,
      createdAt: now,
      createdById: actor.user.id,
    });
    const membership = await this.options.stores.courses.addMembership({
      id: createAppId(nowDate.getTime()),
      courseId: course.id,
      userId: actor.user.id,
      role: "instructor",
      status: "active",
      createdAt: now,
    });

    return { course, membership };
  }

  async updateCourse(
    actor: AuthenticatedActor,
    courseId: AppId,
    command: UpdateCourseCommand,
  ): Promise<Course> {
    await requireInstructor(this.options.stores, actor, courseId);

    const title = normalizeTitle(command.title);
    const timezone = normalizeTimezone(command.timezone);

    assertTitle(title);
    assertTimezone(timezone);

    const updated = await this.options.stores.courses.updateInfo({
      id: courseId,
      title,
      timezone,
      updatedAt: timestampNow(this.options.now?.() ?? new Date()),
    });

    if (updated === null) {
      throw courseNotFound();
    }

    return updated;
  }

  async setCourseArchived(
    actor: AuthenticatedActor,
    courseId: AppId,
    archived: boolean,
  ): Promise<Course> {
    await requireInstructor(this.options.stores, actor, courseId);

    const now = timestampNow(this.options.now?.() ?? new Date());
    const updated = await this.options.stores.courses.setArchived({
      id: courseId,
      archivedAt: archived ? now : null,
      updatedAt: now,
    });

    if (updated === null) {
      throw courseNotFound();
    }

    return updated;
  }

  /**
   * Every course the actor belongs to, archived ones included. Archiving is
   * staff housekeeping and the list is where it shows: the caller separates
   * the archived courses out (the web list folds them into a closed drawer).
   *
   * This used to drop archived courses for students, on the reasoning that
   * they still had direct access to their records. In practice "direct
   * access" meant "if they bookmarked the URL": an archived course was
   * reachable and nowhere linked, so a student lost the way back to their own
   * graded work the moment a term was tidied up — and a student whose only
   * course was archived got "You are not enrolled in any courses yet" on a
   * page that had just promised them their historical memberships.
   */
  async listCourses(actor: AuthenticatedActor): Promise<ListedCourse[]> {
    return await this.options.stores.courses.listForUser(actor.user.id);
  }

  async getCourseDetail(
    actor: AuthenticatedActor,
    courseId: AppId,
  ): Promise<CourseDetail> {
    const membership = await requireCourseRole(
      this.options.stores,
      actor,
      courseId,
      ["member"],
    );
    const course = await this.options.stores.courses.getById(courseId);

    // Unreachable in practice, and worth saying so because it is untestable for
    // the same reason: nothing deletes a course (archiving keeps the row), and
    // `course_memberships.course_id` is `ON DELETE cascade`, so a membership
    // cannot outlive its course. The branch exists because `getById` is nullable,
    // and it used to answer with `enrollmentLinkUnavailable()` — telling a reader
    // who had named a *course* that their enrollment link was invalid.
    if (course === null) {
      throw courseNotFound();
    }

    const isInstructor =
      membership.role === "instructor" || membership.role === "co_instructor";
    const [memberships, accommodations] = isInstructor
      ? await Promise.all([
          this.options.stores.courses.listMembershipsForCourse(courseId),
          this.options.stores.courses.listAccommodationsForCourse(courseId),
        ])
      : [[], []];

    return { accommodations, course, membership, memberships };
  }

  async listEnrollmentLinks(
    actor: AuthenticatedActor,
    courseId: AppId,
  ): Promise<CourseEnrollmentLink[]> {
    await requireInstructor(this.options.stores, actor, courseId);

    return this.options.stores.courses.listEnrollmentLinksForCourse(courseId);
  }

  async createEnrollmentLink(
    actor: AuthenticatedActor,
    courseId: AppId,
    command: CreateEnrollmentLinkCommand = {},
  ): Promise<CreatedEnrollmentLink> {
    await requireInstructor(this.options.stores, actor, courseId);

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    const expiresAt =
      command.expiresAt ?? addSeconds(nowDate, ENROLLMENT_LINK_TTL_SECONDS);

    assertExpiresAt(expiresAt);

    if (expiresAt <= now) {
      throw badRequest(
        "invalid_enrollment_link_expiration",
        deferred.i18n.t("Enrollment link expiration must be in the future."),
      );
    }

    const token = createAuthToken("aenr");
    const enrollmentLink =
      await this.options.stores.courses.createEnrollmentLink({
        id: createAppId(nowDate.getTime()),
        courseId,
        tokenHash: await hashAuthToken(token),
        createdById: actor.user.id,
        createdAt: now,
        expiresAt,
      });

    return { enrollmentLink, token };
  }

  async acceptEnrollmentLink(
    actor: AuthenticatedActor,
    token: string,
  ): Promise<CreatedCourseResult> {
    if (token.trim().length === 0) {
      throw enrollmentLinkUnavailable();
    }

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    const link = await this.options.stores.courses.getValidEnrollmentLink(
      await hashAuthToken(token),
      now,
    );

    if (link === null) {
      throw enrollmentLinkUnavailable();
    }

    const course = await this.options.stores.courses.getById(link.courseId);

    // Deliberately the link's complaint and not `courseNotFound()`, unlike the
    // two lookups above: someone following an invitation chose a link, not a
    // course, and an orphaned link is a link to ask for again. The other sites
    // read the *course* the reader already named, where naming the link instead
    // was simply wrong.
    if (course === null) {
      throw enrollmentLinkUnavailable();
    }

    const existingMembership =
      await this.options.stores.courses.getMembership(
        link.courseId,
        actor.user.id,
      );

    if (existingMembership !== null) {
      if (existingMembership.status !== "active") {
        throw forbidden("course_membership_inactive");
      }

      return { course, membership: existingMembership };
    }

    const membership = await this.options.stores.courses.addMembership({
      id: createAppId(nowDate.getTime()),
      courseId: link.courseId,
      userId: actor.user.id,
      role: "student",
      status: "active",
      createdAt: now,
    });

    return { course, membership };
  }

  async updateMembershipStatus(
    actor: AuthenticatedActor,
    courseId: AppId,
    membershipId: AppId,
    command: UpdateMembershipStatusCommand,
  ): Promise<CourseMembership> {
    await requireInstructor(this.options.stores, actor, courseId);
    assertStatus(command.status);

    const existing = await this.options.stores.courses.getMembershipById(
      courseId,
      membershipId,
    );

    if (existing === null) {
      throw new AppHttpError(
        404,
        "course_membership_not_found",
        deferred.i18n.t("The course membership was not found."),
      );
    }

    if (
      existing.userId === actor.user.id &&
      (existing.role === "instructor" || existing.role === "co_instructor") &&
      command.status !== "active"
    ) {
      throw badRequest(
        "cannot_deactivate_self",
        deferred.i18n.t(
          "Instructors cannot deactivate their own instructor membership.",
        ),
      );
    }

    const updated = await this.options.stores.courses.updateMembershipStatus({
      courseId,
      membershipId,
      status: command.status,
      updatedAt: timestampNow(this.options.now?.() ?? new Date()),
    });

    if (updated === null) {
      throw new AppHttpError(
        404,
        "course_membership_not_found",
        deferred.i18n.t("The course membership was not found."),
      );
    }

    return updated;
  }

  async updateMembershipRole(
    actor: AuthenticatedActor,
    courseId: AppId,
    membershipId: AppId,
    command: UpdateMembershipRoleCommand,
  ): Promise<CourseMembership> {
    await requireInstructor(this.options.stores, actor, courseId);
    assertMembershipRole(command.role);

    const existing = await this.options.stores.courses.getMembershipById(
      courseId,
      membershipId,
    );

    if (existing === null) {
      throw new AppHttpError(
        404,
        "course_membership_not_found",
        deferred.i18n.t("The course membership was not found."),
      );
    }

    // Demoting the last active instructor would leave the course unmanageable,
    // so refuse when this membership is the only one that still manages it.
    if (
      managesCourse(existing) &&
      command.role !== "instructor" &&
      command.role !== "co_instructor"
    ) {
      const memberships =
        await this.options.stores.courses.listMembershipsForCourse(courseId);
      const otherManagers = memberships.filter(
        (membership) =>
          membership.id !== existing.id && managesCourse(membership),
      );

      if (otherManagers.length === 0) {
        throw badRequest(
          "course_requires_instructor",
          deferred.i18n.t(
            "A course must keep at least one active instructor.",
          ),
        );
      }
    }

    const updated = await this.options.stores.courses.updateMembershipRole({
      courseId,
      membershipId,
      role: command.role,
      updatedAt: timestampNow(this.options.now?.() ?? new Date()),
    });

    if (updated === null) {
      throw new AppHttpError(
        404,
        "course_membership_not_found",
        deferred.i18n.t("The course membership was not found."),
      );
    }

    return updated;
  }

  async addStaff(
    actor: AuthenticatedActor,
    courseId: AppId,
    command: AddCourseStaffCommand,
  ): Promise<CourseMembership> {
    await requireInstructor(this.options.stores, actor, courseId);
    assertStaffRole(command.role);

    const user = await this.options.stores.users.getById(command.userId);

    if (user === null) {
      throw new AppHttpError(
        404,
        "user_not_found",
        deferred.i18n.t("The user was not found."),
      );
    }

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);

    return this.options.stores.courses.addMembership({
      courseId,
      createdAt: now,
      id: createAppId(nowDate.getTime()),
      role: command.role,
      status: "active",
      userId: command.userId,
    });
  }

  /**
   * Add a staff member (co-instructor, TA, or instructor) by their account
   * email. When the person is already a member — e.g. a student who joined via
   * an enrollment link — this promotes them in place rather than creating a
   * duplicate membership, routing through the guarded role update so the last
   * active instructor cannot be demoted away.
   */
  async addStaffByEmail(
    actor: AuthenticatedActor,
    courseId: AppId,
    command: AddCourseStaffByEmailCommand,
  ): Promise<CourseMembership> {
    await requireInstructor(this.options.stores, actor, courseId);
    assertStaffRole(command.role);

    const email = command.email.trim().toLowerCase();

    if (email.length === 0) {
      throw badRequest(
        "invalid_email",
        deferred.i18n.t("An email address is required."),
      );
    }

    const user = await this.options.stores.users.getByEmail(email);

    if (user === null) {
      throw new AppHttpError(
        404,
        "user_not_found",
        deferred.i18n.t("No account exists for that email address."),
      );
    }

    const existing = await this.options.stores.courses.getMembership(
      courseId,
      user.id,
    );

    if (existing !== null) {
      await this.updateMembershipRole(actor, courseId, existing.id, {
        role: command.role,
      });

      return this.updateMembershipStatus(actor, courseId, existing.id, {
        status: "active",
      });
    }

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);

    return this.options.stores.courses.addMembership({
      courseId,
      createdAt: now,
      id: createAppId(nowDate.getTime()),
      role: command.role,
      status: "active",
      userId: user.id,
    });
  }

  async upsertAccommodation(
    actor: AuthenticatedActor,
    courseId: AppId,
    command: UpsertAccommodationCommand,
  ): Promise<CourseAccommodation> {
    await requireInstructor(this.options.stores, actor, courseId);

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);

    return this.options.stores.courses.upsertAccommodation({
      availableUntilExtensionMinutes: nonNegativeInteger(
        command.availableUntilExtensionMinutes,
        0,
        "invalid_available_until_extension",
      ),
      courseId,
      createdById: actor.user.id,
      dueAtExtensionMinutes: nonNegativeInteger(
        command.dueAtExtensionMinutes,
        0,
        "invalid_due_at_extension",
      ),
      extraAttempts: nonNegativeInteger(
        command.extraAttempts,
        0,
        "invalid_extra_attempts",
      ),
      id: createAppId(nowDate.getTime()),
      now,
      timeLimitMultiplier: positiveNumber(
        command.timeLimitMultiplier,
        1,
        "invalid_time_limit_multiplier",
      ),
      userId: command.userId,
    });
  }

  async cloneCourse(
    actor: AuthenticatedActor,
    courseId: AppId,
    command: CloneCourseCommand,
  ): Promise<ClonedCourseResult> {
    await requireInstructor(this.options.stores, actor, courseId);

    // The caller names the clone; there is no default. A server-side
    // "<source> copy" would have to be worded the same as the hint the clone bar
    // shows, in every locale, and nothing would fail when the two drifted.
    const title = normalizeTitle(command.title);

    assertTitle(title);

    const source = await this.options.stores.courses.getById(courseId);

    // Same unreachable-but-nullable branch as `getCourseDetail`, and it named the
    // same wrong error.
    if (source === null) {
      throw courseNotFound();
    }

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    const course = await this.options.stores.courses.create({
      createdAt: now,
      createdById: actor.user.id,
      id: createAppId(nowDate.getTime()),
      timezone: source.timezone,
      title,
    });
    const membership = await this.options.stores.courses.addMembership({
      courseId: course.id,
      createdAt: now,
      id: createAppId(nowDate.getTime()),
      role: "instructor",
      status: "active",
      userId: actor.user.id,
    });
    const assignments = await this.options.stores.assignments.listForCourse(
      source.id,
    );

    for (const assignment of assignments) {
      const cloned = await this.options.stores.assignments.create({
        assessmentMode: assignment.assessmentMode,
        displayOrder: assignment.displayOrder,
        availableFrom: assignment.availableFrom,
        availableUntil: assignment.availableUntil,
        contentRevisionId: assignment.contentRevisionId,
        courseId: course.id,
        createdAt: now,
        createdById: actor.user.id,
        description: assignment.description,
        dueAt: assignment.dueAt,
        gradesVisibleAt: assignment.gradesVisibleAt,
        id: createAppId(nowDate.getTime()),
        listed: assignment.listed,
        maxAttempts: assignment.maxAttempts,
        timeLimitMinutes: assignment.timeLimitMinutes,
        title: assignment.title,
      });

      if (assignment.state === "published") {
        await this.options.stores.assignments.publish({
          actorId: actor.user.id,
          contentRevisionId: cloned.contentRevisionId,
          id: cloned.id,
          publishedAt: now,
          versionId: createAppId(nowDate.getTime()),
        });
      }
    }

    return {
      assignmentsCloned: assignments.length,
      course,
      membership,
    };
  }

  async revokeEnrollmentLink(
    actor: AuthenticatedActor,
    courseId: AppId,
    linkId: AppId,
  ): Promise<CourseEnrollmentLink> {
    await requireInstructor(this.options.stores, actor, courseId);

    const revoked = await this.options.stores.courses.revokeEnrollmentLink({
      courseId,
      linkId,
      revokedAt: timestampNow(this.options.now?.() ?? new Date()),
    });

    if (revoked === null) {
      throw new AppHttpError(
        404,
        "enrollment_link_not_found",
        deferred.i18n.t("The enrollment link was not found."),
      );
    }

    return revoked;
  }
}
