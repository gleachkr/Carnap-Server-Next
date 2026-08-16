/**
 * First-order syntax for the exercise types that read formulas — the model and
 * the translation: one tokenizer and one recursive-descent parser, both driven
 * by a {@link FirstOrderDialect}.
 *
 * DOM-free and imported by BOTH the worker (to compile an exercise and grade
 * authoritatively) and the client elements (for the local Check), so it must
 * not reach for any platform globals.
 *
 * The grammar mirrors Carnap's `coreSubformulaParser`
 * (`Carnap/src/Carnap/Languages/PureFirstOrder/Parser.hs:377`), which is worth
 * stating because two of its choices surprise people:
 *
 *   - **A quantifier's scope is a single primary**, not the rest of the
 *     formula. `AxF(x) -> G(a)` is `(AxF(x)) -> G(a)`; to quantify over the
 *     conditional you write `Ax(F(x) -> G(a))`. Negation scopes the same way.
 *   - **Precedence comes from the dialect**, and forallx's table gives `/\` and
 *     `\/` the *same* rung. `P /\ Q \/ R` is `(P /\ Q) \/ R` by left
 *     association — not because conjunction binds tighter, which it does not.
 *
 * Errors follow the same contract as the propositional parser next door
 * (`../truth-table/logic/formula.ts`): an unfilled English template plus its
 * values, addressed to whoever wrote the formula. Neither this module nor the
 * compiler has a translator; the revision editor words the pair together in the
 * viewer's language.
 */

import type { DiagnosticMessageId } from "../../application/content/diagnostic-strings";
import type { TranslatableMessage } from "../../i18n/translator";
import type {
  BinaryConnective,
  FirstOrderDialect,
  OperatorKind,
} from "./dialect";
import { operatorSpellings } from "./dialect";

export type { BinaryConnective } from "./dialect";

/**
 * A term: a variable, an individual constant, or a function symbol applied to
 * terms. `name` is the surface spelling including any subscript (`x`, `a_2`),
 * which is both how it is shown back to the student and how a model keys it.
 */
export type Term =
  | { readonly type: "variable"; readonly name: string }
  | { readonly type: "constant"; readonly name: string }
  | {
      readonly type: "function";
      readonly name: string;
      readonly args: readonly Term[];
    };

/**
 * A formula. A `predicate` with no arguments is a sentence letter — one node
 * type rather than two, because a model interprets them the same way (by
 * symbol and arity) and the field list only needs the arity to tell a
 * True/False select from an extension.
 */
export type Formula =
  | {
      readonly type: "predicate";
      readonly name: string;
      readonly args: readonly Term[];
    }
  | { readonly type: "identity"; readonly left: Term; readonly right: Term }
  | { readonly type: "falsum" }
  | { readonly type: "verum" }
  | { readonly type: "not"; readonly operand: Formula }
  | {
      readonly type: BinaryConnective;
      readonly left: Formula;
      readonly right: Formula;
    }
  | {
      readonly type: "forall" | "exists";
      readonly variable: string;
      readonly body: Formula;
    };

/**
 * One reason a formula would not parse, addressed to whoever wrote it.
 *
 * The prose is an unfilled English template plus its values rather than a
 * finished sentence: the authoring compiler quotes these inside its own
 * `invalid_formula` diagnostic, and the revision editor words both together in
 * the viewer's language.
 */
export interface ParseError extends TranslatableMessage {
  readonly message: DiagnosticMessageId;
  /** Zero-based character offset into the source where the problem was found. */
  readonly position: number;
}

export type ParseResult =
  | { readonly ok: true; readonly formula: Formula }
  | { readonly ok: false; readonly errors: readonly ParseError[] };

type TokenType =
  | OperatorKind
  | "quantifier"
  | "symbol"
  | "comma"
  | "lbracket"
  | "rbracket";

