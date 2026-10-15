/**
 * The worked tableaux of the Open Logic Project's first-order chapter,
 * github.com/OpenLogicProject/OpenLogic master 1e960be (2026-08-14), CC BY
 * 4.0, read from `content/first-order-logic/tableaux` and
 * `proof-systems/tableaux.tex`: each tree's last stage, where the book builds
 * one up over several displays, and none of the schematic ones (`\vdots`).
 *
 * A row is as the book writes it, in `open-logic-tableaux`'s syntax. `by` and
 * `cites` are its justification (`\TRule{\True}{\land}[2]` is `∧𝕋` citing
 * line 2), absent on an assumption; a line is a row's depth, so it names one
 * row on each branch. `closed` is the book's `close` on a branch's last row.
 * The book's closures cite nothing.
 */

export interface OlpTableauRow {
  readonly row: string;
  readonly by?: string;
  readonly cites?: readonly number[];
  readonly closed?: true;
  readonly children?: readonly OlpTableauRow[];
}

export interface OlpTableau {
  readonly from: string;
  readonly tree: OlpTableauRow;
}

export const OLP_FIRST_ORDER_TABLEAUX: readonly OlpTableau[] = [
  {
    from: "tableaux/derivations.tex #3",
    tree: {
      row: "𝕋 A ∧ ¬ A",
      children: [
        {
          row: "𝕋 A",
          by: "∧𝕋",
          cites: [1],
          children: [
            {
              row: "𝕋 ¬ A",
              by: "∧𝕋",
              cites: [1],
              children: [{ row: "𝔽 A", by: "¬𝕋", cites: [3], closed: true }],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/identity.tex #1",
    tree: {
      row: "𝔽 A(t)",
      children: [
        {
          row: "𝕋 s = t",
          children: [
            {
              row: "𝕋 A(s)",
              children: [
                { row: "𝕋 A(t)", by: "=𝕋", cites: [2, 3], closed: true },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/identity.tex #2",
    tree: {
      row: "𝔽 s₂ = s₁",
      children: [
        {
          row: "𝕋 s₁ = s₂",
          children: [
            {
              row: "𝕋 s₁ = s₁",
              by: "=",
              cites: [],
              children: [
                { row: "𝕋 s₂ = s₁", by: "=𝕋", cites: [2, 3], closed: true },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/identity.tex #3",
    tree: {
      row: "𝔽 s₁ = s₃",
      children: [
        {
          row: "𝕋 s₁ = s₂",
          children: [
            {
              row: "𝕋 s₂ = s₃",
              children: [
                { row: "𝕋 s₁ = s₃", by: "=𝕋", cites: [3, 2], closed: true },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/proof-theoretic-notions.tex #1",
    tree: { row: "𝔽 A", children: [{ row: "𝕋 A", closed: true }] },
  },
  {
    from: "tableaux/provability-propositional.tex #1",
    tree: {
      row: "𝔽 A",
      children: [
        {
          row: "𝕋 A ∧ B",
          children: [
            {
              row: "𝕋 A",
              by: "∧𝕋",
              cites: [2],
              children: [{ row: "𝕋 B", by: "∧𝕋", cites: [2], closed: true }],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/provability-propositional.tex #2",
    tree: {
      row: "𝔽 B",
      children: [
        {
          row: "𝕋 A ∧ B",
          children: [
            {
              row: "𝕋 A",
              by: "∧𝕋",
              cites: [2],
              children: [{ row: "𝕋 B", by: "∧𝕋", cites: [2], closed: true }],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/provability-propositional.tex #3",
    tree: {
      row: "𝔽 A ∧ B",
      children: [
        {
          row: "𝕋 A",
          children: [
            {
              row: "𝕋 B",
              children: [
                { row: "𝔽 A", by: "∧𝔽", cites: [1], closed: true },
                { row: "𝔽 B", by: "∧𝔽", cites: [1], closed: true },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/provability-propositional.tex #4",
    tree: {
      row: "𝕋 A ∨ B",
      children: [
        {
          row: "𝕋 ¬ A",
          children: [
            {
              row: "𝕋 ¬ B",
              children: [
                {
                  row: "𝔽 A",
                  by: "¬𝕋",
                  cites: [2],
                  children: [
                    {
                      row: "𝔽 B",
                      by: "¬𝕋",
                      cites: [3],
                      children: [
                        { row: "𝕋 A", by: "∨𝕋", cites: [1], closed: true },
                        { row: "𝕋 B", by: "∨𝕋", cites: [1], closed: true },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/provability-propositional.tex #5",
    tree: {
      row: "𝔽 A ∨ B",
      children: [
        {
          row: "𝕋 A",
          children: [
            {
              row: "𝔽 A",
              by: "∨𝔽",
              cites: [1],
              children: [{ row: "𝔽 B", by: "∨𝔽", cites: [1], closed: true }],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/provability-propositional.tex #6",
    tree: {
      row: "𝔽 A ∨ B",
      children: [
        {
          row: "𝕋 B",
          children: [
            {
              row: "𝔽 A",
              by: "∨𝔽",
              cites: [1],
              children: [{ row: "𝔽 B", by: "∨𝔽", cites: [1], closed: true }],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/provability-propositional.tex #7",
    tree: {
      row: "𝔽 B",
      children: [
        {
          row: "𝕋 A → B",
          children: [
            {
              row: "𝕋 A",
              children: [
                { row: "𝔽 A", by: "→𝕋", cites: [2], closed: true },
                { row: "𝕋 B", by: "→𝕋", cites: [2], closed: true },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/provability-propositional.tex #8",
    tree: {
      row: "𝔽 A → B",
      children: [
        {
          row: "𝕋 ¬ A",
          children: [
            {
              row: "𝕋 A",
              by: "→𝔽",
              cites: [1],
              children: [
                {
                  row: "𝔽 B",
                  by: "→𝔽",
                  cites: [1],
                  children: [
                    { row: "𝔽 A", by: "¬𝕋", cites: [2], closed: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/provability-propositional.tex #9",
    tree: {
      row: "𝔽 A → B",
      children: [
        {
          row: "𝕋 B",
          children: [
            {
              row: "𝕋 A",
              by: "→𝔽",
              cites: [1],
              children: [{ row: "𝔽 B", by: "→𝔽", cites: [1], closed: true }],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/provability-quantifiers.tex #3",
    tree: {
      row: "𝔽 ∃x A(x)",
      children: [
        {
          row: "𝕋 A(t)",
          children: [{ row: "𝔽 A(t)", by: "∃𝔽", cites: [1], closed: true }],
        },
      ],
    },
  },
  {
    from: "tableaux/provability-quantifiers.tex #4",
    tree: {
      row: "𝔽 A(t)",
      children: [
        {
          row: "𝕋 ∀x A(x)",
          children: [{ row: "𝕋 A(t)", by: "∀𝕋", cites: [2], closed: true }],
        },
      ],
    },
  },
  {
    from: "tableaux/proving-things-quant.tex #5",
    tree: {
      row: "𝔽 ∃x ¬ A(x) → ¬ ∀x A(x)",
      children: [
        {
          row: "𝕋 ∃x ¬ A(x)",
          by: "→𝔽",
          cites: [1],
          children: [
            {
              row: "𝔽 ¬ ∀x A(x)",
              by: "→𝔽",
              cites: [1],
              children: [
                {
                  row: "𝕋 ¬ A(a)",
                  by: "∃𝕋",
                  cites: [2],
                  children: [
                    {
                      row: "𝕋 ∀x A(x)",
                      by: "¬𝔽",
                      cites: [3],
                      children: [
                        {
                          row: "𝔽 A(a)",
                          by: "¬𝕋",
                          cites: [4],
                          children: [
                            {
                              row: "𝕋 A(a)",
                              by: "∀𝕋",
                              cites: [5],
                              closed: true,
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/proving-things-quant.tex #10",
    tree: {
      row: "𝔽 ∃x C(x,b)",
      children: [
        {
          row: "𝕋 ∃x (A(x) ∧ B(x))",
          children: [
            {
              row: "𝕋 ∀x (B(x) → C(x,b))",
              children: [
                {
                  row: "𝕋 A(a) ∧ B(a)",
                  by: "∃𝕋",
                  cites: [2],
                  children: [
                    {
                      row: "𝔽 C(a,b)",
                      by: "∃𝔽",
                      cites: [1],
                      children: [
                        {
                          row: "𝕋 B(a) → C(a,b)",
                          by: "∀𝕋",
                          cites: [3],
                          children: [
                            {
                              row: "𝕋 A(a)",
                              by: "∧𝕋",
                              cites: [4],
                              children: [
                                {
                                  row: "𝕋 B(a)",
                                  by: "∧𝕋",
                                  cites: [4],
                                  children: [
                                    {
                                      row: "𝔽 B(a)",
                                      by: "→𝕋",
                                      cites: [6],
                                      closed: true,
                                    },
                                    {
                                      row: "𝕋 C(a,b)",
                                      by: "→𝕋",
                                      cites: [6],
                                      closed: true,
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/proving-things-quant.tex #15",
    tree: {
      row: "𝕋 ∀x A(x)",
      children: [
        {
          row: "𝕋 ∀x A(x) → ∃y B(y)",
          children: [
            {
              row: "𝕋 ¬ ∃y B(y)",
              children: [
                {
                  row: "𝔽 ∃y B(y)",
                  by: "¬𝕋",
                  cites: [3],
                  children: [
                    {
                      row: "𝔽 ∀x A(x)",
                      by: "→𝕋",
                      cites: [2],
                      children: [
                        {
                          row: "𝔽 A(b)",
                          by: "∀𝔽",
                          cites: [5],
                          children: [
                            {
                              row: "𝕋 A(b)",
                              by: "∀𝕋",
                              cites: [1],
                              closed: true,
                            },
                          ],
                        },
                      ],
                    },
                    {
                      row: "𝕋 ∃y B(y)",
                      by: "→𝕋",
                      cites: [2],
                      children: [
                        {
                          row: "𝕋 B(c)",
                          by: "∃𝕋",
                          cites: [5],
                          children: [
                            {
                              row: "𝔽 B(c)",
                              by: "∃𝔽",
                              cites: [4],
                              closed: true,
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/proving-things.tex #3",
    tree: {
      row: "𝔽 (A ∧ B) → A",
      children: [
        {
          row: "𝕋 A ∧ B",
          by: "→𝔽",
          cites: [1],
          children: [
            {
              row: "𝔽 A",
              by: "→𝔽",
              cites: [1],
              children: [
                {
                  row: "𝕋 A",
                  by: "∧𝕋",
                  cites: [2],
                  children: [
                    { row: "𝕋 B", by: "∧𝕋", cites: [2], closed: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/proving-things.tex #8",
    tree: {
      row: "𝔽 ( ¬ A ∨ B) → (A → B)",
      children: [
        {
          row: "𝕋 ¬ A ∨ B",
          by: "→𝔽",
          cites: [1],
          children: [
            {
              row: "𝔽 (A → B)",
              by: "→𝔽",
              cites: [1],
              children: [
                {
                  row: "𝕋 ¬ A",
                  by: "∨𝕋",
                  cites: [2],
                  children: [
                    {
                      row: "𝕋 A",
                      by: "→𝔽",
                      cites: [3],
                      children: [
                        {
                          row: "𝔽 B",
                          by: "→𝔽",
                          cites: [3],
                          children: [
                            {
                              row: "𝔽 A",
                              by: "¬𝕋",
                              cites: [4],
                              closed: true,
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  row: "𝕋 B",
                  by: "∨𝕋",
                  cites: [2],
                  children: [
                    {
                      row: "𝕋 A",
                      by: "→𝔽",
                      cites: [3],
                      children: [
                        { row: "𝔽 B", by: "→𝔽", cites: [3], closed: true },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/proving-things.tex #13",
    tree: {
      row: "𝕋 A ∨ (B ∧ C)",
      children: [
        {
          row: "𝔽 (A ∨ B) ∧ (A ∨ C)",
          children: [
            {
              row: "𝕋 A",
              by: "∨𝕋",
              cites: [1],
              children: [
                {
                  row: "𝔽 A ∨ B",
                  by: "∧𝔽",
                  cites: [2],
                  children: [
                    {
                      row: "𝔽 A",
                      by: "∨𝔽",
                      cites: [4],
                      children: [
                        { row: "𝔽 B", by: "∨𝔽", cites: [4], closed: true },
                      ],
                    },
                  ],
                },
                {
                  row: "𝔽 A ∨ C",
                  by: "∧𝔽",
                  cites: [2],
                  children: [
                    {
                      row: "𝔽 A",
                      by: "∨𝔽",
                      cites: [4],
                      children: [
                        { row: "𝔽 C", by: "∨𝔽", cites: [4], closed: true },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              row: "𝕋 B ∧ C",
              by: "∨𝕋",
              cites: [1],
              children: [
                {
                  row: "𝔽 A ∨ B",
                  by: "∧𝔽",
                  cites: [2],
                  children: [
                    {
                      row: "𝔽 A",
                      by: "∨𝔽",
                      cites: [4],
                      children: [
                        {
                          row: "𝔽 B",
                          by: "∨𝔽",
                          cites: [4],
                          children: [
                            {
                              row: "𝕋 B",
                              by: "∧𝕋",
                              cites: [3],
                              children: [
                                {
                                  row: "𝕋 C",
                                  by: "∧𝕋",
                                  cites: [3],
                                  closed: true,
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  row: "𝔽 A ∨ C",
                  by: "∧𝔽",
                  cites: [2],
                  children: [
                    {
                      row: "𝔽 A",
                      by: "∨𝔽",
                      cites: [4],
                      children: [
                        {
                          row: "𝔽 C",
                          by: "∨𝔽",
                          cites: [4],
                          children: [
                            {
                              row: "𝕋 B",
                              by: "∧𝕋",
                              cites: [3],
                              children: [
                                {
                                  row: "𝕋 C",
                                  by: "∧𝕋",
                                  cites: [3],
                                  closed: true,
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/proving-things.tex #14",
    tree: {
      row: "𝕋 A ∨ (B ∧ C)",
      children: [
        {
          row: "𝔽 (A ∨ B) ∧ (A ∨ C)",
          children: [
            {
              row: "𝔽 A ∨ B",
              by: "∧𝔽",
              cites: [2],
              children: [
                {
                  row: "𝔽 A",
                  by: "∨𝔽",
                  cites: [3],
                  children: [
                    {
                      row: "𝔽 B",
                      by: "∨𝔽",
                      cites: [3],
                      children: [
                        { row: "𝕋 A", by: "∨𝕋", cites: [1], closed: true },
                        {
                          row: "𝕋 B ∧ C",
                          by: "∨𝕋",
                          cites: [1],
                          children: [
                            {
                              row: "𝕋 B",
                              by: "∧𝕋",
                              cites: [6],
                              children: [
                                {
                                  row: "𝕋 C",
                                  by: "∧𝕋",
                                  cites: [6],
                                  closed: true,
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              row: "𝔽 A ∨ C",
              by: "∧𝔽",
              cites: [2],
              children: [
                {
                  row: "𝔽 A",
                  by: "∨𝔽",
                  cites: [3],
                  children: [
                    {
                      row: "𝔽 C",
                      by: "∨𝔽",
                      cites: [3],
                      children: [
                        { row: "𝕋 A", by: "∨𝕋", cites: [1], closed: true },
                        {
                          row: "𝕋 B ∧ C",
                          by: "∨𝕋",
                          cites: [1],
                          children: [
                            {
                              row: "𝕋 B",
                              by: "∧𝕋",
                              cites: [6],
                              children: [
                                {
                                  row: "𝕋 C",
                                  by: "∧𝕋",
                                  cites: [6],
                                  closed: true,
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "tableaux/quantifier-rules.tex #1",
    tree: {
      row: "𝔽 ∃x A(x) → ∀x A(x)",
      children: [
        {
          row: "𝕋 ∃x A(x)",
          by: "→𝔽",
          cites: [1],
          children: [
            {
              row: "𝔽 ∀x A(x)",
              by: "→𝔽",
              cites: [1],
              children: [
                {
                  row: "𝕋 A(a)",
                  by: "∃𝕋",
                  cites: [2],
                  children: [
                    { row: "𝔽 A(a)", by: "∀𝔽", cites: [3], closed: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "proof-systems/tableaux.tex #1",
    tree: {
      row: "𝔽 (A ∧ B) → A",
      children: [
        {
          row: "𝕋 A ∧ B",
          by: "→𝔽",
          cites: [1],
          children: [
            {
              row: "𝔽 A",
              by: "→𝔽",
              cites: [1],
              children: [
                {
                  row: "𝕋 A",
                  by: "→𝕋",
                  cites: [2],
                  children: [
                    { row: "𝕋 B", by: "→𝕋", cites: [2], closed: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
];
