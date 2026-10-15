# Carnap Markdown v1

`carnap-markdown-v1` is the authoring format for lessons and immutable content
revisions. Write prose in Markdown and add exercises with directive blocks.
This reference follows the compiler in
`src/worker/application/content/compiler.ts`.

## Contents

- [Markdown](#supported-prose-markdown), [tables](#tables),
  [footnotes](#footnotes), and [mathematics](#mathematics)
- [Item links](#item-links) and [directive syntax](#directive-blocks)
- [Recording and feedback](#recording-and-feedback)
- [Multiple choice](#multiple-choice-directive),
  [free response](#free-response-directive), and
  [short answer](#short-answer-directive)
- [Truth tables](#truth-table-directive), [models](#model-directive),
  [translation](#translation-directive), [worlds](#world-directive), and
  [truth trees](#truth-tree-directive)
- [Linear proofs](#aufbau-proof-directive),
  [languages and theories](#languages-and-theories),
  [proof trees](#aufbau-proof-tree-directive),
  [Fitch proofs](#aufbau-proof-fitch-directive), and
  [Prawitz proofs](#aufbau-proof-prawitz-directive)
- [Styles](#style-directive), [answer data](#normalized-answer-contract),
  [diagnostics](#diagnostics), and [versioning](#versioning-notes)

## Profile guarantees

- The source profile identifier is `carnap-markdown-v1`.
- Compilation is deterministic for the same source and resolved theory text.
- Every exercise needs an explicit ID. Headings and position do not assign
  IDs, and reordering prose does not change them.
- Private answer keys and rubrics are excluded from student render data.
  Translation solutions are deliberately public; see its security note.
- Raw HTML, unsupported directives, and unknown attributes are rejected.
- Saved revisions retain their compiled artifacts. Editing source creates a
  new revision rather than changing prior material.

## Supported prose Markdown

Supported blocks include headings, paragraphs, lists, fenced code blocks,
pipe tables, footnotes, and mathematics. Blank lines separate prose blocks.
Inline emphasis, strong emphasis, code, links, and images render normally.

Use code fences for listings whose spacing matters, or to quote a directive
without compiling it. Long code lines scroll horizontally rather than wrap.

Tables and footnotes are the supported GitHub-Flavored Markdown extensions.
Strikethrough, task lists, and bare-URL autolinking are not enabled.
The `[x]` notation inside a multiple-choice directive has its own meaning.

Raw HTML is prohibited in prose and exercise prompts. For example,
`<strong>x</strong>` produces `unsafe_raw_html`; write `**x**` instead.

## Tables

Use a header row, a separator row, and one line per data row:

```md
| Symbol | Meaning |
| --- | --- |
| `∧` | and |
| `→` | if … then |
```

Colons in the separator set alignment: `:---` for left, `:---:` for center,
and `---:` for right. Outer pipes and aligned source columns are optional.

Cells accept inline Markdown, including item links, but not block content
such as lists or exercise directives. Escape a literal pipe as `\|`.
Missing cells are padded and extra cells are truncated, so an unescaped pipe
can silently change the row's contents.

Rendered tables size to their content and scroll horizontally if too wide.

## Footnotes

Write a reference marker and a definition in the same source:

```md
Frege introduced the distinction in 1892.[^sinn]

[^sinn]: *Über Sinn und Bedeutung*, page 25.
```

Labels can be names or numbers. The displayed numbers follow reference order,
not the labels. Indent subsequent definition paragraphs by four spaces.
Definitions may appear anywhere in the source.

A note appears near its reference: after the prose block that uses it or
inside the exercise prompt that uses it. Numbering continues across the
whole document.

An undefined marker remains literal text. A later reference to a note
already used elsewhere in the document also remains literal. Unreferenced
definitions are omitted.

Each note whose definition is a single paragraph is also copied, hidden,
beside its first reference, for a stylesheet that sets notes in the margin
rather than at the foot:

```html
<sup><a data-footnote-ref …>1</a></sup><span class="sidenote" hidden>
<span class="sidenote-number">1</span> The note's text.</span>
```

Style the number through `.sidenote-number`. The note at the foot is then
marked `<li class="has-sidenote">`. The default
stylesheet never shows the copy. To use sidenotes instead, give `.sidenote`
a `display` value and hide the notes that have one. Hide the section too once
nothing in it is left to show. With the default measures, prose leaves room
to its right for a margin column on wide screens:

```css
@media (min-width: 60rem) {
  .footnotes li.has-sidenote,
  .footnotes:not(:has(li:not(.has-sidenote))) { display: none; }
  .sidenote {
    clear: right;
    display: block;
    float: right;
    font-size: 0.85rem;
    margin-right: -32%;
    width: 28%;
  }
}
```

The `hidden` attribute is the weakest rule there is, so any `display` rule
overrides it. A document that does not set one, including a
`:::style{reset}` document, shows each note once, at the foot. A note with
more than one paragraph, a list, or a table has no copy, since block content
cannot sit inside the paragraph that cites it; it stays at the foot, and
states its own number, so hiding the notes before it does not renumber it.
A note cited again carries its copy only at the first reference.

The stored footnote section uses English accessible labels for its hidden
heading and return links. These are generated at compilation time, before a
viewer locale is known. The note text itself is authored content.

## Mathematics

Use dollar delimiters for mathematical typesetting: single dollars for
inline formulas and double dollars for display formulas. Display formulas
can occupy one line or several.

```md
The conditional $P → Q$ is false when $P$ is true and $Q$ is false.

$$∀x(Fx → Gx) ↔ ¬∃x(Fx ∧ ¬Gx)$$
```

The contents use the supported TeX input syntax; Unicode symbols also work.
Formulas are allowed in prompts, option labels, and rubrics as well as prose.

### Dollars that are not mathematics

Single-dollar math must have no whitespace next to its opening or closing
delimiter. `$x$` is math; `$ x $` is literal text. This keeps common price
text such as `it cost $5 and then $10` from becoming a formula.

Escape a literal dollar with `\$`. Inline code is unaffected, so
`` `echo $HOME` `` is safe.

### Macros

The TeX `newcommand` facility is enabled. Definitions are scoped to the
document and can be used by later formulas. A formula containing only a
macro definition produces no visible output or spacing, so definitions can
be collected at the start of a lesson.

### Rendering and limitations

The compiler typesets math when a revision is saved and stores MathML.
Readers do not download a math-rendering engine. STIX Two Math is served by
the application; author CSS can select another available math font:

```md
:::style
math { font-family: "Latin Modern Math", math; }
:::
```

Enabled TeX packages are `base`, `ams`, `boldsymbol`, `braket`, `cancel`,
`mathtools`, `newcommand`, `textmacros`, `unicode`, and `verb`. Invalid math
prevents saving and reports `invalid_math` at the source line.

The compiler adds CSS for common MathML features browsers do not implement
directly: table rules, boxes, and cancellation marks. The supported commands
include `hline`, array-column rules, `boxed`, `fbox`, `cancel`, `bcancel`, and
`xcancel`.

Limitations:

- `bussproofs` is unavailable. Use a proof-tree or Prawitz directive instead.
- `cancelto` and `enclose` are unsupported.
- Long display formulas scroll; they do not automatically break into lines.
- Column alignment in `aligned` and left/right array columns differs between
  Firefox and Chromium. Use separate display lines when alignment is
  essential.
- Long `underbrace` and `overbrace` constructions can render at the wrong
  width in Chromium. Check them in the browsers your students use.
- Color commands are disabled because the sanitizer strips their style
  attributes. HTML/link styling commands and dynamic package loading through
  `href`, `class`, `style`, `cssId`, or `require` are not enabled.

## Item links

Link to another content item by its ID:

```md
Continue with [Chapter 2](item:0197a2c4-89ab-7cde-8f01-23456789abcd).
```

The ID is the last segment of the item's library-page URL. Within a course,
the link opens an assignment in that course publishing the item. In a library
preview, it opens the library page. If no course publication is available,
the reader gets a content-not-available page.

If several assignments publish the item, listed assignments take precedence,
then display order decides. A malformed ID produces `invalid_item_link`.

Item links work in prompts and option labels too. Content links navigate the
top-level window, not the content iframe.

## Directive blocks

Start a directive with at least three colons, its name, and optional
attributes in braces. Close it with a matching colon fence. Four colons are
used for exercise examples here:

```text
::::directive-name{key="value" other=value}
Directive body.
::::
```

Names start with a letter and may contain letters, numbers, underscores,
and hyphens. Attribute values may be quoted or unquoted; quote values that
contain spaces. `{#name}` abbreviates `id="name"`, and a bare attribute such
as `{reset}` is a flag. Attributes outside braces are rejected.

The ID shorthand treats `.` as a class separator and a second `#` as another
ID. Write `id="ex1.2"`, not `{#ex1.2}`, for an ID containing punctuation.
Likewise, do not use repeated `#` shorthand to combine IDs.

Every directive validates its accepted attributes. An unknown attribute
produces `unknown_attribute` with the accepted names; it is not ignored.

There are eleven exercise directives:

- `multiple-choice`
- `free-response`
- `short-answer`
- `truth-table`
- `model`
- `translation`
- `world`
- `aufbau-proof`
- `aufbau-proof-tree`
- `aufbau-proof-fitch`
- `aufbau-proof-prawitz`

`aufbau-mm0` declares a theory or language, and `style` supplies CSS. Neither
is an exercise.

### Common exercise attributes

- `id` is required and unique within the revision. It accepts 1–64
  non-whitespace characters, including punctuation and Unicode, but excludes
  control and formatting characters. IDs are compared exactly, without
  Unicode normalization.
- `title` is optional and names the exercise in the interface. It is also
  the exercise's heading, which screen-reader users move between: one rank
  below the last Markdown heading above the exercise (an exercise under
  `## Part one` is an `h3`), or `h2` when there is none. An untitled
  exercise's heading is its number and kind, such as "Exercise 3: Truth
  table", heard but not shown. The number counts every exercise in the
  document, titled or not. The `id` is never shown to students, so an
  exercise numbered after a textbook, `id="vii.1"`, needs `title="VII.1"`
  as well to carry that number on the page.
- `points` defaults to `1`, and may be anything from `0` to `1000`. A
  zero-point exercise is recorded and checked as usual but adds nothing to a
  total, so it suits a playground; its score line shows no `0/0` to the
  student. With every score 0, the newest evaluation is the one that stands.
- `exam` and `feedback` control recording and displayed results, as below.

Keep an exercise's ID stable when revising it so its recorded work can still
be associated with that exercise.

## Recording and feedback

Three settings control different parts of assessment:

- `exam`: whether incorrect automatically evaluated answers are recorded.
- `feedback`: how much checker feedback the interface displays.
- Assignment grade release: when students can see numeric grades.

If an exercise omits `exam` and `feedback`, the assignment supplies defaults:

| Context | `exam` | `feedback` |
| --- | --- | --- |
| Graded assignment with grades withheld | `true` | `none` |
| Graded assignment with grades released | `false` | `full` |
| Practice, reading, or author preview | `false` | `full` |

An explicit exercise attribute overrides its own default. These defaults
are resolved per assignment, not saved into the compiled exercise, so the
same content can be used as both an exam and a practice activity. The one
exception is the world exercise's `game`, which cannot hide who won and so
compiles to `full` when it says nothing (see
[the evaluation game](#the-evaluation-game)).

### `exam`

`exam="true"` records every valid submission, including incorrect and partial
answers. `exam="false"` records automatically evaluated work only when fully
correct; other answers are checked and the student is asked to try again.

Free response always records because it has no automatic evaluator. Readings
and previews never record answers, regardless of the attribute.

Leaving `exam` out is not equivalent to explicitly setting it to `false`:
on a graded assignment with unreleased grades, omission means `true`.

### `feedback`

| Value | Local checking UI | Correctness mark | Detailed feedback |
| --- | --- | --- | --- |
| `full` | Available | Shown | Shown |
| `terse` | Available | Shown | Hidden |
| `none` | Hidden | Never green | Hidden |

Details include truth-table cell highlighting, proof diagnostics, and
messages identifying which formula failed. `terse` supplies a verdict
without these explanations. Some exercise types check automatically rather
than through a Check button.

The model exercise is the one exception: its Check is a verdict and a
sentence naming the formula that came out wrong, with no quieter form, so
`terse` and `full` are the same setting there and only `none` hides the
button.

Releasing grades changes the default, not an explicit setting.
`feedback="none"` remains in effect after release.

Legacy options remain supported for truth tables and models:

- `check="cells"` on a truth table or `check="on"` on a model means `full`.
- Truth-table `check="terse"` means `terse`.
- `check="off"` or the `nocheck` option means `none`.

If both `check` and `feedback` are specified, the compiler reports
`redundant_check_attribute` and uses `feedback`.

### Numbers wait for the release date

An exercise's numeric score is visible only when grades are released and
its feedback is not `none`. For example, `feedback="full"` on an unreleased
assignment can show checker detail but not the recorded point score.

The assignment total depends on grade release alone. Once released, it can
reveal an individual hidden score by subtraction from the other scores.

### `exam="false" feedback="none"`

This combination is allowed. The local verdict is hidden, but an incorrect
submission is not recorded. The message saying that nothing was recorded
therefore still tells the student to retry. Use `exam="true"` when students
must commit to an answer without this accept/reject signal.

### What `feedback` is not

Feedback settings control the interface, not access to everything a browser
can calculate. Proofs and translations are checked in the browser before
server verification. Truth-table and model results can be computed from the
public formulas. Translation solutions are included in browser data.
Students with developer tools can inspect or run these checks themselves.

The server independently protects unreleased recorded scores and verifies
submitted evidence. Hiding local feedback does not make public content or
local computation secret.

## Multiple-choice directive

```md
::::multiple-choice{id="tautology" title="Tautology" points="2"}
Which sentence is a tautology?

- [x] excluded_middle | P or not P
- [ ] contradiction | P and not P
::::
```

The common attributes apply. `mode` is `single` by default; use `multiple`
for a question allowing several selected options.

Write the prompt first, then options in this format:

```text
- [x] option_id | Correct option text
- [ ] other_id | Incorrect option text
```

`[x]` and `[X]` mark correct options. Option IDs must start with a letter,
contain only letters, numbers, underscores, or hyphens, and be at most 64
characters long. They must be unique within the exercise.

Labels support inline Markdown. After the first option, only option lines
and blank lines are allowed.

`single` requires exactly one correct option; `multiple` requires at least
one. Automatic grading uses exact matching: the selected set must equal the
correct set for full credit. Any other structurally valid selection earns
zero. The answer key stays in private manifest data.

## Free-response directive

Use free response for manually graded text:

```md
::::free-response{id="explain" points="5" rubric="Truth preservation."}
Explain why the argument is valid.
::::
```

The body is the prompt. Optional `rubric` text is private assessment data,
shown to instructors during review but excluded from student render and
review data.

Answers use `free-response-answer@1`. They are normalized and recorded
without an automatic evaluation. An instructor can grade them later.
`exam` has no effect on recording for this type. Numeric results still
require grade release and a feedback setting other than `none`.

## Short-answer directive

Use short answer for automatically matched text:

```md
::::short-answer{id="rule_name" answer="modus ponens" points="2"}
Name the rule used in this inference.
::::
```

For alternatives, use `answers` with `|` separators:

```md
::::short-answer{id="rule_abbrev" answers="modus ponens|MP"}
Name the rule.
::::
```

Matching trims the submitted text and is case-insensitive by default.
`case-sensitive="true"` requires matching case. Accepted answers are private
manifest data, not part of the student document.

The resolved `exam` setting controls whether incorrect answers are recorded.

## Truth-table directive

A truth table asks students to fill cells and optionally identify a
counterexample row. Local checking and server grading use the same logic.

### Variants

`simple` takes formulas as Markdown list items. A bullet may contain several
comma-separated formulas. Prose before the first item is the prompt.

```md
::::truth-table{id="demorgan" variant="simple" feedback="terse" points="4"}
Fill in both tables and compare their results.

- ~(P /\ Q)
- ~P \/ ~Q
::::
```

`validity` takes one sequent line: comma-separated premises, `:|-:`, and
comma-separated conclusions. Its turnstile column is false on a
counterexample row: all premises true and all conclusions false under the
default target.

```md
::::truth-table{id="modus-ponens" variant="validity"}
Is this argument valid?

P, P -> Q :|-: Q
::::
```

`partial` uses list items like `simple`, but asks for one row. The student
chooses the atom values and completes the row. Any valuation is accepted
unless givens restrict it.

### Givens

After the formulas, add a positional grid:

```text
referenceTokens | formula1Tokens | formula2Tokens
```

Use `T` or `F` to seed a cell and `.` to leave it open. The reference segment
has one token per atom; each formula segment has one token per displayed
cell. In full tables, a reference pattern can match several rows using `.`
as a wildcard.

For `simple` and `validity`, givens must agree with the computed answer or
compilation reports `given_conflicts_with_key`. `strictGivens` locks seeded
cells and excludes them from grading; otherwise they remain editable and
are graded.

For `partial`, each given row is an accepted alternative. `hiddenGivens`
hides those alternatives; `strictGivens` locks a single visible alternative.

```md
::::truth-table{id="assume-q" variant="partial" options="hiddenGivens"}
Make Q → P true, assuming Q is true.

- Q -> P

. T | . T .
::::
```

### Attributes and options

In addition to the common attributes:

- `variant`: `simple`, `validity`, or `partial`.
- `fill`: `all`, `connectives`, or `main`; chooses editable formula cells.
  Not applicable to `partial`.
- `grading`: `all-or-nothing` or `partial`.
- `check`: legacy `cells`, `terse`, or `off`; prefer `feedback` in new source.
- `counterexample-to`: `tautology`/`validity`, `equivalence`, or
  `inconsistency`/`contradiction`. In a validity table, premises remain
  all-true and the target applies to the conclusions and turnstile column.
- `trueMark` and `falseMark`: displayed glyphs; answer data still uses
  `T`/`F`.
- `system`: an `aufbau-mm0` block name or built-in system ID.
  Defaults to `carnap-prop`.
- `options`: space-separated flags: `autoAtoms`, `nodash`, `nocheck`,
  `nocounterexample`, `hiddenGivens`, `strictGivens`, `double-turnstile`,
  and `negated-double-turnstile`. `immutable` and `turnstilemark` are
  recognized but have no effect.

Unless `nocounterexample` is set, students in `simple` and `validity` can
submit a chosen counterexample row instead of the whole table.

The default notation uses `~`, `/\`, `\/`, `->`, and `<->`, with `:|-:` for
the sequent separator. Other systems are allowed, but unsupported formula
constructs, such as quantifiers, are rejected at their source location.

For cell layouts, defaults, complete notation rules, and answer data, see
[the truth-table reference](../src/worker/exercises/truth-table/README.md).

## Model directive

A model exercise asks for a finite domain and interpretations of the symbols
used in its formulas. The widget generates fields from those formulas.
Browser and server use the same model checker; there is no secret answer key.

### Variants

`simple` takes formulas as list items and normally asks for a model making
all of them true. A bullet can contain comma-separated formulas.

```md
::::model{id="two_at_once" title="Two at once" points="3"}
Build a model in which both sentences are true.

- ExF(x), Ex~F(x)
::::
```

`validity` takes a sequent and normally asks for every premise true and every
conclusion false:

```md
::::model{id="someone" variant="validity" points="4"}
Show that everyone liking someone does not imply someone being liked by all.

AxEyR(x,y) :|-: ExAyR(y,x)
::::
```

`constraint` takes one list item of the form `constraints : sentences`.
Constraints must also be true but are not displayed. State them in the prompt
if students need to know them. Using a list item distinguishes the constraint
line from ordinary prompt text ending in a colon.

```md
::::model{id="not_free" variant="constraint"}
Use a domain with at least two elements and make the sentence true.

- ExEy~x = y : AxAyF(x,y)
::::
```

### Givens and fields

Seed a field with `| Field : value` after the formulas. Field names match
the interface labels, such as `Domain`, `F(_,_)`, `a`, and `f(_)`.
Unknown fields, duplicate givens, and invalid values are compile errors.

```md
::::model{id="seeded" options="strictGivens"}
- AxEyR(x,y)
| Domain : 0,1,2
::::
```

`strictGivens` locks supplied values. For a function, a given such as
`f(_) : [0;1]` fixes the value at argument 0 to 1, not the whole table.

Domains contain at most 16 natural numbers. Predicate extensions use tuples
in square, round, or angle brackets, or bare numbers for unary predicates.
Constants use domain-value menus. Functions have a generated value table
with a menu for every argument tuple, with the last argument across columns.
Recorded field data is retained for review.

In a language that admits open formulas — one without the
`closed-sentences` lint, which both forallx languages declare — each
variable that occurs free in the exercise's formulas is a field too. It is
the variable assignment the formulas are evaluated at, and works as a
constant does: a domain-value menu labelled with the variable, which a given
such as `| x : 1` seeds or, under `strictGivens`, fixes. A variable that
occurs only bound asks for nothing.

### Attributes and options

In addition to the common attributes:

- `variant`: `simple`, `validity`, or `constraint`.
- `system`: a block name or built-in language ID. Defaults to
  `forallx-calgary`; `forallx-magnus` uses the original book's notation.
- `counterexample-to`: `validity`/`tautology`, `equivalence`, or
  `inconsistency`/`contradiction`.
- `playground`: boolean, simple variant only. The student writes the
  sentences and builds the model; see [Model playground](#model-playground).
- `check`: legacy `on` or `off`; prefer `feedback`.
- `options`: `nocheck`, `strictGivens`, `double-turnstile`, or
  `negated-double-turnstile`. `forallxStyle` is recognized but not effective.

### Model playground

With the boolean `playground` attribute the student supplies the sentences
too. They type them, separated by commas, into a box above the fields; the
interface shows how each reads, and the fields are those the sentences use
(the domain, plus a menu or extension for every constant, predicate, function,
and free variable). The exercise is correct when every typed sentence has the
target property in the model, which is true by default and follows
`counterexample-to` as in the simple variant. There is no check that a
sentence is interesting; `P → P` is true in any model.

```md
::::model{id="free" playground}
Write a sentence that is true in a model with two elements and false in
every model with one, then build the model.
::::
```

A playground has no formula list: its sentences are the student's, and a list
item is a compile error (`playground_lists_formulas`). Givens name the
symbols the model always interprets instead. A given may name any field the
language could have, spelled as the interface labels it (`F(_,_)`, `a`,
`f(_)`), and its field is shown whatever the student writes. A label the
language cannot read is refused (`unknown_model_given_field`).

With `strictGivens` the givens are a fixed model: the student only writes
sentences, and a sentence using a symbol the givens do not name is refused.
A locked playground needs at least one given
(`playground_strict_without_givens`); `| Domain : 0,1,2` alone is a model of
the pure identity language.

```md
::::model{id="fixed" playground options="strictGivens"}
Write a sentence about `a` and `F` that this model makes true.

| Domain : 0,1
| F(_) : 0
| a : 0
::::
```

The answer gains a `sentences` string. Add `points="0"` for an ungraded
playground.

See [Languages and theories](#languages-and-theories) for formula notation,
and [the model reference](../src/worker/exercises/model/README.md) for field
syntax, defaults, and answer data.

## Translation directive

A translation exercise asks students to symbolize natural-language text.
List acceptable solutions after the prompt, one per bullet or separated by
commas within a bullet:

```md
::::translation{id="fine" variant="first-order" points="2"}
Everything is fine.

- AxF(x)
::::
```

Normally an answer is correct if it is logically equivalent to a solution.
Here `~Ex~F(x)` is also accepted. The widget displays the parsed formula in
canonical notation, checks after a typing pause, and checks immediately on
Enter. There is no separate Check button. Submit waits for a pending check
before sending its certificate.

### Variants and restrictions

- `variant="prop"` is the default. Only sentence letters and propositional
  connectives are allowed.
- `variant="first-order"` allows first-order formulas.
- `variant="exact"` compares parsed syntax rather than logical equivalence.

`tests` adds requirements that every submitted answer must satisfy:

- `CNF`, `DNF`, or `PNF` (PNF is first-order only).
- `maxCon:N`, `maxNeg:N` (also `maxNot:N`), `maxAnd:N`, `maxOr:N`,
  `maxIf:N`, `maxIff:N`, `maxFalse:N`, or `maxAtom:N`.

A solution need not itself satisfy the requested form. For example, students
can be asked to find an equivalent prenex formula without negation:

```md
::::translation{id="prenex" variant="first-order" tests="PNF maxNeg:0"}
Nothing is not bananas.

- ~Ex~B(x)
::::
```

`starter` prefills the input and may contain incomplete text or prose.
`options` accepts `nocheck` (equivalent to hiding feedback) and `checksyntax`
(block submission of text that does not parse). Common attributes apply.
`system` selects a theory block or built-in language; the default
is forallx: Calgary notation.

### Checking and security

The browser uses Aufbau proof search to produce an equivalence certificate.
The server verifies the certificate independently and records the verdict
and answer text, not the certificate.

**Solutions are public browser data.** Equivalence checking needs a solution
to compare against, so students can inspect the supplied solutions with
developer tools. Neither `exam` nor `feedback` hides them.

Proof search has a time/resource budget. It handles common textbook
equivalences but can fail to establish a valid, more difficult equivalence
within that budget. Add the intended answer forms as separate solutions
when necessary. Exact matching avoids the equivalence-search requirement.

See [the translation reference](../src/worker/exercises/translation/README.md)
for the proof-search design, restrictions, and answer format.

## World directive

A world exercise is set in a picture of a structure: a board of blocks, in
the tradition of Tarski's World. Its sentences are true or false because of
what the blocks are and where they stand, so students work on the picture
rather than on tables. Sentences show their truth values as the world
changes, and pointing at part of a sentence marks what that part is true of.

```md
::::world{#lefty system="blocks-lpl" budget="2" points="3"}
Change at most two blocks so that every sentence comes out as marked.
No two blocks may share a row.

- ∀x(Cube(x) → ∃y LeftOf(y,x))
- false: ∃x Large(x)

| law : ∀x∀y(SameRow(x,y) → x = y)
| pinned block : small tet at 1,1 named a
| block : large cube at 4,3 named b
| block : medium dodec at 6,7
::::
```

`system` is required: no built-in language has the blocks vocabulary, so it
names a theory block of the author's (see [the blocks language](#the-blocks-language)).

### Variants

- `build` (the default): edit the world until every sentence has its target
  value. A list item is a sentence to make true; `false:` before it asks for
  false instead.
- `evaluate`: the world is fixed and the student marks each sentence true or
  false. Scored per sentence. No live truth values are shown, since they
  would be the answer.
- `counterexample`: one argument line, `premises :|-: conclusions`, as in a
  model exercise. The student builds a world where the premises are true and
  the conclusions false.
- `distinguish`: two worlds, written `| A block : …` and `| B block : …`. The
  student writes one sentence true in A and false in B. `without="= ∀"`
  forbids symbols; `symbols="∃ ¬ ∧ LeftOf"` lists the only ones allowed
  (names are always allowed). Give one or the other. Any spelling the
  language accepts names its symbol, and a spelling with several meanings
  names them all: in forallx Calgary, `E` is both the predicate letter and
  an ASCII ∃.
- `game`: the evaluation game. The world is fixed; the student claims each
  sentence true or false and then defends the claim against the computer,
  as below. Scored per sentence: a sentence counts when its game is won.

Build, counterexample, and distinguish are all or nothing.

### The evaluation game

A position in the game is a part of the sentence as written, the value the
student claims for it, and the blocks chosen for its variables so far. Each
move takes the game into a smaller part, until an atomic sentence — which
the world decides — says who won:

- `¬A`: the claim flips, and play moves to `A`.
- `∃x A` claimed true, or `∀x A` claimed false: the student chooses a block
  for `x`, clicking or tapping it on the board or pressing Enter on it.
  `∃x A` claimed false, or `∀x A` claimed true: the computer chooses.
- A binary connective: the student chooses the fewest values for its two
  parts that make the claim true — `A` true, or `B` true, for a true `A ∨ B`
  — and where that takes both parts, the computer picks the one to play on.
  So `A ∧ B` claimed true is the computer's pick, `A ∨ B` claimed true is the
  student's, `A → B` claimed true offers "`A` is false" and "`B` is true", and
  `A ↔ B` claimed true has the student pick "both true" or "both false"
  before the computer picks a part. The same rule covers every connective the
  language has. No sentence is rewritten: every part shown is one the author
  wrote.

The computer plays to win, so a true claim can always be defended and a
false one never can. The undo button (or Ctrl-Z) takes back the student's
last move, the first claim included. The answer is the claim and the
student's choices for each sentence; the grader replays them against the
computer's same moves, so a game counts only if it really was won.

Who wins is the game itself, so its feedback cannot be withheld.
`feedback="none"` is a compile error, and a game exercise that says nothing
gets `full` rather than the assignment's default, which is `none` while
grades are held back. `feedback="terse"` says who won; `full` also says, of a
lost game, whether the first claim was wrong or which choice lost it.

### The world

Each object is a data line. For blocks, `| block : large cube at 3,5 named a, b`:
a size (`small`, `medium`, `large`) and a shape (`tet`, `cube`, `dodec`) in
either order, a square `at column,row`, and optional names. Columns run 1–8
left to right and rows 1–8 back to front, so row 8 is nearest the viewer. A
world holds at most 16 blocks, one per square, and a name names one block.

In the author preview the start world is editable; **Copy as source**, in
the exercise's action bar, puts the edited world's object lines on the
clipboard. A distinguish exercise's worlds A and B are both editable there:
one palette edits whichever board was last clicked or tabbed into, a
palette button copies that world over the other, Check judges the sentence
against the worlds as edited, and **Copy as source** writes the `A` lines
and then the `B` lines.

### Constraints

These apply to `build` and `counterexample`:

- `| law : sentence` must be true in the submitted world. Laws are shown
  apart from the sentences, and are checked at the end, not after every
  edit. A law false in the start world is a compile error.
- `| pinned block : …` may not be moved, reshaped, renamed, or removed.
- `budget="N"` limits how many blocks may differ from the start world —
  added, removed, or changed, each counted once.

A world that breaks the rules — two blocks on a square, a pin moved, the
budget spent — is a valid answer scored zero with the reason, not a
rejected submission. A build exercise already solved at the start is a
warning.

### The blocks language

A symbol means something in the world because the language gives it a
`blocks.*` role, not because of how it is spelled. A German course can write
`LinksVon(a,b)`. Multi-place predicates take an argument list, and a role
interprets one arity: `LeftOf(a,b,c)` is a different symbol with no meaning,
and a compile error.

| Role | Arity | True when |
| --- | --- | --- |
| `blocks.tet`, `.cube`, `.dodec` | 1 | the block has that shape |
| `blocks.small`, `.medium`, `.large` | 1 | the block has that size |
| `blocks.smaller`, `.larger` | 2 | first is strictly smaller / larger |
| `blocks.same-size`, `.same-shape` | 2 | equal size / shape |
| `blocks.left-of`, `.right-of` | 2 | first's column is less / greater |
| `blocks.back-of`, `.front-of` | 2 | first's row is less / greater |
| `blocks.same-row`, `.same-col` | 2 | equal row / column |
| `blocks.adjoins` | 2 | orthogonally adjacent squares |
| `blocks.between` | 3 | on one row, column, or diagonal, first strictly between |

Identity is the core `identity` role. A complete example language is in
[`tests/helpers/blocks-language.ts`](../tests/helpers/blocks-language.ts).
Its letter delimiters let students write `∃yLeftOf(y,x)` tight, and so
every predicate name is declared whole as well; a language without letter
delimiters reads `∃y LeftOf(y,x)` instead.
The same language works in model and translation exercises, where the
predicates are ordinary ones: other types read a dotted role as no role at
all.

See [the world reference](../src/worker/exercises/world/README.md) for the
world-kind contract and the answer format.

## Truth-tree directive

A truth tree (a semantic tableau) decides whether an argument is valid, or a
set of sentences consistent, by trying to make its root all true at once.
The student develops the tree a step at a time, citing the row each step
develops; closes a branch that holds a sentence and its negation, citing both
rows (or the one row `a≠a`); and marks a complete open branch with `↑`. The tree is the whole
answer: what it shows follows from it, so the student is not asked to say.
(A multiple-choice exercise beside it can ask, if the lesson wants to.) The
rules are those of *forall x: UBC* (Ichikawa and
Jenkins), chapters 5, 10 and 12.

```md
::::truth-tree{#tt1 points="3"}
Is this argument valid? Use a tree to decide.

(D & ¬R) ∨ Q, ¬Q ∨ R :|-: D ∨ R
::::

::::truth-tree{#tt2 points="3"}
Use a tree to decide whether this set is consistent.

- ∀x(Fx ⊃ Gx)
- ∃xFx
- ¬∃xGx
::::
```

The question comes from the body. An argument line,
`premises :|-: conclusion`, asks whether the argument is valid, and the
root is the premises followed by the negation of the conclusion. A list of
sentences asks whether the set is consistent, and the root is the list.
There may be no premises (`:|-: P ∨ ¬P` tests a logical truth), and there
is exactly one conclusion.

- `system` names the tree theory, and defaults to `forallx-ubc`. It must be
  a tree theory (below); a validity question also needs a way to deny a
  sentence.
- `finish` says when a tree is done: `closed` (the default) when every
  branch is closed; `one-open` when every branch is closed, or one branch is
  marked open and complete (UBC §5.x); `complete` when every branch is
  closed or marked open and complete. A branch can be marked open (`o`) only
  when `finish` is not `closed`, so a question whose answer is a complete
  open branch (a consistent set, an invalid argument) needs `one-open` or
  `complete`.

### Writing a tree theory

The tree's calculus comes from the theory `system` names, as a proof
system's does: Carnap ships no default rules. A tree is checked as a
derivation of "the root closes", read from the bottom up, and the theory
says what that means through `@syntax role` annotations:

| Role | On | Meaning |
| --- | --- | --- |
| `tree.closes` | a term | "this branch closes"; its argument's sort is the branch sort |
| `tree.focus` | a term | "this branch closes by a step on these rows", both arguments branches |
| `tree.unfocus` | an axiom | from `focus Γ at Δ` to `closes Γ ; Δ` |
| `tree.closure` | an axiom | what a closed branch's `×` cites by |
| `context-join` | a term | the branch join, as for a sequent's context |
| `tree.assert`, `tree.deny` | terms | how the root says a sentence is true, and is not |

- A **row** is read at the one sort with a coercion into the branch sort:
  the sentence sort for UBC, a signed-sentence sort for a Smullyan tableau.
  Where rows are sentences, `tree.assert` may be left out (a sentence
  asserts itself), and `tree.deny` defaults to the language's negation.
- Each **rule** is an axiom concluding `focus Γ at Δ`, where `Δ` is the
  rows a step cites, with one premise `closes Γ ; …` per branch it opens.
  The student types the rule's `@syntax alias`, the book's margin label. A
  rule that splits is two axioms, one per order of its branches, with the
  alias on the second and a `@fallback` onto the first.
- The branch join should be `@acui`, with idempotence, so that a row written
  twice is written once, and the rules should keep the row they develop, so
  that a branch may still close on it.
- A rule may take several instances in one step through variants chained by
  `@fallback`, as `forallx-ubc`'s `∀` does for up to five.
- A rule that cites no row, such as Cut, focuses on the empty branch: the
  unit its join's `@acui` annotation names (`focus Γ at _`). A step by it is
  written with no citation; any other step left uncited is unfinished.
- **Give the judgements notations.** A language with letter delimiters
  splits a bare multi-letter term name such as `cl` into letters, so
  `forallx-ubc` writes them `closes Γ` and `focus Γ at Δ`.

A theory missing any of this is refused when the lesson compiles, with the
list of what it lacks. `forallx-ubc.mm0` is the worked example.

#### When a row is developed

A tree with `finish` other than `closed` lets a branch be marked open, and an
open branch must be complete: every row on it developed. Which rows count,
and when, is the book's, so the theory says it, with roles on the rule a
student's name resolves to (the aliased axiom; the role covers its
`@fallback` chain):

| Role | A row the rule applies to is developed on a branch when |
| --- | --- |
| `tree.development.once` | a step on the branch develops it by this rule |
| `tree.development.once.<binder>` | the same, and the mark lists the instance at `<binder>` (`✓a` for `∃`) |
| `tree.development.general.<binder>` | there is a step with the instance at `<binder>` for every term of that sort on the branch (`\a,b`) |
| `tree.development.nonempty` | with `general`: one step even when the branch has no terms |
| `tree.development.none` | never needed |

- A rule with no role is `once` if it develops one row, and asks nothing if
  it develops several (a closure, an identity step).
- A rule applies to a row its focus pattern matches: `∀ x ph` matches any
  universal. The match is syntactic, so a focus that needs the theory to
  compute (a substitution) matches nothing.
- Only steps the engine accepted count. A step's instance is found by the
  engine too: the editor asks it which term each row was written with, and
  the certificate proves the answer, so the server checks it as it checks
  the steps. That needs the judgement sort's `@relation` to name a modus
  ponens rule, as `forallx-ubc`'s `jeq_mp` does.
- A branch marked open is refused if the closure rule's focus matches one or
  two of its rows.

A theory with no development roles at all cannot be used with `finish`
other than `closed`, and a role that does not read (an unknown kind, a
binder the rule does not have) is reported when the lesson compiles.

The student writes every row. **Stack** (`t`) adds a row at the end of the
branch, **Split** (`s`) branches it in two, and **Add row** (`r`) adds
another row to the same step, as `≡` needs. Whether a rule stacks or splits
is part of what is being learned.

The toolbar's buttons act on the row at the cursor; the `(?)` in the action
bar lists their keys. **Close** (`x`) asks for the rows the branch
closes on: a circle appears beside the number of each row on the branch, as
a truth table's counterexample radios do, and the student ticks two. While
it is open the circles are the only controls: ↑ and ↓ move between them,
Space or Enter ticks one, and the rows take no clicks. The second tick
closes the branch, or the first, on a row `a≠a`; Esc puts it away. A branch's `×` or `↑` takes the
cursor too, below the branch's last row: Enter on a `×` marks its rows again,
and Delete reopens the branch.

### How a tree is checked

The tree is checked by the Aufbau engine, as a proof is. Each step is an
inference in the tree theory: the branch above it closes if the branches it
writes do, by the rule the step names, from the rows it cites. Each closure
is an inference too, by the theory's closure rule. Once the edits pause the
editor compiles them all, and a step or closure the engine refuses is flagged
on its row or its end (under full feedback). The compile's certificate goes
with the answer, and the server verifies it against inferences it writes
itself from the stored tree, so a grade never rests on the browser's word.

For `forallx-ubc`, the rules are the book's (§5, §10, §12.7):

- A rule that splits may have its branches in either order, and the rows a
  step writes may come in any order. A universal (or a negated existential)
  may take several instances in one step, up to five.
- An existential (or a negated universal) takes an instance whose name is
  new to its branch; a universal (or a negated existential) any name.
- **Identity** (UBC §12.7). A step may cite two rows, an identity `a=b` and
  any row above it on the branch (in either order, typed `3, 7`), and write
  that row with every `a` made `b`, or every `b` made `a`. Its margin reads
  `3, 7 =`.
- A closure cites two rows on its branch that are a sentence and its
  negation, or one row `a≠a`.
- A branch marked `↑` must be open and complete: every row on it developed
  on that branch, and every universal instantiated for every name on the
  branch (and at least once, if there are none). An identity is not yet
  required to be substituted into the branch's literals, as the book asks.

For `open-logic-tableaux`, the rules are the Open Logic Project's signed
tableaux (*Sets, Logic, Computation*, "Tableaux"):

- A row is a signed formula, `𝕋 A` or `𝔽 A`, typed `T: A` or `F: A` (not
  `T A`: `T` and `F` are predicate letters). The root is `𝕋` before each
  premise and `𝔽` before the conclusion, or `𝕋` before each sentence of a
  set.
- A rule is named by its operator, then the sign it applies to, as the book
  writes it: `∧𝕋`, `→𝔽`, `∀𝕋`, typed `∧T` or `&T`, `->F`, `@T`. There are
  rules for `¬`, `∧`, `∨`, `→`, `∀` and `∃`, as in the book; a row with `↔`,
  `⊥` or `⊤` at its top is never developed.
- `∀𝔽` and `∃𝕋` take a constant new to the branch; `∀𝕋` and `∃𝔽` any
  closed term, one per step.
- **Identity.** `=` cites no row and writes `𝕋 t = t`. `=𝕋` and `=𝔽` cite
  two, `𝕋 t₁ = t₂` and a row with `t₁` in it, and write that row with some of
  its `t₁` made `t₂`, in that direction only.
- **Cut** cites no row and splits the branch into `𝕋 A` and `𝔽 A`.
- A closure cites `𝕋 A` and `𝔽 A`.
- The language is the book's: atoms `A`, `A(a)`, `C(x, b)`, function terms
  `f(a)`, constants `a`–`e`, `s`, `t` (subscripted too, `s₁`, typed `s1`),
  variables `u`–`z`, and every binary formula bracketed, bar the outermost.

A step with no rule named, or no row cited, is unfinished rather than wrong.

Marks (`✓`, `✓a`, `\a,b`) are computed. The margin (`2 ∨`) is typed, as
the book has the student write it: the row a step develops (`c`, or Alt-C
from inside a row), then the rule it uses (`j`, or Alt-J, or Tab from the
citation). A rule is one of the theory's `@syntax alias`es, in any of its
spellings, and is shown in the first: `\/` is written `∨`. A rule the
theory has no name for stays in the margin, squiggled, and the step names
no rule. As in the book, a step is justified once, beside its first row: a
row added to the step leaves its margin blank, and a new step has its own. Rows are numbered the book's way: lines are shared across
branches, and a step repeated on two branches shares its lines.

Grading is all or nothing: every row and closure right, every `↑` on a
complete open branch, and the tree done by `finish`. Under full feedback the
editor flags a wrong step as soon as the engine has checked it, and Check
names the first problem in tree order. Under terse feedback Check says only
whether the tree is right. The review of a submitted tree draws it and says
what can be seen without the engine (an unfinished tree, a misplaced end);
the grade is the engine's. Trees are capped at 200 rows.

## Aufbau-proof directive

The four proof directives share one grading mechanism. The browser compiles
a proof with `@aufbau/compiler` into an MMB certificate. The server verifies
that certificate with `@aufbau/verifier` against the saved theory and goal.
Browser success state and submitted proof text are not trusted for grading.

The engine's `sorry!` justification admits a line without a rule. Exercises
reject it: the widget reports a problem and sends no certificate, and server
verification rejects certificates containing such admissions. With the
boolean `allow-sorry` attribute (on `aufbau-proof`, `aufbau-proof-fitch` and
`aufbau-proof-tree`) an admitted line is shown as a warning instead of an
error, and once every other line checks the widget says so — but the proof
is still not correct, and never scores. Outside an exam the widget will not
submit a proof with admitted lines, and says why; on an exam it submits, for
zero. The attribute is for practice: a student can see that the shape of a
proof is right before every gap in it is filled. `sorry!` admits a leaf and
takes no premises, so in a tree it can only stand where a leaf can; the
Prawitz directive does not take the attribute, since a leaf there has no
assumptions above it and so proves nothing that depends on any.

`aufbau-proof` is the linear proof-script editor. Its body contains a prompt,
a `theorem` declaration, a `----` separator, and a starter proof body. The
goal is fixed; students edit only the proof body. (With the `playground`
attribute there is no goal line at all; see [Playground
exercises](#playground-exercises).)

This complete example declares a small theory first:

```md
:::aufbau-mm0{name="prop"}
delimiter $ ( ) $;
provable sort wff;
term imp (a b: wff): wff;
infixr imp: $->$ prec 25;
axiom ax_1 (a b: wff): $ a -> b -> a $;
:::

:::aufbau-proof{system="prop" id="implication"}
Prove the stated implication.

theorem thm_k (a b: wff): $ a -> b -> a $
----
l1: $ a -> b -> a $ by ax_1 []
:::
```

The theory and theorem declaration are frozen in the revision. Consumers
receive their combined engine text as `publicData.mm0`. In current artifacts,
shared theory source is stored once in a systems table and joined with each
exercise's goal, rather than duplicated per exercise.

The common attributes apply. `system` is required and names an
`aufbau-mm0` block or a built-in system. `options` accepts `auto` and
`complete`, both off by default; the same attribute is accepted by all four
proof directives. The flags are parsed and stored, but no editor reads them
yet: they are reserved for proof-search (`auto?`) and rule-completion
assistance in the browser, which is not wired up.

Linear proof lines are engine syntax, including axiom identifiers. Unlike the
other proof interfaces, this editor does not translate surface-language rule
aliases or student formula notation before compilation.

See [the linear proof guide](../src/worker/exercises/aufbau-proof/README.md)
and the Aufbau engine repository's `docs/proof.md` for proof-script syntax.

## Languages and theories

`system` selects the MM0 artifact an exercise uses. A theory defines sorts,
terms, axioms, and proof rules. A language adds `@syntax` annotations that
define student spellings, canonical output, and parsing restrictions.
One file can provide both, as the forallx systems do.

Resolution checks a named `aufbau-mm0` block declared anywhere in the
document first, then a built-in ID. A block is in scope for the whole
document, so it may follow the exercises that name it, and a block named after
a built-in shadows that built-in wherever it stands. An unknown name reports
both sets of available names. This lets a course extend a built-in and use the extension consistently
in proofs, models, truth tables, and translations.

### Naming a theory the site serves

Use `src` to load a built-in into a named block:

```md
:::aufbau-mm0{name="forallx" src="/theories/forallx-calgary.mm0"}
:::
```

The eight built-in IDs are:

- `forallx-calgary`: Calgary natural deduction, first-order syntax,
  basic rules.
- `forallx-calgary-plus`: the same language with derived rules.
- `forallx-magnus`: the original Magnus forallx QL rules and notation.
- `forallx-magnus-plus`: the same language with derived/replacement rules.
- `forallx-ubc`: the language of *forall x: UBC*, and its truth-tree rules
  (see [Writing a tree theory](#writing-a-tree-theory)).
- `open-logic-tableaux`: the Open Logic Project's first-order language, and
  its signed tableau rules.
- `gentzen-lk`: classical multi-conclusion sequent calculus, suitable for
  proof trees. It has no student-language annotations.
- `carnap-prop`: the default propositional signature, without proof rules.

Each is served at `/theories/<id>.mm0`. Open that URL to inspect the source
and rule names. Exercise `system` can name a built-in ID directly; an extra
block is needed only for naming, extending, or displaying it.

Built-ins are resolved from the application code, without a network fetch.
Remote-origin theory URLs are not supported. Copy the source into a block or
host an immutable theory revision on this site instead.

### Hosting a theory of your own

Create a content item of kind **Theory or language**. Its revisions contain
MM0 rather than Markdown, and saving validates that the source can be read.
The revision page gives its address:

```text
/content/revisions/<revision-id>/theory.mm0
```

Use that address as a block's `src`. Use the block's name, not the address,
in exercise `system` attributes.

Hosted theory references have these properties:

- They name a revision, never “latest”. To adopt a newer theory, save a new
  lesson revision using its new address; see
  [When a theory changes](#when-a-theory-changes).
- The lesson compiler resolves the source at authoring time and freezes it
  into the lesson. Students do not fetch the hosted revision.
- Sharing is per revision: private, available to content authors on the site,
  or public. Future revisions are not automatically shared.
- Permission is checked when another author saves a lesson using the theory.
  Narrowing sharing later cannot revoke text already copied into that lesson.
- A colleague's lesson includes the theory text in its student data. Sharing
  a theory for reuse also permits that distribution.

The Worker resolves hosted theories through a store read; browser previews
use the same-origin source route. An inaccessible revision is not
identified separately from a missing or unsuitable one.

A hosted theory with `@syntax role sentence` can also supply the language
for semantic exercises.

### When a theory changes

A saved lesson keeps the theory text it was compiled against, so a later
change to a theory never alters a published assignment's rules or grades on
its own. The revision also records, for each theory read from an address,
that address and a hash of the text found there. A theory written in the
block body has no address and is not tracked.

The content library marks a lesson whose latest revision is affected with a
warning icon beside its title. The content item page checks its latest
revision, and an instructor's assignment page checks the revision the
assignment uses; either page explains the warning. A theory counts as
changed in these cases:

- **A built-in**, when the file this site ships no longer matches
  the recorded hash. Save the lesson again, with the same source if nothing
  else changed, to build a revision on the current file. A revision's content
  hash covers the theories it read, so this save is not refused as a
  duplicate.
- **A hosted theory**, when its item has a later revision with
  different text that the reader may read. The warning gives that revision's
  address; point the block's `src` at it and save. A later revision the
  reader may not read is not mentioned.

An assignment then takes up the new lesson revision through a correction,
which records the change and refreshes scores. Revisions saved before
origins were recorded give no warning.

### Extending a theory, and writing one

A block can combine `src` with a body. The body is raw MM0 appended after the
referenced source:

```md
:::aufbau-mm0{name="ours" src="/theories/forallx-calgary.mm0"}
--| @syntax delimiter $ Cube Loves $
term Cube (x: tm): wff;
term Loves (x y: tm): wff;
:::
```

Add congruence axioms if identity elimination must replace equals inside new
predicates. For example, in the body above:

```mm0
--| @congr
axiom Cube_congr (a b: tm): $ a = b $ > $ Cube a ↔ Cube b $;
```

Without a congruence declaration, the predicate can parse and occur in proofs,
but identity rewriting cannot traverse it automatically.

A body without `src` declares a theory from scratch, as in the linear-proof
example. The built-in signatures already provide their documented letter
vocabularies; extensions add names rather than replace those vocabularies.

### Delimiters and multi-character names

The parser segments input using delimiters before looking up names. Forallx
Calgary declares Roman letters as delimiters so `AxF(x)` can be read without
spaces. A new name such as `Cube` would be split into letters unless declared
as a complete delimiter:

```mm0
--| @syntax delimiter $ Cube $
```

Longest matching spellings win, so `Cube` remains one name while `C(a)` still
uses the predicate letter C. One delimiter annotation can list several names.
The compiler diagnoses unreachable names and suggests this repair.

`carnap-prop` does not split on letters, so a declaration such as `Rain` or
`P1` needs no additional letter delimiter. New operator spellings still need
the appropriate delimiters.

### Showing a theory to students

Theory blocks are hidden by default. Add `show` to render a collapsed source
panel labeled with the theory name:

```md
:::aufbau-mm0{name="forallx" src="/theories/forallx-calgary.mm0" show}
:::
```

The panel shows the source including extensions and syntax annotations.
Engine input strips `@syntax` annotations, since they belong to the surface
parser rather than the verifier.

### Language roles

Semantic exercise types read constructor roles rather than hard-coded
notation tables. For example, `@syntax role conjunction` tells a truth table
how to interpret a connective regardless of its printed spelling.

Any readable language may be selected, but individual formulas must use
constructs the exercise understands. A truth table rejects a quantifier at
that formula's location. It can treat a role-less sentence constructor such
as `F(a)` as an atom. A constructor with an unsupported role is rejected,
not silently treated as a new atom.

For models and translations:

- A role-less constructor returning the sentence sort is a predicate.
- A suitable term constructor is a function.
- `@syntax role individual` names the sort interpreted by the model's
  domain; sorts coercing into it also count.
- `@syntax role argument-list` identifies a structural list of arguments
  for variadic predicate/function letters. Without it, binders are individual
  arguments, suitable for fixed-arity symbols.

Binders must be ordinary individual arguments. Constructors that bind
variables or take sentences as arguments, such as description operators or
formula-dependent functions, are not interpreted as ordinary model symbols.

Meaning comes from the constructor tree; displayed field labels and stored
formulas come from canonical notation. A function declared with infix `+`
can appear as `a+b`, with `_+_` as its table label. Without notation, a
predicate such as `Red` uses its name and brackets, as in `Red(_)`.

### Truth-function roles

All sixteen binary truth functions are available, along with negation and
truth constants. A custom system can declare a constructor with one of these
roles for use in truth tables, models, and translation checking:

| Role | Meaning |
| --- | --- |
| `negation` | ¬p |
| `verum` / `falsum` | ⊤ / ⊥ |
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
| `binary-verum` / `binary-falsum` | Always true / always false |

For example, add a NAND stroke to the propositional signature:

```md
:::aufbau-mm0{name="stroke" src="/theories/carnap-prop.mm0"}
--| @syntax delimiter $ | $
--| @syntax role nand
term nand (p q: wff): wff;
infixl nand: $|$ prec 40;
:::

::::truth-table{id="nand-table" system="stroke"}
Compare the columns.

- P | Q
- ~(P /\ Q)
::::
```

Non-truth-functional roles include `forall`, `exists`, `identity`,
`inequality`, `sentence`, `individual`, `argument-list`, `turnstile`, and
`context-join`. Each exercise uses only the roles relevant to its operation.

### Which forallx

The Calgary and Magnus editions have different rules as well as notation.
Select the one used by the course's textbook. UBC's edition is Magnus's
language with a stricter grammar, and ships as a language only.

In both, a goal's turnstile is `⊢` or old Carnap's ASCII `:|-:`. `|-` is not a
turnstile: `|` and `-` are disjunction and negation, so `P |- Q` is the
sentence P ∨ ¬Q.

**Calgary (`forallx-calgary`)**

- Predicates use parentheses: `F(x)`, `R(a,b)`. A bare uppercase letter is
  a sentence letter.
- Names are `a`–`e`, variables `s`–`z`, and function letters `f`–`r`.
  A bare function letter is a constant; `f(x)` is an application.
- Quantifiers accept `A`/`E`, `@`/`3`, and `∀`/`∃` before a variable, and
  `Ax.`/`Ex.` with a dot after it.
- Connectives accept `~`, `/\`, `\/`, `->`, `<->`, and symbol aliases.
  Output uses logical symbols, with `∧` for conjunction.
- Identity accepts `=` and inequality accepts `!=` or `≠`.
- A quantifier scopes over the next sentence, not the rest of the line.
  `AxF(x) -> G(a)` is a conditional.
- Conjunction and disjunction share left-associative precedence. Conditionals
  and biconditionals do not chain or mix unparenthesized with other binary
  connectives: `P -> Q -> R` and `P /\ Q -> R` need parentheses.
- Parentheses group binary compounds only. `(P)`, `(~P)`, and `(a = b)` are
  rejected in student formulas.
- The calculus has `⊥`, explosion (`X`), and indirect proof (`IP`).
  Disjunction elimination uses two cases; negation rules use a contradiction
  ending in `⊥`.

**Magnus (`forallx-magnus`)**

- Predicates use juxtaposition: `Fa`, `Rab`.
- Names are `a`–`w`, variables `x`–`z`; there are no function letters.
- Quantifiers use `@`/`3`, `∀`/`∃`, or `A`/`E` with a dot after the
  variable: `Ax.Fx`. Without the dot, `A` and `E` are predicate letters, so
  `AxFx` is refused and `Axx` is the predicate `A`.
- Canonical conjunction is `&`.
- Conjunction/disjunction bind more tightly than conditional/biconditional.
  Parentheses around an atom, such as `(P)`, are allowed.
- There is no `⊥`. Reductio uses an explicit contradictory pair.
  Disjunction elimination uses disjunction plus a negated disjunct rather
  than Calgary's two-case rule.

**UBC (`forallx-ubc`)**

- The lexicon, juxtaposed predicates and quantifier spellings are Magnus's.
- Names also take a numeric subscript, `a1`–`w9`, typed as `a1` or `a₁` and
  shown as `a₁`. Predicate letters do not. Three subscripted variables,
  `x1`, `y1` and `z1` (ASCII only), are there for the identity rules, which
  need a fresh variable beyond those a row uses; a student may type them.
- Canonical glyphs are the book's: `&`, `∨`, `⊃`, `≡`, and `a≠b` for `¬a=b`.
- The grammar is the book's. Every binary sentence is bracketed except the
  outermost; `[ ]` may stand for `( )`; a run of `&`, or of `∨`, may drop
  its inner brackets and reads right-nested (`A & B & C` is `A & (B & C)`),
  but the two never mix. `⊃` and `≡` take no unbracketed binary operand, so
  `P & Q ⊃ R` is refused. Brackets around anything but a binary sentence,
  such as `(¬A)` or `∀x(Fx)`, are refused.
- Two of the book's rules are not enforced: a doubled pair such as
  `((A & B))`, and a quantifier over a variable already bound inside it,
  such as `∀x∃xFx`, both read.

All three forallx languages declare the `closed-sentences` lint, so their model
and translation sentences must be closed: unbound variables are rejected. The declared vocabularies are finite. Undeclared subscripted names
such as `F_12` or `P0`, old arity annotations, and unsupported word operators
are not supplied automatically. Extend the language if the course needs them.

Names and variables have different sorts. In Calgary proofs, this also lets
MM0 dependency typing enforce eigenvariable restrictions. Their roles cannot
be interchanged merely because both use lowercase letters.

A compiled exercise stores its formulas as engine text, the MM0 spelling of
the parse, which depends on the language's declarations and not on its
`@syntax` display conventions. What a reader is shown is worked out from it
when the page renders, in the language's canonical spelling. There is no
independent table of source spellings. `carnap-prop` has 52 sentence letters
and canonical ASCII connectives; the forallx editions use their own
canonical symbols.

### Basic and derived rules

Choose the base system for basic rules only, or its `-plus` version for these
additional rules:

- **Calgary:** `DS`, `MT`, `DNE`, `LEM`, `DeM`, and `CQ`. `LEM` cites two
  subproofs, as in `LEM i-j k-l`.
- **Magnus:** `DIL`, `MT`, `HS`, `Comm`, `DN`, `MC`, `↔ex` (also `<->ex`),
  `DeM`, and `QN`.

A shared citation name can select whichever rule form fits, such as either
side of disjunctive syllogism or either direction of a replacement rule.

Magnus's replacement rules (`Comm`, `DN`, `MC`, `↔ex`, `DeM`, `QN`) apply
inside a larger sentence, as in the textbook: `~~P -> Q` becomes `P -> Q`
by `DN` in one step, under a connective, under a quantifier, or inside a
subproof. One step exchanges one subsentence, at one or more occurrences.
A line requiring two different exchanges is rejected. Calgary's `DeM` and
`CQ` still apply to whole lines only.

### Rule aliases and structural roles

MM0 axiom identifiers are ASCII. `@syntax alias` supplies student-facing
citations such as `∧I`, `/\I`, and `&I`:

```mm0
--| @syntax alias ∧I /\I &I
axiom and_intro (ga de si: ctx) (ph ps: wff):
  $ ga ⊢ ph $ > $ de ⊢ ps $ > $ ga ; de ; si ⊢ ph ∧ ps $;
```

An alias is one whitespace-free token and must identify exactly one rule.
A duplicate alias or collision with another rule name is an error.
For rules with several forms, the later axiom can use `@fallback` to try an
earlier form. Built-in `∧E`, `∨I`, and `↔E` use this mechanism.

Aliases work in Fitch, tree, and Prawitz rule citations and starters. The
linear proof-script editor uses engine identifiers directly.

The shaped proof interfaces also read structural roles from the theory:

- `assumption`: the axiom that introduces an assumption.
- `turnstile`: the sequent constructor and its notation.
- `context-join`: the separator between context formulas.

Fitch and Prawitz require all three. The forallx context separator is `;`,
not `,`, because comma already separates predicate arguments. Do not add a
per-exercise separator setting to compensate for missing theory roles.

### Formulas in a proof

Fitch and Prawitz read formulas using `@syntax role sentence`. Tree nodes
use the result sort of the `turnstile` role. If the relevant role is absent,
input remains engine text. For example, `gentzen-lk` has no `@syntax`
annotations, so its tree nodes use engine syntax.

With a surface language, the widget parses student input and converts it to
engine notation. Parser errors point to the offending character. The book's
restrictions apply: a Calgary line must write `∀x x = x`, not
`∀x(x = x)`, because identity is not a binary connective that accepts
grouping.

Theorem binders are in scope while parsing the goal and proof. In
`theorem mp (a b: wff): $ (a → b) ; a ⊢ b $`, `a` and `b` are formula
metavariables rather than the language's ordinary names.

Every variable and name the goal uses must be bound there too, since MM0 has
no free variables. In Calgary,
`theorem g {x y: var} {c: name}: $ ∀x F(x) ⊢ ∀y F(y) ∧ F(c) $` binds the
`x` and `y` its quantifiers use and the name `c` it mentions. Leaving one
out is refused at save time with the binder to add. Proof lines need no
such declaration: a name or variable first used in a line is bound for it.

A binder that shadows a variable, term, or notation produces a warning but
does not prevent saving. If it shadows notation, that spelling can become
unavailable within the exercise; for example, binding `A` can remove its
quantifier reading. Binding a variable at its existing sort does not warn.

Starters are parsed during authoring, so invalid starter formulas are caught
before students open the exercise.

Goals in shaped proof exercises are also converted from surface syntax.
Each math string in the `theorem` declaration is read at the turnstile result
sort, falling back to the sentence sort. Goal parsing omits the stricter
student-formula lints, such as redundant-bracket checks, but it still requires
valid language syntax. Failures produce `invalid_goal_formula`.
The linear `aufbau-proof` directive keeps its goal and lines in engine syntax.

A Fitch or Prawitz goal must be a sequent, because every line of those proofs
is one and no proof could end with a bare sentence; a goal without a turnstile
is refused with `goal_not_sequent`. A theorem with no premises writes the
theory's empty context before the turnstile: `_ ⊢ P → P` in the forallx
systems. A tree proof's goal may be a bare formula, since its nodes need not
be sequents.

In Magnus Fitch reductio, one range can cite a subproof whose final two lines
are a sentence followed by its negation. For example, `neg_intro 2-5` uses
lines 4 and 5 as the contradictory pair. Explicit citations such as
`neg_intro 2-4 2-5` also work; the rule signature determines how many premises
a range supplies.

### Playground exercises

All four proof directives accept a boolean `playground` attribute. A
playground has no goal: the student builds whatever derivation they like, and
the exercise checks that every line is justified. This is Carnap's playground,
for exploring a system before any particular argument is set.

```md
:::aufbau-proof-fitch{system="forallx-magnus" id="scratch" playground}
Try out the rules of SL here. Any well-formed derivation counts.
----
P → Q  :AS
:::
```

The body is the prompt, optionally followed by a `----` underline and a
starter; the first `----` line ends the prompt. A `theorem` header is an
error in a playground (`playground_declares_goal`), and a directive without
`playground` still needs one (`missing_theorem_header`): dropping the header
by accident never turns an exercise into a playground.

The statement a playground proves is taken from the proof itself: the last
line of a Fitch proof with the assumptions still open at it, the root of a
tree, the root of a Prawitz derivation with its undischarged assumptions, or
the last line of a linear proof. The widget shows it live as **Proves** (and
asks the student to **Enter a proof** until there is one to read), and it is
the goal the certificate is verified against and the goal the review page
names. Variables in the statement (the `@vars` tokens of the system —
`x`, `a` and their pools in the forallx systems) are bound automatically;
nothing else can be, so a playground statement is always a concrete sentence
or sequent in the system's own vocabulary, never a schema over metavariables.

A playground is scored like any other exercise: the proof is correct when its
certificate verifies, and worth `points` (`points="0"` for an ungraded one). A tree playground has no goal
hypotheses to cite, so its "Add hypothesis" control is disabled, as it is for
any goal that declares none.

## Aufbau-proof-tree directive

Use a proof tree when students should build premise subtrees above each
conclusion. The browser converts the tree to linear proof text, compiles it,
and submits a certificate for server verification.

The body has a prompt and a theorem line. Without a starter, the root is
seeded with the fixed goal:

```md
:::aufbau-proof-tree{system="gentzen-lk" id="tree-identity"}
Build a derivation of identity.

theorem identity (a: wff): $ a ==> a $
:::
```

To prepopulate the tree, add `----` and linear starter lines:

```text
label: $ formula $ by rule [references]
```

References name earlier labels or hypotheses such as `#1`. Each line may
be cited by at most one other line, and exactly one root remains uncited.
A proof that reuses a line is a graph rather than a tree and is rejected with
`proof_is_not_a_tree`; duplicate the shared derivation in each branch.
Malformed lines, dangling references, and multiple roots are author errors.

In the author preview, **Copy as source** in the action bar puts the tree
being built on the clipboard as starter lines, to paste under the `----`.
Formulas and rule names are copied as typed. A node still missing its formula
or rule is copied that way too, and the compiler then names the line to
finish.

Students can add premises or hypothesis references and delete subtrees. A
hypothesis reference is a leaf showing the cited hypothesis as the goal
declares it, with a choice of which one where the goal declares several; the
control is disabled for a goal that declares none, which is every goal stated
as a sequent. Feedback is shown on the relevant node. Submission data includes the tree,
generated proof text, and certificate; the server stores the answer and
verdict, not the certificate. Review redraws the submitted tree.

Common attributes and the proof `system` and `options` attributes apply.
Rule names are free text; there is no rule picker or drag-to-reparent UI.
The tree renderer uses the vendored ProofML elements. See
[the tree guide](../src/worker/exercises/aufbau-proof-tree/README.md).

## Aufbau-proof-fitch directive

Fitch proofs are linear lists where indentation opens subproofs. Each line
has a formula, a colon, a rule name or alias, and references:

```text
formula :rule 1 2
formula :rule 2-5
```

A reference is a step number or subproof range. An assumption cites the
theory's assumption rule with no references. A deeper indent opens its
scope; a later shallower line can discharge it by citing the range.

```md
:::aufbau-proof-fitch{system="forallx-calgary" id="fitch-mp"}
Derive Q from P → Q and P.

theorem mp: $ (P → Q) ; P ⊢ Q $
----
P → Q   :AS
P       :AS
Q       :→E 1 2
:::
```

For conditional introduction, indent the assumption and cite that subproof:

```md
:::aufbau-proof-fitch{system="forallx-calgary" id="fitch-self"}
Prove P → P.

theorem self: $ _ ⊢ P → P $
----
    P   :AS
P → P   :→I 1-1
:::
```

The widget shows the goal statement without the theorem name, binders, or
math-string delimiters. It derives each line's context from open assumptions
and translates the proof to sequents for the compiler. Scope lines in the
editor show the same subproof structure used by the translator.

The body after `----` is raw text, not Markdown. The last colon on a line
separates its formula from the justification, allowing colons inside formula
notation.

`system` is required, along with the common attributes. The selected theory
must identify the assumption, turnstile, and context-join roles. The forallx
systems supply them; a theory without them produces a diagnostic naming the
missing role.

Submission data contains `fitchText`, generated `proofText`, and `mmb`.
Only the certificate is verified; the answer text remains available for
review. See
[the Fitch reference](../src/worker/exercises/aufbau-proof-fitch/README.md).

## Aufbau-proof-prawitz directive

Prawitz proofs use natural-deduction trees with labeled discharge. A labeled
assumption appears as `[A]¹`; the inference discharging it carries the same
label.

Students work in a forest of partial trees. They can start assumptions,
select trees in premise order, and apply a rule below them, or add premises
above an existing line. A complete answer is one verified tree ending in
the goal.

The body is a prompt and theorem line, optionally followed by `----` and a
starter:

```md
:::aufbau-proof-prawitz{system="forallx-calgary" id="prawitz-self"}
Prove the conditional by discharging its antecedent.

theorem self: $ _ ⊢ P → P $
----
a1: $ P ⊢ P $ by AS [] -- label:1
c1: $ _ ⊢ P → P $ by imp_intro [a1] -- label:1
:::
```

Starter lines use the same linear format as tree starters, with full
sequents and one uncited root. The parser discards the written contexts and
recomputes them from the assumption and discharge labels.

`-- label:1` labels an assumption leaf. On an inference line it lists labels
to discharge; separate several with commas. Other trailing or whole-line
comments remain ordinary comments. A starter must parse but need not be a
finished proof. A discharge mark with no matching assumption is rejected.

Each node's context contains only its undischarged dependencies, not
assumptions from sibling branches. The compiler and verifier enforce the
selected theory's rules, including eigenvariable conditions.

Like Fitch, Prawitz requires `assumption`, `turnstile`, and `context-join`
roles in the theory. Common attributes and proof options apply. Starter
separators can use any turnstile spelling declared by the theory.

Submission data contains `tree`, generated `proofText`, and `mmb`. Review
redraws the tree; the server records its answer data and verification verdict,
not the certificate.

Vacuous discharge has no direct tree representation: an assumption must
occur in the tree before it can be discharged. A goal such as `a ⊢ b → a`
therefore needs a detour that uses b, for example conjunction introduction
followed by elimination, before discharge. Choose goals accordingly or teach
that derivation. See
[the Prawitz guide](../src/worker/exercises/aufbau-proof-prawitz/README.md).

## Style directive

A style block supplies raw CSS for the isolated content document:

```md
:::style
h1 { color: maroon; }
:::
```

The compiler stores it in the artifact's `css` field. It applies inside the
content iframe and fullscreen document, not to application navigation or
other surrounding UI. Inline author CSS follows the default styles, so it
wins when specificity is equal.

- Style blocks must be top-level, not inside exercises.
- Multiple blocks concatenate in source order.
- The raw-HTML restriction does not apply inside CSS strings.
- Use a longer colon fence if the body needs a line containing `:::`.
- A fenced `css` code block is only a displayed code sample.

Target elements or existing structural classes such as `.exercise`,
`.exercise-prompt`, `.exercise-status`, `.exercise-actions`,
`.exercise-check-status`, `.footnotes`, `.sidenote`, `.sidenote-number`,
and `.has-sidenote` (see [Footnotes](#footnotes)). There is no general author syntax for assigning
classes. `.exercise` is on each exercise's outer box.

Shadow-root controls are isolated from author CSS selectors. Slotted
prompts, action bars, and option labels remain styleable by selector, but a
widget's internal controls — a truth table's cells, a model's fields, a proof
editor — are reached only through the exercise tokens below. Print long
lessons from the fullscreen view.

### Exercise tokens

Every colour and typeface an exercise draws with is a CSS custom property
named `--exercise-*`. Set one on `:root` and every exercise on the page
follows — the widget's interior inside its shadow root, and the Submit
button, action bar, and correctness mark outside it alike:

```md
:::style
:root {
  --exercise-field-bg: #ffffff;
  --exercise-accent: #8b1e3f;
  --exercise-accent-text: #6e1732;
}
:::
```

| Token | What it colours |
| --- | --- |
| `--exercise-text` | a widget's own text |
| `--exercise-text-muted` | secondary text: labels, inference names, a blank cell |
| `--exercise-text-faint` | a disabled control's text |
| `--exercise-surface` | an opaque panel (the help dialog) |
| `--exercise-field-bg` | a control's fill: inputs, cells, toolbar and action buttons |
| `--exercise-inset-bg` | a recessed fill: a locked given, a hovered field, a disabled button |
| `--exercise-border` | a control's edge |
| `--exercise-divider` | a hairline inside content: a table's axes, a dialog header |
| `--exercise-accent` | a focus ring, a field's underline, a pressed dot |
| `--exercise-accent-text` | the accent as text: a toolbar button, a chosen option |
| `--exercise-accent-bg` | a wash behind a selected or unfilled field, a hovered button |
| `--exercise-on-accent` | text on a filled accent |
| `--exercise-correct`, `--exercise-correct-bg` | a correct verdict and its wash |
| `--exercise-incorrect`, `--exercise-incorrect-bg` | an incorrect verdict and its wash |
| `--exercise-warning` | a proof line admitted with `sorry!` under `allow-sorry` |
| `--exercise-highlight` | a truth table's main column and claimed row (drawn at low alpha) |
| `--exercise-shadow` | what the help dialog casts |
| `--exercise-mono-font` | the face for formulas, cells, and proof editors |
| `--exercise-scope-line` | a Fitch proof's subproof lines |

These are the whole of the contract: nothing else set in a style block
reaches a widget's interior, and the palette the default stylesheet is built
from (`--surface`, `--ink`, and the rest) is not part of it and may be
renamed. Without a style block each token takes its value from that palette,
in both colour schemes.

**If you set colours, set `color-scheme` too.** The default stylesheet
follows the reader's operating-system preference: under a dark desktop the
palette, the tokens, and the browser's own form controls all switch to dark.
A style block that paints the page white without saying so leaves cream text
and charcoal editors on it for those readers. One declaration pins the whole
document to the scheme your colours were chosen for:

```md
:::style
:root { color-scheme: light; background: #fff; color: #1a1a1a; }
:::
```

A stylesheet that provides both schemes writes `color-scheme: light dark`
and gives each colour as a `light-dark(light, dark)` pair, as the default
stylesheet does.

### Line length

The default stylesheet sets two measures. Paragraphs, headings, lists, and
the other prose blocks run to `--prose-measure` (38rem, about 80 characters),
so a line of text stays readable however wide the frame is. Figures — code
samples, tables, display math, exercises, and theory panels — run to the
wider `--figure-measure` (54rem), so a truth table or a proof editor is not
held to a sentence's line length. Both share one left edge; only the figures
run on to the right.

Both are tokens, so either can be changed or undone on `:root`. This puts
everything back to the full width of the frame:

```md
:::style
:root { --prose-measure: 100%; --figure-measure: 100%; }
:::
```

### Linking external stylesheets

`src` links a stylesheet and can be combined with an inline body:

```md
:::style{src="https://example.edu/logic-course.css"}
:::
```

It must be an absolute HTTPS URL or a site-relative path beginning with `/`.
HTTP, protocol-relative URLs, other schemes, and bare relative paths produce
`invalid_style_src`.

Use one block per linked stylesheet. Linked sheets load in source order after
default styles and before inline author CSS. They are fetched by the reader's
browser, so the external server must remain reachable.

### Resetting the defaults

`:::style{reset}` omits the default content stylesheet and its font
face declarations. Use it when supplying a complete document design.
It can be empty, contain CSS, or also use `src`.

Supply any needed document and light-DOM exercise styles yourself: the
action bar, Submit button, and correctness mark are unstyled elements until
you style them. Widget interiors keep their own layout and take the exercise
tokens' defaults — tints of the surrounding text colour for fills and rules,
and fixed hues for the accent and verdicts, keyed on `color-scheme` — until
you set the tokens above; a reset stylesheet that sets its own colours owns
the contrast of the result. The font faces go with the stylesheet: formulas
fall back to the system monospace, and the ligatures that draw `->` as `→`
stop unless you link Fira Code yourself.

`reset` and `src` are the only style attributes. Unknown style attributes
produce `invalid_style_attributes`.

## Normalized answer contract

This section is for API and exercise developers. Students do not need to
construct answer JSON manually; the runtime does it for them.

A multiple-choice answer uses the common envelope:

```json
{
  "kind": "multiple-choice-answer@1",
  "schemaVersion": 1,
  "data": { "selectedOptionIds": ["excluded_middle"] }
}
```

Text exercises use `data.text`, with the corresponding answer kind:

```json
{
  "kind": "short-answer-answer@1",
  "schemaVersion": 1,
  "data": { "text": "modus ponens" }
}
```

Truth-table data uses `T`, `F`, or an empty string per cell:

- `reference[row][atom]` contains atom values.
- `cells[formula][row][cell]` contains formula-cell values.
- `validity[row]` supplies the turnstile column for validity tables.
- `counterexample` optionally selects the single row to grade.
- A partial table uses the same layout with one row.

A truth-tree answer is the tree as a list of nodes, each a run of rows with
its parent:

```json
{
  "kind": "truth-tree-answer@1",
  "schemaVersion": 1,
  "data": {
    "nodes": [
      {
        "id": "n1",
        "parent": null,
        "rows": [
          { "id": "r1", "text": "P & Q", "cites": [], "dev": "root" },
          { "id": "r2", "text": "¬P", "cites": [], "dev": "root" },
          { "id": "r3", "text": "P", "cites": ["r1"], "dev": "d1" },
          { "id": "r4", "text": "Q", "cites": ["r1"], "dev": "d1" }
        ],
        "end": { "type": "closed", "cites": ["r3", "r2"] }
      }
    ]
  }
}
```

See each exercise package's reference for its full answer schema. The
assessment registry rejects wrong kinds, unsupported versions, malformed
data, and identifiers not present in the declaration. A valid but wrong
answer is evaluated rather than rejected as malformed.

The submission request also supplies `exerciseId`. See
[Exercise runtime API](./exercise-runtime-api.md) for headers, response
shapes, idempotency, and the distinction between checking and recording.

## Diagnostics

Diagnostics include a code, author-facing message, and one-based line and
column. Errors prevent saving; warnings are displayed but allow it.

Common groups include:

- **Syntax and safety:** `unsafe_raw_html`, `unsupported_directive`,
  `invalid_directive_attributes`, `unknown_attribute`.
- **Exercise identity and settings:** `missing_id`, `invalid_exercise_id`,
  `duplicate_exercise_id`, `invalid_points`, `invalid_exam`,
  `invalid_feedback`, `redundant_check_attribute`.
- **Choice/text answers:** `invalid_mode`, `missing_answer`,
  `not_enough_options`, `invalid_option_id`, `duplicate_option_id`,
  `invalid_option_label`, `invalid_multiple_choice_body`,
  `invalid_answer_key`, `invalid_case_sensitive`.
- **Formulas and tables:** `invalid_formula`, `no_formulas`, `too_many_atoms`,
  `no_fillable_cells`, `invalid_fill_scope`, `invalid_grading_mode`,
  `invalid_check_mode`, `invalid_counterexample_target`,
  `missing_turnstile`, `multiple_turnstiles`, `empty_premises`,
  `empty_conclusions`, `given_row_arity`, `given_cell_arity`,
  `invalid_grid_token`, `given_conflicts_with_key`, `invalid_mark`,
  `unknown_truth_table_option`, `unsupported_truth_table_variant`,
  `invalid_truth_table_body`.
- **Systems and proofs:** `missing_name`, `empty_theory`, `duplicate_theory`,
  `unknown_theory_src`, `remote_theory_src`, `unknown_system`,
  `missing_theorem_header`, `missing_proof_underline`, `unknown_proof_option`,
  `invalid_allow_sorry`, `invalid_goal_formula`, `playground_declares_goal`,
  `proof_is_not_a_tree`.
- **Other content:** `invalid_style_attributes`, `invalid_style_src`,
  `invalid_item_link`, `invalid_math`.

This is not an exhaustive code list. Read the diagnostic message for the
specific repair and accepted values.

## Versioning notes

Changes to parsing, artifact shapes, answer validation, or rendering must
remain compatible with saved revisions or introduce an explicit new version.
A new source profile would use a name such as `carnap-markdown-v2`.

Assignments depend on pinned revision IDs and stored manifests, not mutable
drafts. Stored systems preserve the theory source used when the lesson was
compiled, rather than resolving a newer built-in at grading time.

The old `carnap-` prefix on the original exercise directive names is no longer
accepted. For example, change `carnap-truth-table` to `truth-table` before
saving an old draft. Published revisions continue to render their stored
artifacts and are not reparsed solely because the spelling changed.
