# Aufbau Prawitz-proof exercise (`aufbau-proof-prawitz@1`)

A fourth input modality for the engine-checked Aufbau proof: the student builds
a **Prawitz-style natural-deduction tree** — bare formulas at the nodes,
labeled assumptions at the leaves (`[A]¹`), discharge marks on inferences. It
combines the [`aufbau-proof-tree`](../aufbau-proof-tree/README.md) input
surface (nodes, premises, postorder flatten) with the
[`aufbau-proof-fitch`](../aufbau-proof-fitch/README.md) idea that sequent
contexts are *inferred* from structure, not written by the student. Everything
downstream is shared: the same `@aufbau/compiler`, the same MMB certificate as
the trust boundary, the same worker-side
[`verifyMmb`](../aufbau-proof/verifier.ts) against a frozen theory. It targets
the same sequent/ND theories as the Fitch type (`⊢`, ACUI comma-context, an
assumption axiom named by `assumption=`).

## The idea: labels induce boxes, boxes become contexts

Where Fitch's indentation boxes *induce* discharge, here the discharge labels
induce the boxes. [`translate.ts`](./translate.ts) (`prawitzToAuf`) is
theory-agnostic — it knows only the assumption axiom's name:

- An assumption leaf labeled `n` is discharged at its nearest ancestor whose
  `discharge` list contains `n`; its **box** is the subtree of the child of
  that ancestor through which the leaf is reached. An unlabeled leaf is a
  standing premise, in scope everywhere.
