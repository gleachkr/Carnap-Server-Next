import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import {
  CORRECTNESS_MARK_CLASS,
  CORRECTNESS_MARK_GLYPHS,
} from "../../src/worker/exercise-kit/correctness-mark";
import { EXERCISE_RUNTIME_SCRIPT } from "../../src/worker/web/assignment-scripts";
import { LOCAL_TIMESTAMP_FIELDS } from "../../src/worker/web/timestamp-formats";

/**
 * The correctness mark for work the server already holds.
 *
 * The server always paints this idle and the runtime decides on load, so this
 * script is the only writer of the recorded state — nothing on the wire or in
 * the rendered HTML would show a regression here. It used to compare
 * `score >= maxScore`; the numbers can now be withheld while the verdict is
 * not, so it reads the verdict the server sends instead, and a mark that went
 * permanently idle would otherwise be invisible until someone looked at a page.
 */
function pageWith(
  evaluation: unknown,
  strings: object = {},
  points?: number,
): string {
  // `undefined` is no submission at all, as the server sends it: no entry.
  const state = {
    exercises:
      evaluation === undefined
        ? {}
        : {
            q1: {
              evaluation,
              submission: {
                exerciseId: "q1",
                submittedAt: "2026-08-07T12:00:00.000Z",
              },
            },
          },
  };
  const dom = new JSDOM(
    `<!doctype html><html lang="en"><head><title>Content</title></head><body>
       <script data-carnap-exercise-runtime-state type="application/json">${JSON.stringify(
         state,
       )}</script>
       <script data-carnap-exercise-strings type="application/json">${JSON.stringify(
         strings,
       )}</script>
       <form action="/attempts/a1/submissions" class="exercise-submission"
             data-exercise-id="q1"${
               points === undefined ? "" : ` data-points="${points}"`
} method="post">
         <input name="csrfToken" type="hidden" value="csrf">
         <input name="exerciseId" type="hidden" value="q1">
         <input name="answerData" type="hidden">
         <input name="answerKind" type="hidden" value="multiple-choice-answer@1">
         <input name="schemaVersion" type="hidden" value="1">
         <button type="submit">Submit answer</button>
         <span class="${CORRECTNESS_MARK_CLASS}">${CORRECTNESS_MARK_GLYPHS.idle}</span>
         <p data-exercise-status></p>
       </form>
     </body></html>`,
    { runScripts: "outside-only", url: "https://example.test/content" },
  );

  (dom.window as unknown as { eval(code: string): void }).eval(
    EXERCISE_RUNTIME_SCRIPT,
  );

  const mark = dom.window.document.querySelector(
    `.${CORRECTNESS_MARK_CLASS}`,
  );
  const status = dom.window.document.querySelector("[data-exercise-status]");

  return `${mark?.textContent ?? ""}|${status?.textContent ?? ""}`;
}

/**
 * The submission time as the runtime writes it: the reader's own clock, in the
 * page's language (the test process's zone and, with no payload, its locale).
 */
const AT = new Intl.DateTimeFormat(undefined, LOCAL_TIMESTAMP_FIELDS).format(
  new Date("2026-08-07T12:00:00.000Z"),
);

const recorded = (fields: Record<string, unknown>) => ({
  createdAt: "2026-08-07T12:00:00.000Z",
  evaluatorKind: "automatic",
  maxScore: null,
  result: null,
  score: null,
  ...fields,
});

describe("the mark for work already recorded", () => {
  test("goes green on the server's verdict, with or without the numbers", () => {
    // Released: the numbers are there and the line says them.
    expect(
      pageWith(recorded({ maxScore: 2, score: 2, verdict: "correct" })),
    ).toBe(`${CORRECTNESS_MARK_GLYPHS.ok}|Submitted at ${AT} · 2/2.`);

    // Withheld: same verdict, no numbers, so the line drops the score rather
    // than printing `null/null`.
    expect(pageWith(recorded({ verdict: "correct" }))).toBe(
      `${CORRECTNESS_MARK_GLYPHS.ok}|Submitted at ${AT}.`,
    );
  });

  test("a zero-point exercise is marked on its verdict, with no 0/0", () => {
    expect(
      pageWith(recorded({ maxScore: 0, score: 0, verdict: "correct" })),
    ).toBe(`${CORRECTNESS_MARK_GLYPHS.ok}|Submitted at ${AT}.`);
  });

  test("stays idle on anything short of correct", () => {
    for (const verdict of ["partial", "incorrect"]) {
      expect(pageWith(recorded({ verdict }))).toBe(
        `${CORRECTNESS_MARK_GLYPHS.idle}|Submitted at ${AT}.`,
      );
    }

    // Partial credit is not a green check even where the numbers are shown.
    expect(
      pageWith(recorded({ maxScore: 2, score: 1, verdict: "partial" })),
    ).toBe(`${CORRECTNESS_MARK_GLYPHS.idle}|Submitted at ${AT} · 1/2.`);

    // And no evaluation at all — a sealed verdict, or a free response waiting
    // on an instructor — is not a claim that the work is wrong.
    expect(pageWith(null)).toBe(
      `${CORRECTNESS_MARK_GLYPHS.idle}|Submitted at ${AT}.`,
    );
  });
});

describe("the points on the status line", () => {
  test("say what the exercise is worth before there is a score to show", () => {
    expect(pageWith(undefined, {}, 2)).toBe(
      `${CORRECTNESS_MARK_GLYPHS.idle}|No submission in this attempt · –/2.`,
    );
    expect(pageWith(null, {}, 2)).toBe(
      `${CORRECTNESS_MARK_GLYPHS.idle}|Submitted at ${AT} · –/2.`,
    );
    expect(pageWith(recorded({ verdict: "correct" }), {}, 2)).toBe(
      `${CORRECTNESS_MARK_GLYPHS.ok}|Submitted at ${AT} · –/2.`,
    );
  });

  test("give way to the score, out of the points it was graded out of", () => {
    // Declared 3 now, graded out of 2 then: the score says what it was.
    expect(
      pageWith(
        recorded({ maxScore: 2, score: 1, verdict: "partial" }),
        {},
        3,
      ),
    ).toBe(`${CORRECTNESS_MARK_GLYPHS.idle}|Submitted at ${AT} · 1/2.`);
  });

  test("are left off a zero-point exercise", () => {
    expect(pageWith(undefined, {}, 0)).toBe(
      `${CORRECTNESS_MARK_GLYPHS.idle}|No submission in this attempt.`,
    );
  });
});

describe("the submission time", () => {
  test("is written in the reader's clock and the page's language, not as ISO", () => {
    const at = new Intl.DateTimeFormat("de", LOCAL_TIMESTAMP_FIELDS).format(
      new Date("2026-08-07T12:00:00.000Z"),
    );

    expect(
      pageWith(null, {
        locale: "de",
        submittedAt: "Abgegeben am {when}.",
      }),
    ).toBe(`${CORRECTNESS_MARK_GLYPHS.idle}|Abgegeben am ${at}.`);
  });
});
