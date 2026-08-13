import { THEORY_PANEL_STYLES } from "../exercises/aufbau-proof/theory-panel";
import { EXERCISE_GROUP_STYLES } from "../exercises/group";
import { MATH_FONT_HREF } from "./math-font";

/**
 * Styles come in two layers. CONTENT_STYLES carries everything that styles
 * authored content and exercise forms; it is shared between the app shell and
 * the standalone content documents served into iframes, so the two render
 * identically. CHROME_STYLES is app-shell only (navigation, sheets, tables of
 * records, dialogs).
 *
 * The split is what the two layers are *for*, and it is also what makes them
 * worth caching separately: a lesson page is two documents, and the shared
 * layer is then one download that serves both. See `./style-assets`, which
 * turns each into a hashed URL — nothing here is embedded in a page.
 */
export const CONTENT_STYLES = `
  /*
   * Every color in the application is one of these, and nothing outside this
   * block picks a color of its own: a rule elsewhere that wants a tint reaches
   * for color-mix over a token rather than respelling the token's channels at
   * an alpha. That is what lets a second palette be a second copy of this block
   * and nothing else — see the dark override at the end of the file.
   *
   * Shadow-DOM styles may write var(--token, <fallback>), because a content
   * document rendered with cssReset has no stylesheet of ours at all and the
   * fallback is then the widget's only color. Every such fallback must repeat
   * the light value here exactly; tests/a11y/tokens.test.ts enforces it, which
   * is what stops a stale fallback from pinning a light color under dark.
   */
  :root {
    /* Surfaces, from the ground the page sits on up to a control's own fill. */
    --paper: #f1eadf;
    --paper-top: #f5efe6;
    --surface: #fbf7ef;
    --surface-soft: #f8f2e8;
    /* The header and footer's fill, laid over content scrolling beneath. */
    --surface-translucent: color-mix(in srgb, var(--surface) 96%, transparent);
    /* A control's fill. The same value as --surface here, and its own token
       anyway: these seven uses mean "the thing you press", and in dark a
       control has to sit visibly off the sheet instead of dissolving into it.
       A token whose only sin is coinciding in one palette still earns its
       keep in the other. */
    --control-surface: #fbf7ef;
    --rule: #d8d0c3;
    --rule-soft: #e5ded3;
    --ink: #16324a;
    /* Clears WCAG AA 4.5:1 on --surface (4.58:1) and --paper-top, which is
       where nearly all secondary text sits. It does *not* clear it on the
       warmer fills — --surface-soft, --paper, --rule-soft — so muted text
       drawn on one of those reaches for --ink-muted-strong. */
    --ink-muted: #5f7388;
    /* --ink-muted for the warmer fills: same hue, dark enough for AA down to
       --rule-soft (4.9:1). Only for text that actually sits on one of them;
       used app-wide it reads as ordinary ink rather than as secondary. */
    --ink-muted-strong: #4d5f72;
    /* Decoration only — separators, a disclosure triangle. At ~2.8:1 on the
       lightest surface it is below AA, so nothing a reader has to read (or
       click) may be drawn in it; that is what --ink-muted is for. */
    --ink-faint: #8797a7;
    --blue: #0b66d8;
    /* The emphatic blue: a hover, a pressed state, an active nav item. Named
       for the emphasis and not for the lightness, because under a dark palette
       more emphasis means lighter rather than darker. */
    --blue-strong: #074f9f;
    --blue-soft: #eaf3ff;
    --green: #1b7048;
    --green-soft: #edf9f2;
    --red: #b42318;
    --red-soft: #fff0ed;
    --gold: #9a6400;
    --gold-soft: #fff7df;
    /* Text drawn on a filled accent — a pressed chip, a selected option. */
    --on-accent: #ffffff;
    /* What a dialog casts, at whatever alpha the rule wants. Its own token
       rather than --ink at an alpha: a shadow has to deepen under a dark
       palette, where the ink is nearly white and would lift it instead. */
    --shadow-color: #102235;
    /* The faint wash of colour up in the page's top right. Whole-colour rather
       than an alpha applied at the use site, because how much of it reads is a
       property of the ground it lies on and so belongs to the palette. */
    --body-glow: color-mix(in srgb, var(--blue) 5.5%, transparent);
    /* The scope lines a Fitch proof draws down its subproofs. Relative to the
       text it accompanies, so it follows the palette on its own; an instructor
       theme can still override it outright. */
    --fitch-scope: color-mix(in srgb, currentColor 72%, transparent);
    --logo-font: "EB Garamond", Garamond, "Iowan Old Style", Georgia, serif;
    --body-font: Inter, ui-sans-serif, system-ui, -apple-system,
      BlinkMacSystemFont, "Segoe UI", sans-serif;
    /* Horizontal padding shared by the header, page shell, and footer, so
       their content edges align. */
    --shell-gutter: clamp(1.25rem, 4vw, 3.75rem);
    /* How wide a page's content actually gets: the shell's cap less its two
       gutters. Anything that has to line up with an ordinary page's measure
       reaches for this — the breadcrumb above the split columns, and the
       standalone content document, which has no shell to sit inside. */
    --page-measure: calc(85rem - 2 * var(--shell-gutter));
    color-scheme: light;
  }

  /*
   * The same sheet at night. Only the colours are redeclared — every rule in
   * both layers already reads through the tokens, so this block is the whole
   * of dark mode, and it reaches the app shell, the standalone content
   * document (which links this stylesheet and evaluates the query itself), and
   * the exercise widgets' shadow roots (custom properties cross that boundary)
   * without any of them knowing a second palette exists.
   *
   * Warm charcoal rather than a neutral or an inversion: the light palette's
   * subject is paper, and paper in a dark room is warm and dim, not grey. The
   * ratios are tuned to sit near the light palette's rather than as far from
   * the ground as they will go — --ink-muted lands at 4.76:1 on the lightest
   * ground it may be drawn on, against 4.58:1 in light, because muted text
   * that clears AA comfortably stops reading as muted. tests/a11y/contrast.ts
   * holds every one of these pairings.
   *
   * Two tokens invert outright, which is the whole reason each has a name
   * rather than a value: --on-accent goes dark, because an accent light enough
   * to read on charcoal cannot also carry white text; and --shadow-color goes
   * to black, because a shadow derived from the ink would be a highlight here.
   */
  @media (prefers-color-scheme: dark) {
    :root {
      /* Stacked as in light: --surface-soft is the recessed fill, so it stays
         a step *below* the sheet, and --control-surface the raised one — which
         in light coincides with --surface and here is what keeps a button from
         dissolving into the sheet it sits on. */
      --paper: #17140f;
      --paper-top: #1d1913;
      --surface-soft: #1e1a13;
      --surface: #221d16;
      --control-surface: #2a241b;
      --rule: #3d352a;
      --rule-soft: #2e281f;
      --ink: #e9e1d3;
      --ink-muted: #988e7e;
      --ink-muted-strong: #aca291;
      --ink-faint: #6e6557;
      --blue: #5b9bef;
      --blue-strong: #8fbcff;
      --blue-soft: #16273d;
      --green: #46b87c;
      --green-soft: #12281d;
      --red: #f58a7c;
      --red-soft: #2e1815;
      --gold: #c9a043;
      --gold-soft: #2b2110;
      --on-accent: #17140f;
      --shadow-color: #000000;
      /* Carries further on a dark ground than the same wash does on cream,
         but starts from so much less light that it needs the extra to read
         at all. */
      --body-glow: color-mix(in srgb, var(--blue) 9%, transparent);
      color-scheme: dark;
    }
  }

  * {
    box-sizing: border-box;
  }

  a {
    color: var(--blue);
    text-decoration: none;
  }

  a:hover {
    color: var(--blue-strong);
    text-decoration: underline;
    text-underline-offset: 0.18em;
  }

  h1,
  h2,
  h3,
  p {
    margin-top: 0;
  }

  h2 {
    font-size: 1.2rem;
    letter-spacing: -0.015em;
    line-height: 1.25;
    margin-bottom: 0.8rem;
  }

  h3 {
    font-size: 0.96rem;
    margin-bottom: 0.45rem;
  }

  :focus-visible {
    outline: 3px solid color-mix(in srgb, var(--blue) 30%, transparent);
    outline-offset: 3px;
  }

  /* Buttons and controls */

  button,
  .button {
    align-items: center;
    background: var(--control-surface);
    border: 1px solid var(--blue);
    border-radius: 4px;
    color: var(--blue);
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    font-weight: 650;
    gap: 0.45rem;
    justify-content: center;
    min-height: 42px;
    padding: 0.6rem 1.15rem;
    text-decoration: none;
    white-space: nowrap;
  }

  button:hover,
  .button:hover {
    background: var(--blue-soft);
    color: var(--blue-strong);
    text-decoration: none;
  }

  /* A control that is on screen to show the shape of things but cannot be worked
     — the preview's submit above all. Without a rule of its own it is drawn
     exactly like a live button, because the colour set above overrides the grey
     a browser would otherwise apply, and the only way to learn it is dead is to
     press it. The faint ink is deliberate: a disabled control is exempt from the
     contrast minimum, and reading as unavailable is the whole point.

     A hover state does not match a disabled form control, so none of the hover
     rules below need to win this back. */
  button:disabled,
  .button:disabled {
    background: var(--surface-soft);
    border-color: var(--rule);
    color: var(--ink-faint);
    cursor: not-allowed;
  }

  /* .secondary is retained as an alias for the default light button so
     existing markup keeps working; the two are intentionally identical. */

  button.ghost,
  .button.ghost {
    background: transparent;
    border-color: var(--rule);
    color: var(--ink);
  }

  button.danger,
  .button.danger {
    background: transparent;
    border-color: color-mix(in srgb, var(--red) 50%, transparent);
    color: var(--red);
  }

  button.ghost:hover,
  .button.ghost:hover {
    border-color: var(--blue);
    color: var(--blue);
    filter: none;
  }

  button.danger:hover,
  .button.danger:hover {
    background: var(--red-soft);
    border-color: var(--red);
    color: var(--red);
    filter: none;
  }


  input,
  select,
  textarea {
    background: var(--control-surface);
    border: 1px solid var(--rule);
    border-radius: 4px;
    color: var(--ink);
    font: inherit;
    padding: 0.55rem 0.65rem;
    width: 100%;
  }

  input:focus,
  select:focus,
  textarea:focus {
    border-color: var(--blue);
  }

  /* Growing a field taller is fine; dragging it wider breaks the form's
     layout, so the handle only moves vertically. */
  textarea {
    resize: vertical;
  }

  /* Checkboxes are inline controls: the full-width block treatment above
     would stretch and misplace them inside their label text. */
  input[type="checkbox"] {
    accent-color: var(--blue);
    margin-right: 0.45rem;
    width: auto;
  }

  input[type="hidden"] {
    display: none;
  }

  /* The browser's date/time control is exactly as wide as the reader's own
     locale format makes it — "07/31/2026, 11:59 PM" needs more room than
     "31.07.2026, 23:59" — and a field too narrow for its value does not
     shrink the text or show that anything is missing: it silently scrolls the
     tail, the AM/PM marker, out of sight. So the control is never squeezed
     below its intrinsic width; a tight row wraps or grows instead. */
  input[type="datetime-local"] {
    min-width: min-content;
  }

  /* A prefilled-but-immutable field: legible, but visibly not for editing. The
     --rule-soft fill is the darkest surface in the palette, so this is the
     --ink-muted-strong case (plain --ink-muted is only 3.66:1 here). */
  input[readonly] {
    background: var(--rule-soft);
    color: var(--ink-muted-strong);
  }

  input[readonly]:focus {
    border-color: var(--rule);
  }

  label {
    color: var(--ink);
    display: block;
    font-size: 0.9rem;
    font-weight: 560;
  }

  label + label,
  form > label {
    margin-top: 0.9rem;
  }

  form button,
  form .button {
    margin-top: 1.1rem;
  }

  fieldset {
    border: 1px solid var(--rule-soft);
    border-radius: 4px;
    margin: 1rem 0 0;
    padding: 0.5rem 1rem 1rem;
  }

  legend {
    color: var(--ink-muted);
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 0 0.4rem;
    text-transform: uppercase;
  }

  /* Tables (ledger styling) */

  table {
    border-collapse: collapse;
    width: 100%;
  }

  th,
  td {
    border-bottom: 1px solid var(--rule-soft);
    padding: 0.82rem 0.95rem;
    text-align: left;
    vertical-align: top;
  }

  tr:last-child td {
    border-bottom: 0;
  }

  th {
    color: var(--ink-muted);
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  td:first-child,
  th:first-child {
    padding-left: 0;
  }

  td:last-child,
  th:last-child {
    padding-right: 0;
  }

  td a {
    font-weight: 600;
  }

  /* Tables carry a content-driven minimum width (one column per gradebook
     assignment, long endpoint URLs, …) that can exceed a narrow sheet. The
     sheet clips its overflow, so wrap the table in a scroller: it fills the
     sheet on wide screens and scrolls sideways instead of hiding columns on a
     phone. */
  .table-scroll {
    overflow-x: auto;
  }

  /* The admin audit log is one event per *pair* of rows: the four fields anyone
     scans by, then a full-width line carrying the request id and — behind a
     disclosure, when the event recorded any — its metadata. So the rule that
     divides events goes after the pair rather than through the middle of one,
     and the detail line sits tight under the row it belongs to. */

  .audit-event td {
    border-bottom: 0;
    padding-bottom: 0.3rem;
  }

  .audit-event-detail td {
    padding-top: 0;
  }

  /* Indented by exactly the drawn marker below, so the id starts in the same
     place whether or not the event recorded metadata to disclose. */
  .audit-request {
    color: var(--ink-muted);
    margin: 0;
    padding-left: 0.85rem;
  }

  .audit-request > summary {
    cursor: pointer;
    list-style: none;
    /* Only the text is the hit target; a summary left to fill the row would
       make the whole line clickable with nothing to say so. */
    width: fit-content;
  }

  .audit-request > summary:hover {
    color: var(--ink);
  }

  /* The triangle is drawn rather than left to the browser: the native marker's
     box is a different width in every engine, so a metadata-less event would
     sit a few pixels off from the rows around it. Borders rather than a glyph
     because generated text joins the summary's accessible name, and "black
     right-pointing small triangle" is not part of it. */

  .audit-request > summary::-webkit-details-marker {
    display: none;
  }

  .audit-request > summary::before {
    border: 0.3rem solid transparent;
    border-left-color: currentcolor;
    content: "";
    display: inline-block;
    height: 0;
    margin: 0 0.25rem 0 -0.85rem;
    vertical-align: 0.04rem;
    width: 0;
  }

  .audit-request[open] > summary::before {
    transform: rotate(90deg);
  }

  .audit-request pre {
    margin: 0.55rem 0 0;
  }

  /* Code, inline and in blocks: a lesson quoting a directive, a worked proof
     shown as text, the app shell's own source listings. Fira Code is already
     loaded for the editor's source field, so the same face carries here.
     Ligatures are off for the same reason it is there: a lesson writing an
     arrow or a turnstile in ascii must show the characters the author typed,
     not a glyph standing in for them. Monospace runs wider than the body face
     at one nominal size, so the notch down keeps a full line of source on
     screen — and both sizes are in rem, so a code element inside a pre does
     not shrink twice. */
  code,
  pre {
    font-family: "Fira Code", ui-monospace, monospace;
    font-size: 0.9rem;
    font-variant-ligatures: none;
  }

  /* A block reads as a quoted slab of source: the same soft fill and hairline
     the answer-review box uses, so content and chrome agree. Lines are long and
     must not be re-flowed, so they scroll sideways rather than being clipped by
     the sheet. */
  pre {
    background: var(--surface-soft);
    border: 1px solid var(--rule-soft);
    border-radius: 4px;
    line-height: 1.45;
    overflow-x: auto;
    padding: 0.7rem 0.85rem;
  }

  /* Mathematics. The compiler stores formulas as MathML, which the browser
     lays out itself — but only well if it is given a font carrying an OpenType
     MATH table, and no platform reliably has one. See ./math-font, which is
     also where an instructor is pointed to override this. The generic 'math'
     family is the fallback: on a machine that does have such a font installed
     it is the right one, and on one that does not, nothing else would help. */
  @font-face {
    font-display: swap;
    font-family: "STIX Two Math";
    src: url("${MATH_FONT_HREF}") format("woff2");
  }

  math {
    font-family: "STIX Two Math", math;
  }

  /* MathML Core does not break a long equation across lines — there is no
     property that asks it to — so a displayed one that outgrows the measure
     scrolls on its own rather than widening the page. A reader on a phone
     otherwise gets a document that pans sideways. */
  math[display="block"] {
    margin: 1.1rem 0;
    overflow-x: auto;
    overflow-y: hidden;
  }

  /* Exercise and submission review surfaces */

  .exercise {
    margin-bottom: 1.1rem;
  }

  .exercise + .exercise {
    margin-top: 1rem;
  }

  /* A submitted answer, as the grader or the student reviews it: a soft box
     of labeled values (selected options, response text, the correct answer
     for instructors). */

  .answer-review {
    background: var(--surface-soft);
    border: 1px solid var(--rule-soft);
    border-radius: 4px;
    padding: 0.85rem 1rem;
  }

  .answer-review p {
    margin: 0;
  }

  .answer-review dl {
    display: grid;
    gap: 0.45rem 1.25rem;
    grid-template-columns: max-content 1fr;
    margin: 0;
  }

  .answer-review dt {
    color: var(--ink-muted);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    padding-top: 0.14rem;
    text-transform: uppercase;
  }

  .answer-review dd {
    margin: 0;
    white-space: pre-wrap;
  }

  ${EXERCISE_GROUP_STYLES}

  .exercise-prompt {
    font-weight: 560;
    margin-bottom: 0.75rem;
  }

  /* A note cited from a prompt is reference apparatus, not more of the
     question: without this it inherits the prompt's weight and reads as part of
     what is being asked. */
  .exercise-prompt .footnotes {
    font-weight: normal;
  }

  .exercise-status,
  .exercise-rubric {
    color: var(--ink-muted);
    font-size: 0.82rem;
    margin-top: 0.6rem;
  }

  /* The action bar an interactive exercise projects into its shadow card via
     slot="exercise-actions". Every control — Check, counterexample, Submit —
     sits in one light-DOM row so author CSS styles them all uniformly. Its box
     is styled here (not from a shadow ::slotted rule) precisely so custom CSS
     can reach it. */
  .exercise-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.8rem;
    margin-top: 0.45rem;
  }

  /* The action buttons: quiet and small, so they read as part of the exercise
     rather than page-level calls to action. The warm rule border keeps them
     recessive until hover brings the blue forward. */
  .exercise-submit,
  .exercise-actions button {
    border-color: var(--rule);
    font-size: 0.82rem;
    font-weight: 600;
    min-height: 0;
    padding: 0.32rem 0.85rem;
  }

  .exercise-submit:hover,
  .exercise-actions button:hover {
    background: var(--blue-soft);
    border-color: var(--blue);
    color: var(--blue-strong);
  }

  /* The base form-button margin-top would push controls down inside the bar's
     flex row; the bar owns its own spacing above itself instead. */
  .exercise-actions button {
    margin-top: 0;
  }

  /* The instructions button, first in the row. It used to be a round pill in each
     widget's own toolbar; it is a plain button here, the same shape and height as
     Check and Submit beside it, because it is one of the exercise's controls and
     not a badge stuck to the side of one.

     Only the horizontal padding is its own: the glyph is a single character, so
     the row's full side padding would leave it swimming. Nothing vertical is set
     here — a padding shorthand, or a tighter line height, would make it the one
     short button in the row, which is exactly what it must not be. */
  .exercise-actions .help-trigger {
    padding-left: 0.6rem;
    padding-right: 0.6rem;
  }

  /* The submission status sits inline with the buttons. */
  .exercise-actions .exercise-status {
    margin: 0;
  }

  /* The truth-table Check status drops onto its own line under the button row. */
  .exercise-actions .tt-check-status {
    flex-basis: 100%;
    margin: 0.1rem 0 0;
  }

  .exercise-actions .tt-check-status[data-state="correct"] {
    color: var(--green, #1b7048);
    font-weight: 600;
  }

  /* The counterexample toggle, pressed. */
  .exercise-actions .tt-ce[aria-pressed="true"] {
    border-color: var(--blue);
    border-width: 2px;
  }

  /* The correctness mark: one indicator, in one place, in one shape, for every
     exercise type. It is deliberately present from the first paint rather than
     appearing when there is something to say — a reader who has never seen a
     correct exercise should still know where the verdict will show up, and an
     indicator that materializes out of nothing also reflows the row it is in.
     So the idle state is a grey dash rather than an empty box.

     It lives in the light-DOM action bar, not in each widget's shadow root,
     which is what makes "the same place" true across nine types that otherwise
     share no layout at all — and means this rule is the only description of it.

     Two things write to it and they answer different questions. The runtime
     sets it from the recorded evaluation (on load, and after each submit): is
     the answer the server holds correct? A widget that can grade itself in the
     browser overrides that with its own live verdict: is what is on screen
     right now correct? The live answer wins whenever there is one, because it
     is the one about the work the reader is looking at. */
  .exercise-mark {
    align-items: center;
    border: 1px solid var(--rule);
    border-radius: 999px;
    color: var(--ink-muted);
    display: inline-flex;
    flex: none;
    /* Named rather than inherited: the mark sits in a monospace toolbar in two
       of the widgets and beside a serif prompt in the others, and the glyph has
       to be the same glyph in all of them. */
    font-family: system-ui, sans-serif;
    font-size: 0.85rem;
    font-weight: 700;
    justify-content: center;
    line-height: 1;
    /* Hard right of the button row, so it is in the same place whether the row
       holds one button or three. */
    margin-left: auto;
    min-height: 1.5rem;
    min-width: 1.9rem;
  }

  .exercise-mark[data-state="ok"] {
    background: var(--green-soft);
    border-color: color-mix(in srgb, var(--green) 45%, transparent);
    color: var(--green);
  }

  .exercise-mark[data-state="error"] {
    background: var(--red-soft);
    border-color: color-mix(in srgb, var(--red) 40%, transparent);
    color: var(--red);
    /* The specific problem is the title; the cursor is what says to hover. */
    cursor: help;
  }

  /* "Checking": the proof types compile in the background, and the wait is long
     enough to need saying. Drawn here rather than built as an SVG in the client,
     so setting the mark stays a matter of writing attributes. */
  .exercise-mark[data-state="working"]::after {
    animation: exercise-spin 0.7s linear infinite;
    border: 2px solid currentColor;
    border-radius: 50%;
    border-top-color: transparent;
    content: "";
    display: block;
    height: 0.8rem;
    opacity: 0.7;
    width: 0.8rem;
  }

  @keyframes exercise-spin {
    to { transform: rotate(1turn); }
  }

  @media (prefers-reduced-motion: reduce) {
    .exercise-mark[data-state="working"]::after {
      animation-duration: 2.5s;
    }
  }

${THEORY_PANEL_STYLES}

  /* Shown when an interactive exercise's bundle fails to upgrade it in time. */
  .exercise-load-error {
    color: var(--red);
    font-size: 0.85rem;
    margin-top: 0.6rem;
  }

  /* Formulas */

  .formula,
  .proof-formula {
    font-family: Georgia, "Times New Roman", serif;
    font-style: italic;
  }

  /* Utilities */

  .small {
    color: var(--ink-muted);
    font-size: 0.82rem;
    line-height: 1.45;
  }

  .muted {
    color: var(--ink-muted);
  }

  .visually-hidden {
    border: 0;
    clip: rect(0 0 0 0);
    height: 1px;
    margin: -1px;
    overflow: hidden;
    padding: 0;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }
`;

