# Exercise runtime API

The runtime connects exercise widgets to the assignment submission endpoint.
It is separate from the Markdown authoring format and the server assessment
registry.

Responsibilities are divided as follows:

- The **assignment runtime** sends requests, supplies CSRF and idempotency
  headers, displays submission status, and dispatches result events.
- The **widget** collects the answer, maintains local UI and checker state,
  and synchronizes the hidden `answerData` field. It does not call `fetch` to
  submit answers.
- The **server** enforces policy, normalizes answers, evaluates them, and
  decides what to record and return to the student.

Exercises require JavaScript. Server-rendered forms are shells for the
runtime; the answer endpoint accepts JSON only. There is no form-encoded
submission-and-redirect fallback.

The implementation is in `src/worker/web/assignment-scripts.ts`,
`src/worker/web/assignment-detail.tsx`, and the browser components under
`src/client/components/`. Runtime identifiers use the `carnap-` prefix.

## Runtime shell

A submittable exercise has this structure. The example omits the widget's
internal markup and the full hydration payload:

```html
<form
  class="exercise-submission"
  data-component="carnap-multiple-choice"
  data-component-version="1"
  data-exercise-id="q1"
  data-exercise-kind="multiple-choice@1"
  data-content-revision-id="rev_123"
  action="/courses/c1/assignments/a1/attempts/t1/submissions"
  method="post"
>
  <input type="hidden" name="csrfToken" value="...">
  <input type="hidden" name="exerciseId" value="q1">
  <input type="hidden" name="answerKind" value="multiple-choice-answer@1">
  <input type="hidden" name="schemaVersion" value="1">
  <input type="hidden" name="answerData">
  <script type="application/json" data-exercise-hydration>
    {"version":1,"mode":"answer","publicData":{},
     "priorAnswer":null,"options":{},"strings":{}}
  </script>
  <!-- Exercise element, controls, and action bar go here. -->
</form>
```

`.exercise-submission` identifies the form. `.exercise` belongs to the
exercise's own outer box, which also exists outside submission forms.
The runtime prefers `answerData`; free response and short answer use native
text fields instead.

Every exercise has an action bar containing Submit, a polite live status
region (`data-exercise-status`), and a correctness mark. Widgets may add Help,
Check, or counterexample controls. The bar stays in light DOM and is slotted
into the widget with `slot="exercise-actions"`. This lets the runtime find it
and author CSS style it.

Preview renderers use `exerciseActionsHtml` from
`src/worker/exercise-kit/actions.ts`. They show the same bar with Submit
disabled. Local controls still work, but no enclosing form exists and
nothing is saved.

## Correctness mark

`.exercise-mark` displays the current verdict. Use the shared definitions in
`src/worker/exercise-kit/correctness-mark.ts`, not separate glyphs or labels.

| State | Display | Accessible name |
| --- | --- | --- |
| `idle` | `-` | Not correct yet |
| `working` | Spinner | Checking |
| `ok` | `✓` | Correct |
| `error` | `!` | Could not check |

`idle` includes untouched, incomplete, and incorrect work. `error` means the
checker could not run, such as a proof engine that failed to load; it does not
mean the answer is wrong.

The runtime sets the mark from the recorded evaluation on load and after
submission. Only full credit counts as correct. For native text fields, it
clears the mark when the answer changes and restores it if the saved text is
restored.

A widget can set a verdict on the current answer with
`CarnapExerciseElement.setMark(state, title?)`. Its live verdict takes
precedence over recorded state. Reset it to `idle` when an edit invalidates
the check, and respect the resolved feedback setting.

Normally the accessible name and tooltip use the same text. A specific error
message can replace the tooltip without replacing the general accessible
name. Each call updates the tooltip so old error text cannot remain on a
correct mark.

The mark has `role="img"`, not a live region. The adjacent status line already
announces submissions; announcing every debounced checker update would create
repeated interruptions.

## Initial recorded state

