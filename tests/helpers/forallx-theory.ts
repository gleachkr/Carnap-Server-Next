/**
 * The natural-deduction system of *forallx: Calgary* rendered as an Aufbau
 * sequent theory — the full first-order fragment (**FOL**), not just TFL. Each
 * object connective (∧ ∨ → ↔ ¬ ⊥) is a `wff` term; the judgement is a sequent
 * `Γ ⊢ φ` over an ACUI comma-context (so the Fitch translator can map indentation
 * to contexts, exactly as the shipped `prop` theory does). The rule set is
 * forallx's primitive basic rules — the ones the textbook introduces as the proof
 * system itself, not the derived/secondary rules (DS, MT, LEM, DeMorgan, …), which
 * are provable from these. Beyond the textbook statement, every rule's conclusion
 * joins one extra **slack** context variable — implicit weakening, required by the
 * Fitch translator's ambient contexts and inert for dependency-context emitters;
 * see the comment at the Structural rules below.
 *
 * forallx rule → axiom name:
 *   R (reiteration) .......... reit        ∧I / ∧E ........ and_intro / and_elim_l/r
 *   →I / →E .................. imp_intro / imp_elim        ∨I / ∨E .. or_intro_l/r / or_elim
 *   ↔I / ↔E ................. iff_intro / iff_elim_l/r     ¬I ....... neg_intro
 *   ¬E (A,¬A ⊢ ⊥) ........... neg_elim     X (explosion) .. explosion  IP ... ip
 *   =I ....................... eq_intro_nd  =E ............. eq_replace
 *   ∀I / ∀E .................. all_intro / all_elim        ∃I / ∃E .. ex_intro / ex_elim
 * The assumption/premise rule (the Fitch `assumption` axiom) is `ax`.
 *
 * ## The first-order fragment and eigenvariables
 *
 * Quantifiers are MM0 binders: `term all {x: tm} (p: wff x)` declares `∀ x p`
 * where the body `p` *may* mention the bound term-variable `x`. A predicate
 * applied to a term is a `wff` mentioning that term (`F x`), and instantiation is
 * the substitution term `[x/t] p` (with `subst x / t a` for the term level). The
 * **eigenvariable side condition** rides on MM0's binder dependency types: in
 * `all_intro (g: ctx) {x: tm} (p: wff x)` the *raw* `g: ctx` may not depend on
 * `x`, which is exactly "the name being generalized does not occur in any
 * undischarged assumption". The verifier re-checks that dependency against the
 * MMB, so the constraint is enforced by the trust boundary, not by the compiler.
 *
 * **A rule's dependency list is the whole proviso, so read it twice.** Both ∃E
 * rules once declared contexts that were allowed to mention the eigenvariable
 * (`ex_elim_sub` had `(g h i: ctx x u)`, `ex_elim` had `(g h i: ctx x)`), which
 * left the proviso binding only the conclusion. That is enough to prove
 * `∃x G(x) , F(u) ⊢ ∃x (G(x) ∧ F(x))` — invalid on D = {1,2}, G = {2}, F = {1},
 * u = 1 — and the MMB passed `verifyMmb`, so it was through the trust boundary,
 * not merely past the compiler. `forallx-cases.ts` pins both paths shut with the
 * `smuggle` / `smugglex` refusal cases.
 *
 * The compiler's elaboration annotations let a proof cite these rules with
 * concrete formulas and have the witness / eigenvariable *inferred* rather than
 * annotated inline: `@view`/`@recover` recover the witness `t` (∀E, ∃I) or the
 * eigenvariable `u` (the `_sub` fallbacks) from the concrete before/after
 * sequents; `@freshen` alpha-renames harmless bound-variable collisions; the
 * `@fallback` forms handle the textbook case where the eigenvariable name differs
 * from the ∀/∃ binder; `@abstract`/`@fresh` drive =E's Leibniz replacement. This
 * is why the theory-agnostic Fitch translator — which only ever emits
 * `Γ ⊢ φ by rule [refs]` — produces `.auf` the engine accepts for FOL with no
 * quantifier-specific code: the intelligence lives in these annotations.
 *
 * A small fixed signature (unary `F`, `G`; binary `R`) lets worked problems read
 * naturally (`∀ x (F x → G x)`, `R x y`). Instructors extend it with their own
 * predicates/names in the exercise's `:::aufbau-mm0` block.
 */
