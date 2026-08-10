/**
 * First-order notation systems for the model exercise type.
 *
 * The original Carnap parses first-order formulas through fourteen
 * textbook-specific parsers, each a `FirstOrderParserOptions` record
 * (`Carnap/src/Carnap/Languages/PureFirstOrder/Parser.hs`). This is the same
 * idea as one data table: a dialect says which letters name what, how each
 * connective may be spelled, how tightly the connectives bind, and which
 * shapes the system refuses. {@link parseFormula} is one parser driven by it.
 *
 * DOM-free and dependency-free — the worker imports it to compile and grade,
 * and the client element imports it to check a model locally.
 *
 * Only `forallx-calgary-2019` ships. `system=` is nonetheless validated at
 * authoring time against {@link FIRST_ORDER_DIALECTS}, so content authored now
 * keeps working when a second dialect lands.
 */

/** The four two-place connectives, in every dialect. */
export type BinaryConnective = "and" | "or" | "if" | "iff";

/**
 * How the operators sharing one precedence level may be chained.
 *
 * `"none"` is not a formatting preference: forallx holds that `P -> Q -> R`
 * has no reading, so a dialect that says `"none"` must reject it rather than
 * pick a grouping. Carnap spells this `AssocNone` in its operator tables.
 */
export type Associativity = "left" | "right" | "none";

/**
 * How a formula is written back out for a reader.
 *
 * Carnap keeps this separate from parsing: the symbols come from the lexicon's
 * `Schematizable` instances, which are fixed and always logical
 * (`∀x`, `¬`, `(P ∧ Q)` — every binary compound parenthesized), and then each
 * system applies its own `ndNotation` rewriter on top.
 *
 *   - `drop-outer-parens` removes the one redundant pair that wrapping every
 *     binary leaves around the whole formula. This is Carnap's
 *     `dropOuterParens`, the rewriter the 2019 Calgary systems use.
 *
 * The other rewriter in Carnap worth a value here is the pre-2019 Calgary one,
 * which juxtaposes a predicate's arguments (`F(a,b)` → `Fab`); it arrives with
 * that dialect.
 */
export type DisplayNotation = "drop-outer-parens";

/** One rung of the precedence ladder. */
export interface PrecedenceLevel {
  readonly associativity: Associativity;
  /** The connectives that bind equally loosely at this rung. */
  readonly operators: readonly BinaryConnective[];
}

/** The accepted spellings of each connective, longest match first. */
export interface ConnectiveSpellings {
  readonly and: readonly string[];
  readonly if: readonly string[];
  readonly iff: readonly string[];
  readonly not: readonly string[];
  readonly or: readonly string[];
}

export interface FirstOrderDialect {
  /**
   * Bracket pairs that may enclose a subformula. A group must close with the
   * partner of the bracket that opened it.
   */
  readonly brackets: readonly (readonly [string, string])[];
  readonly connectives: ConnectiveSpellings;
  /** Letters that name an individual constant. */
  readonly constantLetters: string;
  /** How {@link formulaToDisplay} writes a formula back out for a reader. */
  readonly displayNotation: DisplayNotation;
  /** Spellings of falsum, when {@link hasBooleanConstants}. */
  readonly falsum: readonly string[];
  /** Letters that name a function symbol. Empty when the dialect has none. */
  readonly functionLetters: string;
  /** Whether `⊥` and `⊤` are sentences of the language. */
  readonly hasBooleanConstants: boolean;
  readonly id: string;
  /** Spellings of identity, an infix relation between two terms. */
  readonly identity: readonly string[];
  /** Spellings of `≠`, sugar for a negated identity. */
  readonly inequality: readonly string[];
  /**
   * Whether a bracket group may enclose only a sentence whose main connective
   * is binary — forallx's parenthesization convention, which makes `(P)`,
   * `(~P)` and `(AxF(x))` mistakes rather than harmless noise. Carnap
   * implements it as the `zachDispatch` guard on `parenRecur`.
   */
  readonly parenthesizeBinaryOnly: boolean;
  /**
   * Precedence rungs, **loosest first**. Negation is not listed: it is always
   * the tightest-binding operator, and its scope is a single primary.
   */
  readonly precedence: readonly PrecedenceLevel[];
  /** Letters that name a predicate. A 0-place predicate is a sentence letter. */
  readonly predicateLetters: string;
  /**
   * Whether a predicate's arguments are parenthesized (`F(x)`, `R(x,y)`) as in
   * the 2019 forallx, rather than juxtaposed (`Fx`, `Rxy`) as in the earlier
   * edition. A dialect that juxtaposes cannot have function symbols with the
   * same letters, which is why the two travel together.
   */
  readonly predicatesTakeParens: boolean;
  readonly quantifiers: {
    readonly exists: readonly string[];
    readonly forall: readonly string[];
  };
  /**
   * Whether every formula must be a sentence. Carnap's Calgary systems set
   * `finalValidation` to reject an unbound variable, which is why the
   * original's `universalClosure` — reading `F(x)` as `AxF(x)` — never fires
   * for them. A dialect that sets this `false` needs that closure step added
   * to the evaluator before it can be used.
   */
  readonly requiresClosedFormulas: boolean;
  /** Spellings of verum, when {@link hasBooleanConstants}. */
  readonly verum: readonly string[];
  /** Letters that name a variable. */
  readonly variableLetters: string;
}

