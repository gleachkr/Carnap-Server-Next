# Course items and assessment modes

Carnap should let instructors publish reusable content into a course without
forcing that content to behave like homework. A syllabus, reading packet,
textbook chapter, list of links, practice set, quiz, and graded assignment all
share one important property: each is a course-visible placement of an
immutable content revision.

Assessment is an optional layer on top of that placement. Viewing course
content must not require starting an attempt.

## Problem

The current assignment vocabulary is too narrow for the desired course model.
It makes all published content feel homework-like, even when the instructor
only wants students to read or consult it. Fixed attempt counts are a symptom
of that problem, not the underlying cause.

Using `maxAttempts = null` to mean "not homework" would be a weak model. It
would overload one field with several unrelated meanings:

- whether the item appears in the gradebook;
- whether submissions are recorded;
- whether inline checks are practice or authoritative;
- whether an LMS line item exists;
- whether viewing the item counts as completion;
- whether due dates, overrides, and late policy apply.

Those are assessment questions, not attempt-count questions.

## Desired model

Separate the reusable content, the course placement, and the assessment
behavior.

```text
Content revision
  Immutable authored material: Markdown, exercises, links, metadata, and the
  compiled manifest — plus the author's note on why the revision was made,
  which is how revisions are named to a reader (the ordinal is not shown).

Course item
  A course-visible placement of a content revision: course, title, ordering,
  visibility, release window, and publication state.

Assessment settings
  Optional behavior attached to a course item: practice checking, graded
  attempts, due dates, time limits, grade visibility, late policy, and score
  projection.
```

The core rule is:

```text
viewing content ≠ beginning an attempt
```

Students should be able to open any visible course item. Attempt creation is a
separate operation that only exists for assessment-backed items.

## Terminology

Use `course item` for the domain concept. It is broad enough for readings,
resources, syllabi, textbooks, practice activities, and graded assignments.

Use `assignment` as product language only when the item has graded assessment
settings. Existing route and table names may remain temporarily, but new
application code should avoid making "assignment" the generic name for all
published course content.

Recommended names:

| Current narrow term | Preferred broad term |
| --- | --- |
| Assignment | Course item |
| Assignment service | Course item service |
| Assignment policy | Assessment policy |
| Assignment store | Course item store |
| Begin assignment attempt | Begin assessment attempt |

## Assessment modes

Each course item has exactly one assessment mode. The mode determines which
secondary records exist and which services may act on the item.

```ts
type AssessmentMode = "none" | "practice" | "graded";

interface CourseItem {
  readonly id: string;
  readonly courseId: string;
  readonly contentRevisionId: string;
  readonly title: string;
  readonly description: string;
  readonly state: "draft" | "published";
  readonly listed: boolean;
  readonly availableFrom: string | null;
  readonly availableUntil: string | null;
  readonly assessmentMode: AssessmentMode;
}
```

The detailed settings should be represented by mode-specific records or a
mode-specific discriminated union. Do not infer the mode from `maxAttempts`,
`dueAt`, or the existence of prior submissions.

A published course item's assessment mode is immutable. If an instructor wants
to use the same material in a different mode, they should publish a new course
item that points at the same content revision. This keeps existing student
interactions attached to the item that actually governed them.

```ts
type AssessmentSettings =
  | {
      readonly mode: "none";
    }
  | {
      readonly mode: "practice";
    }
  | {
      readonly mode: "graded";
      readonly maxAttempts: number | "unlimited";
      readonly dueAt: string | null;
      readonly timeLimitMinutes: number | null;
      readonly gradesVisibleAt: string | null;
    };
```

## Mode semantics

### No assessment

This mode is for syllabi, link lists, readings, textbook pages, and ordinary
resources.

Students can view the item when membership, listing, and availability policy
allow it. The item does not create attempts, submissions, evaluations, scores,
late-policy records, or LMS grade line items.

Inline exercises may still render if they are part of the content. In this
mode they should not submit to the authoritative assessment pipeline. If the
UI offers local self-checking, it must be presented as unrecorded practice.

Reading completion is deferred until there is a concrete product need. The
initial model should not record that a student viewed, opened, or completed a
reading. Adding that later should be a separate completion-tracking feature,
not an implicit side effect of rendering a course item.

### Practice

This mode is for content with inline practice problems where the instructor
wants progress evidence, but not grades.

Practice items record submissions, and the same calculation that scores a
graded assignment scores a practice one — best of each exercise, summed. Those
points are learning evidence, not grade evidence: the student sees them on the
course page, the instructor reads them on the assignment's own gradebook page
and in its CSV, and they stay out of the course total and out of the LMS. If
the instructor wants the same revision to become graded, they should create a
new graded course item from that revision.

