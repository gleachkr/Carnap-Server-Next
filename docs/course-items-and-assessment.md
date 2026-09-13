# Course items and assessment modes

A course item publishes an immutable content revision into a course. It can
be a reading, a practice activity, or a graded assignment. The publication
stores the course-specific title, order, availability, and assessment mode;
the source material remains in the content library.

The code and database call all three kinds `Assignment`. There is no separate
`CourseItem` record or store. This guide describes the current implementation
first, then the proposed course-organization model.

## Content and publication

- A **content item** is a reusable library entry.
- A **content revision** contains saved source and its compiled artifact.
  Revisions are immutable. A revision note describes the change to readers.
- An **assignment** places one revision in a course. Several assignments can
  use the same revision with different assessment settings.

Saving a new content revision does not update existing assignments. Use the
published-assignment correction workflow to change their revision. That
workflow records the change in the content-version ledger and recalculates
scores. See [Grading model](./grading-model.md) for the effect of point
changes.

## Assessment modes

`Assignment.assessmentMode` is one of `none`, `practice`, or `graded`. The UI
calls these **Reading / resource**, **Practice activity**, and **Graded
assignment**. Do not infer the mode from a due date, attempt count, or prior
submissions.

### Reading / resource (`none`)

Use this mode for syllabi, readings, reference pages, and link collections.

- Students can open the content when course and availability policy allow it.
- Viewing does not create an attempt or record completion.
- Embedded exercises can be used locally, as in an authoring preview, but
  their answers are not recorded.
- The submission service rejects submissions for this mode.
- There is no assignment gradebook, course-total contribution, or LTI grade
  passback.

### Practice activity (`practice`)

Use this mode to record exercise work without counting it toward a grade.

- Opening an available activity creates or reuses an open, untimed attempt.
- Students can retry without the graded attempt-limit workflow.
- Submissions use the normal normalization and evaluation services.
- Instructors can review work and add manual evaluations.
- Practice scores use the same calculation as graded scores: select the best
  result for each exercise and sum them.
- Students see practice progress on the course page. Instructors can use the
  activity's gradebook and CSV export.
- Practice scores do not appear as course-gradebook columns, count toward
  the course total, or produce LTI passback.

Due dates, late penalties, per-student overrides, attempt resets, and grade
release are graded-only features. Practice does not have separate
`recordProgress` or `serverChecked` settings.

### Graded assignment (`graded`)

Use this mode for homework, quizzes, and exams.

- Students must explicitly begin an attempt before viewing its content.
- The policy service applies availability, attempt limits, time limits,
  accommodations, overrides, expirations, and resets.
- Server evaluation produces the recorded grade evidence.
- Scores appear in the course gradebook and contribute to course totals.
- Released scores can be sent to an LMS when an AGS line item is mapped.

Grade release and exercise feedback are separate settings. In particular,
releasing grades does not remove the requirement to begin an attempt.

### Changing modes

The assignment update workflow does not change assessment mode. To use the
same material in a different mode, create a new publication pointing at the
same revision. Existing student work remains attached to the original item.

## Grade release, recording, and feedback

A graded assignment offers three release choices:

- **Immediate**: store the creation time in `gradesVisibleAt`.
- **Manual**: store `null` until the instructor releases grades.
- **Scheduled**: store the supplied release timestamp.

The creation form defaults to immediate release. API commands that omit
`gradesVisibility` retain the older timestamp-only behavior: a missing
`gradesVisibleAt` means manual release.

Each exercise also accepts `exam` and `feedback` attributes. If the author
omits them, their values depend on the assignment:

| Context | Default `exam` | Default `feedback` |
| --- | --- | --- |
| Graded, grades withheld | `true` | `none` |
| Graded, grades released | `false` | `full` |
| Practice, reading, or preview | `false` | `full` |

`exam="true"` records incorrect as well as correct answers. With
`exam="false"`, automatically evaluated answers are recorded only when fully
correct. Free responses are always recorded because they await manual grading.
Readings and previews record nothing regardless of these attributes.

`feedback` controls the displayed verdict and detail. An explicit value always
wins over the assignment default, including after grade release.

A student can see an exercise's numeric score only when grades are released
and that exercise's feedback is not `none`. The assignment total requires
release alone. A hidden exercise score may therefore be inferred from the
total by subtraction.

Feedback is a display setting, not protection against inspecting browser data
or running a local checker. See
[Recording and feedback](./carnap-markdown-v1.md#recording-and-feedback).

Releasing grades while submissions remain open also changes the defaults for
future submissions. Check the release warning on the instructor page before
doing this.

## Policy and route boundaries

Routes parse requests and call application services. They must not duplicate
availability or assessment checks from `application/policies.ts`.

The canonical implementation still uses `/assignments` routes:

```text
GET  /courses/:courseId/assignments
GET  /courses/:courseId/assignments/:assignmentId
POST /courses/:courseId/assignments/:assignmentId/attempts
```

Submissions are JSON POSTs to the following suffix under an assignment:

```text
/attempts/:attemptId/submissions
```

`/courses/:courseId/items` supports listing and creation, and
`/courses/:courseId/items/:assignmentId` supports viewing. These are partial
aliases over the same model, not a complete replacement route hierarchy.

A read request has mode-specific effects: it creates no assessment records
for a reading, ensures an attempt for practice, and does not begin a graded
attempt. Do not assume that every item GET is free of database writes.

## Gradebooks and LTI

The course gradebook includes only graded assignments. Practice has its own
assignment gradebook and CSV export; a reading's gradebook is rejected rather
than rendered as an empty table.

Displayed scores are calculated from current evidence when read. The
`assignment_scores` table tracks score changes for passback; it is not the
source of numbers displayed by gradebooks.

LTI resource links and Deep Linking may refer to non-graded items. AGS line
items and grade passback are graded-only. Keep this check in the LTI adapter
as well as in score-delivery code.

## Proposed course organization

Sections are not implemented. The proposed model is a one-level outline:

```text
Course
  Week 1
    Syllabus
    Reading: Arguments
    Practice: Validity
  Week 2
    Reading: Truth tables
    Homework 1
```

The intended design is:

- A course owns zero or more sections.
- Each section has a title, optional description, and display order.
- Each item belongs to one section or an unsectioned group.
- Items have an order within that group.
- Reordering updates sibling positions using dense integers.
- Course cloning preserves sections and item order.
- Availability remains an item-level policy; sections have no assessment or
  LTI settings of their own.

Implement creation, ordering, item placement, and cloning together. A previous
schema-only section stub was removed because it had no usable workflow.

A future schema may rename `assignments` to `course_items` and separate
mode-specific assessment settings. Those are design options, not tables or
interfaces callers can use today. Avoid adding nullable fields whose values
implicitly choose an assessment mode.

Reading completion, section availability, nested modules, and additional
practice analytics are separate future features.

## Tests and source references

When changing this model, cover:

- Reading views create no attempts; reading submissions are rejected.
- Practice views reuse an untimed attempt.
- Practice manual grades affect its own score, but no course total or LMS.
- Graded attempt, timing, release, and submission behavior remains intact.
- Availability applies to every mode, and unlisted items stay out of lists.
- Non-graded items cannot produce grade passback.
- New publication modes do not reinterpret existing student work.

Start with `src/worker/domain/assignments.ts` and the application services
`assignments.ts`, `attempts.ts`, `submissions.ts`, and `gradebook.ts`.
Integration coverage includes `tests/assignments.test.ts`,
`tests/submissions.test.ts`, and the gradebook and LTI suites.
