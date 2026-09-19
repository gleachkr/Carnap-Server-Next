# Model exercise (`model@1`)

Students describe a finite model: a domain and an interpretation for each
symbol used in the exercise. The model must satisfy the requested property.
Browser Check and server evaluation use the same DOM-free `checkModel`.
There is no secret answer key; the server independently checks submitted data.

Variants are `simple` (make sentences true), `validity` (find an argument
counterexample), and `constraint` (satisfy additional constraints).
The default language is forallx: Calgary 2019; other built-in languages or
course-defined systems can be selected with `system`.

## Authoring

Attributes go in braces, with `#id` as shorthand for `id`. In a simple
exercise, formulas are list items. Prose before the first item is the prompt,
and a bullet can contain comma-separated sentences:

```md
::::model{#two_at_once title="Two at once" points="3"}
Build a model in which both sentences are true.

- ExF(x), Ex~F(x)
::::
```

### Attributes

- `id` / `#id`: required, unique within the document. IDs allow 1–64
  non-whitespace characters, excluding control and formatting characters.
- `variant`: `simple` (default), `validity`, or `constraint`.
- `system`: a theory-block name or built-in system ID; defaults to
  `forallx-calgary-2019`. `forallx-magnus` uses the original book's notation.
- `counterexample-to`: `validity`/`tautology`, `equivalence`, or
  `inconsistency`/`contradiction`; defaults depend on the variant below.
- `check`: legacy `on`/`off`, equivalent to feedback `full`/`none`. Prefer
  `feedback`; specifying both produces `redundant_check_attribute` and uses
  `feedback`.
- `options`: space-separated flags, listed below.
- `title`, `points`, `exam`, `feedback`: common settings. Points default to
  1 and must be greater than zero and at most 1000.

When omitted, `exam` and `feedback` use assignment defaults. Unreleased
graded work defaults to `exam="true" feedback="none"`; released grades,
practice, readings, and previews default to `false` and `full`. Readings
and previews never record answers. Numeric scores also require grade release
and feedback other than `none`. See [Recording and feedback][feedback].

### Variants and target properties

`simple` asks for all listed sentences true by default.

`validity` uses one sequent line with comma-separated premises, `:|-:`, and
comma-separated conclusions. Premises must be true; conclusions must have
the target property, which defaults to all false:

```md
::::model{#someone variant="validity" points="4"}
Show that everyone liking someone does not imply someone being liked by all.

AxEyR(x,y) :|-: ExAyR(y,x)
::::
```

`constraint` uses one list item `- constraints : sentences`. Constraints
must be true in addition to the target property, which defaults to all
sentences true:

```md
::::model{#not_free variant="constraint"}
Use at least two domain elements and make the sentence true.

- ExEy~x = y : AxAyF(x,y)
::::
```

Constraints are not displayed in the widget. State them in the prompt if
students need to know them. Requiring a list item prevents ordinary prose
ending in a colon from being mistaken for constraints.

`counterexample-to` changes the property of the target sentences (conclusions
only in `validity`):

| Value | Required result |
| --- | --- |
| `validity`, `tautology` | All false |
| `inconsistency`, `contradiction` | All true |
| `equivalence` | At least one true and at least one false |

The compiled exercise stores the resolved property, not the synonym used.

### Options

- `nocheck`: equivalent to `check="off"`.
- `strictGivens`: locks given values and enforces them during grading.
- `double-turnstile`: displays `⊨` in validity prompts.
- `negated-double-turnstile`: displays `⊭`.
- `forallxStyle`: accepted for compatibility but not implemented. It would
  change labels to forms such as `UD =` and `extension(F) =`.

### Givens

After the formulas, write `| Field : value` to seed a field. Names match
interface labels and values use the field syntax described below:

```md
::::model{#seeded}
- AxF(x), G(a)
| Domain : 0,1,2
| F(_) : 1,2
| a : 1
::::
```

Unknown fields, repeated givens, and invalid values are compile errors.
Normally givens are editable hints. With `strictGivens`, they are locked in
the UI and restored by the grader if a submitted payload changes them.

Function givens apply per argument tuple. `| f(_) : [0;1]` supplies only
`f(0) = 1`. Under `strictGivens`, that cell locks but other cells remain
editable. This differs from original Carnap's whole-field text lock: a
partially given function must still allow students to complete its other
values, especially when they can choose the domain.

## Formula notation

Parsing uses `@aufbau/syntax` and the shared core in `../../exercise-kit/formula/`.
Language source lives in `src/worker/logic/theories/`, not in per-type
TypeScript tables. A forallx file supplies both the model language and the
proof system used by other exercises.

The [authoring reference][languages] describes Calgary, Magnus, extensions,
and supported roles. The main Calgary rules are:

- Predicates use uppercase letters with parentheses, as in `F(x)` or
  `R(x,y)`. Bare uppercase letters are sentence letters. Arity is part of
  symbol identity: `F(a)` and `F(a,b)` produce separate fields.
