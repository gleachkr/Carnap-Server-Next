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
- [Truth tables](#truth-table-directive), [models](#model-directive), and
  [translation](#translation-directive)
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

There are ten exercise directives:

- `multiple-choice`
- `free-response`
- `short-answer`
- `truth-table`
- `model`
- `translation`
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
- `title` is optional and names the exercise in the interface.
- `points` defaults to `1`. It must be greater than zero and at most `1000`.
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
same content can be used as both an exam and a practice activity.

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
- `system`: a preceding `aufbau-mm0` block name or built-in system ID.
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

### Attributes and options

In addition to the common attributes:

- `variant`: `simple`, `validity`, or `constraint`.
- `system`: a block name or built-in language ID. Defaults to
  `forallx-calgary-2019`; `forallx-magnus` uses the original book's notation.
- `counterexample-to`: `validity`/`tautology`, `equivalence`, or
  `inconsistency`/`contradiction`.
- `check`: legacy `on` or `off`; prefer `feedback`.
- `options`: `nocheck`, `strictGivens`, `double-turnstile`, or
  `negated-double-turnstile`. `forallxStyle` is recognized but not effective.

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
`system` selects a preceding theory block or built-in language; the default
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

## Aufbau-proof directive

The four proof directives share one grading mechanism. The browser compiles
a proof with `@aufbau/compiler` into an MMB certificate. The server verifies
that certificate with `@aufbau/verifier` against the saved theory and goal.
Browser success state and submitted proof text are not trusted for grading.

The engine's `sorry!` justification admits a line without a rule. Exercises
reject it: the widget reports a problem and sends no certificate, and server
verification rejects certificates containing such admissions. With the
boolean `allow-sorry` attribute (on any of the four proof directives) an
admitted line is shown as a warning instead of an error, and once every other
line checks the widget says so — but the proof is still not correct, and
never scores. Outside an exam the widget will not submit a proof with
admitted lines, and says why; on an exam it submits, for zero. The attribute
is for practice: a student can see that the shape of a proof is right before
every gap in it is filled.

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

The common attributes apply. `system` is required and names a preceding
`aufbau-mm0` block or a built-in system. `options` accepts `auto` and
`complete`, both off by default. These flags are parsed, but the linear
editor's proof-search and completion controls are not yet wired up.

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

Resolution checks a named `aufbau-mm0` block declared earlier in the document
first, then a built-in ID. An unknown name reports both sets of available
names. This lets a course extend a built-in and use the extension consistently
in proofs, models, truth tables, and translations.

### Naming a theory the site serves

Use `src` to load a built-in into a named block:

```md
:::aufbau-mm0{name="forallx" src="/theories/forallx-calgary-2019.mm0"}
:::
```

The six built-in IDs are:

- `forallx-calgary-2019`: Calgary natural deduction, first-order syntax,
  basic rules.
- `forallx-calgary-2019-plus`: the same language with derived rules.
- `forallx-magnus`: the original Magnus forallx QL rules and notation.
- `forallx-magnus-plus`: the same language with derived/replacement rules.
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
  lesson revision using its new address.
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

### Extending a theory, and writing one

A block can combine `src` with a body. The body is raw MM0 appended after the
referenced source:

```md
:::aufbau-mm0{name="ours" src="/theories/forallx-calgary-2019.mm0"}
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
:::aufbau-mm0{name="forallx" src="/theories/forallx-calgary-2019.mm0" show}
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

The two editions have different rules as well as notation. Select the one
used by the course's textbook.

**Calgary (`forallx-calgary-2019`)**

- Predicates use parentheses: `F(x)`, `R(a,b)`. A bare uppercase letter is
  a sentence letter.
- Names are `a`–`e`, variables `s`–`z`, and function letters `f`–`r`.
  A bare function letter is a constant; `f(x)` is an application.
- Quantifiers accept `A`/`E`, `@`/`3`, and `∀`/`∃` before a variable.
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
- Quantifiers use `@`/`3` or `∀`/`∃`, not `A`/`E`. Those remain predicate
  letters in this language.
- Canonical conjunction is `&`.
- Conjunction/disjunction bind more tightly than conditional/biconditional.
  Parentheses around an atom, such as `(P)`, are allowed.
- There is no `⊥`. Reductio uses an explicit contradictory pair.
  Disjunction elimination uses disjunction plus a negated disjunct rather
  than Calgary's two-case rule.

Model and translation sentences must be closed: unbound variables are
rejected. The declared vocabularies are finite. Undeclared subscripted names
such as `F_12` or `P0`, old arity annotations, and unsupported word operators
are not supplied automatically. Extend the language if the course needs them.

Names and variables have different sorts. In Calgary proofs, this also lets
MM0 dependency typing enforce eigenvariable restrictions. Their roles cannot
be interchanged merely because both use lowercase letters.

Stored formulas use the language's canonical spelling and are reparsed when
compared with saved translation solutions. There is no independent table of
source spellings. `carnap-prop` has 52 sentence letters and canonical ASCII
connectives; the forallx editions use their own canonical symbols.

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
the last line of a linear proof. The widget shows it live as **Proves**, and
it is the goal the certificate is verified against and the goal the review
page names. Variables in the statement (the `@vars` tokens of the system —
`x`, `a` and their pools in the forallx systems) are bound automatically;
nothing else can be, so a playground statement is always a concrete sentence
or sequent in the system's own vocabulary, never a schema over metavariables.

A playground is scored like any other exercise: the proof is correct when its
certificate verifies, and worth `points`. A tree playground has no goal
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

theorem identity (a: wff): $ a ⊢ a $
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
:::aufbau-proof-fitch{system="forallx-calgary-2019" id="fitch-mp"}
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
:::aufbau-proof-fitch{system="forallx-calgary-2019" id="fitch-self"}
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
:::aufbau-proof-prawitz{system="forallx-calgary-2019" id="prawitz-self"}
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
`.exercise-prompt`, `.exercise-status`, `.exercise-actions`, and
`.exercise-check-status`. There is no general author syntax for assigning
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

- **Syntax and safety:** `unsafe_raw_html`, `invalid_directive`,
  `unclosed_directive`, `unsupported_directive`,
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
- **Theories and proofs:** `missing_name`, `empty_theory`, `duplicate_theory`,
  `unknown_theory_src`, `remote_theory_src`, `unknown_theory`,
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