/**
 * forallx: Calgary, 2019 edition and later — Carnap's
 * `thomasBolducAndZachFOL2019ParserOptions` over `calgary2019OpTable`.
 *
 * Three spellings Carnap accepts are deliberately absent, and the README says
 * so: the English word operators (`not`, `and`, `or`, `only if`, `if and only
 * if`), which collide with the constant and function letters `a`–`t`; the
 * `^n` arity annotation, which Carnap parses and discards; and `v` for
 * disjunction, which Carnap's Calgary tables also omit because `v` is a
 * variable letter here.
 */
export const FORALLX_CALGARY_2019: FirstOrderDialect = {
  brackets: [
    ["(", ")"],
    ["[", "]"],
  ],
  connectives: {
    and: ["/\\", "∧", "^", "&"],
    if: ["->", "=>", "→", "⊃", ">"],
    iff: ["<->", "<=>", "<>", "↔", "≡"],
    not: ["~", "¬", "-"],
    or: ["\\/", "∨", "|"],
  },
  constantLetters: "abcdefghijklmnopqr",
  displayNotation: "drop-outer-parens",
  falsum: ["⊥", "_|_", "!?"],
  functionLetters: "abcdefghijklmnopqrst",
  hasBooleanConstants: true,
  id: "forallx-calgary-2019",
  identity: ["="],
  inequality: ["!=", "≠"],
  parenthesizeBinaryOnly: true,
  // `/\` and `\/` share a rung, so there is no precedence between them at all:
  // `P /\ Q \/ R` is `(P /\ Q) \/ R` by association, not because `/\` is
  // tighter. `->` and `<->` share the looser rung and refuse to chain.
  precedence: [
    { associativity: "none", operators: ["if", "iff"] },
    { associativity: "left", operators: ["and", "or"] },
  ],
  predicateLetters: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  predicatesTakeParens: true,
  quantifiers: {
    exists: ["E", "∃", "3"],
    forall: ["A", "∀", "@"],
  },
  requiresClosedFormulas: true,
  verum: ["⊤"],
  variableLetters: "stuvwxyz",
};

/** Every dialect an author may name in `system=`, by id. */
export const FIRST_ORDER_DIALECTS: Readonly<
  Record<string, FirstOrderDialect>
> = {
  [FORALLX_CALGARY_2019.id]: FORALLX_CALGARY_2019,
};

export const DEFAULT_DIALECT_ID = FORALLX_CALGARY_2019.id;

/** The dialect an author named, or `null` if no such system exists. */
export function dialectById(id: string): FirstOrderDialect | null {
  return FIRST_ORDER_DIALECTS[id] ?? null;
}

/**
 * Every operator spelling a dialect uses, longest first.
 *
 * Longest-first is what keeps overlapping spellings apart without a
 * hand-ordered token list: `->` must be tried before `-` (negation), `=>`
 * before `=` (identity), `<->` before `<>`, and `!=` before `!?`.
 */
export function operatorSpellings(
  dialect: FirstOrderDialect,
): readonly { readonly kind: OperatorKind; readonly text: string }[] {
  const spellings: { kind: OperatorKind; text: string }[] = [];
  const add = (kind: OperatorKind, texts: readonly string[]): void => {
    for (const text of texts) {
      spellings.push({ kind, text });
    }
  };

  add("not", dialect.connectives.not);
  add("and", dialect.connectives.and);
  add("or", dialect.connectives.or);
  add("if", dialect.connectives.if);
  add("iff", dialect.connectives.iff);
  add("inequality", dialect.inequality);
  add("identity", dialect.identity);

  if (dialect.hasBooleanConstants) {
    add("falsum", dialect.falsum);
    add("verum", dialect.verum);
  }

  return spellings.sort(
    (left, right) => right.text.length - left.text.length,
  );
}

export type OperatorKind =
  | BinaryConnective
  | "falsum"
  | "identity"
  | "inequality"
  | "not"
  | "verum";
