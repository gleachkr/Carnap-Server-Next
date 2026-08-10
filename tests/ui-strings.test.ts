import { describe, expect, test } from "bun:test";

import { DEFAULT_LOCALE, i18nFor } from "../src/worker/i18n";
import {
  editorUiStrings,
  exerciseUiStrings,
  reviewUiStrings,
} from "../src/worker/web/ui-strings";

/**
 * The strings the server-generated enhancement scripts and the editor bundle read
 * out of their JSON payloads.
 *
 * Some of them are templates the *browser* fills, because only the browser knows
 * the values — when a submission was recorded, how many cells were right. Those
 * have to reach it with their `{placeholders}` intact, and `i18n.t` will quietly
 * eat any placeholder it was not given a value for. That is not a hypothetical:
 * the submission status line and the review card's score line shipped with their
 * slots already blanked, in every language including English, and nothing failed
 * — the tests of the day asserted on the *shape* of the emitted script, never on
 * the payload it reads.
 */

/** Every payload entry the client substitutes into, with the slots it must keep. */
const CLIENT_FILLED: readonly (readonly [
  string,
  string,
  readonly string[],
])[] = [
  [
    "exercise.submittedAt",
    exerciseUiStrings(i18nFor("de")).submittedAt,
    ["when"],
  ],
  [
    "exercise.submittedAtScored",
    exerciseUiStrings(i18nFor("de")).submittedAtScored,
    ["when", "score", "maxScore"],
  ],
  [
    "review.scored",
    reviewUiStrings(i18nFor("de")).scored,
    ["score", "maxScore", "evaluator"],
  ],
  [
    "editor.diagnostic",
    editorUiStrings(i18nFor("de"), "de").diagnostic,
    ["code", "line", "message"],
  ],
];

describe("client-filled UI strings", () => {
  for (const [name, resolved, slots] of CLIENT_FILLED) {
    test(`${name} keeps its placeholders through translation`, () => {
      for (const slot of slots) {
        expect(resolved, `${name} lost {${slot}}`).toContain(`{${slot}}`);
      }
    });
  }

  // The scripts fall back to `S.key || "English"`, so the English catalog must
  // return each of these byte-identical to the fallback the script carries.
  test("English resolves to the source text, placeholders and all", () => {
    const i18n = i18nFor(DEFAULT_LOCALE);

    expect(exerciseUiStrings(i18n).submittedAt).toBe("Submitted at {when}.");
    expect(exerciseUiStrings(i18n).submittedAtScored).toBe(
      "Submitted at {when} · {score}/{maxScore}.",
    );
    expect(reviewUiStrings(i18n).scored).toBe(
      "{score}/{maxScore} · {evaluator}",
    );
    expect(editorUiStrings(i18n, DEFAULT_LOCALE).diagnostic).toBe(
      "{code} line {line}: {message}",
    );
  });

  test("a translated payload is actually translated", () => {
    const i18n = i18nFor("de");

    expect(exerciseUiStrings(i18n).submittedAt).toBe("Abgegeben am {when}.");
    expect(editorUiStrings(i18n, "de").diagnostic).toBe(
      "{code} Zeile {line}: {message}",
    );
  });
});
