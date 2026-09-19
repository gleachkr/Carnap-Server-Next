# Prawitz proof exercise (`aufbau-proof-prawitz@1`)

Students build natural-deduction trees with formulas at the nodes, labeled
assumptions such as `[A]¹`, and discharge labels on inferences. They work in
a forest of partial trees, selecting premises in order before applying a
rule. A complete answer is one tree ending in the goal.

`prawitzToAuf` translates the tree into sequents for the Aufbau compiler.
The server verifies the resulting MMB against the frozen theory and goal.
Verification and certificate storage follow the
[linear proof contract](../aufbau-proof/README.md).

## Discharge and dependency contexts

The translator derives contexts from assumption labels:

- A labeled assumption is discharged at its nearest ancestor whose
  `discharge` list contains that label. Its scope is the child subtree of
  that ancestor containing the leaf.
- An unlabeled assumption is a standing premise.
- A leaf starts with a context containing itself. An inference takes the
  union of its premise dependencies, excluding assumptions discharged there.
- Dependencies are tracked per leaf, not per formula. Discharging one
  assumption does not remove another with the same formula and another label.

Unlike Fitch's ambient contexts, these contexts contain only dependencies of
the node. Assumptions from unrelated sibling branches must not be included:
otherwise they can incorrectly prevent an eigenvariable rule from applying.
The `eigenpollute` worked case tests this distinction.

Rules need a separate context variable per premise, joined in the conclusion
(the multiplicative form). A rule requiring the same context in every premise
would fail when sibling branches have different dependency sets. The built-in
forallx theories use the multiplicative form and also permit an extra context
in conclusions for Fitch weakening. Prawitz translation can leave that extra
context empty.

A postorder traversal emits one line per node:

```text
lN: $ Γ ⊢ φ $ by rule [references]
```

Assumption leaves emit the theory's assumption axiom. Unlike the general tree
proof type, Prawitz has no line-less `#n` leaves: standing premises belong to
the goal sequent's context. The translator returns generated-line mappings,
per-node contexts, and structural diagnostics. The engine and verifier enforce
logical rules, including eigenvariable conditions.

## Authoring

```md
:::aufbau-proof-prawitz{system="forallx-calgary-2019" id="p1"}
Prove the conditional by discharging its antecedent.

theorem self: $ _ ⊢ P → P $
----
a1: $ P ⊢ P $ by AS [] -- label:1
c1: $ _ ⊢ P → P $ by imp_intro [a1] -- label:1
:::
```

The prompt and theorem may be followed by `----` and a starter. Starter
lines use the tree type's linear form with full sequents. The parser discards
the written contexts and recomputes them from labels.

On an assumption line, `-- label:1` labels the leaf. On an inference, it
lists labels to discharge; separate multiple labels with commas. The starter
must parse as a tree and pass structural discharge checks, but need not be a
finished proof.

Attributes are `system`, `id`, `title`, `points`, `exam`, `feedback`,
`options`, and `playground`. `system` names a theory block or a built-in system.
The theory must declare `assumption`, `turnstile`, and `context-join` roles.
Missing roles produce authoring errors. Starter separators accept any
turnstile spelling declared by the theory; emitted sequents use its canonical
spelling. Rule aliases are resolved before emission.

See the [authoring reference][authoring] for common settings and theory reuse.

`playground` (boolean) drops the goal: the body is the prompt, optionally
followed by `----` and a starter, and the statement the proof proves is
derived from the proof itself — the root with its dependency context, which is the last sequent the translator emits. The widget shows it live as
"Proves", the answer carries it as `goal` (its `@vars` binders and the
statement in engine text), and the worker rebuilds the same
`theorem playground …` declaration from the answer, checks its binders
against the system's `@vars` pools, and verifies the certificate against the
theory plus that declaration. See `exercise-kit/proof/playground.ts`, and the
[authoring reference][authoring] for the shared rules.

## Formula parsing

Nodes use the theory's `@syntax role sentence` sort. The parser converts
student formulas into engine notation and reports errors on the relevant
node and character. Language restrictions apply; for example, Calgary
requires `∀x x = x` rather than `∀x(x = x)`.

Without a declared sentence sort, input remains engine text. The same is
true for old artifacts without the original annotated `source`. Goal
binders are in scope while parsing, so formula metavariables in a theorem
schema are not confused with individual names from the lexicon.

Starters are parsed during authoring. Goals are converted to engine text as
`goalEngineDecl`, using the turnstile result sort with a sentence fallback.
Goal parsing omits stricter student lints but still rejects invalid syntax
with `invalid_goal_formula`. Original source is kept for display. The shared
implementation is `../../exercise-kit/proof/formulas.ts`.

Discharge matching compares normalized formulas. Thus `~P` and `¬P` under
the same label can identify the same assumption rather than producing
`discharge_formula_mismatch` solely because their spellings differ.

## Answer data and implementation

The widget submits `{ tree, proofText, mmb }`. The server verifies the
certificate and stores the tree, proof text, and evaluation without `mmb`.
Review redraws the submitted tree.

- `types.ts`: `PrawitzProofNode`, public/answer shapes, and guards.
- `translate.ts`: scope/dependency analysis, `.auf` emission, line mappings,
  and structural diagnostics.
- `parse.ts`: `parsePrawitzStarter`, using the
  kit's tree parser (`src/worker/exercise-kit/proof/tree-parse.ts`) for
  structural work.
- `authoring.ts`: directive compilation, theory/goal handling, and starters.

Worked cases are in `tests/helpers/prawitz-cases.ts`.
`scripts/prawitz-verify.ts` compiles and verifies them with the real engine.

## Limitations

Vacuous discharge has no direct representation: an assumption must occur in
the tree to be discharged. To prove `a ⊢ b → a`, use the b assumption in a
conjunction and project a back out before discharge. The `kcomb` case shows
this workaround. A label with no matching leaf produces
`discharge_without_leaf` rather than being ignored.

Proof exercises are independent and cannot cite lemmas from other exercises.

[authoring]: ../../../../docs/carnap-markdown-v1.md
