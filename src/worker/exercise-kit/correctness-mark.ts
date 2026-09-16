/**
 * The correctness mark: the one place every exercise type says whether the work
 * is right.
 *
 * Before this, six of the nine types had their own answer to that. The four
 * proof types drew a bracketed `[✓]` — two of them at the right of the goal
 * line, two at the right of the editor toolbar — while the truth table and the
 * model turned a line of prose green and the three text types said nothing at
 * all. Same claim, four positions, three visual languages, and nothing to look
 * at until the claim came out true.
 *
 * So the mark is a single light-DOM element in the action bar. Living outside
 * every widget's shadow root is what makes "the same place" achievable at all:
 * the nine types share no internal layout, but they all end in that one row, and
 * one rule in `styles.ts` then describes the mark for all of them.
 *
 * Its own leaf module, for the reason `answer-events.ts` is one — the client
 * base class imports these as *values*, and a value import that reaches the
 * content document's escaping helpers drags that chain into every widget bundle.
 * The worker's renderer, the runtime script and all six widgets import from
 * here, which is the point: there is no second spelling of the glyph.
 */

/** The mark's element class, and the selector each writer finds it by. */
export const CORRECTNESS_MARK_CLASS = "exercise-mark";

/**
 * `idle` is what the mark shows until something says otherwise, and it is shown
 * rather than hidden: a reader who has not yet got an exercise right should
 * still know where the verdict appears, and a mark that pops into being would
 * reflow the button row under it.
 *
 * `working` belongs to the proof types, whose verdict comes from a compile that
 * takes a moment. `error` is *could not check* rather than *wrong* — today its
 * only cause is the WASM proof engine failing to load, and a widget that reaches
 * it says why in the mark's `title`. A wrong answer is `idle`: nothing has said
 * the work is right, which is all the mark ever claims.
 */
export type CorrectnessMarkState = "idle" | "working" | "ok" | "error";

/**
 * The glyph for each state that has one; `working` gets a spinner instead.
 *
 * The check is U+2713, drawn in the page's own UI font rather than in whatever
 * the surrounding widget happens to use — two of the six draw their marks in a
 * monospace toolbar, and the same codepoint in Fira Code is a visibly different
 * check. The brackets the proof types used to wrap it in are gone: they were
 * standing in for the outline the mark now actually has.
 */
export const CORRECTNESS_MARK_GLYPHS: Readonly<
  Record<Exclude<CorrectnessMarkState, "working">, string>
> = {
  error: "!",
  idle: "-",
  ok: "✓",
};

/**
 * Where each state's name is carried.
 *
 * The mark is a glyph, so it needs words: a text alternative for a reader who
 * cannot see it, and a tooltip for one who can see it but cannot tell a pale
 * green outline from a grey one, or is simply not sure what it is claiming. Both
 * come from the same string per state — the `aria-label` and the `title` say
 * the same thing, because they are the same thing.
 *
 * They live on the element rather than in each widget's string payload: the
 * widgets are separate bundles and the page runtime is a template literal, so
 * none of the writers can reach a translator, and four strings in six bundles
 * would be six copies of one translation. The server writes all four names onto
 * the mark it renders, and every writer reads them back off the element it is
 * already holding.
 *
 * `error` is the one state whose tooltip can beat its name: when a widget has a
 * specific complaint (the compiler's, usually) that goes in the `title` instead,
 * where it reads as the description of a mark already named "not correct".
 */
export const CORRECTNESS_MARK_LABEL_ATTRIBUTES: Readonly<
  Record<CorrectnessMarkState, string>
> = {
  error: "data-label-error",
  idle: "data-label-idle",
  ok: "data-label-ok",
  working: "data-label-working",
};
