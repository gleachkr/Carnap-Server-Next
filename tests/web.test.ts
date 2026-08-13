import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { LOGIN_TTL_SECONDS } from "../src/worker/application/auth";
import { LTI_LINK_TTL_SECONDS } from "../src/worker/application/lti";
import type { Env } from "../src/worker/env";
import { i18nFor } from "../src/worker/i18n";
import { ResendLoginEmailSender } from "../src/worker/infrastructure/email/resend";
import {
  CHROME_STYLE_SHEET,
  CONTENT_STYLE_SHEET,
} from "../src/worker/web/style-assets";
import {
  grantTestContentAuthor,
  grantTestCourseCreator,
} from "./helpers/admin";
import { appRequest, createTestApp } from "./helpers/app";
import { createTestStorage, type TestStorage } from "./helpers/storage";

setDefaultTimeout(30_000);

interface LoginCookies {
  readonly actorId: string;
  readonly cookieHeader: string;
  readonly csrfToken: string;
}

interface MeResponse {
  readonly actor: { readonly id: string };
}

interface ContentItemResponse {
  readonly item: { readonly id: string };
}

interface ContentRevisionResponse {
  readonly revision: { readonly id: string };
}

interface CourseResponse {
  readonly course: { readonly id: string };
}

interface AssignmentResponse {
  readonly assignment: { readonly id: string };
}

async function withStorage(
  run: (storage: TestStorage, env: Env) => Promise<void>,
): Promise<void> {
  const storage = await createTestStorage();

  try {
    await run(storage, { CARNAP_ENV: "local", DB: storage.db });
  } finally {
    await storage.dispose();
  }
}

function htmlHeaders(cookieHeader?: string): HeadersInit {
  return {
    Accept: "text/html",
    ...(cookieHeader === undefined ? {} : { Cookie: cookieHeader }),
  };
}

function formRequest(
  body: Record<string, string>,
  cookieHeader?: string,
): RequestInit {
  return {
    body: new URLSearchParams(body),
    headers: {
      ...htmlHeaders(cookieHeader),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  };
}

function jsonRequest(body: unknown, login: LoginCookies): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Cookie: login.cookieHeader,
      "X-CSRF-Token": login.csrfToken,
    },
    method: "POST",
  };
}

function setCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & {
    readonly getSetCookie?: () => string[];
  };

  if (headers.getSetCookie !== undefined) {
    return headers.getSetCookie();
  }

  return (headers.get("set-cookie") ?? "")
    .split(/,(?=\s*[^;=]+=)/)
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.length > 0);
}

function cookieHeader(response: Response): string {
  return setCookieHeaders(response)
    .map((cookie) => cookie.split(";")[0] ?? "")
    .join("; ");
}

function csrfTokenFromCookies(cookies: string): string {
  const token = cookies
    .split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith("carnap_csrf="))
    ?.split("=")[1];

  if (token === undefined) {
    throw new Error("Missing CSRF cookie.");
  }

  return token;
}

function expectLocation(response: Response): string {
  const location = response.headers.get("Location");

  if (location === null) {
    throw new Error("Missing redirect Location header.");
  }

  return location;
}

function extractLoginPath(html: string): string {
  const match = html.match(/href="(http:\/\/[^"]+\/login\/confirm[^"]+)"/);

  if (match?.[1] === undefined) {
    throw new Error("Missing local login link.");
  }

  const url = new URL(match[1]);

  return `${url.pathname}${url.search}`;
}

async function webLogin(env: Env, email: string): Promise<LoginCookies> {
  const start = await appRequest(
    createTestApp(),
    "/login",
    formRequest({ email }),
    env,
  );
  const confirmPath = extractLoginPath(await start.text());
  const confirm = await appRequest(
    createTestApp(),
    confirmPath,
    { headers: htmlHeaders() },
    env,
  );
  const cookies = cookieHeader(confirm);
  const me = await appRequest(
    createTestApp(),
    "/auth/me",
    { headers: { Cookie: cookies } },
    env,
  );
  const meBody = (await me.json()) as MeResponse;

  expect(start.status).toBe(200);
  expect(confirm.status).toBe(303);
  expect(me.status).toBe(200);
  expect(expectLocation(confirm)).toBe("/courses");

  return {
    actorId: meBody.actor.id,
    cookieHeader: cookies,
    csrfToken: csrfTokenFromCookies(cookies),
  };
}

