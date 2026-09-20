/**
 * First-order syntax for the exercise types that read formulas — the model and
 * the translation.
 *
 * The reading is of the parsed *tree*, never of the notation: a symbol is its
 * constructor's name applied to the arguments its binders hold, so `plus (x y:
 * tm): tm` written `x + y`, a fixed-arity `Red(a)`, and a textbook's variadic
 * `R(a,b)` or `Rab` all become the same shape. What the spec has to say is
 * which sorts hold *individuals* (`@syntax role individual`; a symbol is
 * interpreted only over those, see {@link firstOrderSignature}) and which,
 * if any, a variadic letter's argument list lives in (`@syntax role
 * argument-list`, see {@link readArguments}).
 *
 * The language is not written here. It is a spec `logic/specs` registers — for
 * forallx that is `logic/theories/forallx-calgary-2019.mm0`, the same file the
 * proof exercises name as their theory — an ordinary MM0 signature with
 * `@syntax` annotations, read by `@aufbau/syntax`; this module only converts
 * what that parser returns into the {@link Formula} tree the two types
 * evaluate, and writes one back out. The notation table, the precedence
 * ladder, the bracket conventions and the refusals all live in the spec, which
 * is quite literally the same artifact a proof exercise's `system=` names.
 *
 * DOM-free and imported by BOTH the worker (to compile an exercise and grade
 * authoritatively) and the client elements (for the local Check), so it must
 * not reach for any platform globals. The spec arrives as a text import, so
 * this costs the browser bundle the spec's own source and nothing else — no
 * fetch, and the same reading on both sides.
 *
 * Two grammar choices still worth stating, because they surprise people and
 * are now the spec's doing rather than this file's:
 *
 *   - **A quantifier's scope is a single primary**, not the rest of the
 *     formula. `AxF(x) -> G(a)` is `(AxF(x)) -> G(a)`; to quantify over the
 *     conditional you write `Ax(F(x) -> G(a))`. Negation scopes the same way.
 *   - `/\` and `\/` share a precedence rung, so `P /\ Q \/ R` is `(P /\ Q) \/ R`
 *     by left association — not because conjunction binds tighter, which it
 *     does not.
 *   - **The conditionals join nothing unbracketed.** forallx marks `->` and
 *     `<->` non-associative on that same one rung, so `P -> Q -> R`,
 *     `P -> Q <-> R` and `P /\ Q -> R` are all errors rather than readings.
 *     That is the spec's `@syntax forbid chain mix nest`, not a precedence:
 *     the rungs are what the engine parses this file's own math strings by.
 */

import type {
  AppTerm,
  NotationInfo,
  SurfaceLanguage,
  Term as SurfaceTerm,
} from "@aufbau/syntax";
import type { BinaryConnective } from "../../logic/specs/connectives";
import {
  BINARY_CONNECTIVES,
  binaryConnectiveForRole,
  DEFAULT_BINARY_SPELLING,
  roleForBinaryConnective,
} from "../../logic/specs/connectives";
import type { FormulaParseError } from "../../logic/specs/diagnostics";
import { formulaParseErrors } from "../../logic/specs/diagnostics";
import {
  argumentListSort,
  individualSorts,
  roleIndex,
  sentenceSort,
} from "../../logic/specs/roles";

export type { BinaryConnective };

/**
 * A term: a variable, an individual constant, or a function symbol applied to
 * terms. `name` is the constructor's name in the spec — for a lexicon letter
 * its spelling, for a notated symbol (`plus`, written `+`) the name behind the
 * notation — which is how a model keys it and, until the printer reads
 * notations, how it is shown back.
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

export type ParseError = FormulaParseError;

export type ParseResult =
  | { readonly ok: true; readonly formula: Formula }
  | { readonly ok: false; readonly errors: readonly ParseError[] };

/**
 * A spec node this module cannot read as a formula, carrying the complaint it
 * will be reported as.
 *
 * The detail travels with the throw because the two ways to get here want
 * different sentences, and unlike the truth table's this one is reachable by a
 * *student*: the translation widget parses what is typed into it with this
 * module, so a language carrying a construct these types cannot evaluate has to
 * name it rather than say only that something went wrong.
 */
class Unreadable extends Error {
  constructor(readonly detail: FormulaParseError) {
    super(detail.message);
  }
}

