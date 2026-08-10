import { exportJWK, generateKeyPair } from "jose";

import type { AppStores } from "../../src/worker/application/stores";
import type { Env } from "../../src/worker/env";
import { appRequest, createTestApp } from "../helpers/app";
import {
  createLtiTestApp,
  INSTRUCTOR_ROLE,
  performLaunch,
  registerTestPlatform,
} from "../helpers/lti";
import { createTestStorage } from "../helpers/storage";

/**
 * Fixtures for the Tier 1 accessibility gate and the i18n pseudolocale gate:
 * render one representative sample of every distinct page template (and the
 * standalone exercise content document) to an HTML string via the in-memory app
 * harness — no browser, no server. `axe-runner.ts` audits these strings;
 * `a11y.test.ts` ratchets the result against `baseline.json`, and
 * `tests/i18n-pseudo.test.ts` re-renders the same set under `en-XA` to catch
 * hard-coded English.
 *
 * This is a *curated* set, not a crawl — but the curation is per *template
 * state*, not per route. A page whose one rendered state is covered still hides
 * every other branch from both gates, and the i18n gate can only see a message
 * that some fixture actually renders, so the states worth distinguishing are
 * the ones that swap out whole blocks of copy: draft vs. published, released vs.
 * withheld grades, the empty and the populated table, the error page. Query
 * parameters that only add a flash notice are folded into one "all notices at
 * once" request rather than a fixture each.
 */

export interface Fixture {
  /** Stable id used in the baseline fingerprint — keep these constant. */
  readonly name: string;
  /** The rendered HTML document (a page shell, or a content document). */
  readonly html: string;
}

interface LoginResult {
  readonly actorId: string;
  readonly cookieHeader: string;
  readonly csrfToken: string;
}

/**
 * A lesson exercising every exercise kind plus prose, so the assignment page and
 * content document cover every server-rendered exercise template. The theory
 * block precedes the proofs that cite it, and carries `show` so its disclosure
 * panel is audited too — a theory declared without it renders nothing.
 *
 * The two text kinds are here for the same reason as the interactive ones: their
 * templates render a control of their own, and a kind no fixture instantiates is
 * a kind both this gate and the pseudolocale gate cannot see. The short-answer
 * one carries a `title` and the free-response one does not, so the titled and
 * untitled group-label branches are both covered.
 */
const LESSON_SOURCE = `# Accessibility fixture lesson

A short prose paragraph so the page has flowing content too.

::::multiple-choice{#mc points="1"}
Choose yes.

- [x] yes | Yes
- [ ] no | No
::::

::::short-answer{#sa title="Name the rule" answer="modus ponens" points="1"}
Name the rule used in this inference.
::::

::::free-response{#fr points="1"}
Explain why the argument is valid.
::::

::::truth-table{#tt points="1"}
Is this a tautology?

- P -> P
::::

:::aufbau-mm0{name="prop" show}
provable sort wff;
term top: wff;
axiom top_i: $ top $;
:::

:::aufbau-proof{theory="prop" id="pf" points="1"}
Prove top.

theorem thm_top: $ top $
----
l1: $ top $ by top_i []
:::

:::aufbau-proof-tree{theory="prop" id="tr" points="1"}
Build a proof of top.

theorem thm_tree: $ top $
:::

:::aufbau-proof-prawitz{theory="prop" id="pz" points="1"}
Build a Prawitz tree for top.

theorem thm_prawitz: $ top $
:::`;

/**
 * A lesson that fails to compile, several ways at once. The revision editor's
 * diagnostic list is the only place a compiler message is ever shown to anyone,
 * so without a fixture that provokes one the entire diagnostic catalogue is
 * invisible to both gates. One source with many faults beats one fixture per
 * fault: the compiler reports them all together.
 */
const BROKEN_LESSON_SOURCE = `# Broken fixture lesson

<div>Raw HTML is rejected by this dialect.</div>

::::multiple-choice{#mc points="0"}
Only one option, and zero points.

- [x] yes | Yes
::::

::::truth-table{#tt variant="nonsense"}
No formulas at all.
::::

:::aufbau-mm0{name="prop"}
:::

:::aufbau-mm0{name="prop"}
provable sort wff;
:::`;

