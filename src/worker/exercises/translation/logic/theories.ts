/**
 * The theory behind translation grading: a one-sided (Tait/Schütte) sequent
 * calculus for classical logic, generated around the signature of the two
 * formulas being compared. Two formulas count as equivalent exactly when the
 * engine's `auto?` search can prove `⊢ S ↔ T` in this calculus — so the
 * calculus *is* the equivalence relation, and every change to it must go
 * through the regression battery in `tests/translation-engine.test.ts`.
 *
 * The shape is ported from `tests/proof_cases/tait.mm0` in gleachkr/Aufbau,
 * whose comments explain the calculus at length. The short version: a sequent
 * is a single ACUI succedent `⊢ Δ`, each connective gets a *positive*
 * introduction rule plus a *De Morgan* rule for its negated form (which drives
 * `¬` to the atoms), and the whole first-order fragment runs on `rall`
 * (eigenvariable) and `rex` (witness). The eigenvariable side condition is
 * carried by MM0's dependency discipline — a context `d: ctx` cannot mention a
 * rule's bound `{x: obj}` — and `@freshen`/`@alpha` repair benign
 * alpha-collisions.
 *
 * **Why a proof calculus rather than a rewrite theory.** The obvious
 * alternative is an egraph of `@conversion` laws saturated by `conversion?`.
 * That was the first design, and it foundered on quantifier *shape*: the
 * egraph is nominal, so `∀x P(x)` and `∀y P(y)` never share a class and no
 * rewrite law can rename a binder. Alpha has to be spent at emission by
 * choosing names, and the parallel form `∀xF ∧ ∀yG` needs its two binders to
 * *share* a name (that is what lets a distribution law fire) while the nested
 * form `∀x∀y(F ∧ G)` forces them *apart* — contradictory demands no static
 * naming satisfies. Here the binders are ordinary inference-rule binders, each
 * quantifier occurrence gets its own name, and the cross-shape equivalences
 * that were unreachable are proved directly.
 *
 * One trap is worth reading before touching the `@vars` pool: its tokens
 * must not overlap the goal's own binders, or witness invention silently stops
 * working. {@link SPARE_VARS} explains why.
 *
 * Adding a language (modal, say) means a dialect entry in
 * `exercises/first-order/dialect.ts` for the surface syntax, and a rule set
 * here whose sequent rules axiomatize its consequence relation.
 */

/** Everything the generated theory needs to know about the two formulas: the
 * symbols they mention, and the bound-variable names emission chose. */
export interface TranslationSignature {
  /** Mangled predicate name → arity, in emission order. */
  readonly predicates: ReadonlyMap<string, number>;
  /** Mangled function name → arity. */
  readonly functions: ReadonlyMap<string, number>;
  /** Mangled constant names. */
  readonly constants: readonly string[];
  /** Whether either formula uses `=`. */
  readonly usesIdentity: boolean;
  /** Bound-variable names, one per quantifier occurrence. */
  readonly boundNames: readonly string[];
}

/** A signature needs the first-order machinery (objects, substitution,
 * quantifier rules) unless both formulas are purely propositional. */
export function isFirstOrder(signature: TranslationSignature): boolean {
  return (
    signature.boundNames.length > 0 ||
    signature.constants.length > 0 ||
    signature.functions.size > 0 ||
    signature.usesIdentity ||
    [...signature.predicates.values()].some((arity) => arity > 0)
  );
}

const HEADER = `delimiter $ ( ) [ / ] $;

provable sort form;
sort ctx;
`;

/** The connectives, plus the two truth constants forallx spells `⊤`/`⊥`. */
const CONNECTIVES = `term im (a b: form): form;
infixr im: $→$ prec 25;
term an (a b: form): form;
infixr an: $∧$ prec 35;
term or (a b: form): form;
infixr or: $∨$ prec 30;
term not (a: form): form;
prefix not: $¬$ prec 40;
term bi (a b: form): form;
infixl bi: $↔$ prec 20;
term top: form;
notation top: form = ($⊤$:max);
term bot: form;
notation bot: form = ($⊥$:max);
`;