/** The tree is malformed: nothing to name, nowhere useful to point. */
function malformed(): Unreadable {
  return new Unreadable({
    message: "This formula could not be read.",
    position: 0,
  });
}

/**
 * The language has this construct and these types have no reading for it.
 *
 * Quoted as the writer spelled it where the parser recorded a token, else as
 * the spec's canonical spelling of the role, else by constructor name — a
 * lexicon letter is written as its own name and has no notation to report.
 */
function uninterpretable(
  node: AppTerm,
  lang: SurfaceLanguage,
  role: string | null,
): Unreadable {
  const spelled = role === null ? null : roleIndex(lang).spellingFor(role);

  return new Unreadable({
    message:
      "“{construct}” is not something this exercise type can interpret.",
    params: { construct: node.token ?? spelled ?? node.term },
    position: node.span.start,
  });
}

/**
 * Whether a role-less constructor has an ordinary first-order reading: a
 * function or predicate symbol applied to individuals.
 *
 * Read off the declaration, not the notation. Every binder must be a plain
 * argument — a bound-variable slot `{x: var}` is not one, whatever its sort —
 * at a sort that is, or coerces into, an `@syntax role individual` sort, or
 * at the argument-list sort, whose nodes flatten into such arguments. A
 * sentence-sorted binder fails: `term box (p: wff): wff` with no role, or a
 * conditional term `ite (p: wff) (x y: tm): tm`, has no value a finite model
 * assigns, and reading either as a symbol over its arguments would turn a
 * sentence into a term without a word. A spec that names no individual sort
 * interprets no symbol with arguments at all, which is the honest reading of
 * a declaration that said nothing.
 */
function firstOrderSignature(node: AppTerm, lang: SurfaceLanguage): boolean {
  const info = lang.spec.terms.get(node.term);

  if (info === undefined) {
    return false;
  }

  const list = argumentListSort(lang);
  const individuals = individualSorts(lang);
  const individual = (sort: string): boolean =>
    individuals.some(
      (target) => sort === target || lang.coerce(sort, target) !== null,
    );

  return info.binders.every(
    (binder) =>
      !binder.binds &&
      "sort" in binder.type &&
      (binder.type.sort === list || individual(binder.type.sort)),
  );
}

/** Strip the coercion wrappers the parser inserts between sorts. */
function bare(node: SurfaceTerm, lang: SurfaceLanguage): SurfaceTerm {
  let current = node;

  while (
    current.kind === "app" &&
    lang.coercionNames.has(current.term) &&
    current.args.length === 1
  ) {
    const inner = current.args[0];

    if (inner === undefined) {
      break;
    }

    current = inner;
  }

  return current;
}

/**
 * The argument list of a symbol, from every one of its binders.
 *
 * A symbol of fixed arity — `plus (x y: tm)`, `Red (x: tm)` — contributes one
 * argument per binder, however its notation is written: `x + y`, `Red(a)` and
 * a general notation all arrive here as the same tree. A textbook's variadic
 * letters take a single binder at the spec's `@syntax role argument-list`
 * sort, and a node of that sort is flattened *by structure*: each of its own
 * binders at the list sort recurses, each at any other sort is one argument.
 * That reads an elided nil as nothing, a comma or juxtaposition as
 * concatenation, and a cons-style list just as well, so the reader knows no
 * constructor's name. A spec without the role has no lists, and every binder
 * is one argument.
 */
function readArguments(
  args: readonly SurfaceTerm[],
  lang: SurfaceLanguage,
): Term[] {
  const list = argumentListSort(lang);
  const terms: Term[] = [];

  const visit = (node: SurfaceTerm): void => {
    const inner = bare(node, lang);

    if (list !== undefined && inner.kind === "app" && inner.sort === list) {
      for (const argument of inner.args) {
        visit(argument);
      }

      return;
    }

    terms.push(readTerm(inner, lang));
  };

  for (const argument of args) {
    visit(argument);
  }

  return terms;
}

