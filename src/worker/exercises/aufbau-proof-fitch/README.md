# Fitch proof exercise (`aufbau-proof-fitch@1`)

Students write formulas and justifications in CodeMirror, using indentation
to mark subproofs. The editor draws scope lines. `fitchToAuf` translates the
text into sequents for the Aufbau compiler; the server verifies the resulting
MMB certificate against the saved theory and goal.

Compiler loading, verification, and certificate storage are shared with
[linear proofs](../aufbau-proof/README.md). The server grades the certificate,
not the student's Fitch text or the browser's structural checks.

## Translating scopes into contexts

The translator targets natural-deduction theories expressed as sequents.
Contexts must be associative, commutative, have a unit, and be idempotent
(ACUI). The theory identifies its assumption axiom, turnstile, and context
separator through `@syntax` roles. The forallx systems use `;` as the
separator; old artifacts can retain comma-based defaults.

Each nonblank line becomes a numbered proof step. A plain citation `n`
becomes `ln`; a subproof range normally supplies its endpoint. The generated
line has this form:

```text
lk: $ Γ ⊢ φ $ by rule [references]
```

The translator builds an indentation stack. A deeper indent opens a scope;
a shallower indent closes scopes until it reaches the matching level.
Each line's context contains the assumptions in its open scopes. Closed
sibling scopes do not contribute. After a subproof closes, an introduction
rule can verify the conclusion with that assumption removed.

The built-in theories include an extra context variable in rule conclusions
to permit implicit weakening. This allows a nested line to cite a shallower
line while stating its result in a larger ambient context. It also supports
vacuous discharge: assume b, reiterate a, then discharge b.

### Citation accessibility

Plain references must lie on the citing line's open scope path. A cited
subproof must belong to a scope on that path. Otherwise the translator
reports `inaccessible_reference` instead of leaving the compiler to report a
less specific unification error.

Scope IDs are not reused. Re-assuming the same formula in a new box does
not make lines from a closed box accessible. A certificate can nevertheless
prove a logically valid statement without following the editor's citation
discipline; that discipline is not independently enforced by the verifier.

### Sibling subproofs

Disjunction elimination and biconditional introduction need separate boxes
at the same indentation. Within a subproof, an assumption after a derived
line starts a new sibling box. A run of assumptions before any derivation
stays in one box; top-level premises share one context.

A box containing only an assumption does not trigger this split. Add a
reiteration before starting its sibling, or use the linear/tree interface.

### Quantifiers

There is no quantifier-specific translation of scope structure. Quantifier
rules are ordinary cited rules, and existential elimination cites an
existential line and a subproof range. MM0 dependency typing enforces the
selected theory's eigenvariable restrictions. Engine elaboration annotations
infer witnesses and eigenvariables from the sequents.

## Authoring

```md
:::aufbau-proof-fitch{system="forallx-calgary-2019" id="mp"}
Derive Q from P → Q and P.

theorem mp: $ (P → Q) ; P ⊢ Q $
----
P → Q   :AS
P       :AS
Q       :→E 1 2
:::
```

The body contains a prompt, theorem declaration, `----`, and raw starter
text. The starter may be empty. The widget and review show the goal statement
without its theorem name, binders, or math-string delimiters.

Each proof line is `<formula> :<rule> <references>`. The last colon separates
the justification, allowing colons in formula notation. Rules may be axiom
identifiers or aliases declared by the theory. `proofRuleReader` resolves
aliases before assumption checks, citation analysis, and emission. Unknown
rule names are passed to the engine for diagnosis.

Attributes are `system`, `id`, `title`, `points`, `exam`, `feedback`,
`options`, and `playground`. `system` must name a theory block or built-in system.
The selected theory must declare these roles:

- `assumption`: the assumption axiom;
- `turnstile`: the sequent constructor and its notation;
- `context-join`: the context separator.

Missing roles produce authoring diagnostics. Add the roles to the theory,
not per-exercise notation overrides. The common settings are described in
the [authoring reference][authoring].