/** Succedents are ACUI sets of formulas; a one-sided sequent is a single one. */
const CONTEXTS = `term ctx_eq (g h: ctx): form;
term emp: ctx;
notation emp: ctx = ($∅$:max);

--| @acui ctx_assoc ctx_comm emp ctx_idem
term join (g h: ctx): ctx;
infixl join: $,$ prec 5;
term hyp (a: form): ctx;
coercion hyp: form > ctx;

term seq (d: ctx): form;
prefix seq: $⊢$ prec 1;
`;

/** The relation batteries the compiler's rewrite machinery runs on: `bi` on
 * formulas, ACUI equality on contexts. */
const RELATIONS = `--| @relation form bi biid bitr bisym mpbi
axiom biid (a: form): $ a ↔ a $;
axiom bitr (a b c: form): $ a ↔ b $ > $ b ↔ c $ > $ a ↔ c $;
axiom bisym (a b: form): $ a ↔ b $ > $ b ↔ a $;
axiom mpbi (a b: form): $ a ↔ b $ > $ a $ > $ b $;

--| @relation ctx ctx_eq ctx_refl ctx_trans ctx_sym _
axiom ctx_refl (g: ctx): $ ctx_eq g g $;
axiom ctx_trans (g h i: ctx): $ ctx_eq g h $ > $ ctx_eq h i $ > $ ctx_eq g i $;
axiom ctx_sym (g h: ctx): $ ctx_eq g h $ > $ ctx_eq h g $;
axiom ctx_assoc (g h i: ctx): $ ctx_eq ((g , h) , i) (g , (h , i)) $;
axiom ctx_comm (g h: ctx): $ ctx_eq (g , h) (h , g) $;
axiom ctx_idem (g: ctx): $ ctx_eq (g , g) g $;
axiom ctx_unit (g: ctx): $ ctx_eq (emp , g) g $;

--| @congr
axiom join_congr (g1 g2 h1 h2: ctx):
  $ ctx_eq g1 g2 $ > $ ctx_eq h1 h2 $ > $ ctx_eq (g1 , h1) (g2 , h2) $;
--| @congr
axiom hyp_congr (a b: form): $ a ↔ b $ > $ ctx_eq (hyp a) (hyp b) $;
--| @congr
axiom seq_congr (e f: ctx): $ ctx_eq e f $ > $ (⊢ e) ↔ (⊢ f) $;
--| @congr
axiom im_congr (a b c d: form): $ a ↔ b $ > $ c ↔ d $ > $ (a → c) ↔ (b → d) $;
--| @congr
axiom an_congr (a b c d: form): $ a ↔ b $ > $ c ↔ d $ > $ (a ∧ c) ↔ (b ∧ d) $;
--| @congr
axiom or_congr (a b c d: form): $ a ↔ b $ > $ c ↔ d $ > $ (a ∨ c) ↔ (b ∨ d) $;
--| @congr
axiom not_congr (a b: form): $ a ↔ b $ > $ ¬ a ↔ ¬ b $;
`;

/**
 * Objects, quantifiers, and the substitution terms the quantifier rules
 * normalize through, plus the `@vars` witness pool. Declarations only: the
 * axioms about these terms come after the relation batteries, which they cite.
 */
function objectTerms(): string {
  return `--| @vars ${SPARE_VARS.join(" ")}
sort obj;

term all {x: obj} (p: form x): form;
prefix all: $∀$ prec 41;
term ex {x: obj} (p: form x): form;
prefix ex: $∃$ prec 41;

term sb_f {x: obj} (t: obj x) (p: form x): form;
notation sb_f {x: obj} (t: obj x) (p: form x): form =
  ($[$:41) x ($/$:0) t ($]$:0) p;
term sb_t {x: obj} (t: obj x) (a: obj x): obj;
notation sb_t {x: obj} (t: obj x) (a: obj x): obj =
  ($subst$:41) x ($/$:0) t a;

term eq (a b: obj): form;
infixl eq: $=$ prec 50;
`;
}