function readTerm(node: SurfaceTerm, lang: SurfaceLanguage): Term {
  const inner = bare(node, lang);

  // A lexicon token of a sort no quantifier binds is a proper name, not a
  // variable. forallx: Calgary draws the two from separate `@vars` pools —
  // `a`–`e` at `name`, `s`–`z` at `var` — because its proof system needs the
  // eigenvariable provisos to be MM0 dependency typing rather than a side
  // condition, and a name is precisely what cannot be captured.
  if (inner.kind === "variable") {
    return lang.bindableSorts.has(inner.sort)
      ? { name: inner.name, type: "variable" }
      : { name: inner.name, type: "constant" };
  }

  if (!firstOrderSignature(inner, lang)) {
    throw uninterpretable(inner, lang, roleIndex(lang).roleOf(inner.term));
  }

  const args = readArguments(inner.args, lang);

  return args.length === 0
    ? { name: inner.term, type: "constant" }
    : { args, name: inner.term, type: "function" };
}

function binder(node: SurfaceTerm): string {
  if (node.kind !== "variable") {
    throw malformed();
  }

  return node.name;
}

function operand(
  node: SurfaceTerm | undefined,
  lang: SurfaceLanguage,
): Formula {
  if (node === undefined) {
    throw malformed();
  }

  return readFormula(node, lang);
}

function operandTerm(
  node: SurfaceTerm | undefined,
  lang: SurfaceLanguage,
): Term {
  if (node === undefined) {
    throw malformed();
  }

  return readTerm(node, lang);
}

/**
 * One parsed node as a formula, dispatched on its `@syntax role`.
 *
 * A constructor with no role at all is a predicate symbol — a lexicon letter
 * `F`, `P`, or a declared `Red (x: tm): wff` under whatever notation it has —
 * and its arguments are read from every binder ({@link readArguments}). That
 * is the whole of the open-ended half of the language: everything else is a
 * fixed handful of connectives the spec names.
 */
function readFormula(node: SurfaceTerm, lang: SurfaceLanguage): Formula {
  const inner = bare(node, lang);

  if (inner.kind === "variable") {
    throw malformed();
  }

  const role = roleIndex(lang).roleOf(inner.term);

  switch (role) {
    case null:
      if (!firstOrderSignature(inner, lang)) {
        throw uninterpretable(inner, lang, role);
      }

      return {
        args: readArguments(inner.args, lang),
        name: inner.term,
        type: "predicate",
      };
    case "negation":
      return { operand: operand(inner.args[0], lang), type: "not" };
    case "forall":
    case "exists":
      return {
        body: operand(inner.args[1], lang),
        type: role,
        variable: binder(inner.args[0] ?? inner),
      };
    case "identity":
      return {
        left: operandTerm(inner.args[0], lang),
        right: operandTerm(inner.args[1], lang),
        type: "identity",
      };
    // `≠` is a `def` over negation and identity, and unfolding it here is what
    // keeps the {@link Formula} union free of a node whose only content is
    // that the writer used the shorter spelling. The evaluator and the MM0
    // emitter see `¬a=b` either way, and the printer writes back whichever
    // spelling the spec makes canonical.
    case "inequality":
      return {
        operand: {
          left: operandTerm(inner.args[0], lang),
          right: operandTerm(inner.args[1], lang),
          type: "identity",
        },
        type: "not",
      };
    case "falsum":
      return { type: "falsum" };
    case "verum":
      return { type: "verum" };
    // Every binary role through one lookup: a connective's whole content here
    // is the truth function it computes, and all sixteen of those live in
    // `logic/specs/connectives.ts`. Only the roles that are *not* truth
    // functions of two sentences are worth a case.
    default: {
      const connective = binaryConnectiveForRole(role);

      if (connective === null) {
        throw uninterpretable(inner, lang, role);
      }

      return {
        left: operand(inner.args[0], lang),
        right: operand(inner.args[1], lang),
        type: connective,
      };
    }
  }
}

/**
 * Split a comma-separated list of formulas, respecting brackets.
 *
 * Commas separate formulas *and* a predicate's arguments, so a plain split
 * would read `R(a,b), F(c)` as three fragments. Only `()` and `[]` nest: `<`
 * and `>` are operator characters in these languages (`<->`, `>`), not
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

/** Parse one first-order formula, collecting every syntax error it has. */
export function parseFormula(
  source: string,
  lang: SurfaceLanguage,
): ParseResult {
  const sort = sentenceSort(lang);
  const result = lang.parse(source, sort === undefined ? {} : { sort });

  if (!result.ok) {
    return { errors: formulaParseErrors(result.diagnostics), ok: false };
  }

  try {
    return { formula: readFormula(result.term, lang), ok: true };
  } catch (error) {
    if (error instanceof Unreadable) {
      return { errors: [error.detail], ok: false };
    }

    throw error;
  }
}

