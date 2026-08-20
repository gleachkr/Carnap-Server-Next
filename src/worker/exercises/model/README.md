# Model exercise (`model@1`)

A finite-model exercise in the tradition of the original Carnap's
`CounterModeler`. The student describes a **model** — a domain, and an extension
or a value for every symbol the sentences use — and the exercise says whether
that model has the property it asked for. A local **Check** grades it in the
browser; **Submit** records the server's grade. The two agree by construction:
a model exercise has no answer key, so both sides run the same `checkModel`.

Three variants ship: **simple** (a model in which the sentences come out true),
**validity** (a counterexample to an argument written with `:|-:`), and
**constraint** (`constraints : sentences`, where the constraints must hold too).

Notation is **forallx: Calgary, 2019 and later**. Other systems plug in as
entries in the shared syntax core's [`../first-order/dialect.ts`](../first-order/dialect.ts);
only this one ships.

## Authoring syntax

Attributes go in **braces**; `#id` sets the id. Sentences are markdown **list
items**, and any prose before the first one is the prompt. A single bullet may
hold several comma-separated sentences.

```
::::model{#two_at_once title="Two at once" points="3"}
Build a model in which both of these come out true.

- ExF(x), Ex~F(x)
::::
```

### Attributes

| Attribute | Values / form | Default | Meaning |
|---|---|---|---|
| `#id` / `id` | identifier (`[A-Za-z][\w-]{0,63}`) | — (**required**) | Stable exercise id; unique within the document. |
| `variant` | `simple` \| `validity` \| `constraint` | `simple` | See below. |
| `system` | a dialect id | `forallx-calgary-2019` | The notation the sentences are written in. |
| `counterexample-to` | `validity`/`tautology` \| `equivalence` \| `inconsistency`/`contradiction` | per variant | The property the model must give the sentences (see below). |
| `check` | `on` \| `off` | `on` | Whether the local Check button is offered. This type's older spelling of `feedback` (`on` is `full`, `off` is `none`); writing both earns a `redundant_check_attribute` diagnostic and `feedback` wins. |
| `points` | number `0 < n ≤ 1000` | `1` | Nominal points. |
| `title` | string | — | Optional title. |
| `exam` | `true` \| `false` | the assignment's: `true` while its grades are withheld, `false` once released | `true` records every submission; `false` records only correct autograded work. Leaving it out is a third value, not `false`. |
| `feedback` | `full` \| `terse` \| `none` | the assignment's: `none` while its grades are withheld, `full` once released | How much the student is told: `terse` drops the detail, `none` drops the verdict too. The score is separate — it waits for the release date whatever this says. See `docs/carnap-markdown-v1.md`. |
| `options` | space-separated flags | — | Carnap-style flags (see below). |

### The three variants

**`simple`** takes a list of sentences and asks for a model in which they all
come out **true**.

**`validity`** takes one sequent line — comma-separated premises, `:|-:`,
comma-separated conclusions. The premises must come out **true** and the
conclusions must have the target property, whose default here is **false**: a
counterexample to validity.

```
::::model{#someone variant="validity" points="4"}
Everyone likes someone; so there is someone everyone likes. Show that this does
not follow.

AxEyR(x,y) :|-: ExAyR(y,x)
::::
```

**`constraint`** takes one `- constraints : sentences` **list item**. The
constraints must come out true as well as the sentences having the target
property. Use it to rule out the model that satisfies a universal sentence by
having a domain of one:

```
::::model{#not_free variant="constraint"}
Make this true — and no cheating with a one-element domain.

- ExEy~x = y : AxAyF(x,y)
::::
```

The separator is a list item rather than the original's bare `:` line, because a
prompt ending "Find a model where:" would otherwise be read as the constraints.
A constraint exercise's constraints are **not shown to the student** — the manual
calls them implicit — so the prompt has to say what they are if the student
should know.

### `counterexample-to` — what the model must show

Over the targeted sentences (all of them for `simple` and `constraint`, the
conclusions for `validity`):

| Value | The model must make the sentences |
|---|---|
| `validity`, `tautology` | all false |
| `inconsistency`, `contradiction` | all true |
| `equivalence` | disagree — at least one true and at least one false |

Omitted, the default is **all true** for `simple` and `constraint` and **all
false** for `validity`, which is what the original does. The attribute is
compiled away: the stored exercise carries the property itself, not the
vocabulary.

### Options

Bare flags in an `options` string:

| Flag | Effect |
|---|---|
| `nocheck` | Same as `check="off"`. |
| `strictGivens` | Locks every given, turning a hint into a requirement. |
| `double-turnstile` | Show `⊨` in a validity exercise's prompt. |
| `negated-double-turnstile` | Show `⊭`. |
| `forallxStyle` | Recognised so a ported problem compiles; **not implemented**. It would relabel the fields `UD = `, `extension(F) = `, `referent(a) = `, `truth-value(P) = `. |