function cookieHeader(response: Response): string {
  const headers = response.headers as Headers & {
    readonly getSetCookie?: () => string[];
  };
  const cookies =
    headers.getSetCookie?.() ??
    (headers.get("set-cookie") ?? "")
      .split(/,(?=\s*[^;=]+=)/)
      .map((cookie) => cookie.trim())
      .filter((cookie) => cookie.length > 0);
  return cookies.map((cookie) => cookie.split(";")[0] ?? "").join("; ");
}

function jsonRequest(body: unknown, login?: LoginResult): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(login === undefined
        ? {}
        : { Cookie: login.cookieHeader, "X-CSRF-Token": login.csrfToken }),
    },
    method: "POST",
  };
}

function authHeaders(login: LoginResult): HeadersInit {
  return { Cookie: login.cookieHeader, "X-CSRF-Token": login.csrfToken };
}

async function login(env: Env, email: string): Promise<LoginResult> {
  const start = await appRequest(
    createTestApp(),
    "/auth/login/start",
    jsonRequest({ email }),
    env,
  );
  const startBody = (await start.json()) as {
    login: { loginToken: string };
  };
  const confirm = await appRequest(
    createTestApp(),
    "/auth/login/confirm",
    jsonRequest({ loginToken: startBody.login.loginToken }),
    env,
  );
  const confirmBody = (await confirm.json()) as {
    actor: { id: string };
    csrfToken: string;
  };
  return {
    actorId: confirmBody.actor.id,
    cookieHeader: cookieHeader(confirm),
    csrfToken: confirmBody.csrfToken,
  };
}

async function grantCapability(
  env: Env,
  userId: string,
  capability: "course_creator" | "site_admin",
): Promise<void> {
  const now = new Date().toISOString();
  const db = env.DB;

  if (db === undefined) {
    throw new Error("grantCapability needs a D1 binding.");
  }

  await db
    .prepare(
      `INSERT INTO platform_capability_grants
       (id, user_id, capability, granted_by_id, granted_at, revoked_at)
     VALUES (?, ?, ?, NULL, ?, NULL)`,
    )
    .bind(`a11y_${capability}_${userId}`, userId, capability, now)
    .run();
}

export interface CollectFixturesOptions {
  /**
   * Extra request headers applied to every fixture GET. The i18n pseudolocale
   * check uses this to render the whole set under `Accept-Language: en-XA`.
   */
  readonly headers?: Readonly<Record<string, string>>;
}

/** GET `path` as `login`, asserting the status; returns the body. */
async function page(
  env: Env,
  path: string,
  login?: LoginResult,
  extraHeaders: Readonly<Record<string, string>> = {},
  expectedStatus = 200,
): Promise<string> {
  const response = await appRequest(
    createTestApp(),
    path,
    {
      headers: {
        Accept: "text/html",
        ...(login === undefined ? {} : { Cookie: login.cookieHeader }),
        ...extraHeaders,
      },
    },
    env,
  );
  const body = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(
      `fixture GET ${path} → ${response.status}\n${body.slice(0, 400)}`,
    );
  }
  return body;
}

/**
 * POST `fields` to `path` as a browser form would. Error pages are only ever
 * reached this way — a rejected form re-renders in place rather than
 * redirecting — so the fixtures for them have to submit, not fetch.
 */
