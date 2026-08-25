/**
 * One worked Fitch proof per primitive rule of the forallx: Calgary theory —
 * the TFL connectives plus the first-order fragment (identity =I/=E and the four
 * quantifier rules ∀I/∀E/∃I/∃E), plus a `shouldFail` case that pins an
 * eigenvariable proviso shut. Shared by the manual verifier script (which
 * compiles + verifies them against the real engine) and the test suite (which
 * asserts the translation and, for a few, verifies a precomputed certificate).
 */
export interface ForallxCase {
  /** Human label naming the rules the case exercises. */
  readonly name: string;
  /** The frozen goal declaration appended to the theory. */
  readonly theoremDecl: string;
  readonly goalName: string;
  /** The starter Fitch proof text. */
  readonly fitch: string;
  /**
   * Set when the case exists to prove the theory *refuses* something.
   * `smuggle` pins a soundness fix: ∃E once let its context depend on the
   * eigenvariable, so the proviso bound only the conclusion and not the
   * undischarged assumptions. That alone proves
   * `∃x G(x) ; F(a) ⊢ ∃x (G(x) ∧ F(x))`, which is invalid (D = {1,2},
   * G = {2}, F = {1}, a = 1), and the certificate passed the *verifier*, not
   * just the compiler.
   *
   * There used to be a second such case. Spelling the eigenvariable like the
   * ∃ binder went through a different rule (`ex_elim` rather than
   * `ex_elim_sub`) and had to be pinned separately. It cannot be written any
   * more: the merged theory draws names and variables from different sorts, so
   * an eigenvariable and a bound variable are not the same kind of thing and
   * no `_sub` fallback exists to reach.
   */
  readonly shouldFail?: true;
}

