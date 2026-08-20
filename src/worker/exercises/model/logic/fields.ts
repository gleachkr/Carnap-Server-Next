/**
 * The syntax of what a student types into a model's fields.
 *
 * These are the little languages the original Carnap parses with parsec inside
 * `CounterModel.hs` — a domain as `0,1,2`, an extension as `[0,0],[1,0]`, a
 * function as `[0,0;1]` — kept exactly, because the same spellings appear in an
 * exercise's authored givens. The generated function table is a nicer *editor*
 * for the function spelling, not a replacement of it.
 *
 * Tuples may be written with any of `[…]`, `(…)` or `<…>`, and a 1-tuple may be
 * written bare, so `0,1` and `[0],[1]` are the same unary extension. A trailing
 * comma is allowed everywhere (Carnap's `sepEndBy`), and an empty extension is
 * written as an empty field.
 *
 * DOM-free: the worker parses these to grade and the client element parses them
 * to mark a field with a warning as it is typed.
 */

/**
 * A field value that would not read, located for the `⚠` marker.
 *
 * No message: what to say depends on which field it was, and the caller — a
 * student-facing widget or an author-facing diagnostic — has different
 * vocabularies for saying it.
 */
export type FieldParse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly position: number };

/**
 * The largest domain a model may have.
 *
 * Carnap has no limit, and a student who types a hundred elements gets a
 * hundred-column function table and a browser that stops responding. Sixteen is
 * past anything a course asks for — a group of order 8, the largest finite
 * structure that turns up in an intro exercise, needs half of it.
 */
export const MAX_DOMAIN_SIZE = 16;

/**
 * The most argument tuples a single function field may be asked to cover.
 *
 * Reached only by a high-arity function over a large domain: a ternary function
 * over a domain of 12 is 1728 rows, which is not an exercise anyone can do. The
 * limit is reported against the field rather than silently truncating it.
 */
export const MAX_FUNCTION_ROWS = 1024;

/** One row of a function's extension: an argument tuple and its value. */
export interface FunctionRow {
  readonly args: readonly number[];
  readonly value: number;
}

const OPENERS = "[(<";
const CLOSERS: Readonly<Record<string, string>> = {
  "(": ")",
  "<": ">",
  "[": "]",
};

class Scanner {
  position = 0;

  constructor(readonly source: string) {}

  atEnd(): boolean {
    this.skipSpace();
    return this.position >= this.source.length;
  }

  skipSpace(): void {
    while (/\s/.test(this.source[this.position] ?? "")) {
      this.position += 1;
    }
  }

  /** Consume `char` if it is next, after any space. */
  eat(char: string): boolean {
    this.skipSpace();

    if (this.source[this.position] === char) {
      this.position += 1;
      return true;
    }

    return false;
  }

  peek(): string {
    this.skipSpace();
    return this.source[this.position] ?? "";
  }

  /** A natural number, or `null` with the cursor left where it failed. */
  natural(): number | null {
    this.skipSpace();
    const start = this.position;

    while (/[0-9]/.test(this.source[this.position] ?? "")) {
      this.position += 1;
    }

    if (this.position === start) {
      return null;
    }

    return Number.parseInt(this.source.slice(start, this.position), 10);
  }
}

/** `0,1,2` — the domain, as one or more naturals. */
export function parseDomain(text: string): FieldParse<readonly number[]> {
  const scanner = new Scanner(text);
  const elements: number[] = [];

  while (!scanner.atEnd()) {
    const element = scanner.natural();

    if (element === null) {
      return { ok: false, position: scanner.position };
    }

    elements.push(element);

    if (!scanner.eat(",")) {
      break;
    }
  }

  if (!scanner.atEnd()) {
    return { ok: false, position: scanner.position };
  }

  if (elements.length === 0) {
    return { ok: false, position: 0 };
  }

  // Duplicates are not an error — `0,0,1` is the domain {0,1} — but a model
  // quantifies over the list, so leaving them in would count an element twice.
  return { ok: true, value: [...new Set(elements)] };
}

/** One tuple of `arity` naturals, bracketed, or a bare natural when arity is 1. */
function parseTuple(
  scanner: Scanner,
  arity: number,
): readonly number[] | null {
  const opener = scanner.peek();

  if (!OPENERS.includes(opener)) {
    if (arity !== 1) {
      return null;
    }

    const only = scanner.natural();
    return only === null ? null : [only];
  }

  scanner.eat(opener);
  const elements: number[] = [];

  while (true) {
    const element = scanner.natural();

    if (element === null) {
      return null;
    }

    elements.push(element);

    if (!scanner.eat(",")) {
      break;
    }
  }

  if (!scanner.eat(CLOSERS[opener] ?? "]")) {
    return null;
  }

  return elements.length === arity ? elements : null;
}

/**
 * `[0,0],[1,0]` — the extension of a relation of the given arity. An empty
 * field is the empty extension.
 */
export function parseTupleList(
  text: string,
  arity: number,
): FieldParse<readonly (readonly number[])[]> {
  const scanner = new Scanner(text);
  const tuples: (readonly number[])[] = [];

  while (!scanner.atEnd()) {
    const tuple = parseTuple(scanner, arity);

    if (tuple === null) {
      return { ok: false, position: scanner.position };
    }

    tuples.push(tuple);

    if (!scanner.eat(",")) {
      break;
    }
  }

  if (!scanner.atEnd()) {
    return { ok: false, position: scanner.position };
  }

  return { ok: true, value: tuples };
}