async function formPost(
  env: Env,
  path: string,
  fields: Readonly<Record<string, string>>,
  login?: LoginResult,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<Response> {
  return appRequest(
    createTestApp(),
    path,
    {
      body: new URLSearchParams(fields).toString(),
      headers: {
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
        ...(login === undefined
          ? {}
          : {
              Cookie: login.cookieHeader,
              "X-CSRF-Token": login.csrfToken,
            }),
        ...extraHeaders,
      },
      method: "POST",
    },
    env,
  );
}

/** `?a=1&b=1&…` for every flash-notice parameter a page understands. */
function noticeQuery(...params: readonly string[]): string {
  return `?${params.map((param) => `${param}=1`).join("&")}`;
}

interface ToolKey {
  readonly privateJwkJson: string;
}

let cachedToolKey: Promise<ToolKey> | null = null;

/**
 * Carnap's own Deep Linking signing key (distinct from the platform's launch
 * key). Cached per process: RSA generation is the slow part, and every fixture
 * collection in a run wants the same one.
 */
function toolKey(): Promise<ToolKey> {
  cachedToolKey ??= (async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    const privateJwk = await exportJWK(pair.privateKey);

    privateJwk.alg = "RS256";
    privateJwk.kid = "carnap-fixture-tool-key";

    return { privateJwkJson: JSON.stringify(privateJwk) };
  })();

  return cachedToolKey;
}

const DEEP_LINK_SETTINGS_CLAIM =
  "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings";

/** Cookies from an LTI launch, reusable as a `LoginResult`. */
function launchLogin(result: {
  readonly cookieHeader: string | null;
  readonly csrfToken: string | null;
}): LoginResult {
  return {
    actorId: "",
    cookieHeader: result.cookieHeader ?? "",
    csrfToken: result.csrfToken ?? "",
  };
}

/** The single-use selection token the Deep Linking picker carries. */
function selectionToken(html: string): string {
  const match = html.match(/name="token" type="hidden" value="(ldl_[^"]+)"/);

  if (match?.[1] === undefined) {
    throw new Error("The Deep Linking picker carried no selection token.");
  }

  return match[1];
}

/**
 * Seed one course (all exercise kinds), publish it, enrol a student, open an
 * attempt, and render every representative template. Returns the fixtures.
 */