An active attempt includes one JSON bootstrap for all its exercises:

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
      "evaluation": null,
      "answerReview": { "summary": "Yes" }
    }
  }
}
</script>
```

The map is keyed by stable exercise ID and contains the latest submission in
the active attempt. An absent ID means no submission in that attempt.
Evaluation data is filtered for the viewer; it may be absent or have numeric
scores withheld.

This is display state, not authorization. The server checks each new request
against current policy.

## Component loading and hydration

Custom elements start as inert server-rendered Declarative Shadow DOM. The
content document lists the component assets it needs:

```html
<script type="application/json" data-carnap-component-assets>
["carnap-multiple-choice-v1"]
</script>
```

The loader imports one ES module per asset ID. Native text-field exercises
do not need a custom element.

An element looks for hydration data in this order:

1. A `script[data-exercise-hydration]` inside itself, as used for review.
2. The same script inside its enclosing `form.exercise-submission`.
3. The document's `data-exercise-hydration-map`, keyed by exercise ID, as
   used for previews.

`ExerciseHydration` is defined in `src/worker/exercise-kit/hydration.ts`:

- `version`: wire-format version, currently 1.
- `mode`: `answer` or `review`.
- `publicData`: public exercise configuration, never private manifest data.
- `priorAnswer`: the viewer's previous answer, or `null`.
- `options`: server-resolved options, including `feedback`.
- `strings`: interface text translated for the viewer.

Shared theory text is sent once per document. Exercise public data refers to
it by system name; the helpers in `exercise-kit/systems/join.ts` restore the full
consumer shape, including theory and goal, where needed. Do not duplicate the
whole theory in every widget payload.

Review renderers also send hydration with translated strings. They can use
`null` public data and prior answer when the review is already rendered and
needs only read-only enhancement.

### Widget requirements

- Restore the prior answer and keep `answerData` synchronized after changes.
- Set `data-enhanced="true"` when ready and remove stale `aria-busy` state.
- Keep accessible names in sync with visible state. For example, each
  truth-table cell names its column, row, and value in words, even if the
  author's display glyph is `1` or the empty cell has no visible text.
- Read translations through `t(id, values)`. See [i18n](./i18n.md) for the
  string-ID type and server payload requirements.
- Include `EXERCISE_GROUP_SHADOW_STYLES` when using the shared group markup.
  Page styles do not cross a shadow root, including visually hidden styles.

Use `createHelpDialog`, `openHelpDialog`, and `mountHelpTrigger` from the
shared help-dialog module for widget instructions. Mount the trigger first in
the light-DOM action bar and append the dialog to the shadow root, outside
containers whose keyboard handlers could intercept its events. Let the
helper position the dialog near its trigger: a full-height lesson iframe
cannot use the lesson midpoint as the visible viewport center.

Previews are interactive but unsubmittable. Methods that locate the action
bar or mark must work without a form; `setMark` falls back to the element.

## JSON submission

POST to the form's `action` with these headers:

```text
Content-Type: application/json
X-CSRF-Token: <csrf token>
Idempotency-Key: <key for this submission>
```

API clients may also send `Accept: application/json`. The page runtime does
not currently set it explicitly.

The request body contains the exercise ID and answer envelope:

```json
{
  "exerciseId": "q1",
  "answer": {
    "kind": "multiple-choice-answer@1",
    "schemaVersion": 1,
    "data": { "selectedOptionIds": ["yes"] }
  }
}
```

A newly recorded submission returns 201. An idempotent replay returns 200.
The following response is abbreviated:

```json
{
  "recorded": true,
  "submission": { "id": "sub_123", "exerciseId": "q1" },
  "evaluation": null,
  "policy": { "canSubmit": true },
  "idempotent": false
}
```

`evaluation` can be `null` because grading is pending or feedback is withheld.
A visible evaluation can also have its numeric scores withheld until release.

An automatically checked answer rejected by the recording rule returns 200
with `recorded: false` and `policy`, rather than a submission record.
It includes `check` only when feedback allows the verdict to be returned.
The runtime leaves the previous recorded state unchanged and tells the student
to try again. A successful HTTP request is therefore not proof that work was
saved.

## Unsaved work

The content document installs a `beforeunload` guard when answers have changed
since their last recorded submission. In a same-origin frame this can also
warn before the enclosing page navigates. The browser controls the wording
and whether the warning is shown; it is not a persistence mechanism.

Custom elements set `data-unsaved` on themselves. The runtime checks that
attribute and compares native text fields against their saved values.
It must not compare the hidden `answerData` directly: proof certificates can
change asynchronously without a student edit.

For widget authors:

- Override `authoredAnswer()` when the payload includes derived data. Proof
  widgets serialize the answer without its certificate.
- Keep serialization stable. Do not allocate IDs or mutate defaults while
  reading the answer.
- Call `syncAnswer()` after each change; it also updates the unsaved flag.

After recording, the runtime dispatches `carnap:answer-recorded` on the form.
The element adopts the answer captured when submission began as its saved
state. Edits made while the request was in flight remain unsaved.
A `recorded: false` result sends no such event.

### Local draft recovery

`CarnapExerciseElement` also saves unsent authored answers in `localStorage`.
The key combines the form action, which identifies the attempt, with the
exercise ID. Review widgets and formless previews do not save drafts.

On reconnect, a valid draft is restored through the `priorAnswer` channel
while retaining the saved-answer baseline, so restored work remains unsaved.
When the current answer matches the recorded answer, the local draft is
removed. Malformed records are discarded, and records older than 30 days are
pruned when draft storage is read.

Draft storage is best-effort: unavailable storage, quota failures, or invalid
restored data must not prevent the widget from loading. `authoredAnswer()`
also determines what is stored, so derived certificates are excluded. This
mechanism applies to custom elements, not the native free-response and
short-answer fields. A local draft is not a server submission or a backup.

The revision editor has a separate form-snapshot guard in
`src/client/unsaved-changes.ts`.

## Result event

After a successful JSON response, including a checked but unrecorded answer,
the form dispatches:

```js
new CustomEvent("carnap:exercise-submitted", {
  bubbles: true,
  detail: responseBody,
});
```

Listeners can update progress or scores, but must inspect `recorded` before
treating the event as saved work. Submission status remains the assignment
runtime's responsibility.