export const FORALLX_THEORY_MM0 = `delimiter $ ( ) [ / ] $;
provable sort wff;
sort ctx;

--| @vars s t u v w x y z
sort tm;

term imp (a b: wff): wff;
infixr imp: $→$ prec 25;
term and (a b: wff): wff;
infixl and: $∧$ prec 30;
term or (a b: wff): wff;
infixl or: $∨$ prec 28;
term neg (a: wff): wff;
prefix neg: $¬$ prec 45;
term bot: wff;
notation bot: wff = ($⊥$:max);

term iff (a b: wff): wff;
infixr iff: $↔$ prec 20;
term ctx_eq (g h: ctx): wff;
term emp: ctx;
notation emp: ctx = ($_$:max);

-- First-order syntax: quantifiers (MM0 binders), identity, a small signature,
-- and the substitution terms instantiation is written with.
term all {x: tm} (p: wff x): wff;
prefix all: $∀$ prec 46;
term ex {x: tm} (p: wff x): wff;
prefix ex: $∃$ prec 46;
term eq (a b: tm): wff;
infixl eq: $=$ prec 50;

term F (x: tm): wff;
term G (x: tm): wff;
term R (x y: tm): wff;

term sb_t {x: tm} (t: tm x) (a: tm x): tm;
notation sb_t {x: tm} (t: tm x) (a: tm x): tm =
  ($subst$:41) x ($/$:0) t a;
term sb_f {x: tm} (t: tm x) (p: wff x): wff;
notation sb_f {x: tm} (t: tm x) (p: wff x): wff =
  ($[$:41) x ($/$:0) t ($]$:0) p;

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

-- Identity is an equivalence relation on terms (the rewriting equality the
-- compiler uses to normalise substitutions; the ND rules =I / =E are below).
--| @relation tm eq eq_refl eq_trans eq_sym _
axiom eq_refl (a: tm): $ a = a $;
axiom eq_trans (a b c: tm): $ a = b $ > $ b = c $ > $ a = c $;
axiom eq_sym (a b: tm): $ a = b $ > $ b = a $;

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
--| @congr
axiom or_congr (a b c d: wff): $ a ↔ b $ > $ c ↔ d $ > $ (a ∨ c) ↔ (b ∨ d) $;
--| @congr
axiom neg_congr (a b: wff): $ a ↔ b $ > $ ¬ a ↔ ¬ b $;
--| @congr
axiom eq_congr (a b c d: tm): $ a = b $ > $ c = d $ > $ (a = c) ↔ (b = d) $;
--| @congr
axiom F_congr (a b: tm): $ a = b $ > $ F a ↔ F b $;
--| @congr
axiom G_congr (a b: tm): $ a = b $ > $ G a ↔ G b $;
--| @congr
axiom R_congr (a b c d: tm): $ a = b $ > $ c = d $ > $ R a c ↔ R b d $;
--| @congr
axiom all_congr {x: tm} (p q: wff x): $ p ↔ q $ > $ ∀ x p ↔ ∀ x q $;
--| @congr
axiom ex_congr {x: tm} (p q: wff x): $ p ↔ q $ > $ ∃ x p ↔ ∃ x q $;

-- Alpha-renaming, used by @freshen when a context already binds the same
-- variable a quantifier rule is trying to bind.
--| @alpha x y
axiom all_alpha {x y: tm} (p: wff x y): $ ∀ x p ↔ ∀ y ([x/y] p) $;
--| @alpha x y
axiom ex_alpha {x y: tm} (p: wff x y): $ ∃ x p ↔ ∃ y ([x/y] p) $;

-- Substitution rewriting: push [x/t] through the syntactic operators so the
-- compiler's @rewrite automation can normalise the substitutions that arise
-- from all_elim / ex_intro / eq_replace into concrete atoms.
--| @rewrite
axiom sb_f_imp {x: tm} (t: tm x) (p q: wff x): $ [x/t] (p → q) ↔ ([x/t] p → [x/t] q) $;
--| @rewrite
axiom sb_f_and {x: tm} (t: tm x) (p q: wff x): $ [x/t] (p ∧ q) ↔ ([x/t] p ∧ [x/t] q) $;
--| @rewrite
axiom sb_f_or {x: tm} (t: tm x) (p q: wff x): $ [x/t] (p ∨ q) ↔ ([x/t] p ∨ [x/t] q) $;
--| @rewrite
axiom sb_f_neg {x: tm} (t: tm x) (p: wff x): $ [x/t] (¬ p) ↔ ¬ ([x/t] p) $;
--| @rewrite
axiom sb_f_iff {x: tm} (t: tm x) (p q: wff x): $ [x/t] (p ↔ q) ↔ ([x/t] p ↔ [x/t] q) $;
--| @rewrite
axiom sb_f_bot {x: tm} (t: tm x): $ [x/t] ⊥ ↔ ⊥ $;
--| @rewrite
axiom sb_f_eq {x: tm} (t: tm x) (a b: tm x): $ [x/t] (a = b) ↔ (subst x / t a) = (subst x / t b) $;
--| @rewrite
axiom sb_f_F {x: tm} (t: tm x) (a: tm x): $ [x/t] (F a) ↔ F (subst x / t a) $;
--| @rewrite
axiom sb_f_G {x: tm} (t: tm x) (a: tm x): $ [x/t] (G a) ↔ G (subst x / t a) $;
--| @rewrite
axiom sb_f_R {x: tm} (t: tm x) (a b: tm x): $ [x/t] (R a b) ↔ R (subst x / t a) (subst x / t b) $;
--| @rewrite
axiom sb_f_all {x y: tm} (t: tm x) (p: wff x y): $ [x/t] (∀ y p) ↔ ∀ y ([x/t] p) $;
--| @rewrite
axiom sb_f_ex {x y: tm} (t: tm x) (p: wff x y): $ [x/t] (∃ y p) ↔ ∃ y ([x/t] p) $;
--| @rewrite
axiom sb_f_id {x: tm} (p: wff x): $ [x/x] p ↔ p $;
--| @rewrite
axiom sb_f_irrel {x: tm} (t: tm x) (p: wff): $ [x/t] p ↔ p $;
--| @rewrite
axiom sb_t_var {x: tm} (t: tm x): $ (subst x / t x) = t $;
--| @rewrite
axiom sb_t_irrel {x: tm} (t: tm x) (a: tm): $ (subst x / t a) = a $;

-- Structural: the assumption/premise rule, plus reiteration (weakening).
-- Every rule below joins one extra "slack" context variable into its
-- conclusion (the last ctx binder): implicit weakening, so a line may state
-- its conclusion in a larger ambient scope than its premises inhabit — the
-- Fitch translator's ambient contexts depend on it, and dependency-context
-- emitters (Prawitz/tree) simply bind it empty. ax and reit are the pattern.
axiom ax (g: ctx) (a: wff): $ g , a ⊢ a $;
axiom reit (g h: ctx) (a: wff): $ g ⊢ a $ > $ g , h ⊢ a $;

-- Conditional (→)
axiom imp_intro (g h: ctx) (a b: wff): $ g , a ⊢ b $ > $ g , h ⊢ a → b $;
axiom imp_elim (g h i: ctx) (a b: wff): $ g ⊢ a → b $ > $ h ⊢ a $ > $ g , h , i ⊢ b $;

-- Conjunction (∧)
axiom and_intro (g h i: ctx) (a b: wff): $ g ⊢ a $ > $ h ⊢ b $ > $ g , h , i ⊢ a ∧ b $;
axiom and_elim_l (g h: ctx) (a b: wff): $ g ⊢ a ∧ b $ > $ g , h ⊢ a $;
axiom and_elim_r (g h: ctx) (a b: wff): $ g ⊢ a ∧ b $ > $ g , h ⊢ b $;

-- Disjunction (∨)
axiom or_intro_l (g h: ctx) (a b: wff): $ g ⊢ a $ > $ g , h ⊢ a ∨ b $;
axiom or_intro_r (g h: ctx) (a b: wff): $ g ⊢ b $ > $ g , h ⊢ a ∨ b $;
axiom or_elim (g h i j: ctx) (a b c: wff): $ g ⊢ a ∨ b $ > $ h , a ⊢ c $ > $ i , b ⊢ c $ > $ g , h , i , j ⊢ c $;

-- Biconditional (↔)
axiom iff_intro (g h i: ctx) (a b: wff): $ g , a ⊢ b $ > $ h , b ⊢ a $ > $ g , h , i ⊢ a ↔ b $;
axiom iff_elim_l (g h i: ctx) (a b: wff): $ g ⊢ a ↔ b $ > $ h ⊢ a $ > $ g , h , i ⊢ b $;
axiom iff_elim_r (g h i: ctx) (a b: wff): $ g ⊢ a ↔ b $ > $ h ⊢ b $ > $ g , h , i ⊢ a $;

-- Negation, contradiction, explosion, indirect proof
axiom neg_intro (g h: ctx) (a: wff): $ g , a ⊢ ⊥ $ > $ g , h ⊢ ¬ a $;
axiom neg_elim (g h i: ctx) (a: wff): $ g ⊢ a $ > $ h ⊢ ¬ a $ > $ g , h , i ⊢ ⊥ $;
axiom explosion (g h: ctx) (a: wff): $ g ⊢ ⊥ $ > $ g , h ⊢ a $;
axiom ip (g h: ctx) (a: wff): $ g , ¬ a ⊢ ⊥ $ > $ g , h ⊢ a $;

-- Identity (=I is reflexivity under ⊢; =E is Leibniz replacement)
axiom eq_intro_nd (g: ctx) (a: tm): $ g ⊢ a = a $;

--| @view (g h i: ctx) {z: tm} (a b: tm) (p: wff z) (q r: wff): $ g ⊢ a = b $ > $ h ⊢ q $ > $ g , h , i ⊢ r $
--| @abstract p q r z a b
--| @fresh z
axiom eq_replace (g h i: ctx) {z: tm} (a b: tm) (p: wff z):
  $ g ⊢ a = b $ > $ h ⊢ [z/a] p $ > $ g , h , i ⊢ [z/b] p $;

-- Universal quantifier. The raw \`g: ctx\` binder is the eigenvariable side
-- condition: g may not depend on x. The @fallback handles the textbook case
-- where the subproof names the eigenvariable (u) differently from the ∀ binder.
--| @view {x u: tm} (g h: ctx x) (p q: wff x): $ g ⊢ q $ > $ g , h ⊢ ∀ x p $
--| @recover u q p x
axiom all_intro_sub {x u: tm} (g h: ctx x) (p: wff x):
  $ g ⊢ [x/u] p $ > $ g , h ⊢ ∀ x p $;

--| @freshen g x
--| @freshen h x
--| @fallback all_intro_sub
axiom all_intro (g h: ctx) {x: tm} (p: wff x):
  $ g ⊢ p $ > $ g , h ⊢ ∀ x p $;

--| @view {x: tm} (g h: ctx x) (t: tm x) (p: wff x) (q: wff): $ g ⊢ ∀ x p $ > $ g , h ⊢ q $
--| @recover t q p x
axiom all_elim {x: tm} (g h: ctx x) (t: tm x) (p: wff x):
  $ g ⊢ ∀ x p $ > $ g , h ⊢ [x/t] p $;

-- Existential quantifier. ∃I recovers the witness t; ∃E's raw \`c: wff\` binder
-- is the eigenvariable side condition (c may not depend on x, u), with a
-- @fallback for the textbook eigenvariable-renaming case.
--| @view {x: tm} (g h: ctx x) (t: tm x) (p: wff x) (q: wff): $ g ⊢ q $ > $ g , h ⊢ ∃ x p $
--| @recover t q p x
axiom ex_intro {x: tm} (g h: ctx x) (t: tm x) (p: wff x):
  $ g ⊢ [x/t] p $ > $ g , h ⊢ ∃ x p $;

--| @view {x u: tm} (g h i: ctx x) (p: wff x) (q c: wff): $ g ⊢ ∃ x p $ > $ h , q ⊢ c $ > $ g , h , i ⊢ c $
--| @recover u q p x
--| @freshen c x
--| @freshen c u
axiom ex_elim_sub {x u: tm} (g h i: ctx x) (p: wff x) (c: wff):
  $ g ⊢ ∃ x p $ > $ h , [x/u] p ⊢ c $ > $ g , h , i ⊢ c $;

--| @freshen c x
--| @fallback ex_elim_sub
axiom ex_elim {x: tm} (g h i: ctx) (p: wff x) (c: wff):
  $ g ⊢ ∃ x p $ > $ h , p ⊢ c $ > $ g , h , i ⊢ c $;`;

/** The `:::aufbau-mm0{name="forallx"}` block wrapping {@link FORALLX_THEORY_MM0}. */
export const FORALLX_THEORY_BLOCK = `:::aufbau-mm0{name="forallx"}\n${FORALLX_THEORY_MM0}\n:::`;
