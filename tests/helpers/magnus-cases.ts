/**
 * One worked Fitch proof per basic rule of forallx (P.D. Magnus) — system SL's
 * connective rules plus system QL's identity and quantifier rules — and a
 * `shouldFail` case pinning an eigenvariable proviso shut. Shared by
 * `scripts/magnus-verify.ts` (which compiles + verifies them against the real
 * engine) and the test suite (which asserts the translation).
 *
 * Two things make these read differently from `forallx-cases.ts`, and both are
 * the point of the artifact:
 *
 *  - **The proof lines are written the way Magnus's students write them** —
 *    juxtaposed atomic sentences (`Fa`, `Rab`), `@`/`3` for the quantifiers,
 *    `&` and `~` for the connectives. Only the *goal* is engine text, because
 *    only the goal is the instructor's; every proof line is read in the
 *    theory's own language before it reaches the compiler.
 *  - **`¬I`, `¬E` and `∨E` are Magnus's**, not Calgary's. The reductio rules
 *    take two premises rather than one ending in `⊥` (this language has no
 *    `⊥`), which in Fitch is cited the book's way — one range whose subproof
 *    *ends* with the contradictory pair, `neg_intro 2-5` — because the
 *    citation table derived from the rule signatures (`citations.ts`) lets
 *    one range supply both premises. Citing the subproof once per premise
 *    (`neg_intro 2-4 2-5`) is the explicit spelling and stays legal; `dne`
 *    below keeps a case in it. `∨E` is modus tollendo ponens.
 *
 * A goal that quantifies over formulas binds single letters — `p`, `q`, `r` —
 * which are also names in this theory's lexicon. That shadowing is deliberate
 * and is the same case `forallx-cases.ts` makes with `a` and `b`: a proof's
 * lines are read in the goal's own binders, so here the letter is the
 * metavariable.
 */
export interface MagnusCase {
  /** Human label naming the rules the case exercises. */
  readonly name: string;
  /** The frozen goal declaration appended to the theory. */
  readonly theoremDecl: string;
  readonly goalName: string;
  /** The starter Fitch proof text. */
  readonly fitch: string;
  /**
   * Set when the case exists to prove the theory *refuses* something.
   * `smuggle` is Calgary's soundness case transplanted: ∃E's eigenvariable may
   * not occur in an undischarged assumption, and the proof below would prove
   * `∃x Gx ; Fa ⊢ ∃x (Gx & Fx)` — invalid on D = {1,2}, G = {2}, F = {1},
   * a = 1 — if it could.
   */
  readonly shouldFail?: true;
  /**
   * The built-in the exercise names. Unset means the basic system; the cases
   * over the book's derived and replacement rules name `forallx-magnus-plus`.
   */
  readonly system?: string;
}

