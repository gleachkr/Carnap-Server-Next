# Truth-table exercise (`truth-table@1`)

Students fill a truth-table grid and can optionally identify a counterexample
row. Browser Check and server grading share a DOM-free logic core. The server
independently checks submissions; no private answer key is needed because
cell values follow from the public formulas.

Variants are `simple` (a full table), `validity` (an argument with a turnstile
column), and `partial` (one student-chosen valuation).

## Authoring

Attributes go in braces; `#id` abbreviates `id`. In simple and partial
exercises, formulas are list items and preceding prose is the prompt. A
bullet can hold comma-separated formulas:

```md
::::truth-table{#demorgan feedback="terse" points="4"}
Fill in both tables and compare their results.

- ~(P /\ Q)
- ~P \/ ~Q
::::
```

### Attributes

- `id` / `#id`: required and unique within the document. IDs allow 1–64
  non-whitespace characters, excluding control and formatting characters.
- `variant`: `simple` (default), `validity`, or `partial`.
- `fill`: `all` (default), `connectives`, or `main`.
- `grading`: `all-or-nothing` (default) or `partial`.
- `check`: legacy `cells`, `terse`, or `off`; prefer `feedback`.
- `counterexample-to`: `tautology`/`validity` (default), `equivalence`, or
  `inconsistency`/`contradiction`.
- `trueMark` / `falseMark`: display strings of 1–8 characters, defaulting to
  T and F. Stored answers always use `T` and `F`.
- `system`: theory-block name or built-in system ID, defaulting
  to `carnap-prop`.
- `options`: space-separated flags, listed below.
- `title`, `points`, `exam`, `feedback`: common settings. Points default to
  1 and must be greater than zero and at most 1000.

Omitted `exam` and `feedback` use assignment defaults. Unreleased graded work
uses `true` and `none`; released grades, practice, readings, and previews use
`false` and `full`. Readings and previews never record answers. Numeric
scores require grade release and feedback other than `none`. See
[Recording and feedback][feedback].

### Fill scope

Reference columns on the left contain atom values. Formula columns contain
one cell for each atom occurrence and connective. `fill` chooses the formula
cells students complete:

- `all`: every cell;
- `connectives`: connective cells only;
- `main`: each formula's main-connective cell only.

Other formula cells are given. Reference columns are editable unless
`autoAtoms` is set. `partial` always requires the whole row; it has no fixed
valuation from which to prefill omitted cells.

### Local checking

Legacy `check` values map to shared feedback:

- `cells` means `full`: per-cell marks and a correct-cell count;
- `terse`: a verdict without identifying mistakes;
- `off` means `none`: no Check button or verdict.

An explicit `feedback` wins over `check`, with a
`redundant_check_attribute` diagnostic if both are present. With neither,
the assignment resolves the setting rather than assuming full feedback.
Editing a cell clears the previous local result.

### Counterexamples

In simple and validity tables, Find counterexample reveals row-selection
radios. Selecting a row designates it for the next Check or Submit; selection
does not itself send a request. All cells remain editable. Leaving the mode
removes the designation without erasing work.

The selected row must be filled correctly and satisfy `counterexample-to`:

| Target | Required formula values |
| --- | --- |
| `tautology`, `validity` | All false |
| `equivalence` | At least one true and at least one false |
| `inconsistency`, `contradiction` | All true |

For `simple`, the target applies to every formula. For `validity`, premises
must be true and the target applies to conclusions. The default is therefore
an ordinary invalidity counterexample: premises true, conclusions false.

The validity turnstile cell is F when the row meets this counterexample
condition and T otherwise. Changing the target changes that column's meaning
even if `nocounterexample` hides the shortcut.

A counterexample earns all or no credit, including under `grading="partial"`.
Review marks only the designated row and displays the rest as submitted,
without grading it. Students can instead submit the whole table.

### Validity tables

The body uses one sequent line: comma-separated premises, `:|-:`, and
comma-separated conclusions. Prose before it is the prompt:

```md
::::truth-table{#modus-ponens variant="validity"}
Is this argument valid?

P, P -> Q :|-: Q
::::
```

A turnstile column appears between premises and conclusions. It is always
student-filled and graded as an additional cell per row. With the default
target, no F in that column means the argument is valid.

Exactly one `:|-:` and at least one formula on each side are required.
Failures produce `missing_turnstile`, `multiple_turnstiles`,
`empty_premises`, or `empty_conclusions`.

### Partial tables

A partial exercise asks for one row. Students choose atom values and fill
all formula cells consistently with them:

```md
::::truth-table{#p1 variant="partial"}
Choose any atom values and complete the row consistently.

- (P /\ Q) -> P
::::
```

Any valuation is accepted unless givens restrict it. An unconstrained row
can receive per-cell credit under `grading="partial"`. A row constrained
by givens is graded all-or-nothing.

### Given grids

All variants accept a trailing positional grid:

```md
::::truth-table{#g1 options="strictGivens"}
Complete the table using the given cell.

- P -> Q

P Q | P -> Q
T F | . F .
::::
```

The first line is an optional header and is skipped. Each data row has
`reference | formula1 | … | formulaN` segments. Tokens are separated by
whitespace: `T` or `F` pins a value, and `.` leaves it open. Reference tokens
follow atom order; formula tokens follow displayed cell order. For `P -> Q`,
that is `[P, ->, Q]`. Alignment spaces do not affect interpretation.

For `simple` and `validity`:

