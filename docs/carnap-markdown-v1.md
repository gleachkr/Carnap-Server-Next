# Carnap Markdown v1

`carnap-markdown-v1` is the restricted authoring format used for content
items and immutable content revisions. It is intentionally small. Authors
write ordinary Markdown prose and embed exercises with fenced directives.

This document is user-facing dialect documentation. Keep it in sync with the
compiler in `src/worker/application/content/compiler.ts` whenever directive
syntax or supported Markdown changes.

## Profile guarantees

- The source profile identifier is `carnap-markdown-v1`.
- Compilation is deterministic for a given source string.
- Exercise IDs are always explicit in source.
- The compiler never infers exercise IDs from headings or ordering.
- Reordering prose around an exercise does not change that exercise's ID.
- Student render data does not include private answer keys.
- Raw HTML is rejected.
- Unsupported directives are rejected.

## Supported prose Markdown

The current prose subset is deliberately minimal:

- blank lines separate blocks
- headings with one to six `#` characters
- paragraphs
- unordered lists using `- item`
- fenced code blocks — the place to put a listing whose layout matters (a proof,
  or a directive quoted as documentation). A fence is opaque to the directive
  parser, so a `:::` block inside one is shown, not compiled. Long lines scroll
  sideways rather than wrapping.
- pipe tables, footnotes, and mathematics between dollars (see below)

Inline Markdown renders normally: emphasis, strong emphasis, inline code,
links, and images are all active formatting constructs.

## Tables

A table is written with pipes, in the GitHub style: a header row, a row of
dashes, then one row per line.

```md
| symbol | ascii | reads          |
| ------ | ----- | -------------- |
| `∧`    | `/\`  | and            |
| `→`    | `->`  | if … then      |
```

Colons in the dash row set a column's alignment: `:---` left, `:---:` centered,
`---:` right. Cells hold inline Markdown — emphasis, code, links, item links —
but nothing block-level: no lists, no paragraphs, no directives. A `|` that is
part of the content must be escaped as `\|`.

The outer pipes are optional and the columns need not line up in the source;
what matters is that every row has the same number of cells. A row with too few
is padded, a row with too many is truncated — so a stray unescaped `|` shows up
as a lost cell rather than an error.

A table renders as a figure, not as a full-width grid: it is as wide as its
content and scrolls sideways if that exceeds the page.

## Footnotes

A footnote is a `[^label]` marker in the text and a `[^label]:` definition
somewhere in the same source:

```md
Frege drew the distinction in 1892.[^sinn]

[^sinn]: *Über Sinn und Bedeutung*, page 25.
```

The label is a name, not a number — `[^1]`, `[^sinn]`, and `[^why-not]` are all
fine — and it never appears on the page: markers are numbered in the order they
are read. Indent a definition's later lines by four spaces to give one note
several paragraphs.

Definitions may be written anywhere in the source, including all together at the
foot of it. Each one is rendered where it is used: under a rule at the end of
the run of prose that cites it, or inside the exercise whose prompt cites it —
near the text it belongs to, rather than gathered at the end of the lesson.
Numbering runs on through the document all the same, so the notes of a lesson
read 1, 2, 3 down the page however many exercises they are spread across.

A marker with no definition is left as literal text, so a stray `[^` in prose
stays what it is; so is a second marker for a note that has already been used
somewhere else in the document. A definition nothing refers to is dropped.

The two chrome strings the footnote section carries — the hidden "Footnotes"
heading that names it for a screen reader, and the "Back to reference *n*" label
on each return arrow — are compiled into the stored document in English, because
compilation has no reader and so no language. Everything a reader sees is the
author's own text.

Tables and footnotes are the only GFM constructs the dialect takes.
Strikethrough, task lists, and bare-URL autolinking are all still off — so `~`,
a leading `[x]` (which is how a `multiple-choice` option is written), and a URL
in running text mean exactly what they meant before.

Raw HTML is not allowed anywhere in the source. For example, `<strong>x</strong>`
will fail with an `unsafe_raw_html` diagnostic.

## Mathematics

TeX between dollars. `$…$` sets a formula inline, and `$$…$$` sets it as a
displayed block of its own — on one line or fenced across several, both mean
display:

```md
A conditional $P \to Q$ is false only when $P$ is true and $Q$ false.

$$\forall x\,(Fx \to Gx) \leftrightarrow \neg\exists x\,(Fx \wedge \neg Gx)$$

$$
\sum_{i=1}^{n} i^2 = \frac{n(n+1)(2n+1)}{6}
$$
```

Formulas work anywhere prose does, including exercise prompts, option labels,
and a free-response rubric.

### Dollars that are not mathematics

A single `$` has to touch its formula on both sides, which is how a sentence
like `it cost $5 and then $10` stays prose: the run `$5 and $` closes on a
space, so it is not read as a formula. `\$` writes a dollar sign that is never
mathematics, and inline code is untouched — `` `echo $HOME` `` is safe as it
stands.

The cost of that rule is that `$ x $` is *also* literal. Do not pad a formula
with spaces inside single dollars; write `$x$`.

### Macros

`\newcommand` works and is scoped to the document that defines it:

```md
$\newcommand{\Nec}{\Box}$

Then later: $\Nec(p \to q) \to (\Nec p \to \Nec q)$.
```

A formula that only makes a definition typesets to nothing and takes up no
space, so a run of them can sit at the top of a source as a preamble.

### What is available

Formulas are typeset once, when the revision is saved, and stored as MathML —
so a reader downloads no math engine and a page with a hundred formulas costs
them nothing. The platform ships **STIX Two Math** for it, which is what makes
fractions, radicals, stretchy braces and matrices come out right; a `:::style`
block can name a different one:

```md
:::style
math { font-family: "Latin Modern Math", math; }
:::
```

The TeX packages enabled are `base`, `ams`, `boldsymbol`, `braket`, `cancel`,
`mathtools`, `newcommand`, `textmacros`, `unicode` and `verb`. A formula that
does not parse fails the save with an `invalid_math` diagnostic on its own
line, rather than being stored as an error box for a student to find.

Browsers implement MathML Core, which drops several of the presentation
attributes MathJax writes. The compiler draws the common ones back on with CSS
instead, so `\hline`, a `|` in an `array` column template, `\boxed`, `\fbox`,
`\cancel`, `\bcancel` and `\xcancel` all come out the same in every engine.

What is still not offered, because nothing draws it:

- `bussproofs` (`\begin{prooftree}`) — use the `:::aufbau-proof-tree` or
  `:::aufbau-proof-prawitz` directives, which are better at it anyway
- `\cancelto`, whose arrow no CSS draws; it fails the save rather than
  typesetting as a plain crossing-out
- `\enclose`, which takes notations far past the handful above
- a long displayed formula does not break across lines; it scrolls sideways
  inside its own box rather than widening the page

Two more differ by browser, and no CSS reaches either. The first is the column
alignment of `\begin{aligned}` and of an `array` column template's `r`/`l`:
Firefox lines the columns up, Chromium centres them, because an `<mtd>`'s
content is a math layout box rather than an inline one. A formula whose
*meaning* depends on where its columns sit is best written as separate
displayed lines.

The second is the horizontal brace of `\underbrace` and `\overbrace`. A brace
too wide for any single glyph the font carries is assembled from parts, and
Chromium (152, measured) assembles it to a length that does not track the
expression underneath: it may stop well short of the end or overshoot it,
leaving a hook or the centre spike somewhere inside. Firefox is right at every
width, and both engines are right for a brace short enough to be one glyph —
two or three characters, in STIX Two Math. This is the browser's arithmetic
rather than the font's; it reproduces just as badly with Noto Sans Math. Until
it is fixed, a brace over more than a couple of terms is worth avoiding.

Colour commands (`\textcolor`, `\color`) are not enabled: they work by writing
a `style` attribute, which the sanitizer strips, so they would silently do
nothing. `\href`, `\class`, `\style`, `\cssId` and `\require` are not defined
at all.

## Item links

A link may target another content item by ID instead of a URL:

```md
Continue with [Chapter 2](item:0197a2c4-89ab-7cde-8f01-23456789abcd).
```

The ID is the content item's ID — the last path segment of its library page
URL. The link resolves by context when a reader follows it: inside a course,
it goes to the assignment in *that course* that publishes the item (so the
same source works in every course it is published into); in the content
library's previews, it goes to the item's library page. If the item is not
published in the reader's course, a "content not available" page explains as
much.

When several assignments in one course publish the same item, listed
assignments win, then course display order decides. A malformed target (the
text after `item:` must look like an ID) fails with `invalid_item_link`.
Item links work anywhere a link does, including exercise prompts and option
labels. Links in content documents always open in the full window, not the
content frame.

## Directive blocks

A directive block begins with a line containing four colons, followed by the
directive name and, in braces, its attributes:

```md
::::directive-name{key="value" other=value}
Directive body.
::::
```

The block ends with a line containing exactly:

```md
::::
```

Directive and attribute names must start with a letter and may then use
letters, numbers, underscores, or hyphens.

Attributes go **inside the braces** as `key=value` or `key="value"`; quote
values that contain spaces. `{#name}` is shorthand for `id="name"`, and a bare
word (like `{reset}`) is a valueless flag. Attributes written outside the
braces are not recognized and fail with `invalid_directive_attributes`.

