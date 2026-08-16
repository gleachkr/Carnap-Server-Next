# Translation exercise (`translation@1`)

A symbolization exercise in the tradition of the original Carnap's
`Translate`: the prompt poses a natural-language sentence, the student types a
formula, and the answer counts as correct when it is **logically equivalent**
to one of the author's solutions. Equivalence is the Aufbau engine's `auto?`
proof search producing a **certificate** the worker independently re-verifies —
which is what makes the type extensible to logics with no handy decision
procedure: a new language is a dialect entry plus a proof calculus, not a new
checker.

Notation is **forallx: Calgary, 2019 and later**, through the shared syntax
core in [`../first-order/`](../first-order/).

## The trust boundary

- The **client** ([`carnap-translation-v1.ts`](../../../client/components/carnap-translation-v1.ts))
  parses the typed formula, and — unless it is canonically *equal* to a
  solution, which needs no proof — asks the page's `auto?` search
  ([`proof-search.ts`](../../../client/proof-search.ts), the `@aufbau/lsp`
  wasm in a Web Worker) for a rewrite chain joining it to a solution, compiles
  the found proof to an MMB with the page's one `@aufbau/compiler`, and
  submits `{ text, mmb, solutionIndex }`.
- The **worker** ([`assessment.ts`](./assessment.ts)) re-parses the text,
  rebuilds the mm0 from **its own emission** of `text ↔ solutions[i]`
  ([`logic/mm0.ts`](./logic/mm0.ts)), and `verifyPair`s the certificate
  against it via the proof types' [`verifier`](../aufbau-proof/verifier.ts).
  A certificate for any other statement fails verification; search and
  compilation stay untrusted conveniences.
- **The solutions ship in `publicData`.** The client cannot prove equivalence
  to a target it does not hold — the same exposure the original Carnap
  accepted. `feedback`/`exam` are display and recording controls, not a wall
  around the key.

## The equivalence relation

[`logic/theories.ts`](./logic/theories.ts) *is* the relation: a one-sided
(Tait/Schütte) sequent calculus for classical logic, generated around the
signature of the two formulas, ported from `tests/proof_cases/tait.mm0` in
gleachkr/Aufbau. Two formulas are equivalent exactly when `auto?` can prove
`⊢ S ↔ T` in it. A purely propositional pair gets the propositional fragment
only — no objects, no substitution, no quantifier rules — which keeps a refused
prop check an order of magnitude cheaper.

**Why a calculus and not a rewrite theory.** The first design saturated an
egraph of `@conversion` laws with `conversion?`. It foundered on quantifier
*shape*: the egraph is nominal, so `∀x P(x)` and `∀y P(y)` never share a class
and no rewrite law can rename a binder — alpha has to be spent at emission by
choosing names. But the parallel form `∀xF ∧ ∀yG` needs its binders to *share*
a name (so a distribution law can fire) while the nested form `∀x∀y(F ∧ G)`
forces them *apart*. No static naming satisfies both, so the whole cross-shape
prenexing family was unreachable. Under a calculus the binders are ordinary
rule binders, each occurrence gets its own name, and those equivalences are
simply proved.

The `@vars` pool is the trap to know about. Its tokens become theorem-local
dummies, and a token that is *already a binder of the goal* takes that binder
instead of a fresh dummy — after which invention offers the goal's own bound
variable, the dependency check refuses it, and the branch dies as an exhausted
search with `rex` tried dozens of times and never accepted. Emitted binders are
`v*` and the pool is `k*`; keep those namespaces apart.

The calculus is pinned by the regression battery in
[`tests/translation-engine.test.ts`](../../../../tests/translation-engine.test.ts):
the textbook catalogue certifies in tens of milliseconds, non-equivalences
exhaust to a refusal in about a second, and adversarial pairs (`F(a)`/`F(b)`,
`a=a`/`⊤`, `⊤`/`⊥`) must stay refused. Search is bounded, so an equivalence far
outside the catalogue can time out and be graded wrong; the authoring escape
hatch is the solutions list.

**Changing the calculus re-grades the past.** Nothing stores a verdict: a
submission keeps `{ text, mmb, solutionIndex }`, and every read re-emits the
mm0 from *this* file and re-verifies the recorded certificate against it. So a
rule that comes or goes changes the theory an old certificate is checked
against, and a certificate that no longer verifies reads as a wrong answer —
a correct one, silently downgraded. Adding a rule is safe (old proofs still
check); removing or restating one is not. Before dropping a rule from a
deployed instance, check whether any recorded translation answer carries an
`mmb`.

## Authoring syntax

