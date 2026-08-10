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

:::aufbau-proof-tree{theory="prop" id="t1"}
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
cited by at most one other. Attributes match `aufbau-proof`: `theory` (required, a
declared `aufbau-mm0` name earlier in the document), `id`, `title`, `points`,
`exam`, `feedback`, `options`.

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

- Plain tree editing: free-text rule names, no rule-picker dropdown, no
  drag-to-reparent, no full keyboard navigation.
- `auto?`/`complete` flags are carried but inert, as in the linear type.
- Single-cell, independent proofs; no cross-cell lemma citation.
