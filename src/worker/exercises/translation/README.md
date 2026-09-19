# Translation exercise (`translation@1`)

Students symbolize a natural-language prompt. An answer is accepted if its
parsed formula matches an author's solution, or if the server verifies a
certificate proving equivalence to one. An `exact` variant accepts only the
parsed match. Additional tests can require a normal form or limit connective
counts.

The default language is forallx: Calgary 2019. `system` can select another
built-in or a theory block; parsing uses the shared first-order
core and `@aufbau/syntax`, not a per-exercise notation table.

## Checking and verification

The browser parses the submitted formula and compares its canonical form to
the solutions. Both sides are reparsed through `logic/solutions.ts`, so a
change to canonical spelling does not by itself break an old solution.

If no solution matches, the browser asks Aufbau's `auto?` proof search for
an equivalence proof. `src/client/proof-search.ts` runs `@aufbau/lsp` in a
Web Worker, and the shared compiler turns the proof into an MMB certificate.
The widget submits `{ text, mmb, solutionIndex }`.

The server reparses the answer and emits its own MM0 statement for
`text ↔ solutions[solutionIndex]` through `logic/mm0.ts`. It checks the
certificate against that statement using the proof exercises' verifier.
A certificate for another statement cannot satisfy it. Search and compilation
are not trusted for grading.

**Solutions are public data.** Browser search needs its target formulas.
Students can inspect them with developer tools. `exam` and `feedback`
control recording and display, not access to solutions or local computation.

The server stores `{ text, solutionIndex }` and the evaluation, without the
certificate. Old evaluations are not reverified when the search calculus
changes. A manual recheck can therefore differ after a calculus change;
review such changes against the engine regression tests.

## Equivalence calculus

`logic/theories.ts` generates a one-sided Tait/Schütte sequent calculus for
classical logic around the two formulas' signature. Propositional pairs omit
objects, substitution, and quantifier rules to reduce search cost.

Negation, truth constants, and the four core binary connectives are always
available. The other twelve binary truth functions are included when used.
Each receives its own term, congruence/substitution support, and rules for
positive and negated occurrences. These rules are derived from its truth
function; formulas are not merely rewritten into core connectives before
checking.

The earlier rewrite-based design could not reliably handle equivalences
between differently nested quantifiers. Its e-graph treated binders
nominally, while different transformations required incompatible choices of
binder names. The sequent calculus handles binders through inference rules
instead.

Keep emitted goal binders (`v*`) separate from the `@vars` pool (`k*`). If
a pool token is already a goal binder, search uses that binder instead of a
fresh dummy. Dependency checks can then reject every attempted witness.

Search is bounded. Failure to find a proof does not establish
non-equivalence; even a valid answer can exceed the budget and receive no
credit. Include intended answer forms as additional solutions when needed.
`tests/translation-engine.test.ts` checks textbook equivalences and rejects
adversarial non-equivalences. Run it after calculus or emission changes.

## Authoring

Write prompt prose followed by solution list items. A bullet can contain
comma-separated alternatives:

```md
::::translation{#fine variant="first-order" points="2"}
Everything is fine.

- AxF(x)
- ~Ex~F(x)
::::
```

Attributes:

- `id` or `#id`: required stable exercise ID.
- `variant`: `prop` (default), `first-order`, or `exact`. `prop` rejects
  quantifiers, identity, and predicates with individual arguments in both
  solutions and submitted answers. `exact` compares parsed formulas without
  equivalence search.
- `system`: theory-block name or built-in system ID; defaults to
  `forallx-calgary-2019`. For example, use `carnap-prop` for its propositional
  notation with `variant="prop"`.
- `tests`: space-separated `CNF`, `DNF`, `PNF` (first-order only),
  `maxCon:N`, `maxNeg:N`/`maxNot:N`, `maxAnd:N`, `maxOr:N`, `maxIf:N`,
  `maxIff:N`, `maxFalse:N`, and `maxAtom:N`. Both spellings of the negation
  limit are accepted for original-Carnap compatibility.
- `starter`: initial input, which can be incomplete text or prose.
- `options`: `nocheck` (hides feedback) and `checksyntax` (blocks submission
  of unparseable input).
- `title`, `points`, `exam`, `feedback`: common exercise settings.

See the [authoring reference][authoring] for common defaults and the notation
systems. The supplied solutions need not themselves satisfy `tests`: an
exercise can ask students to find an equivalent formula in a different form.

## Widget behavior

The widget checks after a typing pause; Enter checks immediately. There is
no separate Check button. A preview below the input shows canonical notation
or a localized parser error.

Submit waits for a pending check so the answer includes its certificate.
An edit while waiting cancels that pending submission. Explicit checks show
verdict text under full feedback; `none` suppresses the mark and verdict,
but checking still runs because grading needs the certificate.

## Answer data

```jsonc
{
  "text": "~Ex~F(x)",
  "mmb": "<base64 MMB certificate>",
  "solutionIndex": 0
}
```

An answer is correct only if it parses, meets the variant restrictions and
all `tests`, and either matches a parsed solution or has a verified
equivalence certificate. The stored submission omits `mmb`.

Review renders the submitted formula in logical symbols. It uses the stored
evaluation for correctness rather than rerunning search.

## Implementation

- `types.ts`: constants, public/answer shapes, and guards.
- `logic/theories.ts`: generated classical sequent calculus.
- `logic/mm0.ts`: deterministic binders, symbol names, and proof statements.
- `logic/solutions.ts`: parsed solution matching.
- `logic/tests.ts`: normal-form and connective-count requirements.
- `logic/variant.ts`: propositional restrictions.
- `authoring.ts`: directive compilation.
- `assessment.ts`: normalization, verification, and review.
- `read-only-view.ts`: inert markup and review rendering.
- `verdict-text.ts` and `strings.ts`: feedback and translated widget text.
- `src/client/components/carnap-translation-v1.ts`: browser element.
- `src/client/proof-search.ts`: shared LSP search worker.

Paths beginning with `src/` are relative to the repository root.

## Possible extensions

Additional logics require parser/semantic support and suitable proof rules;
adding notation alone is not enough. A future engine batch-search API could
also remove the separate LSP worker. Neither change is implemented here.
Displaying the found proof as feedback is another possible extension.

[authoring]: ../../../../docs/carnap-markdown-v1.md