export async function collectFixtures(
  options: CollectFixturesOptions = {},
): Promise<Fixture[]> {
  const headers = options.headers ?? {};
  const storage = await createTestStorage();
  const env: Env = { CARNAP_ENV: "local", DB: storage.db };
  try {
    const instructor = await login(env, "a11y-instructor@example.test");
    const student = await login(env, "a11y-student@example.test");
    const newcomer = await login(env, "a11y-newcomer@example.test");
    await grantCapability(env, instructor.actorId, "course_creator");
    await grantCapability(env, instructor.actorId, "site_admin");

    // Course.
    const courseResponse = await appRequest(
      createTestApp(),
      "/courses",
      jsonRequest({ timezone: "UTC", title: "Intro Logic" }, instructor),
      env,
    );
    const courseId = (
      (await courseResponse.json()) as { course: { id: string } }
    ).course.id;

    // Content item + revision (all four exercise kinds).
    const itemResponse = await appRequest(
      createTestApp(),
      "/content",
      jsonRequest({ title: "Accessibility lesson" }, instructor),
      env,
    );
    const itemId = ((await itemResponse.json()) as { item: { id: string } })
      .item.id;
    const revisionResponse = await appRequest(
      createTestApp(),
      `/content/${itemId}/revisions`,
      jsonRequest({ sourceText: LESSON_SOURCE }, instructor),
      env,
    );
    const revisionId = (
      (await revisionResponse.json()) as { revision: { id: string } }
    ).revision.id;
    if (revisionResponse.status !== 201) {
      throw new Error(
        `lesson revision failed: ${revisionResponse.status}\n` +
          JSON.stringify(await revisionResponse.json()),
      );
    }

    // Assignment (draft → publish).
    const draftResponse = await appRequest(
      createTestApp(),
      `/courses/${courseId}/assignments`,
      jsonRequest(
        {
          contentRevisionId: revisionId,
          description: "Submission practice.",
          title: "Homework",
        },
        instructor,
      ),
      env,
    );
    const assignmentId = (
      (await draftResponse.json()) as { assignment: { id: string } }
    ).assignment.id;
    await appRequest(
      createTestApp(),
      `/courses/${courseId}/assignments/${assignmentId}/publish`,
      { headers: authHeaders(instructor), method: "POST" },
      env,
    );

    // Enrolment link → student joins; keep the link for the newcomer view.
    const linkResponse = await appRequest(
      createTestApp(),
      `/courses/${courseId}/enrollment-links`,
      jsonRequest({}, instructor),
      env,
    );
    const enrollmentPath = (
      (await linkResponse.json()) as {
        enrollmentLink: { enrollmentPath: string };
      }
    ).enrollmentLink.enrollmentPath;
    await appRequest(
      createTestApp(),
      enrollmentPath,
      { headers: authHeaders(student), method: "POST" },
      env,
    );

    // A second assignment kept in draft: the instructor detail page and the
    // edit form both say something completely different before publication.
    const secondDraftResponse = await appRequest(
      createTestApp(),
      `/courses/${courseId}/assignments`,
      jsonRequest(
        {
          contentRevisionId: revisionId,
          description: "Not published yet.",
          title: "Homework draft",
        },
        instructor,
      ),
      env,
    );
    const draftAssignmentId = (
      (await secondDraftResponse.json()) as { assignment: { id: string } }
    ).assignment.id;

    // A third, published-but-unattempted assignment, so the student page can be
    // captured in its "Before you start" briefing state as well as its
    // answering state — the two share no copy at all.
    const briefingResponse = await appRequest(
      createTestApp(),
      `/courses/${courseId}/assignments`,
      jsonRequest(
        {
          contentRevisionId: revisionId,
          description: "Not started yet.",
          maxAttempts: 2,
          timeLimitMinutes: 30,
          title: "Homework briefing",
        },
        instructor,
      ),
      env,
    );
    const briefingAssignmentId = (
      (await briefingResponse.json()) as { assignment: { id: string } }
    ).assignment.id;
    await appRequest(
      createTestApp(),
      `/courses/${courseId}/assignments/${briefingAssignmentId}/publish`,
      { headers: authHeaders(instructor), method: "POST" },
      env,
    );

    // Student opens an attempt so the assignment page is in its answering state.
    const attemptResponse = await appRequest(
      createTestApp(),
      `/courses/${courseId}/assignments/${assignmentId}/attempts`,
      { headers: authHeaders(student), method: "POST" },
      env,
    );
    const attemptId = (
      (await attemptResponse.json()) as { attempt: { id: string } }
    ).attempt.id;

    // …and answers one exercise, so the review templates (instructor queue,
    // student results) have a submission to render rather than an empty state.
    await appRequest(
      createTestApp(),
      `/courses/${courseId}/assignments/${assignmentId}` +
        `/attempts/${attemptId}/submissions`,
      jsonRequest(
        {
          answer: {
            data: { selectedOptionIds: ["yes"] },
            kind: "multiple-choice-answer@1",
            schemaVersion: 1,
          },
          exerciseId: "mc",
        },
        student,
      ),
      env,
    );

    const instructorBase = `/courses/${courseId}/instructor/assignments/${assignmentId}`;

    // Grading policy the instructor page renders as a filled-in form, and a
    // per-student override so the roster table has a row with values in it.
    await formPost(
      env,
      `${instructorBase}/late-policy`,
      { graceMinutes: "15", kind: "percent", percentPenalty: "10" },
      instructor,
    );
    await formPost(
      env,
      `${instructorBase}/overrides`,
      { maxAttempts: "3", userId: student.actorId },
      instructor,
    );
    // Released grades: the student results page has two mutually exclusive
    // shapes, and the withheld one is captured before this runs.
    const withheldResults = await page(
      env,
      `/courses/${courseId}/assignments/${assignmentId}/results`,
      student,
      headers,
    );
    await formPost(
      env,
      `${instructorBase}/grade-visibility`,
      { intent: "release" },
      instructor,
    );

    const assignmentPath = `/courses/${courseId}/assignments/${assignmentId}`;
    const fixtures: Fixture[] = [];
    /** GET `path` and record it under `name`. */
    const add = async (
      name: string,
      path: string,
      as?: LoginResult,
      expectedStatus = 200,
    ): Promise<void> => {
      fixtures.push({
        html: await page(env, path, as, headers, expectedStatus),
        name,
      });
    };
    /**
     * POST `fields` and record whatever it renders under `name`. The shared
     * `headers` go on every submission too: a page rendered in response to a
     * POST resolves its locale from that request, so omitting them here would
     * put an English page in the pseudolocale set and report the whole layout
     * as a leak.
     */
    const addPost = async (
      name: string,
      path: string,
      fields: Readonly<Record<string, string>>,
      as?: LoginResult,
      expectedStatus = 200,
    ): Promise<void> => {
      const response = await formPost(env, path, fields, as, headers);
      const html = await response.text();

      if (response.status !== expectedStatus) {
        throw new Error(
          `fixture POST ${path} → ${response.status}\n${html.slice(0, 400)}`,
        );
      }

      fixtures.push({ html, name });
    };

    await add("login", "/login");
    await add("donate", "/donate");
    await add("courses-index", "/courses", instructor);
    await add("course-detail-instructor", `/courses/${courseId}`, instructor);
    await add("course-detail-student", `/courses/${courseId}`, student);
    // Every course-detail flash notice at once: they are query-parameter
    // driven and mutually independent, so one request renders them all.
    await add(
      "course-detail-notices",
      `/courses/${courseId}${noticeQuery(
        "created",
        "cloned",
        "courseUpdated",
        "archived",
        "unarchived",
        "enrolled",
        "accommodationSaved",
        "revoked",
        "membershipUpdated",
        "staffAdded",
        "assignmentDeleted",
        "ltiLinked",
        "gradeSyncRetried",
      )}`,
      instructor,
    );
    await add("enrollment", enrollmentPath, newcomer);
    // A second course, archived and never used: it puts the archived section on
    // the course list, the archived banner on the detail page, and the empty
    // states (no assignments, no enrollment links, no roster) beside it.
    const emptyCourseId = (
      (await (
        await appRequest(
          createTestApp(),
          "/courses",
          jsonRequest({ timezone: "UTC", title: "Empty course" }, instructor),
          env,
        )
      ).json()) as { course: { id: string } }
    ).course.id;

    await add("course-detail-empty", `/courses/${emptyCourseId}`, instructor);
    await appRequest(
      createTestApp(),
      `/courses/${emptyCourseId}/archive`,
      { headers: authHeaders(instructor), method: "POST" },
      env,
    );
    await add(
      "course-detail-archived",
      `/courses/${emptyCourseId}`,
      instructor,
    );
    await add("courses-index-archived", "/courses", instructor);
    // Someone with neither a course nor permission to make one: the list page
    // says something entirely different to them.
    await add("courses-index-newcomer", "/courses", newcomer);

    await add("content-library", "/content", instructor);
    await add(
      "content-item",
      `/content/${itemId}${noticeQuery("created", "revisionCreated")}`,
      instructor,
    );
    await add(
      "content-revision",
      `/content/revisions/${revisionId}`,
      instructor,
    );
    // The library's own reader view of a revision, which is a different
    // template from the one an assignment serves — same lesson, no attempt,
    // no exercise state, its own chrome.
    await add(
      "content-revision-document",
      `/content/revisions/${revisionId}/document`,
      instructor,
    );
    await add(
      "revision-editor",
      `/content/${itemId}/revisions/new`,
      instructor,
    );
    // The editor's other half: a rejected save re-renders it with the compiler
    // diagnostics listed. Nothing else in the app displays a diagnostic.
    await addPost(
      "revision-editor-diagnostics",
      `/content/${itemId}/revisions/new`,
      { sourceText: BROKEN_LESSON_SOURCE },
      instructor,
      400,
    );
    await add("profile", "/profile", instructor);

    await add("assignment-instructor", assignmentPath, instructor);
    await add("assignment-student", assignmentPath, student);
    await add(
      "assignment-student-briefing",
      `/courses/${courseId}/assignments/${briefingAssignmentId}`,
      student,
    );
    // The post-redirect notices, on the briefing assignment rather than the
    // answering one: the page suppresses all three while an attempt is open.
    await add(
      "assignment-student-notices",
      `/courses/${courseId}/assignments/${briefingAssignmentId}` +
        noticeQuery("submitted", "notRecorded", "attemptStarted"),
      student,
    );
    await add("content-document", `${assignmentPath}/content`, student);
    // The same briefing with the chrome taken away: what an LTI launch shows
    // before an attempt is open. Worth auditing on its own because it is the
    // one page with no header or footer landmark around its main.
    await add(
      "assignment-attempt-gate",
      `/courses/${courseId}/assignments/${briefingAssignmentId}/start`,
      student,
    );

    // The instructor half of assignment-detail.tsx: the published record with
    // its policy and correction sheets, the draft record with its publish and
    // delete actions, and the two forms and two review tables around them.
    await add(
      "assignment-instructor-detail",
      `${instructorBase}${noticeQuery(
        "created",
        "published",
        "updated",
        "repointed",
        "excused",
        "latePolicy",
        "override",
        "gradesReleased",
        "gradesHidden",
        "unpublished",
      )}`,
      instructor,
    );
    await add(
      "assignment-instructor-draft",
      `/courses/${courseId}/instructor/assignments/${draftAssignmentId}`,
      instructor,
    );
    await add(
      "assignment-instructor-content",
      `${instructorBase}/content`,
      instructor,
    );
    // A published, graded, never-attempted assignment: grades still to release,
    // no override recorded, and the empty attempt and submission ledgers. None
    // of that copy exists on the assignment students have already worked.
    const briefingBase = `/courses/${courseId}/instructor/assignments/${briefingAssignmentId}`;

    await add("assignment-instructor-unreleased", briefingBase, instructor);
    await add(
      "instructor-submissions-empty",
      `${briefingBase}/submissions`,
      instructor,
    );
    await add(
      "instructor-attempts-empty",
      `${briefingBase}/attempts`,
      instructor,
    );
    await add(
      "assignment-new",
      `/courses/${courseId}/instructor/assignments/new`,
      instructor,
    );
    await add(
      "assignment-edit-draft",
      `/courses/${courseId}/instructor/assignments/${draftAssignmentId}/edit`,
      instructor,
    );
    await add(
      "assignment-edit-published",
      `${instructorBase}/edit`,
      instructor,
    );
    await add(
      "instructor-submissions",
      `${instructorBase}/submissions${noticeQuery("approved", "manualEvaluation")}&review=all`,
      instructor,
    );
    await add(
      "instructor-attempts",
      `${instructorBase}/attempts${noticeQuery("attemptReset")}`,
      instructor,
    );

    await add("student-results", `${assignmentPath}/results`, student);
    fixtures.push({
      html: withheldResults,
      name: "student-results-withheld",
    });

    await add(
      "course-gradebook",
      `/courses/${courseId}/instructor/gradebook`,
      instructor,
    );
    await add(
      "assignment-gradebook",
      `${instructorBase}/gradebook`,
      instructor,
    );

    await add("admin-dashboard", `/admin${noticeQuery("saved")}`, instructor);
    await add("admin-users", "/admin/users", instructor);
    await add(
      "admin-user-profile",
      `/admin/users/${student.actorId}${noticeQuery("saved")}`,
      instructor,
    );
    await add("admin-audit", "/admin/audit", instructor);
    await add("admin-bootstrap", "/admin/bootstrap", instructor);
    await add(
      "admin-lti",
      `/admin/lti${noticeQuery(
        "registered",
        "deploymentAdded",
        "deploymentRemoved",
        "disabled",
        "enabled",
      )}`,
      instructor,
    );

    // Error pages. None is reachable by GET-ing a happy path, and until they
    // had fixtures a whole batch of hard-coded English survived on them.
    // A course you may not see and one that does not exist are deliberately
    // indistinguishable, hence 403 where content answers a plain 404.
    await add("error-course", `/courses/${courseId}zzz`, instructor, 403);
    await add("error-content", `/content/${itemId}zzz`, instructor, 404);
    await addPost(
      "error-login",
      "/login",
      { email: "not-an-email" },
      undefined,
      400,
    );
    await addPost("login-sent", "/login", {
      email: "a11y-newcomer@example.test",
    });
    // A percentage late policy with no percentage: rejected by the service, so
    // the generic form-error template renders in place of the redirect.
    await addPost(
      "error-form",
      `${instructorBase}/late-policy`,
      { kind: "percent" },
      instructor,
      400,
    );
    await addPost(
      "error-assignment-form",
      `/courses/${courseId}/assignments`,
      { contentRevisionId: "", title: "" },
      instructor,
      400,
    );
    await addPost(
      "error-content-create",
      "/content",
      { title: "" },
      instructor,
      400,
    );
    // The course list re-rendered around a rejected create, which is its own
    // template rather than the generic form error.
    //
    // Rejected on the *title*, which is the obvious way to provoke it. It could
    // not be, while `AppHttpError` messages were English literals: the title
    // validator says "Course title must be between…", which embeds the catalog
    // id "Course title", so an untranslated copy of that sentence tripped the
    // hard gate as though the label had been hard-coded a second time. Now that
    // service-layer messages are deferred (`deferred.i18n.t`), the sentence
    // pseudolocalizes with everything else and the embedded id goes with it —
    // which makes this fixture a test of that, too.
    await addPost(
      "error-course-create",
      "/courses",
      { title: "" },
      instructor,
      400,
    );
    await addPost(
      "error-admin-form",
      `/admin/users/${student.actorId}/capabilities`,
      { capability: "not-a-capability" },
      instructor,
      400,
    );
    await addPost(
      "error-admin-lti-form",
      "/admin/lti/platforms",
      { name: "" },
      instructor,
      400,
    );

    // Last, because the launches seed users and courses of their own: every
    // fixture above is already captured by the time they run.
    for (const fixture of await ltiFixtures(env, storage.stores, headers)) {
      fixtures.push(fixture);
    }

    return fixtures;
  } finally {
    await storage.dispose();
  }
}