interface Token {
  readonly start: number;
  readonly type: TokenType;
  /**
   * For `symbol`, the full spelling with its subscript (`F_1`, `x`); for
   * `quantifier`, `"forall"` or `"exists"`; for a bracket, the bracket
   * character; otherwise the surface operator.
   */
  readonly value: string;
}

class ParseFailure extends Error {
  constructor(readonly detail: ParseError) {
    super(detail.message);
    this.name = "ParseFailure";
  }
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isLetter(char: string): boolean {
  return (char >= "A" && char <= "Z") || (char >= "a" && char <= "z");
}

function isSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

/**
 * Whether a letter belongs to one of a dialect's symbol classes.
 *
 * Not `letters.includes(char)` directly, because every string contains the
 * empty string: at end of input that reads `A` as a quantifier waiting for a
 * variable rather than as the sentence letter A.
 */
function isIn(letters: string, char: string): boolean {
  return char !== "" && letters.includes(char);
}

/**
 * Split the source into tokens.
 *
 * One position needs lookahead. In forallx the quantifier symbols `A` and `E`
 * are also predicate letters, so `A` alone is ambiguous. It resolves the way
 * Carnap's parser resolves it by ordered alternatives: a quantifier symbol
 * followed immediately by a variable letter is a quantifier, and anything else
 * is a predicate or sentence letter. The unambiguous glyphs (`∀`, `∃`, `@`,
 * `3`) need no lookahead, and are still accepted where a letter would not be.
 */
function tokenize(
  source: string,
  dialect: FirstOrderDialect,
): { ok: true; tokens: Token[] } | { ok: false; error: ParseError } {
  const operators = operatorSpellings(dialect);
  const openers = dialect.brackets.map(([open]) => open);
  const closers = dialect.brackets.map(([, close]) => close);
  const tokens: Token[] = [];
  let index = 0;

  const quantifierAt = (
    position: number,
  ): { kind: "forall" | "exists"; symbol: string } | null => {
    for (const kind of ["forall", "exists"] as const) {
      for (const symbol of dialect.quantifiers[kind]) {
        if (!source.startsWith(symbol, position)) {
          continue;
        }

        // A letter that is also a predicate letter only quantifies when a
        // variable follows it; `A` on its own is the sentence letter A.
        const ambiguous =
          symbol.length === 1 && isIn(dialect.predicateLetters, symbol);
        const next = source[position + symbol.length] ?? "";

        if (!ambiguous || isIn(dialect.variableLetters, next)) {
          return { kind, symbol };
        }
      }
    }

    return null;
  };

  while (index < source.length) {
    const char = source[index] ?? "";

    if (isSpace(char)) {
      index += 1;
      continue;
    }

    if (openers.includes(char)) {
      tokens.push({ start: index, type: "lbracket", value: char });
      index += 1;
      continue;
    }

    if (closers.includes(char)) {
      tokens.push({ start: index, type: "rbracket", value: char });
      index += 1;
      continue;
    }

    if (char === ",") {
      tokens.push({ start: index, type: "comma", value: "," });
      index += 1;
      continue;
    }

    const quantifier = quantifierAt(index);

    if (quantifier !== null) {
      tokens.push({
        start: index,
        type: "quantifier",
        value: quantifier.kind,
      });
      index += quantifier.symbol.length;
      continue;
    }

    const operator = operators.find((candidate) =>
      source.startsWith(candidate.text, index),
    );

    if (operator !== undefined) {
      tokens.push({
        start: index,
        type: operator.kind,
        value: operator.text,
      });
      index += operator.text.length;
      continue;
    }

    if (isLetter(char)) {
      let end = index + 1;

      // A subscript is `_` and at least one digit; a lone `_` is not one.
      if (source[end] === "_" && isDigit(source[end + 1] ?? "")) {
        end += 2;

        while (end < source.length && isDigit(source[end] ?? "")) {
          end += 1;
        }
      }

      tokens.push({
        start: index,
        type: "symbol",
        value: source.slice(index, end),
      });
      index = end;
      continue;
    }

    return {
      error: {
        message: "Unexpected character “{character}”.",
        params: { character: char },
        position: index,
      },
      ok: false,
    };
  }

  return { ok: true, tokens };
}

/** Whether a formula's main connective is one of the two-place ones. */
function isBinary(formula: Formula): boolean {
  return (
    formula.type === "and" ||
    formula.type === "or" ||
    formula.type === "if" ||
    formula.type === "iff"
  );
}

const CONNECTIVE_LABELS: Readonly<Record<BinaryConnective, string>> = {
  and: "/\\",
  if: "->",
  iff: "<->",
  or: "\\/",
};

class Parser {
  private position = 0;
  /**
   * The variables in scope, innermost last. It doubles as the check that every
   * formula is a sentence: a dialect with `requiresClosedFormulas` rejects a
   * variable that is not on this stack, at the offset where it occurs.
   */
  private readonly bound: string[] = [];