- Reference tokens select rows of the full table. `.` is a wildcard, so
  `T . | . F .` targets every P=T row.
- Only listed patterns seed cells; unmatched rows remain unchanged.
- Every seed must agree with the computed value on every matched row.
  Otherwise compilation reports `given_conflicts_with_key`.

For `partial`, each grid row is an accepted alternative. The submitted row
must match at least one alternative's pinned cells. `hiddenGivens` hides
these constraints from the grid. One visible alternative can prefill the row.

`strictGivens` locks seeded cells and excludes them from grading. Without
it, seeded cells are editable and graded normally. In partial tables it locks
a single visible alternative.

Malformed grids produce `given_row_arity`, `given_cell_arity`, or
`invalid_grid_token`. Interior subformula cells can be seeded; validity
turnstile cells cannot because the grid has only reference/formula segments.

### Options

Implemented flags:

- `autoAtoms`: gives reference atom values.
- `nodash`: displays empty cells without a dash.
- `nocheck`: equivalent to `check="off"`.
- `nocounterexample`: hides the counterexample shortcut.
- `hiddenGivens`: hides partial-table constraints.
- `strictGivens`: locks seeded cells.
- `double-turnstile` / `negated-double-turnstile`: displays `⊨` / `⊭`
  instead of `⊢`, without changing grading.

`turnstilemark` and `immutable` are accepted but have no effect. In
particular, `immutable` does not lock givens; use `strictGivens` for that.
Unknown flags are compile errors.

## Formula notation

The default `carnap-prop` language is an MM0 signature in
`src/worker/logic/theories/carnap-prop.mm0`, read by `@aufbau/syntax`.
It declares 52 single Roman sentence letters and these connectives:

| Connective | Notation | Association |
| --- | --- | --- |
| Negation | `~` | Prefix |
| Conjunction | `/\` | Left |
| Disjunction | `\/` | Left |
| Conditional | `->` | Right |
| Biconditional | `<->` | Left |

Precedence, loosest first, is `<->`, `->`, `\/`, `/\`, `~`.
Parentheses override it. Undeclared subscripted names such as `P0` are not
supplied automatically. A table may use at most `MAX_TABLE_ATOMS` (12)
distinct atoms.

`system` can select another language, including a first-order language's
propositional fragment. Grid labels use its canonical notation rather than
the default spellings. See [Languages and theories][languages] for extensions.

### Supported formula constructs

The reader decides per node whether it can build a truth-table column:

- A role-less constructor is an atom, keyed by its printed form, provided it
  does not take sentence arguments. Thus `F(a)` and `F(b)` are independent
  atoms even though they use the same predicate constructor.
- Negation, truth constants, and all sixteen binary truth-function roles
  have built-in interpretations. A custom NAND or exclusive-disjunction
  constructor can use the corresponding role without changing this package.
- Truth constants have formula cells but no reference columns: their values
  do not vary.
- Binders, identity, unsupported roles, and role-less constructors with
  sentence arguments are rejected at their source location. They must not
  silently become independent atoms, which would change the exercise's
  meaning.

## Keyboard behavior

The grid is one tab stop. Each cell initially has `tabindex="-1"`, and the
widget promotes the active cell. Large tables therefore do not require
visiting every cell with Tab before leaving the exercise.

- Left/Right: previous/next editable cell in the row.
- Up/Down: same column in the adjacent row, or its nearest editable cell.
- Home/End: first/last editable cell in the row.
- Ctrl+Home/End: first/last editable cell in the grid.
- Space/Enter: cycle blank, T, F.

Counterexample radios are a separate native radio group; arrows select rows.
The grid has an accessible description of its keyboard controls.

## Answer data

The answer is a full-width positional grid, including given cells:

```ts
{
  reference: CellValue[][];   // [row][atom]
  cells: CellValue[][][];     // [formula][row][cell]
  counterexample?: number | null;
  validity?: CellValue[];    // [row], validity variant only
}
// CellValue = "T" | "F" | ""; empty means unanswered.
```

`counterexample` names the row to grade; absent or null means a full table.
`publicData.premiseCount` identifies the leading premise formulas for
validity exercises. Partial answers have exactly one row.

Compiled givens carry reference and formula-cell constraints, with empty
values meaning unconstrained. Browser and server derive the same layout
from public formulas, so submitted dimensions must match that layout.

## Implementation and tests

- `logic/formula.ts`: language parsing, formula tree, and printing.
- `logic/truth-table.ts`: atoms, valuations, and evaluation.
- `logic/layout.ts`: displayed parentheses and cells.
- `types.ts`: public data, options, and answer contracts.
- `grading.ts`: fill masks, correct grids, scores, and structural checks.
- `authoring.ts`: directives, attributes, formulas, and given validation.
- `assessment.ts`: normalization, grading, and review.
- `read-only-view.ts`: inert grid and review markup.
- `src/client/components/carnap-truth-table-v1.ts`: browser interaction
  (path relative to the repository root).

Use `tests/truth-table.test.ts`, `tests/truth-table-logic.test.ts`, language
tests, and DOM tests when changing these contracts. The type is registered
once, as the `ExerciseType` object in `index.ts` listed in
`src/worker/exercises/index.ts`; compiler, assessment and renderer dispatch
all read that one registration.

[feedback]: ../../../../docs/carnap-markdown-v1.md#recording-and-feedback
[languages]: ../../../../docs/carnap-markdown-v1.md#languages-and-theories
