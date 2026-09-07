/**
 * A demo lesson for the forallx: Calgary natural-deduction system, TFL through
 * the first-order fragment: the theory panel plus six Fitch exercises of rising
 * difficulty — a worked modus ponens, ∧ commutativity, ∨ commutativity through
 * ∨-elimination, double-negation by indirect proof, universal instantiation
 * (∀E + →E), existential elimination (∃E), and one written in the ASCII the
 * book uses, since the theory is also the language its lines are read in.
 * Shared by the authoring
 * compile-check test and the local seed script (`scripts/seed-forallx-demo.ts`)
 * so the two never drift.
 */
export const FORALLX_DEMO_SOURCE = `# Natural deduction — *forallx: Calgary*

These exercises use the proof system from *forallx: Calgary*, in the Fitch shape
you know from the book: one formula per line, **indentation opens a subproof**,
and each line is justified by a rule and the earlier lines it cites. Write the
justification after a colon — the rule name, then the line numbers or a subproof
range \`a-b\`. Assumptions cite \`AS\`.

The connective rules are: \`AS\` (assumption/premise), \`reit\` (reiteration),
\`and_intro\` / \`and_elim_l\` / \`and_elim_r\`, \`or_intro_l\` / \`or_intro_r\` /
\`or_elim\`, \`imp_intro\` / \`imp_elim\`, \`iff_intro\` / \`iff_elim_l\` /
\`iff_elim_r\`, \`neg_intro\` / \`neg_elim\`, \`explosion\`, and \`ip\` (indirect
proof). The first-order rules are \`all_intro\` / \`all_elim\` (∀I / ∀E),
\`ex_intro\` / \`ex_elim\` (∃I / ∃E), and \`eq_intro_nd\` / \`eq_replace\` (=I / =E).
Predicate letters are \`A\`–\`Z\` and take their arguments in parentheses:
\`P\` is a sentence letter, \`F(a)\` and \`R(a,b)\` are the same letters applied.
The lowercase alphabet is split three ways — \`a\`–\`e\` are **names**,
\`f\`–\`r\` are function letters, and \`s\`–\`z\` are the **variables** a
quantifier binds. A sequent's premises are separated by \`;\`, because the
comma already separates a predicate's arguments. The editor checks your proof
as you type; a ✓ means it verifies.

:::aufbau-mm0{name="forallx" src="/theories/forallx-calgary-2019.mm0"}
:::

## 1. Modus ponens (worked)

A first proof, already filled in. From \`P → Q\` and \`P\`, conclude \`Q\` with
\`imp_elim\`. Watch the ✓ appear.

:::aufbau-proof-fitch{system="forallx" id="mp" points="1"}
Derive \`Q\` from \`P → Q\` and \`P\`.

theorem mp (P Q: wff): $ (P → Q) ; P ⊢ Q $
----
P → Q   :AS
P       :AS
Q       :imp_elim 1 2
:::

## 2. Commutativity of conjunction

Take \`P ∧ Q\` apart with \`and_elim_l\` / \`and_elim_r\` and put it back the other
way with \`and_intro\`.

:::aufbau-proof-fitch{system="forallx" id="andcomm" points="2"}
Show that \`P ∧ Q\` entails \`Q ∧ P\`.

theorem andcomm (P Q: wff): $ P ∧ Q ⊢ Q ∧ P $
----
P ∧ Q   :AS
:::

## 3. Commutativity of disjunction

This one needs \`or_elim\`: assume each disjunct in its own subproof, derive the
goal in both, then discharge. Indent a subproof, and start the second subproof
with a fresh \`AS\` assumption at the same indentation.

:::aufbau-proof-fitch{system="forallx" id="orcomm" points="3"}
Show that \`P ∨ Q\` entails \`Q ∨ P\`.

theorem orcomm (P Q: wff): $ P ∨ Q ⊢ Q ∨ P $
----
P ∨ Q   :AS
:::

## 4. Double negation elimination (indirect proof)

Assume \`¬ P\` for contradiction, reach \`⊥\` with \`neg_elim\`, and close with
\`ip\`.

:::aufbau-proof-fitch{system="forallx" id="dne" points="3"}
Show that \`¬ ¬ P\` entails \`P\`.

theorem dne (P: wff): $ ¬ ¬ P ⊢ P $
----
¬ ¬ P   :AS
:::

## 5. Universal instantiation

Now for quantifiers. Instantiate \`∀ x (F(x) → G(x))\` at the name \`a\` with
\`all_elim\`, then finish with \`imp_elim\`. \`all_elim\` reads the name to use off
the formula you write, so just state \`F(a) → G(a)\`.

:::aufbau-proof-fitch{system="forallx" id="unimp" points="2"}
From \`∀ x (F(x) → G(x))\` and \`F(a)\`, derive \`G(a)\`.

theorem unimp {x: var} {a: name}: $ ∀ x (F(x) → G(x)) ; F(a) ⊢ G(a) $
----
∀ x (F(x) → G(x))   :AS
F(a)                :AS
:::

## 6. Existential elimination

The ∃E rule works like ∨E: open a subproof, assume an instance for a **fresh
name** (\`F(b) :AS\`), derive the goal inside, then discharge with \`ex_elim\`
citing the existential line and the subproof range. The name \`b\` may not appear
in the conclusion or in any premise still standing — that is the eigenvariable
side condition, and the engine enforces it.

:::aufbau-proof-fitch{system="forallx" id="exelim" points="3"}
From \`∃ x F(x)\` and \`∀ x (F(x) → G(x))\`, derive \`∃ x G(x)\`.

theorem exelim {x: var} {b: name}: $ ∃ x F(x) ; ∀ x (F(x) → G(x)) ⊢ ∃ x G(x) $
----
∃ x F(x)              :AS
∀ x (F(x) → G(x))     :AS
:::

## 7. Typing it the way the book writes it

Every line above is spelled the way the *engine* wants it — \`∀ x\` with a
space after the quantifier, \`→\` as a glyph. You do not have to type that.
The system this course is set in is also its **language**, so a proof line is
read exactly the way a translation exercise reads your answer: \`Ax\`, \`Ex\`,
\`~\`, \`/\\\`, \`\\/\` and \`->\` all work, and nothing needs a space it does
not want. \`AxF(x)\` and \`∀ x F(x)\` are the same line.

:::aufbau-proof-fitch{system="forallx" id="typing" points="2"}
From \`∀ x (F(x) ∧ G(x))\`, derive \`∀ x F(x)\`. The first line is typed in
ASCII; finish it with \`all_elim\`, \`and_elim_l\` and \`all_intro\`.

theorem unidist {x: var} {a: name}: $ ∀ x (F(x) ∧ G(x)) ⊢ ∀ x F(x) $
----
Ax(F(x) /\\ G(x))   :AS
:::

One convention of the book now applies to proofs as well as to translations:
parentheses go around a two-place connective and nowhere else. Write
\`∀ x x = x\`, not \`∀ x (x = x)\` — identity is not a connective, and the
quantifier's scope is the sentence immediately after it, so the parentheses were
never doing anything.
`;