  constructor(
    private readonly tokens: readonly Token[],
    private readonly endOffset: number,
    private readonly dialect: FirstOrderDialect,
  ) {}

  parse(): Formula {
    if (this.tokens.length === 0) {
      throw new ParseFailure({ message: "Expected a formula.", position: 0 });
    }

    const formula = this.parseLevel(0);

    if (this.position < this.tokens.length) {
      const token = this.tokens[this.position];
      throw new ParseFailure({
        message: "Unexpected “{token}”.",
        params: { token: token?.value ?? "" },
        position: token?.start ?? this.endOffset,
      });
    }

    return formula;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private advance(): Token | undefined {
    return this.tokens[this.position++];
  }

  /** Where the cursor is, for an error that has no token of its own to blame. */
  private offsetHere(): number {
    return this.peek()?.start ?? this.endOffset;
  }

  /**
   * One rung of the dialect's precedence ladder, loosest first. A rung whose
   * associativity is `"none"` parses exactly one operator and then refuses a
   * second rather than inventing a grouping.
   */
  private parseLevel(rung: number): Formula {
    const level = this.dialect.precedence[rung];

    if (level === undefined) {
      return this.parseUnary();
    }

    const matches = (token: Token | undefined): BinaryConnective | null => {
      for (const operator of level.operators) {
        if (token?.type === operator) {
          return operator;
        }
      }

      return null;
    };

    let left = this.parseLevel(rung + 1);
    let operator = matches(this.peek());

    if (operator === null) {
      return left;
    }

    if (level.associativity === "right") {
      this.advance();
      return { left, right: this.parseLevel(rung), type: operator };
    }

    if (level.associativity === "none") {
      this.advance();
      const right = this.parseLevel(rung + 1);
      const next = matches(this.peek());

      if (next !== null) {
        throw new ParseFailure({
          message:
            "“{operator}” cannot be chained; add parentheses to group it.",
          params: { operator: CONNECTIVE_LABELS[next] },
          position: this.offsetHere(),
        });
      }

      return { left, right, type: operator };
    }

    while (operator !== null) {
      this.advance();
      left = { left, right: this.parseLevel(rung + 1), type: operator };
      operator = matches(this.peek());
    }

    return left;
  }

  /**
   * Negation and quantification, whose scope is a single primary — so `~P /\ Q`
   * is `(~P) /\ Q` and `AxF(x) /\ G(a)` is `(AxF(x)) /\ G(a)`.
   */
  private parseUnary(): Formula {
    const token = this.peek();

    if (token?.type === "not") {
      this.advance();
      return { operand: this.parseUnary(), type: "not" };
    }

    if (token?.type === "quantifier") {
      this.advance();
      const variable = this.peek();

      if (
        variable?.type !== "symbol" ||
        !isIn(this.dialect.variableLetters, variable.value[0] ?? "")
      ) {
        throw new ParseFailure({
          message: "Expected a variable after the quantifier.",
          position: this.offsetHere(),
        });
      }

      this.advance();
      this.bound.push(variable.value);

      try {
        return {
          body: this.parseUnary(),
          type: token.value === "forall" ? "forall" : "exists",
          variable: variable.value,
        };
      } finally {
        this.bound.pop();
      }
    }

    return this.parsePrimary();
  }

  private parsePrimary(): Formula {
    const token = this.peek();

    if (token === undefined) {
      throw new ParseFailure({
        message: "Expected a formula.",
        position: this.endOffset,
      });
    }

    if (token.type === "lbracket") {
      return this.parseBracketed(token);
    }

    if (token.type === "falsum") {
      this.advance();
      return { type: "falsum" };
    }

    if (token.type === "verum") {
      this.advance();
      return { type: "verum" };
    }

    if (token.type === "symbol") {
      const letter = token.value[0] ?? "";

      if (isIn(this.dialect.predicateLetters, letter)) {
        return this.parsePredicate(token);
      }

      // A formula that starts with a term can only be an identity.
      return this.parseIdentity();
    }

    throw new ParseFailure({
      message: "Expected a formula but found “{token}”.",
      params: { token: token.value },
      position: token.start,
    });
  }

  private parseBracketed(open: Token): Formula {
    this.advance();
    const inner = this.parseLevel(0);
    const closing = this.peek();
    const expected = this.dialect.brackets.find(
      ([opener]) => opener === open.value,
    );

    if (closing?.type !== "rbracket" || closing.value !== expected?.[1]) {
      throw new ParseFailure({
        message: "Expected “{bracket}”.",
        params: { bracket: expected?.[1] ?? ")" },
        position: closing?.start ?? this.endOffset,
      });
    }

    this.advance();

    // forallx's parenthesization convention: brackets join two sentences, so
    // they are a mistake around anything else rather than harmless noise.
    if (this.dialect.parenthesizeBinaryOnly && !isBinary(inner)) {
      throw new ParseFailure({
        message:
          "Parentheses may only enclose a sentence joined by a two-place connective.",
        position: open.start,
      });
    }

    return inner;
  }

  private parsePredicate(symbol: Token): Formula {
    this.advance();
    const next = this.peek();
    const opensArguments =
      next?.type === "lbracket" &&
      next.value === (this.dialect.brackets[0]?.[0] ?? "(");

    if (!this.dialect.predicatesTakeParens) {
      // Juxtaposed arguments (`Fx`, `Rxy`) belong to the earlier forallx and to
      // several other textbooks; no shipping dialect uses them yet.
      throw new ParseFailure({
        message: "Expected a formula but found “{token}”.",
        params: { token: symbol.value },
        position: symbol.start,
      });
    }

    if (!opensArguments) {
      // A bare predicate letter is a sentence letter.
      return { args: [], name: symbol.value, type: "predicate" };
    }

    return {
      args: this.parseArguments(),
      name: symbol.value,
      type: "predicate",
    };
  }

  /** `( term, term, … )`, with at least one argument. */
  private parseArguments(): readonly Term[] {
    const open = this.advance();
    const args: Term[] = [this.parseTerm()];

    while (this.peek()?.type === "comma") {
      this.advance();
      args.push(this.parseTerm());
    }

    const closing = this.peek();
    const expected = this.dialect.brackets.find(
      ([opener]) => opener === open?.value,
    );

    if (closing?.type !== "rbracket" || closing.value !== expected?.[1]) {
      throw new ParseFailure({
        message: "Expected “{bracket}”.",
        params: { bracket: expected?.[1] ?? ")" },
        position: closing?.start ?? this.endOffset,
      });
    }

    this.advance();
    return args;
  }

  private parseIdentity(): Formula {
    const left = this.parseTerm();
    const operator = this.peek();

    if (operator?.type === "identity") {
      this.advance();
      return { left, right: this.parseTerm(), type: "identity" };
    }

    if (operator?.type === "inequality") {
      this.advance();
      return {
        operand: { left, right: this.parseTerm(), type: "identity" },
        type: "not",
      };
    }

    throw new ParseFailure({
      message: "Expected “{operator}” after this term.",
      params: { operator: this.dialect.identity[0] ?? "=" },
      position: this.offsetHere(),
    });
  }

  private parseTerm(): Term {
    const token = this.peek();

    if (token?.type !== "symbol") {
      throw new ParseFailure({
        message: "Expected a term but found “{token}”.",
        params: { token: token?.value ?? "" },
        position: token?.start ?? this.endOffset,
      });
    }

    this.advance();
    const letter = token.value[0] ?? "";
    const next = this.peek();
    const opensArguments =
      next?.type === "lbracket" &&
      next.value === (this.dialect.brackets[0]?.[0] ?? "(");

    if (opensArguments && isIn(this.dialect.functionLetters, letter)) {
      return {
        args: this.parseArguments(),
        name: token.value,
        type: "function",
      };
    }

    if (isIn(this.dialect.variableLetters, letter)) {
      if (
        this.dialect.requiresClosedFormulas &&
        !this.bound.includes(token.value)
      ) {
        throw new ParseFailure({
          message:
            "“{name}” is a free variable; every formula must be a sentence.",
          params: { name: token.value },
          position: token.start,
        });
      }

      return { name: token.value, type: "variable" };
    }

    if (isIn(this.dialect.constantLetters, letter)) {
      return { name: token.value, type: "constant" };
    }

    throw new ParseFailure({
      message: "Expected a term but found “{token}”.",
      params: { token: token.value },
      position: token.start,
    });
  }
}

/**
 * Split a comma-separated list of formulas, respecting brackets.
 *
 * Commas separate formulas *and* a predicate's arguments, so a plain split
 * would read `R(a,b), F(c)` as three fragments. Only `()` and `[]` nest: `<`
 * and `>` are operator characters in these dialects (`<->`, `>`), not
 * brackets. Both the model's formula lists and a translation's alternate
 * solutions are written this way.
 */
export function splitFormulaList(source: string): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === "(" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "]") {
      depth -= 1;
    } else if (char === "," && depth <= 0) {
      pieces.push(source.slice(start, index));
      start = index + 1;
    }
  }

  pieces.push(source.slice(start));

  return pieces;
}

