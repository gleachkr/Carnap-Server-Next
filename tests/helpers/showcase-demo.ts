import { FORALLX_THEORY_MM0 } from "./forallx-theory";

/**
 * A demo lesson that exercises **every** exercise directive the profile exposes,
 * and shows the source of each one in a fenced code block right above it — so the
 * page doubles as a tour of the format and a tour of the widgets. Logic is the
 * forallx: Calgary system from {@link FORALLX_THEORY_MM0} (truth tables use its
 * truth-functional fragment in Carnap ascii notation).
 *
 * Shared by `tests/showcase-demo.test.ts` (which compiles it, so a directive that
 * changes shape breaks a test rather than a demo) and `scripts/seed-showcase-demo.ts`.
 * The three worked proofs are engine-verified by `scripts/showcase-verify.ts`; the
 * last Fitch exercise is deliberately unfinished.
 */
export const SHOWCASE_DEMO_SOURCE = `# A tour of the exercise types

This lesson is a demonstration. It walks through **every kind of exercise**
Carnap can put in front of a student, and above each one it shows the source you
would type to write it. In each of those sources, everything below the \`----\`
underline is the starter material the student sees; everything above it is
prompt.

The logic is the natural-deduction system of *forallx: Calgary*, extended to the
full first-order fragment. Truth tables use the truth-functional fragment in
Carnap's ascii notation (\`~ /\\ \\/ -> <->\`); the proof editors use the sequent
form of the same system, in the usual symbols. The model exercises use the
first-order notation of the 2019 *forallx: Calgary* — \`Ax\` and \`Ex\` for the
quantifiers, predicates with parentheses.

## The proof system

Rules are named by the theory's own identifiers, so a justification is written
in ascii. Here is the correspondence with the textbook's names:

\`\`\`
forallx                identifier(s)                  form
─────────────────────  ─────────────────────────────  ──────────────────────
premise / assumption   ax                             Γ, A ⊢ A
R (reiteration)        reit                           Γ ⊢ A  ⟹  Γ, Δ ⊢ A
∧I  /  ∧E              and_intro / and_elim_l, and_elim_r
∨I  /  ∨E              or_intro_l, or_intro_r / or_elim
→I  /  →E              imp_intro / imp_elim
↔I  /  ↔E              iff_intro / iff_elim_l, iff_elim_r
¬I  /  ¬E              neg_intro / neg_elim           A, ¬A ⊢ ⊥
X (explosion)          explosion
IP (indirect proof)    ip
=I  /  =E              eq_intro_nd / eq_replace
∀I  /  ∀E              all_intro / all_elim
∃I  /  ∃E              ex_intro / ex_elim
\`\`\`

The rules themselves are declared in an \`aufbau-mm0\` block, which is what makes
them available to the proof exercises further down. A whole system fits in one
block. Declaring a theory does not put it on the page — add \`show\` when you want
students to be able to read the axioms, as the panel below does:

\`\`\`md
:::aufbau-mm0{name="forallx" show}
provable sort wff;
sort ctx;
sort tm;

term imp (a b: wff): wff;
infixr imp: $→$ prec 25;
term all {x: tm} (p: wff x): wff;
prefix all: $∀$ prec 46;

axiom ax (g: ctx) (a: wff): $ g , a ⊢ a $;
axiom imp_intro (g h: ctx) (a b: wff): $ g , a ⊢ b $ > $ g , h ⊢ a → b $;
axiom imp_elim (g h i: ctx) (a b: wff): $ g ⊢ a → b $ > $ h ⊢ a $ > $ g , h , i ⊢ b $;
:::
\`\`\`

:::aufbau-mm0{name="forallx" show}
${FORALLX_THEORY_MM0}
:::

## 1. Multiple choice

The simplest exercise. Options are task-list lines; \`[x]\` marks the correct one,
the id before the \`|\` is what gets recorded, and the text after it is the label.

\`\`\`md
:::multiple-choice{id="mc_discharge" title="Discharging rules" points="1"}
Which of these rules cites a whole **subproof** — a range of lines like \`3-7\` —
rather than individual lines?

- [x] impintro | \`imp_intro\` (→I)
- [ ] impelim | \`imp_elim\` (→E)
- [ ] andintro | \`and_intro\` (∧I)
- [ ] reit | \`reit\` (R)
:::
\`\`\`

:::multiple-choice{id="mc_discharge" title="Discharging rules" points="1"}
Which of these rules cites a whole **subproof** — a range of lines like \`3-7\` —
rather than individual lines?

- [x] impintro | \`imp_intro\` (→I)
- [ ] impelim | \`imp_elim\` (→E)
- [ ] andintro | \`and_intro\` (∧I)
- [ ] reit | \`reit\` (R)
:::

## 2. Multiple choice, several answers

Add \`mode="multiple"\` and mark every correct option. Scoring is exact match: the
selection has to be precisely the marked set.

\`\`\`md
:::multiple-choice{id="mc_which" title="Dischargers" mode="multiple" points="2"}
Select **every** rule that discharges an assumption.

- [x] negintro | \`neg_intro\` (¬I)
- [x] ip | \`ip\` (IP)
- [x] orelim | \`or_elim\` (∨E)
- [x] exelim | \`ex_elim\` (∃E)
- [ ] allelim | \`all_elim\` (∀E)
- [ ] eqreplace | \`eq_replace\` (=E)
:::
\`\`\`

:::multiple-choice{id="mc_which" title="Dischargers" mode="multiple" points="2"}
Select **every** rule that discharges an assumption.

- [x] negintro | \`neg_intro\` (¬I)
- [x] ip | \`ip\` (IP)
- [x] orelim | \`or_elim\` (∨E)
- [x] exelim | \`ex_elim\` (∃E)
- [ ] allelim | \`all_elim\` (∀E)
- [ ] eqreplace | \`eq_replace\` (=E)
:::

## 3. Short answer

Checked automatically against a list of accepted answers, which stay private —
they are not in the page the student loads. Matching ignores case and
surrounding space.

\`\`\`md
:::short-answer{id="sa_exelim" title="Name the rule" answers="ex_elim|exelim"}
Using the table at the top of this page: what is the identifier for ∃E?
:::
\`\`\`

:::short-answer{id="sa_exelim" title="Name the rule" answers="ex_elim|exelim"}
Using the table at the top of this page: what is the identifier for ∃E?
:::

## 4. Free response

For work a human grades. The \`rubric\` is instructor-only: it shows up during
review and never reaches the student's browser.

\`\`\`md
:::free-response{id="fr_eigen" title="The ∀I restriction" points="4" rubric="The name may not occur in an undischarged assumption; example of the failure."}
The ∀I rule carries a restriction on the name it generalizes. State the
restriction, and give an argument that would be provable without it but is not
valid.
:::
\`\`\`

:::free-response{id="fr_eigen" title="The ∀I restriction" points="4" rubric="The name may not occur in an undischarged assumption; example of the failure."}
The ∀I rule carries a restriction on the name it generalizes. State the
restriction, and give an argument that would be provable without it but is not
valid.
:::

## 5. Truth tables

Formulas are list items; one bullet may hold several comma-separated formulas,
and the tables are drawn side by side. **Check** grades in the browser as often
as the student likes; **Submit** records a grade the server computes. This is the
default \`simple\` variant; the next two sections name a different one.

\`\`\`md
:::truth-table{id="tt_demorgan" title="De Morgan" check="terse" points="4"}
Fill in both tables. If the two columns agree on every row, the sentences are
equivalent.

- ~(P /\\ Q)
- ~P \\/ ~Q
:::
\`\`\`

:::truth-table{id="tt_demorgan" title="De Morgan" check="terse" points="4"}
Fill in both tables. If the two columns agree on every row, the sentences are
equivalent.

- ~(P /\\ Q)
- ~P \\/ ~Q
:::

## 6. A truth table for an argument

With \`variant="validity"\` the body is a sequent: premises, \`:|-:\`, conclusion.
The table gains a \`⊢\` column, marked \`F\` on any row that is a counterexample.
Here the argument is invalid, and \`counterexample-to="validity"\` lets the
student say so by producing the single bad row instead of the whole table.

\`\`\`md
:::truth-table{id="tt_affirming" title="Affirming the consequent" variant="validity" counterexample-to="validity" points="3"}
Is this argument valid? If not, find a counterexample.

P -> Q, Q :|-: P
:::
\`\`\`

:::truth-table{id="tt_affirming" title="Affirming the consequent" variant="validity" counterexample-to="validity" points="3"}
Is this argument valid? If not, find a counterexample.

P -> Q, Q :|-: P
:::

## 7. One row of a truth table

\`variant="partial"\` asks for a single row, with the valuation the student's to
choose. The trailing grid line pins what the row has to show — here, a false
main connective — and \`hiddenGivens\` keeps that constraint off the page.

\`\`\`md
:::truth-table{id="tt_row" title="Make it false" variant="partial" options="hiddenGivens" points="2"}
Choose values for \`P\` and \`Q\` that make \`P -> Q\` **false**, and fill in the row.

- P -> Q

. . | . F .
:::
\`\`\`

:::truth-table{id="tt_row" title="Make it false" variant="partial" options="hiddenGivens" points="2"}
Choose values for \`P\` and \`Q\` that make \`P -> Q\` **false**, and fill in the row.

- P -> Q

. . | . F .
:::

## 8. A model

The semantic counterpart of a truth table, for sentences a truth table cannot
reach. The student describes a **finite model** — a domain, and an extension or
a value for every symbol the sentences use — and the exercise says whether the
sentences come out the way it asked. The fields are not authored: they follow
from the sentences, so adding a name or a function symbol adds its field.

Choose the domain first. A constant is a menu of the domain's elements and a
function is a table with a row for every argument, so both are rebuilt when the
domain changes.

\`\`\`md
:::model{id="md_both" title="Two at once" points="3"}
Build a model in which **both** of these come out true. How many things does
your domain need?

- ExF(x), Ex~F(x)
:::
\`\`\`

:::model{id="md_both" title="Two at once" points="3"}
Build a model in which **both** of these come out true. How many things does
your domain need?

- ExF(x), Ex~F(x)
:::

## 9. A countermodel

With \`variant="validity"\` the body is a sequent, as in a truth table for an
argument — but here the student refutes it by *building the situation*: a model
in which every premise is true and the conclusion is not. There is no single
right answer, which is why **Check** can be offered as freely as it is. It runs
the same test the server runs, so it is not a hint but the grade itself.

\`\`\`md
:::model{id="md_invalid" title="Someone for everyone" variant="validity" points="4"}
Everyone likes someone; so there is someone everyone likes. Show that this does
not follow, by describing a situation in which the premise holds and the
conclusion fails.

AxEyR(x,y) :|-: ExAyR(y,x)
:::
\`\`\`

:::model{id="md_invalid" title="Someone for everyone" variant="validity" points="4"}
Everyone likes someone; so there is someone everyone likes. Show that this does
not follow, by describing a situation in which the premise holds and the
conclusion fails.

AxEyR(x,y) :|-: ExAyR(y,x)
:::

## 10. A proof, as proof lines

Now the engine-checked proof types. All three share one machine: the browser
compiles the student's proof to a certificate as they type — the ✓ appears when
it goes through — and the server re-checks that certificate on submit, against
the goal frozen into the exercise.

This first one is the raw form. Each line is a sequent with its own context,
justified by a rule and the labels of the lines it uses. This proof is filled in
already, so it should show its ✓ at once.

\`\`\`md
:::aufbau-proof{theory="forallx" id="pf_lines" title="Distributing ∀" points="2"}
Read the proof, then submit it. Try breaking a line to see the engine complain.

theorem unidist {x: tm}: $ ∀ x (F x ∧ G x) ⊢ ∀ x (F x) $
----
l1: $ ∀ x (F x ∧ G x) ⊢ ∀ x (F x ∧ G x) $ by ax []
l2: $ ∀ x (F x ∧ G x) ⊢ F x ∧ G x $ by all_elim [l1]
l3: $ ∀ x (F x ∧ G x) ⊢ F x $ by and_elim_l [l2]
l4: $ ∀ x (F x ∧ G x) ⊢ ∀ x (F x) $ by all_intro [l3]
:::
\`\`\`

:::aufbau-proof{theory="forallx" id="pf_lines" title="Distributing ∀" points="2"}
Read the proof, then submit it. Try breaking a line to see the engine complain.

theorem unidist {x: tm}: $ ∀ x (F x ∧ G x) ⊢ ∀ x (F x) $
----
l1: $ ∀ x (F x ∧ G x) ⊢ ∀ x (F x ∧ G x) $ by ax []
l2: $ ∀ x (F x ∧ G x) ⊢ F x ∧ G x $ by all_elim [l1]
l3: $ ∀ x (F x ∧ G x) ⊢ F x $ by and_elim_l [l2]
l4: $ ∀ x (F x ∧ G x) ⊢ ∀ x (F x) $ by all_intro [l3]
:::

## 11. The same proof, as a tree

\`aufbau-proof-tree\` gives a tree editor instead. The goal sits at the foot; the
student builds premises upward and names the rule under each inference bar.
Optionally seed it with a starter written in the same line form as above — the
compiler reads that back into a tree.

\`\`\`md
:::aufbau-proof-tree{theory="forallx" id="pf_tree" title="Universal instantiation" points="2"}
The tree below is complete. Click a line to select it; the toolbar adds a
premise, adds a hypothesis, or deletes a subtree.

theorem treeunimp {x y: tm}: $ ∀ x (F x → G x) , F y ⊢ G y $
----
l1: $ ∀ x (F x → G x) , F y ⊢ ∀ x (F x → G x) $ by ax []
l2: $ ∀ x (F x → G x) , F y ⊢ F y $ by ax []
l3: $ ∀ x (F x → G x) , F y ⊢ F y → G y $ by all_elim [l1]
l4: $ ∀ x (F x → G x) , F y ⊢ G y $ by imp_elim [l3, l2]
:::
\`\`\`

:::aufbau-proof-tree{theory="forallx" id="pf_tree" title="Universal instantiation" points="2"}
The tree below is complete. Click a line to select it; the toolbar adds a
premise, adds a hypothesis, or deletes a subtree.

theorem treeunimp {x y: tm}: $ ∀ x (F x → G x) , F y ⊢ G y $
----
l1: $ ∀ x (F x → G x) , F y ⊢ ∀ x (F x → G x) $ by ax []
l2: $ ∀ x (F x → G x) , F y ⊢ F y $ by ax []
l3: $ ∀ x (F x → G x) , F y ⊢ F y → G y $ by all_elim [l1]
l4: $ ∀ x (F x → G x) , F y ⊢ G y $ by imp_elim [l3, l2]
:::

## 12. The same proof, Fitch style

\`aufbau-proof-fitch\` is the shape from the book: one formula per line, a
justification after a colon, and **indentation for subproofs** — the scope lines
are drawn for you. Contexts are worked out from the indentation, so an
assumption just cites \`ax\`, and a rule that discharges one cites the subproof's
range.

This proof uses ∃E, whose subproof assumes an instance for a fresh name. The
name may not escape into the conclusion; that side condition is checked by the
engine, not by the editor.

\`\`\`md
:::aufbau-proof-fitch{theory="forallx" id="pf_fitch" title="Existential elimination" points="3"}
A worked ∃E. Re-indent line 3 and watch the scope line — and the ✓ — react.

theorem exelim {x y: tm}: $ ∃ x (F x) , ∀ x (F x → G x) ⊢ ∃ x (G x) $
----
∃ x (F x)          :ax
∀ x (F x → G x)    :ax
    F y            :ax
    F y → G y      :all_elim 2
    G y            :imp_elim 4 3
    ∃ x (G x)      :ex_intro 5
∃ x (G x)          :ex_elim 1 3-6
:::
\`\`\`

:::aufbau-proof-fitch{theory="forallx" id="pf_fitch" title="Existential elimination" points="3"}
A worked ∃E. Re-indent line 3 and watch the scope line — and the ✓ — react.

theorem exelim {x y: tm}: $ ∃ x (F x) , ∀ x (F x → G x) ⊢ ∃ x (G x) $
----
∃ x (F x)          :ax
∀ x (F x → G x)    :ax
    F y            :ax
    F y → G y      :all_elim 2
    G y            :imp_elim 4 3
    ∃ x (G x)      :ex_intro 5
∃ x (G x)          :ex_elim 1 3-6
:::

## 13. Your turn

The last one is not done for you. Assume \`¬ P\` for contradiction, derive \`⊥\`
with \`neg_elim\`, and close the subproof with \`ip\`, citing its range.

\`\`\`md
:::aufbau-proof-fitch{theory="forallx" id="pf_yours" title="Double negation" points="3"}
Show that \`¬ ¬ P\` entails \`P\`.

theorem dnetask (P: wff): $ ¬ ¬ P ⊢ P $
----
¬ ¬ P    :ax
:::
\`\`\`

:::aufbau-proof-fitch{theory="forallx" id="pf_yours" title="Double negation" points="3"}
Show that \`¬ ¬ P\` entails \`P\`.

theorem dnetask (P: wff): $ ¬ ¬ P ⊢ P $
----
¬ ¬ P    :ax
:::

## 14. The same exercise, told nothing

Every exercise takes a \`feedback\` attribute saying how much the student is told
about whether the work is right. This one is the exercise above with
\`feedback="none"\`: no Check button, no ✓ however good the proof gets, and no
score until grades are released. Set \`feedback="terse"\` instead and the ✓ comes
back but the inline complaints do not, so a student is told *that* it is wrong
and has to find *where* themselves.

You will not often write it. An assignment that is still holding its grades back
gives every exercise on it \`feedback="none"\` already — committing to an answer
means nothing if the checker's score comes straight back — and one that has
released them gives every exercise \`full\`. The attribute is for disagreeing with
that in one place.

\`\`\`md
:::aufbau-proof-fitch{theory="forallx" id="pf_sealed" title="Double negation, sealed" points="3" feedback="none"}
Show that \`¬ ¬ P\` entails \`P\`. You will not be told whether you have.

theorem dnesealed (P: wff): $ ¬ ¬ P ⊢ P $
----
¬ ¬ P    :ax
:::
\`\`\`

:::aufbau-proof-fitch{theory="forallx" id="pf_sealed" title="Double negation, sealed" points="3" feedback="none"}
Show that \`¬ ¬ P\` entails \`P\`. You will not be told whether you have.

theorem dnesealed (P: wff): $ ¬ ¬ P ⊢ P $
----
¬ ¬ P    :ax
:::

## 15. Submit as the only feedback

\`exam\` decides whether wrong work is *kept*, and it is a separate question from
whether the student is told anything. Writing both — \`exam="false"\` so a wrong
answer is thrown away, \`feedback="none"\` so nothing is said about it — leaves
exactly one signal: whether pressing Submit made the answer stick. The student
commits before they learn anything, and a wrong try is not held against them.

\`\`\`md
:::short-answer{id="sa_commit" title="Name the rule" points="1" answer="modus ponens" exam="false" feedback="none"}
From \`P\` and \`P → Q\`, infer \`Q\`. What is this rule called?
:::
\`\`\`

:::short-answer{id="sa_commit" title="Name the rule" points="1" answer="modus ponens" exam="false" feedback="none"}
From \`P\` and \`P → Q\`, infer \`Q\`. What is this rule called? Nothing here will
tell you whether you are right — but the answer will not save until you are.
:::

## What else the format does

- \`points\` on any exercise, and \`exam="true"\` when a submission should be
  recorded whether or not it is right (outside exam mode only correct work is
  kept, so students can keep trying).
- \`title\` for the instructor's gradebook column.
- \`variant="constraint"\` on a model exercise, whose body is
  \`- constraints : sentences\`: the constraints have to come out true as well,
  which is how you stop a universal sentence being satisfied by a domain of one.
- A link to another lesson by id: \`[the next chapter](item:0197a2c4-89ab-7cde-8f01-23456789abcd)\`,
  which resolves to whichever assignment publishes that lesson in the reader's
  course.
- A \`style\` block, whose body is CSS for this page only:

\`\`\`md
:::style
.exercise { border-radius: 0; }
:::
\`\`\`
`;