/**
 * Printed text and the precedence of the operator at its head — `a+b` is the
 * rung `+` sits on, a name or an application is `max`, and a sentential
 * compound is `max` as well because {@link schematize} brackets every one of
 * them.
 *
 * Carrying the rung is what lets an operand be bracketed exactly where the
 * spec's ladder needs it. It matters more than looks: the stored form of a
 * formula is text this printer wrote, and text the parser cannot read back is
 * an exercise no grader can resolve.
 */
interface Written {
  readonly prec: number;
  readonly text: string;
}

/** MM0's `max`, as a number the numbered rungs compare against. */
const MAX_PRECEDENCE = Number.MAX_SAFE_INTEGER;

/** Something nothing needs brackets around: a name, or an already-bracketed compound. */
const atom = (text: string): Written => ({ prec: MAX_PRECEDENCE, text });

function precedenceOf(prec: number | "max"): number {
  return prec === "max" ? MAX_PRECEDENCE : prec;
}

/** An operand, bracketed where its head binds looser than the slot allows. */
function bracketed(written: Written, minimum: number): string {
  return written.prec < minimum ? `(${written.text})` : written.text;
}

/**
 * The notation to write a symbol in: the spec's canonical (last-declared) one,
 * when it can say the arity the symbol is applied at.
 *
 * A textbook's variadic letter is applied at every arity and notated at none,
 * so it falls through to `F(a,b)` — its constructor's name, which is the
 * letter itself. A fixed-arity `plus` notated `infixl +` is written `a+b`, and
 * a nullary `zero` notated `0` is written `0`. Anything else falls through
 * too: this printer interleaves the two simple shapes and nothing more, and a
 * general notation with argument slots is the printer in `@aufbau/syntax`'s
 * job, over its own tree.
 */
function notationFor(
  name: string,
  arity: number,
  lang: SurfaceLanguage,
): NotationInfo | null {
  const notation = lang.canonical.get(name);

  if (notation === undefined) {
    return null;
  }

  if (notation.form === "general") {
    return arity === 0 &&
      notation.literals.every((literal) => literal.kind === "constant")
      ? notation
      : null;
  }

  return (notation.fixity === "prefix" ? 1 : 2) === arity ? notation : null;
}

/**
 * A symbol applied to terms, through its notation where it has a fitting one
 * and as `name(a,b)` where it has none.
 */
function writeSymbol(
  name: string,
  args: readonly Term[],
  lang: SurfaceLanguage,
): Written {
  const notation = notationFor(name, args.length, lang);

  if (notation === null) {
    return atom(
      args.length === 0
        ? name
        : `${name}(${args.map((arg) => writeTerm(arg, lang).text).join(",")})`,
    );
  }

  if (notation.form === "general") {
    return atom(
      notation.literals
        .flatMap((literal) =>
          literal.kind === "constant" ? [literal.token] : [],
        )
        .join(""),
    );
  }

  const prec = precedenceOf(notation.prec);
  const tighter = Math.min(prec + 1, MAX_PRECEDENCE);
  // The side an infix associates on takes an operand at its own rung — that is
  // what makes `a+b+c` one reading — and the other side has to bind tighter.
  const associative = notation.fixity === "infixl" ? 0 : 1;
  const parts = args.map((arg, at) =>
    bracketed(
      writeTerm(arg, lang),
      notation.fixity === "prefix" || at === associative ? prec : tighter,
    ),
  );

  return {
    prec,
    text:
      notation.fixity === "prefix"
        ? `${notation.token}${parts.join("")}`
        : parts.join(notation.token),
  };
}

function writeTerm(term: Term, lang: SurfaceLanguage): Written {
  if (term.type === "variable") {
    return atom(term.name);
  }

  return writeSymbol(
    term.name,
    term.type === "function" ? term.args : [],
    lang,
  );
}

/** Render a term back to source, in the spec's own notation. */
export function termToString(term: Term, lang: SurfaceLanguage): string {
  return writeTerm(term, lang).text;
}