/** Parse one first-order formula, collecting the first syntax error if any. */
export function parseFormula(
  source: string,
  dialect: FirstOrderDialect,
): ParseResult {
  const lexed = tokenize(source, dialect);

  if (!lexed.ok) {
    return { errors: [lexed.error], ok: false };
  }

  try {
    const formula = new Parser(lexed.tokens, source.length, dialect).parse();
    return { formula, ok: true };
  } catch (error) {
    if (error instanceof ParseFailure) {
      return { errors: [error.detail], ok: false };
    }

    throw error;
  }
}

/** Render a term back to source. */
export function termToString(term: Term): string {
  if (term.type === "function") {
    return `${term.name}(${term.args.map(termToString).join(",")})`;
  }

  return term.name;
}

/**
 * Render a formula back to source in the dialect's primary spellings, adding
 * only the brackets the dialect permits.
 *
 * This is what a student and an instructor both read back — the prompt, the
 * field labels, and the "take another look at …" messages all come through
 * here — so it must not print a string the parser would reject. Under
 * `parenthesizeBinaryOnly` that means brackets go around binary compounds and
 * nowhere else, which is exactly where they are needed to preserve the reading.
 */
export function formulaToString(
  formula: Formula,
  dialect: FirstOrderDialect,
): string {
  const bracket = (inner: Formula): string => {
    const text = formulaToString(inner, dialect);
    return isBinary(inner) ? `(${text})` : text;
  };

  switch (formula.type) {
    case "predicate":
      return formula.args.length === 0
        ? formula.name
        : `${formula.name}(${formula.args.map(termToString).join(",")})`;
    case "identity":
      return `${termToString(formula.left)} ${
        dialect.identity[0] ?? "="
      } ${termToString(formula.right)}`;
    case "falsum":
      return dialect.falsum[0] ?? "⊥";
    case "verum":
      return dialect.verum[0] ?? "⊤";
    case "not":
      return `${dialect.connectives.not[0] ?? "~"}${bracket(formula.operand)}`;
    case "forall":
      return `${dialect.quantifiers.forall[0] ?? "A"}${
        formula.variable
      }${bracket(formula.body)}`;
    case "exists":
      return `${dialect.quantifiers.exists[0] ?? "E"}${
        formula.variable
      }${bracket(formula.body)}`;
    default: {
      const spelling =
        dialect.connectives[formula.type][0] ??
        CONNECTIVE_LABELS[formula.type];
      return `${bracket(formula.left)} ${spelling} ${bracket(formula.right)}`;
    }
  }
}

