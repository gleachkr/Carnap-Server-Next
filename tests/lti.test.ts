import { describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  jwtVerify,
} from "jose";

import { AuthService, hashAuthToken } from "../src/worker/application/auth";
import { LtiService } from "../src/worker/application/lti";
import type { AppStores } from "../src/worker/application/stores";
import type { Env } from "../src/worker/env";
import type { WorkerApp } from "../src/worker/http";
import {
  beginTestLogin,
  CONTENT_DEVELOPER_ROLE,
  createLtiTestApp,
  formRequest,
  INSTRUCTOR_ROLE,
  LEARNER_ROLE,
  mintIdToken,
  performLaunch,
  registerTestPlatform,
  TEACHING_ASSISTANT_ROLE,
  TEST_CLIENT_ID,
  TEST_DEPLOYMENT_ID,
  TEST_ISSUER,
  type TestPlatformFixture,
  testPlatformKeys,
} from "./helpers/lti";
import { EMPTY_ARTIFACT } from "./helpers/seed";
import { createTestStorage, type TestStorage } from "./helpers/storage";

const NOW = "2026-01-02T03:04:05.000Z";

setDefaultTimeout(30_000);

async function withLtiApp(
  run: (
    app: WorkerApp,
    env: Env,
    stores: AppStores,
    fixture: TestPlatformFixture,
  ) => Promise<void>,
): Promise<void> {
  const storage: TestStorage = await createTestStorage();

  try {
    const app = await createLtiTestApp();
    const env: Env = { CARNAP_ENV: "local", DB: storage.db };
    const fixture = await registerTestPlatform(storage.stores);

    await run(app, env, storage.stores, fixture);
  } finally {
    await storage.dispose();
  }
}

/** The `Set-Cookie` header carrying the session, attributes and all. */
function sessionCookieAttributes(response: Response): string {
  const headers = response.headers as Headers & {
    readonly getSetCookie?: () => string[];
  };

  return (
    headers
      .getSetCookie?.()
      .find((header) => header.startsWith("carnap_session=")) ?? ""
  );
}

function redirectPath(response: Response): string {
  const location = response.headers.get("Location");

  if (location === null) {
    throw new Error("Expected a redirect location.");
  }

  return location;
}

function courseIdFromLaunch(response: Response): string {
  const match = redirectPath(response).match(/^\/courses\/([^/?]+)/);

  if (match === null || match[1] === undefined) {
    throw new Error(
      `Expected a course redirect, got ${redirectPath(response)}`,
    );
  }

  return match[1];
}

async function instructorLaunch(
  app: WorkerApp,
  env: Env,
  overrides: Parameters<typeof performLaunch>[2] = {},
) {
  return performLaunch(app, env, {
    email: "instructor@example.test",
    name: "Ida Instructor",
    roles: [INSTRUCTOR_ROLE],
    sub: "lms-instructor-1",
    ...overrides,
  });
}

async function launchedUserId(
  stores: AppStores,
  fixture: TestPlatformFixture,
  sub: string,
): Promise<string> {
  const identity = await stores.users.getExternalIdentity(
    "lti",
    `${fixture.platform.id}:${sub}`,
  );

  if (identity === null) {
    throw new Error(`No LTI identity recorded for ${sub}.`);
  }

  return identity.userId;
}

async function createAssignmentInCourse(
  stores: AppStores,
  courseId: string,
  ownerId: string,
): Promise<string> {
  const item = await stores.content.createItem({
    id: `content-item-${courseId}`,
    ownerUserId: ownerId,
    title: "Proofs",
    createdAt: NOW,
  });
  const revision = await stores.content.createRevision({
    id: `content-revision-${courseId}`,
    itemId: item.id,
    revisionNumber: 1,
    details: "",
    sourceFormat: "markdown",
    sourceText: "# Proofs",
    contentHash: "sha256:proofs",
    compiled: EMPTY_ARTIFACT,
    createdById: ownerId,
    createdAt: NOW,
  });
  const assignment = await stores.assignments.create({
    id: `assignment-${courseId}`,
    courseId,
    contentRevisionId: revision.id,
    title: "Homework 1",
    description: "",
    assessmentMode: "graded",
    displayOrder: 0,
    availableFrom: null,
    dueAt: null,
    availableUntil: null,
    gradesVisibleAt: null,
    listed: true,
    maxAttempts: 1,
    timeLimitMinutes: null,
    createdById: ownerId,
    createdAt: NOW,
  });

  return assignment.id;
}

