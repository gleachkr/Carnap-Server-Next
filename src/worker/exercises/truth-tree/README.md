# Truth-tree exercise (`truth-tree@1`)

Students decide whether an argument is valid, or a set of sentences
consistent, with a truth tree (a semantic tableau), under the rules of the
theory `system=` names: *forall x: UBC* (Ichikawa and Jenkins, after
Magnus), identity included, by default, or the Open Logic Project's signed
tableaux (`open-logic-tableaux`, rows `𝕋 A` and `𝔽 A`), prefixed tableaux
for K and the logics past it (`open-logic-modal-k` through
`open-logic-modal-s5`, rows `1.1 𝕋 A`), simplified tableaux for S5
(`open-logic-simple-s5`, rows `2 𝕋 A`), and prefixed tableaux for
intuitionistic logic (`open-logic-intuitionistic`). The authoring contract is in
[`docs/carnap-markdown-v1.md`](../../../../docs/carnap-markdown-v1.md#truth-tree-directive).

## Two layers

1. **The tableau component, which knows no logic.** `src/tableau/` is its
   framework-free core (the document of nodes and rows, the edits, the
   shared-lines layout, the static markup, navigation and the key map), and
   `src/client/tableau/view.tsx` is its Preact view. A row's `cites` and
   `dev` are opaque to it; `kind` and `prefix` are there for the signed or
   world-labelled rows of a non-classical tableau. Boundary tests keep it
   free of this type and of the kit (`tests/tableau.test.ts`).
2. **The judgement, from the theory.** A tree's rules are the theory's:
   `system=` names an MM0 file whose `@syntax role tree.*` annotations say
   what a row is, what closes a branch, and what each axiom develops, and
   the engine checks every step and closure as a derivation. The browser
   judges on each edit; the grader judges again on the submitted tree. There
   is no rule table on this side: a second textbook is a second theory.

## Layout

- `aufbau/` — the engine's half (gh #46): `theory.ts` reads a tree theory's
  roles (the contract is in the authoring docs, "Writing a tree theory"),
  `rows.ts` reads rows at its row sort, `emit.ts` writes each step and
  closure down as a theorem for `@aufbau/compiler`, and `judge.ts` makes the
  report from the tree's structure and the engine's word on it. The root is
  the exercise's, by count: a row below it with no citation is an unfinished
  step, unless its rule cites no row (Cut, the Open Logic Project's `=`),
  which focuses on the join's unit, the empty branch. The browser
  compiles the theorems; the server writes the same theorems from the stored
  tree and verifies the browser's certificate against them, so a certificate
  for any other tree does not verify. A branch is a multiset (the join is
  `@acui` without idempotence), so a step's rows must be, one for one, what
  its rule writes: a row already on the branch neither stands in for one
  the step leaves out nor hides one it should not write (`A ∧ B` developed
  as `A` alone, or as `A, A`, with `B` above; `∀x Fx` developed as `Fa, Ga`
  with `Ga` above). A rule that writes one row twice must be written so:
  `A ∧ A` develops as `A, A`. A tree with nothing to state, its root
  alone and no branch marked open, has nothing to certify. `criteria.ts` reads the theory's
  development roles into a registry of criteria (`once`, `general`, `pairs`,
  `none`), `patterns.ts` matches a rule's focus against a row and fills in
  its templates, `marks.ts` says from the steps what each row's mark is,
  and `branch.ts` reads what Carnap reads of a branch itself: the rows that
  would close it, which no theorem can say, and which rows are literals.
  A theory whose rules write no check marks (the Open Logic Project's) counts
  a row developed when its rule's conclusions are on the branch, however
  they got there; counted by steps, S5's `4r□` would owe a row back to a
  prefix that has it, and each copy would owe the same again. A rule may name side
  rows in its branch, a witness on the branch the student does not cite
  (`□𝕋` wants its prefix used); a general criterion over such a rule is
  owed the instances its side rows find, not every term of the sort, and an
  instance that means nothing alone (a prefix's last step) is shown as the
  row's argument it is in (`1.1`). `patterns.ts` also matches modulo a list,
  a constructor the theory declares associative with a unit and nothing
  more (`@acui assoc _ unit _`): a metavariable of its sort stands for any
  run of members, so intuitionistic `→𝕋`'s side row at `σ . ρ` finds `σ` and
  every prefix that extends it, and terms are compared, and instances
  proposed, as lists. A list can match more than one way, so `matchAll`
  gives every way, and a rule's rows are matched together (`ruleMatches`):
  a closure written `σ . ρ 𝔽 A ; σ 𝕋 A` finds `σ` from either row. With `tree.substitution` on its substitution term,
  `patterns.ts` matches `{x / te} ph` as the substitution it denotes, which
  is what lets UBC's identity rule (`tree.development.pairs`) be owed one
  rewriting of each literal on its branch. A rule may write check marks
  on its branches (`tree.mark`, `tree.mark.instance`, UBC's `✓ ρ` and
  `✓ᵢ ρ ↦ ψ`): the pattern reader sets them aside as not rows
  (`RulePatterns.marks`), and the emitter writes the ones a step's rule
  names beside its rows, so the engine checks them as it checks the rows.
  `ok.ts` states, from the rules, when a row is developed: `tree_ok ρ Γ`,
  one axiom per way a rule leaves ρ developed (its mark on Γ, or by
  contents a premise's rows), `tree_okat_<rule> ρ t Γ` for a general
  row at t, and `tree_okwith_<rule> ρ σ Γ` for a general row whose rule
  has side rows, at the side rows σ that witness it (`□𝕋`'s row at a
  prefix the branch uses). Rows no rule develops get an axiom asking nothing, found by
  complement over the constructors, so a rule whose axiom cannot be stated
  leaves its rows visibly undeveloped. `developed.ts` asks them of each
  branch marked open, and the emitter states what it asks: one theorem per
  row that it is developed, and one per general row and term of its instance's sort on the branch (with a new
  name where a `nonempty` row's branch has none), or, for a rule with side
  rows, each witness Carnap finds on the branch, and for each identity
  (`pairs`) each row it pairs with, by `tree_okpair_<statement>`, with the
  bindings Carnap's matcher found as a hint (`ph := $ F x c $`, the partner
  with every `b` made `x`, which the rule's own dependencies keep honest).
  An identity is developed one way round for every row it pairs with, so
  the browser asks both statements, keeps the one refused least, and the
  answer stores it (`directions`, by leaf and row); the server states only
  that one. Each is stated with the rows
  the row's own steps wrote last, where the engine finds them without
  sorting the branch. A theorem the engine cannot prove is what the branch
  is missing, and a certificate proves the branches marked open complete,
  so the server needs nothing else (#469). What the axioms cannot state is
  an author's diagnostic. A general step's
  instances are link theorems: the emitter states that a row is its rule's
  template at a given term, which the engine proves only if it is. The
  browser compiles every candidate once to find which hold, and that compile
  gives the verdict; the derivation stating only the ones that hold is
  compiled for the certificate when the student submits, so typing pays for
  one compile, not two. The answer carries them (`instances`), and the
  server writes the same links. A tree past the row cap is not compiled.
- `report.ts` — the report the judge makes: each row's and end's problem,
  each branch's state, each row's mark. `labels.ts` spells a mark's
  instances in the language (`✓a₁`, `\1.1,1.2`).
- `grading.ts` — guards, the declaration resolved back to its theory, and
  the judgement: the report, and what the tree shows once it is done.
- `ask.ts` — asking the engine, for the editor and the tests alike: the
  derivation stating every candidate, and what its compile says (the
  instances and directions that held, the steps' errors, and the
  derivation still owed a compile for the certificate).
- `annotations.ts` — what the tree draws beside its rows, for both the
  server's static tree and the editor.
- `authoring.ts`, `assessment.ts`, `read-only-view.ts`, `strings.ts`,
  `verdict-text.ts` — the usual halves of a type.

The editor is `src/client/components/carnap-truth-tree-v1.tsx`.

## Answer data

`truth-tree-answer@1` is `{ nodes, rules?, instances?, directions? }`:
`rules` maps a
development's `dev` to the rule its margin names (the theory's spelling of
one of its `@syntax alias`es), kept beside the document so that the document
stays logic-free; a development missing from it names no rule. `instances`
maps a row of a general step to the term it was written with, as engine text
(`a` for `Fa` from `∀x Fx`): the browser finds it by asking the engine, and
the certificate proves it. `directions` maps an identity on a branch marked
open, keyed `"<leaf id> <row id>"`, to the statement of its rule it is
developed by (`tb_id_ba`, every `b` made `a`); one with none is asked by
the rule's own, and the certificate proves the branch developed in it.
`nodes` is the
tableau document: each node a run
of rows with its parent (`null` for the root) and an optional `end`,
`{ type: "closed", cites }` or `{ type: "open" }`. A row is
`{ id, text, cites, dev }`: its text as typed, the row ids it develops, and
the development it belongs to. The root
node's first rows must be the declared root. Ids are editing handles: the
editor remints them when it restores a tree, and citations follow.

The student is not asked what the tree shows: a done tree already says, and
a lesson that wants the question asked sets a multiple-choice exercise beside
it.

A bad tree is a valid wrong answer, scored zero with the first problem;
only JSON that is not a tree is refused. "Not a tree" includes nodes that do
not form one (the root first, each node after its parent, no node or row id
used twice, each development one run of rows, or the first run of each
branch of one split), rules, instances or directions keyed by a
development, row or leaf and row the tree does not have, and a tree too big to be an attempt (1000 nodes or rows,
a row of 1000 characters, 128 KiB in all). A tree past `TREE_ROW_CAP` (200
rows) is answered "too many rows" without being read, since each row costs
a parse; one whose theorems would state more than `TREE_TEXT_CAP` (4
million characters) is answered "too large to check" without being
compiled, since each step restates its branch: 190 rows of long sentences
on one branch would state 35 MB. A prior answer whose root is not the declaration's (a correction
changed it) is set aside when the element restores, as the root cannot be
edited.

The certificate rides beside the answer and is not stored. A tree's may be
up to 8 MiB of base64, far past the proof types' 256 KiB: each step restates
its branch, and a first-order step carries its instance's normalization
through the whole branch, so a 48-row first-order branch certifies in 3.3 MB.
Verifying 5 MB takes about 50 ms in workerd, decoding included.

## Not yet

- Reading an interpretation off a complete open branch, merging the names
  an identity on it equates (§12.7).
- The language accepts two things the book forbids: `((A & B))` and
  `∀x∃xFx`.
