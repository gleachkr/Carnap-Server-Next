import { FORALLX_THEORY_MM0 } from "./forallx-theory";

/**
 * A demo lesson for the forallx: Calgary natural-deduction system, TFL through
 * the first-order fragment: the theory panel plus six Fitch exercises of rising
 * difficulty — a worked modus ponens, ∧ commutativity, ∨ commutativity through
 * ∨-elimination, double-negation by indirect proof, universal instantiation
 * (∀E + →E), and existential elimination (∃E). Shared by the authoring
 * compile-check test and the local seed script (`scripts/seed-forallx-demo.ts`)
 * so the two never drift.
 */
export const FORALLX_DEMO_SOURCE = `# Natural deduction — *forallx: Calgary*

These exercises use the proof system from *forallx: Calgary*, in the Fitch shape
you know from the book: one formula per line, **indentation opens a subproof**,
and each line is justified by a rule and the earlier lines it cites. Write the
justification after a colon — the rule name, then the line numbers or a subproof
range \`a-b\`. Assumptions cite \`ax\`.

The connective rules are: \`ax\` (assumption/premise), \`reit\` (reiteration),
\`and_intro\` / \`and_elim_l\` / \`and_elim_r\`, \`or_intro_l\` / \`or_intro_r\` /
\`or_elim\`, \`imp_intro\` / \`imp_elim\`, \`iff_intro\` / \`iff_elim_l\` /
\`iff_elim_r\`, \`neg_intro\` / \`neg_elim\`, \`explosion\`, and \`ip\` (indirect
proof). The first-order rules are \`all_intro\` / \`all_elim\` (∀I / ∀E),
\`ex_intro\` / \`ex_elim\` (∃I / ∃E), and \`eq_intro_nd\` / \`eq_replace\` (=I / =E).
Terms are written with the small signature \`F\`, \`G\` (one-place), \`R\`
(two-place); the names and variables are \`x\`, \`y\`, \`z\`. The editor checks
your proof as you type; a ✓ means it verifies.

:::aufbau-mm0{name="forallx"}
${FORALLX_THEORY_MM0}
:::

## 1. Modus ponens (worked)

A first proof, already filled in. From \`P → Q\` and \`P\`, conclude \`Q\` with
\`imp_elim\`. Watch the ✓ appear.

:::aufbau-proof-fitch{theory="forallx" id="mp" points="1"}
Derive \`Q\` from \`P → Q\` and \`P\`.

theorem mp (P Q: wff): $ (P → Q) , P ⊢ Q $
----
P → Q   :ax
P       :ax
Q       :imp_elim 1 2
:::

## 2. Commutativity of conjunction

Take \`P ∧ Q\` apart with \`and_elim_l\` / \`and_elim_r\` and put it back the other
way with \`and_intro\`.

:::aufbau-proof-fitch{theory="forallx" id="andcomm" points="2"}
Show that \`P ∧ Q\` entails \`Q ∧ P\`.

theorem andcomm (P Q: wff): $ P ∧ Q ⊢ Q ∧ P $
----
P ∧ Q   :ax
:::

## 3. Commutativity of disjunction

This one needs \`or_elim\`: assume each disjunct in its own subproof, derive the
goal in both, then discharge. Indent a subproof, and start the second subproof
with a fresh \`ax\` assumption at the same indentation.

:::aufbau-proof-fitch{theory="forallx" id="orcomm" points="3"}
Show that \`P ∨ Q\` entails \`Q ∨ P\`.

theorem orcomm (P Q: wff): $ P ∨ Q ⊢ Q ∨ P $
----
P ∨ Q   :ax
:::

## 4. Double negation elimination (indirect proof)

Assume \`¬ P\` for contradiction, reach \`⊥\` with \`neg_elim\`, and close with
\`ip\`.

:::aufbau-proof-fitch{theory="forallx" id="dne" points="3"}
Show that \`¬ ¬ P\` entails \`P\`.

theorem dne (P: wff): $ ¬ ¬ P ⊢ P $
----
¬ ¬ P   :ax
:::

## 5. Universal instantiation

Now for quantifiers. Instantiate \`∀ x (F x → G x)\` at the name \`y\` with
\`all_elim\`, then finish with \`imp_elim\`. \`all_elim\` reads the name to use off
the formula you write, so just state \`F y → G y\`.

:::aufbau-proof-fitch{theory="forallx" id="unimp" points="2"}
From \`∀ x (F x → G x)\` and \`F y\`, derive \`G y\`.

theorem unimp {x y: tm}: $ ∀ x (F x → G x) , F y ⊢ G y $
----
∀ x (F x → G x)   :ax
F y               :ax
:::

## 6. Existential elimination

The ∃E rule works like ∨E: open a subproof, assume an instance for a **fresh
name** (\`F y :ax\`), derive the goal inside, then discharge with \`ex_elim\`
citing the existential line and the subproof range. The name \`y\` may not appear
in the conclusion — that is the eigenvariable side condition, and the engine
enforces it.

:::aufbau-proof-fitch{theory="forallx" id="exelim" points="3"}
From \`∃ x (F x)\` and \`∀ x (F x → G x)\`, derive \`∃ x (G x)\`.

theorem exelim {x y: tm}: $ ∃ x (F x) , ∀ x (F x → G x) ⊢ ∃ x (G x) $
----
∃ x (F x)          :ax
∀ x (F x → G x)    :ax
:::`;