Practice work is reviewed through the same interface as graded work, and can be
graded by hand: qualitative feedback on a free response, or a corrected score
where an autograder was too strict, are the reasons an instructor reads
submissions at all, and neither depends on the points counting for anything.
A hand-written evaluation lands on the practice score exactly as an automatic
one does.

What remains graded-only is everything about deadlines and grades as such:
overrides, late penalties, attempt limits and resets, grade release, and LMS
passback. Practice has no deadline to except a student from and no grade to
release.

Checking is not mode-specific: exercises always check locally for rapid
feedback, and the server may independently verify the accuracy of submitted
results. Server verification may be authoritative as practice evidence, but
it still must not create gradebook scores or LMS grade passback events.

Practice should normally allow free retry. It should not use the graded
attempt limit model unless a later product decision explicitly adds
attempt-backed practice.

Earlier drafts made progress recording and server checking per-assignment
flags (`recordProgress`, `serverChecked`). Both were dropped before they
gained any behavior: recorded submissions are the point of practice mode, and
the checking model above applies uniformly rather than per assignment.

### Graded

This mode is the existing homework, quiz, and exam path.

Graded items use the shared policy service for availability, due dates,
attempt limits, timed starts, expirations, accommodations, overrides, late
policy, resets, and voiding. Submissions are checked server-side when they
produce grade evidence. Scores are projected through the gradebook service.

Only graded items appear in ordinary gradebook assignment columns and LMS AGS
line items.

Graded does not mean withheld. What separates weekly homework from an exam is
not the mode but its settings, and the first of those is when grades become
visible. The author answers that question as one of three choices — as soon as
work is checked, when I release them, or at a time I give — which the service
resolves into the single stored `gradesVisibleAt`: the creation instant, null,
or the given timestamp. A command that names no choice is read the older way,
where the bare timestamp (or its absence) is the whole answer.

The default is the open one, and the choice decides more than a number. An
assignment holding its grades back **is** an exam, in the sense the exercises
themselves read: with nothing written on them they keep every submission and
tell the student nothing. Release it and the same exercises become homework —
retry until correct, with the reasons shown. `resolveExerciseExam` and
`resolveExerciseFeedback` are where that is read off, and an exercise that
writes `exam` or `feedback` overrides it in that place and no other.

Release settles what an author left unsaid; it does not overrule them. It used
to, which meant the end of term handed out the answer key to every question
marked `feedback="none"`.

What release does hold outright is the numbers. A per-exercise score needs both
release and an exercise willing to talk, so `feedback="full"` on a withheld
assignment shows the marked-up work and no score; the assignment total needs
release alone. Which does leave a lone sealed exercise inferable from the
total — per-exercise feedback is a display setting, not a security boundary,
and this is that same limit.

Releasing on an assignment students can still submit to therefore gives the
stragglers an easier run than the ones who sat it. That is sometimes wanted
(the late policy exists to price it), so the instructor page says so beside the
release button rather than refusing.

## Policy boundaries

The policy service should evaluate two related but separate decisions:

1. May this actor view the course item?
2. May this actor perform this assessment action?

Viewing checks apply to all course items. Assessment action checks only apply
to practice and graded items.

Example policy operations:

```ts
interface CourseItemPolicyService {
  canViewItem(input: ViewCourseItemInput): CourseItemViewPolicy;
  canStartAttempt(input: StartAttemptInput): AssessmentActionPolicy;
  canSubmitAnswer(input: SubmitAnswerInput): AssessmentActionPolicy;
  canViewGrade(input: ViewGradeInput): AssessmentActionPolicy;
}
```

Routes must not duplicate these decisions. They should parse input, resolve
the actor, call services, and render or return the result.

## Route shape

The student-facing item route should always be a read route:

```text
GET /courses/:courseId/items
GET /courses/:courseId/items/:itemId
```

That route renders the course item when `canViewItem` allows it. It does not
start an attempt as a side effect.

Assessment actions live under the item only when the mode supports them:

```text
POST /courses/:courseId/items/:itemId/attempts
GET  /courses/:courseId/items/:itemId/attempts
POST /courses/:courseId/items/:itemId/attempts/:attemptId/submissions
```

For compatibility, existing `/assignments` routes may continue as aliases for
graded items during migration. They should not become the canonical route for
non-assessed readings and resources.

## Instructor UI

The instructor should choose a publication type in ordinary language:

```text
Reading / resource
Practice activity
Graded assignment
```

All three choices publish an immutable content revision into the course. The
choice controls which assessment settings form is shown.

The default should be conservative:

- readings and resources have no assessment settings;
- practice activities do not affect the gradebook;
- graded assignments require explicit grade and attempt settings.

The UI should avoid asking instructors to encode product intent through
technical fields such as nullable attempt counts.

## Course organization