describe("native web workflow", () => {
  test("an instructor creates a course and a student enrolls", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await webLogin(env, "instructor@example.test");
      const student = await webLogin(env, "student@example.test");

      await grantTestCourseCreator(env, instructor.actorId);

      const createCourse = await appRequest(
        createTestApp(),
        "/courses",
        formRequest(
          {
            csrfToken: instructor.csrfToken,
            timezone: "America/New_York",
            title: "Intro Logic",
          },
          instructor.cookieHeader,
        ),
        env,
      );
      const coursePath = expectLocation(createCourse).split("?")[0] ?? "";
      const courseId = coursePath.split("/").at(-1) ?? "";
      const coursePage = await appRequest(
        createTestApp(),
        coursePath,
        { headers: htmlHeaders(instructor.cookieHeader) },
        env,
      );
      const contentResponse = await appRequest(
        createTestApp(),
        "/content",
        jsonRequest({ title: "Inline homework source" }, instructor),
        env,
      );
      const content = (await contentResponse.json()) as ContentItemResponse;
      const revisionResponse = await appRequest(
        createTestApp(),
        `/content/${content.item.id}/revisions`,
        jsonRequest(
          {
            sourceText:
              '# Work\n\n::::multiple-choice{#q1 points="1"}\nQ?\n\n- [x] A | A\n- [ ] B | B\n::::',
          },
          instructor,
        ),
        env,
      );
      const revision =
        (await revisionResponse.json()) as ContentRevisionResponse;
      const assignmentResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments`,
        jsonRequest(
          {
            contentRevisionId: revision.revision.id,
            title: "Inline homework",
          },
          instructor,
        ),
        env,
      );
      const assignment =
        (await assignmentResponse.json()) as AssignmentResponse;
      const publishResponse = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments/${assignment.assignment.id}` +
          "/publish",
        jsonRequest({}, instructor),
        env,
      );
      const instructorCoursePage = await appRequest(
        createTestApp(),
        coursePath,
        { headers: htmlHeaders(instructor.cookieHeader) },
        env,
      );
      const linkResponse = await appRequest(
        createTestApp(),
        `${coursePath}/enrollment-links`,
        formRequest(
          { csrfToken: instructor.csrfToken },
          instructor.cookieHeader,
        ),
        env,
      );
      const linkLocation = expectLocation(linkResponse);
      const enrollToken = new URL(
        linkLocation,
        "http://localhost",
      ).searchParams.get("enrollToken");

      expect(createCourse.status).toBe(303);
      expect(coursePage.status).toBe(200);
      expect(await coursePage.text()).toContain("Intro Logic");
      expect(contentResponse.status).toBe(201);
      expect(revisionResponse.status).toBe(201);
      expect(assignmentResponse.status).toBe(201);
      expect(publishResponse.status).toBe(200);
      expect(instructorCoursePage.status).toBe(200);
      expect(linkResponse.status).toBe(303);
      expect(enrollToken).toStartWith("aenr_");

      const enrollmentPage = await appRequest(
        createTestApp(),
        `/enrollments/${enrollToken}`,
        { headers: htmlHeaders(student.cookieHeader) },
        env,
      );
      const accepted = await appRequest(
        createTestApp(),
        `/enrollments/${enrollToken}`,
        formRequest({ csrfToken: student.csrfToken }, student.cookieHeader),
        env,
      );
      const studentCoursePage = await appRequest(
        createTestApp(),
        expectLocation(accepted).split("?")[0] ?? "",
        { headers: htmlHeaders(student.cookieHeader) },
        env,
      );

      const instructorCourseHtml = await instructorCoursePage.text();
      const studentCourseHtml = await studentCoursePage.text();

      expect(instructorCourseHtml).toContain("Assignment management");
      expect(instructorCourseHtml).toContain("Inline homework");
      expect(instructorCourseHtml).toContain('placeholder="new assignment"');
      // The course's scores and one assignment's scores are two destinations
      // sitting on the same page, so they carry two names rather than both
      // saying "Gradebook": the strip goes to the course gradebook, the row in
      // the table goes to that assignment's grades.
      expect(instructorCourseHtml).toContain(
        `<a class="link-strip-item" ` +
          `href="/courses/${courseId}/instructor/gradebook">` +
          `<span class="link-strip-label">Course gradebook`,
      );
      expect(instructorCourseHtml).toContain(
        `<a href="/courses/${courseId}/instructor/assignments/` +
          `${assignment.assignment.id}/gradebook">Grades</a>`,
      );
      expect(instructorCourseHtml).not.toContain("Manage assignments");
      // The enrollment bar has no room for a visible label, so the expiry
      // field carries its name on itself — and the same shape as the labelled
      // fields elsewhere: no `step`, and a hidden sibling holding the instant.
      expect(instructorCourseHtml).toContain(
        '<input aria-label="Expires at, optional" ' +
          'data-timestamp-local="expiresAt" type="datetime-local"/>',
      );
      expect(instructorCourseHtml).toContain(
        '<input data-timestamp-hidden="expiresAt" name="expiresAt" ' +
          'type="hidden" value=""/>',
      );
      expect(enrollmentPage.status).toBe(200);
      expect(await enrollmentPage.text()).toContain("Join course");
      expect(accepted.status).toBe(303);
      expect(studentCourseHtml).toContain("Intro Logic");
      expect(studentCourseHtml).toContain("Assignments");
      expect(studentCourseHtml).toContain("Inline homework");
      expect(studentCourseHtml).toContain("<th>Type</th>");
      expect(studentCourseHtml).toContain(">Graded<");
      expect(studentCourseHtml).toContain("<th>Availability</th>");
      expect(studentCourseHtml).toContain(">Open<");
      expect(studentCourseHtml).not.toContain("Assignment management");
      expect(studentCourseHtml).not.toContain('placeholder="new assignment"');
      expect(studentCourseHtml).not.toContain("View student assignments");
    });
  });

  test("archiving a course changes the status its page shows", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await webLogin(env, "instructor@example.test");

      await grantTestCourseCreator(env, instructor.actorId);

      const createCourse = await appRequest(
        createTestApp(),
        "/courses",
        formRequest(
          {
            csrfToken: instructor.csrfToken,
            timezone: "America/New_York",
            title: "Modal Logic",
          },
          instructor.cookieHeader,
        ),
        env,
      );
      const coursePath = expectLocation(createCourse).split("?")[0] ?? "";
      const readCourseRecord = async (): Promise<string> => {
        const page = await appRequest(
          createTestApp(),
          coursePath,
          { headers: htmlHeaders(instructor.cookieHeader) },
          env,
        );

        expect(page.status).toBe(200);

        return await page.text();
      };
      const post = async (action: string): Promise<Response> =>
        await appRequest(
          createTestApp(),
          `${coursePath}/${action}`,
          formRequest(
            { csrfToken: instructor.csrfToken },
            instructor.cookieHeader,
          ),
          env,
        );

      const readCourseList = async (): Promise<string> => {
        const page = await appRequest(
          createTestApp(),
          "/courses",
          { headers: htmlHeaders(instructor.cookieHeader) },
          env,
        );

        expect(page.status).toBe(200);

        return await page.text();
      };

      const beforeHtml = await readCourseRecord();
      const beforeListHtml = await readCourseList();
      const archive = await post("archive");
      const archivedHtml = await readCourseRecord();
      const archivedListHtml = await readCourseList();
      const unarchive = await post("unarchive");
      const unarchivedHtml = await readCourseRecord();

      expect(archive.status).toBe(303);
      expect(unarchive.status).toBe(303);

      // The instructor's *membership* is active the whole way through, so a
      // page whose only status is that one appears not to have registered the
      // archive at all. Both statuses are named for whose they are.
      expect(beforeHtml).toContain("<dt>Course status</dt><dd>Active</dd>");
      expect(archivedHtml).toContain(
        "<dt>Course status</dt><dd>Archived</dd>",
      );
      expect(unarchivedHtml).toContain(
        "<dt>Course status</dt><dd>Active</dd>",
      );
      expect(archivedHtml).toContain("<dt>Your status</dt><dd>Active</dd>");

      // The list says whose status its column holds, for the same reason, and
      // the archived drawer only exists once something is in it — with the
      // count on the summary, so a closed drawer still says where the course
      // went.
      expect(beforeListHtml).toContain("<th>Your status</th>");
      // The element, not the class: the page's inlined stylesheet names the
      // class whether or not anything wears it.
      expect(beforeListHtml).not.toContain(
        '<details class="sheet archived-sheet">',
      );
      expect(archivedListHtml).toContain(
        '<summary class="sheet-header"><h2>Archived courses (1)</h2></summary>',
      );
      expect(archivedListHtml).toContain("Modal Logic");
      // Staff can act on their own archived course, so the column is there.
      expect(archivedListHtml).toContain("<th>Actions</th>");
      expect(archivedListHtml).toContain("Unarchive");
    });
  });

  test("the course create bar takes its timezone from the browser", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await webLogin(env, "instructor@example.test");

      await grantTestCourseCreator(env, instructor.actorId);

      const coursesIndex = await appRequest(
        createTestApp(),
        "/courses",
        { headers: htmlHeaders(instructor.cookieHeader) },
        env,
      );
      const listHtml = await coursesIndex.text();

      // The hidden field the layout's script fills, and no picker beside it.
      expect(listHtml).toContain(
        '<input data-timezone-local="" name="timezone" type="hidden" value=""/>',
      );
      expect(listHtml).not.toContain('aria-label="Timezone"');

      // A reader with no script posts the field empty, so empty must create the
      // course under the server's default rather than fail validation on "".
      const created = await appRequest(
        createTestApp(),
        "/courses",
        formRequest(
          {
            csrfToken: instructor.csrfToken,
            timezone: "",
            title: "No Script",
          },
          instructor.cookieHeader,
        ),
        env,
      );
      const coursePath = expectLocation(created).split("?")[0] ?? "";
      const coursePage = await appRequest(
        createTestApp(),
        coursePath,
        { headers: htmlHeaders(instructor.cookieHeader) },
        env,
      );

      expect(await coursePage.text()).toContain(
        "<dt>Timezone</dt><dd>UTC</dd>",
      );
    });
  });

  test("a student keeps an archived course, read-only", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await webLogin(env, "instructor@example.test");
      const student = await webLogin(env, "student@example.test");

      await grantTestCourseCreator(env, instructor.actorId);

      const createCourse = await appRequest(
        createTestApp(),
        "/courses",
        formRequest(
          {
            csrfToken: instructor.csrfToken,
            timezone: "UTC",
            title: "Set Theory",
          },
          instructor.cookieHeader,
        ),
        env,
      );
      const coursePath = expectLocation(createCourse).split("?")[0] ?? "";
      const linkResponse = await appRequest(
        createTestApp(),
        `${coursePath}/enrollment-links`,
        formRequest(
          { csrfToken: instructor.csrfToken },
          instructor.cookieHeader,
        ),
        env,
      );
      const enrollToken = new URL(
        expectLocation(linkResponse),
        "http://localhost",
      ).searchParams.get("enrollToken");
      const accepted = await appRequest(
        createTestApp(),
        `/enrollments/${enrollToken}`,
        formRequest({ csrfToken: student.csrfToken }, student.cookieHeader),
        env,
      );
      const archive = await appRequest(
        createTestApp(),
        `${coursePath}/archive`,
        formRequest(
          { csrfToken: instructor.csrfToken },
          instructor.cookieHeader,
        ),
        env,
      );
      const studentList = await appRequest(
        createTestApp(),
        "/courses",
        { headers: htmlHeaders(student.cookieHeader) },
        env,
      );
      const studentListHtml = await studentList.text();

      expect(accepted.status).toBe(303);
      expect(archive.status).toBe(303);

      // The archived course is still theirs, in the same drawer staff get —
      // it is the only route back to the work they did in it.
      expect(studentListHtml).toContain(
        '<summary class="sheet-header"><h2>Archived courses (1)</h2></summary>',
      );
      expect(studentListHtml).toContain("Set Theory");
      // Read-only, and the actions column goes with the actions rather than
      // standing empty beside the row.
      expect(studentListHtml).not.toContain("Unarchive");
      expect(studentListHtml).not.toContain("<th>Actions</th>");
      // And the active table must not call a student with an archived course
      // unenrolled, on a page that has just promised them their historical
      // memberships.
      expect(studentListHtml).toContain(
        "Every course you are enrolled in has been archived.",
      );
      expect(studentListHtml).not.toContain(
        "You are not enrolled in any courses yet.",
      );
    });
  });

  test("Milestone 9 course tools are reachable from course pages", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await webLogin(env, "instructor@example.test");
      const student = await webLogin(env, "student@example.test");

      await grantTestCourseCreator(env, instructor.actorId);

      const coursesIndex = await appRequest(
        createTestApp(),
        "/courses",
        { headers: htmlHeaders(instructor.cookieHeader) },
        env,
      );
      const coursesIndexHtml = await coursesIndex.text();

      expect(coursesIndex.status).toBe(200);
      expect(coursesIndexHtml).toContain('placeholder="Title of new course"');
      expect(coursesIndexHtml).toContain("Create course");

      const courseResponse = await appRequest(
        createTestApp(),
        "/courses",
        formRequest(
          {
            csrfToken: instructor.csrfToken,
            timezone: "UTC",
            title: "Parity Course",
          },
          instructor.cookieHeader,
        ),
        env,
      );
      const coursePath = expectLocation(courseResponse).split("?")[0] ?? "";
      const coursePage = await appRequest(
        createTestApp(),
        coursePath,
        { headers: htmlHeaders(instructor.cookieHeader) },
        env,
      );
      const html = await coursePage.text();

      expect(coursePage.status).toBe(200);
      expect(html).toContain("Create enrollment link");
      expect(html).toContain("Course owner");
      expect(html).toContain("Accommodations for");
      expect(html).toContain('data-dialog-target="accommodations-');
      expect(html).toContain("Save accommodation");
      expect(html).toContain('data-dialog-target="membership-');
      expect(html).toContain("Update membership");
      expect(html).toContain("<dialog");
      expect(html).toContain("Clone course");

      const accommodationResponse = await appRequest(
        createTestApp(),
        `${coursePath}/accommodations`,
        formRequest(
          {
            csrfToken: instructor.csrfToken,
            dueAtExtensionMinutes: "60",
            extraAttempts: "1",
            timeLimitMultiplier: "1.5",
            userId: student.actorId,
          },
          instructor.cookieHeader,
        ),
        env,
      );
      const cloneResponse = await appRequest(
        createTestApp(),
        `${coursePath}/clone`,
        formRequest(
          {
            csrfToken: instructor.csrfToken,
            title: "Parity Course Copy",
          },
          instructor.cookieHeader,
        ),
        env,
      );

      expect(accommodationResponse.status).toBe(303);
      expect(cloneResponse.status).toBe(303);
      expect(expectLocation(accommodationResponse)).toContain(
        "accommodationSaved=1",
      );
      expect(expectLocation(cloneResponse)).toContain("cloned=1");
    });
  });

  test("manual grading controls are reachable on assignments", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await webLogin(env, "instructor@example.test");

      await grantTestCourseCreator(env, instructor.actorId);
      // Creating a course would confer this too, but the item comes first here.
      await grantTestContentAuthor(env, instructor.actorId);

      const contentResponse = await appRequest(
        createTestApp(),
        "/content",
        jsonRequest({ title: "Homework source" }, instructor),
        env,
      );
      const content = (await contentResponse.json()) as ContentItemResponse;
      const revisionResponse = await appRequest(
        createTestApp(),
        `/content/${content.item.id}/revisions`,
        jsonRequest(
          {
            sourceText:
              '# Work\n\n::::multiple-choice{#q1 points="1"}\nQ?\n\n- [x] A | A\n- [ ] B | B\n::::',
          },
          instructor,
        ),
        env,
      );
      const revision =
        (await revisionResponse.json()) as ContentRevisionResponse;
      const courseResponse = await appRequest(
        createTestApp(),
        "/courses",
        jsonRequest({ timezone: "UTC", title: "Grading" }, instructor),
        env,
      );
      const course = (await courseResponse.json()) as CourseResponse;
      const assignmentResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments`,
        jsonRequest(
          {
            contentRevisionId: revision.revision.id,
            title: "Manual grading homework",
          },
          instructor,
        ),
        env,
      );
      const assignment =
        (await assignmentResponse.json()) as AssignmentResponse;
      // Overrides and the late policy are settings the server accepts on any
      // graded assignment, so the sheet carrying them is on the page while the
      // assignment is still a draft — an instructor sets up a due-date
      // exception before the assignment goes live, not after. Only the two
      // destinations that report on student work wait for publication.
      const draftPageResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/assignments/` +
          assignment.assignment.id,
        { headers: htmlHeaders(instructor.cookieHeader) },
        env,
      );
      const draftHtml = await draftPageResponse.text();

      expect(draftPageResponse.status).toBe(200);
      expect(draftHtml).toContain("Policy and grading controls");
      expect(draftHtml).toContain("Save late policy");
      expect(draftHtml).not.toContain("link-strip");

      await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/assignments/${assignment.assignment.id}` +
          "/publish",
        jsonRequest({}, instructor),
        env,
      );
      const pageResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/assignments/` +
          assignment.assignment.id,
        { headers: htmlHeaders(instructor.cookieHeader) },
        env,
      );
      const html = await pageResponse.text();

      expect(pageResponse.status).toBe(200);
      expect(html).toContain("Policy and grading controls");
      // The gradebook and attempts destinations sit in the link strip; grade
      // export and submission review now live on the gradebook page itself.
      expect(html).toContain("link-strip");
      expect(html).toContain(
        `/instructor/assignments/${assignment.assignment.id}/gradebook`,
      );
      expect(html).toContain(
        `/instructor/assignments/${assignment.assignment.id}/attempts`,
      );
      expect(html).toContain("Save late policy");
      expect(html).toContain("No students are enrolled in this course yet.");
      // The administrative sheets share a rail, with the content document in
      // its own column beside them on wide screens.
      expect(html).toContain('class="content-split"');
      expect(html.indexOf('class="content-split-doc"')).toBeGreaterThan(
        html.indexOf('class="content-split-rail"'),
      );

      // Saving replaces the whole policy, so the form has to come back holding
      // the one in force: a form that reset to its own defaults would report
      // "No late penalty" for an assignment that has one, and erase the penalty
      // the next time any other field on it was saved.
      const savedResponse = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/assignments/` +
          `${assignment.assignment.id}/late-policy`,
        formRequest(
          {
            csrfToken: instructor.csrfToken,
            graceMinutes: "30",
            kind: "percent_per_day",
            maxPercentPenalty: "75",
            percentPenalty: "25",
          },
          instructor.cookieHeader,
        ),
        env,
      );
      const reopened = await appRequest(
        createTestApp(),
        `/courses/${course.course.id}/instructor/assignments/` +
          assignment.assignment.id,
        { headers: htmlHeaders(instructor.cookieHeader) },
        env,
      );
      const reopenedHtml = await reopened.text();

      expect(savedResponse.status).toBe(303);
      expect(reopenedHtml).toContain('selected="" value="percent_per_day"');
      expect(reopenedHtml).toContain(
        'name="graceMinutes" type="number" value="30"',
      );
      expect(reopenedHtml).toContain(
        'name="percentPenalty" type="number" value="25"',
      );
      expect(reopenedHtml).toContain(
        'name="maxPercentPenalty" type="number" value="75"',
      );
      expect(reopenedHtml).not.toContain('selected="" value="none"');
    });
  });

  test("browser forms require CSRF once a user is signed in", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await webLogin(env, "instructor@example.test");
      const response = await appRequest(
        createTestApp(),
        "/courses",
        formRequest(
          { timezone: "UTC", title: "No CSRF" },
          instructor.cookieHeader,
        ),
        env,
      );

      expect(response.status).toBe(403);
    });
  });

  test("an expired login link offers to send another one", async () => {
    await withStorage(async (_storage, env) => {
      const response = await appRequest(
        createTestApp(),
        "/login/confirm?token=alt_expired&next=%2Fcourses",
        { headers: htmlHeaders() },
        env,
      );
      const html = await response.text();

      expect(response.status).toBe(401);
      expect(html).not.toContain("invalid_login_token");
      expect(html).toContain("That login link has expired");
      // The way out is the form itself, with the destination still attached.
      expect(html).toContain('action="/login"');
      expect(html).toContain('name="next" type="hidden" value="/courses"');
    });
  });

  test("a browser gets an error page where a client gets the envelope", async () => {
    await withStorage(async (_storage, env) => {
      const page = await appRequest(
        createTestApp(),
        "/no-such-page",
        { headers: htmlHeaders() },
        env,
      );
      const envelope = await appRequest(
        createTestApp(),
        "/no-such-page",
        // What every scripted client sends, and the reason the error page is
        // keyed on an explicit `text/html` rather than on `wantsHtml`.
        { headers: { Accept: "*/*" } },
        env,
      );
      const html = await page.text();

      expect(page.status).toBe(404);
      expect(page.headers.get("Content-Type")).toContain("text/html");
      expect(html).toContain("Page not found");
      expect(html).toContain("We could not find that page");
      expect(html).toContain('href="/login"');

      expect(envelope.status).toBe(404);
      expect(envelope.headers.get("Content-Type")).toContain(
        "application/json",
      );
      expect(await envelope.json()).toMatchObject({
        error: { code: "not_found" },
      });
    });
  });

  test("a rejected browser action explains itself in the page", async () => {
    await withStorage(async (_storage, env) => {
      const student = await webLogin(env, "student@example.test");
      const response = await appRequest(
        createTestApp(),
        "/admin",
        { headers: htmlHeaders(student.cookieHeader) },
        env,
      );
      const html = await response.text();

      expect(response.status).toBe(403);
      expect(response.headers.get("Content-Type")).toContain("text/html");
      expect(html).toContain("Not allowed");
      expect(html).toContain("You are not allowed to do that.");
      // Signed in, so the way onward is their own courses.
      expect(html).toContain('href="/courses"');
    });
  });

  test("the tab icon is served, and the .ico convention points at it", async () => {
    await withStorage(async (_storage, env) => {
      const icon = await appRequest(
        createTestApp(),
        "/favicon.svg",
        { headers: htmlHeaders() },
        env,
      );
      const legacy = await appRequest(
        createTestApp(),
        "/favicon.ico",
        { headers: htmlHeaders() },
        env,
      );

      expect(icon.status).toBe(200);
      expect(icon.headers.get("Content-Type")).toContain("image/svg+xml");
      expect(await icon.text()).toContain("<svg");
      expect(legacy.status).toBe(302);
      expect(legacy.headers.get("Location")).toBe("/favicon.svg");
    });
  });

  // Asking for a name here let an unauthenticated request choose the name a new
  // account was created under, and told every returning user their name mattered
  // when it was discarded — it only ever applied at creation. The address is now
  // the whole form.
  test("the login form asks for an address and nothing else", async () => {
    await withStorage(async (_storage, env) => {
      const page = await appRequest(
        createTestApp(),
        "/login",
        { headers: htmlHeaders() },
        env,
      );
      const html = await page.text();

      expect(page.status).toBe(200);
      expect(html).toContain('<input name="email" required="" type="email"');
      expect(html).not.toContain('name="name"');
    });
  });

  test("a name posted to the login route does not reach the account", async () => {
    await withStorage(async (storage, env) => {
      const start = await appRequest(
        createTestApp(),
        "/login",
        formRequest({
          email: "mallory@example.test",
          name: "<xsl:value-of select=\"php:function('exec','id')\"/>",
        }),
        env,
      );
      const confirm = await appRequest(
        createTestApp(),
        extractLoginPath(await start.text()),
        { headers: htmlHeaders() },
        env,
      );

      expect(confirm.status).toBe(303);

      const user = await storage.stores.users.getByEmail(
        "mallory@example.test",
      );

      expect(user).not.toBeNull();
      expect(user?.name).toBeNull();
    });
  });

  test("the stylesheets are served to be kept, and a page links them", async () => {
    await withStorage(async (_storage, env) => {
      const page = await appRequest(
        createTestApp(),
        "/login",
        { headers: htmlHeaders() },
        env,
      );
      const html = await page.text();

      // A signed-out page is the one nobody has a warm cache for, so it is the
      // one that must not carry the bytes: the rules go over as their own
      // documents or the split has bought nothing.
      expect(html).toContain(`<link href="${CONTENT_STYLE_SHEET.href}"`);
      expect(html).toContain(`<link href="${CHROME_STYLE_SHEET.href}"`);
      expect(html).not.toContain("<style>");

      const sheet = await appRequest(
        createTestApp(),
        CONTENT_STYLE_SHEET.href,
        {},
        env,
      );

      expect(sheet.status).toBe(200);
      expect(sheet.headers.get("Content-Type")).toContain("text/css");
      expect(sheet.headers.get("Cache-Control")).toContain("immutable");
      expect(await sheet.text()).toBe(CONTENT_STYLE_SHEET.css);

      // Markup stored from an earlier deploy still asks for its old name. It
      // gets today's rules — an unstyled page would be the worse answer — but
      // may not keep them, since the name no longer describes what came back.
      const superseded = await appRequest(
        createTestApp(),
        "/styles/content.000000.css",
        {},
        env,
      );

      expect(superseded.status).toBe(200);
      expect(await superseded.text()).toBe(CONTENT_STYLE_SHEET.css);
      expect(superseded.headers.get("Cache-Control")).not.toContain(
        "immutable",
      );

      const missing = await appRequest(
        createTestApp(),
        "/styles/nonesuch.000000.css",
        {},
        env,
      );

      expect(missing.status).toBe(404);
    });
  });

  test("a stylesheet is answered without asking who is asking", async () => {
    // A database that fails any use at all. The stylesheets are the same bytes
    // for every reader and they block the first paint, so the route is mounted
    // ahead of the middleware and must resolve no session to serve one — with
    // a session cookie present, which is exactly what would provoke the query.
    const hostile = new Proxy({} as D1Database, {
      get() {
        throw new Error("the stylesheet route reached for the database");
      },
    });
    const env = { CARNAP_ENV: "local", DB: hostile } as unknown as Env;
    const cookie = { Cookie: "carnap_session=ast_whatever" };

    const sheet = await appRequest(
      createTestApp(),
      CONTENT_STYLE_SHEET.href,
      { headers: cookie },
      env,
    );

    expect(sheet.status).toBe(200);
    expect(await sheet.text()).toBe(CONTENT_STYLE_SHEET.css);
    // The request id is stamped by the first middleware in the chain, so its
    // absence here is the chain itself reporting that it never ran. A page
    // asked for under the same conditions shows what the difference is.
    expect(sheet.headers.get("X-Request-Id")).toBeNull();

    const page = await appRequest(
      createTestApp(),
      "/login",
      { headers: { ...cookie, Accept: "text/html" } },
      env,
    );

    expect(page.headers.get("X-Request-Id")).not.toBeNull();
  });

  test("signed-out pages declare the tab icon", async () => {
    await withStorage(async (_storage, env) => {
      const response = await appRequest(
        createTestApp(),
        "/login",
        { headers: htmlHeaders() },
        env,
      );

      expect(await response.text()).toContain('href="/favicon.svg"');
    });
  });

  test("preview login fails clearly when email is not configured", async () => {
    await withStorage(async (_storage, env) => {
      const response = await appRequest(
        createTestApp(),
        "/login",
        formRequest({ email: "preview@example.test" }),
        { ...env, CARNAP_ENV: "preview" },
      );
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(body).toContain("Login email delivery is not configured");
    });
  });

  test("the Resend sender posts a login email", async () => {
    const requests: Request[] = [];
    const sender = new ResendLoginEmailSender({
      apiKey: "test-api-key",
      fetcher: async (input, init) => {
        requests.push(new Request(input, init));

        return Response.json({ id: "email-1" });
      },
      from: "Carnap <login@example.test>",
    });

    await sender.send({
      confirmationUrl: "http://localhost:8787/login/confirm?token=alt_1",
      email: "local@example.test",
      expiresInSeconds: LOGIN_TTL_SECONDS,
      i18n: i18nFor("en"),
      locale: "en",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.resend.com/emails");
    expect(requests[0]?.headers.get("Authorization")).toBe(
      "Bearer test-api-key",
    );
    expect(await requests[0]?.text()).toContain("local@example.test");
  });

  /**
   * An email cannot know the reader's clock — there is no browser to ask, and a
   * Worker has no timezone of its own — so the lifetime is said as a duration
   * and no timezone is named at all. The number tracks the TTL rather than
   * being written into the copy, so shortening the token cannot leave the email
   * promising ten minutes that the reader does not have.
   */
  test("the login email says how long the link lives, not when it dies", async () => {
    const requests: Request[] = [];
    const sender = new ResendLoginEmailSender({
      apiKey: "test-api-key",
      fetcher: async (input, init) => {
        requests.push(new Request(input, init));

        return Response.json({ id: "email-1" });
      },
      from: "Carnap <login@example.test>",
    });

    await sender.send({
      confirmationUrl: "http://localhost:8787/login/confirm?token=alt_1",
      email: "local@example.test",
      expiresInSeconds: LOGIN_TTL_SECONDS,
      i18n: i18nFor("en"),
      locale: "en",
    });

    const body = (await requests[0]?.json()) as {
      readonly html: string;
      readonly text: string;
    };

    expect(body.text).toContain("expires 10 minutes after it was sent");
    expect(body.html).toContain("expires 10 minutes after it was sent");
    expect(body.text).not.toContain("UTC");
  });

  /**
   * The account-link email's token lives a day, so the same sentence has to
   * carry an hours-long lifetime as readably as a minutes-long one — and carry
   * it in the recipient's language, which `Intl` declines the unit for.
   */
  test("a day-long link is said in hours, in the reader's language", async () => {
    const requests: Request[] = [];
    const sender = new ResendLoginEmailSender({
      apiKey: "test-api-key",
      fetcher: async (input, init) => {
        requests.push(new Request(input, init));

        return Response.json({ id: "email-1" });
      },
      from: "Carnap <login@example.test>",
    });

    await sender.send({
      confirmationUrl: "http://localhost:8787/lti/link/confirm?token=llt_1",
      email: "local@example.test",
      expiresInSeconds: LTI_LINK_TTL_SECONDS,
      i18n: i18nFor("de"),
      locale: "de",
    });

    const body = (await requests[0]?.json()) as { readonly text: string };

    expect(body.text).toContain("24 Stunden");
  });
});