### Givens

A trailing `| Field : value` line seeds a field. Field names are the labels the
exercise shows — `Domain`, `F(_,_)`, `a`, `f(_)` — and the values are written in
the same little languages the student types (below).

```
::::model{#seeded}
- AxF(x), G(a)
| Domain : 0,1,2
| F(_) : 1,2
| a : 1
::::
```

A given naming a field the exercise does not have, holding something that field
could not contain, or repeating a field, is a **compile error**. The original
notices none of these until a student submits, and then only in the browser
console.

Ordinarily a given is a hint the student may change. `strictGivens` locks it:
the field renders inert, and grading substitutes the given for whatever arrives,
so an answer that got around the lock is graded against the exercise as set. (The
original calls `Prelude.error` there, which takes the widget down.)

A **function's given is read row by row**: `f(_) : [0;1]` says `f(0) = 1` and
nothing about the other arguments. Those rows are what the generated value table
starts from, and under `strictGivens` they are the cells that lock — the rest of
the table stays the student's, and grading puts the given's rows back over the
submitted ones rather than replacing the whole extension.

This is the one place the givens diverge from the original, and the value table
forces it. There a function is a text field the student types in full, so
`setField` can drop the given in whole and `strictGivens` can mark the field
`readonly`; a partial given is then a half-written string to finish, and a
partial *locked* given is an exercise nobody can answer — the field can only say
`[0;1]`, and `validateFunc` refuses it with `does not have a value specified for
some input`. Locking whole cells rather than whole fields keeps the same
promise (the given is a requirement) without the dead end. Nor could the author
avoid it: unless the domain is given *and* locked, the student decides how many
rows the table has, so no given can be sure of covering it.

## Notation: forallx: Calgary 2019

Carnap's `thomasBolducAndZachFOL2019ParserOptions` over `calgary2019OpTable`.

- **Predicates** any uppercase letter with parentheses and an optional `_n`
  subscript: `F(x)`, `R(x,y)`, `F_1(a)`. A bare uppercase letter is a
  **sentence letter**. A symbol's **arity is part of its identity**, so `F(a)`
  and `F(a,b)` are two different predicates with two separate fields.
- **Variables** `s`–`z`; **constants** `a`–`r`; **function symbols** `a`–`t`,
  always with parentheses. A lowercase letter followed by `(` is a function,
  otherwise a variable if in `s`–`z` and a constant if in `a`–`r`.
- **Quantifiers** `A` `E` `∀` `∃` `@` `3`, immediately followed by a variable.
- **Connectives** `~ /\ \/ -> <->`, plus the aliases `- ¬`, `∧ ^ &`, `∨ |`,
  `=> > → ⊃`, `<=> <> ↔ ≡`.
- **Identity** `=`; **inequality** `!=` or `≠`, which is sugar for `~(t = t')`.
- **Boolean constants** `⊥` / `_|_` / `!?` and `⊤`.

### Input, and display

Those are the spellings a formula is **typed** in. A formula is **shown** in
logical symbols, which is what the original does (`rewriteWith opts . show`):
`∀ ∃ ¬ ∧ ∨ → ↔ ⊤ ⊥`, identity closed up, a quantifier or negation written
straight onto what follows it, and every binary compound parenthesized *except*
the outermost pair — Carnap's fixed `Schematizable` output under the 2019 Calgary
systems' `dropOuterParens` rewriter.

| Stored as | Shown as |
|---|---|
| `AxAyf(x,y) = f(y,x)` | `∀x∀yf(x,y)=f(y,x)` |
| `P /\ Q \/ R` | `(P ∧ Q) ∨ R` |
| `Ax(F(x) -> G(x))` | `∀x(F(x) → G(x))` |
| `a != b` | `¬a=b` |

The display form is itself legal input, which is not a coincidence: forallx
brackets exactly the compounds its parenthesization rule permits brackets
around, so printing and reading agree.

Three things surprise people, and all three are the original's behaviour:

1. **A quantifier's scope is the sentence immediately after it**, not the rest
   of the formula. `AxF(x) -> G(a)` is a conditional with a quantified
   antecedent; write `Ax(F(x) -> G(a))` for the other reading. Negation scopes
   the same way.