export const FORALLX_CASES: readonly ForallxCase[] = [
  {
    name: "self (→I)",
    theoremDecl: "theorem self (a: wff): $ _ ⊢ a → a $;",
    goalName: "self",
    fitch: ["    a       :ax", "a → a       :imp_intro 1-1"].join("\n"),
  },
  {
    name: "mp (→E)",
    theoremDecl: "theorem mp (a b: wff): $ (a → b) ; a ⊢ b $;",
    goalName: "mp",
    fitch: ["a → b   :ax", "a       :ax", "b       :imp_elim 1 2"].join("\n"),
  },
  {
    name: "reit (reiteration / weakening)",
    theoremDecl: "theorem reittest (a b: wff): $ a ; b ⊢ a $;",
    goalName: "reittest",
    fitch: ["a   :ax", "b   :ax", "a   :reit 1"].join("\n"),
  },
  {
    name: "andcomm (∧E, ∧I)",
    theoremDecl: "theorem andcomm (a b: wff): $ a ∧ b ⊢ b ∧ a $;",
    goalName: "andcomm",
    fitch: [
      "a ∧ b   :ax",
      "b       :and_elim_r 1",
      "a       :and_elim_l 1",
      "b ∧ a   :and_intro 2 3",
    ].join("\n"),
  },
  {
    name: "orcomm (∨I, ∨E over two subproofs)",
    theoremDecl: "theorem orcomm (a b: wff): $ a ∨ b ⊢ b ∨ a $;",
    goalName: "orcomm",
    fitch: [
      "a ∨ b       :ax",
      "    a       :ax",
      "    b ∨ a   :or_intro_r 2",
      "    b       :ax",
      "    b ∨ a   :or_intro_l 4",
      "b ∨ a       :or_elim 1 2-3 4-5",
    ].join("\n"),
  },
  {
    name: "exfalso (¬E, X)",
    theoremDecl: "theorem exfalso (a b: wff): $ a ; ¬ a ⊢ b $;",
    goalName: "exfalso",
    fitch: [
      "a       :ax",
      "¬ a     :ax",
      "⊥       :neg_elim 1 2",
      "b       :explosion 3",
    ].join("\n"),
  },
  {
    name: "biconelim (↔E)",
    theoremDecl: "theorem biconelim (a b: wff): $ (a ↔ b) ; a ⊢ b $;",
    goalName: "biconelim",
    fitch: ["a ↔ b   :ax", "a       :ax", "b       :iff_elim_l 1 2"].join(
      "\n",
    ),
  },
  {
    name: "andcommbicon (↔I over two subproofs)",
    theoremDecl:
      "theorem andcommbicon (a b: wff): $ _ ⊢ (a ∧ b) ↔ (b ∧ a) $;",
    goalName: "andcommbicon",
    fitch: [
      "    a ∧ b   :ax",
      "    b       :and_elim_r 1",
      "    a       :and_elim_l 1",
      "    b ∧ a   :and_intro 2 3",
      "    b ∧ a   :ax",
      "    a       :and_elim_r 5",
      "    b       :and_elim_l 5",
      "    a ∧ b   :and_intro 6 7",
      "(a ∧ b) ↔ (b ∧ a)   :iff_intro 1-4 5-8",
    ].join("\n"),
  },
  {
    name: "dni (¬I)",
    theoremDecl: "theorem dni (a: wff): $ a ⊢ ¬ ¬ a $;",
    goalName: "dni",
    fitch: [
      "a           :ax",
      "    ¬ a     :ax",
      "    ⊥       :neg_elim 1 2",
      "¬ ¬ a       :neg_intro 2-3",
    ].join("\n"),
  },
  {
    name: "dne (IP)",
    theoremDecl: "theorem dne (a: wff): $ ¬ ¬ a ⊢ a $;",
    goalName: "dne",
    fitch: [
      "¬ ¬ a       :ax",
      "    ¬ a     :ax",
      "    ⊥       :neg_elim 2 1",
      "a           :ip 2-3",
    ].join("\n"),
  },
  {
    // The textbook proof of a vacuous conditional: assume b, reiterate a past
    // it, discharge. Works because every line carries its ambient context (the
    // reiterated line reads `a , b ⊢ a`), which is what the ambient flip bought.
    name: "vacuous (→I over an unused assumption, via R)",
    theoremDecl: "theorem vacuous (a b: wff): $ a ⊢ b → a $;",
    goalName: "vacuous",
    fitch: [
      "a           :ax",
      "    b       :ax",
      "    a       :reit 1",
      "b → a       :imp_intro 2-3",
    ].join("\n"),
  },
  {
    // A nested line citing shallower lines directly: the ∧I line's ambient
    // (a , b , c) exceeds the join of the cited contexts (a , b), so the
    // rules' slack context variables are load-bearing here.
    name: "nested (∧I under an unrelated assumption, then →I)",
    theoremDecl: "theorem nested (a b c: wff): $ a ; b ⊢ c → (a ∧ b) $;",
    goalName: "nested",
    fitch: [
      "a               :ax",
      "b               :ax",
      "    c           :ax",
      "    a ∧ b       :and_intro 1 2",
      "c → (a ∧ b)     :imp_intro 3-4",
    ].join("\n"),
  },

  // ── First-order fragment (FOL): identity + quantifiers ──────────────────
  // Predicates F, G and R come from the theory's alphabet, which is now the
  // textbook's whole one, and take their arguments in parentheses. Quantifiers
  // bind variables from the s–z pool; the name an instance is drawn from, and
  // that ∀I generalizes over, comes from a–e — a different *sort*, which is
  // what makes the eigenvariable provisos dependency typing rather than a side
  // condition. The witness (∀E, ∃I) and the eigenvariable (∀I, ∃E) are inferred
  // by the compiler from these concrete formulas; the translator only ever
  // emits `Γ ⊢ φ by rule [refs]`.
  //
  // Every variable and name a proof mentions is bound on the goal — including
  // an eigenvariable the goal itself does not use, as in `unidist`. MM0 has no
  // implicit binding, and `@vars` says what a token *is*, not that a statement
  // has one. And quantifiers are written with a space (`∀ x`, not `∀x`): this
  // is engine text, lexed under the theory's own delimiters, where `∀x` is one
  // unknown token. The surface language reads the tight form; a proof widget
  // does not go through it.
  {
    name: "unimp (∀E, →E)",
    theoremDecl:
      "theorem unimp {x: var} {a: name}: $ ∀ x (F(x) → G(x)) ; F(a) ⊢ G(a) $;",
    goalName: "unimp",
    fitch: [
      "∀ x (F(x) → G(x))   :ax",
      "F(a)                :ax",
      "F(a) → G(a)         :all_elim 1",
      "G(a)                :imp_elim 3 2",
    ].join("\n"),
  },
  {
    name: "unidist (∀I, ∀E, ∧E)",
    theoremDecl:
      "theorem unidist {x: var} {a: name}: $ ∀ x (F(x) ∧ G(x)) ⊢ ∀ x F(x) $;",
    goalName: "unidist",
    fitch: [
      "∀ x (F(x) ∧ G(x))   :ax",
      "F(a) ∧ G(a)         :all_elim 1",
      "F(a)                :and_elim_l 2",
      "∀ x F(x)            :all_intro 3",
    ].join("\n"),
  },
  {
    name: "exintro (∃I)",
    theoremDecl: "theorem exintro {x: var} {a: name}: $ F(a) ⊢ ∃ x F(x) $;",
    goalName: "exintro",
    fitch: ["F(a)        :ax", "∃ x F(x)    :ex_intro 1"].join("\n"),
  },
  {
    name: "exelim (∃E, ∃I, ∀E, →E)",
    theoremDecl:
      "theorem exelim {x: var} {b: name}: $ ∃ x F(x) ; ∀ x (F(x) → G(x)) ⊢ ∃ x G(x) $;",
    goalName: "exelim",
    fitch: [
      "∃ x F(x)              :ax",
      "∀ x (F(x) → G(x))     :ax",
      "    F(b)              :ax",
      "    F(b) → G(b)       :all_elim 2",
      "    G(b)              :imp_elim 4 3",
      "    ∃ x G(x)          :ex_intro 5",
      "∃ x G(x)              :ex_elim 1 3-6",
    ].join("\n"),
  },
  {
    name: "eqrefl (=I, ∀I)",
    theoremDecl: "theorem eqrefl {x: var} {a: name}: $ _ ⊢ ∀ x (x = x) $;",
    goalName: "eqrefl",
    fitch: ["a = a         :eq_intro_nd", "∀ x (x = x)   :all_intro 1"].join(
      "\n",
    ),
  },
  {
    name: "eqreplace (=E)",
    theoremDecl: "theorem eqreplace {a b: name}: $ a = b ; F(a) ⊢ F(b) $;",
    goalName: "eqreplace",
    fitch: [
      "a = b       :ax",
      "F(a)        :ax",
      "F(b)        :eq_replace 1 2",
    ].join("\n"),
  },
  {
    fitch: [
      "∃ x G(x)                 :ax",
      "F(a)                     :ax",
      "    G(a)                 :ax",
      "    G(a) ∧ F(a)          :and_intro 3 2",
      "    ∃ x (G(x) ∧ F(x))    :ex_intro 4",
      "∃ x (G(x) ∧ F(x))        :ex_elim 1 3-5",
    ].join("\n"),
    goalName: "smuggle",
    name: "∃E smuggling its eigenvariable out of an undischarged assumption (must be refused)",
    shouldFail: true,
    theoremDecl:
      "theorem smuggle {x: var} {a: name}: $ ∃ x G(x) ; F(a) ⊢ ∃ x (G(x) ∧ F(x)) $;",
  },
];
