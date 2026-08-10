import { describe, expect, test } from "bun:test";

import {
  attachmentDisposition,
  csvDownloadHeaders,
  downloadFilename,
} from "../src/worker/web/download";

const AT = new Date("2026-03-14T21:32:07.000Z");

describe("download filenames", () => {
  test("reads the parts in order, then the stamp", () => {
    expect(
      downloadFilename(
        { at: AT, parts: ["Intro Logic", "Homework 3"], timezone: "UTC" },
        "csv",
      ),
    ).toBe("Intro Logic - Homework 3 - 2026-03-14 21-32.csv");
  });

  test("stamps the moment in the course's own timezone", () => {
    // Same instant, two courses: the file is named in the clock the course runs
    // on, so an instructor's exports sort the way their day did.
    expect(
      downloadFilename(
        { at: AT, parts: ["Logic"], timezone: "America/Chicago" },
        "csv",
      ),
    ).toBe("Logic - 2026-03-14 16-32.csv");
    expect(
      downloadFilename(
        { at: AT, parts: ["Logic"], timezone: "Asia/Tokyo" },
        "csv",
      ),
    ).toBe("Logic - 2026-03-15 06-32.csv");
  });

  test("falls back to UTC rather than failing on an unusable timezone", () => {
    expect(
      downloadFilename(
        { at: AT, parts: ["Logic"], timezone: "Mars/Olympus_Mons" },
        "csv",
      ),
    ).toBe("Logic - 2026-03-14 21-32.csv");
  });

  test("keeps path separators and reserved characters out of the name", () => {
    expect(
      downloadFilename(
        {
          at: AT,
          parts: ['Logic/Rhetoric: "Unit 1"', "Quiz\\2?"],
          timezone: "UTC",
        },
        "csv",
      ),
    ).toBe("Logic Rhetoric Unit 1 - Quiz 2 - 2026-03-14 21-32.csv");
  });

  test("drops empty parts instead of leaving a bare separator", () => {
    expect(
      downloadFilename(
        { at: AT, parts: ["Logic", "   "], timezone: "UTC" },
        "csv",
      ),
    ).toBe("Logic - 2026-03-14 21-32.csv");
  });

  test("truncates a long title without leaving a trailing dot or space", () => {
    const name = downloadFilename(
      { at: AT, parts: [`${"Seminar on ".repeat(9)}.`], timezone: "UTC" },
      "csv",
    );

    // Windows drops a trailing dot or space when saving, which would make a cut
    // title look like a truncated file.
    expect(name).toBe(
      "Seminar on Seminar on Seminar on Seminar on Seminar on Semin - 2026-03-14 21-32.csv",
    );
  });

  test("carries a non-ASCII name twice, encoded and transliterated", () => {
    const disposition = attachmentDisposition("Logik für Anfänger.csv");

    expect(disposition).toBe(
      `attachment; filename="Logik f_r Anf_nger.csv"; filename*=UTF-8''Logik%20f%C3%BCr%20Anf%C3%A4nger.csv`,
    );
  });

  test("escapes what RFC 5987 does not admit but encodeURIComponent leaves bare", () => {
    expect(attachmentDisposition("a'b(c)d*e.csv")).toContain(
      "filename*=UTF-8''a%27b%28c%29d%2Ae.csv",
    );
  });

  test("csv headers carry the type and the name", () => {
    expect(
      csvDownloadHeaders({ at: AT, parts: ["Logic"], timezone: "UTC" }),
    ).toEqual({
      "Content-Disposition": `attachment; filename="Logic - 2026-03-14 21-32.csv"; filename*=UTF-8''Logic%20-%202026-03-14%2021-32.csv`,
      "Content-Type": "text/csv; charset=utf-8",
    });
  });
});
