import { describe, expect, test } from "bun:test";

import type { AppStores } from "../../src/worker/application/stores";
import { createAppId } from "../../src/worker/domain/ids";
import type { JsonValue } from "../../src/worker/domain/json";
import { timestampNow } from "../../src/worker/domain/time";
import type { StorageFactory, StoresUnderTest } from "./storage";

const NOW = "2026-01-02T03:04:05.000Z";
const LATER = "2026-01-02T04:04:05.000Z";

/**
 * Every promise the store interfaces make, as one suite, run once per driver.
 *
 * It takes a factory rather than reaching for one because that is the whole
 * point: a store that behaves differently on D1 than on a libsql file is a
 * store the two hosts do not share, and this is where that shows up. Nothing
 * in here may touch a driver-specific handle — `StoresUnderTest` deliberately
 * offers none.
 */
export function describeStorageContract(
  driver: string,
  createStorage: StorageFactory,
): void {
  async function withStorage(
    run: (storage: StoresUnderTest) => Promise<void>,
  ): Promise<void> {
    const storage = await createStorage();

    try {
      await run(storage);
    } finally {
      await storage.dispose();
    }
  }

  async function createUser(stores: AppStores, id = "user-1") {
    return stores.users.create({
      id,
      email: `${id}@example.test`,
      name: "Ada Lovelace",
      createdAt: NOW,
    });
  }

  async function createCourseSlice(stores: AppStores) {
    const instructor = await createUser(stores, "instructor-1");
    const student = await createUser(stores, "student-1");
    const course = await stores.courses.create({
      id: "course-1",
      title: "Intro Logic",
      timezone: "UTC",
      createdById: instructor.id,
      createdAt: NOW,
    });

    await stores.courses.addMembership({
      id: "membership-instructor-1",
      courseId: course.id,
      userId: instructor.id,
      role: "instructor",
      status: "active",
      createdAt: NOW,
    });
    await stores.courses.addMembership({
      id: "membership-student-1",
      courseId: course.id,
      userId: student.id,
      role: "student",
      status: "active",
      createdAt: NOW,
    });

    return { course, instructor, student };
  }

  async function createContentRevision(stores: AppStores) {
    const { instructor } = await createCourseSlice(stores);
    const item = await stores.content.createItem({
      id: "content-item-1",
      ownerUserId: instructor.id,
      title: "Modus Ponens",
      createdAt: NOW,
    });
    const revision = await stores.content.createRevision({
      id: "content-revision-1",
      itemId: item.id,
      revisionNumber: 1,
      details: "First draft.",
      sourceFormat: "markdown",
      sourceText: "# Modus Ponens",
      contentHash: "sha256:first",
      compiled: { exercises: [{ id: "mp" }] },
      createdById: instructor.id,
      createdAt: NOW,
    });

    return { instructor, item, revision };
  }

  async function createAssignmentSlice(stores: AppStores) {
    const { course, instructor, student } = await createCourseSlice(stores);
    const item = await stores.content.createItem({
      id: "content-item-1",
      ownerUserId: instructor.id,
      title: "Conditional Proof",
      createdAt: NOW,
    });
    const revision = await stores.content.createRevision({
      id: "content-revision-1",
      itemId: item.id,
      revisionNumber: 1,
      details: "",
      sourceFormat: "markdown",
      sourceText: "# Conditional Proof",
      contentHash: "sha256:conditional-proof",
      compiled: { exercises: [{ id: "cp" }] },
      createdById: instructor.id,
      createdAt: NOW,
    });
    const assignment = await stores.assignments.create({
      id: "assignment-1",
      courseId: course.id,
      contentRevisionId: revision.id,
      title: "Homework 1",
      description: "Conditional proof practice.",
      assessmentMode: "graded",
      displayOrder: 0,
      availableFrom: null,
      dueAt: null,
      availableUntil: null,
      gradesVisibleAt: null,
      listed: true,
      maxAttempts: 1,
      timeLimitMinutes: null,
      createdById: instructor.id,
      createdAt: NOW,
    });

    return { assignment, instructor, student };
  }

  async function createAttemptSlice(stores: AppStores) {
    const { assignment, student } = await createAssignmentSlice(stores);
    const attempt = await stores.assessment.beginAttempt({
      id: "attempt-1",
      assignmentId: assignment.id,
      userId: student.id,
      openedAt: NOW,
      expiresAt: null,
      createdFrom: "student",
      maxAttempts: 1,
    });

    if (attempt === null) {
      throw new Error("Expected attempt to be created.");
    }

    return { attempt, student };
  }

  function answer(lines: readonly string[]): JsonValue {
    return { lines };
  }

  describe(`storage contracts (${driver})`, () => {
    test("app-generated IDs are UUIDv7-shaped and time sortable", () => {
      const early = createAppId(1_700_000_000_000);
      const late = createAppId(1_700_000_000_001);

      expect(early).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(early < late).toBe(true);
      expect(timestampNow(new Date(NOW))).toBe(NOW);
    });

    test("migrations leave an empty database ready to query", async () => {
      await withStorage(async ({ stores }) => {
        // A missing row rather than a missing table: the query reaching SQLite
        // and coming back empty is the assertion. Asking `sqlite_master` for
        // the table by name would have said the same thing, but only on a
        // driver that hands out a raw binding.
        expect(await stores.users.getById("user-missing")).toBeNull();
        expect(
          await stores.assignments.getById("assignment-missing"),
        ).toBeNull();
      });
    });

    test("users and external identities can be created and read", async () => {
      await withStorage(async ({ stores }) => {
        const user = await stores.users.create({
          id: "user-1",
          email: "ada@example.test",
          name: "Ada Lovelace",
          createdAt: NOW,
        });
        const identity = await stores.users.createExternalIdentity({
          id: "identity-1",
          userId: user.id,
          provider: "native",
          providerSubject: "ada@example.test",
          createdAt: NOW,
        });

        await expect(stores.users.getById(user.id)).resolves.toEqual(user);
        await expect(stores.users.getByEmail(user.email)).resolves.toEqual(
          user,
        );
        await expect(
          stores.users.getExternalIdentity("native", "ada@example.test"),
        ).resolves.toEqual(identity);

        // Verification is recorded once: the first proof sets the timestamp,
        // a later one is a no-op signalled by null.
        expect(user.emailVerifiedAt).toBeNull();

        const verified = await stores.users.markEmailVerified(user.id, NOW);

        expect(verified?.emailVerifiedAt).toBe(NOW);
        await expect(
          stores.users.markEmailVerified(user.id, "2026-01-03T03:04:05.000Z"),
        ).resolves.toBeNull();

        // Name and language are written together — one form, one row update — and
        // clearing the language back to null is meaningful: null means "follow the
        // request", not "chose English".
        expect(user.locale).toBeNull();

        const localized = await stores.users.updateProfile(
          user.id,
          { locale: "de", name: "Ada Lovelace" },
          "2026-01-04T00:00:00.000Z",
        );

        expect(localized).toMatchObject({
          locale: "de",
          name: "Ada Lovelace",
          updatedAt: "2026-01-04T00:00:00.000Z",
        });
        await expect(stores.users.getById(user.id)).resolves.toMatchObject({
          locale: "de",
          name: "Ada Lovelace",
        });
        await expect(
          stores.users.updateProfile(
            user.id,
            { locale: null, name: null },
            "2026-01-05T00:00:00.000Z",
          ),
        ).resolves.toMatchObject({ locale: null, name: null });
        await expect(
          stores.users.updateProfile(
            "missing-user",
            { locale: "de", name: null },
            NOW,
          ),
        ).resolves.toBeNull();

        await expect(
          stores.users.deleteExternalIdentity(identity.id),
        ).resolves.toBe(true);
        await expect(
          stores.users.getExternalIdentity("native", "ada@example.test"),
        ).resolves.toBeNull();
        await expect(
          stores.users.deleteExternalIdentity(identity.id),
        ).resolves.toBe(false);
      });
    });

    test("platform capabilities and audit events can be stored", async () => {
      await withStorage(async ({ stores }) => {
        const admin = await createUser(stores, "admin-1");
        const target = await createUser(stores, "target-1");
        const grant = await stores.platformCapabilities.grant({
          capability: "course_creator",
          grantedAt: NOW,
          grantedById: admin.id,
          id: "capability-grant-1",
          userId: target.id,
        });
        const audit = await stores.adminAudit.append({
          action: "admin.grant_platform_capability",
          actorUserId: admin.id,
          createdAt: NOW,
          id: "audit-event-1",
          metadata: { capability: "course_creator" },
          requestId: "request-1",
          targetCourseId: null,
          targetUserId: target.id,
        });

        await expect(
          stores.platformCapabilities.listActiveForUser(target.id),
        ).resolves.toEqual([grant]);
        await expect(
          stores.platformCapabilities.hasAnyActiveSiteAdmin(),
        ).resolves.toBe(false);
        await expect(stores.adminAudit.listRecent(10)).resolves.toEqual([
          audit,
        ]);

        const revoked = await stores.platformCapabilities.revoke({
          capability: "course_creator",
          revokedAt: "2026-01-02T04:04:05.000Z",
          userId: target.id,
        });

        expect(revoked?.revokedAt).toBe("2026-01-02T04:04:05.000Z");
        await expect(
          stores.platformCapabilities.listActiveForUser(target.id),
        ).resolves.toEqual([]);
      });
    });

    test("courses and memberships can be created and read", async () => {
      await withStorage(async ({ stores }) => {
        const { course, instructor, student } =
          await createCourseSlice(stores);
        const instructorMembership = await stores.courses.getMembership(
          course.id,
          instructor.id,
        );
        const studentMembership = await stores.courses.getMembership(
          course.id,
          student.id,
        );
        const memberships = await stores.courses.listMembershipsForCourse(
          course.id,
        );
        const listedCourses = await stores.courses.listForUser(student.id);

        await expect(stores.courses.getById(course.id)).resolves.toEqual(
          course,
        );
        expect(instructorMembership?.role).toBe("instructor");
        expect(studentMembership?.role).toBe("student");
        expect(memberships.map((membership) => membership.userId)).toEqual([
          instructor.id,
          student.id,
        ]);
        if (studentMembership === null) {
          throw new Error("Expected student membership.");
        }

        expect(listedCourses).toEqual([
          { course, membership: studentMembership },
        ]);

        const dropped = await stores.courses.updateMembershipStatus({
          courseId: course.id,
          membershipId: studentMembership.id,
          status: "dropped",
          updatedAt: NOW,
        });

        expect(dropped?.status).toBe("dropped");

        const link = await stores.courses.createEnrollmentLink({
          id: "enrollment-link-1",
          courseId: course.id,
          tokenHash: "enrollment-token-hash-1",
          createdById: instructor.id,
          createdAt: NOW,
          expiresAt: "2027-01-02T03:04:05.000Z",
        });

        await expect(
          stores.courses.getValidEnrollmentLink(
            "enrollment-token-hash-1",
            NOW,
          ),
        ).resolves.toEqual(link);

        await stores.courses.revokeEnrollmentLink({
          courseId: course.id,
          linkId: link.id,
          revokedAt: NOW,
        });
        await expect(
          stores.courses.getValidEnrollmentLink(
            "enrollment-token-hash-1",
            NOW,
          ),
        ).resolves.toBeNull();
      });
    });

    test("content revisions are immutable and ordered", async () => {
      await withStorage(async ({ stores }) => {
        const { instructor, item, revision } =
          await createContentRevision(stores);
        const secondRevision = await stores.content.createRevision({
          id: "content-revision-2",
          itemId: item.id,
          revisionNumber: 2,
          details: "Reworded the second step.",
          sourceFormat: "markdown",
          sourceText: "# Modus Ponens\n\nEdited.",
          contentHash: "sha256:second",
          compiled: { exercises: [{ id: "mp" }, { id: "mp-2" }] },
          createdById: instructor.id,
          createdAt: NOW,
        });

        await expect(stores.content.getItem(item.id)).resolves.toEqual(item);
        await expect(
          stores.content.getRevision(revision.id),
        ).resolves.toEqual(revision);
        await expect(
          stores.content.createRevision({
            id: "content-revision-duplicate",
            itemId: item.id,
            revisionNumber: 1,
            details: "",
            sourceFormat: "markdown",
            sourceText: "# Duplicate",
            contentHash: "sha256:duplicate",
            compiled: { exercises: [] },
            createdById: instructor.id,
            createdAt: NOW,
          }),
        ).rejects.toThrow();
        // Newest first: the second revision leads, and the order is the store's
        // promise rather than an accident of insertion.
        await expect(
          stores.content.listRevisionsForItem(item.id),
        ).resolves.toEqual([secondRevision, revision]);
      });
    });

    test("assignments can be published by content revision ID", async () => {
      await withStorage(async ({ stores }) => {
        const { assignment, instructor } =
          await createAssignmentSlice(stores);
        const published = await stores.assignments.publish({
          actorId: instructor.id,
          contentRevisionId: assignment.contentRevisionId,
          id: assignment.id,
          publishedAt: NOW,
          versionId: "assignment-content-version-1",
        });

        if (published === null) {
          throw new Error("Expected assignment to be published.");
        }

        expect(assignment.state).toBe("draft");
        expect(assignment.description).toBe("Conditional proof practice.");
        expect(assignment.listed).toBe(true);
        expect(assignment.maxAttempts).toBe(1);
        expect(assignment.timeLimitMinutes).toBeNull();
        expect(published.state).toBe("published");
        expect(published.contentRevisionId).toBe(
          assignment.contentRevisionId,
        );
        expect(published.publishedAt).toBe(NOW);
        await expect(
          stores.assignments.listForCourse(assignment.courseId),
        ).resolves.toEqual([published]);
        await expect(
          stores.assignments.listContentVersions(assignment.id),
        ).resolves.toEqual([
          {
            actorId: instructor.id,
            assignmentId: assignment.id,
            contentRevisionId: assignment.contentRevisionId,
            effectiveAt: NOW,
            id: "assignment-content-version-1",
            // Publishing writes a version, not a note: nobody was asked what
            // changed, and the ledger says which version is the publication's
            // own by where it sits.
            note: "",
          },
        ]);
      });
    });

    test("a student's overrides come back scoped to their course", async () => {
      await withStorage(async ({ stores }) => {
        const { assignment, instructor, student } =
          await createAssignmentSlice(stores);
        // A second course publishing the same revision, so the lookup has
        // something it must leave behind: an override is keyed by assignment
        // and student, and the course-wide read reaches it through a join that
        // either scopes correctly on both drivers or does not.
        const elsewhere = await stores.courses.create({
          id: "course-2",
          title: "Metalogic",
          timezone: "UTC",
          createdById: instructor.id,
          createdAt: NOW,
        });
        const otherAssignment = await stores.assignments.create({
          id: "assignment-2",
          courseId: elsewhere.id,
          contentRevisionId: assignment.contentRevisionId,
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
          createdById: instructor.id,
          createdAt: NOW,
        });
        const override = await stores.assignments.upsertOverride({
          id: "assignment-override-1",
          assignmentId: assignment.id,
          userId: student.id,
          availableFrom: null,
          dueAt: null,
          availableUntil: null,
          maxAttempts: 4,
          timeLimitMinutes: null,
          createdById: instructor.id,
          now: NOW,
        });

        await stores.assignments.upsertOverride({
          id: "assignment-override-2",
          assignmentId: otherAssignment.id,
          userId: student.id,
          availableFrom: null,
          dueAt: null,
          availableUntil: null,
          maxAttempts: 9,
          timeLimitMinutes: null,
          createdById: instructor.id,
          now: NOW,
        });
        // And one belonging to somebody else in the same course.
        await stores.assignments.upsertOverride({
          id: "assignment-override-3",
          assignmentId: assignment.id,
          userId: instructor.id,
          availableFrom: null,
          dueAt: null,
          availableUntil: null,
          maxAttempts: 2,
          timeLimitMinutes: null,
          createdById: instructor.id,
          now: NOW,
        });

        await expect(
          stores.assignments.listOverridesForCourseUser(
            assignment.courseId,
            student.id,
          ),
        ).resolves.toEqual([override]);
        await expect(
          stores.assignments.listOverridesForCourseUser(
            assignment.courseId,
            "user-1",
          ),
        ).resolves.toEqual([]);
      });
    });

    test("submissions and evaluations append to attempts", async () => {
      await withStorage(async ({ stores }) => {
        const { attempt, student } = await createAttemptSlice(stores);
        const submission = await stores.assessment.appendSubmission({
          id: "submission-1",
          attemptId: attempt.id,
          userId: student.id,
          idempotencyKey: "idem-1",
          answer: answer(["P → Q", "P", "Q"]),
          submittedAt: NOW,
        });
        const evaluation = await stores.assessment.appendEvaluation({
          id: "evaluation-1",
          submissionId: submission.id,
          evaluatorKind: "automatic",
          checkerVersion: "proof-service-test",
          result: { status: "correct" },
          score: 1,
          maxScore: 1,
          createdAt: NOW,
        });

        await expect(
          stores.assessment.getAttempt(attempt.id),
        ).resolves.toEqual(attempt);
        await expect(
          stores.assessment.listSubmissionsForAttempt(attempt.id),
        ).resolves.toEqual([submission]);
        await expect(
          stores.assessment.listEvaluationsForSubmission(submission.id),
        ).resolves.toEqual([evaluation]);
      });
    });

    test("LTI platforms and deployments can be registered and resolved", async () => {
      await withStorage(async ({ stores }) => {
        const platform = await stores.lti.createPlatform({
          id: "lti-platform-1",
          name: "Local Moodle",
          issuer: "https://lms.example.test",
          clientId: "client-1",
          authorizationEndpoint: "https://lms.example.test/auth",
          tokenEndpoint: "https://lms.example.test/token",
          jwksUri: "https://lms.example.test/jwks",
          createdAt: NOW,
        });
        const deployment = await stores.lti.createDeployment({
          id: "lti-deployment-1",
          platformId: platform.id,
          deploymentId: "deployment-1",
          name: "Main deployment",
          createdAt: NOW,
        });

        await expect(
          stores.lti.getPlatformByIssuerClientId(
            "https://lms.example.test",
            "client-1",
          ),
        ).resolves.toEqual(platform);
        await expect(
          stores.lti.listPlatformsByIssuer("https://lms.example.test"),
        ).resolves.toEqual([platform]);
        await expect(
          stores.lti.getDeployment(platform.id, "deployment-1"),
        ).resolves.toEqual(deployment);
        await expect(
          stores.lti.getDeployment(platform.id, "deployment-unknown"),
        ).resolves.toBeNull();
        await expect(
          stores.lti.createPlatform({
            id: "lti-platform-duplicate",
            name: "Duplicate",
            issuer: "https://lms.example.test",
            clientId: "client-1",
            authorizationEndpoint: "https://lms.example.test/auth",
            tokenEndpoint: "https://lms.example.test/token",
            jwksUri: "https://lms.example.test/jwks",
            createdAt: NOW,
          }),
        ).rejects.toThrow();

        const disabled = await stores.lti.setPlatformDisabled(
          platform.id,
          NOW,
          NOW,
        );

        expect(disabled?.disabledAt).toBe(NOW);
        await expect(
          stores.lti.deleteDeployment(platform.id, deployment.id),
        ).resolves.toBe(true);
        await expect(
          stores.lti.listDeploymentsForPlatform(platform.id),
        ).resolves.toEqual([]);
      });
    });

    test("LTI contexts and resource links map to courses and assignments", async () => {
      await withStorage(async ({ stores }) => {
        const { assignment } = await createAssignmentSlice(stores);
        const platform = await stores.lti.createPlatform({
          id: "lti-platform-1",
          name: "Local Moodle",
          issuer: "https://lms.example.test",
          clientId: "client-1",
          authorizationEndpoint: "https://lms.example.test/auth",
          tokenEndpoint: "https://lms.example.test/token",
          jwksUri: "https://lms.example.test/jwks",
          createdAt: NOW,
        });
        const deployment = await stores.lti.createDeployment({
          id: "lti-deployment-1",
          platformId: platform.id,
          deploymentId: "deployment-1",
          name: "",
          createdAt: NOW,
        });
        const context = await stores.lti.createContext({
          id: "lti-context-1",
          deploymentId: deployment.id,
          contextId: "course-context-1",
          courseId: assignment.courseId,
          createdAt: NOW,
        });

        await expect(
          stores.lti.getContext(deployment.id, "course-context-1"),
        ).resolves.toEqual(context);

        const seen = await stores.lti.upsertResourceLink({
          id: "lti-resource-link-1",
          contextId: context.id,
          resourceLinkId: "resource-link-1",
          title: "Homework 1",
          agsLineItemUrl: null,
          now: NOW,
        });

        expect(seen.assignmentId).toBeNull();
        await expect(
          stores.lti.listUnmappedResourceLinksForCourse(assignment.courseId),
        ).resolves.toEqual([seen]);

        const mapped = await stores.lti.setResourceLinkAssignment(
          seen.id,
          assignment.id,
          NOW,
        );

        expect(mapped?.assignmentId).toBe(assignment.id);

        // A later launch refreshes the platform-owned fields without
        // disturbing the assignment mapping an instructor created.
        const refreshed = await stores.lti.upsertResourceLink({
          id: "lti-resource-link-ignored",
          contextId: context.id,
          resourceLinkId: "resource-link-1",
          title: "Homework 1 (renamed)",
          agsLineItemUrl: "https://lms.example.test/line-items/1",
          now: "2026-01-03T03:04:05.000Z",
        });

        expect(refreshed.id).toBe(seen.id);
        expect(refreshed.assignmentId).toBe(assignment.id);
        expect(refreshed.title).toBe("Homework 1 (renamed)");
        await expect(
          stores.lti.listUnmappedResourceLinksForCourse(assignment.courseId),
        ).resolves.toEqual([]);

        // Both claims are optional per launch; a launch that omits them (an
        // instructor preview, AGS toggled off for a role) must not erase what
        // an earlier launch captured.
        const sparse = await stores.lti.upsertResourceLink({
          id: "lti-resource-link-ignored-2",
          contextId: context.id,
          resourceLinkId: "resource-link-1",
          title: "",
          agsLineItemUrl: null,
          now: "2026-01-04T03:04:05.000Z",
        });

        expect(sparse.id).toBe(seen.id);
        expect(sparse.title).toBe("Homework 1 (renamed)");
        expect(sparse.agsLineItemUrl).toBe(
          "https://lms.example.test/line-items/1",
        );
      });
    });

    test("LTI grade jobs queue atomically and are claimed exactly once", async () => {
      await withStorage(async ({ stores }) => {
        const { assignment, student } = await createAssignmentSlice(stores);
        const platform = await stores.lti.createPlatform({
          id: "lti-platform-1",
          name: "Local Moodle",
          issuer: "https://lms.example.test",
          clientId: "client-1",
          authorizationEndpoint: "https://lms.example.test/auth",
          tokenEndpoint: "https://lms.example.test/token",
          jwksUri: "https://lms.example.test/jwks",
          createdAt: NOW,
        });
        const deployment = await stores.lti.createDeployment({
          id: "lti-deployment-1",
          platformId: platform.id,
          deploymentId: "deployment-1",
          name: "",
          createdAt: NOW,
        });

        await expect(
          stores.lti.getDeploymentById(deployment.id),
        ).resolves.toEqual(deployment);

        const context = await stores.lti.createContext({
          id: "lti-context-1",
          deploymentId: deployment.id,
          contextId: "course-context-1",
          courseId: assignment.courseId,
          createdAt: NOW,
        });
        const link = await stores.lti.upsertResourceLink({
          id: "lti-resource-link-1",
          contextId: context.id,
          resourceLinkId: "resource-link-1",
          title: "Homework 1",
          agsLineItemUrl: "https://lms.example.test/line-items/1",
          now: NOW,
        });

        await stores.lti.setResourceLinkAssignment(
          link.id,
          assignment.id,
          NOW,
        );
        await expect(
          stores.lti.listResourceLinksForAssignment(assignment.id),
        ).resolves.toMatchObject([{ id: link.id }]);

        // The score write and its outbox row land in one transaction.
        await stores.scores.upsertAssignmentScoreWithGradeJobs(
          {
            assignmentId: assignment.id,
            userId: student.id,
            score: 3,
            maxScore: 5,
            status: "partial",
            calculatedAt: NOW,
          },
          [
            {
              id: "grade-job-1",
              resourceLinkId: link.id,
              userId: student.id,
              score: 3,
              maxScore: 5,
              scoreTimestamp: NOW,
              now: NOW,
            },
          ],
        );

        const stored = await stores.scores.getAssignmentScore(
          assignment.id,
          student.id,
        );

        expect(stored?.score).toBe(3);

        // Concurrent processors can never claim the same job.
        const [claimA, claimB] = await Promise.all([
          stores.lti.claimDueGradeJobs(NOW, "2026-01-01T00:00:00.000Z", 10),
          stores.lti.claimDueGradeJobs(NOW, "2026-01-01T00:00:00.000Z", 10),
        ]);
        const claimed = [...claimA, ...claimB];

        expect(claimed).toHaveLength(1);
        expect(claimed[0]?.status).toBe("sending");
        expect(claimed[0]?.score).toBe(3);

        // A score change while the job is in flight re-points the row at the
        // newer value; the in-flight completion must not bury it.
        const superseded = await stores.lti.enqueueGradeJob({
          id: "grade-job-ignored",
          resourceLinkId: link.id,
          userId: student.id,
          score: 5,
          maxScore: 5,
          scoreTimestamp: "2026-01-02T04:04:05.000Z",
          now: "2026-01-02T04:04:05.000Z",
        });

        expect(superseded?.id).toBe("grade-job-1");
        expect(superseded?.status).toBe("pending");
        await expect(
          stores.lti.completeGradeJob("grade-job-1", NOW, NOW),
        ).resolves.toBeNull();

        // An enqueue carrying an older score timestamp than the row lost a
        // refresh race; it must not re-point the fresher queued value.
        await expect(
          stores.lti.enqueueGradeJob({
            id: "grade-job-stale",
            resourceLinkId: link.id,
            userId: student.id,
            score: 1,
            maxScore: 5,
            scoreTimestamp: NOW,
            now: "2026-01-02T04:04:06.000Z",
          }),
        ).resolves.toBeNull();
        await expect(
          stores.lti.getGradeJob(link.id, student.id),
        ).resolves.toMatchObject({ id: "grade-job-1", score: 5 });

        const [reclaimed] = await stores.lti.claimDueGradeJobs(
          "2026-01-02T04:04:05.000Z",
          "2026-01-01T00:00:00.000Z",
          10,
        );

        expect(reclaimed?.score).toBe(5);

        const completed = await stores.lti.completeGradeJob(
          "grade-job-1",
          reclaimed?.updatedAt ?? "",
          "2026-01-02T04:05:05.000Z",
        );

        expect(completed?.status).toBe("complete");

        // Failures schedule a retry or park the job as permanently failed.
        await stores.lti.enqueueGradeJob({
          id: "grade-job-ignored-2",
          resourceLinkId: link.id,
          userId: student.id,
          score: 4,
          maxScore: 5,
          scoreTimestamp: "2026-01-02T05:04:05.000Z",
          now: "2026-01-02T05:04:05.000Z",
        });

        const [flight] = await stores.lti.claimDueGradeJobs(
          "2026-01-02T05:04:05.000Z",
          "2026-01-01T00:00:00.000Z",
          10,
        );
        const retried = await stores.lti.failGradeJob({
          id: flight?.id ?? "",
          claimedAt: flight?.updatedAt ?? "",
          attemptCount: 1,
          reason: "lms_rejected",
          detail: "HTTP 503",
          nextAttemptAt: "2026-01-02T05:09:05.000Z",
          now: "2026-01-02T05:04:06.000Z",
        });

        expect(retried?.status).toBe("pending");
        expect(retried?.attemptCount).toBe(1);
        // Not due yet, so a claim before next_attempt_at finds nothing.
        await expect(
          stores.lti.claimDueGradeJobs(
            "2026-01-02T05:05:05.000Z",
            "2026-01-01T00:00:00.000Z",
            10,
          ),
        ).resolves.toEqual([]);

        const [dueAgain] = await stores.lti.claimDueGradeJobs(
          "2026-01-02T05:09:05.000Z",
          "2026-01-01T00:00:00.000Z",
          10,
        );
        const parked = await stores.lti.failGradeJob({
          id: dueAgain?.id ?? "",
          claimedAt: dueAgain?.updatedAt ?? "",
          attemptCount: 2,
          reason: "lms_rejected",
          detail: "HTTP 403",
          nextAttemptAt: null,
          now: "2026-01-02T05:09:06.000Z",
        });

        expect(parked?.status).toBe("failed");
        await expect(
          stores.lti.listGradeJobsForCourse(assignment.courseId, "failed"),
        ).resolves.toMatchObject([
          {
            id: "grade-job-1",
            lastErrorDetail: "HTTP 403",
            lastFailureReason: "lms_rejected",
          },
        ]);

        // An instructor retry resets the failed job for a fresh delivery.
        const reset = await stores.lti.retryGradeJob(
          "grade-job-1",
          "2026-01-02T06:04:05.000Z",
        );

        expect(reset?.status).toBe("pending");
        expect(reset?.attemptCount).toBe(0);

        // Stale `sending` rows abandoned by a dead worker are reclaimable.
        await stores.lti.claimDueGradeJobs(
          "2026-01-02T06:04:05.000Z",
          "2026-01-01T00:00:00.000Z",
          10,
        );
        const [rescued] = await stores.lti.claimDueGradeJobs(
          "2026-01-02T07:04:05.000Z",
          "2026-01-02T06:30:00.000Z",
          10,
        );

        expect(rescued?.id).toBe("grade-job-1");

        // A claim is owned: after the row is re-pointed and claimed again,
        // the first claimant's completion (or failure) must not land even
        // though the row is `sending` again.
        await stores.lti.enqueueGradeJob({
          id: "grade-job-ignored-3",
          resourceLinkId: link.id,
          userId: student.id,
          score: 5,
          maxScore: 5,
          scoreTimestamp: "2026-01-02T08:00:00.000Z",
          now: "2026-01-02T08:00:00.000Z",
        });

        const [secondClaim] = await stores.lti.claimDueGradeJobs(
          "2026-01-02T08:00:01.000Z",
          "2026-01-01T00:00:00.000Z",
          10,
        );

        await expect(
          stores.lti.completeGradeJob(
            "grade-job-1",
            rescued?.updatedAt ?? "",
            "2026-01-02T08:00:02.000Z",
          ),
        ).resolves.toBeNull();
        await expect(
          stores.lti.failGradeJob({
            id: "grade-job-1",
            claimedAt: rescued?.updatedAt ?? "",
            attemptCount: 1,
            reason: "lms_rejected",
            detail: "HTTP 503",
            nextAttemptAt: "2026-01-02T08:05:00.000Z",
            now: "2026-01-02T08:00:02.000Z",
          }),
        ).resolves.toBeNull();
        await expect(
          stores.lti.completeGradeJob(
            "grade-job-1",
            secondClaim?.updatedAt ?? "",
            "2026-01-02T08:00:03.000Z",
          ),
        ).resolves.toMatchObject({ status: "complete", score: 5 });

        // A deferred delivery goes back to pending without spending retry
        // budget, and wakes when told to — or earlier once rescheduled.
        await stores.lti.enqueueGradeJob({
          id: "grade-job-ignored-4",
          resourceLinkId: link.id,
          userId: student.id,
          score: 4,
          maxScore: 5,
          scoreTimestamp: "2026-01-02T09:00:00.000Z",
          now: "2026-01-02T09:00:00.000Z",
        });

        const [toDefer] = await stores.lti.claimDueGradeJobs(
          "2026-01-02T09:00:01.000Z",
          "2026-01-01T00:00:00.000Z",
          10,
        );
        const deferred = await stores.lti.deferGradeJob(
          toDefer?.id ?? "",
          toDefer?.updatedAt ?? "",
          "2026-01-02T12:00:00.000Z",
          "2026-01-02T09:00:02.000Z",
        );

        expect(deferred?.status).toBe("pending");
        expect(deferred?.attemptCount).toBe(0);
        await expect(
          stores.lti.claimDueGradeJobs(
            "2026-01-02T10:00:00.000Z",
            "2026-01-02T09:30:00.000Z",
            10,
          ),
        ).resolves.toEqual([]);

        await stores.lti.rescheduleGradeJobsForAssignment(
          assignment.id,
          "2026-01-02T10:30:00.000Z",
        );

        const [rescheduled] = await stores.lti.claimDueGradeJobs(
          "2026-01-02T10:30:00.000Z",
          "2026-01-02T10:00:00.000Z",
          10,
        );

        expect(rescheduled?.id).toBe("grade-job-1");

        // Re-pointing a link at a different assignment clears its outbox.
        await stores.lti.deleteGradeJobsForResourceLink(link.id);
        await expect(
          stores.lti.getGradeJob(link.id, student.id),
        ).resolves.toBeNull();

        // A score projection computed from older data than the stored row
        // must not regress it.
        await expect(
          stores.scores.upsertAssignmentScore({
            assignmentId: assignment.id,
            userId: student.id,
            score: 1,
            maxScore: 5,
            status: "partial",
            calculatedAt: "2026-01-01T00:00:00.000Z",
          }),
        ).resolves.toMatchObject({ score: 3, calculatedAt: NOW });
      });
    });

    test("LTI subjects resolve per platform for grade passback", async () => {
      await withStorage(async ({ stores }) => {
        const user = await createUser(stores, "user-lti");

        await stores.lti.createPlatform({
          id: "lti-platform-1",
          name: "Local Moodle",
          issuer: "https://lms.example.test",
          clientId: "client-1",
          authorizationEndpoint: "https://lms.example.test/auth",
          tokenEndpoint: "https://lms.example.test/token",
          jwksUri: "https://lms.example.test/jwks",
          createdAt: NOW,
        });
        await stores.users.createExternalIdentity({
          id: "identity-lti-1",
          userId: user.id,
          provider: "lti",
          providerSubject: "lti-platform-1:sub-abc",
          createdAt: NOW,
        });

        await expect(
          stores.users.getLtiSubject(user.id, "lti-platform-1"),
        ).resolves.toBe("sub-abc");
        await expect(
          stores.users.getLtiSubject(user.id, "lti-platform-other"),
        ).resolves.toBeNull();
      });
    });

    test("LTI deep link requests are single-use and expire", async () => {
      await withStorage(async ({ stores }) => {
        const { course, instructor } = await createCourseSlice(stores);
        const platform = await stores.lti.createPlatform({
          id: "lti-platform-1",
          name: "Local Moodle",
          issuer: "https://lms.example.test",
          clientId: "client-1",
          authorizationEndpoint: "https://lms.example.test/auth",
          tokenEndpoint: "https://lms.example.test/token",
          jwksUri: "https://lms.example.test/jwks",
          createdAt: NOW,
        });
        const deployment = await stores.lti.createDeployment({
          id: "lti-deployment-1",
          platformId: platform.id,
          deploymentId: "deployment-1",
          name: "",
          createdAt: NOW,
        });

        await stores.lti.createDeepLinkRequest({
          tokenHash: "deep-link-hash-1",
          platformId: platform.id,
          deploymentId: deployment.id,
          courseId: course.id,
          userId: instructor.id,
          returnUrl: "https://lms.example.test/deep-link-return",
          data: "opaque-data",
          createdAt: NOW,
          expiresAt: "2026-01-02T03:34:05.000Z",
        });

        // A peek reads the pending request without spending it.
        const peeked = await stores.lti.getDeepLinkRequest(
          "deep-link-hash-1",
          NOW,
        );

        expect(peeked?.consumedAt).toBeNull();

        const consumed = await stores.lti.consumeDeepLinkRequest(
          "deep-link-hash-1",
          NOW,
        );

        expect(consumed?.returnUrl).toBe(
          "https://lms.example.test/deep-link-return",
        );
        expect(consumed?.data).toBe("opaque-data");
        await expect(
          stores.lti.consumeDeepLinkRequest("deep-link-hash-1", NOW),
        ).resolves.toBeNull();
        await expect(
          stores.lti.getDeepLinkRequest("deep-link-hash-1", NOW),
        ).resolves.toBeNull();

        await stores.lti.createDeepLinkRequest({
          tokenHash: "deep-link-hash-expired",
          platformId: platform.id,
          deploymentId: deployment.id,
          courseId: course.id,
          userId: instructor.id,
          returnUrl: "https://lms.example.test/deep-link-return",
          data: null,
          createdAt: NOW,
          expiresAt: NOW,
        });
        await expect(
          stores.lti.consumeDeepLinkRequest("deep-link-hash-expired", NOW),
        ).resolves.toBeNull();
      });
    });

    test("LTI login states are consumed exactly once", async () => {
      await withStorage(async ({ stores }) => {
        const platform = await stores.lti.createPlatform({
          id: "lti-platform-1",
          name: "Local Moodle",
          issuer: "https://lms.example.test",
          clientId: "client-1",
          authorizationEndpoint: "https://lms.example.test/auth",
          tokenEndpoint: "https://lms.example.test/token",
          jwksUri: "https://lms.example.test/jwks",
          createdAt: NOW,
        });

        await stores.lti.createLoginState({
          stateHash: "state-hash-1",
          nonceHash: "nonce-hash-1",
          platformId: platform.id,
          createdAt: NOW,
          expiresAt: "2026-01-02T03:14:05.000Z",
        });

        const [first, second] = await Promise.all([
          stores.lti.consumeLoginState("state-hash-1", NOW),
          stores.lti.consumeLoginState("state-hash-1", NOW),
        ]);
        const winners = [first, second].filter((state) => state !== null);

        expect(winners).toHaveLength(1);
        expect(winners[0]?.nonceHash).toBe("nonce-hash-1");
        await expect(
          stores.lti.consumeLoginState("state-hash-1", NOW),
        ).resolves.toBeNull();

        await stores.lti.createLoginState({
          stateHash: "state-hash-expired",
          nonceHash: "nonce-hash-expired",
          platformId: platform.id,
          createdAt: NOW,
          expiresAt: NOW,
        });
        await expect(
          stores.lti.consumeLoginState("state-hash-expired", NOW),
        ).resolves.toBeNull();
      });
    });

    test("LTI link challenges are single-use and discoverable while pending", async () => {
      await withStorage(async ({ stores }) => {
        const user = await createUser(stores, "user-1");
        const platform = await stores.lti.createPlatform({
          id: "lti-platform-1",
          name: "Local Moodle",
          issuer: "https://lms.example.test",
          clientId: "client-1",
          authorizationEndpoint: "https://lms.example.test/auth",
          tokenEndpoint: "https://lms.example.test/token",
          jwksUri: "https://lms.example.test/jwks",
          createdAt: NOW,
        });
        const challenge = await stores.lti.createLinkChallenge({
          tokenHash: "link-token-hash-1",
          platformId: platform.id,
          subject: "lms-subject-1",
          email: user.email,
          name: "Ada Lovelace",
          userId: user.id,
          createdAt: NOW,
          expiresAt: "2026-01-03T03:04:05.000Z",
        });

        await expect(
          stores.lti.getPendingLinkChallenge(
            platform.id,
            "lms-subject-1",
            user.id,
            NOW,
          ),
        ).resolves.toEqual(challenge);

        // Peeking by token does not consume the challenge.
        await expect(
          stores.lti.getLinkChallenge("link-token-hash-1", NOW),
        ).resolves.toEqual(challenge);
        await expect(
          stores.lti.getLinkChallenge("link-token-hash-1", NOW),
        ).resolves.toEqual(challenge);

        const consumed = await stores.lti.consumeLinkChallenge(
          "link-token-hash-1",
          NOW,
        );

        expect(consumed?.userId).toBe(user.id);
        await expect(
          stores.lti.consumeLinkChallenge("link-token-hash-1", NOW),
        ).resolves.toBeNull();
        await expect(
          stores.lti.getPendingLinkChallenge(
            platform.id,
            "lms-subject-1",
            user.id,
            NOW,
          ),
        ).resolves.toBeNull();

        // A withdrawn challenge (confirmation email never delivered) is gone
        // for both consumption and pending lookups.
        await stores.lti.createLinkChallenge({
          tokenHash: "link-token-hash-2",
          platformId: platform.id,
          subject: "lms-subject-2",
          email: user.email,
          name: "Ada Lovelace",
          userId: user.id,
          createdAt: NOW,
          expiresAt: "2026-01-03T03:04:05.000Z",
        });
        await stores.lti.deleteLinkChallenge("link-token-hash-2");
        await expect(
          stores.lti.consumeLinkChallenge("link-token-hash-2", NOW),
        ).resolves.toBeNull();
        await expect(
          stores.lti.getPendingLinkChallenge(
            platform.id,
            "lms-subject-2",
            user.id,
            NOW,
          ),
        ).resolves.toBeNull();
      });
    });

    test("batched submission and evaluation failures roll back", async () => {
      await withStorage(async ({ stores }) => {
        const { attempt, student } = await createAttemptSlice(stores);
        const firstSubmission = await stores.assessment.appendSubmission({
          id: "submission-1",
          attemptId: attempt.id,
          userId: student.id,
          idempotencyKey: "idem-1",
          answer: answer(["P"]),
          submittedAt: NOW,
        });

        await stores.assessment.appendEvaluation({
          id: "evaluation-duplicate",
          submissionId: firstSubmission.id,
          evaluatorKind: "automatic",
          checkerVersion: "proof-service-test",
          result: { status: "incorrect" },
          score: 0,
          maxScore: 1,
          createdAt: NOW,
        });
        await expect(
          stores.assessment.appendSubmissionWithEvaluation(
            {
              id: "submission-rolled-back",
              attemptId: attempt.id,
              userId: student.id,
              idempotencyKey: "idem-rolled-back",
              answer: answer(["Q"]),
              submittedAt: NOW,
            },
            {
              id: "evaluation-duplicate",
              submissionId: "submission-rolled-back",
              evaluatorKind: "automatic",
              checkerVersion: "proof-service-test",
              result: { status: "correct" },
              score: 1,
              maxScore: 1,
              createdAt: NOW,
            },
          ),
        ).rejects.toThrow();

        const submissions = await stores.assessment.listSubmissionsForAttempt(
          attempt.id,
        );

        expect(submissions.map((submission) => submission.id)).toEqual([
          firstSubmission.id,
        ]);
      });
    });

    test("a refused second reset takes its own void down with it", async () => {
      await withStorage(async ({ stores }) => {
        const { attempt, student } = await createAttemptSlice(stores);
        const reset = {
          assignmentId: "assignment-1",
          expiresAt: null,
          oldAttemptId: attempt.id,
          openedAt: LATER,
          userId: student.id,
          voidedAt: LATER,
          voidedById: student.id,
        };

        const first = await stores.assessment.resetAttempt({
          ...reset,
          newAttemptId: "attempt-2",
        });

        // The ordinal is computed by a subquery inside the insert rather than
        // read and incremented here, so this also checks that a parameterised
        // expression nested in a batched statement survives the round trip.
        expect(first?.newAttempt.ordinal).toBe(2);

        const before =
          await stores.assessment.listAttemptsForAssignment("assignment-1");

        // The unique `supersedes_attempt_id` refuses the second reset, and its
        // void is in the same batch — so the void has to roll back with it. A
        // driver whose batch were merely a loop would leave the attempt voided
        // a second time with no replacement to show for it.
        await expect(
          stores.assessment.resetAttempt({
            ...reset,
            newAttemptId: "attempt-3",
          }),
        ).rejects.toThrow();

        await expect(
          stores.assessment.listAttemptsForAssignment("assignment-1"),
        ).resolves.toEqual(before);
      });
    });
  });
}
