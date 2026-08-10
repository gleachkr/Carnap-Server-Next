import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import {
  CORRECTNESS_MARK_CLASS,
  CORRECTNESS_MARK_GLYPHS,
} from "../../src/worker/exercises/correctness-mark";
import { EXERCISE_RUNTIME_SCRIPT } from "../../src/worker/web/assignment-scripts";

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
function pageWith(evaluation: unknown): string {
  const state = {
    exercises: {
      q1: {
        answerReview: null,
        evaluation,
        submission: {
          answer: {},
          answerKind: "multiple-choice-answer@1",
          exerciseId: "q1",
          id: "sub-1",
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
       <form action="/attempts/a1/submissions" class="exercise"
             data-exercise-id="q1" method="post">
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
    ).toBe(
      `${CORRECTNESS_MARK_GLYPHS.ok}|Submitted at 2026-08-07T12:00:00.000Z · 2/2.`,
    );

    // Withheld: same verdict, no numbers, so the line drops the score rather
    // than printing `null/null`.
    expect(pageWith(recorded({ verdict: "correct" }))).toBe(
      `${CORRECTNESS_MARK_GLYPHS.ok}|Submitted at 2026-08-07T12:00:00.000Z.`,
    );
  });

  test("stays idle on anything short of correct", () => {
    for (const verdict of ["partial", "incorrect"]) {
      expect(pageWith(recorded({ verdict }))).toBe(
        `${CORRECTNESS_MARK_GLYPHS.idle}|Submitted at 2026-08-07T12:00:00.000Z.`,
      );
    }

    // Partial credit is not a green check even where the numbers are shown.
    expect(
      pageWith(recorded({ maxScore: 2, score: 1, verdict: "partial" })),
    ).toBe(
      `${CORRECTNESS_MARK_GLYPHS.idle}|Submitted at 2026-08-07T12:00:00.000Z · 1/2.`,
    );

    // And no evaluation at all — a sealed verdict, or a free response waiting
    // on an instructor — is not a claim that the work is wrong.
    expect(pageWith(null)).toBe(
      `${CORRECTNESS_MARK_GLYPHS.idle}|Submitted at 2026-08-07T12:00:00.000Z.`,
    );
  });
});
