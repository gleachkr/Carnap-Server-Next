import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { withStorage } from "./helpers/http";
import {
  seedCourseWithAssignment,
  seedSubmission,
  seedUser,
} from "./helpers/seed";

setDefaultTimeout(30_000);

describe("admin global stats", () => {
  test("counts users, live courses, assignments, submissions, and manual grading", async () => {
    await withStorage(async (storage) => {
      const stores = storage.stores;

      // Deliberately five different numbers, so a query pointed at the wrong
      // table or missing its filter cannot land on the right answer by
      // coincidence.
      await seedUser(stores, "user-1");
      await seedUser(stores, "user-2");
      await seedUser(stores, "user-3");

      const liveAssignment = await seedCourseWithAssignment(
        stores,
        "live",
        "user-1",
      );

      await seedCourseWithAssignment(stores, "archived", "user-1", {
        archived: true,
      });

      // Four submissions, of which two await an instructor and one is
      // already machine-graded — so `gradingWork` must count manual
      // evaluations, not submissions and not evaluations at large.
      await seedSubmission(stores, "1", liveAssignment, "user-1", "manual");
      await seedSubmission(stores, "2", liveAssignment, "user-2", "manual");
      await seedSubmission(
        stores,
        "3",
        liveAssignment,
        "user-3",
        "automatic",
      );
      await seedSubmission(stores, "4", liveAssignment, "user-1", null);

      const stats = await stores.adminStats.getGlobalStats();

      expect(stats).toEqual({
        activeCourses: 1,
        assignments: 2,
        gradingWork: 2,
        submissions: 4,
        users: 3,
      });
    });
  });

  test("reports zeroes on an empty instance", async () => {
    await withStorage(async (storage) => {
      expect(await storage.stores.adminStats.getGlobalStats()).toEqual({
        activeCourses: 0,
        assignments: 0,
        gradingWork: 0,
        submissions: 0,
        users: 0,
      });
    });
  });
});