The `#` shorthand reads `.` and `#` the way the same shorthand does in HTML: in
`{#ex1.2}` the ID is `ex1` and `.2` is a class, which then fails as an unknown
attribute, and in `{#a#b}` the second ID silently replaces the first. An ID
containing either character has to be written out as `id="ex1.2"`.

Every directive declares the attributes it understands, and one it does not is
a compile error (`unknown_attribute`) naming the set it accepts. This is
deliberately strict: `exam` decides whether a wrong answer is recorded at all,
so a silently ignored `exm="true"` would turn a summative exercise back into a
practice one with nothing on the page to say so. A stored revision carrying a
stray attribute will not save until it is removed.

## Recording and feedback

Three questions face every exercise, and each has exactly one lever:

| Question | Lever |
|---|---|
| Is the work kept? | `exam` |
| Is the student told whether it is right, and in how much detail? | `feedback` |
| Do they see numbers? | the assignment's grade release |

**The assignment sets the tone and the attributes are deviations from it.** An
assignment still holding its grades back is an exam: every submission is kept,
nothing is said. One that has released them — along with every practice set,
reading and preview — is homework: retry until correct, and say why. An author
who writes neither attribute gets whichever of those the assignment is, and an
author who writes one overrides it, in that place only, whether or not grades
are out.

### `exam`

Optional. `exam="true"` records every submission, right or wrong — summative
work, where a student commits to an answer and partial or zero credit lands in
the gradebook. `exam="false"` records only fully correct work: anything less is
checked and refused, so the student keeps trying until the checker accepts it.

Writing nothing takes the assignment's word for it, which is `true` while its
grades are withheld and `false` once they are out. Note that `exam="false"` is
therefore not the same as leaving it out — it used to be, and it used to be
silently ignored.

### `feedback`

Optional. How much a student is told about whether their work is right:

| Value | The local Check | The correctness mark | Detail |
|---|---|---|---|
| `full` | offered | shown | shown |
| `terse` | offered | shown | withheld |
| `none` | not offered | never green | withheld |

*Detail* is what distinguishes `terse` from `full`: the truth table's per-cell
green and red, the proof editors' inline compiler squiggles, the sentence naming
which formula came out wrong. Under `terse` the student is told whether the work
is right and goes hunting for the error themselves.

Writing nothing means `none` while the assignment's grades are withheld and
`full` once they are out — resolved per assignment rather than at compile time,
since one piece of content can be a graded exam in one course and a practice set
in another.

**Releasing grades does not override an author.** It settles what they left
unsaid and nothing more, so `feedback="none"` stays shut after the grades go
out — which is what lets a question be set again next term.

The truth table and the model each had their own spelling of this before there
was a shared one, and both still work: `check="cells"` / `check="on"` means
`full`, `check="terse"` means `terse`, and `check="off"` or the `nocheck` option
flag means `none`. Writing `check` and `feedback` on the same exercise earns a
diagnostic (`redundant_check_attribute`); `feedback` wins.

### Numbers wait for the release date

A per-exercise score needs two things: grades released, *and* an exercise
willing to say anything at all. So `feedback="full"` on an assignment whose
grades are still withheld shows a student every marked cell and every compiler
message and no `0 of 2` — a score is a grade, and grades are the release date's
business. And `feedback="none"` withholds the number after release too, because
`0 of 2` says exactly what `none` refused to say.

The assignment *total* is the release date's alone, and stays visible over a
sealed exercise. One sealed exercise among many can therefore be worked out from
the total by arithmetic; see below.

### `exam="false" feedback="none"`

A legal and useful pair, though it reads like a contradiction: nothing is said
and wrong work is not kept. What the student learns is whether the submission
stuck — the page says "nothing was recorded" and they try again. It asks them
to commit before they learn anything, which is what suppressing the local Check
is for, without holding a wrong try against them.

### What `feedback` is not

It is not a security boundary. Six of the nine exercise types are checked in the
student's own browser — the four proof types compile there, and the truth table
and the model are computable from the formulas on screen — so a student with
developer tools can run the same check the widget runs. `feedback` decides what
the page *shows*; it cannot decide what a determined reader can work out from
content they have been handed. The assignment total leaks a lone sealed
exercise the same way, by subtraction.

The seal that does hold is the recorded score, which the server withholds on its
own authority and which no client can reach. If it matters that a student cannot
learn their score before you release it, that part is enforced.

## Multiple-choice directive

The profile currently exposes nine exercise directives: `multiple-choice`,
`free-response`, `short-answer`, `truth-table`, `model`, and the four
engine-checked proof surfaces `aufbau-proof`, `aufbau-proof-tree`,
`aufbau-proof-fitch`, and `aufbau-proof-prawitz` (plus the non-exercise
`aufbau-mm0` and `style` blocks documented below).

```md
::::multiple-choice{id="truth_table_1" title="Tautology" points="2"}
Which sentence is a tautology?

- [x] excluded_middle | P or not P
- [ ] contradiction | P and not P
::::
```

### Attributes

`id` is required. It is the stable exercise ID stored in the compiled document
and manifest. Any 1 to 64 characters will do, so long as none of them is a
space — the rule is HTML's own rule for an `id`, since that is what the ID
becomes on the page. So `ex1.2`, `1.2`, and `σ1` are all IDs, but they have to
be written `id="ex1.2"` rather than `{#ex1.2}` for the reason above. IDs must be
unique within a content revision, and are compared exactly: two IDs that differ
only in how an accent is encoded are two IDs.

`title` is optional. It is stored in the manifest for instructor and later
assignment views.

`points` is optional. It defaults to `1`. When present, it must be a positive
number no greater than `1000`.

`mode` is optional. It defaults to `single`. Supported values are `single` and
`multiple`.