- Variables are `s`–`z`, names `a`–`e`, and function letters `f`–`r`.
  A function letter without arguments is a constant. Names do not take
  arguments, and variables cannot also be function letters.
- Quantifiers accept `A`, `E`, `∀`, `∃`, `@`, and `3`, followed by a variable.
- Core connectives accept `~`, `/\`, `\/`, `->`, and `<->`, with aliases
  `-`/`¬`, `∧`/`^`/`&`, `∨`/`|`, `=>`/`>`/`→`/`⊃`, and
  `<=>`/`<>`/`↔`/`≡` respectively.
- Identity is `=`; `!=` and `≠` mean negated identity. Truth constants are
  `⊥`/`_|_`/`!?` and `⊤`.
- The vocabulary is finite. Undeclared subscripts and arity annotations are
  not accepted automatically. Extend the language to add symbols.
- Every model sentence must be closed; free variables are rejected.

Custom fixed-arity symbols also work. `@syntax role individual` identifies
the domain sort, and `argument-list` identifies variadic argument lists.
Fields use constructor identity and arity internally, with labels based on
canonical notation: `Red(_)` for a named unary predicate, `_+_` for infix +.
All sixteen binary truth-function roles are supported, not just the default
language's connectives. Unsupported semantic constructs are rejected.

### Display and precedence

Stored and displayed formulas use canonical notation:

| Typed | Stored and displayed |
| --- | --- |
| `AxAyf(x,y) = f(y,x)` | `∀x∀yf(x,y)=f(y,x)` |
| `P /\ Q \/ R` | `(P ∧ Q) ∨ R` |
| `Ax(F(x) -> G(x))` | `∀x(F(x) → G(x))` |
| `a != b` | `¬a=b` |

Canonical output uses each constructor's last-declared notation. The output
is valid input for the same language.

Calgary has several conventions worth checking when porting a lesson:

1. Quantifiers and negation scope over the next sentence, not the rest of
   the line. `AxF(x) -> G(a)` is a conditional with a quantified antecedent.
2. Conjunction and disjunction share left-associative precedence. Neither
   binds more tightly. Conditionals and biconditionals require parentheses
   when chained or mixed with other binary connectives.
3. Parentheses may group binary compounds only. `(P)`, `(~P)`, `(AxF(x))`,
   and `(a = b)` are rejected.

English word operators and `v` for disjunction are not supplied by the
Calgary file. When porting examples, replace unsupported operators and
remove parentheses around atoms, negations, quantifiers, or identities.
These restrictions are language-specific, not requirements of every model
exercise.

## Fields

The formulas determine the field list. `AxR(x,f(x))` requires a domain,
`R(_,_)`, and `f(_)`. Fields appear in this order: domain, relations,
sentence letters, constants, functions; each symbol group is sorted by label.

- **Domain:** one or more natural numbers, such as `0,1,2`, with at most
  `MAX_DOMAIN_SIZE` (16) distinct elements. Duplicates are collapsed.
- **Relation:** tuples such as `[0,0],[1,0]`. Square, round, and angle
  brackets work; unary tuples may be bare numbers. Empty means an empty
  extension.
- **Sentence letter:** True/False control.
- **Constant:** menu containing domain elements.
- **Function:** a value menu for every argument tuple over the domain.

Every referenced element must belong to the domain. Function tables supply
all argument tuples in the widget; malformed API submissions can still be
partial and are checked by the server.

### Function tables

The last argument labels columns; earlier arguments label rows. A binary
function over three elements has a 3×3 table. A unary function has one row,
and higher arities add rows rather than columns. Each menu has the complete
argument tuple in its accessible name.

`functionTableLayout` is shared by server rendering and browser rebuilding.
Row-major order matches serialization into field text such as
`[0,0;1],[0,1;2]`. The table is an editor for this existing answer format,
not a new storage shape.

Changing the domain rebuilds constant menus and function tables, retaining
values still in range. Function givens seed individual cells as described
above.

## Answer data and grading

`model-answer@1` stores raw field text keyed by label:

```json
{ "domain": "0,1", "fields": { "F(_)": "0,1", "a": "0" } }
```

Normalization drops fields not requested by the exercise. Raw values are
retained so review can show the submitted answer, including mistakes.
Grading is all-or-nothing.

Relevant tests include `tests/model.test.ts`,
`tests/model-semantics.test.ts`, and `tests/language-specs.test.ts`.

## Possible extensions

Relation grids, `forallxStyle` labels, and non-numeric domain elements are
not implemented. A language allowing open formulas would also need an
explicit evaluation policy, such as universal closure; it is not supported
merely by adding notation.

[feedback]: ../../../../docs/carnap-markdown-v1.md#recording-and-feedback
[languages]: ../../../../docs/carnap-markdown-v1.md#languages-and-theories
