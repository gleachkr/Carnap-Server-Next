import { FORALLX_THEORY_MM0 } from "./forallx-theory";

/**
 * A demo lesson for Prawitz-style natural-deduction trees over the forallx:
 * Calgary system: the theory panel plus seven tree exercises of rising
 * difficulty — modus ponens (no discharge), conditional introduction (one
 * discharge), double-negation introduction (a standing premise beside a
 * discharged assumption), ∨-commutativity (the full ∨E shape, two labels
 * discharged at once), the K combinator (the ∧-detour that stands in for
 * vacuous discharge), existential elimination (∃E with an eigenvariable), and
 * a starter-seeded rerun of the K combinator (the editor opens mid-proof).
 * Every goal is one of the engine-verified shapes in `prawitz-cases.ts`.
 * Shared by the authoring compile-check test and the local seed script
 * (`scripts/seed-prawitz-demo.ts`) so the two never drift.
 */
export const PRAWITZ_DEMO_SOURCE = `# Natural deduction — Prawitz trees

These exercises use the proof system from *forallx: Calgary*, drawn the way
Prawitz (and Gentzen) drew it: as a **tree**, with the premises of each
inference above its line and the conclusion below. You build the tree
**top-down**. Start each assumption with *New assumption*, derive downward by
ticking the dot under each premise **in order** and pressing *Apply rule
below*, and you are done when the forest has joined into a single tree whose
root is the goal. (You can also work upward — *Add premise above* and *Add
assumption above* grow a derived line's inputs — and meet in the middle.)

To **discharge** an assumption, give it a label and repeat the label beside
the rule that discharges it: select the assumption line, type a number in the
small box that appears after it, and type the same number in the box beside
the discharging rule. The assumption grows its brackets — \`[A]¹\` — exactly
as the book prints it.

The connective rules are: \`and_intro\` / \`and_elim_l\` / \`and_elim_r\`,
\`or_intro_l\` / \`or_intro_r\` / \`or_elim\`, \`imp_intro\` / \`imp_elim\`,
\`iff_intro\` / \`iff_elim_l\` / \`iff_elim_r\`, \`neg_intro\` / \`neg_elim\`,
\`explosion\`, and \`ip\` (indirect proof). The first-order rules are
\`all_intro\` / \`all_elim\` (∀I / ∀E) and \`ex_intro\` / \`ex_elim\`
(∃I / ∃E). The editor checks your tree as you type; a ✓ means it verifies.

:::aufbau-mm0{name="forallx"}
${FORALLX_THEORY_MM0}
:::

## 1. Modus ponens

No discharge yet — this one is about joining trees. Make two assumptions,
\`a → b\` and \`a\`, tick their dots **in that order** (the conditional
first), and apply \`imp_elim\` below them.

:::aufbau-proof-prawitz{theory="forallx" id="pz_mp" title="Modus ponens" points="1"}
Derive \`b\` from \`a → b\` and \`a\`.

theorem mp (a b: wff): $ (a → b) , a ⊢ b $
:::

## 2. Conditional introduction

The first discharge. Assume \`a\` under label \`1\`, apply \`imp_intro\`
below it to conclude \`a → a\`, and put \`1\` in the discharge box beside the
rule — the assumption's brackets appear when both ends match.

:::aufbau-proof-prawitz{theory="forallx" id="pz_self" title="Conditional introduction" points="1"}
Prove \`a → a\` from nothing.

theorem self (a: wff): $ _ ⊢ a → a $
:::

## 3. Double-negation introduction

One assumption stays a **standing premise** (no label — it ends up in the
context) while the other, \`¬ a\`, is labeled and discharged by
\`neg_intro\`. \`neg_elim\` wants the formula first and its negation second.

:::aufbau-proof-prawitz{theory="forallx" id="pz_dni" title="Double-negation introduction" points="1"}
Show that \`a\` entails \`¬ ¬ a\`.

theorem dni (a: wff): $ a ⊢ ¬ ¬ a $
:::

## 4. Disjunction commutes

The full Prawitz shape. Two labeled case-assumptions, \`a\` under \`1\` and
\`b\` under \`2\`, each built up to \`b ∨ a\` with \`or_intro_r\` /
\`or_intro_l\`; then \`or_elim\` below the disjunction and both cases (in that
order), discharging **both** labels at once — write \`1 2\` in its discharge
box.

:::aufbau-proof-prawitz{theory="forallx" id="pz_orcomm" title="Disjunction commutes" points="1"}
Show that \`a ∨ b\` entails \`b ∨ a\`.

theorem orcomm (a b: wff): $ a ∨ b ⊢ b ∨ a $
:::

## 5. The K combinator

A quirk of trees: every assumption is cited by where it *stands*, so an
assumption that the conclusion never uses has nowhere to stand — a tree
cannot discharge \`b\` vacuously the way a Fitch proof assumes and reiterates
past. The classical detour: conjoin the unused assumption in with
\`and_intro\`, take it back out with \`and_elim_r\`, then discharge as usual.

:::aufbau-proof-prawitz{theory="forallx" id="pz_kcomb" title="The K combinator" points="1"}
Prove \`b → a\` from \`a\` — via \`b ∧ a\`.

theorem kcomb (a b: wff): $ a ⊢ b → a $
:::

## 6. Existential elimination

First-order rules ride through unchanged. From \`∃ x (F x)\`, assume a fresh
witness \`F y\` under label \`1\`; get \`F y → G y\` by \`all_elim\`, then
\`G y\` by \`imp_elim\`, then \`∃ x (G x)\` by \`ex_intro\`. Finish with
\`ex_elim\` below the existential premise and that derivation (in that
order), discharging the witness — the eigenvariable condition is checked by
the engine.

:::aufbau-proof-prawitz{theory="forallx" id="pz_exelim" title="Existential elimination" points="1"}
Derive \`∃ x (G x)\` from \`∃ x (F x)\` and \`∀ x (F x → G x)\`.

theorem exelim {x y: tm}: $ ∃ x (F x) , ∀ x (F x → G x) ⊢ ∃ x (G x) $
:::

## 7. Finish a started tree

Sometimes the tree comes pre-built partway — discharges included. Here \`b\`
has been assumed under label \`2\`, conjoined with \`a\`, and discharged
again: \`[b]²\` is bracketed because the \`imp_intro\` below it carries the
matching \`2\`. Your job is the outer discharge — apply \`imp_intro\` at the
bottom, label the \`a\` assumption \`1\`, and write \`1\` in the new rule's
discharge box.

:::aufbau-proof-prawitz{theory="forallx" id="pz_starter" title="Finish a started tree" points="1"}
Finish the proof of \`a → (b → a ∧ b)\`.

theorem curry (a b: wff): $ _ ⊢ a → (b → a ∧ b) $
----
a1: $ a ⊢ a $ by ax []
b1: $ b ⊢ b $ by ax [] -- label:2
c1: $ a , b ⊢ a ∧ b $ by and_intro [a1, b1]
c2: $ a ⊢ b → a ∧ b $ by imp_intro [c1] -- label:2
:::
`;
