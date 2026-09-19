# Grading model

Grading has three stages:

1. Normalize a submitted answer against its exercise declaration.
2. Record automatic or manual evaluation evidence.
3. Calculate scores from that evidence and the course's policies.

Exercise evaluators do not calculate final assignment or course grades.

## Exercise declarations

An immutable content revision contains an exercise manifest. Each entry has:

- a stable exercise ID and versioned exercise kind;
- the answer kind and schema version;
- nominal points;
- public render data and private assessment data;
- component metadata and capabilities; and
- a declaration hash identifying the compiled declaration.

Private answer keys and rubrics belong in manifest `privateData`, not in
student document nodes or hydration payloads. Some exercise types deliberately
use public solutions: translation exercises need them for browser-side
verification. Do not treat those solutions as secret.

## Answer envelopes

Submissions use a common envelope:

```ts
type AnswerEnvelope = {
  kind: string;
  schemaVersion: number;
  data: unknown;
};
```

The route and submission service select the manifest entry and pass the
answer to the assessment registry. Exercise packages interpret their own
payload fields.

## Normalization

Normalization checks whether a payload is structurally valid for the
exercise. It does not decide whether the answer is academically correct.

Failure reasons are:

- `malformed`: the envelope or data cannot be inspected as the expected
  object shape.
- `wrong-kind`: the answer kind does not match the declaration.
- `schema-invalid`: the kind matches, but the version, required fields,
  option IDs, or other structural details are invalid.

A well-formed wrong answer should normalize successfully and then receive an
incorrect or partial evaluation.

## Automatic evaluations

An automatic evaluation records the earned score, maximum score, status,
evaluator version, declaration hash, and optional feedback for one answer.
It does not apply late penalties, accommodations, overrides, dropped scores,
release settings, or course-total rules.

Whether an evaluated answer is recorded depends on the exercise's resolved
`exam` setting. Outside exam mode, an automatically evaluated answer must be
fully correct to be recorded. A checked but unrecorded answer does not become
grade evidence. See [Assessment modes](./course-items-and-assessment.md).

## Manual evaluations

Instructors can manually evaluate recorded submissions in graded and practice
activities. Optional exercise-specific rubrics and answer viewers improve the
review interface; their absence does not prevent manual grading.

Manual evaluations are appended, not replacements for prior evidence. They
can award partial or extra credit.

The maximum score comes from the exercise's declared points in the
assignment's current pinned revision. The grader cannot supply a different
maximum; the route rejects that field. The earned score is uncapped, so extra
credit increases the numerator without increasing the assignment maximum.

## Historical and current point values

An evaluation's stored `max_score` describes what the work was graded out of
at grading time. Review displays and verdicts use that historical value.

The assignment total instead uses the current revision's exercise points,
excluding excused exercises. Its numerator uses the selected stored scores,
without rescaling them to the new point values.

For example, after a correction changes an exercise from 5 points to 2,
work previously graded 5/5 still contributes 5 points, while the assignment
maximum includes only 2 for that exercise. The evaluation remains 5/5.

Changing the pinned revision recalculates the projection and updates passback
state without rewriting old evaluations. Affected review displays identify
the current point value, or say that the exercise is no longer in the
assignment. Removed exercises no longer contribute to its total.

## Policy-derived modifiers

Availability, deadlines, attempt limits, resets, accommodations, per-student
overrides, excuses, and late credit belong to policy and score services.
Submission routes and exercise evaluators must use those services rather
than repeat the rules.

Late penalties are applied during score projection, based on recorded times
and effective policy. They do not change the original evaluation.

## Score selection

The gradebook calculates scores from non-voided evidence:

1. For each submission, use its latest manual evaluation if one exists;
   otherwise use its best automatic evaluation.
2. Select the best result for each exercise across non-voided attempts,
   applying the relevant score policy.
3. Sum the selected exercise scores and current nominal points, excluding
   excused exercises.

Resetting an attempt voids it and creates a replacement. Its old work remains
available as history but no longer contributes to the score.

## Displayed scores and the passback ledger

Student scorecards, gradebooks, and CSV exports calculate their scores when
read. `GradebookService` loads a scope's evidence in bulk and calculates the
results in memory; query count does not grow once per submission.

`assignment_scores` serves a different purpose. It stores the last calculated
score state so passback can detect changes, avoid redundant jobs, and order
deliveries by data recency. Page views do not write this table.

Score-changing operations refresh the ledger: submissions, manual grades,
excuses, overrides, content corrections, attempt resets, late policies, and
accommodations. The service method that makes the change performs the refresh
before it returns, so a caller with no HTTP request — a script, a backfill —
keeps the ledger as a route would; the route's only part is to start a
delivery run afterwards. A missing refresh can delay an LMS update even when
the application displays the correct score.

A student who has never submitted remains not started or missing. Passback
does not send an unsolicited score for that student merely because policy
changed.

Ledger refreshes must be deterministic and idempotent. They must not rewrite
the evidence used to calculate the score. The score store coordinates ledger
updates with LTI outbox jobs; preserve its claim, retry, and supersession
checks when changing delivery behavior.
