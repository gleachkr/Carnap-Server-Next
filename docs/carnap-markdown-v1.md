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

The TeX packages enabled are `base`, `ams`, `boldsymbol`, `braket`,
`mathtools`, `newcommand`, `textmacros`, `unicode` and `verb`. A formula that
does not parse fails the save with an `invalid_math` diagnostic on its own
line, rather than being stored as an error box for a student to find.

Some things browsers do not draw, and this dialect therefore does not offer:

- `bussproofs` (`\begin{prooftree}`) — use the `:::aufbau-proof-tree` or
  `:::aufbau-proof-prawitz` directives, which are better at it anyway
- rules inside `\begin{array}`, and `\hline`
- `\cancel` and `\enclose`
- `\underbrace` draws a line rather than a brace
- `\begin{aligned}` column alignment differs between Chromium and Firefox
- a long displayed formula does not break across lines; it scrolls sideways
  inside its own box rather than widening the page

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
and manifest. It must start with a letter and may then use letters, numbers,
underscores, or hyphens. It may be at most 64 characters long. IDs must be
unique within a content revision.

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
(display glyphs for true/false cells; the recorded answer stays `T`/`F`), and an
`options` string of Carnap flags (`autoAtoms`, `nodash`, `nocheck`,
`nocounterexample`, `hiddenGivens`, `strictGivens`, `double-turnstile`,
`negated-double-turnstile`; `immutable` — Carnap's whole-table display lock — is
recognized but not yet effective).
The `simple` and `validity` variants let a student designate one row as a
counterexample instead of filling the whole table (unless `nocounterexample`).
Notation is `~ /\ \/ -> <->` with single-letter atoms; the sequent turnstile is
`:|-:`.

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

Notation is **forallx: Calgary, 2019 and later**: `Ax`/`Ex` (or `∀`/`∃`, `@`/`3`)
immediately followed by a variable from `s`–`z`; predicates any uppercase letter
with parentheses (`F(x)`, `R(x,y)`), a bare uppercase letter being a sentence
letter; constants `a`–`r`; function symbols `a`–`t`, always with parentheses;
`=` and `!=`/`≠`; connectives `~ /\ \/ -> <->` plus the usual symbol aliases.

Those are the spellings an author *types*. A formula is *shown* in logical
symbols — `∀x∀yf(x,y)=f(y,x)` for what is written `AxAyf(x,y) = f(y,x)`, and
`(P ∧ Q) ∨ R` for `P /\ Q \/ R` — every binary compound parenthesized except
the outermost, as the original prints them.

Three of its rules catch people out, and all three are Carnap's own behaviour: a
quantifier's scope is the sentence **immediately** after it (`AxF(x) -> G(a)` is
a conditional, not a quantified conditional); `/\` and `\/` share one
precedence level left-associatively, while `->` and `<->` refuse to chain
(`P -> Q -> R` is an error); and parentheses may only wrap a two-place compound,
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
a hint into a requirement.

```md
::::model{id="seeded" options="strictGivens"}
- AxEyR(x,y)
| Domain : 0,1,2
::::
```

Alongside the common `id`, `title`, `points`, `exam`, and `feedback`
attributes it accepts `variant` (`simple` | `validity` | `constraint`), `system` (a notation system id;
only `forallx-calgary-2019` today), `counterexample-to` (`validity`/`tautology` |
`equivalence` | `inconsistency`/`contradiction` — the property the targeted
sentences must have, defaulting to all-true for `simple` and `constraint` and
all-false for `validity`), `check` (`on` | `off` — this type's older spelling
of `feedback`), and an `options` string of
Carnap flags (`nocheck`, `strictGivens`, `double-turnstile`,
`negated-double-turnstile`; `forallxStyle` is recognised but not yet effective).

A domain is up to 16 naturals. Extensions are tuples in `[…]`, `(…)` or `<…>`
(`[0,0],[1,0]`, or bare numbers for a one-place predicate); a constant is a menu
of the domain; a function gets a **generated value table**, one row per argument
tuple, so it cannot be left partly undefined. The recorded answer is the raw text
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
`system` names the notation system (only `forallx-calgary-2019` today).

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

Declare a theory with `aufbau-mm0`. Its body is raw MM0, not Markdown; give it a
`name` other proof blocks reference.

A declared theory does not appear in the lesson. MM0 source is machinery, and a
course that gives students its rules in a textbook rarely wants a slab of it
above every exercise. Add `show` when you do want it readable — it renders a
collapsed disclosure panel, labelled with the theory's name, that opens to the
source:

```md
:::aufbau-mm0{name="prop" show}
delimiter $ ( ) $;
provable sort wff;
term imp (a b: wff): wff; infixr imp: $->$ prec 25;
axiom top_i: $ top $;
axiom ax_1 (a b: wff): $ a -> b -> a $;
:::
```

An `aufbau-proof` block references a theory by `name` and states the goal. The
body reads: prose (the prompt), then a single `theorem <name>: $ … $` line (the
goal, in MM0 declaration syntax), then a `----` underline, then the starter proof
body the student edits:

```md
:::aufbau-proof{theory="prop" id="identity"}
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
attributes it takes the required `theory` (a declared `aufbau-mm0` name, which must appear earlier in the
document) and an `options` string of editor toggles: `auto` exposes the
compiler's `auto?` proof search, `complete` exposes rule-name completion (both
off by default — appropriate for introductory work, worth enabling for a course
where search is expected). The proof-script format (proof lines, `by`, rule
applications, `auto?`) is documented in the engine repository's `docs/proof.md`.

