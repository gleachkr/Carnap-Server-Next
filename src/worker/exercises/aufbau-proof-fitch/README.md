# Aufbau Fitch-proof exercise (`aufbau-proof-fitch@1`)

A third input modality for the engine-checked Aufbau proof: the student writes a
proof in the classic **Fitch** shape from textbooks like *forallx* — a linear
list of formulas where **indentation marks subproofs**, edited in CodeMirror with
the subproof scope-lines drawn in. Everything downstream of the input is shared
with [`aufbau-proof`](../aufbau-proof/README.md) — the same `@aufbau/compiler`,
the same MMB certificate as the trust boundary, the same worker-side
[`verifyMmb`](../aufbau-proof/verifier.ts) against a frozen theory. The compiler
is the untrusted convenience; the verifier is the arbiter.

## The idea: translate indentation into sequent contexts

The target theories are sequent/ND systems with a turnstile judgement (`⊢` by
default) and a separated **ACUI** context (associative, commutative, unit `_`,
idempotent) whose separator is `,` by default,
where `ax` proves `g , a ⊢ a` (built-in weakening) and discharge rules like
`imp_intro` strip an assumption. [`translate.ts`](./translate.ts) (`fitchToAuf`)
turns the Fitch text into the exact linear `.auf` the other proof types produce —
each line becomes a full sequent `lk: $ Γ ⊢ φ $ by rule [refs]`:

- Every non-blank line is one proof step; step `k` → label `lk`, and a ref `n`
  becomes `ln`, a range `a-b` becomes `lb`.
- Indentation is an **indentation stack**: a deeper indent opens a subproof, a
  shallower one closes back to a matching level.