/**
 * The symbol each role is written with: the spec's *last* notation for it,
 * which is the one convention `@aufbau/syntax` fixes and every spec here
 * follows by listing its ASCII spellings first and its glyph last. Its rung
 * comes along, since a prefix operator has to bracket an operand that binds
 * looser than it does.
 *
 * The fallbacks are unreachable for anything a student can write — a
 * constructor with no notation cannot be typed — and are here so that a spec
 * missing one prints something rather than `undefined`. A missing rung falls
 * back to `0`, which brackets nothing: the right answer where the spec has
 * said nothing to bracket by.
 */
function symbols(lang: SurfaceLanguage) {
  const index = roleIndex(lang);
  const of = (role: string, fallback: string): string =>
    index.spellingFor(role) ?? fallback;
  const rung = (role: string): number => {
    const term = index.termFor(role);
    const notation = term === null ? undefined : lang.canonical.get(term);

    return notation === undefined || notation.form === "general"
      ? 0
      : precedenceOf(notation.prec);
  };
  const binary = {} as Record<BinaryConnective, string>;

  for (const connective of BINARY_CONNECTIVES) {
    binary[connective] = of(
      roleForBinaryConnective(connective),
      DEFAULT_BINARY_SPELLING[connective],
    );
  }

  return {
    binary,
    exists: of("exists", "∃"),
    existsPrec: rung("exists"),
    falsum: of("falsum", "⊥"),
    forall: of("forall", "∀"),
    forallPrec: rung("forall"),
    identity: of("identity", "="),
    not: of("negation", "¬"),
    notPrec: rung("negation"),
    verum: of("verum", "⊤"),
  };
}

/**
 * Carnap's `schematize`: **every** binary compound parenthesized with spaces
 * around the connective, a quantifier or a negation written straight onto what
 * follows it, and identity closed up (`a=b`). A symbol with a notation is
 * written through it on the same terms — `x<x+a`, tight, like identity — and
 * one without through its constructor's name, `F(a,b)`.
 */
function schematize(
  formula: Formula,
  lang: SurfaceLanguage,
  spelling: ReturnType<typeof symbols>,
): Written {
  const inner = (part: Formula): Written => schematize(part, lang, spelling);

  switch (formula.type) {
    case "predicate":
      return writeSymbol(formula.name, formula.args, lang);
    case "identity": {
      // Identity is an ordinary notated symbol, so it is written as one; the
      // fallback is for a spec that gives the role a constructor with no
      // notation, which would otherwise print as `ideq(a,b)`.
      const term = roleIndex(lang).termFor("identity");

      return term !== null && notationFor(term, 2, lang) !== null
        ? writeSymbol(term, [formula.left, formula.right], lang)
        : atom(
            `${writeTerm(formula.left, lang).text}${spelling.identity}${
              writeTerm(formula.right, lang).text
            }`,
          );
    }
    case "falsum":
      return atom(spelling.falsum);
    case "verum":
      return atom(spelling.verum);
    case "not":
      return {
        prec: spelling.notPrec,
        text: `${spelling.not}${bracketed(inner(formula.operand), spelling.notPrec)}`,
      };
    case "forall":
    case "exists": {
      const prec =
        formula.type === "forall" ? spelling.forallPrec : spelling.existsPrec;

      return {
        prec,
        text: `${
          formula.type === "forall" ? spelling.forall : spelling.exists
        }${formula.variable}${bracketed(inner(formula.body), prec)}`,
      };
    }
    default:
      return atom(
        `(${inner(formula.left).text} ${spelling.binary[formula.type]} ${
          inner(formula.right).text
        })`,
      );
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
 * A formula written back out: the spec's canonical spelling of every symbol,
 * bracketed by the spec's display convention.
 *
 * This is both what a reader is shown and the form a formula is *stored* as,
 * which used to be two functions over two spelling tables — a hardcoded
 * `DISPLAY_SYMBOLS` for the reader and the dialect record's first-listed
 * spellings for storage. There was never a reason for them to differ, and
 * every reason for them not to: the stored form has to be text the parser
 * accepts back, which is exactly what a canonical spelling is.
 */
export function formulaToString(
  formula: Formula,
  lang: SurfaceLanguage,
): string {
  const shown = schematize(formula, lang, symbols(lang)).text;

  return lang.spec.display.dropOuterParens ? dropOuterParens(shown) : shown;
}
