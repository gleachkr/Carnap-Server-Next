/**
 * The small contract by which an interactive exercise element and the page
 * runtime that hosts it agree on what counts as unsaved work.
 *
 * Its own module, and a leaf one. `hydration.ts` is the natural home for a
 * client/worker contract, but it imports the content document's script-escaping
 * helper — and a *value* import from the client base class drags that whole
 * chain into every widget bundle, where a type-only import costs nothing. Two
 * names are all either side needs.
 *
 * The element decides, rather than the runtime reading the form: only the
 * element can tell an edit from a recomputation. The proof types compile a
 * certificate out of the proof text, asynchronously, so their serialized answer
 * changes on its own well after the page settles — a runtime comparing the
 * hidden field against what arrived would call that an edit and warn about
 * every reload of an answered exercise.
 */

/**
 * Set on an exercise element while the reader has changed its answer since the
 * last thing the server recorded. The runtime reads it to decide whether
 * leaving the page would lose work.
 */
export const UNSAVED_ANSWER_ATTRIBUTE = "data-unsaved";

/**
 * Dispatched by the runtime on an exercise form once its answer has actually
 * been recorded, so the element can take what it currently holds as the new
 * saved state. A checked-but-not-recorded answer gets no such event: nothing
 * was stored, so the work is still only in the browser.
 */
export const ANSWER_RECORDED_EVENT = "carnap:answer-recorded";