- Every line's **context** `Γ` is its **ambient** scope path: the assumptions
  of every scope still open at that line. In a linear Fitch proof that is
  exactly the textbook accessibility set — a closed sibling box is off the
  path, so nothing from it can leak (the cross-branch import that pushed the
  [Prawitz tree type](../aufbau-proof-prawitz/README.md) to *dependency*
  contexts cannot arise here, and an eigenvariable proviso judged against the
  ambient context is precisely forallx's "not free in any undischarged
  assumption in scope"). **Discharge falls out for free** — a rule written
  below a now-closed subproof no longer has that scope on its path, and the
  engine's own rule verifies the stripped sequent. The translator never
  reasons about the logic; it knows only the assumption-axiom name, the
  scopes, and the citations.
- Ambient contexts presume the house theory convention: every rule joins a
  **slack** context variable into its conclusion (implicit weakening, the
  shape `ax`'s `g , a ⊢ a` and `reit` already have). A nested line citing a
  shallower line states its conclusion in a context *larger* than the join of
  the cited ones, and the slack absorbs the difference. This is also what
  makes vacuous discharge work the textbook way — assume `b`, reiterate `a`
  past it (the reiterated line's ambient carries `b`), discharge.
- Citations are checked for **accessibility**: a plain ref must lie on the
  citing line's open scope path, and a cited subproof must hang off a scope on
  that path; a violation is the `inaccessible_reference` diagnostic. The
  engine would reject almost every violation anyway (the cited sequent's
  context no longer fits the citing line's), but as an opaque unification
  error — and the one violation it *cannot* reject (citing into a closed box
  from a new box that re-assumes the same formula, which is sound) still
  breaks the Fitch discipline, so the translator names it. Scope ids are
  never reused, so re-assuming a formula does not reopen the old box. Like
  every structural check, this lives in the editor, not the trust boundary:
  the worker grades only the MMB certificate.

**Sibling subproofs.** Rules that discharge *two* subproofs — ∨-elimination and
↔-introduction — need two boxes at the same indentation, each with its own
assumption. Since a scope only opens on a *deeper* indent, the translator also
splits on assumptions: inside a subproof that has already derived a line, a fresh
assumption at the same level begins a **new** box. Top-level premises still share
one context, and a run of assumptions before any derivation still stays one box
(reiteration into a box), so single-subproof proofs are unaffected.

**First-order theories work unchanged.** Because the translator is theory-agnostic
— it only copies formulas through and emits `Γ ⊢ φ by rule [refs]` — it handles
quantified and identity theories (e.g. the *forallx: Calgary* first-order fragment
in `tests/helpers/forallx-theory.ts`) with no quantifier-specific code. Universal
and existential *elimination/introduction* are ordinary cited rules; **∃-elimination
is structurally a one-branch ∨-elimination** (cite the `∃` line and a subproof
range, and the witness assumption discharges by the same scope-closure). The
**eigenvariable side conditions** live entirely in the engine: an MM0 quantifier is
a binder, and freshness *is* the rule's raw binder dependency type (a `g: ctx` that
may not depend on the bound variable), re-checked by the verifier against the MMB.
The compiler's elaboration annotations (`@view`/`@recover`/`@freshen`/`@fallback`)
infer the witness/eigenvariable from the concrete before/after sequents, so the
student never annotates them and the translator never reasons about them.

The translator also returns a source-line map (`lineSpans`) so a compiler
diagnostic on a generated `.auf` line is attributed back to the Fitch line that
produced it. [`fitchLineDepths`](./translate.ts) gives the client each line's
subproof depth, and [`fitchScopeGeometry`](./translate.ts) gives, per line, the
indentation *columns* where each enclosing subproof's scope-line sits (so the
client draws the bars inside the whitespace the student typed) together with an
`openFrom` index marking the first bar that line freshly opens. `fitchScopeGeometry`
shares the one scope walk with `fitchToAuf`, so the drawn boxes can never disagree
with the sequent contexts the compiler checks — in particular a sibling box
reopens its innermost bar, which the client draws with a **seam** so the two
subproofs of ∨E / ↔I read apart rather than as one continuous bar.

## The trust boundary (identical to the linear type)

- The instructor authors an **`aufbau-mm0`** theory and, in each
  **`aufbau-proof-fitch`**, a goal `theorem <name>: $ Γ ⊢ φ $`. The compiler
  **freezes** the theory plus the goal declaration into `publicData.mm0`.
- The **client**
  ([`carnap-aufbau-proof-fitch-v1.ts`](../../../client/components/carnap-aufbau-proof-fitch-v1.ts))
  holds the Fitch text in CodeMirror, translates + compiles on each edit, draws
  the scope-lines, and writes `{ mmb, proofText, fitchText }` into `answerData`.
- The **worker** ([`assessment.ts`](./assessment.ts)) decodes the MMB and verifies
  it against the *frozen* mm0 — never the student's Fitch text or the translated
  proof. `ok` ⇔ the declared goal is proved.

## Authoring syntax

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

Prose is the prompt; a `theorem <name>: $ Γ ⊢ φ $` line states the goal, a `----`
underline separates it, then the starter Fitch proof (which may be empty).

**A declaration is how a goal is stored, not how it is asked.** The widget's
"Prove" row and the review's `Goal` line show the *statement* — `Γ ⊢ φ` alone,
by way of `goalStatementText` — with the theorem's name, its binders and its
`$ … $` taken off, which is what the tree and Prawitz editors have always
shown. The name is the engine's handle on the goal and is free to differ from
the exercise's `id`; a `{x: var}` binder exists to make `∀ x` legal and says
nothing to a student. This holds over a theory that names no sentence sort too:
that role decides whether the *formula* can be read as surface text, while
splitting a declaration off its statement is MM0's own grammar and needs no
lexicon. The declaration is shown only if no such goal is declared at all.
Attributes match `aufbau-proof` (`system`, `id`, `title`, `points`, `exam`,
`feedback`,
`options`), and nothing notational: the theory says which axiom opens a
hypothesis (`@syntax role assumption`), how it spells a turnstile (`role
turnstile`) and the separator between a context's formulas (`role
context-join`). The translator writes the two symbols into every emitted
sequent; the student's Fitch source never spells either. All three are read
at authoring time (`requireProofNotations` in `../aufbau-proof/authoring.ts`)
and a theory missing one does not compile a Fitch exercise, with a diagnostic
per missing role. `logic/theories/forallx-calgary-2019.mm0` needs the context
separator `;` (its comma is the student's argument separator, since that file
is also the course's language) and says so once, in the file.

`logic/theories/forallx-magnus.mm0` — the original *forallx*, the other Fitch
textbook shipped here — is the same in that respect and differs in one that
shows up at this layer: its `¬I` and `¬E` are reductios onto an explicit
contradictory pair rather than onto `⊥`, which the language does not have, so
each takes **two** premises drawn from one subproof. The citation is the
book's own — one range, whose subproof *ends* with the contradictory pair:
`neg_intro 2-5`, supplying lines 4 and 5. What makes a lone range able to
deliver two premises is not translator knowledge of the rule but the
**citation-shape table** [`citations.ts`](./citations.ts) derives from the
rule signatures themselves: premises that assume the same formula form one
cited subproof, a premise that assumes nothing is a plain line — the
`indirectInference` table of Carnap's Haskell, inferred rather than declared.
The explicit spelling, one ref per premise naming the subproof twice
(`neg_intro 2-4 2-5`), lowers to the same `.auf` and stays legal; the two are
told apart by ref count, which can only coincide when they agree. One
strictness the derived shape carries that Carnap's checker did not: the pair
must be the subproof's *last two lines* in the rule's own order (`ψ`, then
`¬ψ` — the book's schema). Carnap tried premise permutations; a
permutation-tolerant lowering is a separate feature, deliberately not built.

Each proof line is `<formula> :<rule> <refs>`; the justification
is taken after the line's *last* colon, so formulas whose notation uses `:` (e.g.
a modal `w : a`) still parse. The rule is either an axiom name or an alias the
theory declares for one (`--| @syntax alias ∧I` on `and_intro`); the walk
resolves it through a `readRule` ([`proofRuleReader`](../aufbau-proof/formulas.ts))
as the line is parsed, so the assumption test, the citation-shape lookup and the
emitted `by` all see the axiom name, and a name the theory never mentions
reaches the engine as typed, to be refused there.

### The assumption rule is the theory's, not hardcoded

The assumption-axiom name is the rule carrying `@syntax role assumption` in the
theory, read at authoring time ([`authoring.ts`](./authoring.ts)) and frozen
into `publicData.assumptionRule`; `DEFAULT_ASSUMPTION_RULE = "ax"` in
[`types.ts`](./types.ts) only serves artifacts frozen before the theory said so.
That one name drives every place the type needs to know "which lines introduce
a context formula":

- the translator ([`fitchToAuf`](./translate.ts)) — an assumption line carries the
  ambient context and can begin a sibling box;
- the scope-bar geometry ([`fitchScopeGeometry`](./translate.ts)) — only an
  assumption after a derived line splits a box (draws the seam);
- the client editor, which hands the value to both. It flows to the scope-bar
  `ViewPlugin` through an `assumptionRuleFacet` (an [`EditorState`] facet), because
  the plugin is module-level and has no other route to the element's config; the
  facet's own `"ax"` fallback only matters if the element somehow attaches the
  plugin without providing the facet.

So a theory whose assumption axiom is, say, `assume` or `hyp` works unchanged —
put the role on it and the sibling-box seams follow the same rule the compiler
does. The role names the axiom itself, and a cited name goes through `readRule`
to the same identifier, so a line citing an alias and one citing the axiom's own
name agree. The review page's read-only widget has no theory text at hand, so
the server lists the rule's spellings on the element (`data-assumption-spellings`)
and the geometry there resolves against that list. What is *not* configurable is
that there is exactly **one** assumption axiom per exercise; a theory with several
distinct assumption-introducing rules would need the translator to accept a set.

## Formulas are read in the theory's language

Where the theory names the sort a line is read at — `@syntax role sentence`,
as `forallx-calgary-2019` does — each line's formula is parsed against that spec and re-printed
in engine notation before it reaches the compiler. `Ax(F(x) -> G(x))   :ax` goes in;
`l1: $ … ⊢ (∀ x ((F (x)) → (G (x)))) $ by ax []` comes out. The compiler's math parser wants every token
whitespace-separated and every compound operand parenthesized; the book wants
neither, and this is the layer where the two stop disagreeing (see
[`../aufbau-proof/formulas.ts`](../aufbau-proof/formulas.ts)).

It buys two things beyond notation. A formula that will not read is reported
in the editor's lint gutter, at the character that broke it, instead of arriving as an engine
unification failure. And the spec's lints start applying to proofs: forallx
admits parentheses only around a two-place connective, so `∀ x (x = x)` is now
refused and must be written `∀ x x = x`.

**One condition: the theory must name the sort a line is read at** — the one
carrying `@syntax role sentence`. `gentzen-lk` names none and reads as it
always did. That is not a claim that such a file is no language: it parses,
and the language built from it reads its own notations quite happily. It
simply never says which sort a student's line is in, and nothing here will
guess one. A pre-#250 artifact, frozen with the stripped `mm0` and no `source`
at all, has no text to ask and reads as engine text for that reason instead.

A goal stated as a rule schema is read in **its own binders**. `theorem mp
(a b: wff): $ (a → b) ; a ⊢ b $` is about *any* sentences, and its `a` is not
the theory's own `a`; the parser is given the goal's binder list, so it reads
the metavariable rather than the lexicon's name. Before #253 there was no way
to say that, and such exercises had to keep engine text.

The starter is read the same way at compile time, so an author hears about an
unreadable line while saving rather than a student meeting an editor that will
not accept what it opened with.

So is the goal: every `$ … $` in the `theorem` line is read through the
language and re-printed in engine text (`goalEngineDeclaration` in
`../aufbau-proof/formulas.ts`), frozen as `goalEngineDecl` beside the
declaration as written. The join puts the engine form in `mm0` and the written
one in `source`, so the engine parses `∃x F(x)` and a bare `P` (which it
otherwise wants as `P snil`) while the student sees what the author typed. A
goal the language refuses is an `invalid_goal_formula` diagnostic.

## Files

- [`types.ts`](./types.ts) — public/answer shapes (adds `assumptionRule`,
  `sequentSymbol`, `starterBody`), guards.
- [`translate.ts`](./translate.ts) — `fitchToAuf` (the crux) + `fitchLineDepths`
  / `fitchScopeGeometry` (scope-line geometry, sharing one walk with `fitchToAuf`),
  all pure.
- [`authoring.ts`](./authoring.ts) — `compileAufbauProofFitch` (reuses the linear
  type's theory resolution + goal-header parsing, and its role check for the
  assumption axiom and sequent notation).
- [`assessment.ts`](./assessment.ts) — normalize/evaluate/review; reuses
  `verifyMmb`.
- [`read-only-view.ts`](./read-only-view.ts) — SSR element chrome + the read-only
  review (the submitted Fitch source).

## Accepted limitations (v1)

- Targets sequent/ND theories with a turnstile + ACUI comma-context and a named
  assumption axiom; a theory without those won't fit the Fitch modality (use the
  linear or tree type).
- Over-declared premises must be *asserted*, not just declared. A goal like
  `a , b ⊢ a` whose proof doesn't need every premise still verifies as long as
  each premise it names appears as a top-level assumption line (`a :ax`,
  `b :ax`), in any order: every line carries the whole ambient top-level
  context, and scope 0 never closes, so every top-level premise — the unused
  ones included — rides down to the conclusion, where the ACUI context matches
  the goal. A premise the goal declares but the proof never asserts won't be
  in the conclusion's context, so the goal won't match.
- Scope-lines are presentational; structural checks aside, the compiler is the
  arbiter of logical validity. They are drawn from the same walk that assigns the
  contexts, so two *sibling* subproofs at the same level (∨E, ↔I) draw as separate
  boxes — the second reopens its bar with a seam above it.
- Two sibling subproofs are told apart by "a fresh assumption after a derived
  line starts a new box", so a degenerate subproof that is a lone assumption with
  no derivation (e.g. proving `a ∨ a ⊢ a`, where each ∨E branch is just `a`)
  won't split — add a reiteration line, or use the linear/tree type.
- `auto?`/`complete` flags are carried but inert, as in the linear type.