/**
 * The symbols a formula is *shown* with, as against the ones it may be typed
 * with. Fixed, not read off the dialect: in Carnap these come from the
 * lexicon's `Schematizable` instances, which every system shares.
 */
const DISPLAY_SYMBOLS = {
  and: "∧",
  exists: "∃",
  falsum: "⊥",
  forall: "∀",
  identity: "=",
  if: "→",
  iff: "↔",
  not: "¬",
  or: "∨",
  verum: "⊤",
} as const;

/**
 * Carnap's `schematize`: proper logical symbols, **every** binary compound
 * parenthesized with spaces around the connective, a quantifier or a negation
 * written straight onto what follows it, and identity closed up (`a=b`).
 */
function schematize(formula: Formula): string {
  switch (formula.type) {
    case "predicate":
      return formula.args.length === 0
        ? formula.name
        : `${formula.name}(${formula.args.map(termToString).join(",")})`;
    case "identity":
      return `${termToString(formula.left)}${DISPLAY_SYMBOLS.identity}${termToString(formula.right)}`;
    case "falsum":
      return DISPLAY_SYMBOLS.falsum;
    case "verum":
      return DISPLAY_SYMBOLS.verum;
    case "not":
      return `${DISPLAY_SYMBOLS.not}${schematize(formula.operand)}`;
    case "forall":
    case "exists":
      return `${
        formula.type === "forall"
          ? DISPLAY_SYMBOLS.forall
          : DISPLAY_SYMBOLS.exists
      }${formula.variable}${schematize(formula.body)}`;
    default:
      return `(${schematize(formula.left)} ${DISPLAY_SYMBOLS[formula.type]} ${schematize(formula.right)})`;
  }
}

