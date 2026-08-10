# Truth-table exercise (`truth-table@1`)

An interactive truth-table exercise in the Carnap `prop` tradition. The student
fills a grid; a local **Check** grades it in the browser (no round trip);
**Submit** records an authoritative server grade. Instead of the full table the
student may also designate one row as a **counterexample** (see below). Three
variants ship: **Simple** (construct a table for one or more formulas),
**Validity** (test an argument written with the `:|-:` turnstile), and
**Partial** (fill in a single free row, optionally constrained by givens — see
below). Alternate notation systems and custom marks are deferred — see the
roadmap at the bottom.

## Authoring syntax

Exercises are embedded in `carnap-markdown` with a container directive.
Attributes go in **braces** (`{...}`); the `#id` shorthand sets the id. Formulas
are markdown **list items**; any prose *before* the first list item is the
prompt. A single bullet may hold **several comma-separated formulas**, so the two
lines below are equivalent to `- ~(P /\ Q), ~P \/ ~Q`.

```
::::truth-table{#demorgan variant="simple" fill="all" check="terse" points="4"}
Fill in both tables. If they agree on every row, the formulas are equivalent.

- ~(P /\ Q)
- ~P \/ ~Q
::::
```

### Attributes

| Attribute  | Values / form                         | Default          | Meaning |
|------------|---------------------------------------|------------------|---------|
| `#id` / `id` | identifier (`[A-Za-z][\w-]{0,63}`)  | — (**required**) | Stable exercise id; unique within the document. |
| `variant`  | `simple` \| `validity` \| `partial`   | `simple`         | `simple` builds a table for the body formulas; `validity` tests a `:|-:` sequent; `partial` fills a single free row (see below). |
| `fill`     | `all` \| `connectives` \| `main`      | `all`            | Which cells the student fills (see below). |
| `grading`  | `all-or-nothing` \| `partial`         | `all-or-nothing` | Score all-or-nothing, or by fraction of correct cells. |
| `check`    | `cells` \| `terse` \| `off`           | `cells`          | Local Check verbosity (see below). |
| `counterexample-to` | `tautology`/`validity` \| `equivalence` \| `inconsistency`/`contradiction` | `tautology` | The property a counterexample row must show; applies to both variants (see below). The `nocounterexample` flag hides the button. |
| `points`   | number `0 < n ≤ 1000`                 | `1`              | Nominal points. |
| `trueMark` / `falseMark` | glyph, 1–8 chars          | `T` / `F`        | Display glyph for a true / false cell (cf. Carnap). Display only — the recorded answer stays `T`/`F`. |
| `title`    | string                                | —                | Optional title. |
| `exam`     | `true` \| `false`                     | the assignment's: `true` while its grades are withheld, `false` once released | `true` records every submission; `false` records only correct autograded work. Leaving it out is a third value, not `false`. |
| `feedback` | `full` \| `terse` \| `none` | the assignment's: `none` while its grades are withheld, `full` once released | How much the student is told: `terse` drops the detail, `none` drops the verdict too. The score is separate — it waits for the release date whatever this says. See `docs/carnap-markdown-v1.md`. |
| `options`  | space-separated flags                 | —                | Bare Carnap-style flags (see below). |

### `fill` — which cells are student-filled

The grid has **reference** columns (one per atom, on the left) and, for each
formula, a cell under **every atom occurrence and every connective** in the
written-out formula. `fill` chooses which formula cells the student completes;
the rest are shown pre-filled (given) as scaffolding:

- `all` — every atom-occurrence and connective cell (Carnap default).
- `connectives` — only the sub-formula (connective) columns.
- `main` — only the main-connective column of each formula.

The reference columns are student-filled unless `autoAtoms` is set. `fill` does
**not** apply to the `partial` variant: with no fixed key there is nothing to
pre-fill the omitted cells with, so the student always completes the whole row.

### `check` — local Check behaviour

Check never contacts the server (a truth table's key is a function of the public
formulas, so it is graded client-side with the same core the worker uses):

- `cells` — mark every graded cell green/red with a running count.
- `terse` — only report "All cells correct." or "There's an error somewhere.",
  so students go find the mistake themselves.
- `off` — no Check button (equivalent to the `nocheck` option flag).

Editing any cell clears the previous Check result.

