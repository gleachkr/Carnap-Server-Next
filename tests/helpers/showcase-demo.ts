/**
 * A demo lesson that exercises **every** exercise directive the profile exposes,
 * and shows the source of each one in a fenced code block right above it — so the
 * page doubles as a tour of the format and a tour of the widgets. Logic is the
 * forallx: Calgary system, named by its served path (truth tables use its
 * truth-functional fragment in Carnap ascii notation).
 *
 * Shared by `tests/showcase-demo.test.ts` (which compiles it, so a directive that
 * changes shape breaks a test rather than a demo) and `scripts/seed-showcase-demo.ts`.
 * The four worked proofs and the two playground starters are engine-verified by
 * `scripts/showcase-verify.ts`; the two Fitch exercises before the playgrounds
 * are deliberately unfinished.
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

A proof cites a rule by the textbook's own name — \`∧I\`, \`→E\`, \`AS\` for an
assumption — or by an ascii spelling of it (\`/\\I\`, \`->E\`), or by the
identifier the theory declares it under. The names are \`@syntax alias\` lines on
the rules; MM0 identifiers are ascii, so an alias is the only way \`∧I\` can be
said. Here is the correspondence:

\`\`\`
forallx                cite as               identifier(s)                        form
─────────────────────  ────────────────────  ───────────────────────────────────  ──────────────────────
premise / assumption   AS PR                 AS                                   Γ ; A ⊢ A
R (reiteration)        R                     reit                                 Γ ⊢ A  ⟹  Γ ; Δ ⊢ A
∧I  /  ∧E              ∧I /\\I  /  ∧E /\\E     and_intro / and_elim_l, and_elim_r
∨I  /  ∨E              ∨I \\/I  /  ∨E \\/E     or_intro_l, or_intro_r / or_elim
→I  /  →E              →I ->I  /  →E ->E     imp_intro / imp_elim
↔I  /  ↔E              ↔I <->I  /  ↔E <->E   iff_intro / iff_elim_l, iff_elim_r
¬I  /  ¬E              ¬I ~I  /  ¬E ~E       neg_intro / neg_elim                 A ; ¬A ⊢ ⊥
X (explosion)          X                     explosion
IP (indirect proof)    IP                    ip
=I  /  =E              =I  /  =E             eq_intro_nd / eq_replace
∀I  /  ∀E              ∀I  /  ∀E             all_intro / all_elim
∃I  /  ∃E              ∃I  /  ∃E             ex_intro / ex_elim
\`\`\`

Where the book's name covers two rules, one per side — ∧E, ∨I, ↔E — the alias
sits on the second axiom, which carries the engine's \`@fallback\` onto the
first: the engine tries the cited side and then the other, so the student never
says which. An alias works in the Fitch, tree and Prawitz editors and in their
starters. The linear \`aufbau-proof\` type is the exception: its lines are
engine text and go to the compiler as written, so there a rule is its
identifier. An alias says how a rule is written; which rule opens a hypothesis
is a \`@syntax role assumption\` on the axiom, and the Fitch and Prawitz
exercises read it from there.

The rules themselves come from an \`aufbau-mm0\` block, which is what makes them
available to the proof exercises further down. This one names a system the site
already serves, so the lesson does not carry three hundred lines of MM0:

\`\`\`md
:::aufbau-mm0{name="forallx" src="/theories/forallx-calgary-2019.mm0"}
:::
\`\`\`

That path is a real one — open it and you get the theory, rule names and all.
A course with its own vocabulary adds to it in the body of the same block, and
the declarations arrive after the ones the path brought:

\`\`\`md
:::aufbau-mm0{name="forallx" src="/theories/forallx-calgary-2019.mm0"}
--| @syntax delimiter $ Cube $
term Cube (x: tm): wff;

--| @congr
axiom Cube_congr (a b: tm): $ a = b $ > $ Cube a ↔ Cube b $;
:::
\`\`\`

Declaring a theory does not put it on the page — add \`show\` when you want
students to be able to read the axioms, as the panel below does:

:::aufbau-mm0{name="forallx" src="/theories/forallx-calgary-2019.mm0" show}
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
student say so by marking the one bad row — filled in like any other — as their
counterexample, instead of submitting the whole table.

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
function is a grid of them — the last argument across the columns, the rest down
the rows, so a binary function is the square it is written as on a blackboard —
and both are rebuilt when the domain changes.

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

## 10. Translation

Symbolization, the skill the proof types assume. The prompt is an English
sentence; the answer is a formula, judged up to **logical equivalence** — so
\`Q /\\ P\` is as right as \`P /\\ Q\`, and either order of a De Morgan
equivalent is as right as the key. As you type, the line under the box reads
your ASCII back in logical symbols; press **Enter** to check, or just pause —
the mark keeps up on its own.

\`\`\`md
:::translation{id="tr_and" title="Dancing and singing" points="1"}
*People danced and songs were sung.* Symbolize this with \`P\` for "people
danced" and \`Q\` for "songs were sung".

- P /\\ Q
:::
\`\`\`

:::translation{id="tr_and" title="Dancing and singing" points="1"}
*People danced and songs were sung.* Symbolize this with \`P\` for "people
danced" and \`Q\` for "songs were sung".

- P /\\ Q
:::

## 11. A first-order translation

The same directive with \`variant="first-order"\` takes the quantifiers. Under
the hood this check is the same engine the proof types run: the browser finds
an equivalence *proof* between your formula and a solution and the server
re-verifies it — try \`~Ex~F(x)\` here and watch it count as \`AxF(x)\`.

\`\`\`md
:::translation{id="tr_fine" title="Everything is fine" variant="first-order" points="2"}
*Everything is fine.* Use \`F(x)\` for "x is fine".

- AxF(x)
:::
\`\`\`

:::translation{id="tr_fine" title="Everything is fine" variant="first-order" points="2"}
*Everything is fine.* Use \`F(x)\` for "x is fine".

- AxF(x)
:::

And when only one formula will do — a missing premise, say — \`variant="exact"\`
turns the equivalence off:

:::translation{id="tr_exact" title="The missing premise" variant="exact" points="1" starter="To finish a modus ponens with P -> Q you also need..."}
To infer \`Q\` from \`P → Q\` by modus ponens, what else must you have? (Here
\`~~P\` will not do: name the premise itself.)

- P
:::

## 12. A proof, as proof lines

Now the engine-checked proof types. All four share one machine: the browser
compiles the student's proof to a certificate as they type — the ✓ appears when
it goes through — and the server re-checks that certificate on submit, against
the goal frozen into the exercise.

This first one is the raw form. Each line is a sequent with its own context,
justified by a rule — by identifier, since this is engine text — and the labels
of the lines it uses. This proof is filled in already, so it should show its ✓
at once.

\`\`\`md
:::aufbau-proof{system="forallx" id="pf_lines" title="Distributing ∀" points="2"}
Read the proof, then submit it. Try breaking a line to see the engine complain.

theorem unidist {x: var} {a: name}: $ ∀ x (F(x) ∧ G(x)) ⊢ ∀ x F(x) $
----
l1: $ ∀ x (F(x) ∧ G(x)) ⊢ ∀ x (F(x) ∧ G(x)) $ by AS []
l2: $ ∀ x (F(x) ∧ G(x)) ⊢ F(a) ∧ G(a) $ by all_elim [l1]
l3: $ ∀ x (F(x) ∧ G(x)) ⊢ F(a) $ by and_elim_l [l2]
l4: $ ∀ x (F(x) ∧ G(x)) ⊢ ∀ x F(x) $ by all_intro [l3]
:::
\`\`\`

:::aufbau-proof{system="forallx" id="pf_lines" title="Distributing ∀" points="2"}
Read the proof, then submit it. Try breaking a line to see the engine complain.

theorem unidist {x: var} {a: name}: $ ∀ x (F(x) ∧ G(x)) ⊢ ∀ x F(x) $
----
l1: $ ∀ x (F(x) ∧ G(x)) ⊢ ∀ x (F(x) ∧ G(x)) $ by AS []
l2: $ ∀ x (F(x) ∧ G(x)) ⊢ F(a) ∧ G(a) $ by all_elim [l1]
l3: $ ∀ x (F(x) ∧ G(x)) ⊢ F(a) $ by and_elim_l [l2]
l4: $ ∀ x (F(x) ∧ G(x)) ⊢ ∀ x F(x) $ by all_intro [l3]
:::

## 13. The same proof, as a tree

\`aufbau-proof-tree\` gives a tree editor instead. The goal sits at the foot; the
student builds premises upward and names the rule under each inference bar.
Optionally seed it with a starter written in the same line form as above — the
compiler reads that back into a tree.

\`\`\`md
:::aufbau-proof-tree{system="forallx" id="pf_tree" title="Universal instantiation" points="2"}
The tree below is complete. Click a line to select it; the toolbar adds a
premise, adds a hypothesis, or deletes a subtree.

theorem treeunimp {x: var} {a: name}: $ ∀ x (F(x) → G(x)) ; F(a) ⊢ G(a) $
----
l1: $ ∀ x (F(x) → G(x)) ; F(a) ⊢ ∀ x (F(x) → G(x)) $ by AS []
l2: $ ∀ x (F(x) → G(x)) ; F(a) ⊢ F(a) $ by AS []
l3: $ ∀ x (F(x) → G(x)) ; F(a) ⊢ F(a) → G(a) $ by ∀E [l1]
l4: $ ∀ x (F(x) → G(x)) ; F(a) ⊢ G(a) $ by →E [l3, l2]
:::
\`\`\`

:::aufbau-proof-tree{system="forallx" id="pf_tree" title="Universal instantiation" points="2"}
The tree below is complete. Click a line to select it; the toolbar adds a
premise, adds a hypothesis, or deletes a subtree.

theorem treeunimp {x: var} {a: name}: $ ∀ x (F(x) → G(x)) ; F(a) ⊢ G(a) $
----
l1: $ ∀ x (F(x) → G(x)) ; F(a) ⊢ ∀ x (F(x) → G(x)) $ by AS []
l2: $ ∀ x (F(x) → G(x)) ; F(a) ⊢ F(a) $ by AS []
l3: $ ∀ x (F(x) → G(x)) ; F(a) ⊢ F(a) → G(a) $ by ∀E [l1]
l4: $ ∀ x (F(x) → G(x)) ; F(a) ⊢ G(a) $ by →E [l3, l2]
:::

## 14. The same proof, Fitch style

\`aufbau-proof-fitch\` is the shape from the book: one formula per line, a
justification after a colon, and **indentation for subproofs** — the scope lines
are drawn for you. Contexts are worked out from the indentation, so an
assumption just cites \`AS\`, and a rule that discharges one cites the subproof's
range. Rules go by their textbook names, or the ascii spellings in the table
above.

This proof uses ∃E, whose subproof assumes an instance for a fresh name. The
name may not escape into the conclusion; that side condition is checked by the
engine, not by the editor.

\`\`\`md
:::aufbau-proof-fitch{system="forallx" id="pf_fitch" title="Existential elimination" points="3"}
A worked ∃E. Re-indent line 3 and watch the scope line — and the ✓ — react.

theorem exelim {x: var} {b: name}: $ ∃ x F(x) ; ∀ x (F(x) → G(x)) ⊢ ∃ x G(x) $
----
∃ x F(x)              :AS
∀ x (F(x) → G(x))     :AS
    F(b)              :AS
    F(b) → G(b)       :∀E 2
    G(b)              :→E 4 3
    ∃ x G(x)          :∃I 5
∃ x G(x)              :∃E 1 3-6
:::
\`\`\`

:::aufbau-proof-fitch{system="forallx" id="pf_fitch" title="Existential elimination" points="3"}
A worked ∃E. Re-indent line 3 and watch the scope line — and the ✓ — react.

theorem exelim {x: var} {b: name}: $ ∃ x F(x) ; ∀ x (F(x) → G(x)) ⊢ ∃ x G(x) $
----
∃ x F(x)              :AS
∀ x (F(x) → G(x))     :AS
    F(b)              :AS
    F(b) → G(b)       :∀E 2
    G(b)              :→E 4 3
    ∃ x G(x)          :∃I 5
∃ x G(x)              :∃E 1 3-6
:::

## 15. The same proof, as a Prawitz tree

\`aufbau-proof-prawitz\` draws the fourth picture: bare formulas with their
premises above the inference line, and discharge written as a **label** rather
than as a box. This is the ∃E above again, node for node. The assumption
\`F(b)\` is bracketed and marked \`1\`, and the ∃E carries the same mark to say it
is the rule that discharges it. No context is written anywhere — each node's is
worked out from which assumptions above it are still standing, which is also
why nothing from a sibling branch can trip the ∃E's fresh-name condition.

Starter lines are the same linear form as section 12, with the discharge marks
riding as trailing \`-- label:\` comments; the context left of each \`⊢\` is
discarded on parse and re-derived from the labels, so any proof the engine
accepts is a starter this editor will open.

\`\`\`md
:::aufbau-proof-prawitz{system="forallx" id="pf_prawitz" title="Existential elimination, drawn" points="3"}
The same ∃E as a tree. Select a finished tree and apply a rule below it, or add
a premise above a line; label an assumption and repeat the label on the rule
that discharges it.

theorem exelimdrawn {x: var} {b: name}: $ ∃ x F(x) ; ∀ x (F(x) → G(x)) ⊢ ∃ x G(x) $
----
l1: $ ∃ x F(x) ⊢ ∃ x F(x) $ by AS []
l2: $ ∀ x (F(x) → G(x)) ⊢ ∀ x (F(x) → G(x)) $ by AS []
l3: $ ∀ x (F(x) → G(x)) ⊢ F(b) → G(b) $ by ∀E [l2]
l4: $ F(b) ⊢ F(b) $ by AS [] -- label:1
l5: $ ∀ x (F(x) → G(x)) ; F(b) ⊢ G(b) $ by →E [l3, l4]
l6: $ ∀ x (F(x) → G(x)) ; F(b) ⊢ ∃ x G(x) $ by ∃I [l5]
l7: $ ∃ x F(x) ; ∀ x (F(x) → G(x)) ⊢ ∃ x G(x) $ by ∃E [l1, l6] -- label:1
:::
\`\`\`

:::aufbau-proof-prawitz{system="forallx" id="pf_prawitz" title="Existential elimination, drawn" points="3"}
The same ∃E as a tree. Select a finished tree and apply a rule below it, or add
a premise above a line; label an assumption and repeat the label on the rule
that discharges it.

theorem exelimdrawn {x: var} {b: name}: $ ∃ x F(x) ; ∀ x (F(x) → G(x)) ⊢ ∃ x G(x) $
----
l1: $ ∃ x F(x) ⊢ ∃ x F(x) $ by AS []
l2: $ ∀ x (F(x) → G(x)) ⊢ ∀ x (F(x) → G(x)) $ by AS []
l3: $ ∀ x (F(x) → G(x)) ⊢ F(b) → G(b) $ by ∀E [l2]
l4: $ F(b) ⊢ F(b) $ by AS [] -- label:1
l5: $ ∀ x (F(x) → G(x)) ; F(b) ⊢ G(b) $ by →E [l3, l4]
l6: $ ∀ x (F(x) → G(x)) ; F(b) ⊢ ∃ x G(x) $ by ∃I [l5]
l7: $ ∃ x F(x) ; ∀ x (F(x) → G(x)) ⊢ ∃ x G(x) $ by ∃E [l1, l6] -- label:1
:::

## 16. Your turn

The last one is not done for you. Assume \`¬ P\` for contradiction, derive \`⊥\`
with \`¬E\`, and close the subproof with \`IP\`, citing its range.

\`\`\`md
:::aufbau-proof-fitch{system="forallx" id="pf_yours" title="Double negation" points="3"}
Show that \`¬ ¬ P\` entails \`P\`.

theorem dnetask (P: wff): $ ¬ ¬ P ⊢ P $
----
¬ ¬ P    :AS
:::
\`\`\`

:::aufbau-proof-fitch{system="forallx" id="pf_yours" title="Double negation" points="3"}
Show that \`¬ ¬ P\` entails \`P\`.

theorem dnetask (P: wff): $ ¬ ¬ P ⊢ P $
----
¬ ¬ P    :AS
:::

## 17. The same exercise, told nothing

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
:::aufbau-proof-fitch{system="forallx" id="pf_sealed" title="Double negation, sealed" points="3" feedback="none"}
Show that \`¬ ¬ P\` entails \`P\`. You will not be told whether you have.

theorem dnesealed (P: wff): $ ¬ ¬ P ⊢ P $
----
¬ ¬ P    :AS
:::
\`\`\`

:::aufbau-proof-fitch{system="forallx" id="pf_sealed" title="Double negation, sealed" points="3" feedback="none"}
Show that \`¬ ¬ P\` entails \`P\`. You will not be told whether you have.

theorem dnesealed (P: wff): $ ¬ ¬ P ⊢ P $
----
¬ ¬ P    :AS
:::

## 18. Submit as the only feedback

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

## 19. A playground

All four proof directives also take a boolean \`playground\` attribute. A
playground has no \`theorem\` line: the student builds whatever derivation they
like, and the exercise checks that every step is justified. The statement it
proves is read off the proof itself — the last line of a Fitch proof, with the
assumptions still open at it; the root of a tree or Prawitz derivation, with
its undischarged assumptions — and the widget shows it live as **Proves**. That
statement is the goal the certificate is verified against and the goal the
review page names, so a playground is scored like any other exercise. The body
is the prompt, then an optional \`----\` and a starter, as before, just without
the header. (A \`theorem\` line in a playground is an error, and a proof
exercise without \`playground\` still needs one, so a forgotten header never
turns an exercise into a playground by accident.)

\`\`\`md
:::aufbau-proof-fitch{system="forallx" id="pf_scratch" title="Fitch scratch space" playground points="1"}
Prove anything you like from these two premises, or delete them and start
somewhere else. Watch the **Proves** line follow the last line of the proof and
the assumptions still open at it.
----
∀ x (F(x) → G(x))   :AS
F(a)                :AS
:::
\`\`\`

:::aufbau-proof-fitch{system="forallx" id="pf_scratch" title="Fitch scratch space" playground points="1"}
Prove anything you like from these two premises, or delete them and start
somewhere else. Watch the **Proves** line follow the last line of the proof and
the assumptions still open at it.
----
∀ x (F(x) → G(x))   :AS
F(a)                :AS
:::

The same works in the tree and Prawitz editors, where the root is the
student's to write (and the tree editor's **Add hypothesis** is greyed out,
since there are no goal premises to cite). Here the derivation starts from a
single assumption, and the **Proves** line loses its left-hand side once that
assumption is discharged:

\`\`\`md
:::aufbau-proof-prawitz{system="forallx" id="pz_scratch" title="Prawitz scratch space" playground}
Take the assumption apart with \`∧E\` (twice), put it back together the other
way round with \`∧I\`, then discharge it with \`→I\`. Once it is discharged,
nothing is left of the turnstile in **Proves**.
----
a1: $ F(a) ∧ G(a) ⊢ F(a) ∧ G(a) $ by AS []
:::
\`\`\`

:::aufbau-proof-prawitz{system="forallx" id="pz_scratch" title="Prawitz scratch space" playground}
Take the assumption apart with \`∧E\` (twice), put it back together the other
way round with \`∧I\`, then discharge it with \`→I\`. Once it is discharged,
nothing is left of the turnstile in **Proves**.
----
a1: $ F(a) ∧ G(a) ⊢ F(a) ∧ G(a) $ by AS []
:::

The names in a playground's statement (\`a\` above, from the system's \`@vars\`
pools) are bound automatically; nothing else can be, so a playground always
proves a concrete sentence or sequent in the system's own vocabulary, never a
schema over metavariables like the \`P\` of the exercises before this one.

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