export const MAGNUS_CASES: readonly MagnusCase[] = [
  // ── Sentential logic (system SL) ────────────────────────────────────────
  {
    name: "self (→I)",
    theoremDecl: "theorem self (p: wff): $ _ ⊢ p → p $;",
    goalName: "self",
    fitch: ["    p       :AS", "p -> p      :imp_intro 1-1"].join("\n"),
  },
  {
    // Cited by the book's own names, which the theory's alias lines resolve.
    name: "aliased (PR, →E, &I by textbook name)",
    theoremDecl: "theorem aliased (p q: wff): $ (p → q) ; p ⊢ q & p $;",
    goalName: "aliased",
    fitch: [
      "p -> q  :PR",
      "p       :PR",
      "q       :→E 1 2",
      "q & p   :&I 3 2",
    ].join("\n"),
  },
  {
    name: "paired (&E, ↔E, ∨E, ∨I by textbook name, both sides of each)",
    theoremDecl:
      "theorem paired (p q r s t: wff): $ p & q ; p ↔ q ; ¬ r ; r ∨ s ; t ∨ r ⊢ (p ∨ s) & (t ∨ p) $;",
    goalName: "paired",
    // Each pair's alias is one axiom with a @fallback onto its sibling, so
    // the same citation must land on either side as the line demands.
    fitch: [
      "p & q             :PR",
      "p <-> q           :PR",
      "~r                :PR",
      "r \\/ s            :PR",
      "t \\/ r            :PR",
      "p                 :&E 1",
      "q                 :&E 1",
      "q                 :<->E 2 6",
      "p                 :<->E 2 7",
      "s                 :\\/E 4 3",
      "t                 :\\/E 5 3",
      "p \\/ s            :\\/I 9",
      "t \\/ p            :\\/I 9",
      "(p \\/ s) & (t \\/ p) :&I 12 13",
    ].join("\n"),
  },
  {
    name: "mp (→E)",
    theoremDecl: "theorem mp (p q: wff): $ (p → q) ; p ⊢ q $;",
    goalName: "mp",
    fitch: ["p -> q  :AS", "p       :AS", "q       :imp_elim 1 2"].join("\n"),
  },
  {
    name: "reittest (R)",
    theoremDecl: "theorem reittest (p q: wff): $ p ; q ⊢ p $;",
    goalName: "reittest",
    fitch: ["p   :AS", "q   :AS", "p   :reit 1"].join("\n"),
  },
  {
    name: "andcomm (&I, &E)",
    theoremDecl: "theorem andcomm (p q: wff): $ p & q ⊢ q & p $;",
    goalName: "andcomm",
    fitch: [
      "p & q   :AS",
      "q       :and_elim_r 1",
      "p       :and_elim_l 1",
      "q & p   :and_intro 2 3",
    ].join("\n"),
  },
  {
    name: "orintro (∨I both sides)",
    theoremDecl: "theorem orintro (p q: wff): $ p ⊢ (p ∨ q) & (q ∨ p) $;",
    goalName: "orintro",
    fitch: [
      "p                   :AS",
      "p \\/ q              :or_intro_l 1",
      "q \\/ p              :or_intro_r 1",
      "(p \\/ q) & (q \\/ p) :and_intro 2 3",
    ].join("\n"),
  },
  {
    // Magnus's ∨E is modus tollendo ponens: the disjunction and one disjunct's
    // negation give the other disjunct. `_r` names the side concluded.
    name: "dsright (∨E, right disjunct)",
    theoremDecl: "theorem dsright (p q: wff): $ (p ∨ q) ; ¬ p ⊢ q $;",
    goalName: "dsright",
    fitch: ["p \\/ q  :AS", "~p      :AS", "q       :or_elim_r 1 2"].join(
      "\n",
    ),
  },
  {
    name: "dsleft (∨E, left disjunct)",
    theoremDecl: "theorem dsleft (p q: wff): $ (p ∨ q) ; ¬ q ⊢ p $;",
    goalName: "dsleft",
    fitch: ["p \\/ q  :AS", "~q      :AS", "p       :or_elim_l 1 2"].join(
      "\n",
    ),
  },
  {
    name: "bicon (↔I over two subproofs)",
    theoremDecl: "theorem bicon (p q: wff): $ (p → q) ; (q → p) ⊢ p ↔ q $;",
    goalName: "bicon",
    fitch: [
      "p -> q      :AS",
      "q -> p      :AS",
      "    p       :AS",
      "    q       :imp_elim 1 3",
      "    q       :AS",
      "    p       :imp_elim 2 5",
      "p <-> q     :iff_intro 3-4 5-6",
    ].join("\n"),
  },
  {
    name: "biconelim (↔E both directions)",
    theoremDecl: "theorem biconelim (p q: wff): $ (p ↔ q) ; p ; q ⊢ q & p $;",
    goalName: "biconelim",
    fitch: [
      "p <-> q :AS",
      "p       :AS",
      "q       :AS",
      "q       :iff_elim_l 1 2",
      "p       :iff_elim_r 1 3",
      "q & p   :and_intro 4 5",
    ].join("\n"),
  },
  {
    // ¬I onto an explicit contradictory pair: the subproof is cited twice, once
    // at each of the two lines that contradict. This is the shape every
    // reductio in this system has, and the one thing about it a student
    // arriving from Calgary has to learn.
    // The book's own citation shape: one range, whose subproof ends with the
    // contradictory pair. The signature-derived citation table (citations.ts)
    // is what lets the translator draw two premises from it.
    name: "dni (¬I, one range supplying the contradictory pair)",
    theoremDecl: "theorem dni (p: wff): $ p ⊢ ¬ ¬ p $;",
    goalName: "dni",
    fitch: [
      "p           :AS",
      "    ~p      :AS",
      "    p       :reit 1",
      "    ~p      :reit 2",
      "~~p         :neg_intro 2-4",
    ].join("\n"),
  },
  {
    // ¬E is the *classical* reductio — it discharges ¬φ and concludes φ — which
    // is why this system needs no separate indirect-proof rule. Cited the
    // explicit way, one ref per premise naming the subproof twice: the
    // spelling every proof written before the citation table stays legal in.
    name: "dne (¬E, explicit one-ref-per-premise citation)",
    theoremDecl: "theorem dne (p: wff): $ ¬ ¬ p ⊢ p $;",
    goalName: "dne",
    fitch: [
      "~~p         :AS",
      "    ~p      :AS",
      "    ~p      :reit 2",
      "    ~~p     :reit 1",
      "p           :neg_elim 2-3 2-4",
    ].join("\n"),
  },
  {
    // One half of De Morgan, and the case where the two contradictory lines are
    // genuinely derived rather than reiterated. Written in the book's ASCII
    // throughout, so nothing here compiles unless the lines are read in the
    // theory's language first.
    name: "demorgan (¬I over ∨E, in the book's ASCII)",
    theoremDecl: "theorem demorgan (p q: wff): $ ¬ p & ¬ q ⊢ ¬ (p ∨ q) $;",
    goalName: "demorgan",
    fitch: [
      "~p & ~q         :AS",
      "    p \\/ q      :AS",
      "    ~p          :and_elim_l 1",
      "    q           :or_elim_r 2 3",
      "    ~q          :and_elim_r 1",
      "~(p \\/ q)       :neg_intro 2-5",
    ].join("\n"),
  },
  {
    // A nested line citing shallower lines directly: the &I line's ambient
    // context exceeds the join of the cited ones, so the rules' slack context
    // variables are load-bearing here.
    name: "nested (&I under an unrelated assumption, then →I)",
    theoremDecl: "theorem nested (p q r: wff): $ p ; q ⊢ r → (p & q) $;",
    goalName: "nested",
    fitch: [
      "p               :AS",
      "q               :AS",
      "    r           :AS",
      "    p & q       :and_intro 1 2",
      "r -> (p & q)    :imp_intro 3-4",
    ].join("\n"),
  },

  // ── First-order logic (system QL) ───────────────────────────────────────
  // Atomic sentences are juxtaposed — `Fa`, `Rab` — with no parentheses and no
  // commas, which is Magnus's whole atomic notation and the reason this file's
  // proofs cannot be Calgary's with the rule names swapped. The goals below are
  // engine text, where the same sentences are ordinary applications: `F(a)`,
  // `R(a,b)`. Variables come from x–z, names from a–w, and the two are
  // different *sorts*, which is what makes the eigenvariable provisos
  // dependency typing rather than side conditions.
  {
    name: "unimp (∀E, →E)",
    theoremDecl:
      "theorem unimp {x: var} {a: name}: $ ∀ x (F(x) → G(x)) ; F(a) ⊢ G(a) $;",
    goalName: "unimp",
    fitch: [
      "@x(Fx -> Gx)    :AS",
      "Fa              :AS",
      "Fa -> Ga        :all_elim 1",
      "Ga              :imp_elim 3 2",
    ].join("\n"),
  },
  {
    name: "unidist (∀I, ∀E, &E)",
    theoremDecl:
      "theorem unidist {x: var} {a: name}: $ ∀ x (F(x) & G(x)) ⊢ ∀ x F(x) $;",
    goalName: "unidist",
    fitch: [
      "@x(Fx & Gx)     :AS",
      "Fa & Ga         :all_elim 1",
      "Fa              :and_elim_l 2",
      "@xFx            :all_intro 3",
    ].join("\n"),
  },
  {
    name: "exintro (∃I)",
    theoremDecl: "theorem exintro {x: var} {a: name}: $ F(a) ⊢ ∃ x F(x) $;",
    goalName: "exintro",
    fitch: ["Fa      :AS", "3xFx    :ex_intro 1"].join("\n"),
  },
  {
    name: "exelim (∃E, ∃I, ∀E, →E)",
    theoremDecl:
      "theorem exelim {x: var} {b: name}: $ ∃ x F(x) ; ∀ x (F(x) → G(x)) ⊢ ∃ x G(x) $;",
    goalName: "exelim",
    fitch: [
      "3xFx                :AS",
      "@x(Fx -> Gx)        :AS",
      "    Fb              :AS",
      "    Fb -> Gb        :all_elim 2",
      "    Gb              :imp_elim 4 3",
      "    3xGx            :ex_intro 5",
      "3xGx                :ex_elim 1 3-6",
    ].join("\n"),
  },
  {
    // Two arguments glued onto one letter, and two witnesses recovered in
    // sequence: the case that pins variadic juxtaposition end to end.
    name: "relwitness (∃I twice over a two-place predicate)",
    theoremDecl:
      "theorem relwitness {x y: var} {a b: name}: $ R(a,b) ⊢ ∃ x ∃ y R(x,y) $;",
    goalName: "relwitness",
    fitch: [
      "Rab         :AS",
      "3yRay       :ex_intro 1",
      "3x3yRxy     :ex_intro 2",
    ].join("\n"),
  },
  {
    name: "eqrefl (=I, ∀I)",
    theoremDecl: "theorem eqrefl {x: var} {a: name}: $ _ ⊢ ∀ x (x = x) $;",
    goalName: "eqrefl",
    fitch: ["a=a         :eq_intro_nd", "@x x=x      :all_intro 1"].join(
      "\n",
    ),
  },
  {
    name: "eqreplace (=E)",
    theoremDecl: "theorem eqreplace {a b: name}: $ a = b ; F(a) ⊢ F(b) $;",
    goalName: "eqreplace",
    fitch: ["a=b     :AS", "Fa      :AS", "Fb      :eq_replace 1 2"].join(
      "\n",
    ),
  },
  {
    fitch: [
      "3xGx                :AS",
      "Fa                  :AS",
      "    Ga              :AS",
      "    Ga & Fa         :and_intro 3 2",
      "    3x(Gx & Fx)     :ex_intro 4",
      "3x(Gx & Fx)         :ex_elim 1 3-5",
    ].join("\n"),
    goalName: "smuggle",
    name: "∃E smuggling its eigenvariable out of an undischarged assumption (must be refused)",
    shouldFail: true,
    theoremDecl:
      "theorem smuggle {x: var} {a: name}: $ ∃ x G(x) ; F(a) ⊢ ∃ x (G(x) & F(x)) $;",
  },
  // The derived and replacement rules, which only `forallx-magnus-plus`
  // declares. Each is cited by the book's name, and every form a name covers
  // is exercised — the fallback chain has to land on each of them. The
  // replacement rules are applied to whole lines, which is all this file
  // states of them; see its header.
  {
    name: "DIL",
    theoremDecl: "theorem diltest: $ P ∨ Q ; P → R ; Q → R ⊢ R $;",
    goalName: "diltest",
    system: "forallx-magnus-plus",
    fitch: [
      "P \\/ Q     :PR",
      "P -> R    :PR",
      "Q -> R    :PR",
      "R         :DIL 1 2 3",
    ].join("\n"),
  },
  {
    name: "MT",
    theoremDecl: "theorem mttest: $ P → Q ; ¬ Q ⊢ ¬ P $;",
    goalName: "mttest",
    system: "forallx-magnus-plus",
    fitch: ["P -> Q    :PR", "~Q        :PR", "~P        :MT 1 2"].join("\n"),
  },
  {
    name: "HS",
    theoremDecl: "theorem hstest: $ P → Q ; Q → R ⊢ P → R $;",
    goalName: "hstest",
    system: "forallx-magnus-plus",
    fitch: ["P -> Q    :PR", "Q -> R    :PR", "P -> R    :HS 1 2"].join("\n"),
  },
  {
    name: "Comm, over each connective",
    theoremDecl:
      "theorem comm: $ P & Q ; P ∨ Q ; P ↔ Q ⊢ (Q & P) & ((Q ∨ P) & (Q ↔ P)) $;",
    goalName: "comm",
    system: "forallx-magnus-plus",
    fitch: [
      "P & Q                         :PR",
      "P \\/ Q                         :PR",
      "P <-> Q                       :PR",
      "Q & P                         :Comm 1",
      "Q \\/ P                         :Comm 2",
      "Q <-> P                       :Comm 3",
      "(Q \\/ P) & (Q <-> P)           :and_intro 5 6",
      "(Q & P) & ((Q \\/ P) & (Q <-> P)) :and_intro 4 7",
    ].join("\n"),
  },
  {
    name: "DN, both ways",
    theoremDecl: "theorem dn: $ ¬ ¬ P ⊢ ¬ ¬ P $;",
    goalName: "dn",
    system: "forallx-magnus-plus",
    fitch: ["~~P       :PR", "P         :DN 1", "~~P       :DN 2"].join("\n"),
  },
  {
    name: "MC, all four forms",
    theoremDecl: "theorem mc: $ P → Q ; P ∨ Q ⊢ (P → Q) & (P ∨ Q) $;",
    goalName: "mc",
    system: "forallx-magnus-plus",
    // Out and back again, so each premise goes through both of its forms.
    fitch: [
      "P -> Q                :PR",
      "P \\/ Q                 :PR",
      "~P \\/ Q                :MC 1",
      "~P -> Q               :MC 2",
      "P -> Q                :MC 3",
      "P \\/ Q                 :MC 4",
      "(P -> Q) & (P \\/ Q)    :and_intro 5 6",
    ].join("\n"),
  },
  {
    name: "↔ex, both ways",
    theoremDecl: "theorem iffex: $ P ↔ Q ⊢ P ↔ Q $;",
    goalName: "iffex",
    system: "forallx-magnus-plus",
    fitch: [
      "P <-> Q                   :PR",
      "(P -> Q) & (Q -> P)       :↔ex 1",
      "P <-> Q                   :<->ex 2",
    ].join("\n"),
  },
  {
    name: "DeM, all four forms",
    theoremDecl:
      "theorem dem: $ ¬ (P ∨ Q) ; ¬ (R & S) ⊢ ¬ (P ∨ Q) & ¬ (R & S) $;",
    goalName: "dem",
    system: "forallx-magnus-plus",
    fitch: [
      "~(P \\/ Q)                :PR",
      "~(R & S)                :PR",
      "~P & ~Q                 :DeM 1",
      "~R \\/ ~S                 :DeM 2",
      "~(P \\/ Q)                :DeM 3",
      "~(R & S)                :DeM 4",
      "~(P \\/ Q) & ~(R & S)     :and_intro 5 6",
    ].join("\n"),
  },
  {
    name: "QN, all four forms",
    theoremDecl:
      "theorem qn {x: var}: $ ¬ ∀ x F(x) ; ¬ ∃ x G(x) ⊢ ¬ ∀ x F(x) & ¬ ∃ x G(x) $;",
    goalName: "qn",
    system: "forallx-magnus-plus",
    fitch: [
      "~@xFx                 :PR",
      "~3xGx                 :PR",
      "3x~Fx                 :QN 1",
      "@x~Gx                 :QN 2",
      "~@xFx                 :QN 3",
      "~3xGx                 :QN 4",
      "~@xFx & ~3xGx         :and_intro 5 6",
    ].join("\n"),
  },
];