`exam` and `feedback` are optional and shared by every exercise directive; see
[Recording and feedback](#recording-and-feedback). Note that outside exam mode
the accept/reject response itself reveals whether an answer is correct, so
anything summative should be marked `exam`.

### Body

The body starts with the prompt. The prompt may use the same prose Markdown
subset listed above.

Options begin with task-list style lines:

```md
- [x] option_id | Correct option text
- [ ] other_id | Incorrect option text
```

Use `[x]` or `[X]` to mark a correct option. Use `[ ]` to mark an incorrect
option.

Each option ID must start with a letter and may then use letters, numbers,
underscores, or hyphens. It may be at most 64 characters long. Option IDs must
be unique within the exercise.

The text after the `|` is the student-facing option label. Inline Markdown
renders in labels; raw HTML is still rejected.

After the first option line, only option lines and blank lines are allowed.
Additional prose after options is rejected.

### Answer-key rules

In `single` mode, exactly one option must be marked correct.

In `multiple` mode, at least one option must be marked correct.

The current grader uses exact-match scoring. A submitted answer receives full
credit when the selected option IDs exactly match the correct option IDs. Any
other valid selection receives zero credit.

## Free-response directive

Use free-response for manually graded text answers:

```md
::::free-response{id="explain_validity" title="Explain" points="5" rubric="Mention truth preservation."}
Explain why the argument is valid.
::::
```

The common `id`, `title`, `points`, `exam`, and `feedback` attributes have
the same meanings as for multiple choice (`exam` has no effect today because
free-response answers always record; `feedback` only governs whether the
recorded score comes back before release, since there is nothing to check in
the browser). The whole
body is rendered as the student prompt.

`rubric` is optional. It is private assessment data: it is stored in the
manifest and shown to instructors during submission review, but it is not part
of the compiled student document, the exercise island, or student answer
review.

Free-response answers use `free-response-answer@1`. They are normalized and
recorded, but they do not produce automatic evaluations. Instructors can add
manual evaluations later.

## Short-answer directive

Use short-answer for automatically checked text answers:

```md
::::short-answer{id="rule_name" answer="modus ponens" points="2"}
Name the rule used in this inference.
::::
```

Use `answers` with `|` separators for several accepted answers:

```md
::::short-answer{id="rule_abbrev" answers="modus ponens|MP"}
Name the rule.
::::
```

Short-answer matching trims the submitted answer. Matching is
case-insensitive by default. Set `case-sensitive="true"` to require exact
case. The accepted answers are private manifest data and are not included in
the compiled student document.

Short-answer exercises are automatically checked, so the `exam` attribute
applies exactly as it does for multiple choice: without it, only correct
answers are recorded.

## Truth-table directive

Use truth-table for an interactive truth table in Carnap `prop` notation. The
student fills a grid; a local **Check** grades it in the browser, and Submit
records an authoritative server grade. In the `simple` variant, formulas are
markdown list items (a single bullet may hold several comma-separated formulas);
prose before the first list item is the prompt.

```md
::::truth-table{id="demorgan" variant="simple" check="terse" points="4"}
Fill in both tables. If they agree on every row, the formulas are equivalent.

- ~(P /\ Q)
- ~P \/ ~Q
::::
```

The `validity` variant instead takes a single **sequent** line — comma-separated
premises, `:|-:`, comma-separated conclusions — with any prose before it as the
prompt. Its grid gains a `⊢` turnstile column the student marks `T`/`F` per row
(`F` where every premise is true and every conclusion false — a counterexample
to validity):

```md
::::truth-table{id="modus-ponens" variant="validity"}
Is this argument valid?

P, P -> Q :|-: Q
::::
```

The `partial` variant asks the student to fill in a **single free row** — they
choose the atom valuation and complete that one row. Formulas are list items, as
in `simple`. Any-valuation rows are accepted by default.

Any variant may **prepopulate cells** with a trailing positional **given grid**
(Carnap's "bar" form): `refTokens | f1Tokens | … | fNTokens` per row, where `T`/`F`
pin a value and `.` leaves the cell to the student. The reference segment has one
token per atom; each formula segment has one token per cell of that formula. Rows
may be sparse — a reference token is a pattern over the 2ⁿ rows (`.` is a
wildcard). For `simple`/`validity` a seeded value must equal the computed key
(else `given_conflicts_with_key`); `strictGivens` locks the seeded cells (inert,
ungraded), otherwise they are editable and graded. For `partial` each grid row is
one accepted alternative (`hiddenGivens` keeps it off the grid; `strictGivens`
freezes a lone visible one):

```md
::::truth-table{id="assume-q" variant="partial" options="hiddenGivens"}
Make Q -> P true, assuming Q is true.

- Q -> P

. T | . T .
::::
```

Alongside the common `id`, `title`, `points`, `exam`, and `feedback`
attributes, it accepts `variant` (`simple` | `validity` | `partial`), `fill` (`all` | `connectives` |
`main` — which cells the student fills; not applicable to `partial`), `grading`
(`all-or-nothing` | `partial`), `check` (`cells` | `terse` | `off` — this type's older
spelling of `feedback`), `counterexample-to` (`tautology`/`validity` | `equivalence` |
`inconsistency`/`contradiction` — the property a counterexample row must show;
on a `validity` table the premises stay all-true and the property applies to the
conclusions, which also defines the turnstile column), `trueMark` / `falseMark`
(display glyphs for true/false cells; the recorded answer stays `T`/`F`),
`system` (an `aufbau-mm0` block name or a language spec id, defaulting to
`carnap-prop`; any language will do, and a formula using something a table has
no column for is refused where it is written), and an
`options` string of Carnap flags (`autoAtoms`, `nodash`, `nocheck`,
`nocounterexample`, `hiddenGivens`, `strictGivens`, `double-turnstile`,
`negated-double-turnstile`; `immutable` — Carnap's whole-table display lock — is
recognized but not yet effective).
On the `simple` and `validity` variants a student may fill the table and then
mark one row of it as a counterexample, submitting that row instead of the whole
table (unless `nocounterexample`).
Notation is whatever the system spells — `~ /\ \/ -> <->` with single-letter
atoms in the default `carnap-prop`; the sequent turnstile is `:|-:`.

The full reference — every option, the notation and precedence rules, the answer
shape, and the roadmap — lives next to the code in
`src/worker/exercises/truth-table/README.md`.

## Model directive

Use `model` for a **finite-model** exercise in the tradition of Carnap's
countermodel problems. The student describes a model — a domain, and an extension
or a value for every symbol the sentences use — and the exercise says whether
that model has the property asked for. The fields are not authored: they follow
from the sentences. A local **Check** grades in the browser and Submit records a
server grade; the two agree by construction, since a model exercise has no answer
key and both run the same check.

Sentences are markdown list items, and prose before the first one is the prompt.
A single bullet may hold several comma-separated sentences.

```md
::::model{id="two_at_once" title="Two at once" points="3"}
Build a model in which both of these come out true.

- ExF(x), Ex~F(x)
::::
```

Notation is whatever `system=` names; the default, and everything described
here, is **forallx: Calgary, 2019 and later**. A set written for the original
*forallx* takes `system="forallx-magnus"` and is written in that book's
notation instead — juxtaposed predicates (`Fa`, `Rab`), `&` for conjunction,
`@x`/`3x` for the quantifiers. The differences are tabulated under "Which
forallx" below. The Calgary notation: `Ax`/`Ex` (or `∀`/`∃`, `@`/`3`)
immediately followed by a variable from `s`–`z`; predicates any uppercase letter
with parentheses (`F(x)`, `R(x,y)`), a bare uppercase letter being a sentence
letter; names `a`–`e`; function letters `f`–`r`, a bare one being a constant and
`f(x)` an application; `=` and `!=`/`≠`; connectives `~ /\ \/ -> <->` plus the
usual symbol aliases.

The lowercase alphabet is cut three ways because the artifact declares it that
way, and the cut is what lets the proof system state ∀I's eigenvariable proviso
by typing rather than as a side condition. Carnap's own Calgary options drew
constants from `a`–`r` and functions from `a`–`t`, overlapping and resolved by
parser try-order; a declared lexicon cannot overlap. See the header of
`/theories/forallx-calgary-2019.mm0`.

Those are the spellings an author *types*. A formula is *shown* in logical
symbols — `∀x∀yf(x,y)=f(y,x)` for what is written `AxAyf(x,y) = f(y,x)`, and
`(P ∧ Q) ∨ R` for `P /\ Q \/ R` — every binary compound parenthesized except
the outermost, as the original prints them.

Three of its rules catch people out, and all three are Carnap's own behaviour: a
quantifier's scope is the sentence **immediately** after it (`AxF(x) -> G(a)` is
a conditional, not a quantified conditional); `/\` and `\/` share one
precedence level left-associatively, while `->` and `<->` join nothing
unbracketed at all — `P -> Q -> R`, `P -> Q <-> R` and `P /\ Q -> R` are each
an error, and want their parentheses; and parentheses may only wrap a two-place compound,
so `(P)`, `(~P)` and `(a = b)` are errors. Every sentence must be closed — an
unbound variable is rejected. Not accepted, though Carnap takes them: the word
operators `not`/`and`/`or`, `^n` arity annotations, and `v` for disjunction.

The `validity` variant takes a single **sequent** line — comma-separated
premises, `:|-:`, comma-separated conclusions — and asks for a model that makes
every premise true and every conclusion false:

```md
::::model{id="someone" variant="validity" points="4"}
Everyone likes someone; so there is someone everyone likes. Show that this does
not follow.

AxEyR(x,y) :|-: ExAyR(y,x)
::::
```

The `constraint` variant takes one `- constraints : sentences` **list item**: the
constraints have to come out true as well, which is how an author stops a
universal sentence being satisfied by a domain of one. They are not shown to the
student, so the prompt should say what they are if the student needs to know. (A
list item rather than Carnap's bare `:` line, because a prompt ending "Find a
model where:" would otherwise be read as the constraints.)

```md
::::model{id="not_free" variant="constraint"}
Make this true — and no cheating with a one-element domain.

- ExEy~x = y : AxAyF(x,y)
::::
```

Any variant may **seed a field** with a trailing `| Field : value` line, keyed by
the label the exercise shows (`Domain`, `F(_,_)`, `a`, `f(_)`). A given naming a
field the exercise does not have, holding something that field could not contain,
or repeating a field, is a compile error. `strictGivens` locks the givens, turning
a hint into a requirement. A function's given is read row by row — `f(_) : [0;1]`
fixes `f(0) = 1` and leaves every other argument to the student — so under
`strictGivens` it locks those cells of the value table and no others.

```md
::::model{id="seeded" options="strictGivens"}
- AxEyR(x,y)
| Domain : 0,1,2
::::
```

Alongside the common `id`, `title`, `points`, `exam`, and `feedback`
attributes it accepts `variant` (`simple` | `validity` | `constraint`), `system` (an `aufbau-mm0` block name or a language spec id;
`forallx-calgary-2019` or `forallx-magnus` today — see "Languages and theories" below), `counterexample-to` (`validity`/`tautology` |
`equivalence` | `inconsistency`/`contradiction` — the property the targeted
sentences must have, defaulting to all-true for `simple` and `constraint` and
all-false for `validity`), `check` (`on` | `off` — this type's older spelling
of `feedback`), and an `options` string of
Carnap flags (`nocheck`, `strictGivens`, `double-turnstile`,
`negated-double-turnstile`; `forallxStyle` is recognised but not yet effective).

A domain is up to 16 naturals. Extensions are tuples in `[…]`, `(…)` or `<…>`
(`[0,0],[1,0]`, or bare numbers for a one-place predicate); a constant is a menu
of the domain; a function gets a **generated value table** — a menu of the domain
for every argument tuple, laid out as a grid with the last argument heading the
columns — so it cannot be left partly undefined. The recorded answer is the raw text
of each field, so review shows what the student typed.

The full reference — every option, the notation rules, the field languages, the
answer shape, and the roadmap — lives next to the code in
`src/worker/exercises/model/README.md`.

## Translation directive

Use `translation` for a **symbolization** exercise in the tradition of Carnap's
`Translate`: the prose poses a natural-language sentence, and the student types
a formula for it. The answer counts as correct when it is **logically
equivalent** to one of the author's solutions (and, for `variant="exact"`, only
when it *is* one of them). Notation is the same forallx: Calgary system the
model directive documents above, typed and displayed the same way.

Solutions are markdown list items — one admissible symbolization per bullet, or
Carnap's comma-separated alternates within one — and prose before the first
bullet is the prompt.

```md
::::translation{id="fine" variant="first-order" points="2"}
Everything is fine.

- AxF(x)
::::
```

An equivalent answer in different clothes — `~Ex~F(x)` here — checks and grades
correct. Checking is live, as in the proof types: the widget reads the typed
ASCII back in logical symbols as the student types, the correctness mark tracks
on a pause, and **Enter** checks immediately (there is no Check button). Under
the hood the check is the Aufbau engine's `auto?` proof search, run over a
one-sided sequent calculus, producing an equivalence *certificate* which Submit
records and the server independently re-verifies — the same
client-compiles/server-verifies boundary the proof directives use.

Two consequences of that design are worth knowing when setting assignments:

- **The solutions are visible to a determined student.** The browser proves
  equivalence *to a solution*, so the solutions ship with the exercise — as
  they did in the original Carnap. `feedback`/`exam` control what is said and
  recorded, not what a devtools user can find.
- **Equivalence is judged by proof search under a budget**, not by a decision
  procedure. The search covers the textbook catalogue (commutations, De Morgan,
  conditional and biconditional interchange, distribution, quantifier passage
  and permutation, alpha-variants, prenexing in either direction) and refuses
  genuine non-equivalences by exhausting its space; but search is bounded, so a
  far-fetched equivalence can in principle time out and be marked wrong — the
  same trade the original Carnap made. The escape hatch is the bullet list:
  naming the shapes you will accept as separate solutions always works.

`variant` selects Carnap's three classes: `prop` (the default — sentence
letters and connectives only, and a first-order solution or answer is
rejected), `first-order`, and `exact` (syntactic comparison after parsing; for
"what is the missing premise" exercises, where an equivalent formula is not an
answer).

`tests` imposes extra conditions on the submission, with Carnap's names:
`CNF`, `DNF`, `PNF` (first-order only), and the counters `maxCon:N`,
`maxNeg:N` (alias `maxNot:N`), `maxAnd:N`, `maxOr:N`, `maxIf:N`, `maxIff:N`,
`maxFalse:N`, `maxAtom:N`. An answer must be equivalent **and** pass every
test, so `tests="CNF"` with a non-CNF solution is a legitimate exercise.

```md
::::translation{id="prenex" variant="first-order" tests="PNF maxNeg:0"}
Nothing is not bananas.

- ~Ex~B(x)
::::
```

`starter` prefills the input box (Carnap's partial solution — it may be prose),
and `options` takes `nocheck` (this type's spelling of `feedback="none"`) and
`checksyntax` (refuse to submit text that does not parse). The common `id`,
`title`, `points`, `exam`, and `feedback` attributes apply as everywhere, and
`system` names the language: an `aufbau-mm0` block declared earlier in the
document, or one of the ids the server ships (see "Languages and theories"
below).

The full reference — the check's architecture, the rewrite theory and its
known gaps, the answer shape — lives next to the code in
`src/worker/exercises/translation/README.md`.

## Aufbau-proof directive

Use `aufbau-proof` for a proof the student writes and the **Aufbau engine**
checks. It pairs with an `aufbau-mm0` block that declares the theory (sorts,
terms, axioms) the proof is built from. The student's browser compiles the proof
to an MMB certificate as they type — showing "Verified ✓" or the engine's
diagnostic live — and the worker independently re-verifies that certificate on
submit. (The client compiler is an untrusted convenience; the server verifier is
the arbiter.)

Declare a theory with `aufbau-mm0`. Give it a `name` other proof blocks
reference. Its MM0 comes from a `src` naming a theory this site serves, from its
body (raw MM0, not Markdown), or from both.

### Naming a theory the site serves

Most courses teach a system somebody has already written down, so the usual
block is one line and no body:

```md
:::aufbau-mm0{name="forallx" src="/theories/forallx-calgary-2019.mm0"}
:::
```

These paths are real. Open one in a browser and you get the theory itself — the
axiom names your students will cite, and the commentary that ships with them.
Four are available:

| Path | System |
| --- | --- |
| `/theories/forallx-calgary-2019.mm0` | *forallx: Calgary* natural deduction, the full first-order fragment. Sequents `Γ ; φ ⊢ ψ`; the Fitch and Prawitz surfaces are built for it. Also the language `system="forallx-calgary-2019"` names. |
| `/theories/forallx-magnus.mm0` | *forallx* (P.D. Magnus, the original) — system QL: the same Fitch shape, but the book's own rules and notation. Also the language `system="forallx-magnus"` names. |
| `/theories/gentzen-lk.mm0` | Classical LK, a multi-conclusion sequent calculus with both sides comma-separated. An LK derivation is a tree, so this is the tree surface's system. |
| `/theories/carnap-prop.mm0` | Carnap's default `prop` — a propositional *signature* with no rules of its own, which is what the truth-table type reads. Name it here and add your own rules in the block body to build a system over its notation. |

A `src` must be a path this site serves — one of the four above, or one of
yours (below). A theory kept on another server is not supported: the text is
frozen into the exercise when you save, and putting a third party's uptime
inside that save — and inside the live preview, which compiles in your browser
under a policy that permits only same-origin requests — would make saving a
lesson fail for reasons that have nothing to do with the lesson. Copy the MM0
into the block instead.

### Hosting a theory of your own

A system nobody has published, or one of the three with your course's own
vocabulary added, does not have to be pasted into every lesson that uses it.
Create a content item and choose **Theory or language** for its kind: its
revisions hold MM0 instead of Markdown, and saving one checks that the file
reads. The revision page then shows its address, which is what a lesson's
`src=` names:

```md
:::aufbau-mm0{name="ours" src="/content/revisions/01JD…/theory.mm0"}
:::
```

Four things follow from that being a *revision's* address.

**It is fixed.** There is no spelling that means "the latest". Revising your
theory leaves every lesson that named an earlier revision exactly as it was —
which is the point, because a proof that verified last week should not stop
verifying because somebody widened a signature. To move a lesson onto a new
revision, save a new revision of the lesson with the new address in it.

**Your students never fetch it.** The MM0 is frozen into the exercise when the
lesson is saved, so the address is resolved once, by you, at authoring time.
A student's browser never asks for it, and nothing in an assignment depends on
it still being there.

**It is yours until you share it, one revision at a time.** A saved revision
starts readable by its owner alone. Each row of the item's revision list
carries a sharing control — keep it to yourself, open it to anyone on this site
who writes content, or make it public — and whoever the scope admits can name
*that* address from their own lessons. Sharing revision 7 shares revision 7:
the drafts behind it stay yours, and so does the next one you save.

Two things follow from the freeze, and the control says both. Sharing is
checked when a colleague *saves* something that names your revision, so
narrowing the scope afterwards leaves their saved lessons exactly as they are:
nothing breaks, and nothing comes back. And what they saved carries the text —
their students read your MM0 out of their lesson, because that is where it was
frozen. There is no scope that lets a colleague name a theory without passing
its text on.

**A theory can be a language too.** If the file gives its sentence sort
`@syntax role sentence`, the revision page says so, and formulas written
against it read the way the section on languages below describes. To set a
model or translation exercise in it, name it from an `aufbau-mm0` block —
`src="/content/revisions/<id>/theory.mm0"` — and write that block's name in the
exercise's `system=`. `system=` takes a name in scope, not an address.

### Extending a theory, and writing one

A course with its own vocabulary puts the extra declarations in the body of the
same block. They arrive after everything the path brought, and the engine reads
the result as one theory:

```md
:::aufbau-mm0{name="forallx" src="/theories/forallx-calgary-2019.mm0"}
--| @syntax delimiter $ Cube Loves $
term Cube (x: tm): wff;
term Loves (x y: tm): wff;

--| @congr
axiom Cube_congr (a b: tm): $ a = b $ > $ Cube a ↔ Cube b $;
--| @congr
axiom Loves_congr (a b c d: tm): $ a = b $ > $ c = d $ > $ Loves a c ↔ Loves b d $;
:::
```

The shipped signature is deliberately small — unary `F`, `G` and binary `R` —
so this is the ordinary way to teach with `Cube` or `Loves`. Congruence axioms
are what let `=E` replace equals inside your new predicates; without them the
predicate still parses and proves, it simply cannot be rewritten through.

**A multi-character name needs that first line, and forallx is where.** Where a
chunk of what a student types ends is decided by the *delimiters*, before
anything is looked up, and forallx declares all 52 Roman letters as delimiters
so that `AxF(x)` reads with no spaces in it. `Cube` therefore segments as `C u
b e`, and the block is refused with the pieces named:

> This MM0 does not read: the delimiters split “Cube” into C u b e, so nothing
> anyone types can be read as it. Declare it whole by adding a line reading:
> `--| @syntax delimiter $ Cube $`

Declaring the name as a delimiter is what fixes it: the longest spelling wins,
so `Cube` outranks the `C` beside it and reads as one name, while `C(a)` goes
on meaning what it did. One line covers any number of names. `carnap-prop`
declares no letters, so a propositional course adds `Rain` or `P1` with no such
line — the requirement belongs to languages whose quantifier prefixes have to
read tight, not to extension as such.

A block with a body and no `src` is a theory written from scratch, which is what
a system nobody has published yet needs:

```md
:::aufbau-mm0{name="prop"}
delimiter $ ( ) $;
provable sort wff;
term imp (a b: wff): wff; infixr imp: $->$ prec 25;
axiom top_i: $ top $;
axiom ax_1 (a b: wff): $ a -> b -> a $;
:::
```

### Showing a theory to students

A declared theory does not appear in the lesson. MM0 source is machinery, and a
course that gives students its rules in a textbook rarely wants a slab of it
above every exercise. Add `show` when you do want it readable — it renders a
collapsed disclosure panel, labelled with the theory's name, that opens to the
source, extension and all:

```md
:::aufbau-mm0{name="forallx" src="/theories/forallx-calgary-2019.mm0" show}
:::
```

An `aufbau-proof` block names the system it is set in and states the goal. The
body reads: prose (the prompt), then a single `theorem <name>: $ … $` line (the
goal, in MM0 declaration syntax), then a `----` underline, then the starter proof
body the student edits:

```md
:::aufbau-proof{system="prop" id="identity"}
Prove the law of identity.

theorem thm_k (a b: wff): $ a -> b -> a $
----
l1: $ a -> b -> a $ by ax_1 []
:::
```

The compiler freezes the theory plus the goal declaration into the exercise's
`publicData.mm0` — that frozen mm0 is the sole input the worker verifies against,
so the certificate is bound to the exact goal you wrote (a proof of a different
statement will not verify). The student edits only the body below the underline;
the goal header stays fixed.

Alongside the common `id`, `title`, `points`, `exam`, and `feedback`
attributes it takes the required `system` (an `aufbau-mm0` block declared
earlier in the document, or one of the ids the server ships — see "Languages and
theories" below) and an `options` string of editor toggles: `auto` exposes the
compiler's `auto?` proof search, `complete` exposes rule-name completion (both
off by default — appropriate for introductory work, worth enabling for a course
where search is expected). The proof-script format (proof lines, `by`, rule
applications, `auto?`) is documented in the engine repository's `docs/proof.md`.

v1 is a plain text editor; richer GUIs on the same engine may follow. The
`auto?`/completion wiring is not implemented yet. The full reference lives next
to the code in `src/worker/exercises/aufbau-proof/README.md`.

## Languages and theories

**Every exercise that reads a formula takes `system=`, and they all mean the
same thing by it: an MM0 file.** That is the whole of this section, and it is
worth stating plainly because it used to be false — proofs took `theory=` and
could only name a block, while a model or translation took `system=` and could
only name a language the server shipped.

A **theory** is what a proof is built from — sorts, terms, axioms, the rules a
student cites by name. It is what `/theories/forallx-calgary-2019.mm0` serves,
and what an `aufbau-mm0` block declares.

A **language spec** is what a formula is written in — the same sorts and terms,
plus `@syntax` annotations saying how a student *spells* them: which brackets
group, which spellings of `∧` are accepted, which of them is canonical, and
which conventions the book refuses (forallx: Calgary will not read `P → Q → R`
or `P ∧ Q → R`, and will not let you write `(P)`). Three ship, and `system=`
names any of them by id:

| Id | Language |
| --- | --- |
| `forallx-calgary-2019` | *forallx: Calgary* first-order syntax — predicates with parentheses, `∧` canonical. |
| `forallx-magnus` | *forallx* (P.D. Magnus) first-order syntax — predicates juxtaposed (`Fa`, `Rab`), `&` canonical. |
| `carnap-prop` | Carnap's default `prop` — the truth-table type's default, ASCII connectives and 52 sentence letters. |

They live in `src/worker/logic/theories/` alongside the proof systems, and are
served at `/theories/<id>.mm0` like them — a language and a proof system are the
same kind of artifact, and each forallx edition is one file playing both parts.
Being MM0 is not a formality: an exercise type reads one by asking what role
each constructor plays (`@syntax role conjunction`), so nothing in the server
knows that this book calls conjunction `/\` or that book calls it `∧`. Adding a
textbook's notation is a file, not a code change — which is what has to be true
before an instructor can bring their own, and it is now true for every type that
reads a formula.

The same channel names the **rules** the way the book does. MM0 identifiers are
ASCII, so an axiom is `and_intro` and can never be `∧I`; an alias line on the
rule says what a proof may cite it as, and the proof types resolve the citation
before the engine sees it:

```mm0
--| @syntax alias ∧I /\I &I
axiom and_intro (ga de si: ctx) (ph ps: wff):
  $ ga ⊢ ph $ > $ de ⊢ ps $ > $ ga ; de ; si ⊢ ph ∧ ps $;
```

Several spellings on one line, or several lines, both read; an alias is one
whitespace-free token, and it must mean exactly one rule — a name any rule
already has, or one another rule already claimed, is a compile error in the
theory. The shipped forallx systems carry the book's name for every rule
(`→E`, `∧I`, `¬I`, `X`, `IP`, `∀E`, …, and `AS` for the assumption rule). A
name the book gives to *two* axioms, one per side — `∧E`, `∨I`, `↔E` — sits on
the second of them, which carries the engine's `@fallback` onto the first: a
line citing `∧E` lowers to `and_elim_r`, and when that side does not fit the
engine retries with `and_elim_l`, so the student never says which. A theory of
your own does the same with two annotation lines on the later axiom:

```mm0
axiom and_elim_l (ga de: ctx) (ph ps: wff): $ ga ⊢ ph ∧ ps $ > $ ga ; de ⊢ ph $;
--| @fallback and_elim_l
--| @syntax alias ∧E /\E &E
axiom and_elim_r (ga de: ctx) (ph ps: wff): $ ga ⊢ ph ∧ ps $ > $ ga ; de ⊢ ps $;
```

An alias works wherever a rule is cited: a Fitch justification, a tree or
Prawitz node, and a starter proof. The linear `aufbau-proof` type is the
exception: its lines are engine text and go to the compiler as written, so
there a rule is its identifier.

An alias says how a rule is *written*; a role says what it *is*. The Fitch and
Prawitz types have to know which axiom opens a hypothesis, and they read that
off the theory too — `@syntax role assumption` on the axiom, beside its alias.
Nothing on the exercise says it, since it is a fact about the calculus, not
about any one proof:

```mm0
--| @syntax role assumption
--| @syntax alias AS
axiom ax (ga: ctx) (ph: wff): $ ga ; ph ⊢ ph $;
```

**`system=` resolves in one order: your document, then the server.** A name
matches an `aufbau-mm0` block declared earlier in the same document first, and
one of the ids above second — so a course that extends forallx with its own
`Cube` and `Loves` can call the result `forallx` and set proofs, models and
translations in it without any of them disagreeing about what `A` means. A name
that is neither is a compile error naming both lists.

**A type asks nothing of the language beyond its being one.** Any spec that
reads may be named by any of the seven types: propositional translation in
`carnap-prop` and a truth table over forallx's predicate letters are both
ordinary, and both were refused while this was a property of the language. What
a type cannot interpret is refused *per formula*, at the construct that caused
it — write `Ax F(x)` in a truth table and the complaint names `∀` and points at
it, because there is no column for a binder. A spec that does not read at all is
still refused as a whole, since there is nothing to write formulas in.

Which constructs a type reads is fixed by the `@syntax role` annotations it has
a case for, and the list is closed: a role a type has no reading for is refused
rather than treated as opaque, so an unfamiliar connective can never be quietly
given a free truth value. A constructor with *no* role is the open half — a
sentence letter, or a predicate letter applied to terms — and a truth table
gives each distinct one (`F`, `F(a)`, `R(a,b)`) its own column.

**A symbol is read from the tree, not from its notation.** The model and
translation types take a role-less constructor as a predicate when it returns
the sentence sort and a function otherwise, named by the constructor and applied
to whatever its binders hold — so `term plus (x y: tm): tm;` with `infixl plus:
$+$` reads `a + b` as `plus` of two arguments, and `term Red (x: tm): wff;`
reads `Red(a)` with no notation at all. A textbook's *variadic* letters, where
`F`, `F(a)` and `R(a,b)` are one declaration, take a single binder at a list
sort, and the spec marks that sort:

```
--| @syntax role argument-list
sort seq;
```

A node of that sort is flattened by structure — its own binders at the list
sort recurse, any other is one argument — so an elided empty list, a comma, a
juxtaposition, or a cons all read the same way and the reader is never told a
constructor's name. Leave the role off and every binder is one argument, which
is right for a language whose symbols all have fixed arity. A binding
constructor with no role the type has a case for — a description operator, say
— is refused where it stands, since a finite model has no value for it.

**Every truth function has a role, not just the five a textbook opens with.**
Which connectives a course takes as primitive is the textbook's business:
Quine's stroke, exclusive disjunction, NAND and NOR before anything else in a
digital-logic course. So all sixteen binary truth functions are named, and a
course that wants one declares the constructor in its own `aufbau-mm0` block and
annotates it — no change to the server, and the truth table, the model and the
translation all read it. A truth table gives it a column, a model evaluates it,
and a translation's proof search is handed inference rules for it — so `P ↑ Q`
is *proved* equivalent to `~(P /\ Q)` rather than quietly rewritten into it.

| Role | Truth function |
| --- | --- |
| `negation` | ¬p (unary) |
| `verum` / `falsum` | ⊤ / ⊥ (nullary) |
| `conjunction` | p ∧ q |
| `disjunction` | p ∨ q |
| `conditional` | p → q |
| `biconditional` | p ↔ q |
| `nand` | ¬(p ∧ q) |
| `nor` | ¬(p ∨ q) |
| `exclusive-disjunction` | p ⊻ q |
| `converse-conditional` | q → p |
| `non-conditional` | p ∧ ¬q |
| `converse-non-conditional` | ¬p ∧ q |
| `left-projection` / `right-projection` | p / q |
| `negated-left-projection` / `negated-right-projection` | ¬p / ¬q |
| `binary-verum` / `binary-falsum` | ⊤ / ⊥ as two-place functions |

The last six are degenerate and nobody teaches them, but they are named for the
same reason the other ten are: the list is a closed whitelist, and a hole in it
is a construct refused for a reason no author can act on. Roles that are not
truth functions — `forall`, `exists`, `identity`, `inequality`, `sentence`,
`argument-list`, `turnstile`, `context-join` — are read by the types that have
a use for them,
and refused by the ones that do not: a truth table has no column for `∀`.

Here is a course whose textbook uses the stroke, over `carnap-prop`:

````markdown
:::aufbau-mm0{name="ours" src="/theories/carnap-prop.mm0"}
--| @syntax delimiter $ | $
--| @syntax role nand
term nand (p q: wff): wff;
infixl nand: $|$ prec 40;
:::

::::truth-table{system="ours"}
Fill in the table.

- P | Q
- ~(P /\ Q)
::::
````

Both formulas get their columns, and the widget's Check grades the stroke's
column like any other. The `@syntax delimiter` line is not optional: input is
segmented by declared delimiters before anything is looked up, so a spelling
that is not a delimiter will not be found. See the notes on delimiters in
`@aufbau/syntax`'s spec-authoring guide.

**The vocabulary is finite**, because an MM0 signature is. forallx gives you 26
predicate letters `A`–`Z`, five names `a`–`e`, thirteen function letters
`f`–`r`, and eight variables `s`–`z`; `carnap-prop` gives you 52 sentence
letters. Subscripted letters (`F_12`, `P0`) are *not* available: the
hand-written parsers these replaced read an unbounded subscript, and that was
given up in the move (2026-08-24) rather than hold the unification for it.

**A name is not a variable and cannot be one.** They are separate sorts, which
is what lets forallx's proof system state ∀I's eigenvariable proviso as MM0
dependency typing rather than as a side condition nobody checks. The cost is
that the pools cannot overlap the way Carnap's own dialect table let them:
`a` takes no arguments, and `f` cannot be an eigenvariable.

**One written form, not two.** A formula is stored in the spec's canonical
spelling of each symbol — its last-declared notation — and that is also what a
reader is shown. For forallx that is the glyphs (`∀x(F(x) → G(x))`); for
`carnap-prop`, which declares nothing but ASCII, it is the ASCII you typed.
Either way it is text the parser accepts back.

**A language and a proof system can be one file, and for both forallx editions
they are.** `system="forallx-calgary-2019"` on a model or translation exercise and
`src="/theories/forallx-calgary-2019.mm0"` on an `aufbau-mm0` block resolve to
the same bytes, so a course cannot set a model exercise and a Fitch proof that
disagree about what `A` means. What made it possible is a sort: `⊢` yields a
`judgement`, student input is read at `wff`, and so a sequent cannot be built
where a sentence goes — checkable rather than merely intended.

Two things follow for anyone writing goals against that theory. Its context
separator is `;`, not `,`, because the comma is already the student's argument
separator in `R(a,b)` and MM0 gives a math token one meaning — the theory says
so itself (`@syntax role context-join`), so the proof types pick it up and no
exercise has to repeat it. And the ASCII quantifiers `A`/`E` are student
spellings only: `A` is also a predicate letter, one file cannot declare it as
both, so the notation comes off and an elaboration rule puts the spelling back
for input. `∀`, `∃`, `@` and `3` are unaffected.

### Which forallx

Two editions ship, and they are different books, not one book in two spellings.
Pick by which one your course assigns; a lesson written for one does not compile
against the other, which is the point — the rules really do differ.

|  | `forallx-calgary-2019` | `forallx-magnus` |
| --- | --- | --- |
| Atomic sentences | `F(x)`, `R(a,b)` | `Fx`, `Rab` — juxtaposed, no punctuation |
| Conjunction, as shown | `∧` | `&` |
| Names / variables / functions | `a`–`e` / `s`–`z` / `f`–`r` | `a`–`w` / `x`–`z` / none |
| ASCII quantifiers | `A`/`E`, `@`/`3` | `@`/`3` only |
| `⊥` | yes, with `X` (explosion) and `IP` | no — a contradiction is an explicit pair |
| `∨E` | proof by cases, two subproofs | modus tollendo ponens: `φ ∨ ψ`, `¬φ` ⊢ `ψ` |
| `¬I` / `¬E` | one subproof, ending in `⊥` | two premises, `ψ` and `¬ψ`, under the assumption |
| `P ∧ Q → R` | refused; bracket it | reads — `∧`/`∨` bind tighter than `→`/`↔` |
| `(P)` | refused; groups take binary compounds only | reads |

Magnus's reductios take two premises because the system has no `⊥` to collapse
them into one. In a Fitch proof both come out of the same subproof, and the
citation is the book's: **one range whose subproof ends with the contradictory
pair** — `neg_intro 2-5`, where line 4 is `ψ` and line 5 is `¬ψ`, in that
order. How many premises a range supplies is inferred from the rule's own
signature (premises assuming the same formula are one cited subproof), not
declared anywhere. Citing the subproof once per premise — `neg_intro 2-4 2-5`
— is the explicit spelling and works identically, and it is also the shape for
two sibling subproofs, which satisfy the rule equally well. The rule names are
otherwise the ones Calgary uses, and each theory's own header has the full
table.

Magnus's `A` and `E` are **not** given back as quantifier spellings. Carnap
reads `AxFx` as `∀x Fx` and `Axy` as the predicate `A` of `x` and `y`, by
trying one reading and backing out of it; under juxtaposition no rewrite can
do that, so this edition spells the quantifiers `@x` and `3x` (or `∀x`, `∃x`)
and `A` is only ever a predicate letter. It is the one habit that does not
transfer.

### Formulas in a proof

A Fitch, tree or Prawitz proof set in a theory that says which sort its
formulas are in has them **read in that theory's language**, exactly as a model
or translation exercise does. The student types `Ax(F(x) -> G(x))`; the widget reads it and hands the
compiler `(∀ x ((F (x)) → (G (x))))`. Two things come with that:

- A formula that will not read is caught in the widget, with the complaint
  placed at the character that broke it, instead of arriving later as an engine
  unification failure about a line nobody can connect to what they typed.
- The book's refusals apply to proofs too. forallx admits parentheses only
  around a two-place connective, so a line reading `∀ x (x = x)` is now an
  error and must be written `∀ x x = x` — the identity is not a connective. The
  same goes for `(∀ x F(x)) ∧ G(a)`, which is `∀ x F(x) ∧ G(a)`: a quantifier's
  scope is the sentence immediately after it, so the parentheses were never
  doing anything. Both spellings mean the same thing to the engine; only one is
  the book's.

**One condition, or the proof stays engine text: the theory must name the sort
to read at** — `@syntax role sentence` for a Fitch or Prawitz line, and for a
tree node the sort `@syntax role turnstile` yields. `gentzen-lk` declares no
`@syntax` at all, so it names neither and proofs in it read as they always did.
Its formulas are perfectly readable in the abstract — the file declares its own
notations and Carnap can parse them — but nothing will guess which sort a
student's line is written in, and guessing wrong is the kind of mistake that
does not announce itself.

A goal stated as a *rule schema* is read too, in its own binders. `theorem mp
(a b: wff): $ (a → b) ; a ⊢ b $` binds `a` and `b` as stand-ins for any
sentence, and for the length of that theorem they mean something the theory's
lexicon — where `a`–`e` are names — knows nothing about. The parser is told the
binders, so `a` in a line of that proof is the metavariable, not the name, and
the student may write `~(a \/ b)` there as readily as in a goal about
particular letters. This is what the binders always meant to the engine; before
it was said out loud, schematic exercises had to stay in engine text.

**Shadowing is warned about, not refused.** Where a binder's name already means
something in the theory, the compiler says so on the goal's line and compiles
anyway — a rule schema has to call its metavariables *something*, and in a
theory that spends every letter on its lexicon there is nothing left to call
them, so only the author can tell whether a given collision was intended. A
warning does not stop the save; it is listed under the editor in gold rather
than red.

Three kinds, by what was displaced. A binder over a **variable** of another
sort (`(a: wff)` where `a` is a name) or over a **declared term** (`(f: tm)`
where `f` is a function letter) simply wins, and the warning is a note. A
binder over a **notation** — a token, or a letter an `@syntax elab` rule uses
to spell something, as `A` spells `∀` in forallx — additionally takes that
spelling away inside the exercise: a line reading `Ax F(x)` there will not
parse. That is the one worth reading twice.

Binding a name to the reading it already had is not shadowing and says nothing:
`theorem unimp {x: var}` over an `s`–`z` variable pool is every first-order
goal's normal shape.

A **starter** is read the same way at compile time, so an author who writes a
line the language refuses is told while saving the revision rather than by a
student who cannot get the editor to accept what it opened with.

So is the **goal**. The `theorem` line is an MM0 declaration, and MM0's own
math strings are engine text — `∃x` is one token to the engine, and a forallx
sentence letter on its own is a term the engine wants an argument for (the
operator spellings themselves, `\/`, `->` and the rest, are ordinary MM0
notations the engine reads) — so writing the goal the way the lines
are written, which is the only way a student ever sees it, used to hand the
engine a declaration it refused, and the refusal surfaced in the widget as an
"extra proof block with no matching theorem". Now every `$ … $` in the goal
is read through the system's language and re-printed for the engine: `theorem
cd: $ P \/ Q ; P -> S ; Q -> S ⊢ S $` and `theorem exelim {x: var}: $ ∃x F(x) ;
∀x (F(x) → G(x)) ⊢ ∃x G(x) $` both declare cleanly, and the student sees the
statement as you wrote it. A goal formula the language refuses is an
`invalid_goal_formula` diagnostic on the goal's line, carrying the parser's own
complaint. The reading is at the sort a tree node reads at — the turnstile's,
where the system declares one — falling back to the sentence sort, so a bare
`theorem t: $ P → P $` over forallx reads too. The lints a student's line is
held to — bracket discipline, chain refusal, closed sentences — are not applied
to a goal, so `(∀ x F(x)) ∧ G(a)` reads there where a line must say `∀ x F(x)
∧ G(a)`; what is refused is what is not the language at all — an explicit
`snil`, or `F a` juxtaposed where the language spells `F(a)`. `aufbau-proof` is exempt on the same terms as its
lines.

## Aufbau-proof-tree directive

Use `aufbau-proof-tree` for the **same engine-checked proof, built as a tree**
instead of typed as linear proof lines. The student assembles a natural-deduction
/ sequent tree — each node is a conclusion justified by a rule citing its premise
sub-proofs — and the browser flattens it (a postorder walk, children before
parents) into exactly the linear `.auf` the text editor produces, compiles it to
an MMB certificate, and the worker re-verifies that certificate. Grading, the
trust boundary, and the `aufbau-mm0` theory it pairs with are identical to
`aufbau-proof`; only the input surface differs.

Its body is prose (the prompt) then a single `theorem <name>: $ … $` goal line.
By default there is no starter body — the student builds the tree from a root
seeded with the goal:

```md
:::aufbau-proof-tree{system="prop" id="identity"}
Build a proof of the law of identity.

theorem thm_k (a b: wff): $ a -> b -> a $
:::
```

**Pre-populating the tree (optional).** To hand the student a partially- or
fully-built tree, add a `----` underline after the goal and then a starter proof
written in the **same linear `.auf` form the tree flattens to** — one node per
line, `<label>: $ <formula> $ by <rule> [<refs>]`, where a ref is another line's
label or a hypothesis `#n`. The compiler parses it back into a tree and the
editor seeds from it:

```md
:::aufbau-proof-tree{system="prop" id="mp-start"}
Finish the proof.

theorem mp (a b: wff): $ (a -> b) , a ⊢ b $
----
l1: $ (a -> b) , a ⊢ a -> b $ by ax []
l2: $ (a -> b) , a ⊢ b $ by imp_elim [l1, #1]
:::
```

Because the editor represents a *tree*, the starter must be one: each line may be
cited by **at most one** other line. A linear proof that reuses a line (a DAG) has
no tree form, so such a body is rejected at author time with a
`proof_is_not_a_tree` diagnostic — duplicate the shared derivation into each
branch instead. Malformed lines, dangling `[refs]`, and multiple un-cited lines
are likewise reported to the author.

In the editor the goal sits at the foot of the tree (its conclusion is fixed);
the student adds the premises that justify each line and types the rule under
each inference bar. A small toolbar adds a premise, adds a hypothesis reference
(`#n`), or deletes the selected subtree. Feedback is live — a "verified ✓" mark
once the tree compiles, and any engine diagnostic is shown inline on the node
whose line caused it. The submitted answer carries `{ mmb, proofText, tree }`;
review pages redraw the submitted tree.

It takes the same attributes as `aufbau-proof` (`system`, `id`, `title`,
`points`, `exam`, `feedback`, `options`). v1 is plain tree editing (free-text rule names, no
rule-picker or drag-to-reparent); the tree is drawn by the vendored ProofML
elements. The full reference lives in
`src/worker/exercises/aufbau-proof-tree/README.md`.

## Aufbau-proof-fitch directive

Use `aufbau-proof-fitch` for the **same engine-checked proof, written in the
classic Fitch shape** from textbooks like *forallx* — a linear list of formulas
where **indentation marks subproofs** and the subproof scope-lines are drawn in.
It suits sequent/ND theories that expose a turnstile judgement (`⊢`) with a
comma-separated context: the editor translates the Fitch text into the linear
`.auf` the other proof types produce (each line becomes a sequent `Γ ⊢ φ`,
its context read off the indentation), compiles it to an MMB certificate, and the
worker re-verifies that certificate. Grading and the trust boundary are identical
to `aufbau-proof`; only the input surface differs.

Each proof line is `<formula> :<rule> <refs>`, where a ref is a proof-step number
`n` or a subproof range `a-b`. Rules are the theory's own axiom names (e.g.
`imp_elim`, `imp_intro`), or any alias the theory gives them (`:→E 1 2`; see
the `@syntax alias` note under *Languages* above). A **premise or assumption**
line just cites the theory's assumption axiom with no refs (`:ax` here, `:AS`
or `:PR` in the forallx systems, whose axiom carries the book's own name); indenting a line opens a subproof
whose first assumption is discharged when a shallower line later cites its range.
The body reads prose (the prompt), the `theorem <name>: $ Γ ⊢ φ $` goal line, a
`----` underline, then a starter Fitch proof (which may be empty):