describe("LTI 1.3 core launches", () => {
  test("a valid instructor launch creates a course, a membership, and a session", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      const launch = await instructorLaunch(app, env);

      expect(launch.response.status).toBe(303);
      expect(launch.cookieHeader).toContain("carnap_session=");

      const courseId = courseIdFromLaunch(launch.response);
      const me = await app.request(
        "/auth/me",
        { headers: { Cookie: launch.cookieHeader ?? "" } },
        env,
      );

      expect(me.status).toBe(200);

      const body = (await me.json()) as {
        readonly actor: { readonly email: string };
      };

      expect(body.actor.email).toBe("instructor@example.test");

      const course = await stores.courses.getById(courseId);

      expect(course?.title).toBe("Intro Logic (LMS)");

      const userId = await launchedUserId(
        stores,
        fixture,
        "lms-instructor-1",
      );
      const membership = await stores.courses.getMembership(courseId, userId);

      expect(membership?.role).toBe("instructor");
      expect(membership?.status).toBe("active");
    });
  });

  test("a student launch into a mapped context enrolls and lands on the course", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      const setup = await instructorLaunch(app, env);
      const courseId = courseIdFromLaunch(setup.response);
      const launch = await performLaunch(app, env, {
        email: "student@example.test",
        roles: [LEARNER_ROLE],
        sub: "lms-student-1",
      });

      expect(launch.response.status).toBe(303);
      expect(redirectPath(launch.response)).toBe(`/courses/${courseId}`);

      const userId = await launchedUserId(stores, fixture, "lms-student-1");
      const membership = await stores.courses.getMembership(courseId, userId);

      expect(membership?.role).toBe("student");
    });
  });

  // What an embedded launch stands or falls on: a `Lax` session is not sent
  // inside someone else's iframe at all, so the student would arrive signed
  // out. Over https the launch mints one a browser will send there — which is
  // also why the local rig tests embedding with `--local-protocol https`.
  test("an https launch mints a session that survives an LMS iframe", async () => {
    await withLtiApp(async (app, env) => {
      const overHttps = await instructorLaunch(app, env, {
        origin: "https://localhost",
      });
      const overHttp = await instructorLaunch(app, env);

      expect(overHttps.response.status).toBe(303);
      expect(sessionCookieAttributes(overHttps.response)).toContain(
        "SameSite=None",
      );
      expect(sessionCookieAttributes(overHttps.response)).toContain("Secure");
      // Plain http cannot have it: browsers reject `None` without `Secure`,
      // and `Secure` over http is a cookie thrown away.
      expect(sessionCookieAttributes(overHttp.response)).toContain(
        "SameSite=Lax",
      );
      expect(sessionCookieAttributes(overHttp.response)).not.toContain(
        "Secure",
      );
    });
  });

  test("a student launch into an unmapped context fails with a friendly page", async () => {
    await withLtiApp(async (app, env) => {
      const launch = await performLaunch(app, env, {
        roles: [LEARNER_ROLE],
        sub: "lms-student-1",
      });

      expect(launch.response.status).toBe(400);
      expect(launch.cookieHeader).toBeNull();

      const body = await launch.response.text();

      expect(body).toContain("lti_course_not_ready");
      expect(body).toContain("Ask your instructor");
    });
  });

  test("the same LTI subject resolves to the same user across launches", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      await instructorLaunch(app, env);

      const firstUserId = await launchedUserId(
        stores,
        fixture,
        "lms-instructor-1",
      );

      await instructorLaunch(app, env);

      const secondUserId = await launchedUserId(
        stores,
        fixture,
        "lms-instructor-1",
      );

      expect(secondUserId).toBe(firstUserId);
    });
  });

  test("a launch without an email creates a placeholder-email user", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      const launch = await instructorLaunch(app, env, {
        email: null,
        sub: "lms-anon-1",
      });

      expect(launch.response.status).toBe(303);

      const userId = await launchedUserId(stores, fixture, "lms-anon-1");
      const user = await stores.users.getById(userId);

      expect(user?.email).toMatch(/^lti-.+@lti\.invalid$/);
      expect(user?.name).toBe("Ida Instructor");
    });
  });

  // A platform that shares no name leaves the account showing as a bare
  // (often placeholder) address everywhere, and the prompt that would ask the
  // owner to fix it never reaches them: a launch lands on chrome-free pages.
  // So a later launch that does carry a name fills the blank.
  test("a later launch names an account the first launch left blank", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      await instructorLaunch(app, env, { email: null, name: null });

      const userId = await launchedUserId(
        stores,
        fixture,
        "lms-instructor-1",
      );

      expect((await stores.users.getById(userId))?.name).toBeNull();

      await instructorLaunch(app, env, {
        email: null,
        name: "Ida Instructor",
      });

      expect((await stores.users.getById(userId))?.name).toBe(
        "Ida Instructor",
      );
    });
  });

  test("a launch does not overwrite a name its owner chose", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      await instructorLaunch(app, env, { email: null, name: null });

      const userId = await launchedUserId(
        stores,
        fixture,
        "lms-instructor-1",
      );

      await stores.users.updateProfile(
        userId,
        { locale: null, name: "Ada, Countess of Lovelace" },
        NOW,
      );
      await instructorLaunch(app, env, { email: null, name: "A. Lovelace" });

      expect((await stores.users.getById(userId))?.name).toBe(
        "Ada, Countess of Lovelace",
      );
    });
  });

  // Storing a name the profile form would refuse would leave the owner unable
  // to save that page at all until they edited a name they never wrote.
  test("an asserted name over the length limit is left on the floor", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      await instructorLaunch(app, env, { email: null, name: null });
      await instructorLaunch(app, env, {
        email: null,
        name: "x".repeat(201),
      });

      const userId = await launchedUserId(
        stores,
        fixture,
        "lms-instructor-1",
      );

      expect((await stores.users.getById(userId))?.name).toBeNull();
    });
  });

  test("an asserted email that matches an existing account requires link confirmation", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      const existing = await stores.users.create({
        id: "user-existing",
        email: "instructor@example.test",
        name: "Ida Instructor",
        createdAt: NOW,
      });

      // First launch: no session; the pending page carries the local
      // confirmation link because no email delivery is configured locally.
      const first = await instructorLaunch(app, env);

      expect(first.response.status).toBe(200);
      expect(first.cookieHeader).toBeNull();

      const firstBody = await first.response.text();

      expect(firstBody).toContain("Confirm account link");
      expect(firstBody).toContain("instructor@example.test");

      const confirmMatch = firstBody.match(
        /href="([^"]*\/lti\/link\/confirm\?token=[^"]+)"/,
      );

      if (confirmMatch === null || confirmMatch[1] === undefined) {
        throw new Error("Expected a local confirmation link on the page.");
      }

      // A repeat launch while the challenge is pending shows the page again
      // without minting a fresh link.
      const repeat = await instructorLaunch(app, env);
      const repeatBody = await repeat.response.text();

      expect(repeat.response.status).toBe(200);
      expect(repeatBody).toContain("Confirm account link");
      expect(repeatBody).not.toContain("/lti/link/confirm?token=");

      const confirmUrl = new URL(confirmMatch[1].replaceAll("&amp;", "&"));
      const token = confirmUrl.searchParams.get("token") ?? "";

      // Opening the emailed URL only describes the link — a prefetching
      // email scanner must not be able to complete it. Repeat GETs stay
      // harmless; the button's POST does the linking.
      for (let visit = 0; visit < 2; visit += 1) {
        const confirmPage = await app.request(
          `${confirmUrl.pathname}${confirmUrl.search}`,
          {},
          env,
        );

        expect(confirmPage.status).toBe(200);

        const confirmPageBody = await confirmPage.text();

        expect(confirmPageBody).toContain("Link accounts");
        expect(confirmPageBody).toContain("instructor@example.test");
      }

      const confirm = await app.request(
        "/lti/link/confirm",
        formRequest({ token }),
        env,
      );

      expect(confirm.status).toBe(200);
      expect(await confirm.text()).toContain("Accounts linked");

      // The confirmation token is single-use.
      const replayConfirm = await app.request(
        "/lti/link/confirm",
        formRequest({ token }),
        env,
      );

      expect(await replayConfirm.text()).toContain("lti_link_invalid");

      // Relaunching now signs into the linked account.
      const relaunch = await instructorLaunch(app, env);

      expect(relaunch.response.status).toBe(303);

      const userId = await launchedUserId(
        stores,
        fixture,
        "lms-instructor-1",
      );

      expect(userId).toBe(existing.id);

      // Clicking the emailed approval also proved the mailbox.
      const linked = await stores.users.getById(existing.id);

      expect(linked?.emailVerifiedAt).not.toBeNull();
    });
  });

  // The commonest way to end up nameless with an LMS that knows your name:
  // reach Carnap by email first, and link the launch to that account after.
  test("approving a link names the account it attaches to", async () => {
    await withLtiApp(async (app, env, stores) => {
      const existing = await stores.users.create({
        id: "user-nameless",
        email: "instructor@example.test",
        name: null,
        createdAt: NOW,
      });
      const pending = await instructorLaunch(app, env);
      const body = await pending.response.text();
      const match = body.match(
        /href="[^"]*\/lti\/link\/confirm\?token=([^"&]+)/,
      );

      if (match?.[1] === undefined) {
        throw new Error("Expected a local confirmation link on the page.");
      }

      expect((await stores.users.getById(existing.id))?.name).toBeNull();

      const confirm = await app.request(
        "/lti/link/confirm",
        formRequest({ token: match[1] }),
        env,
      );

      expect(confirm.status).toBe(200);
      expect((await stores.users.getById(existing.id))?.name).toBe(
        "Ida Instructor",
      );
    });
  });

  test("email verification tracks how the address was proven", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      // An address asserted by an LTI launch starts unverified.
      await instructorLaunch(app, env);

      const userId = await launchedUserId(
        stores,
        fixture,
        "lms-instructor-1",
      );
      const asserted = await stores.users.getById(userId);

      expect(asserted?.emailVerifiedAt).toBeNull();

      // A native login link consumed through that mailbox is the proof.
      const start = await app.request(
        "/auth/login/start",
        {
          body: JSON.stringify({ email: "instructor@example.test" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
        env,
      );
      const startBody = (await start.json()) as {
        readonly login: { readonly loginToken: string };
      };
      const confirm = await app.request(
        "/auth/login/confirm",
        {
          body: JSON.stringify({ loginToken: startBody.login.loginToken }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
        env,
      );

      expect(confirm.status).toBe(200);

      const verified = await stores.users.getById(userId);

      expect(verified?.emailVerifiedAt).not.toBeNull();
    });
  });

  test("a pending link cannot be confirmed after its platform is disabled", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      await stores.users.create({
        id: "user-existing",
        email: "instructor@example.test",
        name: "Ida Instructor",
        createdAt: NOW,
      });

      const first = await instructorLaunch(app, env);
      const firstBody = await first.response.text();
      const confirmMatch = firstBody.match(
        /href="([^"]*\/lti\/link\/confirm\?token=[^"]+)"/,
      );

      if (confirmMatch === null || confirmMatch[1] === undefined) {
        throw new Error("Expected a local confirmation link on the page.");
      }

      const confirmUrl = new URL(confirmMatch[1].replaceAll("&amp;", "&"));
      const token = confirmUrl.searchParams.get("token") ?? "";

      await stores.lti.setPlatformDisabled(fixture.platform.id, NOW, NOW);

      // Disabling the platform is the kill-switch; a challenge already in
      // flight must not remain redeemable.
      const confirm = await app.request(
        "/lti/link/confirm",
        formRequest({ token }),
        env,
      );

      expect(confirm.status).toBe(400);
      expect(await confirm.text()).toContain("lti_platform_unavailable");
      await expect(
        stores.users.getExternalIdentity(
          "lti",
          `${fixture.platform.id}:lms-instructor-1`,
        ),
      ).resolves.toBeNull();
    });
  });

  test("an undeliverable confirmation email withdraws the challenge", async () => {
    await withLtiApp(async (app, env, stores) => {
      await stores.users.create({
        id: "user-existing",
        email: "instructor@example.test",
        name: "Ida Instructor",
        createdAt: NOW,
      });

      // Outside local dev with no email sender configured, the launch fails —
      // and the stored challenge must not survive it, or every later launch
      // would claim an email was sent when none ever can be.
      const failed = await instructorLaunch(app, {
        ...env,
        CARNAP_ENV: "production",
      });

      expect(failed.response.status).toBe(400);
      expect(await failed.response.text()).toContain(
        "lti_link_email_not_configured",
      );

      // The next launch mints a fresh challenge instead of reusing one
      // whose email never went out.
      const retry = await instructorLaunch(app, env);

      expect(await retry.response.text()).toContain(
        "/lti/link/confirm?token=",
      );
    });
  });

  test("a whitespace-only email claim falls back to the placeholder", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      // Two launches: an empty-string email would pass the first and violate
      // the email unique index on the second.
      for (const sub of ["lms-blank-1", "lms-blank-2"]) {
        const launch = await performLaunch(app, env, {
          email: "   ",
          roles: [INSTRUCTOR_ROLE],
          sub,
        });

        expect(launch.response.status).toBe(303);

        const userId = await launchedUserId(stores, fixture, sub);
        const user = await stores.users.getById(userId);

        expect(user?.email).toMatch(/^lti-.+@lti\.invalid$/);
      }
    });
  });

  test("losing the user-creation race lands on the winner's account", async () => {
    await withLtiApp(async (_app, _env, stores, fixture) => {
      const winner = await stores.users.create({
        id: "user-winner",
        email: "racer@example.test",
        name: "Winning Launch",
        createdAt: NOW,
      });

      await stores.users.createExternalIdentity({
        id: "identity-winner",
        userId: winner.id,
        provider: "lti",
        providerSubject: `${fixture.platform.id}:lms-racer-1`,
        createdAt: NOW,
      });

      // Replay the loser's timeline: its existence checks ran before the
      // winner committed (and so saw nothing), but its insert runs after
      // and hits the email unique index.
      let identityChecks = 0;
      let emailChecks = 0;
      const users = new Proxy(stores.users, {
        get(target, property, receiver) {
          if (property === "getExternalIdentity") {
            return async (
              ...args: Parameters<AppStores["users"]["getExternalIdentity"]>
            ) => {
              identityChecks += 1;

              return identityChecks === 1
                ? null
                : target.getExternalIdentity(...args);
            };
          }

          if (property === "getByEmail") {
            return async (
              ...args: Parameters<AppStores["users"]["getByEmail"]>
            ) => {
              emailChecks += 1;

              return emailChecks === 1 ? null : target.getByEmail(...args);
            };
          }

          const value = Reflect.get(target, property, receiver);

          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const racedStores: AppStores = { ...stores, users };
      const keys = await testPlatformKeys();
      const keySet = createLocalJWKSet({ keys: [keys.publicJwk] });
      const service = new LtiService({
        auth: new AuthService({ stores: racedStores }),
        keyResolver: () => keySet,
        stores: racedStores,
      });

      const begun = await service.beginLogin({
        clientId: TEST_CLIENT_ID,
        issuer: TEST_ISSUER,
        launchUrl: "http://localhost/lti/launch",
        loginHint: "lms-racer-1",
        ltiMessageHint: null,
      });
      const redirectUrl = new URL(begun.redirectUrl);
      const idToken = await mintIdToken({
        email: "racer@example.test",
        nonce: redirectUrl.searchParams.get("nonce") ?? "",
        roles: [INSTRUCTOR_ROLE],
        sub: "lms-racer-1",
      });
      const outcome = await service.handleLaunch({
        idToken,
        state: redirectUrl.searchParams.get("state") ?? "",
      });

      expect(outcome.kind).toBe("session");
      expect(emailChecks).toBe(1);

      const identity = await stores.users.getExternalIdentity(
        "lti",
        `${fixture.platform.id}:lms-racer-1`,
      );

      expect(identity?.userId).toBe(winner.id);
    });
  });

  test("LTI roles map to the expected course memberships", async () => {
    const cases: readonly {
      readonly expected: string;
      readonly roles: readonly string[];
      readonly sub: string;
    }[] = [
      { expected: "instructor", roles: [INSTRUCTOR_ROLE], sub: "role-a" },
      {
        expected: "teacher_assistant",
        roles: [INSTRUCTOR_ROLE, TEACHING_ASSISTANT_ROLE],
        sub: "role-b",
      },
      {
        expected: "co_instructor",
        roles: [CONTENT_DEVELOPER_ROLE],
        sub: "role-c",
      },
      { expected: "student", roles: [LEARNER_ROLE], sub: "role-d" },
      { expected: "student", roles: ["Learner"], sub: "role-e" },
      { expected: "instructor", roles: ["Instructor"], sub: "role-f" },
      {
        // Institution-scoped roles say nothing about this course.
        expected: "student",
        roles: [
          "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Instructor",
        ],
        sub: "role-g",
      },
      {
        expected: "student",
        roles: ["http://example.test/some-unknown-role"],
        sub: "role-h",
      },
    ];

    await withLtiApp(async (app, env, stores, fixture) => {
      const setup = await instructorLaunch(app, env);
      const courseId = courseIdFromLaunch(setup.response);

      for (const testCase of cases) {
        const launch = await performLaunch(app, env, {
          email: `${testCase.sub}@example.test`,
          roles: testCase.roles,
          sub: testCase.sub,
        });

        expect(launch.response.status).toBe(303);

        const userId = await launchedUserId(stores, fixture, testCase.sub);
        const membership = await stores.courses.getMembership(
          courseId,
          userId,
        );

        expect(membership?.role).toBe(testCase.expected as never);
      }
    });
  });

  test("a later launch never rewrites an existing membership role", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      const setup = await instructorLaunch(app, env);
      const courseId = courseIdFromLaunch(setup.response);

      await performLaunch(app, env, {
        email: "student@example.test",
        roles: [LEARNER_ROLE],
        sub: "lms-student-1",
      });
      await performLaunch(app, env, {
        email: "student@example.test",
        roles: [INSTRUCTOR_ROLE],
        sub: "lms-student-1",
      });

      const userId = await launchedUserId(stores, fixture, "lms-student-1");
      const membership = await stores.courses.getMembership(courseId, userId);

      expect(membership?.role).toBe("student");
    });
  });

  test("a replayed state is rejected and mints no session", async () => {
    await withLtiApp(async (app, env) => {
      const login = await beginTestLogin(app, env);
      const idToken = await mintIdToken({
        nonce: login.nonce,
        roles: [INSTRUCTOR_ROLE],
      });
      const first = await app.request(
        "/lti/launch",
        formRequest({ id_token: idToken, state: login.state }),
        env,
      );

      expect(first.status).toBe(303);

      const replay = await app.request(
        "/lti/launch",
        formRequest({ id_token: idToken, state: login.state }),
        env,
      );

      expect(replay.status).toBe(400);
      expect(replay.headers.get("Set-Cookie")).toBeNull();
      expect(await replay.text()).toContain("lti_state_invalid");
    });
  });

  test("concurrent launches of one state produce exactly one session", async () => {
    await withLtiApp(async (app, env) => {
      const login = await beginTestLogin(app, env);
      const idToken = await mintIdToken({
        nonce: login.nonce,
        roles: [INSTRUCTOR_ROLE],
      });
      const [first, second] = await Promise.all([
        app.request(
          "/lti/launch",
          formRequest({ id_token: idToken, state: login.state }),
          env,
        ),
        app.request(
          "/lti/launch",
          formRequest({ id_token: idToken, state: login.state }),
          env,
        ),
      ]);
      const statuses = [first.status, second.status].sort();

      expect(statuses).toEqual([303, 400]);
    });
  });

  test("a forged or expired state is rejected", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      const forged = await performLaunch(app, env, {
        state: "lst_forged-state-value",
      });

      expect(forged.response.status).toBe(400);
      expect(await forged.response.text()).toContain("lti_state_invalid");

      await stores.lti.createLoginState({
        stateHash: await hashAuthToken("lst_expired-state"),
        nonceHash: await hashAuthToken("lnn_expired-nonce"),
        platformId: fixture.platform.id,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:10:00.000Z",
      });

      const idToken = await mintIdToken({ nonce: "lnn_expired-nonce" });
      const expired = await app.request(
        "/lti/launch",
        formRequest({ id_token: idToken, state: "lst_expired-state" }),
        env,
      );

      expect(expired.status).toBe(400);
      expect(await expired.text()).toContain("lti_state_invalid");
    });
  });

  test("a wrong issuer is rejected", async () => {
    await withLtiApp(async (app, env) => {
      const launch = await performLaunch(app, env, {
        issuer: "https://evil.example.test",
        roles: [INSTRUCTOR_ROLE],
      });

      expect(launch.response.status).toBe(400);
      expect(await launch.response.text()).toContain("lti_wrong_issuer");
    });
  });

  test("a wrong audience is rejected", async () => {
    await withLtiApp(async (app, env) => {
      const launch = await performLaunch(app, env, {
        audience: "some-other-tool",
        roles: [INSTRUCTOR_ROLE],
      });

      expect(launch.response.status).toBe(400);
      expect(await launch.response.text()).toContain("lti_wrong_audience");
    });
  });

  test("a multi-audience token requires azp to name this tool", async () => {
    await withLtiApp(async (app, env) => {
      const withoutAzp = await performLaunch(app, env, {
        audience: [TEST_CLIENT_ID, "another-tool"],
        roles: [INSTRUCTOR_ROLE],
      });

      expect(withoutAzp.response.status).toBe(400);
      expect(await withoutAzp.response.text()).toContain(
        "lti_wrong_audience",
      );

      const withAzp = await performLaunch(app, env, {
        audience: [TEST_CLIENT_ID, "another-tool"],
        azp: TEST_CLIENT_ID,
        roles: [INSTRUCTOR_ROLE],
      });

      expect(withAzp.response.status).toBe(303);

      // A single-element aud array (Moodle's shape) needs no azp at all,
      // but a wrong azp is still fatal.
      const singleArray = await performLaunch(app, env, {
        audience: [TEST_CLIENT_ID],
        roles: [INSTRUCTOR_ROLE],
      });

      expect(singleArray.response.status).toBe(303);

      const wrongAzp = await performLaunch(app, env, {
        audience: TEST_CLIENT_ID,
        azp: "someone-else",
        roles: [INSTRUCTOR_ROLE],
      });

      expect(wrongAzp.response.status).toBe(400);
    });
  });

  test("an unregistered deployment is rejected and named on the page", async () => {
    await withLtiApp(async (app, env) => {
      const launch = await performLaunch(app, env, {
        deploymentId: "deployment-rogue",
        roles: [INSTRUCTOR_ROLE],
      });

      expect(launch.response.status).toBe(400);

      const body = await launch.response.text();

      expect(body).toContain("lti_deployment_unknown");
      expect(body).toContain("deployment-rogue");
    });
  });

  test("an expired token is rejected", async () => {
    await withLtiApp(async (app, env) => {
      const launch = await performLaunch(app, env, {
        expiresAt: Math.floor(Date.now() / 1000) - 300,
        roles: [INSTRUCTOR_ROLE],
      });

      expect(launch.response.status).toBe(400);
      expect(await launch.response.text()).toContain("lti_token_expired");
    });
  });

  test("a nonce that does not match the stored login is rejected", async () => {
    await withLtiApp(async (app, env) => {
      const launch = await performLaunch(app, env, {
        nonce: "lnn_completely-different",
        roles: [INSTRUCTOR_ROLE],
      });

      expect(launch.response.status).toBe(400);
      expect(await launch.response.text()).toContain("lti_nonce_mismatch");
    });
  });

  test("an OIDC error posted by the platform is named on the page", async () => {
    await withLtiApp(async (app, env) => {
      const login = await beginTestLogin(app, env);
      const response = await app.request(
        "/lti/launch",
        formRequest({ error: "access_denied", state: login.state }),
        env,
      );

      expect(response.status).toBe(400);

      const body = await response.text();

      expect(body).toContain("lti_platform_refused");
      expect(body).toContain("access_denied");
    });
  });

  test("launch failures never echo the id_token", async () => {
    await withLtiApp(async (app, env) => {
      const login = await beginTestLogin(app, env);
      const idToken = await mintIdToken({
        issuer: "https://evil.example.test",
        nonce: login.nonce,
      });
      const response = await app.request(
        "/lti/launch",
        formRequest({ id_token: idToken, state: login.state }),
        env,
      );
      const body = await response.text();

      expect(response.headers.get("Content-Type")).toContain("text/html");
      expect(body).not.toContain(idToken.slice(0, 40));
    });
  });

  test("resource links record on first launch and resolve once mapped", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      const resourceLink = { id: "lms-activity-1", title: "Week 1 proofs" };
      const setup = await instructorLaunch(app, env, { resourceLink });
      const courseId = courseIdFromLaunch(setup.response);

      // Unmapped: the launch lands on the course page and records the link.
      expect(redirectPath(setup.response)).toBe(`/courses/${courseId}`);

      const unmapped =
        await stores.lti.listUnmappedResourceLinksForCourse(courseId);

      expect(unmapped).toHaveLength(1);
      expect(unmapped[0]?.resourceLinkId).toBe("lms-activity-1");
      expect(unmapped[0]?.title).toBe("Week 1 proofs");

      const instructorId = await launchedUserId(
        stores,
        fixture,
        "lms-instructor-1",
      );
      const assignmentId = await createAssignmentInCourse(
        stores,
        courseId,
        instructorId,
      );

      // The instructor associates the LMS activity through the picker route,
      // an ordinary CSRF-protected form post using the launch session.
      const linkRowId = unmapped[0]?.id ?? "";
      const associate = await app.request(
        `/lti/resource-links/${linkRowId}/assignment`,
        {
          ...formRequest({
            assignmentId,
            courseId,
            csrfToken: setup.csrfToken ?? "",
          }),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: setup.cookieHeader ?? "",
          },
        },
        env,
      );

      expect(associate.status).toBe(303);
      expect(redirectPath(associate)).toBe(
        `/courses/${courseId}?ltiLinked=1`,
      );

      // A student launching the mapped activity lands on the content itself —
      // the no-navigation view — rather than on the assignment page, whose
      // navigation leads to assignments this LMS has never heard of.
      const studentLaunch = await performLaunch(app, env, {
        email: "student@example.test",
        resourceLink,
        roles: [LEARNER_ROLE],
        sub: "lms-student-1",
      });

      expect(redirectPath(studentLaunch.response)).toBe(
        `/courses/${courseId}/assignments/${assignmentId}/content`,
      );

      // The instructor lands on the instructor view of the same assignment:
      // they are there to look after it, not to do it.
      const instructorRelaunch = await instructorLaunch(app, env, {
        resourceLink,
      });

      expect(redirectPath(instructorRelaunch.response)).toBe(
        `/courses/${courseId}/instructor/assignments/${assignmentId}`,
      );
    });
  });

  test("the AGS line-item URL is captured for later grade passback", async () => {
    await withLtiApp(async (app, env, stores) => {
      const setup = await instructorLaunch(app, env, {
        claims: {
          "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": {
            lineitem: "https://lms.example.test/line-items/7",
            scope: [],
          },
        },
        resourceLink: { id: "lms-activity-ags" },
      });
      const courseId = courseIdFromLaunch(setup.response);
      const links =
        await stores.lti.listUnmappedResourceLinksForCourse(courseId);

      expect(links[0]?.agsLineItemUrl).toBe(
        "https://lms.example.test/line-items/7",
      );

      // A relaunch of the same activity without the AGS claim (an
      // instructor preview, AGS toggled off) must not erase the capture.
      await instructorLaunch(app, env, {
        resourceLink: { id: "lms-activity-ags" },
      });

      const after =
        await stores.lti.listUnmappedResourceLinksForCourse(courseId);

      expect(after[0]?.agsLineItemUrl).toBe(
        "https://lms.example.test/line-items/7",
      );
    });
  });

  test("a launch that delivers the line item backfills existing scores", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      const resourceLink = { id: "lms-activity-late", title: "Week 2" };
      // Recorded without an AGS claim: an instructor preview, or a platform
      // that only sends the claim once the gradebook column exists.
      const setup = await instructorLaunch(app, env, { resourceLink });
      const courseId = courseIdFromLaunch(setup.response);
      const instructorId = await launchedUserId(
        stores,
        fixture,
        "lms-instructor-1",
      );
      const assignmentId = await createAssignmentInCourse(
        stores,
        courseId,
        instructorId,
      );
      const [link] =
        await stores.lti.listUnmappedResourceLinksForCourse(courseId);

      // A student with an LTI identity and a stable score on the books.
      await performLaunch(app, env, {
        email: "student@example.test",
        resourceLink,
        roles: [LEARNER_ROLE],
        sub: "lms-student-1",
      });

      const studentId = await launchedUserId(
        stores,
        fixture,
        "lms-student-1",
      );

      await stores.scores.upsertAssignmentScore({
        assignmentId,
        userId: studentId,
        score: 2,
        maxScore: 2,
        status: "complete",
        calculatedAt: NOW,
      });

      // Associating while the link has no line item can queue nothing.
      const associate = await app.request(
        `/lti/resource-links/${link?.id ?? ""}/assignment`,
        {
          ...formRequest({
            assignmentId,
            courseId,
            csrfToken: setup.csrfToken ?? "",
          }),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: setup.cookieHeader ?? "",
          },
        },
        env,
      );

      expect(associate.status).toBe(303);
      await expect(
        stores.lti.getGradeJob(link?.id ?? "", studentId),
      ).resolves.toBeNull();

      // The next launch hands over the line-item URL; every score already
      // earned is owed to the new column.
      await instructorLaunch(app, env, {
        claims: {
          "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": {
            lineitem: "https://lms.example.test/line-items/late",
            scope: [],
          },
        },
        resourceLink,
      });

      await expect(
        stores.lti.getGradeJob(link?.id ?? "", studentId),
      ).resolves.toMatchObject({ status: "pending", score: 2, maxScore: 2 });
    });
  });

  test("a stable score the outbox never saw queues on the student's next launch", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      const resourceLink = { id: "lms-activity-heal", title: "Week 3" };
      const agsClaims = {
        "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": {
          lineitem: "https://lms.example.test/line-items/heal",
          scope: [],
        },
      };
      const setup = await instructorLaunch(app, env, {
        claims: agsClaims,
        resourceLink,
      });
      const courseId = courseIdFromLaunch(setup.response);
      const instructorId = await launchedUserId(
        stores,
        fixture,
        "lms-instructor-1",
      );
      const assignmentId = await createAssignmentInCourse(
        stores,
        courseId,
        instructorId,
      );
      const [link] =
        await stores.lti.listUnmappedResourceLinksForCourse(courseId);
      const associate = await app.request(
        `/lti/resource-links/${link?.id ?? ""}/assignment`,
        {
          ...formRequest({
            assignmentId,
            courseId,
            csrfToken: setup.csrfToken ?? "",
          }),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: setup.cookieHeader ?? "",
          },
        },
        env,
      );

      expect(associate.status).toBe(303);

      // The student's identity and score appear after the association's
      // backfill already ran (a confirmed link challenge, say).
      await performLaunch(app, env, {
        email: "student@example.test",
        roles: [LEARNER_ROLE],
        sub: "lms-student-1",
      });

      const studentId = await launchedUserId(
        stores,
        fixture,
        "lms-student-1",
      );

      await stores.scores.upsertAssignmentScore({
        assignmentId,
        userId: studentId,
        score: 2,
        maxScore: 2,
        status: "complete",
        calculatedAt: NOW,
      });

      // Their next launch through the LMS activity notices the outbox has
      // no row for them and queues the stable score.
      await performLaunch(app, env, {
        email: "student@example.test",
        resourceLink,
        roles: [LEARNER_ROLE],
        sub: "lms-student-1",
      });

      await expect(
        stores.lti.getGradeJob(link?.id ?? "", studentId),
      ).resolves.toMatchObject({ status: "pending", score: 2 });
    });
  });

  test("a disabled platform rejects login initiation", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      await stores.lti.setPlatformDisabled(fixture.platform.id, NOW, NOW);

      const response = await app.request(
        `/lti/login?iss=${encodeURIComponent(TEST_ISSUER)}&login_hint=u1&client_id=${TEST_CLIENT_ID}`,
        {},
        env,
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("lti_platform_unknown");
    });
  });

  test("login initiation without client_id works for a single registration", async () => {
    await withLtiApp(async (app, env) => {
      const login = await beginTestLogin(app, env, { clientId: null });

      expect(login.state.length).toBeGreaterThan(0);
    });
  });

  test("the tool JWKS endpoint serves only public key material", async () => {
    await withLtiApp(async (app, env) => {
      const empty = await app.request("/lti/jwks", {}, env);

      expect((await empty.json()) as Record<string, unknown>).toEqual({
        keys: [],
      });

      const withKey = await app.request(
        "/lti/jwks",
        {},
        {
          ...env,
          LTI_TOOL_PRIVATE_KEY: JSON.stringify({
            alg: "RS256",
            d: "secret-private-exponent",
            dp: "x",
            dq: "x",
            e: "AQAB",
            kid: "tool-key-1",
            kty: "RSA",
            n: "public-modulus",
            p: "x",
            q: "x",
            qi: "x",
          }),
        },
      );
      const body = (await withKey.json()) as {
        readonly keys: readonly Record<string, unknown>[];
      };

      expect(body.keys).toHaveLength(1);
      expect(body.keys[0]?.kid).toBe("tool-key-1");
      expect(body.keys[0]?.n).toBe("public-modulus");
      expect(body.keys[0]?.d).toBeUndefined();
      expect(body.keys[0]?.p).toBeUndefined();
      expect(body.keys[0]?.q).toBeUndefined();

      // Misconfigured secrets publish nothing rather than everything: a
      // whole JWKS pasted in, or a symmetric key with no public half.
      const jwksShaped = await app.request(
        "/lti/jwks",
        {},
        {
          ...env,
          LTI_TOOL_PRIVATE_KEY: JSON.stringify({
            keys: [{ d: "secret", e: "AQAB", kty: "RSA", n: "x" }],
          }),
        },
      );

      expect((await jwksShaped.json()) as Record<string, unknown>).toEqual({
        keys: [],
      });

      const symmetric = await app.request(
        "/lti/jwks",
        {},
        {
          ...env,
          LTI_TOOL_PRIVATE_KEY: JSON.stringify({ k: "secret", kty: "oct" }),
        },
      );

      expect((await symmetric.json()) as Record<string, unknown>).toEqual({
        keys: [],
      });
    });
  });
});