/** Equality on objects, quantifier congruence, and the `@alpha` rules
 * `@freshen` reaches for when a succedent already binds the name a quantifier
 * rule wants. */
const OBJECT_RELATIONS = `--| @relation obj eq eq_refl eq_trans eq_sym _
axiom eq_refl (a: obj): $ a = a $;
axiom eq_trans (a b c: obj): $ a = b $ > $ b = c $ > $ a = c $;
axiom eq_sym (a b: obj): $ a = b $ > $ b = a $;

--| @congr
axiom all_congr {x: obj} (p q: form x): $ p ↔ q $ > $ ∀ x p ↔ ∀ x q $;
--| @congr
axiom ex_congr {x: obj} (p q: form x): $ p ↔ q $ > $ ∃ x p ↔ ∃ x q $;

--| @alpha x y
axiom all_alpha {x y: obj} (p: form x y): $ ∀ x p ↔ ∀ y ([x/y] p) $;
--| @alpha x y
axiom ex_alpha {x y: obj} (p: form x y): $ ∃ x p ↔ ∃ y ([x/y] p) $;
`;

/**
 * The `@vars` witness pool: names for a witness the proof has to invent.
 *
 * **These must never overlap the goal's own binders.** The engine materializes
 * every pool token as a theorem-local dummy, in sorted order, and a token that
 * is already a binder of the theorem quietly takes that binder instead of a
 * fresh dummy — after which witness invention offers the goal's *own* bound
 * variable, the dependency check refuses it, and the branch dies. It shows up
 * as an exhausted search with `rex` tried dozens of times and never accepted,
 * never as an error. So: `k*` here, `v*` for binders (see `mm0.ts`), and the
 * two namespaces must stay apart. Sorting before `v0` is belt and braces —
 * the pool is consumed lowest-first.
 */
const SPARE_VARS = ["k0", "k1", "k2", "k3"] as const;

/** Substitution pushed through the syntactic operators, so the `@rewrite`
 * automation can normalize the `[x/t] p` instances `rex` emits. The
 * signature's own symbols get their cases from `signatureRules`. */
const SUBSTITUTION = `--| @rewrite
axiom sb_t_var {x: obj} (t: obj x): $ (subst x / t x) = t $;
--| @rewrite
axiom sb_t_other {x y: obj} (t: obj x): $ (subst x / t y) = y $;
--| @rewrite
axiom sb_t_irrel {x: obj} (t: obj x) (a: obj): $ (subst x / t a) = a $;
--| @rewrite
axiom sb_f_irrel {x: obj} (t: obj x) (p: form): $ [x/t] p ↔ p $;
--| @rewrite
axiom sb_f_im {x: obj} (t: obj x) (p q: form x):
  $ [x/t] (p → q) ↔ ([x/t] p → [x/t] q) $;
--| @rewrite
axiom sb_f_bi {x: obj} (t: obj x) (p q: form x):
  $ [x/t] (p ↔ q) ↔ ([x/t] p ↔ [x/t] q) $;
--| @rewrite
axiom sb_f_an {x: obj} (t: obj x) (p q: form x):
  $ [x/t] (p ∧ q) ↔ ([x/t] p ∧ [x/t] q) $;
--| @rewrite
axiom sb_f_or {x: obj} (t: obj x) (p q: form x):
  $ [x/t] (p ∨ q) ↔ ([x/t] p ∨ [x/t] q) $;
--| @rewrite
axiom sb_f_not {x: obj} (t: obj x) (p: form x): $ [x/t] (¬ p) ↔ ¬ [x/t] p $;
--| @rewrite
axiom sb_f_all {x y: obj} (t: obj x) (p: form x y):
  $ [x/t] (∀ y p) ↔ ∀ y ([x/t] p) $;
--| @rewrite
axiom sb_f_ex {x y: obj} (t: obj x) (p: form x y):
  $ [x/t] (∃ y p) ↔ ∃ y ([x/t] p) $;
`;