```md
:::aufbau-proof-fitch{system="prop" id="mp"}
Derive Q from P → Q and P.

theorem mp (a b: wff): $ (a → b) , a ⊢ b $
----
a → b   :ax
a       :ax
b       :imp_elim 1 2
:::
```

The student is shown the goal's **statement**, not the declaration you wrote it
as: `(a → b) , a ⊢ b`, with the theorem's name, its binders and its `$ … $`
dropped — the same thing the tree and Prawitz editors show. The name is the
engine's handle on the goal and need not match the exercise `id`; a `{x: var}`
binder is there to make `∀ x` legal and means nothing to a reader. This does
not depend on the system being a language — that decides whether the formula
itself reads as surface text; taking a declaration apart is MM0 grammar.

A discharging proof indents its assumption and cites the subproof's range; the
translator drops the discharged assumption from the context automatically:

```
    a       :ax
a → a       :imp_intro 1-1
```

Alongside the common `id`, `title`, `points`, `exam`, `feedback`, and
`options` attributes it takes only the required `system`. Three things the
translator needs come from the theory, by `@syntax role`: which axiom opens a
hypothesis (`role assumption` — the rule the translator treats as introducing a
context formula), and how this theory spells a sequent — `role turnstile` on
its turnstile and `role context-join` on the separator between a context's
formulas — both written into every sequent the translator emits. The student's
Fitch source never spells either. A theory that declares none of the three
does not compile a Fitch exercise; the diagnostic names the missing role. This
is why forallx's `;` appears on no exercise anywhere: the theory says it once.
The submitted answer carries `{ mmb, proofText, fitchText }`;
review pages show the submitted Fitch source. Because the `:<rule>` justification
uses a colon, the Fitch body is treated as raw text (not Markdown), and formulas
whose own notation uses a colon still parse — the justification is taken after the
line's *last* colon. The full reference lives in
`src/worker/exercises/aufbau-proof-fitch/README.md`.