const CLAIM_DL_SETTINGS =
  "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings";
const CLAIM_DL_CONTENT_ITEMS =
  "https://purl.imsglobal.org/spec/lti-dl/claim/content_items";
const CLAIM_DL_DATA = "https://purl.imsglobal.org/spec/lti-dl/claim/data";
const CLAIM_CUSTOM = "https://purl.imsglobal.org/spec/lti/claim/custom";
const DL_RETURN_URL = `${TEST_ISSUER}/deep-link-return`;

interface TestToolKeyPair {
  readonly privateJwkJson: string;
  readonly publicKey: CryptoKey;
}

let cachedToolKeyPair: Promise<TestToolKeyPair> | null = null;

/** The tool's own signing key (distinct from the platform's launch key). */
function testToolKeyPair(): Promise<TestToolKeyPair> {
  cachedToolKeyPair ??= (async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    const privateJwk = await exportJWK(pair.privateKey);

    privateJwk.alg = "RS256";
    privateJwk.kid = "carnap-tool-test-key";

    return {
      privateJwkJson: JSON.stringify(privateJwk),
      publicKey: pair.publicKey,
    };
  })();

  return cachedToolKeyPair;
}

function deepLinkingLaunch(
  app: WorkerApp,
  env: Env,
  overrides: Parameters<typeof performLaunch>[2] = {},
) {
  return performLaunch(app, env, {
    claims: {
      [CLAIM_DL_SETTINGS]: {
        accept_multiple: false,
        accept_types: ["ltiResourceLink"],
        data: "dl-opaque-1",
        deep_link_return_url: DL_RETURN_URL,
      },
    },
    email: "instructor@example.test",
    messageType: "LtiDeepLinkingRequest",
    name: "Ida Instructor",
    roles: [INSTRUCTOR_ROLE],
    sub: "lms-instructor-1",
    ...overrides,
  });
}