v1 is a plain text editor; richer GUIs on the same engine may follow. A theory
located elsewhere (an `src=` on `aufbau-mm0`) and the `auto?`/completion wiring
are not implemented yet. The full reference lives next to the code in
`src/worker/exercises/aufbau-proof/README.md`.

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
:::aufbau-proof-tree{theory="prop" id="identity"}
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
:::aufbau-proof-tree{theory="prop" id="mp-start"}
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

It takes the same attributes as `aufbau-proof` (`theory`, `id`, `title`,
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
`imp_elim`, `imp_intro`). A **premise or assumption** line just cites the
theory's assumption axiom with no refs (`:ax`); indenting a line opens a subproof
whose first assumption is discharged when a shallower line later cites its range.
The body reads prose (the prompt), the `theorem <name>: $ Γ ⊢ φ $` goal line, a
`----` underline, then a starter Fitch proof (which may be empty):

```md
:::aufbau-proof-fitch{theory="prop" id="mp"}
Derive Q from P → Q and P.

theorem mp (a b: wff): $ (a → b) , a ⊢ b $
----
a → b   :ax
a       :ax
b       :imp_elim 1 2
:::
```

A discharging proof indents its assumption and cites the subproof's range; the
translator drops the discharged assumption from the context automatically:

```
    a       :ax
a → a       :imp_intro 1-1
```

Alongside the common `id`, `title`, `points`, `exam`, `feedback`, and
`options` attributes it takes the required `theory` and an optional `assumption` naming the theory's
assumption axiom (default `ax`) — the rule the translator treats as introducing a
context formula — and an optional `sequent` naming the theory's turnstile
notation (default `⊢`), written into every sequent the translator emits. The
student's Fitch source never spells the turnstile, so an ASCII theory only needs
`sequent="|-"` on the directive. The submitted answer carries `{ mmb, proofText, fitchText }`;
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
:::aufbau-proof-prawitz{theory="forallx" id="self"}
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
`options` attributes
it takes the required `theory` and two optional notational attributes:
`assumption` names the theory's assumption axiom (default `ax`), exactly as
`aufbau-proof-fitch` does, and `sequent` names the theory's turnstile notation
(default `⊢`) — used in every sequent the translator emits and stripped from
pasted starter lines, so a theory with ASCII notation can say `sequent="|-"`.

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
  classes: `.exercise`, `.exercise-prompt`, `.exercise-status`. Interactive
  widget chrome (e.g. multiple-choice options) lives inside a shadow root and
  is deliberately unreachable from author styles; only the slotted prompt and
  option labels can be styled.
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
counterexample submission adds a `counterexample` row index and fills only that
row; a `validity` submission adds a `validity[row]` turnstile column. A `partial`
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
- `unsupported_theory_src`
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