## Aufbau-proof-prawitz directive

Use `aufbau-proof-prawitz` for the **same engine-checked proof, drawn as a
Prawitz-style natural-deduction tree** — the textbook picture, with the
premises of each inference above its line and discharge written as labels:
a discharged assumption is bracketed with a superscript (`[A]¹`) and the
discharging rule carries the matching mark beside its line. Like
`aufbau-proof-fitch` it suits sequent/ND theories with a turnstile judgement
(`⊢`) and a comma-separated context; where Fitch reads the discharge off the
indentation, here the **labels** determine each assumption's scope, and the
browser infers every node's context from them (each sequent's context is its
dependency set: the assumptions above that node not yet discharged — never
anything from a sibling branch, so ∀I/∃E eigenvariable side conditions judge
only what the inference actually rests on). The translated tree compiles to the same
linear `.auf`, the MMB certificate is re-verified by the worker, and grading
and the trust boundary are identical to `aufbau-proof`.

The editor is a **forest workspace built for top-down proving**: the student
starts free-standing assumptions, selects one or more finished trees (in
premise order), and applies a rule *below* them; the exercise is complete when
the forest joins into a single verified tree ending in the goal. Growing
upward (adding a premise or assumption above a line) works too. To discharge,
the student labels an assumption and repeats the label on the discharging
rule. Feedback is live — a ✓ once the single tree verifies, and diagnostics
shown on the node that caused them. The submitted answer carries
`{ mmb, proofText, tree }`; review pages redraw the submitted tree in the
bracket notation.