/**
 * `[0,0;1],[0,1;2]` — a function's extension, each tuple pairing an argument
 * list with the value it maps to. Unlike a relation's tuples these are always
 * bracketed, because the `;` needs somewhere to sit.
 */
export function parseFunctionTable(
  text: string,
  arity: number,
): FieldParse<readonly FunctionRow[]> {
  const scanner = new Scanner(text);
  const rows: FunctionRow[] = [];

  while (!scanner.atEnd()) {
    const opener = scanner.peek();

    if (!OPENERS.includes(opener)) {
      return { ok: false, position: scanner.position };
    }

    scanner.eat(opener);
    const args: number[] = [];

    while (true) {
      const argument = scanner.natural();

      if (argument === null) {
        return { ok: false, position: scanner.position };
      }

      args.push(argument);

      if (!scanner.eat(",")) {
        break;
      }
    }

    if (!scanner.eat(";")) {
      return { ok: false, position: scanner.position };
    }

    const value = scanner.natural();

    if (value === null || args.length !== arity) {
      return { ok: false, position: scanner.position };
    }

    if (!scanner.eat(CLOSERS[opener] ?? "]")) {
      return { ok: false, position: scanner.position };
    }

    rows.push({ args, value });

    if (!scanner.eat(",")) {
      break;
    }
  }

  if (!scanner.atEnd()) {
    return { ok: false, position: scanner.position };
  }

  return { ok: true, value: rows };
}

/** A single natural — a constant's referent. */
export function parseNatural(text: string): FieldParse<number> {
  const scanner = new Scanner(text);
  const value = scanner.natural();

  if (value === null || !scanner.atEnd()) {
    return { ok: false, position: scanner.position };
  }

  return { ok: true, value };
}

/** Write a function's extension back in the spelling {@link parseFunctionTable} reads. */
export function formatFunctionTable(rows: readonly FunctionRow[]): string {
  return rows.map((row) => `[${row.args.join(",")};${row.value}]`).join(",");
}

/** Write a relation's extension back in the spelling {@link parseTupleList} reads. */
export function formatTupleList(
  tuples: readonly (readonly number[])[],
): string {
  return tuples.map((tuple) => `[${tuple.join(",")}]`).join(",");
}

/**
 * Every argument tuple of the given arity over a domain, in odometer order
 * (last position varying fastest) so a generated table reads like a table.
 *
 * Returns `null` when the count would exceed {@link MAX_FUNCTION_ROWS}, which
 * the caller reports rather than truncating.
 */
export function tuplesOver(
  domain: readonly number[],
  arity: number,
): readonly (readonly number[])[] | null {
  if (arity === 0) {
    return [[]];
  }

  if (domain.length ** arity > MAX_FUNCTION_ROWS) {
    return null;
  }

  let tuples: readonly number[][] = [[]];

  for (let position = 0; position < arity; position += 1) {
    const grown: number[][] = [];

    for (const tuple of tuples) {
      for (const element of domain) {
        grown.push([...tuple, element]);
      }
    }

    tuples = grown;
  }

  return tuples;
}

/** A tuple's key in a model's function map. */
export function tupleKey(tuple: readonly number[]): string {
  return tuple.join(",");
}

/** One line of a function's value table: the arguments it fixes, and its cells. */
export interface FunctionTableRow {
  /** The full argument tuple of each cell, one per column. */
  readonly cells: readonly (readonly number[])[];
  /**
   * How the line names its arguments: the fixed ones, then a blank for the
   * column to fill — `0,_` beside a column headed `1` is the argument `0,1`.
   * Blanked the way a symbol's own label is (`f(_,_)`), so the two read alike.
   * Empty for a unary function, whose single line fixes nothing.
   */
  readonly label: string;
  /** Every argument but the last, fixed for the whole line. */
  readonly prefix: readonly number[];
}

/** A function's argument tuples arranged as a table. */
export interface FunctionTableLayout {
  /** The last argument's values — the columns, in domain order. */
  readonly columns: readonly number[];
  /**
   * Whether the lines need naming at all. False for a unary function: its one
   * line fixes no argument, so a header column there would be a blank label
   * beside a blank corner, which reads as something withheld rather than as
   * nothing to say.
   */
  readonly rowHeaders: boolean;
  readonly rows: readonly FunctionTableRow[];
}

/**
 * A function's argument tuples arranged as a table: the last argument across
 * the columns, the rest down the rows.
 *
 * A binary function over a small domain is then the square it is written as on
 * a blackboard, and no cell has to repeat the function symbol — the argument is
 * read off the two axes. A unary function is the degenerate case, one row of
 * values under its arguments and no row headers at all; a ternary one keeps the
 * columns bounded by the domain and grows downwards instead.
 *
 * Reading the rows in order and each row's cells in order gives exactly
 * {@link tuplesOver}'s odometer order, which is what lets the rendered table be
 * serialized straight down the DOM. `null` on the same over-large table
 * {@link tuplesOver} refuses, and for an arity no function has.
 */
export function functionTableLayout(
  domain: readonly number[],
  arity: number,
): FunctionTableLayout | null {
  if (arity < 1 || tuplesOver(domain, arity) === null) {
    return null;
  }

  const prefixes = tuplesOver(domain, arity - 1) ?? [];

  return {
    columns: domain,
    rowHeaders: arity > 1,
    rows: prefixes.map((prefix) => ({
      cells: domain.map((element) => [...prefix, element]),
      label: prefix.length === 0 ? "" : [...prefix, "_"].join(","),
      prefix,
    })),
  };
}
