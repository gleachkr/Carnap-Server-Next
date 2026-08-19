# Grading model

Carnap treats grading as a chain of evidence and projections. Exercise
packages may produce evaluation evidence, course policies may derive modifiers,
and score services may project a visible grade. These are separate concepts.

## Exercise declarations

Every compiled exercise is described by a manifest item in an immutable
content revision. The manifest item includes a versioned exercise kind, a
schema version, an answer kind, nominal points, public render data, private
assessment data, component render metadata, capabilities, and a declaration
hash.

The compiled document is the student-facing render artifact. It may include
public data and component metadata, but it must not contain answer keys,
checker declarations, or other private assessment data.

## Answer envelopes

Student submissions use a generic answer envelope:

```ts
type AnswerEnvelope = {
  kind: string;
  schemaVersion: number;
  data: unknown;
};
```

Routes and submission services should not switch on exercise-specific payload
fields. They select the manifest item, pass the envelope to the assessment
registry, and record the normalized answer or structural diagnostics.

## Normalization

Normalization answers one question: is this payload structurally a valid answer
for this exercise declaration?

Normalization failure means the answer cannot be academically evaluated. The
standard failure reasons are:

- `malformed`: the envelope or data is not shaped like an object the exercise
  package can inspect.
- `wrong-kind`: the answer kind does not match the exercise declaration.
- `schema-invalid`: the answer kind is right, but required fields, schema
  version, option IDs, or other structural details are invalid.

A well-formed but wrong answer is not a normalization failure. It should be
normalized and then evaluated as incorrect or partial.

## Automatic evaluations

Automatic evaluations are earned-credit evidence for one normalized answer.
They are not final course scores.

An automatic evaluation records the awarded score, nominal maximum score,
status, evaluator version, declaration hash, and optional feedback. It cannot
claim late penalties, accommodations, overrides, dropped scores, grade
visibility, or final course totals.

The policy and score services consume evaluation evidence later. They decide
which attempts count, which modifiers apply, and what score is visible.

## Manual evaluations

Manual evaluations are first-class evaluation evidence. Instructors may
manually evaluate any recorded submission in their courses, even if the
exercise type has no custom manual-grading metadata.

Exercise packages may provide optional manual-grading metadata such as a rubric
or answer viewer. Missing metadata means the UI uses a generic fallback; it
does not make the submission ungradable.

Manual evaluations may award partial credit or extra credit. They are still
not final scores. They are evidence used by the score projection layer.

A manual evaluation is always out of the exercise's own declared points, read
from the assignment's pinned revision — the same artifact the review page shows
and the score projection divides by. The max score is not the grader's to set,
and the route refuses one rather than accepting a number it will not honour.

The score itself is uncapped, and that is where extra credit lives. An
assignment's maximum is the sum of the manifest's declared points; the earned
score is the sum of the evaluations. A score above one exercise's points
therefore adds to the numerator over an unchanged denominator, which is what
lets it offset a low score elsewhere. Raising a per-evaluation maximum would do
the opposite of what it looks like: it changes how the submission reads on the
review card — including whether it counts as full marks — while the total goes
on dividing by the author's figure.

## Policy-derived modifiers

Availability, timing, attempt limits, resets, accommodations, overrides, late
credit, and similar rules belong to policy services. Exercise packages and
submission routes must not duplicate those decisions.

Policies may derive score modifiers from recorded facts such as due dates,
submission times, overrides, or voided attempts. Those modifiers are applied by
score projections, not by exercise evaluators.

## Score projections

Scores are projections over append-only history: submissions, automatic
evaluations, manual evaluations, voiding records, policy decisions, and release
settings.

Refreshing a score should be deterministic and idempotent. Recalculation may
produce the same projection again, but it should not rewrite the historical
evidence that explains how the score was derived.
