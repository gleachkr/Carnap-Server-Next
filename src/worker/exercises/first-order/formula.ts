/**
 * First-order syntax for the exercise types that read formulas — the model and
 * the translation.
 *
 * The language is not written here. It is a spec `logic/specs` registers — for
 * forallx that is `logic/theories/forallx-calgary-2019.mm0`, the same file the
 * proof exercises name as their theory — an ordinary MM0 signature with
 * `@syntax` annotations, read by `@aufbau/syntax`; this module only converts
 * what that parser returns into the {@link Formula} tree the two types
 * evaluate, and writes one back out. The notation table, the precedence
 * ladder, the bracket conventions and the refusals all live in the spec, which
 * is quite literally the same artifact a proof exercise's `theory=` names.
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
 */

import type {
  AppTerm,
  SurfaceLanguage,
  Term as SurfaceTerm,
} from "@aufbau/syntax";
import type { FormulaParseError } from "../../logic/specs/diagnostics";
import { formulaParseErrors } from "../../logic/specs/diagnostics";
import { roleIndex, sentenceSort } from "../../logic/specs/roles";

export type BinaryConnective = "and" | "or" | "if" | "iff";

/**
 * A term: a variable, an individual constant, or a function symbol applied to
 * terms. `name` is the surface spelling, which is both how it is shown back to
 * the student and how a model keys it.
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
 * Whether this node would swallow a sentence.
 *
 * The test that lets an unrolled constructor be a predicate without letting an
 * unannotated connective become one. A letter takes its arguments at the
 * *sequence* sort, so `F`, `F(a)` and `R(a,b)` are predications. A
 * `term box (p: wff): wff;` with no `@syntax role` takes an argument at the
 * sentence sort; reading it as a predicate would push a formula through
 * {@link readTerm}, which fails further down with nothing useful to say.
 */
function swallowsSentence(node: AppTerm): boolean {
  return node.args.some((argument) => argument.sort === node.sort);
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
 * The arguments a letter was applied to.
 *
 * A spec makes one letter variadic by giving it a single sequence argument
 * built from an infix comma, with the empty sequence elided — so `P`, `F(a)`
 * and `R(a,b)` are all one declaration, and unpicking that sequence is what
 * turns them back into an argument list. The comma tree leans left, and
 * flattening it is a walk rather than a special case for each arity.
 */
function sequence(node: SurfaceTerm, lang: SurfaceLanguage): SurfaceTerm[] {
  const inner = bare(node, lang);

  if (inner.kind !== "app" || inner.sort !== node.sort) {
    return [inner];
  }

  if (lang.elidedOf.get(inner.sort)?.name === inner.term) {
    return [];
  }

  const [left, right] = inner.args;

  if (
    inner.args.length === 2 &&
    left !== undefined &&
    right !== undefined &&
    left.sort === inner.sort &&
    right.sort === inner.sort
  ) {
    return [...sequence(left, lang), ...sequence(right, lang)];
  }

  return [inner];
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

  const args = (
    inner.args[0] === undefined ? [] : sequence(inner.args[0], lang)
  ).map((argument) => readTerm(argument, lang));

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
 * A constructor with no role at all is a lexicon letter — `F`, `P` — and a
 * letter of the provable sort is a predicate. That is the whole of the
 * open-ended half of the language: everything else is a fixed handful of
 * connectives the spec names.
 */
function readFormula(node: SurfaceTerm, lang: SurfaceLanguage): Formula {
  const inner = bare(node, lang);

  if (inner.kind === "variable") {
    throw malformed();
  }

  const role = roleIndex(lang).roleOf(inner.term);

  switch (role) {
    case null:
      if (swallowsSentence(inner)) {
        throw uninterpretable(inner, lang, role);
      }

      return {
        args: (inner.args[0] === undefined
          ? []
          : sequence(inner.args[0], lang)
        ).map((argument) => readTerm(argument, lang)),
        name: inner.term,
        type: "predicate",
      };
    case "negation":
      return { operand: operand(inner.args[0], lang), type: "not" };
    case "conjunction":
      return {
        left: operand(inner.args[0], lang),
        right: operand(inner.args[1], lang),
        type: "and",
      };
    case "disjunction":
      return {
        left: operand(inner.args[0], lang),
        right: operand(inner.args[1], lang),
        type: "or",
      };
    case "conditional":
      return {
        left: operand(inner.args[0], lang),
        right: operand(inner.args[1], lang),
        type: "if",
      };
    case "biconditional":
      return {
        left: operand(inner.args[0], lang),
        right: operand(inner.args[1], lang),
        type: "iff",
      };
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
    default:
      throw uninterpretable(inner, lang, role);
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

/** Render a term back to source. */
export function termToString(term: Term): string {
  if (term.type === "function") {
    return `${term.name}(${term.args.map(termToString).join(",")})`;
  }

  return term.name;
}

/**
 * The symbol each role is written with: the spec's *last* notation for it,
 * which is the one convention `@aufbau/syntax` fixes and every spec here
 * follows by listing its ASCII spellings first and its glyph last.
 *
 * The fallbacks are unreachable for the specs that ship — every role below is
 * declared in `forallx-calgary-2019.mm0` — and are here so that a spec missing
 * one prints something rather than `undefined`.
 */
function symbols(lang: SurfaceLanguage) {
  const index = roleIndex(lang);
  const of = (role: string, fallback: string): string =>
    index.spellingFor(role) ?? fallback;

  return {
    and: of("conjunction", "∧"),
    exists: of("exists", "∃"),
    falsum: of("falsum", "⊥"),
    forall: of("forall", "∀"),
    identity: of("identity", "="),
    if: of("conditional", "→"),
    iff: of("biconditional", "↔"),
    not: of("negation", "¬"),
    or: of("disjunction", "∨"),
    verum: of("verum", "⊤"),
  };
}

/**
 * Carnap's `schematize`: **every** binary compound parenthesized with spaces
 * around the connective, a quantifier or a negation written straight onto what
 * follows it, and identity closed up (`a=b`).
 */
function schematize(
  formula: Formula,
  spelling: ReturnType<typeof symbols>,
): string {
  const inner = (part: Formula): string => schematize(part, spelling);

  switch (formula.type) {
    case "predicate":
      return formula.args.length === 0
        ? formula.name
        : `${formula.name}(${formula.args.map(termToString).join(",")})`;
    case "identity":
      return `${termToString(formula.left)}${spelling.identity}${termToString(formula.right)}`;
    case "falsum":
      return spelling.falsum;
    case "verum":
      return spelling.verum;
    case "not":
      return `${spelling.not}${inner(formula.operand)}`;
    case "forall":
    case "exists":
      return `${
        formula.type === "forall" ? spelling.forall : spelling.exists
      }${formula.variable}${inner(formula.body)}`;
    default:
      return `(${inner(formula.left)} ${spelling[formula.type]} ${inner(formula.right)})`;
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
  const shown = schematize(formula, symbols(lang));

  return lang.spec.display.dropOuterParens ? dropOuterParens(shown) : shown;
}