/**
 * The propositional half of the Tait rule set. Every rule here is invertible,
 * so all are `@auto eager`: tried first, committed to once applied, and exempt
 * from the depth budget. Priority 1 is the non-branching (alpha) ladder,
 * priority 2 the branching (beta) rules — the classic tableau discipline.
 * `ax` and the two truth-constant closers stay un-enrolled; closing rules are
 * tried first anyway.
 */
const PROPOSITIONAL_RULES = `axiom ax (d: ctx) (a: form): $ ⊢ a , (¬ a) , d $;
axiom rtop (d: ctx): $ ⊢ ⊤ , d $;
axiom rnbot (d: ctx): $ ⊢ (¬ ⊥) , d $;

--| @auto eager
axiom rbot (d: ctx): $ ⊢ d $ > $ ⊢ ⊥ , d $;
--| @auto eager
axiom rntop (d: ctx): $ ⊢ d $ > $ ⊢ (¬ ⊤) , d $;

--| @auto eager
axiom ror (d: ctx) (a b: form): $ ⊢ a , b , d $ > $ ⊢ (a ∨ b) , d $;
--| @auto eager 2
axiom rand (d: ctx) (a b: form): $ ⊢ a , d $ > $ ⊢ b , d $ > $ ⊢ (a ∧ b) , d $;
--| @auto eager
axiom rim (d: ctx) (a b: form): $ ⊢ (¬ a) , b , d $ > $ ⊢ (a → b) , d $;
--| @auto eager 2
axiom rbi (d: ctx) (a b: form):
  $ ⊢ (a → b) , d $ > $ ⊢ (b → a) , d $ > $ ⊢ (a ↔ b) , d $;

--| @auto eager
axiom rdm_not (d: ctx) (a: form): $ ⊢ a , d $ > $ ⊢ (¬ ¬ a) , d $;
--| @auto eager
axiom rdm_im (d: ctx) (a b: form): $ ⊢ (a ∧ ¬ b) , d $ > $ ⊢ ¬ (a → b) , d $;
--| @auto eager
axiom rdm_an (d: ctx) (a b: form):
  $ ⊢ (¬ a ∨ ¬ b) , d $ > $ ⊢ ¬ (a ∧ b) , d $;
--| @auto eager
axiom rdm_or (d: ctx) (a b: form):
  $ ⊢ (¬ a ∧ ¬ b) , d $ > $ ⊢ ¬ (a ∨ b) , d $;
--| @auto eager
axiom rdm_bi (d: ctx) (a b: form):
  $ ⊢ (¬ (a → b) ∨ ¬ (b → a)) , d $ > $ ⊢ ¬ (a ↔ b) , d $;
`;

/**
 * The quantifier rules. `rall`'s eigenvariable is its bound `{x: obj}`, which
 * `d: ctx` cannot depend on — that *is* the "x not free in Δ" proviso.
 * `rex` keeps its principal `∃` (contraction), which is what makes goals like
 * the drinker paradox provable cut-free; its witness is exposed through a
 * `@view`/`@recover` pair so the search can read one back from the sub-proof.
 */
const QUANTIFIER_RULES = `--| @freshen d x
axiom rall (d: ctx) {x: obj} (p: form x): $ ⊢ p , d $ > $ ⊢ (∀ x p) , d $;

--| @view {x: obj} (d: ctx x) (t: obj x) (p: form x) (q: form): $ ⊢ q , (∃ x p) , d $ > $ ⊢ (∃ x p) , d $
--| @recover t q p x
--| @freshen d x
--| @auto backward
axiom rex (d: ctx) {x: obj} (p: form x) (t: obj):
  $ ⊢ [x/t] p , (∃ x p) , d $ > $ ⊢ (∃ x p) , d $;

--| @freshen d x
--| @auto eager
axiom rdm_all (d: ctx) {x: obj} (p: form x):
  $ ⊢ (∃ x (¬ p)) , d $ > $ ⊢ ¬ (∀ x p) , d $;
--| @freshen d x
--| @auto eager
axiom rdm_ex (d: ctx) {x: obj} (p: form x):
  $ ⊢ (∀ x (¬ p)) , d $ > $ ⊢ ¬ (∃ x p) , d $;
`;

