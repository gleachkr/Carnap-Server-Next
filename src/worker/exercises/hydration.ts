import type { ExerciseFeedback } from "../domain/exercises";
import type { JsonValue } from "../domain/json";
import type { Translator } from "../i18n/translator";
import { jsonScriptContent } from "../web/json-script";
import { exerciseStrings } from "./strings";

/**
 * The per-exercise hydration payload — the single channel from the server
 * render to the interactive custom element. Each exercise embeds one
 * `<script type="application/json" data-exercise-hydration>` carrying this
 * object; the element base reads it on connect (see the client
 * `CarnapExerciseElement`). Keeping the shape here, DOM-free, lets both the
 * worker (emitter) and the client element (reader) share the contract.
 */
export const EXERCISE_HYDRATION_VERSION = 1;

/** Interactive answering vs. read-only review display. */
export type ExerciseHydrationMode = "answer" | "review";

export interface ExerciseHydrationOptions {
  /** Resolved for this reader on this assignment; absent means `full`. */
  readonly feedback?: ExerciseFeedback;
}

export interface ExerciseHydration {
  /** Wire version, so a future shape change is detectable client-side. */
  readonly version: number;
  readonly mode: ExerciseHydrationMode;
  /** Everything the widget needs to render (structure, prompt refs, config). */
  readonly publicData: JsonValue;
  /**
   * The student's own last answer for this attempt, so the widget can restore
   * its state on reload; null when there is no prior submission. It is always
   * the viewer's own answer (or, in review mode, the answer under review), so
   * exposing it to the client is safe — correctness keys stay server-side.
   */
  readonly priorAnswer: JsonValue | null;
  /**
   * Render options the *server* decides, as opposed to the ones the author
   * compiled into {@link publicData}.
   *
   * The distinction is what `feedback` needs: how much a student may be told
   * depends on the assignment (graded or not, grades out or not) as well as on
   * the directive, and one compiled artifact serves many assignments. So the
   * authored value lives in the manifest and the *resolved* one arrives here,
   * per render. A widget reads `options.feedback` and falls back to whatever its
   * own `publicData` says for a payload written before this field existed.
   */
  readonly options: ExerciseHydrationOptions;
  /**
   * The widget's own interface text, already resolved for the viewer's locale
   * and keyed by its English source text — so a client lookup that misses
   * (an older payload, a key the server does not know) degrades to readable
   * English rather than to a key. See `exerciseStrings`, which fills it, and
   * the client base's `t()`, which reads it.
   *
   * This is how the widgets are translated without shipping an i18n runtime to
   * the browser: the server, which has the catalogs, resolves the text; the
   * element only substitutes `{placeholders}`. The corollary is a constraint on
   * the copy — **a client-side message must not need grammatical agreement with
   * a value the client computes**, because there is no ICU formatter out there
   * to select a plural form. Phrase such text so the count is a bare value
   * ("Correct cells: 3 of 8"), not an inflected noun ("3 cells correct").
   */
  readonly strings: Readonly<Record<string, string>>;
}

/**
 * The payload's carrier: the one `<script>` an element reads on connect. Every
 * emitter goes through this, so "how a widget is hydrated" has a single answer
 * whether the widget is being answered or reviewed.
 *
 * `jsonScriptContent` comes from the content document rather than being spelled
 * again here because the escaping is a correctness matter (a `</script>` inside
 * a translated string would otherwise end the tag), and two copies of it is one
 * copy too many.
 */
export function exerciseHydrationScript(
  hydration: ExerciseHydration,
): string {
  return `<script type="application/json" data-exercise-hydration>${jsonScriptContent(hydration)}</script>`;
}

/**
 * The payload for a widget rendered read-only, to embed inside the review
 * markup itself (there is no form on a review page to carry it).
 *
 * A review is a rendered widget, not a picture of one — the Fitch review really
 * does upgrade and mount a read-only editor — so it needs the same channel the
 * answering path uses, and for the same reason: its `strings`, resolved for the
 * viewer, are the only translations it will ever see. There is no answer to
 * restore and no public render data to work from (the review renderer has
 * already drawn the submission server-side), so both are null; `mode` is what
 * every element asks to tell the two states apart.
 */
export function reviewHydrationScript(
  assetId: string,
  i18n: Translator,
): string {
  return exerciseHydrationScript({
    mode: "review",
    options: {},
    priorAnswer: null,
    publicData: null,
    strings: exerciseStrings(assetId, i18n),
    version: EXERCISE_HYDRATION_VERSION,
  });
}