export const CHROME_STYLES = `
  html {
    background: var(--paper);
  }

  body {
    background:
      radial-gradient(circle at 76% 18%, var(--body-glow), transparent 25rem),
      linear-gradient(180deg, var(--paper-top) 0%, var(--paper) 100%);
    color: var(--ink);
    display: flex;
    flex-direction: column;
    font: 16px/1.5 var(--body-font);
    margin: 0;
    min-height: 100vh;
  }

  /* Lay related fields side by side on wide viewports instead of stacking
     every full-width input. Collapses to a single column when narrow.
     auto-fill (not auto-fit) keeps empty tracks, so a row with fewer fields
     than columns gets ordinary-width fields, not stretched ones. */
  .field-grid {
    display: grid;
    gap: 0.9rem 1rem;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  }

  /* A column-flex cell keeps the input on the cell's bottom edge, so inputs
     across a row line up even when one label wraps to a second line. */
  .field-grid > label,
  .field-grid > label + label {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    margin-top: 0;
  }

  .field-grid + label,
  label + .field-grid {
    margin-top: 0.9rem;
  }

  /* For fields whose values are real text (titles, revision names) rather
     than numbers or dates: fewer, wider columns. */
  .field-grid.wide-fields {
    grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
  }

  /* For a schedule: a track wide enough to hold a whole date and time, so the
     columns land above the control's own width rather than at it. Without
     this the tracks can settle near their 12rem floor, and a datetime field
     held to its min-content width would then spill over its neighbour. */
  .field-grid.time-fields {
    grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
  }

  /* A field another control has switched off — the schedule date under a
     grade-visibility choice that does not use it. Drawn like a disabled button
     for the same reason: without a rule of its own it keeps the live field's
     white fill, and the only way to learn it is inert is to click into it. The
     faint ink is deliberate; a disabled control is exempt from the contrast
     minimum, and reading as unavailable is the whole point.

     Chrome only. The same base rule in CONTENT_STYLES would reach the disabled
     inputs an exercise preview renders, where the text is the student's work
     and has to stay legible. */
  input:disabled {
    background: var(--surface-soft);
    border-color: var(--rule);
    color: var(--ink-faint);
    cursor: not-allowed;
  }

  /* A submit button placed as the last grid item lands in the grid's last
     column — the right edge of the row it wraps onto — bottom-aligned with
     the inputs rather than the labels above them. */
  .field-grid > button {
    align-self: end;
    grid-column-end: -1;
    justify-self: end;
    margin: 0;
  }

  /* Compact buttons for dense rows: tables, inline forms, record headline. */
  .create-bar button,
  .record-headline button {
    font-size: 0.85rem;
    min-height: 0;
    padding: 0.4rem 0.8rem;
    margin: 0;
  }

  /* Buttons in a cell are compact: an icon, or a short inline action that has
     to sit in a row without stretching it. A modal dialog rendered inside a
     cell (the members roster keeps each row's dialogs beside their triggers)
     is not in the table as far as the reader is concerned — it is in the top
     layer — so its buttons keep the ordinary chrome. The exclusion is wrapped
     in :where() so it adds no specificity: a bare :not() takes its argument's,
     which would outrank .icon-button and flatten the icons this rule is for. */
  table button:not(:where(.modal-dialog button)) {
    min-height: 0;
    padding: 0;
    margin: 0;
    border: none;
  }

  /* Application header and shell */

  .app-header {
    align-items: center;
    border-bottom: 1px solid var(--rule);
    display: flex;
    flex-wrap: nowrap;
    gap: clamp(1rem, 4vw, 3rem);
    margin: 0 auto;
    max-width: 85rem;
    padding: 1.5rem var(--shell-gutter);
    width: 100%;
  }

  .noscript-banner {
    background: var(--gold-soft);
    border-bottom: 1px solid var(--gold);
    color: var(--gold);
    font-weight: 600;
    padding: 0.85rem var(--shell-gutter);
    text-align: center;
  }

  .brand {
    align-items: baseline;
    color: var(--ink);
    display: inline-flex;
    flex: 0 0 auto;
    font-family: var(--logo-font);
    font-size: clamp(2rem, 4vw, 2.85rem);
    gap: 0.58rem;
    letter-spacing: -0.045em;
    line-height: 1;
    text-decoration: none;
  }

  .brand:hover {
    color: var(--ink);
    text-decoration: none;
  }

  .brand-mark {
    color: var(--blue);
    display: inline-block;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 0.92em;
    font-weight: 400;
    line-height: 0.9;
    transform: translateY(-0.02em);
  }

  .app-nav {
    align-items: center;
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    gap: clamp(1rem, 3vw, 2.4rem);
    min-width: 0;
  }

  .app-nav a {
    color: var(--ink);
    font-size: 0.96rem;
    font-weight: 560;
    text-decoration: none;
  }

  .app-nav a:hover {
    color: var(--blue);
  }

  .nav-action {
    color: var(--blue) !important;
  }

  .nav-divider {
    align-self: center;
    background: var(--rule);
    flex: 0 0 auto;
    height: 1.5rem;
    width: 1px;
  }

  .nav-profile {
    color: var(--ink);
    flex: 0 0 auto;
    font-size: 0.96rem;
    font-weight: 620;
    text-decoration: none;
  }

  .nav-profile:hover {
    color: var(--blue);
  }

  /* The read-only account facts sit below the edit form, divided from it by a
     rule with breathing room on both sides. Drop the strip's trailing rule,
     which otherwise reads as a stray line above the footer. */
  .profile-sheet .summary-strip {
    border-bottom: none;
    border-top: 1px solid var(--rule);
    margin-top: 1rem;
  }

  .logout-form {
    margin: 0;
    text-align: right;
  }

  /* Quiet styling; the sheet-footer default supplies the compact size. */
  .logout-form button {
    background: transparent;
    border-color: var(--rule);
    color: var(--ink);
    font-weight: 560;
  }

  .logout-form button:hover {
    border-color: var(--blue);
    color: var(--blue);
    filter: none;
  }

  .page-shell {
    /* Grow to absorb any leftover viewport height so the footer is pinned to
       the bottom on short pages, while long content still pushes it below the
       fold. Width is centered by the auto margins as before. */
    flex: 1 0 auto;
    margin: 0 auto;
    max-width: 85rem;
    padding: 0.75rem var(--shell-gutter) 4rem;
    width: 100%;
  }

  /* Pages without a breadcrumb keep the roomier top spacing. The second
     selector is the same rule for a page the profile prompt has pushed down:
     without it, the strip's presence would silently take that spacing away. */
  .page-shell > .page-content:first-child,
  .profile-prompt + .page-content {
    margin-top: 2rem;
  }

  /* Asks a signed-in reader for what their account is still missing. Drawn as
     a notice rather than as a banner across the window, because it belongs to
     the content column and not to the app chrome: it is a request, and one the
     reader may decline. */
  .profile-prompt {
    align-items: center;
    background: var(--blue-soft);
    border: 1px solid color-mix(in srgb, var(--blue) 22%, transparent);
    border-radius: 4px;
    color: var(--blue-strong);
    display: flex;
    flex-wrap: wrap;
    font-size: 0.92rem;
    gap: 0.75rem 1.25rem;
    justify-content: space-between;
    margin-bottom: 1.75rem;
    padding: 0.7rem 1rem;
  }

  /* Enough to keep the sentence from being squeezed to one word per line when
     the two controls are on the same row, and — being a minimum rather than a
     width — what makes the row break in two before that can happen. */
  .profile-prompt p {
    flex: 1 1 18rem;
    margin: 0;
  }

  .profile-prompt-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  /* This form is a wrapper around one button, not a stack of fields, so it
     wants neither of the two things an ordinary form gives its submit. Flex,
     because a block form would put its inline-level button on a baseline and
     inherit the line box's leading; and no top margin, because the 1.1rem that
     separates a submit from the labels above it has nothing above it here.

     That margin is what the misalignment actually was: it made the form 61px
     tall around a 43px button and left the button sitting 9px below the link
     beside it — which centring the row could not correct, since the box being
     centred was the right height and the button inside it was not. */
  .profile-prompt-actions form {
    display: flex;
    margin: 0;
  }

  .profile-prompt-actions form button {
    margin-top: 0;
  }

  /* The strip is already a tinted panel, so the quieter control drops its own
     fill and reads against that instead of stacking a second surface on it. */
  .profile-prompt-actions .ghost {
    border-color: color-mix(in srgb, var(--blue) 30%, transparent);
    color: var(--blue-strong);
  }

  .profile-prompt-actions .ghost:hover {
    background: color-mix(in srgb, var(--blue) 12%, transparent);
  }


  .breadcrumb {
    align-items: baseline;
    color: var(--ink-muted);
    display: flex;
    flex-wrap: wrap;
    font-size: 0.92rem;
    gap: 0.4rem 0.55rem;
    letter-spacing: 0.005em;
    margin-bottom: 2.75rem;
  }

  .breadcrumb-link {
    color: var(--ink-muted);
    text-decoration: none;
  }

  .breadcrumb-link:hover {
    color: var(--blue);
    text-decoration: underline;
  }

  .breadcrumb-sep {
    color: var(--ink-faint);
  }

  .breadcrumb-current {
    color: var(--ink);
    font-weight: 560;
  }

  .page-content {
    display: grid;
    /* A single-column grid with no explicit track is an implicit auto column,
       which sizes to its content's min-content and can overflow the viewport
       (a wide table or long value in a sheet drags the whole column past the
       screen edge on a phone). Pinning the track to minmax(0, 1fr) caps it at
       the container width so wide content wraps or scrolls within its sheet. */
    gap: 1.75rem;
    grid-template-columns: minmax(0, 1fr);
  }

  /* Sheets */

  .sheet {
    background: var(--surface-translucent);
    border: 1px solid var(--rule);
    border-radius: 4px;
    overflow: hidden;
  }

  .sheet-header,
  .sheet-section {
    padding: 1.25rem clamp(1rem, 2vw, 1.5rem);
  }

  .sheet-header {
    align-items: start;
    background: linear-gradient(180deg, var(--surface), var(--surface-soft));
    border-bottom: 1px solid var(--rule);
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }

  .sheet-header h2 {
    margin-bottom: 0.3rem;
  }

  .sheet-header .small {
    margin: 0;
  }

  .sheet-section + .sheet-section {
    border-top: 1px solid var(--rule);
  }

  /* A sheet that is a disclosure: its header is the summary, so a closed
     drawer still reads as one of the page's cards rather than as a stray link.
     The triangle is drawn rather than left to the UA marker, which a flex
     summary suppresses anyway, and drawn with borders rather than a glyph
     because generated text would join the summary's accessible name. */

  .archived-sheet > summary {
    align-items: center;
    cursor: pointer;
    list-style: none;
  }

  .archived-sheet > summary::-webkit-details-marker {
    display: none;
  }

  /* Closed, the header's rule would sit on the sheet's own bottom border. */
  .archived-sheet:not([open]) > summary {
    border-bottom: 0;
  }

  .archived-sheet > summary h2 {
    margin-bottom: 0;
  }

  .archived-sheet > summary h2::before {
    border: 0.3rem solid transparent;
    border-left-color: currentcolor;
    content: "";
    display: inline-block;
    height: 0;
    margin-right: 0.45rem;
    width: 0;
  }

  .archived-sheet[open] > summary h2::before {
    transform: rotate(90deg);
  }

  .archived-sheet .sheet-section > .small {
    margin-top: 0;
  }

  .section-title {
    align-items: baseline;
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
    margin-bottom: 0.8rem;
  }

  /* Summary strips */

  /* The cells self-arrange into however many columns the width affords, so a
     strip can render as one row, one column, or an in-between grid. Rather than
     draw dividers with per-cell borders — which follow source order, not grid
     position, and so leave a stray line on the first cell of a wrapped row and
     none between rows — the 1px gap does the work: the rule colour is painted on
     the strip's content box (never its padding) and each cell paints over its
     own track, so the rule shows through only the interior gaps, in whichever
     directions cells actually neighbour, at any column count. Flex-wrap (not a
     uniform grid) is what keeps this clean on a partial last row: the cells grow
     to fill each row, so no phantom empty track is left showing the rule colour
     as a solid block. */
  .summary-strip {
    background: var(--rule-soft);
    background-clip: content-box;
    border-bottom: 1px solid var(--rule);
    display: flex;
    flex-wrap: wrap;
    gap: 1px;
    margin: 0;
    padding: 1.25em
  }

  .summary-item {
    background: var(--surface-translucent);
    display: flex;
    flex: 1 1 9rem;
    flex-direction: column-reverse;
    gap: 0.2rem;
    padding: 1rem clamp(0.85rem, 1.4vw, 1.1rem);
  }

  .summary-item dd {
    font-family: var(--logo-font);
    font-size: 1.65rem;
    font-weight: 500;
    line-height: 1.1;
    margin: 0;
  }

  .summary-item dt {
    color: var(--ink-muted);
    font-size: 0.8rem;
  }

  /* A localized date carries far more characters than the short stat values the
     big display serif is meant for, and at that size a full "month day, year,
     time" wraps to two or three lines and stretches every cell in the strip to
     match. The font stays uniform with the other stats; instead a script (see
     the layout) measures each cell and picks the longest date representation
     that fits on one line, dropping the time and then abbreviating as needed. */
  .summary-item dd time {
    white-space: nowrap;
  }

  /* Email + account-status row on the admin user record */
  .record-headline {
    align-items: center;
    border-bottom: 1px solid var(--rule);
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }

  .record-headline .summary-strip {
    border-bottom: none;
    flex: 1 1 auto;
  }

  .record-headline > form {
    margin: 0;
    padding-right: clamp(1rem, 2vw, 1.5rem);
  }

  /* Status badges */

  .status-badge {
    align-items: center;
    background: var(--surface-soft);
    border: 1px solid var(--rule);
    border-radius: 999px;
    color: var(--ink-muted);
    display: inline-flex;
    font-size: 0.76rem;
    font-weight: 700;
    gap: 0.35rem;
    padding: 0.24rem 0.6rem;
    white-space: nowrap;
  }

  /* Each badge's border is its own accent, gone faint. Mixed from the token
     rather than written out at an alpha, so it tracks the accent when the
     accent moves — the green here had been left behind at the pre-AA
     #26935d after --green was darkened to #1b7048. */

  .status-badge-ok {
    background: var(--green-soft);
    border-color: color-mix(in srgb, var(--green) 28%, transparent);
    color: var(--green);
  }

  .status-badge-warn {
    background: var(--gold-soft);
    border-color: color-mix(in srgb, var(--gold) 25%, transparent);
    color: var(--gold);
  }

  .status-badge-danger {
    background: var(--red-soft);
    border-color: color-mix(in srgb, var(--red) 24%, transparent);
    color: var(--red);
  }

  .status-badge-neutral {
    background: var(--blue-soft);
    border-color: color-mix(in srgb, var(--blue) 28%, transparent);
    color: var(--blue-strong);
  }

  /* A closed assignment lingers, greyed, for reference; any link it still
     carries (e.g. released results) keeps its normal styling. */
  tr.assignment-closed td {
    color: var(--ink-muted);
  }

  /* A practice/reading score: recorded for the student's own signal, muted to
     set it apart from graded scores that count toward the course total. */
  a.score-uncounted {
    color: var(--ink-muted);
  }

  /* Sheet footer create bars */

  .sheet-footer {
    background: var(--surface-soft);
    border-top: 1px solid var(--rule);
    padding: 1rem clamp(1rem, 2vw, 1.5rem);
  }

  /* Footers hold secondary actions, not primary content: every button in a
     sheet footer defaults to the compact dense-row size. */
  .sheet-footer button,
  .sheet-footer .button {
    font-size: 0.85rem;
    margin: 0;
    min-height: 0;
    padding: 0.4rem 0.8rem;
  }

  /* A band of navigation links echoing the summary strip: cells of a bold label
     over a muted hint, each a whole clickable link, split by hairline dividers.
     It sits at the foot of a sheet body, divided from the content above by a top
     rule with generous breathing room on both sides — so the horizontal line
     floats free of the vertical dividers, a softer "lines on paper" look than a
     flush edge-to-edge grid. Dividers are drawn the same way as the summary
     strip: a 1px gap over a rule-coloured content box, each cell painting its
     own track, so the rule shows only between neighbouring cells — vertically in
     one row, horizontally once the band wraps — with no stray line on a wrapped
     row's first cell. Cell backgrounds match the sheet, so the band keeps its
     boxless, flush look; only the hairlines are new. The content-box paint stops
     short of the top padding, leaving the top rule floating free as before.

     The band bleeds past the section's side padding by exactly that padding —
     the negative side margins cancel it, since a cell's own horizontal padding
     is the same clamp — so each cell sits flush to the sheet edge while its text
     is pushed back onto the body text column. That is what keeps every row's
     first cell aligned with the text above: not just the source-order first
     cell (which a :first-child rule could reach) but the first cell of each
     wrapped row too, which no selector can. The last cell's text lands on the
     column's right edge by the same measure. */
  .link-strip {
    background: var(--rule-soft);
    background-clip: content-box;
    border-top: 1px solid var(--rule);
    display: flex;
    flex-wrap: wrap;
    gap: 1px;
    margin: 2rem calc(-1 * clamp(1rem, 2vw, 1.5rem)) 0;
    padding-top: 1.25rem;
  }

  /* A strip that opens a sheet's body has nothing above it to be divided from,
     so it drops the rule and the space meant to hold that rule clear. Without
     this it renders as an empty band under the header — which is what a sheet
     whose whole body is its links looks like. */
  .sheet-section > .link-strip:first-child {
    border-top: 0;
    margin-top: 0;
    padding-top: 0;
  }

  .link-strip-item {
    background: var(--surface-translucent);
    display: flex;
    flex: 1 1 11rem;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.35rem clamp(1rem, 2vw, 1.5rem);
    text-decoration: none;
  }

  .link-strip-label {
    font-weight: 600;
  }

  .link-strip-item:hover .link-strip-label {
    color: var(--blue);
  }

  .link-strip-hint {
    color: var(--ink-muted);
    font-size: 0.8rem;
  }

  /* The Revisions footer: the inline upload bar flexes to fill the row and the
     "Create revision" link sits at its right end. Wraps to stacked rows when
     the footer is too narrow. */
  .revision-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.9rem;
  }

  .revision-actions .create-bar {
    flex: 1 1 16rem;
    width: auto;
  }

  /* A sheet footer's action row: buttons (or small forms wrapping one)
     gathered at the right edge. */
  .sheet-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    justify-content: flex-end;
  }

  .sheet-actions form {
    margin: 0;
  }

  /* Cancel and its save button, kept on one line. They are two halves of the
     same decision, and the footer wraps: in the revision editor's narrow rail
     the note field is wide enough to push them apart, which stranded the save
     alone on a second row and read as a third, unrelated action. */
  .sheet-actions .action-pair {
    align-items: center;
    display: flex;
    gap: 0.75rem;
  }

  /* A note field sharing the footer with its submit button (the revision
     editor's "what changed"). Inputs are full-width blocks by default, which in
     this flex row would push the button onto its own line; this one takes the
     free space instead and leaves the button at the end. */
  .sheet-actions .details-field {
    flex: 1 1 12rem;
    min-width: 0;
    width: auto;
  }

  .diagnostics {
    color: var(--red);
    margin-top: 1rem;
  }

  /* Per-proof engine checks under the editor: subtle, informational — a stub
     starter legitimately fails to verify, so these are not content errors. */
  .proof-checks {
    color: var(--ink-muted, #5f7388);
    font-size: 0.9rem;
    list-style: none;
    margin-top: 0.75rem;
    padding: 0;
  }

  .proof-checks li[data-state="ok"] {
    color: var(--green, #1b7048);
  }

  .proof-checks li[data-state="error"] {
    color: var(--ink-muted, #5f7388);
  }

  .create-bar {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin: 0;
    width: 100%;
  }

  .create-bar input,
  .create-bar select {
    flex: 1 1 12rem;
    min-width: 0;
    width: auto;
  }

  /* Restated over the min-width:0 above, which would otherwise let the bar
     crop a date rather than wrap. */
  .create-bar input[type="datetime-local"] {
    flex-basis: 17rem;
    min-width: min-content;
  }

  .create-bar button {
    flex: 0 0 auto;
    margin: 0;
  }

  /* A footer laying a standalone action button (course edit) on the same row as
     an add-bar (clone), to the right of the add-bar's submit button. The add-bar
     grows to fill the row; the button holds its natural width at the end. */
  .footer-row {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .footer-row > .create-bar {
    flex: 1 1 auto;
    width: auto;
  }

  /* Two add-bars sharing one footer (corrections: publish + excuse). A grid
     with display:contents forms lines up the fields into equal columns across
     both rows, so the two inputs are the same size regardless of button width. */
  .correction-bars {
    align-items: center;
    display: grid;
    gap: 0.75rem;
    grid-template-columns: 1fr 1fr auto;
  }

  .correction-bars .create-bar {
    display: contents;
  }

  /* Notices and errors */

  .notice,
  .error {
    border: 1px solid;
    border-radius: 4px;
    font-size: 0.92rem;
    padding: 0.85rem 1rem;
  }

  .notice {
    background: var(--blue-soft);
    border-color: color-mix(in srgb, var(--blue) 22%, transparent);
    color: var(--blue-strong);
  }

  .error {
    background: var(--red-soft);
    border-color: color-mix(in srgb, var(--red) 24%, transparent);
    color: var(--red);
  }

  .notice p {
    margin: 0 0 0.6rem;
  }

  /* The way onward from an error page. Paragraphs here have no top margin, so
     without this the only thing the reader can act on sits flush against the
     message that stopped them. */
  .error-next {
    margin: 1.15rem 0 0;
  }

  .error-next + p {
    margin: 0.75rem 0 0;
  }

  .copy-field {
    display: flex;
    gap: 0.5rem;
  }

  .copy-field input {
    background: var(--surface);
    flex: 1;
    font-family: var(--body-font);
    font-size: 0.9rem;
    min-width: 0;
  }

  .copy-field button {
    flex: none;
  }

  /* Dialogs */

  .modal-dialog {
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 6px;
    box-shadow: 0 24px 60px color-mix(in srgb, var(--shadow-color) 22%, transparent);
    color: var(--ink);
    max-width: 32rem;
    padding: 0;
    width: calc(100vw - 2rem);
  }

  /* The one place in the sheet that spells a token's fallback out. A
     ::backdrop only began inheriting custom properties from its originating
     element in recent browsers; where it does not, this resolves to the light
     value, which is the right answer under either palette — a backdrop is
     dark either way. */
  .modal-dialog::backdrop {
    background: color-mix(in srgb, var(--shadow-color, #102235) 35%, transparent);
  }

  .modal-dialog form {
    padding: 1.25rem 1.35rem 1.5rem;
  }

  .modal-dialog-header {
    align-items: start;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .modal-dialog-header h3 {
    margin: 0;
  }

  .modal-dialog-header button {
    background: transparent;
    border: 0;
    color: var(--ink-muted);
    font-size: 1.4rem;
    line-height: 1;
    min-height: 0;
    padding: 0.1rem 0.4rem;
  }

  .modal-dialog-header button:hover {
    color: var(--ink);
    filter: none;
  }

  .icon-button {
    background: transparent;
    border: 0;
    border-radius: 4px;
    color: var(--ink);
    min-height: 0;
    padding: 0.3rem 0.5rem;
    position:relative;
    right:0.5rem;
    bottom:0.3rem
  }

  .icon-button:hover {
    filter: none;
  }

  /* Duotone icons carry two explicit fills — a gold backing layer beneath a
     blue foreground glyph — rather than one text color at two opacities. */
  .icon-duo-back {
    fill: var(--gold);
    /* Half opacity keeps the backing at the soft gold the duotone used before,
       rather than the full, much darker --gold. */
    fill-opacity: 0.5;
  }

  .icon-duo-fore {
    fill: var(--blue);
  }

  .icon-button .icon {
    font-size: 1.5rem;
  }

  .icon-button:hover .icon-duo-fore {
    fill: var(--blue-strong);
  }

  /* The crown is drawn larger than the text it follows and taken out of flow so
     it cannot stretch the row's line box. That needs a positioning context on
     the marker itself: without one the glyph resolves against whatever ancestor
     happens to be positioned — outside the members table's scroller — and so
     stays put while the rows scroll under it. */
  .owner-crown {
    position: relative;
  }

  .owner-crown .icon {
    font-size: 1.5em;
    position: absolute;
  }

  /* Result and review surfaces */

  .result-exercise + .result-exercise {
    border-top: 1px solid var(--rule-soft);
    margin-top: 1.25rem;
    padding-top: 1.25rem;
  }

  .result-exercise-header {
    align-items: baseline;
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .instructor-comment {
    background: var(--surface);
    border-left: 3px solid var(--rule-soft);
    margin-top: 0.9rem;
    padding: 0.6rem 0.9rem;
  }

  .instructor-comment h4 {
    color: var(--ink-muted);
    font-size: 0.78rem;
    letter-spacing: 0.03em;
    margin: 0 0 0.3rem;
    text-transform: uppercase;
  }

  .instructor-comment p {
    margin: 0;
  }

  .review-filter {
    display: flex;
    gap: 1.25rem;
    margin-bottom: 1rem;
  }

  .review-filter-option {
    color: var(--ink-muted);
    font-size: 0.9rem;
    font-weight: 600;
    padding-bottom: 0.15rem;
    text-decoration: none;
  }

  .review-filter-option:hover {
    color: var(--ink);
  }

  .review-filter-option[aria-current] {
    border-bottom: 2px solid var(--blue);
    color: var(--ink);
  }

  .submission-review-list {
    display: grid;
    gap: 1rem;
  }

  /* The manual-evaluation disclosure keeps its full-width layout; the compact
     approve control sits on the summary's line, flush right, styled to match
     the summary rather than as a full button. */

  .submission-review-footer {
    margin-top: 0.9rem;
    position: relative;
  }

  .submission-review-footer .manual-evaluation {
    margin-top: 0;
  }

  .approve-score-form {
    position: absolute;
    right: 0;
    top: 0;
  }

  .approve-score {
    background: none;
    border: 0;
    box-shadow: none;
    color: var(--ink-muted);
    cursor: pointer;
    font-size: 0.86rem;
    font-weight: 600;
    line-height: 1.5;
    /* Shed the base button's block chrome so it sits on the summary's line:
       the 42px min-height and the form-button top margin would otherwise push
       it below the full-width disclosure and under the card's clipped edge. */
    margin: 0;
    min-height: 0;
    padding: 0;
    white-space: nowrap;
  }

  .approve-score:hover {
    color: var(--green);
  }

  .review-action-error {
    color: var(--red);
    margin: 0.6rem 0 0;
  }

  .submission-review-header {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    justify-content: space-between;
  }

  .submission-review-header h3 {
    margin: 0;
  }

  .submission-review-header .small {
    margin: 0.1rem 0 0;
  }

  .submission-review-status {
    font-weight: 600;
  }

  .submission-review-meta {
    color: var(--ink-muted);
    font-size: 0.82rem;
    margin: 0.35rem 0 0.9rem;
  }

  /* Manual grading is the exception (auto-graded work rarely needs it), so
     the form waits behind a disclosure instead of padding out every card. */

  .manual-evaluation {
    margin-top: 0.9rem;
  }

  .manual-evaluation summary {
    color: var(--ink-muted);
    cursor: pointer;
    font-size: 0.86rem;
    font-weight: 600;
    width: fit-content;
  }

  .manual-evaluation summary:hover {
    color: var(--ink);
  }

  .manual-evaluation-form {
    margin-top: 0.9rem;
  }

  .manual-evaluation-form button {
    margin-top: 0.9rem;
  }

  /* Content frames: the isolated content document embedded in a sheet. */

  .content-sheet {
    position: relative;
  }

  .content-frame {
    /* What shows before the document inside it paints — and, in the editor,
       for as long as the preview has nothing to show. An iframe with no
       background of its own falls through to the browser's canvas, which is
       white: invisible against a cream sheet and a lit slab against a dark
       one. The loaded document covers this. */
    background: var(--surface);
    border: 0;
    display: block;
    /* Fallback height until the document reports its own. */
    height: 30rem;
    width: 100%;
  }

  /* Stands in for the frame while nothing has compiled — inert everywhere
     except inside a split the editor has marked empty, so a page that passes
     one never shows it by accident. */
  .content-frame-empty {
    display: none;
  }

  .content-split.preview-empty .content-frame {
    display: none;
  }

  .content-split.preview-empty .content-frame-empty {
    align-content: center;
    color: var(--ink-muted);
    display: grid;
    font-size: 0.95rem;
    gap: 0.5rem;
    /* The frame's fallback height, so the column keeps its shape rather than
       collapsing to two lines of text beside a tall editor. */
    min-height: 30rem;
    padding: 2rem;
    text-align: center;
  }

  /* Held to a short measure so the sentence breaks where a sentence should
     rather than running the width of a wide column. */
  .content-split.preview-empty .content-frame-empty > * {
    margin-inline: auto;
    max-width: 26rem;
  }

  .content-frame-empty-title {
    color: var(--ink);
    font-family: var(--logo-font);
    font-size: 1.35rem;
  }

  /* The glyph is the whole control, so it carries an AA ratio rather than
     reading as decoration: --ink-faint would leave it at 2.8:1, short of both
     the 4.5:1 it wants as text and the 3:1 it wants as an icon. The audit
     cannot see this one — axe returns a symbol-only element as "incomplete"
     (messageKey "nonBmp"), since it cannot tell text from icon, and the gate
     reports violations. */
  .content-fullscreen {
    color: var(--ink-muted);
    font-size: 1.05rem;
    line-height: 1;
    padding: 0.45rem 0.6rem;
    position: absolute;
    right: 0.15rem;
    text-decoration: none;
    top: 0.15rem;
    z-index: 1;
  }

  .content-fullscreen:hover {
    color: var(--ink);
    text-decoration: none;
  }

  /* Content split: sheets beside the content document on wide screens. */

  .content-split,
  .content-split-rail {
    display: grid;
    gap: 1.75rem;
    /* Same reasoning as .page-content: the single-column default (below the
       70rem two-column breakpoint) must clamp to the container, not grow to
       its widest sheet. The 70rem rules below override this with the split's
       two-column templates. */
    grid-template-columns: minmax(0, 1fr);
  }

  /* The editor source field sizes itself to its content (the preview bundle
     grows it as the author types) instead of offering a drag handle. What is
     typed here is Markdown source, so it gets the same monospace treatment as
     the listings it produces: indentation lines up, a directive's attributes
     stay scannable, and an ASCII table in a code fence looks the way it will
     render. Ligatures are off because the format's operators are written in
     ascii and an author needs to see the characters they actually typed. */
  [data-editor-source] {
    font-family: "Fira Code", ui-monospace, monospace;
    /* Monospace runs wider than the body face at the same nominal size, and
       this field lives in a split column — a notch down keeps a full line of
       source visible without wrapping. */
    font-size: 0.9375rem;
    font-variant-ligatures: none;
    line-height: 1.55;
    min-height: 12rem;
    overflow: hidden;
    resize: none;
    tab-size: 2;
  }

  /* A sheet whose body *is* Carnap Markdown source — the editor, or a saved
     revision's read-only text. The source runs to the card's own edges: the
     section gives up its padding and the field its border, and the sheet's
     frame becomes the source's frame. Anything else inside the section — the
     editor's diagnostics — brings the padding back for itself. */
  .source-sheet .sheet-section {
    padding: 0;
  }

  .source-sheet [data-editor-diagnostics]:not(:empty) {
    border-top: 1px solid var(--rule);
    padding: 1rem clamp(1rem, 2vw, 1.5rem);
  }

  /* The unenhanced fields, which the shared input and <pre> rules do frame,
     give up the same border to sit flush the way a CodeMirror view does. */
  .source-sheet [data-editor-source],
  .source-sheet [data-source-view] pre {
    border: none;
    border-radius: 0;
    margin: 0;
  }

  /* How Carnap Markdown renders in a CodeMirror view — shared by the editor and
     by the read-only viewer on a revision page, because a directive should look
     the same whether or not it can still be typed. The typography repeats the
     source-field rules above rather than inheriting them: CodeMirror sets its
     own on .cm-content, and those win inside the view. */
  .markdown-source .cm-content {
    font-family: "Fira Code", ui-monospace, monospace;
    font-size: 0.9375rem;
    font-variant-ligatures: none;
    line-height: 1.55;
    tab-size: 2;
  }

  /* Line numbers are how a reader finds the line a diagnostic names, so they
     are content and carry an AA contrast ratio — --ink-faint would read as
     decoration at 2.8:1. */
  .markdown-source .cm-gutters {
    background: transparent;
    border: none;
    color: var(--ink-muted);
  }

  .markdown-source .cm-editor {
    background: transparent;
  }

  /* The inset the section gave up, put back on the scroller so it covers the
     gutter and the text together and the two stay on one baseline. Shared, so
     the editor and a revision's source start their text at the same place. */
  .markdown-source .cm-scroller {
    padding: 0.9rem clamp(1rem, 2vw, 1.5rem) 0.9rem clamp(0.5rem, 1vw, 0.75rem);
  }

  /* Directive lines are highlighted from the source view's own highlight style
     in markdown-editor.ts, along with the rest of the Markdown: the parser gives
     them syntax nodes, so they need no rule of their own here. */

  /* The fold arrow, on the lines that open a code block or a directive. Wide
     enough to be a target of its own beside the line numbers. */
  .markdown-source .cm-foldGutter span {
    color: var(--ink-muted);
    padding: 0 0.25rem;
  }

  .markdown-source .cm-foldGutter span:hover {
    color: var(--blue-strong);
  }

  /* The stand-in for a folded block, at the end of the line that opened it: a
     tinted chip, so it reads as content that is present but collapsed rather
     than as an ellipsis the author typed. It is a real button — the keyboard's
     way to unfold, since the gutter is hidden from assistive tech — so the
     sheet's button styling (a 42px-tall bordered pill) has to be undone. */
  .markdown-source .cm-foldPlaceholder {
    background: var(--surface-soft);
    border: 1px solid var(--rule);
    border-radius: 3px;
    color: var(--ink-muted);
    display: inline;
    font: inherit;
    font-weight: 400;
    margin: 0 0.15rem;
    min-height: 0;
    padding: 0 0.3rem;
  }

  .markdown-source .cm-foldPlaceholder:hover {
    background: var(--surface-soft);
    color: var(--blue-strong);
  }

  /* The writable editor: the sheet's whole body, so it fills the card and puts
     the inset the section gave up back on its own scroller — where it covers
     the gutter and the text together and the two stay on one baseline. */
  .editor-source {
    background: var(--control-surface);
  }

  .editor-source .cm-editor {
    /* Tall enough to look like a place to write in, and free to grow from
       there — the same shape the autosizing textarea had. */
    min-height: 12rem;
  }

  /* The insertion point, which CodeMirror's base theme would otherwise paint
     black. It ships both colours — black and white — and picks between them from
     the EditorView.darkTheme facet rather than from the OS, so a view that never
     sets that facet gets the black one in both schemes and the caret disappears
     into the dark surface (1.37:1 against it). Setting the caret from the ink
     token follows the palette instead, and needs no facet to be reconfigured
     when the reader's preference changes. */
  .editor-source .cm-content {
    caret-color: var(--ink);
  }

  /* Without a border of its own to recolour, the editor marks focus with a ring
     drawn inside its own box — outside it would land on the card's edge. */
  .editor-source .cm-editor.cm-focused {
    outline: 2px solid var(--blue);
    outline-offset: -2px;
  }

  .editor-source .cm-activeLine,
  .editor-source .cm-activeLineGutter {
    background: var(--surface-soft);
  }

  /* The compiler's diagnostics, on the lines they are about. CodeMirror's
     default underline is a red wave — the same shape a spellchecker draws,
     which is exactly the signal this editor exists to stop diluting — so an
     error reads as a tinted band instead. */
  .editor-source .cm-lintRange-error {
    background: var(--red-soft);
    background-image: none;
    box-shadow: inset 0 -2px 0 var(--red);
  }

  /* The bubble a diagnostic is read in. .cm-tooltip-lint names the <ul>
     *inside* the bubble, not the bubble itself, so a rule hung on it would never
     match; this one names the wrapper. Without it CodeMirror's base theme paints
     the bubble #f5f5f5 — from a rule scoped to &light, which follows the
     EditorView.darkTheme facet and not the OS — and in dark mode the message
     inherits the light ink and vanishes into it. */
  .editor-source .cm-tooltip {
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 4px;
    color: var(--ink);
    font-family: var(--body-font);
    font-size: 0.85rem;
    max-width: 32rem;
  }

  .editor-source .cm-diagnostic-error {
    border-left-color: var(--red);
  }

  /* The read-only viewer takes the lighter surface the editor uses, not the
     muted one a <pre> defaults to: the syntax colours are chosen against that
     surface, and two of them (the attribute gold, the gutter's ink) fall under
     4.5:1 on the darker one. The <pre> moves with it so the page looks the same
     whether or not the bundle ran. */
  [data-source-view],
  [data-source-view] pre {
    background: var(--control-surface);
  }

  /* Its own inset, matching the CodeMirror scroller's, since a <pre> has no
     gutter to leave room for on the left. */
  .source-sheet [data-source-view] pre {
    padding: 0.9rem clamp(1rem, 2vw, 1.5rem);
  }

  /* The editor's Write/Preview switch matters only where the split columns
     stack, and it is inert without JS — so it stays hidden until the preview
     bundle marks it enhanced, and never shows on wide viewports. */
  .editor-mode-switch {
    display: none;
    gap: 0.4rem;
  }

  .editor-mode-switch button[aria-pressed="true"] {
    border-color: var(--blue);
    color: var(--blue);
  }

  @media (max-width: 69.99rem) {
    .editor-mode-switch[data-enhanced] {
      display: flex;
    }

    .content-split[data-mode="write"] > .content-split-doc {
      display: none;
    }

    .content-split[data-mode="preview"] > .content-split-rail {
      display: none;
    }
  }

  /* While the source doesn't compile, the last good preview stays up but
     reads as stale. Not when there has never been one: dimming the "nothing
     to preview" placeholder would only make it harder to read. */
  .content-split.preview-stale:not(.preview-empty) > .content-split-doc {
    opacity: 0.55;
  }

  @media (min-width: 70rem) {
    /* Split pages outgrow the 85rem shell cap: the navbar keeps its width,
       but the columns spread into the gutters that would otherwise sit
       empty on wide screens. The breadcrumb stays capped to the navbar's
       content width so it keeps lining up with the brand above it. */
    .page-shell:has(.content-split) {
      max-width: 120rem;
    }

    .page-shell:has(.content-split) .breadcrumb {
      margin-inline: auto;
      max-width: var(--page-measure);
      width: 100%;
    }

    .content-split {
      align-items: start;
      grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    }

    /* The course page splits its columns evenly: the content-heavy rail (the
       assignment table and enrollment links) on the left, the members roster
       on the right. */
    .content-split.course-split {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }

  /* The course split's tables need more room than the editor's document
     column before two columns stop feeling cramped, so between the shared
     70rem breakpoint and 90rem it stays a single column at the normal shell
     width; the even columns engage only once there is room for them. */
  @media (min-width: 70rem) and (max-width: 89.99rem) {
    .page-shell:has(.course-split) {
      max-width: 85rem;
    }

    .content-split.course-split {
      grid-template-columns: none;
    }
  }

  /* Footer */

  .app-footer {
    align-items: center;
    border-top: 1px solid var(--rule);
    display: flex;
    gap: 1.5rem;
    justify-content: space-between;
    margin: 4rem auto 0;
    max-width: 85rem;
    padding: 1.75rem var(--shell-gutter) 2.5rem;
    width: 100%;
  }

  .app-footer .brand {
    font-size: 1.7rem;
  }

  .app-footer .footer-meta {
    align-items: flex-end;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    text-align: right;
  }

  .app-footer .copyright {
    color: var(--ink-muted);
    font-size: 0.82rem;
  }

  .app-footer .footer-link {
    color: var(--ink-muted);
    font-size: 0.82rem;
  }

  .app-footer .footer-link:hover {
    color: var(--blue-strong);
  }

  /* Support page */

  .charity-list {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* The mark and the name share the first row; the blurb spans both columns, so
     it begins at the margin instead of indenting under the name. The column is a
     fixed width rather than auto-sized so that icons of different sizes still
     hang the names at the same place. */
  .charity {
    display: grid;
    gap: 0 0.55rem;
    grid-template-columns: 1.1rem 1fr;
  }

  .charity p {
    grid-column: 1 / -1;
  }

  /* Shown at the icon's own size, never enlarged past it. Site icons are often
     16px originals, and scaling one up to logo size only makes it soft — as a
     small flair beside the name it stays crisp, and a big original (800px, in
     one case here) simply scales down into the same slot. */
  .charity-icon {
    block-size: auto;
    inline-size: auto;
    justify-self: center;
    margin-block-start: 0.3rem;
    max-block-size: 1rem;
    max-inline-size: 1rem;
    object-fit: contain;
  }

  /* For an organization whose site offers no usable icon. */
  .charity-monogram {
    align-items: center;
    background: var(--rule-soft, #e5ded3);
    block-size: 1rem;
    border-radius: 3px;
    color: var(--ink-muted, #5f7388);
    display: flex;
    font-size: 0.7rem;
    font-weight: 700;
    inline-size: 1rem;
    justify-content: center;
    justify-self: center;
    margin-block-start: 0.3rem;
  }

  .charity-name {
    font-size: 1.05rem;
    font-weight: 600;
  }

  .charity p {
    margin: 0.35rem 0 0;
  }

  @media (max-width: 820px) {
    .app-header {
      flex-wrap: wrap;
    }

    .sheet-header,
    .app-footer {
      align-items: flex-start;
      flex-direction: column;
    }

    .app-footer .footer-meta {
      align-items: flex-start;
      text-align: left;
    }
  }

  /* On a phone the brand wordmark + nav links + account name overflow one line
     and wrap the navbar to two rows. Dropping the "Carnap" wordmark to just the
     ⊨ turnstile mark reclaims the width so the header stays on a single line;
     the footer keeps the full wordmark (it stacks vertically, with room). */
  @media (max-width: 640px) {
    .app-header .brand-word {
      display: none;
    }

    /* On a phone the course-record footer stacks the clone title field, its
       "Clone course" button, and "Edit" onto three lines. Dropping the clone
       form's own box (display: contents) floats its input and submit button
       into the footer-row flex flow beside "Edit": the wide title field takes
       its own line and the two buttons — Clone course and Edit — then share
       the next. Same technique as .correction-bars. */
    .footer-row > .create-bar {
      display: contents;
    }

    /* The corrections footer's three columns are two fields and a button, and
       only the fields are elastic — so on a phone the button's natural width
       ("Publish correction") eats the row and squeezes both fields down to a
       few characters. One column per control instead: each form reads as its
       fields followed by the action that submits them. */
    .correction-bars {
      grid-template-columns: 1fr;
    }
  }
`;