function selectionTokenFromPage(html: string): string {
  const match = html.match(/name="token" type="hidden" value="(ldl_[^"]+)"/);

  if (match === null || match[1] === undefined) {
    throw new Error("Expected the picker page to carry a selection token.");
  }

  return match[1];
}

async function createPointedAssignment(
  stores: AppStores,
  courseId: string,
  ownerId: string,
  options: {
    readonly assessmentMode?: "graded" | "none" | "practice";
    /** Overrides the stored artifact wholesale, for the unreadable case. */
    readonly compiled?: unknown;
    readonly key?: string;
    readonly points?: number;
    readonly title?: string;
  } = {},
): Promise<string> {
  const key = options.key ?? "dl";
  const item = await stores.content.createItem({
    id: `content-item-${key}-${courseId}`,
    ownerUserId: ownerId,
    title: "Proofs",
    createdAt: NOW,
  });
  const revision = await stores.content.createRevision({
    id: `content-revision-${key}-${courseId}`,
    itemId: item.id,
    revisionNumber: 1,
    details: "",
    sourceFormat: "markdown",
    sourceText: "# Proofs",
    contentHash: `sha256:proofs-${key}`,
    // A real artifact shape, not a hand-shaped stand-in: the deep link's
    // `lineItem` takes its `scoreMaximum` from this manifest, so a fixture the
    // reader rejects is a fixture that proves nothing about the sum.
    compiled: (options.compiled ?? {
      ...EMPTY_ARTIFACT,
      manifest: [{ id: "q1", nominalPoints: options.points ?? 2 }],
    }) as never,
    createdById: ownerId,
    createdAt: NOW,
  });
  const assignment = await stores.assignments.create({
    id: `assignment-${key}-${courseId}`,
    courseId,
    contentRevisionId: revision.id,
    title: options.title ?? "Homework 1",
    description: "",
    assessmentMode: options.assessmentMode ?? "graded",
    displayOrder: 0,
    availableFrom: null,
    dueAt: null,
    availableUntil: null,
    gradesVisibleAt: null,
    listed: true,
    maxAttempts: 1,
    timeLimitMinutes: null,
    createdById: ownerId,
    createdAt: NOW,
  });

  return assignment.id;
}

