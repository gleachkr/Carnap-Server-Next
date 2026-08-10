# Exercise runtime API

The exercise runtime API is the browser-facing contract between an assignment
page and an exercise widget. It is separate from the authoring contract, the
compiled content artifact, the answer envelope, and the server-side checker
contract.

The page owns assignment context. The widget owns answer collection, local UI
state, and inline submission feedback. Server routes and application services
remain authoritative for policy checks, normalization, evaluation, and recorded
submissions.

## Runtime shell

A submittable exercise is rendered as a progressively enhanced form:

```html
<form
  class="exercise"
  data-component="carnap-multiple-choice"
  data-component-version="1"
  data-exercise-id="q1"
  data-exercise-kind="multiple-choice@1"
  data-content-revision-id="rev_123"
  action="/courses/course_1/assignments/asn_1/attempts/att_1/submissions"
  method="post"
>
  <input type="hidden" name="csrfToken" value="...">
  <input type="hidden" name="exerciseId" value="q1">
  <input type="hidden" name="answerKind" value="multiple-choice-answer@1">
  <input type="hidden" name="schemaVersion" value="1">
  ...exercise controls...
  <div class="exercise-actions">
    <button class="exercise-submit" type="submit">Submit answer</button>
    <p class="exercise-status" data-exercise-status aria-live="polite">
      No submission in this attempt.
    </p>
    <span class="exercise-mark" data-state="idle" role="img" aria-label="Not correct yet"
          data-label-idle="..." data-label-working="..."
          data-label-ok="..." data-label-error="...">-</span>
  </div>
</form>
```

Without JavaScript, the form submits normally and the server redirects back to
the assignment. With JavaScript, the runtime intercepts submission, sends JSON
to the same URL, and updates `data-exercise-status` inline.

Every exercise gets that action bar, whether or not it has an element to enhance
it. A widget adds its own controls to it — the `(?)` that opens its instructions,
`Check`, `Find counterexample` — and projects the whole bar into its shadow card
through `slot="exercise-actions"`, so the bar stays in the form's light DOM,
where the runtime finds it, and author CSS can still reach it. The row therefore
reads `(?) · Check · Submit · status · mark`, in that order, for every type.

The bar is rendered on the **preview** paths too (`exerciseActionsHtml` in
`src/worker/exercises/actions.ts`, which every `read-only-view.ts` calls), with
the submit `disabled` and saying so on hover: an author writing an exercise
should be looking at the shape a student will work in, and a widget's own
controls — including a local `Check` — have nowhere else to go.

## Correctness mark

`.exercise-mark` is the one place every exercise says whether the work is right.
It sits hard right of the action bar for all nine types, and is described once,
in `styles.ts`: a green check on a pale green outline when correct, a grey `-`
before that, a red `!` with the problem on hover, a spinner while a proof
compiles. `src/worker/exercises/correctness-mark.ts` holds the glyphs, the state
names and the label attributes; nothing else spells them.

Two things write to it, and they answer different questions.

- **The runtime**, from the recorded evaluation, on load and after each
  submission: is the answer the *server* holds correct? Only a full score
  counts — partial credit is not a green check, and an ungraded hand-marked
  response is not one either. For the text types it also clears the mark as soon
  as the field differs from what was recorded, and restores it if the reader
  types the recorded answer back.
- **The widget**, from its own checker: is what is *on screen* right now
  correct? `CarnapExerciseElement.setMark(state, title?)` writes it, and the live
  answer wins whenever there is one, because it is the one about the work the
  reader is looking at. A widget whose verdict lapses — the grid was edited, the
  proof stopped compiling — passes `idle` rather than leaving a stale claim up.

For the truth table and the model this is not an approximation of the server:
neither has a secret answer key, so the browser runs the very check the worker
runs. The proof types compile a certificate the worker re-verifies, so their
mark is the compiler's verdict on the current text.

Each state has one string, which is both the mark's `aria-label` and its
`title`, so hovering answers the question a small coloured glyph raises and a
reader who cannot see it is told the same thing:

| State | Glyph | Name and tooltip |
|---|---|---|
| `idle` | `-` | Not correct yet |
| `working` | spinner | Checking |
| `ok` | `✓` | Correct |
| `error` | `!` | Could not check |

Idle says "not correct **yet**" rather than "incomplete" because it is three
situations at once: not started, half-finished, and finished but wrong. All the
mark ever claims is that nothing has said the work is right — so a wrong answer
is idle, not an error.