- Every node's context is its textbook **dependency set** — the undischarged
  assumptions above it, nothing else. A leaf seeds with just itself (`a ⊢ a`,
  the theory's `ax` weakening `g , a ⊢ a` with `g` empty), and a derived
  node's context is the union of its premise contexts filtered to assumptions
  whose box contains the node — discharge falls out of the box filter.
  Nothing from a sibling branch ever enters a context; that is load-bearing
  for eigenvariable rules (∀I, ∃E), whose side condition "the context may not
  mention the eigenvariable" would otherwise be spuriously tripped by an
  unrelated branch's formula (the `eigenpollute` worked case pins this).
- Dependency contexts presume **multiplicative** rules — one context variable
  per premise, joined in the conclusion (`g ⊢ a → b` + `h ⊢ a` → `g , h ⊢ b`),
  as all of forallx's are. An additive rule (one shared `g` across premises)
  would demand ACUI-equal sibling contexts, which dependency contexts don't
  provide; state such rules multiplicatively instead (ACUI idempotence makes
  that strictly more permissive). The house theories also join a **slack**
  context variable into every conclusion (implicit weakening, for the Fitch
  type's ambient contexts — see the
  [Fitch README](../aufbau-proof-fitch/README.md)); dependency emission simply
  binds it empty, so the same theory serves both modalities.
- Entries are tracked **per leaf**, not per formula, so a second
  same-formula assumption under a different label survives its sibling's
  discharge.

A postorder walk emits `lN: $ Γ ⊢ φ $ by rule [refs]` per node (every leaf
emits an `ax` line; ND premises live in the goal sequent's context, so there is
no analogue of the tree type's line-less `#n` leaves), plus a char-space map
from each generated line back to its node for diagnostic attribution, and the
inferred per-node contexts for the editor to surface. Eigenvariable side
conditions (∀I, ∃E) ride entirely on the engine, exactly as in the Fitch type.

## Authoring syntax

```md
:::aufbau-proof-prawitz{theory="forallx" id="p1"}
Finish the discharge.

theorem self (a: wff): $ _ ⊢ a → a $
----
a1: $ a ⊢ a $ by ax [] -- label:1
c1: $ _ ⊢ a → a $ by imp_intro [a1] -- label:1
:::
```

Prose is the prompt; a single `theorem <name>: $ … $` line states the goal; an
optional `----` underline introduces a **starter** the editor seeds from
([`parse.ts`](./parse.ts), `parsePrawitzStarter`). Starter lines are the tree
type's linear form with two Prawitz twists: each line is a **full sequent**
(a valid `.auf` proof is a valid starter — the context left of the exercise's
sequent symbol is discarded on parse, since the labels re-derive it), and
discharge labels ride as trailing `-- label:n` comments — on an assumption
line the leaf's label, on a rule line the discharged marks (position
disambiguates, since a node carries only one of the two fields; the engine's
grammar accepts trailing comments, so annotated lines compile as written).
The starter is parsed structurally and its discharge structure is checked by
the translator at compile time; it need not prove anything.

Attributes match the siblings: `theory` (required, a declared `aufbau-mm0` name
earlier in the document), `id`, `title`, `points`, `exam`, `feedback`,
`options`,
`assumption=` naming the theory's assumption axiom (`ax` by default),
`sequent=` naming its turnstile notation (`⊢` by default; emitted in every
translated sequent and stripped from pasted starter lines), and `context=`
naming the separator between a context's formulas (`,` by default). The last
two are read off the theory itself where it declares them (`@syntax role
turnstile`, `@syntax role context-join`), so they are an override rather than
something to write on every exercise.

## Formulas are read in the theory's language

Where the theory is also a *language* — it declares `@syntax role sentence`, as
`forallx-calgary-2019` does — each node's formula is parsed against that spec and re-printed
in engine notation before it reaches the compiler. `~AxF(x)` goes in;
`(¬ (∀ x (F (x))))` comes out. The compiler's math parser wants every token
whitespace-separated and every compound operand parenthesized; the book wants
neither, and this is the layer where the two stop disagreeing (see
[`../aufbau-proof/formulas.ts`](../aufbau-proof/formulas.ts)).

It buys two things beyond notation. A formula that will not read is reported
against the node that carries it, at the character that broke it, instead of arriving as an engine
unification failure. And the spec's lints start applying to proofs: forallx
admits parentheses only around a two-place connective, so `∀ x (x = x)` is now
refused and must be written `∀ x x = x`.

**One condition: the theory must be a language** (`gentzen-lk` is not, and
reads as it always did). It is carried by *which theory text `publicData`
holds*: `source` (the artifact `@syntax` and all) means read it, `mm0` (already
stripped) means do not.

A goal stated as a rule schema is read in **its own binders**. `theorem mp
(a b: wff): $ (a → b) ; a ⊢ b $` is about *any* sentences, and its `a` is not
the theory's own `a`; the parser is given the goal's binder list, so it reads
the metavariable rather than the lexicon's name. Before #253 there was no way
to say that, and such exercises had to keep engine text.

The starter is read the same way at compile time, so an author hears about an
unreadable line while saving rather than a student meeting an editor that will
not accept what it opened with.

It also makes discharge matching notation-insensitive: the translator decides
which assumption leaves a mark answers to by comparing their formulas as
strings, and it now compares the *read* ones, so `~P` under a mark and `¬P`
under the same mark are one assumption rather than a
`discharge_formula_mismatch`.

## Files

- [`types.ts`](./types.ts) — `PrawitzProofNode`, public/answer shapes, guards.
- [`translate.ts`](./translate.ts) — `prawitzToAuf`: labels → boxes →
  dependency contexts → `.auf`, plus line spans, per-node contexts, and
  structural diagnostics (pure).
- [`parse.ts`](./parse.ts) — `parsePrawitzStarter` (starter lines → tree; the
  structural work is the tree type's `parseProofTree`) and its inverse
  `serializePrawitzStarter`, which tests round-trip.
- [`authoring.ts`](./authoring.ts) — `compileAufbauProofPrawitz` (reuses the
  linear type's theory resolution + goal-header parsing + starter extraction).

Worked cases live in `tests/helpers/prawitz-cases.ts`;
`scripts/prawitz-verify.ts` compiles + verifies each against the real engine.

## Accepted limitations (v1)

- **Vacuous discharge is inexpressible**: every leaf is cited by structure, so
  `a ⊢ b → a` cannot be proved by discharging an unused `b` (in Fitch you
  assume `b` and reiterate past it; a tree has nowhere to hang an uncited
  assumption). The workaround is to conjoin the assumption in and project it
  back out (`∧I` then `∧E`) — see the `kcomb` worked case. A discharge mark no
  assumption answers to is reported as `discharge_without_leaf` rather than
  silently ignored.
- Single-cell, independent proofs; no cross-cell lemma citation.