Courses should use explicit one-level sections with ordered items. Sections
are course-owned organization records, not authored content and not assessment
containers. A section might be named "Week 1", "Unit 2", "Exam review", or
"Course resources".

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

The initial section model should stay deliberately small:

- each course has zero or more sections;
- each section has a title, optional description, and `displayOrder`;
- each course item belongs to one section or to an unsectioned bucket;
- each course item has a `displayOrder` within its section or bucket;
- moving an item rewrites the affected sibling positions;
- course cloning preserves section structure and item order;
- section availability is not supported initially;
- item availability remains the authoritative visibility policy.

Dense integer ordering is the preferred durable representation. Reordering a
section or item may update several sibling rows. That is acceptable for normal
course sizes and is simpler than fractional ranking schemes.

The main alternatives are weaker fits for the first implementation:

- A flat ordered list is simple, but instructors will eventually fake weeks or
  modules with dummy content items.
- A nested outline tree is flexible, but it adds query, drag-and-drop,
  cloning, and policy complexity before the product needs it.
- Date-derived grouping is useful for dashboards, but it is not a stable
  course outline and works poorly for undated resources.
- Content-derived grouping confuses authored document structure with course
  structure. The same content revision may appear in different course
  contexts.

Sections should not have their own assessment or LTI behavior initially. If a
future course needs section-level release rules, that should be added as a
course-organization feature with explicit policy support.

An earlier stub of this model — a `course_sections` table and an
`assignments.section_id` column with no way to create sections — shipped ahead
of any behavior and was removed. When sections are built, they should arrive
as a complete feature: creation and ordering UI, item placement, and cloning
support together.

## Storage direction

The durable model should make the split visible. A future schema can either
rename the existing `assignments` table or introduce new tables and migrate
references gradually.

A normalized target shape is:

```text
course_sections
  id
  course_id
  title
  description
  display_order
  created_at
  updated_at

course_items
  id
  course_id
  section_id
  content_revision_id
  title
  description
  state
  listed
  available_from
  available_until
  assessment_mode
  display_order
  created_by_id
  created_at
  updated_at

course_item_assessment_settings
  course_item_id
  mode
  max_attempts
  due_at
  time_limit_minutes
  grades_visible_at
```

Attempt, submission, evaluation, score, override, excuse, and late-policy
records should reference the course item only when the item is assessable.
Application services must enforce that relationship rather than relying only
on database shape.

## Gradebook and LTI behavior

Only graded course items create columns in the *course* gradebook, because
every column there is summed into a course total and a practice column has no
way to say that it does not count. A practice item still has a gradebook of its
own — the per-assignment table and CSV, which the instructor reaches from the
assignment page — and the score projection behind it is real and stored. A
reading has neither: it takes no submissions, so its gradebook is refused
rather than rendered empty.

Only graded course items should create or bind LTI AGS line items. LTI
resource links may point to any visible course item, including readings or
resources, but grade passback exists only for graded items.

Deep Linking should let instructors select any course item. If the LMS
expects a grade-bearing link, the selection flow must require a graded item or
offer to create a new graded course item from the same content revision.

## Migration strategy

The current implementation can move in stages:

1. Add `assessmentMode` to the assignment domain and default existing rows to
   `graded`.
2. Permit `none` items to render without creating attempts or gradebook rows.
3. Add canonical `/items` routes and keep `/assignments` as graded aliases.
4. Rename application services and stores from assignment terminology to
   course item terminology.
5. Rename tables or add replacement tables when a migration is worth the
   churn.

During the transition, code should be explicit about whether it accepts all
course items or only graded items. Avoid helper names such as
`getAssignmentInCourse` for operations that are meant to load readings and
resources too.

## Tests to add

Storage and service tests should cover these cases:

- a `none` item can be published and viewed;
- viewing a `none` item does not create an attempt;
- starting an attempt for a `none` item is rejected;
- a `none` item is absent from gradebook columns;
- a practice item's score reaches its own gradebook and CSV, and no course
  total;
- practice work is listed for review, and a manual evaluation on it changes
  the practice score and sends nothing to an LMS;
- server-checked practice does not create gradebook or LTI score events;
- readings do not record completion merely because a student viewed them;
- a graded item keeps current attempt, submission, and grade behavior;
- a published item's assessment mode cannot be changed in place;
- availability policy controls viewing for all modes;
- assessment policy controls attempt and submission actions for graded items;
- hidden items remain hidden from ordinary student lists in all modes;
- LTI grade passback is impossible for non-graded items;
- sections and items preserve dense integer order across course cloning;
- section availability does not override item availability.

## Deferred work

These decisions are settled for the first implementation. Later work may add
reading completion, attempt-backed practice, section-level availability,
nested modules, or richer practice analytics. Those features should be
designed as explicit additions rather than inferred from item views, nullable
attempt counts, or content headings.
