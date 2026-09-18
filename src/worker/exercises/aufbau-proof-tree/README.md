# Tree proof exercise (`aufbau-proof-tree@1`)

Students build a proof tree rather than type a linear proof script. Each
node has a conclusion and rule, with child nodes supplying premises. The
browser flattens the tree to Aufbau proof text, compiles an MMB certificate,
and submits it for independent server verification.

The compiler, verifier, frozen-theory contract, and certificate storage rules
are shared with [linear proofs](../aufbau-proof/README.md).

## Flattening

`flatten.ts` visits children before parents and assigns labels `l1` through
`lN`. This ensures every generated citation refers to an earlier line:

```text
lN: $ formula $ by rule [references]
```

A `hyp` leaf references the goal theorem's corresponding hypothesis as `#n`
and emits no separate line. In the editor such a leaf is a citation, not a
line: it shows the cited hypothesis's text as the goal declares it (read with
`goalHypothesisTexts` in `exercise-kit/proof/formulas.ts`, in the engine's
numbering — `(h: $ … $)` binders first, then the `>`-chain), fixed rather
than editable, and its inference slot chooses *which* hypothesis — a select
when the goal declares more than one, a bare `#1` when it declares one. The
stored `formula` on a `hyp` node is that text, kept so review can redraw the
leaf without the goal. The flattener also maps generated character
ranges to tree nodes so compiler diagnostics can identify the relevant node.
Rule aliases are resolved through the theory's rule reader.

The client maintains the tree and renders it using vendored ProofML
elements. Submission data contains `{ tree, proofText, mmb }`. The server
verifies only `mmb` against its saved theory and goal, then stores the tree,
proof text, and evaluation without the certificate. Review redraws the tree.

## Authoring

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

Prose supplies the prompt and the theorem line states the fixed goal.
Without a starter, the editor begins with a root containing that goal.

An optional `----` separator introduces a linear `.auf` starter.
`parseProofTree` in `src/worker/exercise-kit/proof/tree-parse.ts` converts it
into a tree. Each line may be cited
by at most one other line, and exactly one root must remain uncited. Shared
subproofs would form a graph, not a tree, and produce
`proof_is_not_a_tree`. Duplicate the derivation in each branch instead.

Attributes are `system`, `id`, `title`, `points`, `exam`, `feedback`,
`options`, and `playground`. `system` is required and names a preceding
`aufbau-mm0` block or a built-in system. Common settings follow the
[authoring reference][authoring].

`playground` (boolean) drops the goal: the body is the prompt, optionally
followed by `----` and a starter, and the statement the proof proves is
derived from the proof itself — the root node, which is the last line the flattener emits. The widget shows it live as
"Proves", the answer carries it as `goal` (its `@vars` binders and the
statement in engine text), and the worker rebuilds the same
`theorem playground …` declaration from the answer, checks its binders
against the system's `@vars` pools, and verifies the certificate against the
theory plus that declaration. See `exercise-kit/proof/playground.ts`, and the
[authoring reference][authoring] for the shared rules.
"Add hypothesis" is disabled whenever the goal declares no hypotheses — a
sequent-style goal keeps its assumptions left of the turnstile and declares
none, and a playground has no goal at all. In a playground the root is
editable and starts empty. Over a theory whose
nodes stay engine text (`gentzen-lk`), the root is read once in engine mode
to find its variables.

## Formula parsing

When a theory provides a student language, tree nodes are read at the
turnstile constructor's result sort, falling back to the sentence sort.
Each node states a whole judgement, not just its final sentence. The parser
converts student notation to the whitespace and parentheses required by the
engine. Parse errors identify the node and offending character.

Language restrictions also apply. For example, Calgary permits parentheses
around binary compounds, but not around identity alone: write `∀x x = x`,
not `∀x(x = x)`.

Without a declared input sort, nodes remain engine text. This is the case
for `gentzen-lk`. Old artifacts without original `source` also use engine
text because they contain no surface-language annotations to read.

The goal theorem's binders are in scope. In a schema such as
`theorem mp (a b: wff): $ (a → b) ; a ⊢ b $`, the letters `a` and `b` are
formula metavariables, not the language's ordinary individual names.

Starters are parsed during authoring. The goal's math strings are also
converted to engine syntax, but without student-formula lints such as
redundant-bracket checks. The compiled `goalEngineDecl` is used in `mm0`;
original source is retained for display. Invalid goal syntax produces
`invalid_goal_formula`. These conversions are implemented in
`../../exercise-kit/proof/formulas.ts`.

## Implementation and tests

- `types.ts`: public/answer shapes and guards; re-exports `ProofTreeNode`.
- `flatten.ts`: postorder traversal and generated-line mappings.
- `src/worker/exercise-kit/proof/tree-parse.ts`: `ProofTreeNode`, linear
  starter parsing and tree validation (shared with the Prawitz type).
- `authoring.ts`: directive compilation and shared theory/goal handling.
- `assessment.ts`: normalization, verification, and review.
- `read-only-view.ts`: inert widget markup and read-only tree rendering.
- `src/client/components/carnap-aufbau-proof-tree-v1.tsx`: browser element
  (path relative to the repository root).

Tests are `tests/tree-proof-{authoring,flatten,parse,verify}.test.ts` and
`tests/proof-formulas.test.ts`, with browser behavior covered by DOM tests.

## Limitations

- Rules are free text; there is no rule-picker dropdown or drag-to-reparent
  interaction. Keyboard navigation and editing are implemented; see the
  widget's Help dialog.
- `auto` and `complete` flags are parsed but do not enable search controls.
- Exercises are independent and cannot cite proofs from other exercises.

[authoring]: ../../../../docs/carnap-markdown-v1.md
