/**
 * The root of every worked tree in *forall x: UBC* (Ichikawa and Jenkins),
 * v2.4.1, commit e01f809: chapters 5, 10 and 12 and the solutions appendix,
 * read from the book's LaTeX source (`github.com/jonathanichikawa/for-all-x`,
 * CC BY 4.0) and deduplicated. A tree's root is its first row and the rows
 * grouped with it; `from` names the trees that share it, by file and order of
 * appearance. The schematic trees (`𝒜 ∧ ℬ`) and the commented-out ones are
 * left out, and so is solution #38, which quantifies over four variables
 * where the language has three (`x`–`z`).
 *
 * The truth-tree differential test (gh #46) develops each root itself, so
 * only the roots are taken: the book's trees do not cite their rows.
 */

export interface UbcTreeRoot {
  readonly from: string;
  readonly root: readonly string[];
}

export const UBC_TREE_ROOTS: readonly UbcTreeRoot[] = [
  {
    from: "5-SLtrees #1, 5-SLtrees #2, 5-SLtrees #3, 5-SLtrees #4, 5-SLtrees #5",
    root: ["A∧ B", "¬(C∨ D)", "(¬ B ∨ C) ∨ E", "¬ E"],
  },
  {
    from: "5-SLtrees #6, 5-SLtrees #7",
    root: ["(D∨ A) ∧ ¬ N", "N ∨ ¬ A", "¬ (¬ N ∧ A)"],
  },
  { from: "5-SLtrees #19", root: ["(D ∧ ¬ R) ∨ Q", "¬ Q ∨ R"] },
  {
    from: "5-SLtrees #20",
    root: ["(¬¬ S ∧ T) → (¬ P ↔ (Q ∨ R))", "¬¬ S ∧ T", "¬ (¬ P ↔ (Q∨ R))"],
  },
  {
    from: "5-SLtrees #21, 5-SLtrees #22",
    root: ["¬ (C ∧ A)", "D ↔ C", "A ∨ B", "¬ B"],
  },
  {
    from: "5-SLtrees #23",
    root: ["P ∧ Q", "¬ P ∨ ¬ R", "S → (P ↔ (¬ Q ∧ R))"],
  },
  {
    from: "10-QLtrees #1, 10-QLtrees #2, 10-QLtrees #3, 10-QLtrees #4, 10-QLtrees #5",
    root: ["∀x (Fx → Gx)", "¬∃x Gx", "∃x (Fx ∨ Gx)"],
  },
  { from: "10-QLtrees #6", root: ["∀x Fxa", "∀y (Gy → ¬ Fya)"] },
  { from: "10-QLtrees #8", root: ["Fa", "∃x ¬ Fx"] },
  {
    from: "10-QLtrees #10, 10-QLtrees #11",
    root: ["∀x (Fx ∧ Gx)", "¬ Fa ∨ ¬ Gb"],
  },
  {
    from: "10-QLtrees #14, 10-QLtrees #15",
    root: ["∀x (Fx → Ga)", "¬ Ga", "Fb"],
  },
  {
    from: "10-QLtrees #16, 10-QLtrees #17, 10-QLtrees #18, 10-QLtrees #19",
    root: ["Gb → ∀x ¬ Fx", "∃x Fx", "¬ ¬ Gb"],
  },
  { from: "10-QLtrees #20", root: ["∃x Fx", "∀x Gx"] },
  { from: "10-QLtrees #21, 10-QLtrees #22", root: ["∀x ∃y Rxy"] },
  { from: "10-QLtrees #23", root: ["∃x ∀y ∃z (¬ Rxy ∧ Rzx)"] },
  { from: "10-QLtrees #24", root: ["∀x ∃y ¬ Rxy", "Rab"] },
  { from: "12-identity #1", root: ["Fa", "¬ Fb", "a=b"] },
  { from: "12-identity #2", root: ["∀x a=x", "∃x x≠a"] },
  { from: "12-identity #3", root: ["∀x (Rax → x=b)", "∃x Rax"] },
  {
    from: "app-solutions #1",
    root: [
      "A ↔ B",
      "¬ B → (C ∨ D)",
      "E → ¬ C",
      "(¬ D ∧ F) ∨ G",
      "¬ A ∧ E",
      "¬ (H ∨ G)",
    ],
  },
  { from: "app-solutions #2", root: ["P", "P → Q", "Q → ¬ P"] },
  { from: "app-solutions #3", root: ["¬((P → Q) ↔ (Q → P))"] },
  { from: "app-solutions #4", root: ["P ∧ Q", "¬ R → ¬ Q", "¬ (P ∧ R)"] },
  { from: "app-solutions #5", root: ["A ∨ B", "B → C", "A ↔ C", "¬ C"] },
  { from: "app-solutions #6", root: ["A ↔ ¬ A"] },
  { from: "app-solutions #7", root: ["P", "P → Q", "¬ Q", "¬ A"] },
  { from: "app-solutions #8", root: ["P → Q", "¬ P ∨ ¬ Q", "Q → P"] },
  { from: "app-solutions #9", root: ["B", "A ∧ B"] },
  { from: "app-solutions #10", root: ["¬ A", "A ∨ B"] },
  { from: "app-solutions #11", root: ["P ↔ Q", "¬ P"] },
  { from: "app-solutions #12", root: ["¬ ∀x ∀y (Gxy → ∃z Gxz)"] },
  { from: "app-solutions #13", root: ["¬ (∀x Fx ∨ ∀x (Fx → Gx))"] },
  { from: "app-solutions #14", root: ["¬ ∀x (Fx → (¬ Fx → ∀y Gy))"] },
  { from: "app-solutions #15", root: ["¬ ∃x (Fx ∨ ¬ Fx)"] },
  { from: "app-solutions #16", root: ["¬ (∃x Jx ↔ ¬ ∀x ¬ Jx)"] },
  { from: "app-solutions #17", root: ["¬ (∀x (Fx ∨ Gx) → (∀y Fy ∨ ∃x Gx))"] },
  { from: "app-solutions #18", root: ["Fa", "Ga", "¬ ∀x (Fx → Gx)"] },
  { from: "app-solutions #19", root: ["Fa", "Ga", "¬ ∃x (Fx ∧ Gx)"] },
  { from: "app-solutions #20", root: ["∀x ∃y Lxy", "¬ ∃x ∀y Lxy"] },
  {
    from: "app-solutions #21",
    root: ["∃x (Fx ∧ Gx)", "Fb ↔ Fa", "Fc → Fa", "¬ Fa"],
  },
  { from: "app-solutions #22", root: ["∀x ∃y Gyx", "¬ ∀x ∃y (Gxy ∨ Gyx)"] },
  { from: "app-solutions #23, app-solutions #25", root: ["∃x Fx", "¬ Fa"] },
  { from: "app-solutions #24", root: ["∃x Fx", "¬ Fd"] },
  {
    from: "app-solutions #26, app-solutions #27, app-solutions #28",
    root: ["∀x Fx", "¬ Fa"],
  },
  { from: "app-solutions #29", root: ["Fa", "∀x ∀y ¬ Rxy", "∀x ∃y Rxy"] },
  { from: "app-solutions #30", root: ["¬ ∀x ∀y (x=y → y=x)"] },
  { from: "app-solutions #31", root: ["¬ ∀x ∃y x=y"] },
  { from: "app-solutions #32", root: ["¬ ∃x ∀y x=y"] },
  { from: "app-solutions #33", root: ["∃x ∀y x=y", "¬ ∀x ∀y (Rxy ↔ Ryx)"] },
  {
    from: "app-solutions #34",
    root: ["¬¬∀x ∀y ∀z ((Axy ∧ Azx ∧ y=z) → Axx)"],
  },
  { from: "app-solutions #35", root: ["∀x ∀y x=y", "¬ (∃x Fx ↔ ∀x Fx)"] },
  {
    from: "app-solutions #36",
    root: ["∀x (x=a ∨ x=b)", "Ga ↔ ¬ Gb", "¬ ¬ ∃x ∃y ∃z (Gx ∧ Gy ∧ ¬ Gz)"],
  },
  {
    from: "app-solutions #37",
    root: ["∀x (Fx → x=f)", "∃x (Fx ∨ ∀y y=x)", "¬ Ff"],
  },
];