`error` is *could not check*, not *wrong*. Today its only cause is the WASM proof
engine failing to load, and a red mark reading "not correct" would blame the
reader for the machine. A widget in that state passes its own message as
`setMark`'s second argument, which replaces the `title` but not the name: named
for the general case, described by the particular one. The title is assigned on
every call, so a recovered widget cannot leave "Could not load the proof engine."
hanging over a green check.

The mark carries `role="img"` rather than being a live region. The status line
beside it is already `aria-live`, and the proof types recompute the mark on a
debounce while the reader types: a polite region here would announce "checking",
"correct", "not correct yet" over and over through an edit, and duplicate the
status line on every submit.

## Initial state bootstrap

Assignment pages with an active attempt include one bootstrap block for all
exercise widgets:

```html
<script type="application/json" data-carnap-exercise-runtime-state>
{
  "version": 1,
  "exercises": {
    "q1": {
      "submission": {
        "id": "sub_123",
        "exerciseId": "q1",
        "answerKind": "multiple-choice-answer@1",
        "submittedAt": "2026-07-07T12:34:56.000Z"
      },
      "evaluation": {
        "id": "eval_123",
        "submissionId": "sub_123",
        "evaluatorKind": "automatic",
        "checkerVersion": "multiple-choice-evaluator@1",
        "score": 1,
        "maxScore": 1,
        "result": { "status": "correct" },
        "createdAt": "2026-07-07T12:34:56.000Z",
        "voidedAt": null
      },
      "answerReview": {
        "summary": "Yes"
      }
    }
  }
}
</script>
```

The `exercises` object is keyed by stable exercise ID. Each value represents
the latest recorded submission for that exercise in the active attempt. If an
exercise ID is absent, the exercise has no submission in this attempt.

This bootstrap is display state. It is not permission state. Widgets may use it
to render continuity, but the server response to a submission remains
authoritative.

## Component loading and hydration

An exercise is inert server-rendered markup — a Declarative Shadow Root with
`aria-busy` — until its custom element upgrades. Every content document that
contains exercises therefore lists the bundles it needs and loads one ES module
per id:

```html
<script type="application/json" data-carnap-component-assets>
["carnap-multiple-choice-v1"]
</script>
```

Each element then reads one hydration payload, most specific channel first:

1. `<script data-exercise-hydration>` inside the element (a self-contained
   widget, e.g. a hydrated review),
2. the same script inside the enclosing `form.exercise` — the interactive path,
   whose payload carries the viewer's own `priorAnswer`,
3. the document's hydration table, keyed by exercise id:

```html
<script type="application/json" data-exercise-hydration-map>
{ "q1": { "version": 1, "mode": "answer", "publicData": { ... },
          "priorAnswer": null, "options": {} } }
</script>
```

Two obligations come with that payload, and both are about what a reader who
cannot see the widget is told:

- **`strings`** carries the widget's own interface text, resolved for the viewer
  (`src/worker/exercises/<type>/strings.ts`, gathered by `exerciseStrings`). Look
  ids up through the element's `t(id, values)`, whose fallback is
  `strings[id] ?? id` — which is why every key in those maps *is* its own English
  text, and why the literal at a `t(...)` call site must be a catalog id (the
  `i18n-extraction` gate reads those call sites literally).
- **Accessible names are the element's job to maintain.** The server renders the
  first one; anything the element then rewrites has to be rewritten too. A
  truth-table cell is the worked example: its `aria-label` names the column, the
  1-based row, and the value *in words*, so all three writes go through one
  `setCellValue`. The glyph cannot stand in for the word — an author's `trueMark`
  may be `1` or ✓, and under `nodash` an empty cell has no text at all, leaving the
  button with no name. An element that replaces its inert markup must also drop the
  `aria-busy` that markup carries, or it tells assistive technology it is still
  loading for the life of the page.
- **Instructions live behind a `(?)`, not on the page.** A widget that needs
  explaining builds one with `createHelpDialog` / `openHelpDialog`
  (`src/client/components/help-dialog.ts`), spreads `buildExerciseHelpStrings`
  (`src/worker/exercises/help-strings.ts`) into its map for the frame text, and
  writes one message per paragraph and per key row — `t()` substitutes but does
  not format, so a table cannot come out of one long string. Three constraints are
  not stylistic: append the dialog to the **shadow root**, not to the widget's
  container, or a container-level `keydown` (undo, Escape) fires for keys typed
  inside it; mount the trigger with `mountHelpTrigger`, which puts it first in the
  light-DOM action bar rather than in the widget's own toolbar, so it is in one
  place for every type and out of reach of an island's rerenders; and leave
  `openHelpDialog` to place it, because a content iframe is sized to the whole
  document and the UA would centre a modal at the lesson's midpoint.
