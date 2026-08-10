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
default, spelled by the `sequent=` attribute otherwise) and a
comma-separated **ACUI** context (associative, commutative, unit `_`, idempotent),
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
:::aufbau-proof-fitch{theory="prop" id="mp"}
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
Attributes match `aufbau-proof` (`theory`, `id`, `title`, `points`, `exam`,
`feedback`,
`options`) plus an optional **`assumption`** naming the theory's assumption axiom
(default `ax`) and an optional **`sequent`** naming its turnstile notation
(default `⊢`) — the symbol the translator writes into every emitted sequent, so
an ASCII theory authors with `sequent="|-"`. The student's Fitch source never
spells the turnstile, so nothing about the input surface changes with it.
Each proof line is `<formula> :<rule> <refs>`; the justification
is taken after the line's *last* colon, so formulas whose notation uses `:` (e.g.
a modal `w : a`) still parse.

### The assumption rule is configured, not hardcoded

`ax` is only the **default**. The assumption-axiom name is read from the
`assumption=` attribute at authoring time ([`authoring.ts`](./authoring.ts),
falling back to `DEFAULT_ASSUMPTION_RULE = "ax"` in [`types.ts`](./types.ts)) and
frozen into `publicData.assumptionRule`. That one configured name drives every
place the type needs to know "which lines introduce a context formula":

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
author with `assumption="hyp"` and the sibling-box seams follow the same rule the
compiler does. What is *not* configurable is that there is exactly **one**
assumption axiom per exercise; a theory with several distinct assumption-introducing
rules would need the translator to accept a set.

## Files

- [`types.ts`](./types.ts) — public/answer shapes (adds `assumptionRule`,
  `sequentSymbol`, `starterBody`), guards.
- [`translate.ts`](./translate.ts) — `fitchToAuf` (the crux) + `fitchLineDepths`
  / `fitchScopeGeometry` (scope-line geometry, sharing one walk with `fitchToAuf`),
  all pure.
- [`authoring.ts`](./authoring.ts) — `compileAufbauProofFitch` (reuses the linear
  type's theory resolution + goal-header parsing; parses `assumption=` and
  `sequent=`).
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