`playground` (boolean) drops the goal: the body is the prompt, optionally
followed by `----` and a starter, and the statement the proof proves is
derived from the proof itself — the last line with the assumptions still open at it, which is the last sequent the translator emits. The widget shows it live as
"Proves", the answer carries it as `goal` (its `@vars` binders and the
statement in engine text), and the worker rebuilds the same
`theorem playground …` declaration from the answer, checks its binders
against the system's `@vars` pools, and verifies the certificate against the
theory plus that declaration. See `exercise-kit/proof/playground.ts`, and the
[authoring reference][authoring] for the shared rules.

### Magnus reductio and citation shapes

The original Magnus forallx system has no `⊥`. Its negation rules cite a
contradictory pair from one subproof. `citations.ts` derives citation shapes
from rule signatures so one range can supply both premises:

```text
neg_intro 2-5
```

This supplies lines 4 and 5, which must be the subproof's final two lines,
in the rule's order: a sentence followed by its negation. The explicit form
`neg_intro 2-4 2-5` is also accepted. Unlike the original Carnap checker,
this translator does not try premise permutations.

## Formula parsing

Fitch formulas use the sort marked `@syntax role sentence`. The parser
converts the selected language's student notation into engine notation and
reports failures at the original character in the editor. Calgary's bracket
rules apply: write `∀x x = x`, not `∀x(x = x)`.

Without the role, formulas remain engine text. Old artifacts without
original `source` also remain engine text. The theorem's binders are in
scope, so a schema's formula metavariables take precedence over names in the
language lexicon.

Starters are parsed during authoring. Goal math strings are converted using
the turnstile result sort, with a sentence-sort fallback, but without the
stricter student lints. Invalid goal syntax produces `invalid_goal_formula`.
`goalEngineDecl` supplies engine input; the authored declaration remains
available for display. See `../../exercise-kit/proof/formulas.ts`.

## Scope rendering

`fitchScopeGeometry` walks the same indentation stack as the translator.
Geometry records indentation columns for enclosing bars and an `openFrom`
index identifying newly opened bars. A sibling box begins with a visible
gap, so adjacent boxes do not look continuous.

The assumption axiom is saved as `publicData.assumptionRule`. The editor
passes it to translation and to the scope-bar plugin through an
`assumptionRuleFacet`. The `ax` fallback supports older artifacts.

Review widgets do not receive the complete theory. The server supplies
`data-assumption-spellings` so their scope geometry recognizes the axiom
and its aliases. One assumption axiom is supported per exercise; supporting
several would require changing the translator contract.

## Answer data and implementation

The widget submits `{ fitchText, proofText, mmb }` — and, in a playground,
`goal`. The server stores the two texts (and the goal) and evaluation after
verification, without `mmb`.

- `types.ts`: public/answer shapes, version metadata, and guards.
- `translate.ts`: scope analysis, translation, and geometry.
- `citations.ts`: citation shapes derived from theory signatures.
- `authoring.ts`: directive compilation, role checks, and starter parsing.
- `assessment.ts`: normalization, verification, and review.
- `read-only-view.ts`: inert markup and submitted-source review.
- `src/client/components/carnap-aufbau-proof-fitch-v1.ts`: browser editor
  (path relative to the repository root).

Use the Fitch test suites and `tests/proof-formulas.test.ts` for changes.
The verification scripts exercise real proofs against the built-in systems.

## Limitations

- The theory must support the required sequent/context structure. Use a
  linear or tree proof for systems that do not.
- Every top-level premise in the goal must appear as an assumption line,
  even if unused. Otherwise it is absent from the conclusion's context and
  the goal does not match.
- Sibling splitting requires a derived line before the next assumption.
- `auto` and `complete` flags do not enable search/completion controls.
- Proof exercises cannot cite lemmas from other exercises.

[authoring]: ../../../../docs/carnap-markdown-v1.md
