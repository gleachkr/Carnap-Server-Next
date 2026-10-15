# Truth-tree exercise (`truth-tree@1`)

Students decide whether an argument is valid, or a set of sentences
consistent, with a truth tree (a semantic tableau), under the rules of
*forall x: UBC* (Ichikawa and Jenkins, after Magnus), identity included. The
authoring contract
is in
[`docs/carnap-markdown-v1.md`](../../../../docs/carnap-markdown-v1.md#truth-tree-directive).

## Three layers

1. **The tableau component, which knows no logic.** `src/tableau/` is its
   framework-free core (the document of nodes and rows, the edits, the
   shared-lines layout, the static markup, navigation and the key map), and
   `src/client/tableau/view.tsx` is its Preact view. A row's `cites` and
   `dev` are opaque to it; `kind` and `prefix` are there for the signed or
   world-labelled rows of a non-classical tableau. Boundary tests keep it
   free of this type and of the kit (`tests/tableau.test.ts`).
2. **The rules, as data.** `logic/system.ts` is the `TableauSystem` record:
   where a new name must be new, what closes a branch, whether a closure
   cites its rows, when a tree is done. `FORALLX_UBC` is the one record. A
   second classical textbook is a second record, selected by the stored
   `rules` field.
3. **The checker**, `logic/check.ts`, DOM-free: every row, every
   development, every branch end, and whether the tree is done. The browser
   runs it on each edit; the grader runs it again on the submitted tree.
   `logic/rules.ts` says what a row develops into. The binary connectives'
   rules are the kit's forcing sets (`exercise-kit/formula/forcing.ts`), the
   same computation the world's evaluation game makes its moves from.
   Identity (§12.7) is the checker's own: a step citing two rows, `a=b` and
   one to rewrite (the kit's `replaceName`), which develops neither; a
   branch closed by one row `a≠a`; and a completion clause asking each
   identity to be substituted one way into every literal on its branch,
   bar a rewriting that says something is itself (`b=b`), which the book's
   solutions leave out. A system record without `identity`
   refuses rows that use `=`.

## Layout

- `logic/` — `system.ts`, `rules.ts`, `check.ts`, `formulas.ts` (the
  caching row reader, and display through the language's own printer, which
  is what writes `a₁` and `a≠b`), `labels.ts` (the names a mark lists).
- `aufbau/` — the engine-checked successor to `logic/` (gh #46, in
  progress): `theory.ts` reads a tree theory's roles (the contract is in
  the authoring docs, "Writing a tree theory"), and `emit.ts` writes a tree
  down as a derivation for `@aufbau/compiler`. The directive already takes
  its calculus and root from the theory; the editor and the grader still use
  `logic/` until the engine replaces it.
- `grading.ts` — guards, the declaration resolved back to formulas, and the
  judgement: the report, and what the tree shows once it is done.
- `annotations.ts` — what the tree draws beside its rows, for both the
  server's static tree and the editor.
- `authoring.ts`, `assessment.ts`, `read-only-view.ts`, `strings.ts`,
  `verdict-text.ts` — the usual halves of a type.

The editor is `src/client/components/carnap-truth-tree-v1.tsx`.

## Answer data

`truth-tree-answer@1` is `{ nodes, rules? }`: `rules` maps a development's
`dev` to the rule its margin names (the theory's spelling of one of its
`@syntax alias`es), kept beside the document so that the document stays
logic-free; a development missing from it names no rule. `nodes` is the
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
used twice), and a tree too big to be an attempt (1000 nodes or rows, a row
of 1000 characters, 128 KiB in all). A tree past the system's `rowCap` (200
rows) is answered "too many rows" without being read, since each row costs
a parse. A prior answer whose root is not the declaration's (a correction
changed it) is set aside when the element restores, as the root cannot be
edited.

## Not yet

- Reading an interpretation off a complete open branch, merging the names
  an identity on it equates (§12.7).
- A `rules=` attribute, which arrives with a second system record.
- The language accepts two things the book forbids: `((A & B))` and
  `∀x∃xFx`.