/** Congruence and substitution cases for the symbols the two formulas
 * actually use. A nullary predicate needs neither: `sb_f_irrel` already
 * covers a formula that cannot mention the substituted variable. */
function signatureRules(signature: TranslationSignature): string {
  const lines: string[] = [];

  const argNames = (count: number, prefix: string): string[] =>
    Array.from({ length: count }, (_, i) => `${prefix}${String(i)}`);

  const emitCongruence = (
    name: string,
    arity: number,
    resultSort: "form" | "obj",
  ): void => {
    if (arity === 0) {
      return;
    }
    const left = argNames(arity, "a");
    const right = argNames(arity, "b");
    // `@congr` binders must be declared interleaved: old₀ new₀ old₁ new₁ …
    const binders = `(${left.flatMap((a, i) => [a, right[i] as string]).join(" ")}: obj)`;
    const premises = left.map((a, i) => `$ ${a} = ${right[i]} $ > `).join("");
    const relation = resultSort === "form" ? "↔" : "=";
    lines.push("--| @congr");
    lines.push(
      `axiom ${name}_congr ${binders}:`,
      `  ${premises}$ (${name} ${left.join(" ")}) ${relation} (${name} ${right.join(" ")}) $;`,
    );
  };

  const emitSubstitution = (name: string, arity: number): void => {
    if (arity === 0) {
      return;
    }
    const args = argNames(arity, "a");
    const instances = args.map((arg) => `(subst x / t ${arg})`).join(" ");
    lines.push("--| @rewrite");
    lines.push(
      `axiom ${name}_sb {x: obj} (t: obj x) (${args.join(" ")}: obj x):`,
      `  $ [x/t] (${name} ${args.join(" ")}) ↔ (${name} ${instances}) $;`,
    );
  };

  for (const [name, arity] of signature.predicates) {
    emitCongruence(name, arity, "form");
    emitSubstitution(name, arity);
  }
  for (const [name, arity] of signature.functions) {
    emitCongruence(name, arity, "obj");
    emitSubstitution(name, arity);
  }
  if (signature.usesIdentity) {
    emitCongruence("ideq", 2, "form");
    emitSubstitution("ideq", 2);
  }

  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/** The term declarations for the signature's own symbols. */
function signatureTerms(signature: TranslationSignature): string {
  const lines: string[] = [];
  const objArgs = (arity: number): string =>
    arity === 0
      ? ""
      : ` (${Array.from({ length: arity }, (_, i) => `a${String(i)}`).join(" ")}: obj)`;

  for (const [name, arity] of signature.predicates) {
    lines.push(`term ${name}${objArgs(arity)}: form;`);
  }
  for (const name of signature.constants) {
    lines.push(`term ${name}: obj;`);
  }
  for (const [name, arity] of signature.functions) {
    lines.push(`term ${name}${objArgs(arity)}: obj;`);
  }
  if (signature.usesIdentity) {
    lines.push("term ideq (a b: obj): form;");
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/**
 * The complete MM0 theory for one equivalence check: the calculus, plus
 * declarations and rules for the symbols the two formulas use. Purely
 * propositional signatures get the propositional fragment only — no objects,
 * no substitution, no quantifier rules — which keeps a refused prop check an
 * order of magnitude cheaper than a first-order one.
 */
export function buildTheory(signature: TranslationSignature): string {
  const firstOrder = isFirstOrder(signature);
  const sections = [
    HEADER,
    CONNECTIVES,
    firstOrder ? objectTerms() : "",
    CONTEXTS,
    signatureTerms(signature),
    RELATIONS,
    firstOrder ? OBJECT_RELATIONS : "",
    firstOrder ? SUBSTITUTION : "",
    signatureRules(signature),
    PROPOSITIONAL_RULES,
    firstOrder ? QUANTIFIER_RULES : "",
  ];
  return sections.filter((section) => section !== "").join("\n");
}