/** Run the picker leg and hand back what a selection POST needs. */
async function openPicker(
  app: WorkerApp,
  env: Env,
): Promise<{
  readonly cookieHeader: string;
  readonly csrfToken: string;
  readonly html: string;
  readonly token: string;
}> {
  const picker = await deepLinkingLaunch(app, env);
  const html = await picker.response.text();

  return {
    cookieHeader: picker.cookieHeader ?? "",
    csrfToken: picker.csrfToken ?? "",
    html,
    token: selectionTokenFromPage(html),
  };
}

function selectionRequest(
  picker: {
    readonly cookieHeader: string;
    readonly csrfToken: string;
    readonly token: string;
  },
  assignmentId: string,
): RequestInit {
  return {
    body: new URLSearchParams({
      assignmentId,
      csrfToken: picker.csrfToken,
      token: picker.token,
    }).toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: picker.cookieHeader,
    },
    method: "POST",
  };
}

/** The content items a completed selection put in front of the platform. */
async function selectedContentItems(
  response: Response,
): Promise<readonly Record<string, unknown>[]> {
  const match = (await response.text()).match(
    /name="JWT" type="hidden" value="([^"]+)"/,
  );

  if (match?.[1] === undefined) {
    throw new Error("Expected the return page to carry a JWT.");
  }

  return (
    await jwtVerify(match[1], (await testToolKeyPair()).publicKey, {
      audience: TEST_ISSUER,
      issuer: TEST_CLIENT_ID,
    })
  ).payload[CLAIM_DL_CONTENT_ITEMS] as readonly Record<string, unknown>[];
}