Its body is prose (the prompt) then a single `theorem <name>: $ … $` goal
line, optionally followed by a `----` underline and a **starter** the editor
opens with instead of a blank canvas:

```md
:::aufbau-proof-prawitz{system="forallx" id="self"}
Prove the conditional by discharging its antecedent.

theorem self (a: wff): $ _ ⊢ a → a $
----
a1: $ a ⊢ a $ by ax [] -- label:1
c1: $ _ ⊢ a → a $ by imp_intro [a1] -- label:1
:::
```

Starter lines use the tree type's linear form — `<label>: $ <sequent> $ by
<rule> [<refs>]`, each line cited by at most one other and a single line (the
root) left uncited — extended two ways. **Each line is a full sequent**, the
same text the translator emits, so a valid `.auf` proof for the theory is a
valid starter; the context left of the exercise's sequent symbol is
*discarded* on parse, because nodes carry bare conclusions and the discharge
labels re-derive every context (a stale or wrong context therefore cannot
mislead the grader). **Discharge is written as a trailing comment**:
`-- label:1` at the end of an assumption line gives that leaf its discharge
label (`[A]¹`), and at the end of any other line lists the marks that rule
discharges (comma-separated for a multi-label discharge like ∨E's). Position
is what disambiguates — a leaf can only carry a label, a rule only marks.
Other `--` comments, whole-line or trailing, stay ordinary comments (the
engine's `.auf` grammar accepts trailing comments too, so the annotated lines
above compile as written). A starter only has to *parse*; it does not need to
prove anything — but a discharge mark that binds to no assumption fails the
compile, since the student could never fix it.

Alongside the common `id`, `title`, `points`, `exam`, `feedback`, and
`options` attributes it takes only the required `system`. As with the Fitch
type, the theory's `@syntax role` annotations say the rest: `role assumption`
names the axiom every assumption leaf is emitted through, `role turnstile` the
notation used in every sequent the translator emits — a pasted starter line is
cut at it in any spelling the theory declares, so `|-` reads where `⊢` is
canonical — and `role context-join` the separator between a context's
formulas. A theory missing any of them does not compile a Prawitz exercise.

One caveat when setting goals: a tree cannot discharge **vacuously**. Every
assumption stands somewhere in the tree, so a goal like `a ⊢ b → a` — where
the antecedent is never used — has no direct tree proof (Fitch can assume and
reiterate past; a tree cannot). The classical detour works: conjoin the unused
assumption in with ∧-introduction and take it back out with ∧-elimination
before discharging. Either avoid such goals or teach the detour, as the demo
lesson (`scripts/seed-prawitz-demo.ts`) does. The full reference lives in
`src/worker/exercises/aufbau-proof-prawitz/README.md`.

## Style directive

A `style` block carries a custom stylesheet for the whole content document.
Its body is raw CSS, not Markdown; three colons are enough (four also work):

```md
:::style
h1 { color: maroon; }
:::
```

The CSS is extracted at compile time into the artifact's `css` field and never
rendered as HTML. It applies only in the isolated content document (the iframe
on assignment pages, and the fullscreen view its corner glyph opens), layered
after the default content styles so equally specific author rules win. A
` ```css ` fenced code block is unrelated: it always renders as a code sample.

