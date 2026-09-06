# Aufbau tree-proof exercise (`aufbau-proof-tree@1`)

A second input modality for the engine-checked Aufbau proof: the student builds a
proof **tree** instead of typing linear proof lines. Everything downstream of the
input is shared with [`aufbau-proof`](../aufbau-proof/README.md) — the same
`@aufbau/compiler`, the same MMB certificate as the trust boundary, the same
worker-side [`verifyMmb`](../aufbau-proof/verifier.ts) against a frozen theory.
The compiler is the untrusted convenience; the verifier is the arbiter.

## The idea: flatten the tree, then it's an ordinary proof

A proof tree is a set of nodes, each a conclusion `formula` justified by a `rule`
citing its child `premises`. [`flatten.ts`](./flatten.ts) walks the tree in
**postorder** (children before their parent), assigning `l1..lN` so every citation
is to an earlier line — which is exactly what the `.auf` grammar requires — and
emits `lN: $ formula $ by rule [refs]`. A `hyp` leaf contributes `#n` (the goal
theorem's n-th hypothesis) and emits no line of its own. The result is
byte-for-byte the linear `.auf` the text editor would produce, so grading is
unchanged. The flattener also returns a char-space map from each generated line
back to its node, used to attribute a compiler diagnostic to the offending node.

## The trust boundary (identical to the linear type)

- The instructor authors an **`aufbau-mm0`** theory and, in each
  **`aufbau-proof-tree`**, a goal `theorem`. The compiler **freezes** the theory
  plus the goal declaration into `publicData.mm0` and extracts `goalFormula` to
  seed the tree's read-only root.
- The **client** ([`carnap-aufbau-proof-tree-v1.ts`](../../../client/components/carnap-aufbau-proof-tree-v1.ts))
  holds the tree model, renders it with the vendored ProofML elements, flattens
  and compiles on each edit, and writes `{ mmb, proofText, tree }` into
  `answerData`.
- The **worker** ([`assessment.ts`](./assessment.ts)) decodes the MMB and verifies
  it against the *frozen* mm0 — never the student's tree or proofText. `ok` ⇔ the
  declared goal is proved.

## Authoring syntax

```md
:::aufbau-mm0{name="prop"}
provable sort wff;
term top: wff;
axiom top_i: $ top $;
:::

:::aufbau-proof-tree{system="prop" id="t1"}
Build a proof of top.

theorem thm_top: $ top $
:::
```

Prose is the prompt; a single `theorem <name>: $ … $` line states the goal. By
default there is no starter body — the student builds the tree from a root seeded
with the goal. Optionally, a `----` underline after the goal may be followed by a
**starter proof** in the same linear `.auf` form the tree flattens to; the
compiler parses it back into a tree ([`parse.ts`](./parse.ts), the inverse of
`flatten.ts`) and the editor seeds from it. A starter that reuses a line (a DAG,
not a tree) is rejected with a `proof_is_not_a_tree` diagnostic — each line may be
cited by at most one other. Attributes match `aufbau-proof`: `system` (required, a
declared `aufbau-mm0` name earlier in the document), `id`, `title`, `points`,
`exam`, `feedback`, `options`.

## Formulas are read in the theory's language

Where the theory names the sort a node is read at — what its `@syntax role
turnstile` yields, as `forallx-calgary-2019` declares — each node's *sequent* — a tree node states the whole judgement, so it is read at the sort the turnstile yields rather than at the sentence sort is parsed against that spec and re-printed
in engine notation before it reaches the compiler. `Ax(F(x)->G(x)) ; F(a) ⊢ G(a)` goes in;
`(((∀ x ((F (x)) → (G (x)))) ; (F (a))) ⊢ (G (a)))` comes out. The compiler's math parser wants every token
whitespace-separated and every compound operand parenthesized; the book wants
neither, and this is the layer where the two stop disagreeing (see
[`../aufbau-proof/formulas.ts`](../aufbau-proof/formulas.ts)).

It buys two things beyond notation. A formula that will not read is reported
against the node that carries it, at the character that broke it, instead of arriving as an engine
unification failure. And the spec's lints start applying to proofs: forallx
admits parentheses only around a two-place connective, so `∀ x (x = x)` is now
refused and must be written `∀ x x = x`.

**One condition: the theory must name the sort a node is read at** — the sort
its `@syntax role turnstile` yields, falling back to the sentence sort where it
declares no turnstile. `gentzen-lk` names neither and reads as it always did.
That is not a claim that such a file is no language: it parses, and the
language built from it reads its own notations quite happily. It simply never
says which sort a student's node is in, and nothing here will guess one. A
pre-#250 artifact, frozen with the stripped `mm0` and no `source` at all, has
no text to ask and reads as engine text for that reason instead.

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

- [`types.ts`](./types.ts) — `ProofTreeNode`, public/answer shapes, guards.
- [`flatten.ts`](./flatten.ts) — the postorder flattener + line-span map (pure).
- [`parse.ts`](./parse.ts) — `parseProofTree`, the inverse of `flatten.ts`: turns
  an author's linear `.auf` starter body back into a tree, rejecting non-trees
  (pure).
- [`authoring.ts`](./authoring.ts) — `compileAufbauProofTree` (reuses the linear
  type's theory resolution + goal-header parsing; parses an optional starter).
- [`assessment.ts`](./assessment.ts) — normalize/evaluate/review; reuses
  `verifyMmb`.
- [`read-only-view.ts`](./read-only-view.ts) — SSR element chrome + the read-only
  review tree (ProofML markup).

## Accepted limitations (v1)

- Plain tree editing: free-text rule names (an axiom name, or an alias the
  theory declares for one, resolved by `flattenProofTree`'s `readRule`), no
  rule-picker dropdown, no drag-to-reparent, no full keyboard navigation.
- `auto?`/`complete` flags are carried but inert, as in the linear type.
- Single-cell, independent proofs; no cross-cell lemma citation.
