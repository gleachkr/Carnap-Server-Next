import { escapeHtml } from "../application/content/render-support";
import type { Translator } from "../i18n/translator";
import {
  CORRECTNESS_MARK_CLASS,
  CORRECTNESS_MARK_GLYPHS,
  CORRECTNESS_MARK_LABEL_ATTRIBUTES,
  type CorrectnessMarkState,
} from "./correctness-mark";

/**
 * The action bar: the one row at the foot of every exercise, holding submit, the
 * live status line, the widget's own controls (Check, the `(?)` instructions)
 * and — last, so it lands hard right — the correctness mark.
 *
 * It lives in light DOM whichever page renders it. An interactive element
 * projects it into its shadow card through `slot="exercise-actions"` so it reads
 * as part of the exercise, but the fragment itself stays outside: that is what
 * lets author CSS reach every control uniformly, what lets the runtime find the
 * button and the mark by `form.querySelector`, and what lets a widget add its own
 * buttons to the same row (see the client base class).
 *
 * Its own leaf module because two very different callers need it. The submission
 * page renders the working bar; the *preview* renderers under
 * `exercises/<type>/read-only-view.ts` render the inert one, and those are
 * compiled into the browser preview bundle — importing the assignment page from
 * there would drag the whole app shell into it.
 */

/**
 * Every message the bar words itself with.
 *
 * Resolved through one function because the editor preview's strings payload has
 * to be built before anything is rendered, and it asks by calling this — see
 * `buildPreviewStrings` in `web/ui-strings.ts`. A message added here without that
 * call would render English inside a German preview and nowhere else, which is
 * the one i18n failure nothing in the stack can observe.
 */
export function buildExerciseActionsStrings(i18n: Translator) {
  return {
    // "Not correct yet" rather than "Incomplete", because idle is three
    // situations at once: not started, half-finished, and finished but wrong.
    // Only one of those is incomplete, and the mark cannot tell them apart — all
    // it knows is that nothing has said the work is right.
    //
    // `error` is "could not check", not "not correct": every widget that reaches
    // that state does so because the WASM proof engine failed to load, and a red
    // mark reading "not correct" would blame the reader for the machine. The
    // widget's own message goes in the tooltip, so the name only has to be the
    // honest general case.
    error: i18n.t("Could not check"),
    idle: i18n.t("Not correct yet"),
    ok: i18n.t("Correct"),
    // Why the submit button does nothing wherever there is nothing to submit
    // to. Two audiences read it: an author trying their own exercise in a
    // preview, and a student working an exercise inside a reading, which
    // records nothing by definition. So it says the fact rather than naming
    // either situation — "Preview" would be a lie on half the pages it appears.
    preview: i18n.t("Answers are not recorded here."),
    submit: i18n.t("Submit answer"),
    working: i18n.t("Checking"),
  };
}

/**
 * The correctness mark, in its idle state.
 *
 * Rendered by the server rather than added by the runtime so that it is on screen
 * in the first paint, and it carries the accessible name for all four of its
 * states because it is the one element every writer of the mark already has in
 * hand — see `exercises/correctness-mark.ts`.
 *
 * `role="img"` and not a live region, on purpose. The status line beside it is
 * already `aria-live`, and the proof types recompute this mark on a debounce
 * while the reader types: a polite region here would announce "checking",
 * "correct", "not correct yet" over and over through an edit, and duplicate the
 * status line on every submit.
 */
function correctnessMarkHtml(i18n: Translator): string {
  const strings = buildExerciseActionsStrings(i18n);
  const labels: Readonly<Record<CorrectnessMarkState, string>> = {
    error: strings.error,
    idle: strings.idle,
    ok: strings.ok,
    working: strings.working,
  };
  const attributes = Object.entries(CORRECTNESS_MARK_LABEL_ATTRIBUTES)
    .map(
      ([state, attribute]) =>
        ` ${attribute}="${escapeHtml(labels[state as CorrectnessMarkState])}"`,
    )
    .join("");

  return `<span aria-label="${escapeHtml(
    labels.idle,
  )}" class="${CORRECTNESS_MARK_CLASS}" data-state="idle"${attributes} role="img" title="${escapeHtml(
    labels.idle,
  )}">${CORRECTNESS_MARK_GLYPHS.idle}</span>`;
}

export interface ExerciseActionsOptions {
  /**
   * A preview's bar: the row is rendered so an author sees the shape the finished
   * exercise will have, but there is nothing to submit to — no attempt, no form,
   * no answer to record — so the button is disabled and says why on hover.
   */
  readonly preview?: boolean;
  /**
   * True when an interactive element will project the bar into its shadow card.
   * The fragment stays in light DOM either way; the slot only relocates it.
   */
  readonly slotted?: boolean;
  /** The submission status line. Empty where nothing has been submitted. */
  readonly status?: string;
}

/**
 * The bar, as a fragment of HTML.
 *
 * Source order is submit · status · mark · check status, which is what puts the
 * mark hard right of the row (the stylesheet gives it `margin-left: auto`) and
 * the check status alone on the line below it (`flex-basis: 100%`). A widget that
 * adds its own controls inserts them before the submit, so the row reads
 * `(?) · Check · Submit`.
 *
 * The two status lines are two different voices and that is why there are two.
 * The first is the platform's: what the *server* did with an answer that was
 * sent to it. The second is the widget's: what its own local Check makes of the
 * work in front of it, which needs no submission and happens far more often. One
 * line carrying both would have a recorded submission and a keystroke overwrite
 * each other, and the reader with no way to tell which they were reading.
 *
 * Rendered here, empty, rather than built by each widget that wants one — the
 * same reasoning as the correctness mark beside it. Three widgets check locally
 * today and each had grown its own line: the truth table's in this bar, the model
 * and translation's inside their shadow roots, where the content stylesheet
 * cannot reach and so the same sentence came out in body type above the buttons
 * instead of small type below them. A widget that never checks leaves this empty
 * and `:empty` hides it.
 */
export function exerciseActionsHtml(
  i18n: Translator,
  options: ExerciseActionsOptions = {},
): string {
  const strings = buildExerciseActionsStrings(i18n);
  const slot = options.slotted === true ? ` slot="exercise-actions"` : "";
  const inert =
    options.preview === true
      ? ` disabled title="${escapeHtml(strings.preview)}"`
      : "";

  return `<div class="exercise-actions"${slot}><button class="exercise-submit" type="submit"${inert}>${escapeHtml(
    strings.submit,
  )}</button><p aria-live="polite" class="exercise-status" data-exercise-status>${escapeHtml(
    options.status ?? "",
  )}</p>${correctnessMarkHtml(i18n)}<p aria-live="polite" class="exercise-status exercise-check-status" data-exercise-check-status></p></div>`;
}

/**
 * The bar a preview shows: everything the student's version has, with the submit
 * disabled.
 *
 * Every no-submission renderer calls this — the revision editor's live preview,
 * the saved-revision view, a reading, and a graded assignment opened without an
 * attempt — so
 * that what an author is looking at while writing has the same last row as what a
 * student will work in. The widget's own controls still appear in it and still
 * work: a local Check needs no submission, and the correctness mark it writes is
 * how an author tries their own exercise.
 */
export function previewExerciseActionsHtml(
  i18n: Translator,
  slotted: boolean,
): string {
  return exerciseActionsHtml(i18n, { preview: true, slotted });
}