Rules and behavior:

- Style blocks are allowed only at the top level, not inside exercise bodies.
- Several style blocks concatenate in source order.
- The raw-HTML restriction does not apply inside a style body, so CSS like
  `content: "<b>"` is fine there.
- A literal `:::` line inside the CSS would close the directive early; fence
  the block with `::::style` if you ever need one.
- The renderer preserves `class` attributes, but no dialect syntax writes
  them yet, so for now target element selectors and the renderer's structural
  classes: `.exercise`, `.exercise-prompt`, `.exercise-status`,
  `.exercise-actions` and the controls in it, including
  `.exercise-check-status` — the line a widget's own Check writes under the
  button row. Interactive widget chrome (e.g. multiple-choice options) lives
  inside a shadow root and is deliberately unreachable from author styles; only
  the slotted prompt, the action bar, and option labels can be styled.
- Long documents print best from the fullscreen view.

### Linking external stylesheets

Use the `src` attribute to link a stylesheet instead of (or as well as)
writing CSS inline:

```md
:::style{src="https://example.edu/logic-course.css"}
:::
```

The target must be an absolute `https` URL or a site-relative path starting
with `/` (for stylesheets this site serves). Anything else — `http`,
protocol-relative `//host` URLs, other schemes, or bare relative paths —
fails with `invalid_style_src`. One `src` per block; use several blocks for
several sheets. Linked stylesheets load in source order, after the default
styles and before any inline style CSS, and they combine freely with
`reset`. External sheets are fetched by the reader's browser, so content
depending on one needs that host reachable.