Prose (the sentence to translate), then `- formula` list items — one solution
per bullet, or comma-separated alternates within one.

```md
::::translation{#fine variant="first-order" points="2"}
Everything is fine.

- AxF(x)
- ~Ex~F(x)
::::
```

### Attributes

| Attribute | Values / form | Default | Meaning |
|---|---|---|---|
| `#id` / `id` | identifier | — (**required**) | Stable exercise id. |
| `variant` | `prop` \| `first-order` \| `exact` | `prop` | Carnap's `.Prop`/`.FOL`/`.Exact`. `prop` rejects quantifiers, identity, and predicates of things — in solutions at compile time and in answers at grading time. `exact` compares parsed formulas and never consults the engine. |
| `system` | a dialect id | `forallx-calgary-2019` | The notation system; validated against the shared dialect table. |
| `tests` | space-separated | — | Extra conditions on the submission: `CNF` `DNF` `PNF` (first-order only) and `maxCon:N` `maxNeg:N`/`maxNot:N` `maxAnd:N` `maxOr:N` `maxIf:N` `maxIff:N` `maxFalse:N` `maxAtom:N`. Carnap's names and counting ([`logic/tests.ts`](./logic/tests.ts)); note upstream documented `maxNot` but implemented `maxNeg` — both work here. |
| `starter` | string | — | Prefilled input text (Carnap's partial solution; may be prose). |
| `options` | space-separated flags | — | `nocheck` (this type's spelling of `feedback="none"`) and `checksyntax` (refuse to submit text that does not parse). |
| `title`, `points`, `exam`, `feedback` | — | — | As for every exercise. |

## The widget

Checking is live, proof-type style: the correctness mark tracks on a pause in
typing, **Enter** checks immediately, and there is no Check button. A preview
line under the input reads the typed ASCII back in logical symbols, or words
the parser's complaint — in the reader's language, from the same sentences the
compile diagnostics use ([`strings.ts`](./strings.ts)). Verdict sentences
appear only on explicit checks under full feedback; under `none` the base
clamps the mark while the certificate is still computed, because grading needs
it even when the student is told nothing.

### Answer shape

```jsonc
{
  "text": "~Ex~F(x)",        // as typed; review shows it, exact grades it
  "mmb": "<base64 MMB>",      // certificate for text ↔ solutions[solutionIndex]
  "solutionIndex": 0          // which solution the certificate targets
}
```

`evaluation.ok` ⇔ parse ∧ variant restriction ∧ every `tests=` check ∧
(canonically equal to a solution | verified certificate). The review page
shows the submission in logical symbols and asserts nothing — equivalence
cannot be recomputed without the search engine, so correctness is the recorded
evaluation's story.

## How it fits together

| File | Role |
| --- | --- |
| [`types.ts`](./types.ts) | constants, `publicData`/`answerData` shapes, guards |
| [`logic/theories.ts`](./logic/theories.ts) | the equivalence relation: `@conversion` preludes per language |
| [`logic/mm0.ts`](./logic/mm0.ts) | deterministic emission: canonical binders, symbol mangling, `(mm0, auf)` assembly |
| [`logic/tests.ts`](./logic/tests.ts) | the `tests=` predicates, Carnap's counting |
| [`logic/variant.ts`](./logic/variant.ts) | the `prop` language restriction |
| [`authoring.ts`](./authoring.ts) | directive → `CompiledExercise` |
| [`assessment.ts`](./assessment.ts) | normalize + evaluate (verify) + review |
| [`read-only-view.ts`](./read-only-view.ts) | inert DSD chrome + review render |
| [`verdict-text.ts`](./verdict-text.ts) | wording for failed `tests=` checks |
| [`strings.ts`](./strings.ts) | every widget sentence, keyed by English source |
| [`carnap-translation-v1.ts`](../../../client/components/carnap-translation-v1.ts) | the element |
| [`proof-search.ts`](../../../client/proof-search.ts) | the page's one `auto?` search (LSP worker) |

## Roadmap

- **More languages.** A modal system is a dialect entry plus a prelude whose
  laws axiomatize its equivalence — the point of the architecture.
- **Upstream batch search.** If `compile_sources` learns to fill search
  placeholders, `proof-search.ts` collapses into `proof-compiler.ts` and the
  11 MB LSP wasm leaves the page. Client-only swap.
- **Alpha-aware egraph interning** upstream would close the cross-shape
  prenexing gap wholesale; the battery's known-gaps cases flip when it does.
- Rendering the found rewrite chain as feedback (today it is applied, then
  discarded beyond the MMB).