/**
 * Drop the one bracket pair that wraps the whole string, if there is one —
 * Carnap's `dropOuterParensForm`. Parenthesizing every binary leaves a
 * redundant pair around the outside, and only around the outside.
 */
function dropOuterParens(text: string): string {
  if (!text.startsWith("(")) {
    return text;
  }

  let depth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;

      // Closed before the end, so the opening bracket was not the outer one:
      // `(P /\ Q) \/ R` keeps every bracket it has.
      if (depth === 0) {
        return index === text.length - 1 ? text.slice(1, -1) : text;
      }
    }
  }

  return text;
}

/**
 * A formula as a reader should see it: logical symbols, not the ASCII a student
 * types.
 *
 * This is what the original shows — `rewriteWith opts . show`, i.e. the fixed
 * `schematize` symbols under the system's own rewriter — and it is separate from
 * {@link formulaToString}, which produces the canonical *source* a formula is
 * stored as and can be typed back in. `∀x∀yf(x,y)=f(y,x)` is the display of what
 * is stored as `AxAyf(x,y) = f(y,x)`.
 */
export function formulaToDisplay(
  formula: Formula,
  dialect: FirstOrderDialect,
): string {
  const shown = schematize(formula);

  return dialect.displayNotation === "drop-outer-parens"
    ? dropOuterParens(shown)
    : shown;
}
