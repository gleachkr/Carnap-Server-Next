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

## Two denominators

A stored evaluation's maximum and an assignment's maximum answer different
questions, and they are allowed to disagree.

`evaluations.max_score` is historical evidence: what the work was graded out
of, copied from the assignment's pinned revision at grading time. The
verdict, the review queue, and every displayed "4/5" read it, so graded work
keeps meaning what it meant when it was graded. The assignment total is a
live projection: it divides by the sum of the *current* manifest's declared
points (minus excused exercises), and its numerator is the sum of stored raw
scores.

Repointing a published assignment at a revision with different points is the
one act that splits them, and it restamps nothing — rewriting evaluations
would let a repoint retroactively re-judge old work, and deriving the stored
maximum at read time would do the same thing implicitly. The projection is
recomputed immediately (and pushed to any linked LMS), but each evaluation
keeps its own denominator. A consequence to know about: a stored raw score
feeds the numerator unscaled, so work graded 5/5 on an exercise now worth 2
contributes 5 points against a denominator counting 2 — the same
numerator-over-unchanged-denominator arithmetic that makes deliberate extra
credit work.

The views say so rather than reconcile. A page showing an affected score
tints it gold and names the current figure ("now worth 2", or "no longer in
the assignment" when the exercise has left the manifest), under a banner
explaining that totals count every exercise at its current points.

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

Every score a person is shown — a student's scorecard, the gradebooks, the
CSV exports — is that projection computed at the moment of reading, from the
live rows, in a fixed number of statements however much work there is
(`GradebookService` reads a scope's attempts, submissions and evaluations in
bulk and sums in memory). There is no stored number a page shows; there is
nothing that could disagree with the rows.

The `assignment_scores` table is not that number. It is the grade-passback
ledger: what each student's score last evaluated to, kept so that a change can
be told from a repeat (an LMS must not be sent the same score twice) and so
that deliveries can be ordered by data recency. It is written only by the
paths that change what a score evaluates to — a submission, a hand-written
grade, and an instructor's excuse, override, repoint, attempt reset, late
policy or accommodation — and never by a page view. A path that neglected to
write it would delay an LMS sync until the next one did; it could not put a
wrong number in front of anyone. The table holds rows for students who have
submitted, since the submission writes the first one, and a student who never
has is "not started" or "missing" whatever else changes, neither of which is
a score passback sends unprompted.

Refreshing the ledger should be deterministic and idempotent. Recalculation
may produce the same projection again, but it should not rewrite the
historical evidence that explains how the score was derived.