- **A shadow root inherits no page CSS**, so text a widget hides is only hidden if
  that root's own `<style>` says so. Reach for `EXERCISE_GROUP_SHADOW_STYLES`
  (`src/worker/exercises/group.ts`), which ships the group's look together with the
  rule that hides its legend: the three proof widgets took the group styles alone
  and printed "PROOF" above every untitled exercise — a name meant to be heard,
  rendered on screen instead.

The table is the **preview** channel — the instructor's assignment preview and
the authoring editor's live preview, which render no submission forms. Widgets
there are fully interactive (options select, truth-table cells cycle, proof
editors compile and write the correctness mark) but unsubmittable: the action bar
is rendered with its submit disabled, and with no enclosing form there is no
`answerData` to mirror into, so working an exercise in a preview records nothing.
A widget looking for the bar or the mark finds them inside itself here rather
than inside a form, which is why `setMark` falls back to the element.

## JSON submission

Enhanced widgets submit to the form `action` with:

- `Content-Type: application/json`
- `Accept: application/json`
- `X-CSRF-Token: <csrf token>`
- `Idempotency-Key: <per-click idempotency key>`

The request body is the standard answer envelope plus the exercise ID:

```json
{
  "exerciseId": "q1",
  "answer": {
    "kind": "multiple-choice-answer@1",
    "schemaVersion": 1,
    "data": {
      "selectedOptionIds": ["yes"]
    }
  }
}
```

The response is the authoritative recorded submission result:

```json
{
  "submission": { "id": "sub_123", "exerciseId": "q1" },
  "evaluation": { "score": 1, "maxScore": 1 },
  "policy": { "canSubmit": true },
  "idempotent": false
}
```

Widgets should update inline feedback from this response. They should not treat
browser state, local checking, or bootstrap state as a recorded submission.

## Unsaved work

Leaving the assignment page — following a link, closing the tab, reloading —
throws away every answer that has not been submitted, and used to do so in
silence. The content document carries a `beforeunload` guard that asks first.
It lives there rather than on the assignment page because that is the frame the
exercise forms are in, and a `beforeunload` inside a same-origin frame also
stops the *enclosing* page from navigating or reloading — so one guard covers
the inline frame and the fullscreen view both. (The browser writes the wording
and decides whether to show it at all, so there is nothing here to translate.)

**The element decides whether it holds unsaved work, not the runtime.** While
the reader's answer is ahead of the server's, `CarnapExerciseElement` sets
`data-unsaved` on itself; the runtime only looks for that attribute (and, for
the text types, which have no element, compares the native field against what
the server rendered).

It has to be that way round. A runtime diffing the hidden `answerData` field
against what arrived cannot work, because the four proof types compile an `mmb`
certificate into that field asynchronously, on a debounce, seconds after the
page has settled and with nobody touching it. Only the element can tell that
from an edit. Two obligations follow for a widget author:

- **Override `authoredAnswer()` if the answer carries a derived field.** It
  returns the part of the answer the *reader* authors, serialized, and defaults
  to the whole answer. The proof types return
  `JSON.stringify(withoutCertificate(this.getAnswer()))`.
- **Keep it stable.** Two reads with nothing in between must agree, so nothing
  may be minted while serializing. The Prawitz widget's `EMPTY_TREE` exists for
  this: its placeholder node used to be a fresh `newAssumption()`, minting an id
  per read, which made every read of an untouched workspace look like an edit.

`syncAnswer()` re-checks the flag, so a widget that already calls it on every
change needs nothing further. On a recorded submission the runtime dispatches
`carnap:answer-recorded` on the form and the element takes the answer *as it
stood when the submit began* as the new saved state — an edit typed while the
request was in flight is still unsaved when it lands. A checked-but-not-recorded
answer (`recorded: false`) gets no such event: nothing was stored, so leaving
still loses it.

The revision editor guards itself separately (`src/client/unsaved-changes.ts`),
by snapshotting its form's fields; its answer is in the form, so it needs none
of the above.

## Runtime event

After a successful enhanced submission, the form dispatches:

```js
new CustomEvent("carnap:exercise-submitted", {
  bubbles: true,
  detail: responseBody,
});
```

The assignment shell may listen for this event to update coarse progress or
scores. The exercise widget remains responsible for its own submission status.