/**
 * The six LTI page templates. Every one of them is mid-handshake — a launch
 * failure, an account-link challenge, the Deep Linking picker — so none can be
 * reached by GET-ing a URL, and all six were invisible to both gates until
 * this ran the handshakes for real.
 */
async function ltiFixtures(
  env: Env,
  stores: AppStores,
  headers: Readonly<Record<string, string>>,
): Promise<Fixture[]> {
  const ltiEnv: Env = {
    ...env,
    LTI_TOOL_PRIVATE_KEY: (await toolKey()).privateJwkJson,
  };
  const app = await createLtiTestApp();

  await registerTestPlatform(stores);

  const captured = async (
    response: Response,
    name: string,
    expectedStatus = 200,
  ): Promise<Fixture> => {
    const html = await response.text();

    if (response.status !== expectedStatus) {
      throw new Error(
        `LTI fixture ${name} → ${response.status}\n${html.slice(0, 400)}`,
      );
    }

    return { html, name };
  };
  const post = async (
    path: string,
    fields: Readonly<Record<string, string>>,
    cookie?: string,
  ): Promise<Response> =>
    app.request(
      path,
      {
        body: new URLSearchParams(fields).toString(),
        headers: {
          Accept: "text/html",
          "Content-Type": "application/x-www-form-urlencoded",
          ...headers,
          ...(cookie === undefined ? {} : { Cookie: cookie }),
        },
        method: "POST",
      },
      ltiEnv,
    );

  // A login initiation missing `iss` fails before any token is minted.
  const launchFailure = await captured(
    await app.request(
      "/lti/login?login_hint=someone",
      { headers: { Accept: "text/html", ...headers } },
      ltiEnv,
    ),
    "lti-error",
    400,
  );

  // An instructor launch creates the course the Deep Linking picker lists. Its
  // resource link arrives unassociated, which is what puts the "LMS activity
  // links" sheet — invisible to a course that was never launched into — on the
  // course page below.
  const instructorLaunch = await performLaunch(app, ltiEnv, {
    email: "lti-instructor@example.test",
    headers,
    name: "Ida Instructor",
    resourceLink: { id: "lms-resource-1", title: "Week 1" },
    roles: [INSTRUCTOR_ROLE],
    sub: "lms-instructor-1",
  });
  const courseId =
    (instructorLaunch.response.headers.get("Location") ?? "").split("/")[2] ??
    "";
  const launched = launchLogin(instructorLaunch);
  const lmsItemId = (
    (await (
      await appRequest(
        app,
        "/content",
        jsonRequest({ title: "LMS lesson" }, launched),
        ltiEnv,
      )
    ).json()) as { item: { id: string } }
  ).item.id;
  const lmsRevisionId = (
    (await (
      await appRequest(
        app,
        `/content/${lmsItemId}/revisions`,
        jsonRequest({ sourceText: "# LMS lesson" }, launched),
        ltiEnv,
      )
    ).json()) as { revision: { id: string } }
  ).revision.id;
  const lmsAssignmentId = (
    (await (
      await appRequest(
        app,
        `/courses/${courseId}/assignments`,
        jsonRequest(
          { contentRevisionId: lmsRevisionId, title: "LMS homework" },
          launched,
        ),
        ltiEnv,
      )
    ).json()) as { assignment: { id: string } }
  ).assignment.id;

  // Deep Linking: the picker, then the signed response handed back.
  const picker = await performLaunch(app, ltiEnv, {
    claims: {
      [DEEP_LINK_SETTINGS_CLAIM]: {
        accept_multiple: false,
        accept_types: ["ltiResourceLink"],
        data: "fixture-opaque-1",
        deep_link_return_url: "https://lms.example.test/deep-link-return",
      },
    },
    email: "lti-instructor@example.test",
    headers,
    messageType: "LtiDeepLinkingRequest",
    name: "Ida Instructor",
    roles: [INSTRUCTOR_ROLE],
    sub: "lms-instructor-1",
  });
  const pickerHtml = await picker.response.text();
  const deepLinkReturn = await captured(
    await post(
      "/lti/deep-link/respond",
      {
        assignmentId: lmsAssignmentId,
        csrfToken: picker.csrfToken ?? "",
        token: selectionToken(pickerHtml),
      },
      picker.cookieHeader ?? "",
    ),
    "lti-deep-link-return",
  );

  // Account linking: a launch asserting the email of an account that already
  // exists natively, then the confirmation page and the result of confirming.
  await login(ltiEnv, "lti-linked@example.test");

  const pending = await performLaunch(app, ltiEnv, {
    email: "lti-linked@example.test",
    headers,
    name: "Linked Learner",
    sub: "lms-learner-2",
  });
  const pendingHtml = await pending.response.text();
  const linkToken =
    pendingHtml.match(/\/lti\/link\/confirm\?token=([^"&]+)/)?.[1] ?? "";

  if (linkToken.length === 0) {
    throw new Error("The link-pending page carried no confirmation link.");
  }

  const confirm = await captured(
    await app.request(
      `/lti/link/confirm?token=${linkToken}`,
      { headers: { Accept: "text/html", ...headers } },
      ltiEnv,
    ),
    "lti-link-confirm",
  );
  const confirmed = await captured(
    await post("/lti/link/confirm", { token: linkToken }),
    "lti-link-confirmed",
  );

  const ltiCourse = await captured(
    await app.request(
      `/courses/${courseId}`,
      {
        headers: {
          Accept: "text/html",
          Cookie: launched.cookieHeader,
          ...headers,
        },
      },
      ltiEnv,
    ),
    "course-detail-lti",
  );

  return [
    launchFailure,
    { html: pickerHtml, name: "lti-deep-link-select" },
    deepLinkReturn,
    { html: pendingHtml, name: "lti-link-pending" },
    confirm,
    confirmed,
    ltiCourse,
  ];
}