describe("LTI Deep Linking", () => {
  test("an instructor launch reaches the assignment picker and a selection signs a response", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      const { privateJwkJson, publicKey } = await testToolKeyPair();
      const keyedEnv: Env = { ...env, LTI_TOOL_PRIVATE_KEY: privateJwkJson };

      // A regular launch first: it creates the course this instructor will
      // pick content for.
      const first = await instructorLaunch(app, keyedEnv);
      const courseId = courseIdFromLaunch(first.response);
      const ownerId = await launchedUserId(
        stores,
        fixture,
        "lms-instructor-1",
      );
      const assignmentId = await createPointedAssignment(
        stores,
        courseId,
        ownerId,
      );

      const picker = await deepLinkingLaunch(app, keyedEnv);

      expect(picker.response.status).toBe(200);
      expect(picker.cookieHeader).toContain("carnap_session=");

      const pickerHtml = await picker.response.text();

      expect(pickerHtml).toContain("Choose an assignment");
      expect(pickerHtml).toContain("Homework 1");

      const token = selectionTokenFromPage(pickerHtml);
      const respond = await app.request(
        "/lti/deep-link/respond",
        {
          body: new URLSearchParams({
            assignmentId,
            csrfToken: picker.csrfToken ?? "",
            token,
          }).toString(),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: picker.cookieHeader ?? "",
          },
          method: "POST",
        },
        keyedEnv,
      );

      expect(respond.status).toBe(200);

      const respondHtml = await respond.text();

      expect(respondHtml).toContain(`action="${DL_RETURN_URL}"`);

      const jwtMatch = respondHtml.match(
        /name="JWT" type="hidden" value="([^"]+)"/,
      );

      if (jwtMatch === null || jwtMatch[1] === undefined) {
        throw new Error("Expected the return page to carry a JWT.");
      }

      const { payload } = await jwtVerify(jwtMatch[1], publicKey, {
        audience: TEST_ISSUER,
        issuer: TEST_CLIENT_ID,
      });

      expect(
        payload["https://purl.imsglobal.org/spec/lti/claim/message_type"],
      ).toBe("LtiDeepLinkingResponse");
      expect(
        payload["https://purl.imsglobal.org/spec/lti/claim/version"],
      ).toBe("1.3.0");
      expect(
        payload["https://purl.imsglobal.org/spec/lti/claim/deployment_id"],
      ).toBe(TEST_DEPLOYMENT_ID);
      expect(payload[CLAIM_DL_DATA]).toBe("dl-opaque-1");

      const items = payload[CLAIM_DL_CONTENT_ITEMS] as readonly Record<
        string,
        unknown
      >[];

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        custom: { carnap_assignment_id: assignmentId },
        title: "Homework 1",
        type: "ltiResourceLink",
        url: "http://localhost/lti/launch",
      });
      expect(items[0]?.lineItem).toMatchObject({
        label: "Homework 1",
        resourceId: assignmentId,
        scoreMaximum: 2,
      });

      // The selection token is single-use: a replay fails politely.
      const replay = await app.request(
        "/lti/deep-link/respond",
        {
          body: new URLSearchParams({
            assignmentId,
            csrfToken: picker.csrfToken ?? "",
            token,
          }).toString(),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: picker.cookieHeader ?? "",
          },
          method: "POST",
        },
        keyedEnv,
      );

      expect(replay.status).toBe(400);
      expect(await replay.text()).toContain(
        "lti_deep_link_selection_invalid",
      );
    });
  });

  test("a stale assignment choice does not burn the selection token", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      const { privateJwkJson } = await testToolKeyPair();
      const keyedEnv: Env = { ...env, LTI_TOOL_PRIVATE_KEY: privateJwkJson };
      const first = await instructorLaunch(app, keyedEnv);
      const courseId = courseIdFromLaunch(first.response);
      const ownerId = await launchedUserId(
        stores,
        fixture,
        "lms-instructor-1",
      );
      const assignmentId = await createPointedAssignment(
        stores,
        courseId,
        ownerId,
      );
      const picker = await deepLinkingLaunch(app, keyedEnv);
      const token = selectionTokenFromPage(await picker.response.text());
      const respondWith = (chosenAssignmentId: string) =>
        app.request(
          "/lti/deep-link/respond",
          {
            body: new URLSearchParams({
              assignmentId: chosenAssignmentId,
              token,
            }).toString(),
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Cookie: picker.cookieHeader ?? "",
            },
            method: "POST",
          },
          keyedEnv,
        );

      // Choosing an assignment that vanished between render and submit is a
      // correctable mistake, so the single-use token must survive it.
      const stale = await respondWith("assignment-deleted-meanwhile");

      expect(stale.status).toBe(400);

      const retry = await respondWith(assignmentId);

      expect(retry.status).toBe(200);
      expect(await retry.text()).toContain(`action="${DL_RETURN_URL}"`);
    });
  });

  test("backing out returns an empty selection to the LMS", async () => {
    await withLtiApp(async (app, env) => {
      const { privateJwkJson, publicKey } = await testToolKeyPair();
      const keyedEnv: Env = { ...env, LTI_TOOL_PRIVATE_KEY: privateJwkJson };
      const picker = await deepLinkingLaunch(app, keyedEnv);

      expect(picker.response.status).toBe(200);

      const token = selectionTokenFromPage(await picker.response.text());
      const respond = await app.request(
        "/lti/deep-link/respond",
        {
          body: new URLSearchParams({
            csrfToken: picker.csrfToken ?? "",
            token,
          }).toString(),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: picker.cookieHeader ?? "",
          },
          method: "POST",
        },
        keyedEnv,
      );

      expect(respond.status).toBe(200);

      const jwtMatch = (await respond.text()).match(
        /name="JWT" type="hidden" value="([^"]+)"/,
      );
      const { payload } = await jwtVerify(jwtMatch?.[1] ?? "", publicKey, {
        audience: TEST_ISSUER,
        issuer: TEST_CLIENT_ID,
      });

      expect(payload[CLAIM_DL_CONTENT_ITEMS]).toEqual([]);
    });
  });

  /**
   * The half of the deep-linking flow the acceptance runs never reached,
   * because the last mile of a Moodle selection happens inside a modal iframe:
   * what the response carries when the chosen assignment is not the ordinary
   * one. Each of these decides something the LMS then cannot be talked out of
   * — whether a gradebook column exists, and with what maximum.
   */
  describe("what a selection puts in front of the platform", () => {
    test("an ungraded or zero-point assignment declares no line item", async () => {
      await withLtiApp(async (app, env, stores, fixture) => {
        const { privateJwkJson } = await testToolKeyPair();
        const keyedEnv: Env = {
          ...env,
          LTI_TOOL_PRIVATE_KEY: privateJwkJson,
        };
        const first = await instructorLaunch(app, keyedEnv);
        const courseId = courseIdFromLaunch(first.response);
        const ownerId = await launchedUserId(
          stores,
          fixture,
          "lms-instructor-1",
        );
        const zeroPoints = await createPointedAssignment(
          stores,
          courseId,
          ownerId,
          { key: "zero", points: 0, title: "Reading" },
        );
        const ungraded = await createPointedAssignment(
          stores,
          courseId,
          ownerId,
          { assessmentMode: "practice", key: "practice", title: "Practice" },
        );

        for (const assignmentId of [zeroPoints, ungraded]) {
          const picker = await openPicker(app, keyedEnv);
          const respond = await app.request(
            "/lti/deep-link/respond",
            selectionRequest(picker, assignmentId),
            keyedEnv,
          );

          expect(respond.status).toBe(200);

          const items = await selectedContentItems(respond);

          // Still a resource link — it is worth launching, just not worth
          // grading — and the platform is told not to make a column for it.
          expect(items).toHaveLength(1);
          expect(items[0]?.type).toBe("ltiResourceLink");
          expect(items[0]?.lineItem).toBeUndefined();
        }
      });
    });

    test("an assignment in another course cannot be selected into this one", async () => {
      await withLtiApp(async (app, env, stores, fixture) => {
        const { privateJwkJson } = await testToolKeyPair();
        const keyedEnv: Env = {
          ...env,
          LTI_TOOL_PRIVATE_KEY: privateJwkJson,
        };
        await instructorLaunch(app, keyedEnv);

        const ownerId = await launchedUserId(
          stores,
          fixture,
          "lms-instructor-1",
        );

        // A course this instructor is not launching for. Nothing in the form
        // offers it; the id has to be posted by hand, which is the point.
        const elsewhere = await stores.courses.create({
          createdAt: NOW,
          createdById: ownerId,
          id: "course-elsewhere",
          timezone: "UTC",
          title: "Someone else's course",
        });
        const outsider = await createPointedAssignment(
          stores,
          elsewhere.id,
          ownerId,
          { key: "outsider", title: "Not yours" },
        );
        const picker = await openPicker(app, keyedEnv);

        expect(picker.html).not.toContain("Not yours");

        const respond = await app.request(
          "/lti/deep-link/respond",
          selectionRequest(picker, outsider),
          keyedEnv,
        );

        expect(respond.status).toBe(400);
        expect(await respond.text()).toContain("invalid_assignment");
      });
    });

    test("an assignment whose content cannot be read is refused, not silently ungraded", async () => {
      await withLtiApp(async (app, env, stores, fixture) => {
        const { privateJwkJson } = await testToolKeyPair();
        const keyedEnv: Env = {
          ...env,
          LTI_TOOL_PRIVATE_KEY: privateJwkJson,
        };
        const first = await instructorLaunch(app, keyedEnv);
        const courseId = courseIdFromLaunch(first.response);
        const ownerId = await launchedUserId(
          stores,
          fixture,
          "lms-instructor-1",
        );
        const broken = await createPointedAssignment(
          stores,
          courseId,
          ownerId,
          { compiled: { blocks: [] }, key: "broken", title: "Broken" },
        );
        const picker = await openPicker(app, keyedEnv);
        const respond = await app.request(
          "/lti/deep-link/respond",
          selectionRequest(picker, broken),
          keyedEnv,
        );

        // The points total decides `scoreMaximum`. Reading an unreadable
        // artifact as zero would have sent the LMS a link with no line item,
        // creating an activity that can never receive a grade — and nothing
        // would have said so until the term was over.
        expect(respond.status).toBe(500);
        expect(await respond.text()).toContain("invalid_content_artifact");
      });
    });

    /**
     * Archiving is presentational today — it folds a course into a drawer and
     * stops nothing. So an archived course's assignments are still selectable,
     * which is worth pinning rather than assuming: if archiving ever becomes a
     * closure, this is one of the places that has to decide what it means.
     */
    test("an archived course still offers its assignments", async () => {
      await withLtiApp(async (app, env, stores, fixture) => {
        const { privateJwkJson } = await testToolKeyPair();
        const keyedEnv: Env = {
          ...env,
          LTI_TOOL_PRIVATE_KEY: privateJwkJson,
        };
        const first = await instructorLaunch(app, keyedEnv);
        const courseId = courseIdFromLaunch(first.response);
        const ownerId = await launchedUserId(
          stores,
          fixture,
          "lms-instructor-1",
        );
        const assignmentId = await createPointedAssignment(
          stores,
          courseId,
          ownerId,
          { key: "archived", title: "Archived homework" },
        );

        await stores.courses.setArchived({
          archivedAt: NOW,
          id: courseId,
          updatedAt: NOW,
        });

        const picker = await openPicker(app, keyedEnv);

        expect(picker.html).toContain("Archived homework");

        const respond = await app.request(
          "/lti/deep-link/respond",
          selectionRequest(picker, assignmentId),
          keyedEnv,
        );

        expect(respond.status).toBe(200);
        expect(await selectedContentItems(respond)).toHaveLength(1);
      });
    });
  });

  test("students cannot select content", async () => {
    await withLtiApp(async (app, env) => {
      const { privateJwkJson } = await testToolKeyPair();
      const keyedEnv: Env = { ...env, LTI_TOOL_PRIVATE_KEY: privateJwkJson };

      // The instructor's launch creates the course; the student then tries.
      await instructorLaunch(app, keyedEnv);

      const attempt = await deepLinkingLaunch(app, keyedEnv, {
        email: "student@example.test",
        roles: [LEARNER_ROLE],
        sub: "lms-student-1",
      });

      expect(attempt.response.status).toBe(400);
      expect(await attempt.response.text()).toContain(
        "lti_deep_linking_forbidden",
      );
    });
  });

  test("deep linking without a configured tool key fails the launch", async () => {
    await withLtiApp(async (app, env) => {
      const attempt = await deepLinkingLaunch(app, env);

      expect(attempt.response.status).toBe(400);
      expect(await attempt.response.text()).toContain("lti_tool_key_missing");
    });
  });

  test("launching a deep-linked activity auto-associates it with the chosen assignment", async () => {
    await withLtiApp(async (app, env, stores, fixture) => {
      const first = await instructorLaunch(app, env);
      const courseId = courseIdFromLaunch(first.response);
      const ownerId = await launchedUserId(
        stores,
        fixture,
        "lms-instructor-1",
      );
      const assignmentId = await createPointedAssignment(
        stores,
        courseId,
        ownerId,
      );

      // The LMS launches the activity Deep Linking created, echoing our
      // custom parameter; the resource link maps itself on first sight.
      const launch = await instructorLaunch(app, env, {
        claims: { [CLAIM_CUSTOM]: { carnap_assignment_id: assignmentId } },
        resourceLink: { id: "dl-activity-1", title: "Homework 1 (LMS)" },
      });

      expect(launch.response.status).toBe(303);
      expect(redirectPath(launch.response)).toBe(
        `/courses/${courseId}/instructor/assignments/${assignmentId}`,
      );

      const links =
        await stores.lti.listResourceLinksForAssignment(assignmentId);

      expect(links).toHaveLength(1);
      expect(links[0]?.resourceLinkId).toBe("dl-activity-1");

      // A custom parameter naming a foreign assignment is ignored.
      const foreign = await instructorLaunch(app, env, {
        claims: {
          [CLAIM_CUSTOM]: { carnap_assignment_id: "assignment-elsewhere" },
        },
        resourceLink: { id: "dl-activity-2" },
      });

      expect(redirectPath(foreign.response)).toBe(`/courses/${courseId}`);
    });
  });
});