`check` is this type's older spelling of the shared `feedback` attribute —
`cells` is `full`, `terse` is `terse`, `off` is `none` — and is kept so ported
Carnap problems compile unchanged. Prefer `feedback` in new content; writing
both earns a `redundant_check_attribute` diagnostic and `feedback` wins. Only
`feedback` knows about the assignment, which is why a table with nothing
authored on it comes out sealed on an assignment whose grades are withheld.

### Counterexample shortcut

Instead of filling the whole table, the student can press **Find counterexample**
and designate a single row that disproves the claim — Carnap's counterexample
mechanism. The button appears unless the shortcut is disabled
(`nocounterexample` / `check`-independent). Filling the whole table is always a
valid path too; the shortcut just saves keystrokes on large "not-a-tautology"
problems.

`counterexample-to` sets the **property** a counterexample row must show,
evaluating each formula's main connective on it (Carnap's synonyms are folded):

- `tautology` (synonym `validity`, the default) — the formulas are **all false**.
- `equivalence` — the formulas **disagree** (not all equal).
- `inconsistency` (synonym `contradiction`) — the formulas are **all true**.

How the property is applied depends on the variant:

- **simple** — the property must hold over **all** the formulas (e.g. `tautology`
  = every formula false, so the set is not all tautologies).
- **validity** — every **premise** (left of the turnstile) must be **true**, and
  the property must hold over the **conclusions** (right of the turnstile). So
  the default (`tautology`) is the ordinary invalidity counterexample (premises
  true, conclusions all false); `equivalence` asks for a row where the premises
  hold but the conclusions disagree ("are the RHS formulas equivalent, assuming
  the LHS?"); and so on. The designated row's `⊢` mark is `F`.

The property also defines the correct value of a validity table's turnstile
column, so it matters even when `nocounterexample` hides the button.

The UI is **in-place**: entering the mode clears the grid; editing a row selects
it (highlighted, the rest recede); Check / Submit grade only that row. A
counterexample is accepted only when the row is filled in correctly **and**
satisfies the target, and it is scored all-or-nothing even under `grading="partial"`
(it is a single claim, not a fraction of cells).

### Validity variant

With `variant="validity"` the body is a single **sequent** line in Carnap's
turnstile form — comma-separated premises, `:|-:`, comma-separated conclusions —
instead of one-formula-per-list-item. Any prose before the sequent is the prompt:

```
::::truth-table{#modus-ponens variant="validity"}
Is this argument valid?

P, P -> Q :|-: Q
::::
```

The grid gains one **turnstile column** (headed `⊢`), sitting between the last
premise and the first conclusion, with one cell per row that the student marks
`T` or `F`. A row is a **counterexample to validity** when every premise is true
and every conclusion is false; the student marks that row `F` (and every other
row `T`). The argument is valid exactly when no row is a counterexample. The
turnstile column is always student-filled, and it is graded as one more cell per
row — so `fill`, `grading`, and `check` behave exactly as they do for Simple.

A validity table also offers the single-row **counterexample** shortcut (see
above): press **Find counterexample** and fill the one row where the premises all
hold and the conclusions have the counterexample property — marking its `⊢` cell
`F`. By default that property is `tautology` (conclusions all false, the ordinary
invalidity counterexample), but `counterexample-to` can set it to `equivalence`
or `inconsistency`, which also redefines the turnstile column accordingly.
`nocounterexample` turns the button off (the turnstile column still uses the
property).

A sequent must contain exactly one `:|-:`, with at least one premise and one
conclusion; otherwise the compiler reports `missing_turnstile`,
`multiple_turnstiles`, `empty_premises`, or `empty_conclusions`.

### Partial variant

With `variant="partial"` the student fills in **one single row** rather than the
whole table. The body is a formula list, exactly like Simple (`- formula`, with
comma-separated formulas allowed):

```
::::truth-table{#p1 variant="partial"}
Pick any values for the letters and fill the row in correctly.

- (P /\ Q) -> P
::::
```

The grid shows one row: the student chooses the atom valuation (the reference
columns are theirs to set) and completes every formula cell for that valuation.
By default the row is correct as long as it is **filled in consistently** — any
valuation is accepted. (The `fill` scope does not apply; the whole row is always
filled — see above.)

For a partial row with *particular* properties, add a **given grid** after the
formulas (see below) — the reference tokens pin the student's chosen valuation,
and the cell tokens pin cells the solution must match. Multiple grid rows are
alternatives (accept-any-one), which is how you ask for an inequivalence witness.

### Prepopulated cells — the given grid

Any variant may seed cells with a trailing **positional grid** (Carnap's "bar"
form), one line per row:

```
::::truth-table{#g1 options="immutable"}
Fill in the table.

- P -> Q

P Q | P -> Q      (optional header — skipped)
T F | . F .       (row P=T,Q=F: reveal the main -> cell; P,Q left to the student)
::::
```

Grammar: `refTokens | f1Tokens | … | fNTokens`, tokens whitespace-separated.
`T`/`F` pin a value; `.` leaves the cell for the student. The reference segment
has one token per atom; each formula segment has one token per cell of that
formula's layout (`P -> Q` → three cells `[P, ->, Q]`). Alignment does **not**
matter — the parser counts tokens, not columns. A leading `P Q | P -> Q` header
echo (left segment = the atom names) is skipped.

- **Sparse rows.** Write only the rows you seed. A row's reference tokens are a
  **pattern** over the 2ⁿ rows: `T`/`F` pins an atom, `.` is a wildcard, so
  `T . | . F .` seeds every `P=T` row. Unlisted/unmatched rows are fully
  student-filled.
- **Integrity, not answer key.** The key is computed from the formulas, so for
  `simple`/`validity` a seeded value must equal the computed value on every
  matched row, else `given_conflicts_with_key`. (A `partial` grid has no fixed
  key — its tokens *are* the acceptance constraints.)
- **`strictGivens`** locks seeded cells: they render inert and are not graded.
  Without it a seeded cell is prefilled but editable, and graded like any cell.
- For **`partial`**, each grid row is one accepted alternative: the student's row
  is accepted if it matches (any one) grid row's pinned cells. `hiddenGivens`
  keeps them off the grid (grade-only); a lone visible given is prefilled, frozen
  under `strictGivens`. A partial row constrained by a grid is graded
  all-or-nothing even under `grading="partial"`; an unconstrained partial row is
  an ordinary fill that can earn per-cell credit.

Malformed grids are reported at compile time: `given_row_arity` (wrong number of
`|` segments), `given_cell_arity` (wrong token count in a segment),
`invalid_grid_token` (a token that is not `T`/`F`/`.`), and
`given_conflicts_with_key` (a seed contradicting the computed key). Seeding an
interior sub-formula cell is supported; seeding a validity turnstile-column cell
is not (grid segments are `reference | formulas`).

### `options` flags

Space-separated bare flags, mirroring Carnap so existing problems port. We
**implement**:

- `autoAtoms` — pre-fill (give) the reference atom columns.
- `nodash` — draw empty cells blank instead of with a dash (`–`).
- `nocheck` — hide the Check button (same as `check="off"`).
- `nocounterexample` — hide the Find-counterexample button.
- `hiddenGivens` — hide a partial table's givens (grade-only; see above).
- `strictGivens` — lock the seeded given cells (inert, ungraded), so the student
  cannot change the hints; applies to every variant (cf. Carnap "makes givens
  immutable"). See the grid.
- `double-turnstile` / `negated-double-turnstile` — head a validity table's
  turnstile column with `⊨` / `⊭` instead of `⊢` (display only).

Recognised-but-inert (accepted so problems compile; not yet effective):
`turnstilemark`, and `immutable` (Carnap's whole-table *display* lock — distinct
from `strictGivens`; a display-table mode is a future increment). Any other token
is a compile error.

## Notation (`prop`)

| Connective    | Symbol | Notes                          |
|---------------|--------|--------------------------------|
| negation      | `~`    | unary prefix                   |
| conjunction   | `/\`   |                                |
| disjunction   | `\/`   |                                |
| conditional   | `->`   | right-associative              |
| biconditional | `<->`  |                                |

Sentence letters are a single Roman letter with an optional numeric subscript:
`P`, `Q`, `P0`, `R12`. Precedence, loosest to tightest:
`<->` < `->` < `\/` < `/\` < `~`. `/\`, `\/`, and `<->` are left-associative;
`->` is right-associative. Use parentheses to override. A table may use at most
`MAX_TABLE_ATOMS` (12) distinct atoms.

## How it fits together

| File | Role |
|------|------|
| `logic/` | DOM-free `prop` core: `formula.ts` (tokenizer + parser + AST), `truth-table.ts` (atoms, 2ⁿ valuations, evaluator, sub-formula columns, `buildTruthTable`), `layout.ts` (written-out formula → parens + cells). Imported by **both** the worker and the client. |
| `types.ts` | Kind/answer/component constants and the public-data, options, and answer-grid shapes. |
| `grading.ts` | DOM-free grading shared by the worker (score + review marks) and the client (Check): resolve the table, fill mask, correct grid, per-cell verdicts, score fraction, structural guards. |
| `authoring.ts` | Compiles the directive → a `CompiledExercise` (parses formulas, validates attributes/options). |
| `assessment.ts` | `normalizeAnswer` (with dimension checks), `evaluate`, `reviewAnswer` (a marked grid). |
| `read-only-view.ts` | SSR of the inert Declarative-Shadow-DOM grid (reused by the interactive form) and the static review renderer. |
| `../../../client/components/carnap-truth-table-v1.ts` | The client element: enables cells, cycles blank→T→F, restores the prior answer, mirrors the full grid into `answerData`, runs local Check, and moves focus around the grid (below). |

### Keyboard

The grid is **one tab stop**, not one per cell: every cell ships
`tabindex="-1"` and the element promotes whichever cell holds focus. A
4-variable table is 32 cells, and tabbing through all of them to reach the next
exercise is its own barrier.

| Key | Moves to |
|-----|----------|
| ← / → | the previous / next open cell in the row |
| ↑ / ↓ | the same column one row up / down — or the nearest open cell in that row, since a given grid can pre-fill a column on some rows only |
| Home / End | the row's first / last open cell |
| Ctrl+Home / Ctrl+End | the grid's first / last open cell |
| Space / Enter | cycles the focused cell (the cells are buttons; nothing extra is wired) |

Movement never counts as an edit, which matters in counterexample mode:
designating a row *clears the grid*, so arrowing through the rows to read them
has to stay free of that. The table carries an `aria-describedby` note naming
these keys — visually hidden, because a sighted reader infers a grid's
navigation from its shape and a screen-reader user cannot.

The type is registered in the three dispatchers under
`src/worker/application/content/`: `compiler.ts`, `registry.ts`, `renderer.ts`.

### Answer shape

A full-width positional grid, aligned to the layout both sides derive from
`publicData.formulas`:

```ts
{
  reference: CellValue[][];   // [rowIndex][atomIndex]
  cells:     CellValue[][][]; // [formulaIndex][rowIndex][cellIndex]
  counterexample?: number | null; // designated row index, or absent/null for a full table
  validity?: CellValue[];     // validity variant only: the turnstile column, one mark [rowIndex]
}
// CellValue = "T" | "F" | ""   ("" = unfilled)
```

Given (non-fillable) cells carry their value too, so the grid stays full width
and lines up with the worker's positional grader. A counterexample submission
uses the same full-width grid with only the one designated row filled, plus
`counterexample` naming that row; grading then scores just that row and checks
the target. For the validity variant, `publicData` also carries `premiseCount`
(how many leading `formulas` entries are premises) and the answer adds the
`validity` turnstile column. For the **partial** variant the grid — and so the
answer's `reference`/`cells` — is exactly **one row** (whatever the atom count);
`publicData` carries the author's `givens` when the grid seeds any (each a
`{ reference[atomIndex], cells[formulaIndex][cellIndex] }` of pinned values,
`""` = free), against which the row is graded (partial) or which prepopulate the
matched rows' cells (simple/validity). There is **no secret key** — the answer is
computed from the public formulas (and the student's own chosen valuation, for
partial) — which is what makes client-side Check legitimate.

## Roadmap

Shipped past v1: counterexample submission (the single-row shortcut), the
**Validity** variant (`:|-:` turnstile arguments with a graded turnstile column),
the **Partial** variant (single free row, consistency grading), the unified
**given grid** (positional cell seeding across all variants, sparse rows,
wildcards, `immutable` locking, key-integrity checks), and display polish
(`trueMark`/`falseMark`, `double-turnstile` / `negated-double-turnstile`).

Still deferred: pluggable `system=` notations, `turnstilemark`, and seeding a
validity turnstile-column cell (the grid seeds `reference | formulas` only).
