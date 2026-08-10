/**
 * Formula syntax for the truth-table exercise type.
 *
 * This module is DOM-free and imported by BOTH the worker (to compile a table
 * and grade authoritatively) and the client element (for instant local
 * checking), so it must not reach for any platform globals.
 *
 * Notation is Carnap's default `prop` system:
 *   - `~`    negation      (unary prefix)
 *   - `/\`   conjunction
 *   - `\/`   disjunction
 *   - `->`   conditional   (right-associative)
 *   - `<->`  biconditional
 * Sentence letters are a single Roman letter optionally followed by digits
 * (its subscript), e.g. `P`, `Q`, `P0`, `R12`. Pluggable `system=` notations
 * are a later phase; this parser only speaks `prop`.
 *
 * Precedence, loosest to tightest: `<->` < `->` < `\/` < `/\` < `~`.
 * `/\`, `\/`, and `<->` are left-associative; `->` is right-associative.
 */

import type { DiagnosticMessageId } from "../../../application/content/diagnostic-strings";
import type { TranslatableMessage } from "../../../i18n/translator";

export type BinaryConnective = "and" | "or" | "if" | "iff";

export type Formula =
  | { readonly type: "atom"; readonly name: string }
  | { readonly type: "not"; readonly operand: Formula }
  | {
      readonly type: BinaryConnective;
      readonly left: Formula;
      readonly right: Formula;
    };

/**
 * One reason a formula would not parse, addressed to whoever wrote it.
 *
 * The prose is an unfilled English template plus its values rather than a
 * finished sentence: the authoring compiler quotes these inside its own
 * `invalid_formula` diagnostic, and the revision editor words both together in
 * the viewer's language. Neither this module nor the compiler has a translator.
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
  | "atom"
  | "not"
  | "and"
  | "or"
  | "if"
  | "iff"
  | "lparen"
  | "rparen";

interface Token {
  readonly type: TokenType;
  /** The atom name for `atom` tokens; the surface symbol otherwise. */
  readonly value: string;
  readonly start: number;
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

function tokenize(
  source: string,
): { ok: true; tokens: Token[] } | { ok: false; error: ParseError } {
  const tokens: Token[] = [];
  let index = 0;

  const twoChar = (
    type: TokenType,
    symbol: string,
    second: string,
  ): boolean => {
    if (source[index + 1] !== second) {
      return false;
    }

    tokens.push({ start: index, type, value: symbol });
    index += 2;
    return true;
  };

  while (index < source.length) {
    const char = source[index] ?? "";

    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      index += 1;
      continue;
    }

    if (char === "(") {
      tokens.push({ start: index, type: "lparen", value: "(" });
      index += 1;
      continue;
    }

    if (char === ")") {
      tokens.push({ start: index, type: "rparen", value: ")" });
      index += 1;
      continue;
    }

    if (char === "~") {
      tokens.push({ start: index, type: "not", value: "~" });
      index += 1;
      continue;
    }

    if (char === "/") {
      if (twoChar("and", "/\\", "\\")) {
        continue;
      }

      return {
        error: { message: "Expected '/\\' (conjunction).", position: index },
        ok: false,
      };
    }

    if (char === "\\") {
      if (twoChar("or", "\\/", "/")) {
        continue;
      }

      return {
        error: { message: "Expected '\\/' (disjunction).", position: index },
        ok: false,
      };
    }

    if (char === "-") {
      if (twoChar("if", "->", ">")) {
        continue;
      }

      return {
        error: { message: "Expected '->' (conditional).", position: index },
        ok: false,
      };
    }

    if (char === "<") {
      if (source[index + 1] === "-" && source[index + 2] === ">") {
        tokens.push({ start: index, type: "iff", value: "<->" });
        index += 3;
        continue;
      }

      return {
        error: {
          message: "Expected '<->' (biconditional).",
          position: index,
        },
        ok: false,
      };
    }

    if (isLetter(char)) {
      let end = index + 1;

      while (end < source.length && isDigit(source[end] ?? "")) {
        end += 1;
      }

      tokens.push({
        start: index,
        type: "atom",
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

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly endOffset: number,
  ) {}

  parse(): Formula {
    if (this.tokens.length === 0) {
      throw new ParseFailure({ message: "Expected a formula.", position: 0 });
    }

    const formula = this.parseIff();

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

  private parseIff(): Formula {
    let left = this.parseIf();

    while (this.peek()?.type === "iff") {
      this.advance();
      left = { left, right: this.parseIf(), type: "iff" };
    }

    return left;
  }

  private parseIf(): Formula {
    const left = this.parseOr();

    if (this.peek()?.type === "if") {
      this.advance();
      return { left, right: this.parseIf(), type: "if" };
    }

    return left;
  }

  private parseOr(): Formula {
    let left = this.parseAnd();

    while (this.peek()?.type === "or") {
      this.advance();
      left = { left, right: this.parseAnd(), type: "or" };
    }

    return left;
  }

  private parseAnd(): Formula {
    let left = this.parseNot();

    while (this.peek()?.type === "and") {
      this.advance();
      left = { left, right: this.parseNot(), type: "and" };
    }

    return left;
  }

  private parseNot(): Formula {
    if (this.peek()?.type === "not") {
      this.advance();
      return { operand: this.parseNot(), type: "not" };
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

    if (token.type === "atom") {
      this.advance();
      return { name: token.value, type: "atom" };
    }

    if (token.type === "lparen") {
      this.advance();
      const inner = this.parseIff();
      const closing = this.peek();

      if (closing?.type !== "rparen") {
        throw new ParseFailure({
          message: "Expected ')'.",
          position: closing?.start ?? this.endOffset,
        });
      }

      this.advance();
      return inner;
    }

    throw new ParseFailure({
      message: "Expected a formula but found “{token}”.",
      params: { token: token.value },
      position: token.start,
    });
  }
}

/** Parse a single `prop` formula, collecting the first syntax error if any. */
export function parseFormula(source: string): ParseResult {
  const lexed = tokenize(source);

  if (!lexed.ok) {
    return { errors: [lexed.error], ok: false };
  }

  try {
    const formula = new Parser(lexed.tokens, source.length).parse();
    return { formula, ok: true };
  } catch (error) {
    if (error instanceof ParseFailure) {
      return { errors: [error.detail], ok: false };
    }

    throw error;
  }
}

/** Render a formula back to canonical `prop` source (fully parenthesized). */
export function formulaToString(formula: Formula): string {
  switch (formula.type) {
    case "atom":
      return formula.name;
    case "not":
      return `~${formulaToString(formula.operand)}`;
    case "and":
      return `(${formulaToString(formula.left)} /\\ ${formulaToString(formula.right)})`;
    case "or":
      return `(${formulaToString(formula.left)} \\/ ${formulaToString(formula.right)})`;
    case "if":
      return `(${formulaToString(formula.left)} -> ${formulaToString(formula.right)})`;
    case "iff":
      return `(${formulaToString(formula.left)} <-> ${formulaToString(formula.right)})`;
  }
}
