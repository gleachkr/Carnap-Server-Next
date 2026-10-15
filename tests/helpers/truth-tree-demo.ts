/**
 * A lesson of truth trees in *forall x: UBC*'s language and rules: one of
 * each question, a first-order tree, and identity.
 * `bun run scripts/seed-demo.ts truth-tree` seeds it onto a local dev server.
 */
export const TRUTH_TREE_DEMO_SOURCE = `# Truth trees

A truth tree tries to make every sentence at its root true at once. Each
step develops one row by its rule, citing that row, and a branch closes when
it holds a sentence and its negation. If every branch closes, nothing makes
the root true; a complete open branch describes something that does.

## Is it consistent?

::::truth-tree{#tt-consistent points="3" title="Two disjunctions"}
Use a tree to decide whether this set is consistent. Write each step's rows
yourself: **Stack** or **Split** at the end of a branch, type the sentence,
press \`Alt-C\` to cite the row it develops, and Tab to name the rule (\`∨\`,
or \`\\/\` on a keyboard without one). The \`(?)\` below lists the keys.

- (D & ¬R) ∨ Q
- ¬Q ∨ R
::::

## Is it valid?

::::truth-tree{#tt-valid points="3" title="A conditional chain"}
Use a tree to decide whether this argument is valid. The root is the
premises and the negation of the conclusion.

P ⊃ Q, Q ⊃ R :|-: P ⊃ R
::::

## A first-order tree

::::truth-tree{#tt-quantifiers points="3" title="Everything and something"}
An existential sentence takes a name new to its branch, and a universal one
takes any name, as many times as the branch needs.

∀x(Fx ⊃ Gx), ∃xFx :|-: ∃xGx
::::

## Identity

::::truth-tree{#tt-identity points="3" title="Everything is a"}
If everything is \`a\`, can something differ from \`a\`? An identity
\`a=b\` lets any row on its branch be rewritten with every \`a\` made
\`b\`, or every \`b\` made \`a\`: cite both rows, as \`3, 4\`. A row
\`a≠a\` closes a branch by itself.

- ∀x a = x
- ∃x x ≠ a
::::
`;
