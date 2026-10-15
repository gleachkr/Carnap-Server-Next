/**
 * The worked tableaux of the Open Logic Project's tableaux for K,
 * github.com/OpenLogicProject/OpenLogic master 1e960be (2026-08-14), CC BY
 * 4.0, read from `content/normal-modal-logic/tableaux` (`rules-for-K`,
 * `proofs-in-K`, `countermodels`): each tree's last stage, where the book
 * builds one up over several displays.
 *
 * As `./olp-first-order-tableaux.ts`, whose types these are: a row is as the
 * book writes it, prefix first, in `open-logic-modal-k`'s syntax.
 */

import type { OlpTableau } from "./olp-first-order-tableaux";

export const OLP_MODAL_K_TABLEAUX: readonly OlpTableau[] = [
  {
    from: "rules-for-K.tex #1",
    tree: {
      row: "1 𝕋 □A",
      children: [
        {
          row: "1 𝔽 ¬□¬A",
          children: [
            {
              row: "1.1 𝕋 A",
              by: "□𝕋",
              cites: [1],
              children: [
                {
                  row: "1 𝕋 □¬A",
                  by: "¬𝔽",
                  cites: [2],
                  children: [
                    {
                      row: "1.1 𝕋 ¬A",
                      by: "□𝕋",
                      cites: [4],
                      children: [
                        {
                          row: "1.1 𝔽 A",
                          by: "¬𝕋",
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
  },
  {
    from: "rules-for-K.tex #2",
    tree: {
      row: "1 𝕋 ¬◇¬A",
      children: [
        {
          row: "1 𝔽 ◇A",
          children: [
            {
              row: "1.1 𝔽 A",
              by: "◇𝔽",
              cites: [2],
              children: [
                {
                  row: "1 𝔽 ◇¬A",
                  by: "¬𝕋",
                  cites: [1],
                  children: [
                    {
                      row: "1.1 𝔽 ¬A",
                      by: "◇𝔽",
                      cites: [4],
                      children: [
                        {
                          row: "1.1 𝕋 A",
                          by: "¬𝕋",
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
  },
  {
    from: "rules-for-K.tex #3",
    tree: {
      row: "1 𝕋 □A",
      children: [
        {
          row: "1 𝔽 ◇A",
          children: [
            {
              row: "1.1 𝕋 A",
              by: "□𝕋",
              cites: [1],
              children: [
                {
                  row: "1.1 𝔽 A",
                  by: "◇𝔽",
                  cites: [2],
                  closed: true,
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "rules-for-K.tex #4",
    tree: {
      row: "1 𝕋 ¬□¬A",
      children: [
        {
          row: "1 𝔽 □A",
          children: [
            {
              row: "1.1 𝔽 A",
              by: "□𝕋",
              cites: [2],
              children: [
                {
                  row: "1 𝔽 □¬A",
                  by: "¬𝕋",
                  cites: [1],
                  children: [
                    {
                      row: "1.1 𝔽 ¬A",
                      by: "□𝔽",
                      cites: [4],
                      children: [
                        {
                          row: "1.1 𝕋 A",
                          by: "¬𝔽",
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
  },
  {
    from: "rules-for-K.tex #5",
    tree: {
      row: "1 𝕋 ◇A",
      children: [
        {
          row: "1 𝔽 ¬◇¬A",
          children: [
            {
              row: "1.1 𝕋 A",
              by: "◇𝕋",
              cites: [1],
              children: [
                {
                  row: "1 𝕋 ◇¬A",
                  by: "¬𝔽",
                  cites: [2],
                  children: [
                    {
                      row: "1.1 𝕋 ¬A",
                      by: "◇𝕋",
                      cites: [4],
                      children: [
                        {
                          row: "1.1 𝔽 A",
                          by: "¬𝕋",
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
  },
  {
    from: "rules-for-K.tex #6",
    tree: {
      row: "1 𝕋 ◇A",
      children: [
        {
          row: "1 𝔽 □A",
          children: [
            {
              row: "1.1 𝕋 A",
              by: "◇𝕋",
              cites: [1],
              children: [
                {
                  row: "1.1 𝔽 A",
                  by: "□𝔽",
                  cites: [2],
                  closed: true,
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    from: "proofs-in-K.tex #1",
    tree: {
      row: "1 𝔽 (□A ∧ □B) → □(A ∧ B)",
      children: [
        {
          row: "1 𝕋 □A ∧ □B",
          by: "→𝔽",
          cites: [1],
          children: [
            {
              row: "1 𝔽 □(A ∧ B)",
              by: "→𝔽",
              cites: [1],
              children: [
                {
                  row: "1 𝕋 □A",
                  by: "∧𝕋",
                  cites: [2],
                  children: [
                    {
                      row: "1 𝕋 □B",
                      by: "∧𝕋",
                      cites: [2],
                      children: [
                        {
                          row: "1.1 𝔽 A ∧ B",
                          by: "□𝔽",
                          cites: [3],
                          children: [
                            {
                              row: "1.1 𝔽 A",
                              by: "∧𝔽",
                              cites: [6],
                              children: [
                                {
                                  row: "1.1 𝕋 A",
                                  by: "□𝕋",
                                  cites: [4],
                                  closed: true,
                                },
                              ],
                            },
                            {
                              row: "1.1 𝔽 B",
                              by: "∧𝔽",
                              cites: [6],
                              children: [
                                {
                                  row: "1.1 𝕋 B",
                                  by: "□𝕋",
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
      ],
    },
  },
  {
    from: "proofs-in-K.tex #2",
    tree: {
      row: "1 𝔽 ◇(A ∨ B) → (◇A ∨ ◇B)",
      children: [
        {
          row: "1 𝕋 ◇(A ∨ B)",
          by: "→𝔽",
          cites: [1],
          children: [
            {
              row: "1 𝔽 ◇A ∨ ◇B",
              by: "→𝔽",
              cites: [1],
              children: [
                {
                  row: "1 𝔽 ◇A",
                  by: "∨𝔽",
                  cites: [3],
                  children: [
                    {
                      row: "1 𝔽 ◇B",
                      by: "∨𝔽",
                      cites: [3],
                      children: [
                        {
                          row: "1.1 𝕋 A ∨ B",
                          by: "◇𝕋",
                          cites: [2],
                          children: [
                            {
                              row: "1.1 𝕋 A",
                              by: "∨𝕋",
                              cites: [6],
                              children: [
                                {
                                  row: "1.1 𝔽 A",
                                  by: "◇𝔽",
                                  cites: [4],
                                  closed: true,
                                },
                              ],
                            },
                            {
                              row: "1.1 𝕋 B",
                              by: "∨𝕋",
                              cites: [6],
                              children: [
                                {
                                  row: "1.1 𝔽 B",
                                  by: "◇𝔽",
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
      ],
    },
  },
  {
    from: "countermodels.tex #3",
    tree: {
      row: "1 𝔽 □(p ∨ q) → (□p ∨ □q)",
      children: [
        {
          row: "1 𝕋 □(p ∨ q)",
          by: "→𝔽",
          cites: [1],
          children: [
            {
              row: "1 𝔽 □p ∨ □q",
              by: "→𝔽",
              cites: [1],
              children: [
                {
                  row: "1 𝔽 □p",
                  by: "∨𝔽",
                  cites: [3],
                  children: [
                    {
                      row: "1 𝔽 □q",
                      by: "∨𝔽",
                      cites: [3],
                      children: [
                        {
                          row: "1.1 𝔽 p",
                          by: "□𝔽",
                          cites: [4],
                          children: [
                            {
                              row: "1.2 𝔽 q",
                              by: "□𝔽",
                              cites: [5],
                              children: [
                                {
                                  row: "1.1 𝕋 p ∨ q",
                                  by: "□𝕋",
                                  cites: [2],
                                  children: [
                                    {
                                      row: "1.2 𝕋 p ∨ q",
                                      by: "□𝕋",
                                      cites: [2],
                                      children: [
                                        {
                                          row: "1.1 𝕋 p",
                                          by: "∨𝕋",
                                          cites: [8],
                                          closed: true,
                                        },
                                        {
                                          row: "1.1 𝕋 q",
                                          by: "∨𝕋",
                                          cites: [8],
                                          children: [
                                            {
                                              row: "1.2 𝕋 p",
                                              by: "∨𝕋",
                                              cites: [9],
                                            },
                                            {
                                              row: "1.2 𝕋 q",
                                              by: "∨𝕋",
                                              cites: [9],
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
          ],
        },
      ],
    },
  },
  {
    from: "countermodels.tex #6",
    tree: {
      row: "1 𝔽 (◇p ∧ ◇q) → ◇(p ∧ q)",
      children: [
        {
          row: "1 𝕋 ◇p ∧ ◇q",
          by: "→𝔽",
          cites: [1],
          children: [
            {
              row: "1 𝔽 ◇(p ∧ q)",
              by: "→𝔽",
              cites: [1],
              children: [
                {
                  row: "1 𝕋 ◇p",
                  by: "∧𝕋",
                  cites: [2],
                  children: [
                    {
                      row: "1 𝕋 ◇q",
                      by: "∧𝕋",
                      cites: [2],
                      children: [
                        {
                          row: "1.1 𝕋 p",
                          by: "◇𝕋",
                          cites: [4],
                          children: [
                            {
                              row: "1.2 𝕋 q",
                              by: "◇𝕋",
                              cites: [5],
                              children: [
                                {
                                  row: "1.1 𝔽 p ∧ q",
                                  by: "◇𝔽",
                                  cites: [3],
                                  children: [
                                    {
                                      row: "1.2 𝔽 p ∧ q",
                                      by: "◇𝔽",
                                      cites: [3],
                                      children: [
                                        {
                                          row: "1.1 𝔽 p",
                                          by: "∧𝔽",
                                          cites: [8],
                                          closed: true,
                                        },
                                        {
                                          row: "1.1 𝔽 q",
                                          by: "∧𝔽",
                                          cites: [8],
                                          children: [
                                            {
                                              row: "1.2 𝔽 p",
                                              by: "∧𝔽",
                                              cites: [9],
                                            },
                                            {
                                              row: "1.2 𝔽 q",
                                              by: "∧𝔽",
                                              cites: [9],
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
          ],
        },
      ],
    },
  },
];