2. **`/\` and `\/` share one precedence level**, left-associatively, so
   `P \/ Q /\ R` is `(P \/ Q) /\ R` — neither binds tighter. `->` and `<->`
   share the looser level and **refuse to chain**: `P -> Q -> R` is an error.
   (This differs from the propositional `prop` notation the truth tables use,
   where `/\` does bind tighter. The two are separate parsers.)
3. **Parentheses may only wrap a two-place compound.** `(P)`, `(~P)`, `(AxF(x))`
   and `(a = b)` are all errors — forallx's own parenthesization convention,
   which Carnap enforces with its `zachDispatch` guard.

**Open formulas are rejected**: every sentence must be closed. That is why the
original's "a formula with free variables is its universal closure" rule does not
appear here — under this dialect it can never fire. It arrives with the first
dialect that permits free variables.

### Deliberately not accepted

- **The English word operators** `not`, `and`, `or`, `only if`, `if and only if`.
  They collide with the constant and function letters `a`–`t`, and telling
  `Fa nd G(b)` from a conjunction is real tokenizer work for very little.
- **`^n` arity annotations**, which the original parses and discards.
- **`v` for disjunction** — also absent from Carnap's Calgary tables, since `v`
  is a variable letter here.

Porting a problem from the manual therefore needs two edits: `not` becomes `~`,
and parentheses around an identity or a negation come off (`AxAy(f(x,y) =
f(y,x))` → `AxAyf(x,y) = f(y,x)`).

## The fields, and what goes in them

The field list is **derived from the sentences** and is not authored or stored:
`AxR(x,f(x))` asks for a domain, an extension for `R(_,_)` and a value table for
`f(_)`, and nothing else. Fields appear in the original's order — domain, then
relations, then sentence letters, then constants, then functions — each group in
label order.

| Field | Control | Value |
|---|---|---|
| `Domain` | text | `0,1,2` — one or more naturals, at most `MAX_DOMAIN_SIZE` (16) |
| `F(_,_)` | text | `[0,0],[1,0]` — tuples in `[…]`, `(…)` or `<…>`; a 1-tuple may be bare (`0,1`); empty field = empty extension |
| `P` | True/False | — |
| `a` | menu of the domain | one element |
| `f(_,_)` | a value table | a menu of the domain per argument tuple, laid out as a grid |

Every element mentioned must be in the domain. Duplicate domain elements are
collapsed (`0,0,1` is the domain {0,1}).

**Functions get a generated value table** rather than the original's single text
field: a menu of the domain for every argument tuple over the current domain.
Totality is then structural, so the original's `does not have a value specified
for some input` message is unreachable from the widget — only a submission that
did not come from it can be partial — and a binary function over a three-element
domain no longer means typing nine tuples by hand. The table is an **editor over
the same string the original stores** (`[0,0;1],[0,1;2]`), so givens and the
recorded answer are unchanged by it.

The layout is the one a function is written in on a blackboard: **the last
argument heads the columns, the rest name the rows.** A binary function over
`0,1,2` is then a 3×3 square, a unary one a single line of values under its
arguments (with no header column at all — its one line fixes nothing, and a
blank label beside a blank corner reads as something withheld), and no cell
repeats the function symbol — `f(1,2)` is read off the row
`1,_` and the column `2`, with the symbol itself appearing once, in the field's
label. Higher arities keep the columns bounded by the domain and grow downwards
(`0,0,_`, `0,1,_`, …) rather than sideways. Reading the rows in order, and each
row left to right, is exactly the odometer order the field's string is written
in, which is what lets the table be serialized straight down the DOM; the shape
comes from `functionTableLayout`, shared by the server's markup and the client's
rebuild so the two cannot drift. Every menu still carries the whole argument as
its accessible name (`f(_,_) of 1,2`), because the two axes are only on the page
for a reader who can see them.

The table is also why a function's given is read cell by cell where the original
reads the field whole (below): the original's field starts *empty* and the
student types the whole extension, so a partial given there is a half-written
string to finish. Here every cell already has a value, so a given can only mean
the cells it names.

The domain drives the constant menus and the function tables, so both are rebuilt
whenever it changes, keeping any value still in range.

## The recorded answer

`model-answer@1` is the raw text of each field, keyed by label:

```json
{ "domain": "0,1", "fields": { "F(_)": "0,1", "a": "0" } }
```

Raw rather than parsed, as the original records it, so the review page can show
what the student actually typed — an instructor reading a wrong answer wants to
see the wrong thing. Fields the exercise does not ask for are dropped in
normalization.

Scoring is all-or-nothing: there is no fraction of a countermodel.

## Roadmap

- **More dialects.** `../first-order/dialect.ts` is a table; the pre-2019 forallx
  (juxtaposed `Fx`, no function symbols) and Carnap's default `firstOrder` are
  the obvious next entries. A dialect that permits open formulas additionally
  needs the universal-closure step in the evaluator.
- **Generated grids for relations.** A checkbox list (arity 1) or a matrix
  (arity 2) would be the win the function table is — the same
  `functionTableLayout` shape with checkboxes for cells — but it diverges from
  the givens syntax, so the text field stays for now.
- **`forallxStyle`**, the original's undocumented relabelling.
- **Non-numeric domains.** Elements are naturals, as in the original.
