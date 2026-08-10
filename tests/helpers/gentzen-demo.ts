import { GENTZEN_THEORY_MM0 } from "./gentzen-theory";

/**
 * A demo lesson for the Gentzen classical sequent calculus (LK), built for the
 * *tree* proof editor: the theory panel plus four proof-tree exercises of rising
 * difficulty — a one-step ∀-left/∃-right, the ∃-monotonicity chain, excluded
 * middle under a quantifier, and ∃ distributing over ∨ (a branching proof with
 * two subtrees under ∨-left). Shared by the authoring compile-check test and the
 * local seed script (`scripts/seed-gentzen-demo.ts`) so the two never drift.
 */
export const GENTZEN_DEMO_SOURCE = `# Sequent calculus — Gentzen's *LK*

These exercises use classical **LK**: a sequent is \`Γ ==> Δ\` with formulas on
*both* sides of the turnstile, read as "if everything on the left holds, then
something on the right does." Because the contexts are unordered collections that
absorb duplicates, exchange and contraction are free; the only structural rules
are identity (\`ax\`), weakening (\`weak_left\` / \`weak_right\`), and \`cut\`. Every
connective has a **left** rule and a **right** rule, and each quantifier has one
of each: \`all_left\` / \`all_right\` (∀) and \`ex_left\` / \`ex_right\` (∃).

You build the proof as a **tree**: the goal sequent is the root, and each rule
grows the branches above a node into the premise sequents it needs. Leaves are
\`ax\` (identity axioms \`A ==> A\`). The witness-carrying rules \`all_left\` and
\`ex_right\` read the instance off the sequent you write, so you never annotate the
term. The predicate signature is \`P\` and \`Q\` (one-place); names are \`x\`, \`y\`,
\`z\`. The editor checks the tree as you build it; a ✓ means it verifies.

:::aufbau-mm0{name="gentzen"}
${GENTZEN_THEORY_MM0}
:::

## 1. Universal to existential (worked)

The simplest quantifier shuffle: from \`∀ x P x\` derive \`∃ y P y\`. Instantiate on
the left with \`all_left\`, then witness on the right with \`ex_right\`, both above a
single \`ax\` leaf.

:::aufbau-proof-tree{theory="gentzen" id="forall_to_exists" points="1"}
Derive \`∃ y P y\` from \`∀ x P x\`.

theorem forall_to_exists {x y: obj}: $ ∀ x P x ==> ∃ y P y $
:::

## 2. Monotonicity of the existential

Under a universally quantified implication, the existential is monotone. This one
chains \`imp_left\` (which splits into two branches) beneath \`all_left\`, \`ex_right\`,
and \`ex_left\`.

:::aufbau-proof-tree{theory="gentzen" id="exists_mono" points="3"}
From \`∀ y (P y → Q y)\` and \`∃ x P x\`, derive \`∃ z Q z\`.

theorem exists_mono {x y z: obj}: $ ∀ y (P y → Q y) , ∃ x P x ==> ∃ z Q z $
:::

## 3. Excluded middle under a quantifier

A right-only proof from the empty left context, showing classical LK proves
\`∀ x (P x ∨ ¬ P x)\`. Build up with \`not_right\`, \`or_right\`, and \`all_right\` — the
multi-conclusion right side is what makes this go through without a case split.

:::aufbau-proof-tree{theory="gentzen" id="forall_excluded_middle" points="3"}
Prove \`∀ x (P x ∨ ¬ P x)\` from no premises.

theorem forall_excluded_middle {x: obj}: $ emp ==> ∀ x (P x ∨ ¬ P x) $
:::

## 4. Existential over disjunction

The proof branches: \`or_left\` grows *two* subtrees, one assuming \`P x\` and one
assuming \`Q x\`, each finished with \`ex_right\`, \`weak_right\`, and \`or_right\`. This
is where the tree shape earns its keep.

:::aufbau-proof-tree{theory="gentzen" id="exists_or_distrib" points="4"}
Derive \`∃ y P y ∨ ∃ z Q z\` from \`∃ x (P x ∨ Q x)\`.

theorem exists_or_distrib {x y z: obj}: $ ∃ x (P x ∨ Q x) ==> (∃ y P y ∨ ∃ z Q z) $
:::`;
