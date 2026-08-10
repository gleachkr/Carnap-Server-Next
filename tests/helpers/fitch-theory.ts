/**
 * A small propositional sequent-ND theory for the Fitch proof-type tests: a
 * turnstile judgement (`⊢`) with an ACUI comma-context, plus `ax`, implication,
 * and conjunction rules. It is the theory the Stage 0 spike validated against the
 * real `@aufbau` compiler + verifier, so proofs the translator emits for it
 * genuinely compile and verify. Shared by the authoring and verify suites.
 *
 * House convention: multi-premise rules are **multiplicative** — one context
 * variable per premise, joined in the conclusion — and every conclusion also
 * joins one extra **slack** context variable (implicit weakening), as in
 * forallx. The slack lets a line state its conclusion in a larger ambient
 * scope than its premises inhabit, which the Fitch translator's ambient
 * contexts require (a nested line citing shallower lines); the tree
 * translators (Prawitz) emit dependency contexts and simply bind the slack
 * empty. An additive rule (one shared `g` across premises) would force
 * sibling premises' contexts to be ACUI-equal — unsupported by design. `ax`
 * (`g , a ⊢ a`) and `reit` are the slack shape in miniature.
 */
export const FITCH_THEORY_MM0 = `delimiter $ ( ) $;
provable sort wff;
sort ctx;

term imp (a b: wff): wff;
infixr imp: $→$ prec 25;
term and (a b: wff): wff;
infixl and: $∧$ prec 30;

term iff (a b: wff): wff;
infixr iff: $↔$ prec 20;
term ctx_eq (g h: ctx): wff;
term emp: ctx;
notation emp: ctx = ($_$:max);

--| @acui ctx_assoc ctx_comm emp ctx_idem
term join (g h: ctx): ctx;
infixl join: $,$ prec 5;
term hyp (a: wff): ctx;
coercion hyp: wff > ctx;
term nd (g: ctx) (a: wff): wff;
infixl nd: $⊢$ prec 0;

--| @relation wff iff iff_refl iff_trans iff_sym iff_mp
axiom iff_refl (a: wff): $ a ↔ a $;
axiom iff_trans (a b c: wff): $ a ↔ b $ > $ b ↔ c $ > $ a ↔ c $;
axiom iff_sym (a b: wff): $ a ↔ b $ > $ b ↔ a $;
axiom iff_mp (a b: wff): $ a ↔ b $ > $ a $ > $ b $;

--| @relation ctx ctx_eq ctx_refl ctx_trans ctx_sym _
axiom ctx_refl (g: ctx): $ ctx_eq g g $;
axiom ctx_trans (g h i: ctx): $ ctx_eq g h $ > $ ctx_eq h i $ > $ ctx_eq g i $;
axiom ctx_sym (g h: ctx): $ ctx_eq g h $ > $ ctx_eq h g $;
axiom ctx_assoc (g h i: ctx): $ ctx_eq ((g , h) , i) (g , (h , i)) $;
axiom ctx_comm (g h: ctx): $ ctx_eq (g , h) (h , g) $;
axiom ctx_idem (g: ctx): $ ctx_eq (g , g) g $;
axiom ctx_unit (g: ctx): $ ctx_eq (emp , g) g $;

--| @congr
axiom join_congr (g1 g2 h1 h2: ctx): $ ctx_eq g1 g2 $ > $ ctx_eq h1 h2 $ > $ ctx_eq (g1 , h1) (g2 , h2) $;
--| @congr
axiom hyp_congr (a b: wff): $ a ↔ b $ > $ ctx_eq (hyp a) (hyp b) $;
--| @congr
axiom nd_congr (g h: ctx) (a b: wff): $ ctx_eq g h $ > $ a ↔ b $ > $ (g ⊢ a) ↔ (h ⊢ b) $;
--| @congr
axiom imp_congr (a b c d: wff): $ a ↔ b $ > $ c ↔ d $ > $ (a → c) ↔ (b → d) $;
--| @congr
axiom and_congr (a b c d: wff): $ a ↔ b $ > $ c ↔ d $ > $ (a ∧ c) ↔ (b ∧ d) $;

-- Structural
axiom ax (g: ctx) (a: wff): $ g , a ⊢ a $;
axiom reit (g h: ctx) (a: wff): $ g ⊢ a $ > $ g , h ⊢ a $;

-- Implication
axiom imp_intro (g h: ctx) (a b: wff): $ g , a ⊢ b $ > $ g , h ⊢ a → b $;
axiom imp_elim (g h i: ctx) (a b: wff): $ g ⊢ a → b $ > $ h ⊢ a $ > $ g , h , i ⊢ b $;

-- Conjunction
axiom and_intro (g h i: ctx) (a b: wff): $ g ⊢ a $ > $ h ⊢ b $ > $ g , h , i ⊢ a ∧ b $;
axiom and_elim_l (g h: ctx) (a b: wff): $ g ⊢ a ∧ b $ > $ g , h ⊢ a $;
axiom and_elim_r (g h: ctx) (a b: wff): $ g ⊢ a ∧ b $ > $ g , h ⊢ b $;`;

/** The `:::aufbau-mm0{name="prop"}` block wrapping {@link FITCH_THEORY_MM0}. */
export const FITCH_THEORY_BLOCK = `:::aufbau-mm0{name="prop"}\n${FITCH_THEORY_MM0}\n:::`;