### Resetting the defaults

`:::style{reset}` additionally drops the default content stylesheet from the
document, leaving bare browser styles under your CSS — full control for slides
or posters. The interface fonts go with it, since the platform declares them in
that stylesheet; name your own, or `@font-face` them from your sheet. Exercises in a reset document render unstyled
unless your stylesheet styles them. An empty `:::style{reset}` block clears
the defaults without adding any CSS. `reset` and `src` are the only supported
attributes; anything else fails with `invalid_style_attributes`.

## Normalized answer contract

Submission routes use the generic answer envelope. A multiple-choice answer
looks like this:

```json
{
  "kind": "multiple-choice-answer@1",
  "schemaVersion": 1,
  "data": {
    "selectedOptionIds": ["excluded_middle"]
  }
}
```

Free-response and short-answer submissions use the same envelope shape with a
text payload:

```json
{
  "kind": "short-answer-answer@1",
  "schemaVersion": 1,
  "data": {
    "text": "modus ponens"
  }
}
```

A truth-table answer (`truth-table-answer@1`) carries the filled grid as
`"T"`/`"F"`/`""` cells: `reference[row][atom]` for the atom columns and
`cells[formula][row][cell]` for each formula's written-out cells. A
counterexample submission adds a `counterexample` row index naming the one row
that is graded (the rest of the grid rides along as the student left it); a
`validity` submission adds a `validity[row]` turnstile column. A `partial`
submission is simply that same grid with exactly **one row**. The element builds
and submits this automatically; see the truth-table README for the exact layout.

Answer validation is dispatched through the exercise-kind registry. The
registry rejects option IDs that are not present in the manifest entry for the
exercise, wrong answer kinds, unsupported schema versions, and malformed data.

## Diagnostics

Compiler diagnostics are safe to show to authors. They include a `code`, a
`message`, and one-based `line` and `column` positions.

Common diagnostic codes include:

- `unsafe_raw_html`
- `invalid_directive`
- `unclosed_directive`
- `unsupported_directive`
- `invalid_directive_attributes`
- `unknown_attribute`
- `missing_id`
- `invalid_exercise_id`
- `duplicate_exercise_id`
- `invalid_points`
- `invalid_mode`
- `missing_answer`
- `not_enough_options`
- `invalid_option_id`
- `duplicate_option_id`
- `invalid_option_label`
- `invalid_multiple_choice_body`
- `invalid_answer_key`
- `invalid_case_sensitive`
- `invalid_exam`
- `invalid_feedback`
- `redundant_check_attribute`
- `invalid_formula`
- `no_formulas`
- `too_many_atoms`
- `no_fillable_cells`
- `invalid_fill_scope`
- `invalid_grading_mode`
- `invalid_check_mode`
- `invalid_counterexample_target`
- `missing_turnstile`
- `multiple_turnstiles`
- `empty_premises`
- `empty_conclusions`
- `given_row_arity`
- `given_cell_arity`
- `invalid_grid_token`
- `given_conflicts_with_key`
- `invalid_mark`
- `unknown_truth_table_option`
- `unsupported_truth_table_variant`
- `invalid_truth_table_body`
- `missing_name`
- `empty_theory`
- `duplicate_theory`
- `unknown_theory_src`
- `remote_theory_src`
- `unknown_theory`
- `missing_theorem_header`
- `missing_proof_underline`
- `unknown_proof_option`
- `invalid_style_attributes`
- `invalid_style_src`
- `invalid_item_link`
- `invalid_math`

## Versioning notes

Changes that alter parsing, compiled artifact shape, answer validation, or
render semantics should either be backward-compatible for existing revisions or
introduce a new source profile such as `carnap-markdown-v2`.

Existing immutable revisions retain their source text and compiled artifact.
Assignment code should depend on stored revision IDs and compiled manifests,
not on reparsing mutable drafts.

The four exercise directives were once spelled with a `carnap-` prefix
(`carnap-truth-table`, …). Those names are gone, not deprecated: a draft still
using one fails with `unsupported_directive`, and the fix is to delete the
prefix. Already-published revisions are unaffected — they render from their
stored artifact and are never reparsed.
