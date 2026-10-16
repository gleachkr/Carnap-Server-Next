/**
 * A rule statement's terms as patterns over a tree's rows (gh #46).
 *
 * The development criteria ask which rows a rule applies to, and a closed
 * branch's × which rows close it: both are questions about a rule's focus
 * pattern (`∀ x ph`, `ph ; ¬ ph`) against a row's term. Matching is
 * syntactic, over `@aufbau/syntax` parses: a rule's binders are its
 * metavariables, and anything else must be the same constructor with matching
 * arguments. A pattern that needs the theory's computation to match matches
 * only what it says literally, which is the conservative failure: such a rule
 * imposes nothing it cannot see.
 *
 * The theory's substitution is the exception, where it says which term that
 * is (`@syntax role tree.substitution`): `{x / te} ph` is `ph` with `te` for
 * each `x` in it. Where `ph` is known, from a focus `∀ x ph`, a row matches
 * where it is `ph` with one term at every `x`, and `te` is that term. Where
 * `te` is known and `ph` is not, as in the identity rule's `{x / a} ph` once
 * `a = b` has fixed `a`, `ph` is the row with every `a` made `x`: every one,
 * because the rule's `ph` may not mention `a`.
 *
 * The one computation matching does see is a list: a constructor the theory
 * declares associative with a unit and nothing more (`@acui assoc _ unit _`),
 * as the intuitionistic tableaux' prefixes are. A term of it is the sequence
 * of its members, so `(1 . wa) . waa` and `1 . (wa . waa)` are one term, and
 * a metavariable of the list's sort in a pattern stands for any run of
 * members, none included: `σ . ρ` is `σ` and every prefix that extends it.
 *
 * Instantiating is the converse, and the engine checks what it produces: a
 * link theorem (`./emit.ts`) states a written row is a rule's template with
 * the instance filled in.
 *
 * DOM-free and free of i18n.
 */

import type { AssertStatement, SurfaceLanguage, Term } from "@aufbau/syntax";
import { printTerm, UnprintableTermError } from "@aufbau/syntax";
import { roleIndex } from "../../../logic/specs/roles";

/** What each metavariable of a pattern stands for. */
export type Bindings = ReadonlyMap<string, Term>;

/**
 * A pattern's metavariables, each with whether it is bound (`{n: pfx}`): a
 * bound one stands only for a variable, as the engine instantiates it.
 */
export type Metas = ReadonlyMap<string, boolean>;

/** A list constructor: associative, with a unit, neither commutative nor idempotent. */
interface List {
  readonly term: string;
  readonly unit: string;
}

const listCache = new WeakMap<SurfaceLanguage, ReadonlyMap<string, List>>();

/** The theory's list constructors, by the sort they build. */
function listsOf(language: SurfaceLanguage): ReadonlyMap<string, List> {
  let lists = listCache.get(language);

  if (lists === undefined) {
    const found = new Map<string, List>();

    for (const statement of language.spec.statements) {
      if (statement.kind !== "term") {
        continue;
      }

      for (const annotation of statement.annotations) {
        const [head, , comm, unit, idem] = annotation.text
          .trim()
          .split(/\s+/u);
        const sort = language.spec.terms.get(statement.name)?.returnSort;

        if (
          head === "@acui" &&
          comm === "_" &&
          idem === "_" &&
          unit !== undefined &&
          sort !== undefined
        ) {
          found.set(sort, { term: statement.name, unit });
        }
      }
    }

    lists = found;
    listCache.set(language, lists);
  }

  return lists;
}

/** A list's members, in order, its unit left out: one member for any other term. */
function members(list: List, term: Term): Term[] {
  if (term.kind === "app" && term.term === list.term) {
    return term.args.flatMap((argument) => members(list, argument));
  }

  return term.kind === "app" &&
    term.term === list.unit &&
    term.args.length === 0
    ? []
    : [term];
}

/** A list of `members`, nested to the left as the parser reads it: `1 . wa . waa`. */
function listOf(list: List, sort: string, terms: readonly Term[]): Term {
  const app = (name: string, args: readonly Term[]): Term => ({
    args: [...args],
    fixity: null,
    grouped: false,
    kind: "app",
    prec: null,
    sort,
    span: { end: 0, start: 0 },
    term: name,
    token: null,
  });
  const [first, ...rest] = terms;

  return first === undefined
    ? app(list.unit, [])
    : rest.reduce((left, right) => app(list.term, [left, right]), first);
}

/** A term with each list in it flattened and nested to the left. */
function normal(language: SurfaceLanguage, term: Term): Term {
  const lists = listsOf(language);

  if (lists.size === 0) {
    return term;
  }

  const walk = (node: Term): Term => {
    if (node.kind !== "app") {
      return node;
    }

    const list = lists.get(node.sort);

    if (
      list !== undefined &&
      (node.term === list.term ||
        (node.term === list.unit && node.args.length === 0))
    ) {
      return listOf(list, node.sort, members(list, node).map(walk));
    }

    return { ...node, args: node.args.map(walk) };
  };

  return walk(term);
}

/**
 * The theory's substitution constructor, `{x / te} ph`: which argument is the
 * bound variable, which the term put for it, and which the body.
 */
interface Substitution {
  readonly term: string;
  readonly hole: number;
  readonly value: number;
  readonly body: number;
}

const substitutionCache = new WeakMap<SurfaceLanguage, Substitution | null>();

/**
 * The constructor carrying `@syntax role tree.substitution`: three arguments,
 * one a bound variable, one of the sort it builds (the body), and the term.
 * Null where the theory names none, or one of another shape.
 */
function substitutionOf(language: SurfaceLanguage): Substitution | null {
  if (substitutionCache.has(language)) {
    return substitutionCache.get(language) ?? null;
  }

  const term = roleIndex(language).termFor("tree.substitution");
  const info = term === null ? undefined : language.spec.terms.get(term);
  let found: Substitution | null = null;

  if (term !== null && info !== undefined && info.binders.length === 3) {
    const sorts = info.binders.map((binder) =>
      "sort" in binder.type ? binder.type.sort : null,
    );
    const hole = info.binders.findIndex((binder) => binder.binds);
    const body = sorts.findIndex(
      (sort, at) => at !== hole && sort === info.returnSort,
    );
    const value = [0, 1, 2].find((at) => at !== hole && at !== body);

    if (hole >= 0 && body >= 0 && value !== undefined) {
      found = { body, hole, term, value };
    }
  }

  substitutionCache.set(language, found);

  return found;
}

/**
 * Whether a body's subterm is an occurrence of the bound variable `name` at
 * `sort`: the variable, or the variable coerced into the sort (`v2t x`).
 */
function isHole(
  language: SurfaceLanguage,
  node: Term,
  name: string,
  sort: string,
): boolean {
  let inner = node;

  while (
    inner.kind === "app" &&
    inner.args.length === 1 &&
    language.coercionNames.has(inner.term)
  ) {
    inner = inner.args[0] as Term;
  }

  return (
    node.sort === sort &&
    inner.kind === "variable" &&
    !inner.binder &&
    inner.name === name
  );
}

/**
 * `body` with `by` at each free occurrence of the variable `name` at the
 * sort of `by`: one step of the theory's substitution.
 */
function substituteHole(
  language: SurfaceLanguage,
  body: Term,
  name: string,
  by: Term,
): Term {
  if (isHole(language, body, name, by.sort)) {
    return by;
  }

  if (body.kind === "variable") {
    return body;
  }

  let shadowed = false;
  const args = body.args.map((argument) => {
    if (argument.kind === "variable" && argument.binder) {
      shadowed ||= argument.name === name;
      return argument;
    }

    return shadowed ? argument : substituteHole(language, argument, name, by);
  });

  return { ...body, args };
}

/**
 * A rule's template with its metavariables filled in, and the theory's
 * substitutions in it carried out: the row a step by the rule writes. Where
 * {@link instantiate} leaves `{x / b} (F x)` for the engine to compute, this
 * gives `F b`.
 */
export function conclude(
  language: SurfaceLanguage,
  template: Term,
  bindings: Bindings,
): Term {
  const substitution = substitutionOf(language);
  const walk = (node: Term): Term => {
    if (node.kind === "variable") {
      return bindings.get(node.name) ?? node;
    }

    const args = node.args.map(walk);
    const hole = substitution === null ? undefined : args[substitution.hole];
    const value =
      substitution === null ? undefined : args[substitution.value];
    const body = substitution === null ? undefined : args[substitution.body];

    if (
      node.term === substitution?.term &&
      hole?.kind === "variable" &&
      value !== undefined &&
      body !== undefined
    ) {
      return substituteHole(language, body, hole.name, value);
    }

    return { ...node, args };
  };

  return walk(template);
}

/** Whether every metavariable in a pattern is bound. */
function filled(pattern: Term, metas: Metas, bindings: Bindings): boolean {
  return pattern.kind === "variable"
    ? !metas.has(pattern.name) || bindings.has(pattern.name)
    : pattern.args.every((argument) => filled(argument, metas, bindings));
}

/** A variable of `sort` named nowhere in `term`: `x0`, `x1`, … */
function freshVariable(name: string, sort: string, term: Term): Term {
  const names = new Set<string>();
  const collect = (node: Term): void => {
    if (node.kind === "variable") {
      names.add(node.name);
    } else {
      node.args.forEach(collect);
    }
  };

  collect(term);

  let at = 0;

  while (names.has(`${name}${at}`)) {
    at += 1;
  }

  return {
    binder: false,
    grouped: false,
    kind: "variable",
    name: `${name}${at}`,
    sort,
    span: { end: 0, start: 0 },
  };
}

/** `variable` coerced into `sort`, as a body holds it; null if it cannot be. */
function coerced(
  language: SurfaceLanguage,
  variable: Term,
  sort: string,
): Term | null {
  if (variable.sort === sort) {
    return variable;
  }

  const coercion = language.spec.coercions.find(
    (each) => each.from === variable.sort && each.to === sort,
  );

  return coercion === undefined
    ? null
    : {
        args: [variable],
        fixity: null,
        grouped: false,
        kind: "app",
        prec: null,
        sort,
        span: { end: 0, start: 0 },
        term: coercion.name,
        token: null,
      };
}

/** `term` with each subterm whose engine text is `key` replaced by `by`. */
function abstractOut(
  language: SurfaceLanguage,
  term: Term,
  key: string,
  by: Term,
): Term {
  if (term.sort === by.sort && termKey(language, term) === key) {
    return by;
  }

  return term.kind === "variable"
    ? term
    : {
        ...term,
        args: term.args.map((argument) =>
          argument.kind === "variable" && argument.binder
            ? argument
            : abstractOut(language, argument, key, by),
        ),
      };
}

/**
 * A substitution pattern `{x / te} ph` against a term, where its parts are
 * metavariables: undefined where they are not, for a literal match.
 */
function matchSubstitution(
  language: SurfaceLanguage,
  substitution: Substitution,
  pattern: Term & { kind: "app" },
  term: Term,
  metas: Metas,
  bindings: Bindings,
): Bindings | null | undefined {
  const hole = pattern.args[substitution.hole];
  const value = pattern.args[substitution.value];
  const body = pattern.args[substitution.body];

  if (
    hole?.kind !== "variable" ||
    !metas.has(hole.name) ||
    body?.kind !== "variable" ||
    !metas.has(body.name) ||
    value === undefined
  ) {
    return undefined;
  }

  if (body.sort !== term.sort) {
    return null;
  }

  const known = bindings.get(body.name);

  if (known !== undefined) {
    const variable = bindings.get(hole.name);

    return variable?.kind === "variable"
      ? matchFilled(
          language,
          known,
          variable.name,
          value,
          term,
          metas,
          bindings,
        )
      : null;
  }

  if (!filled(value, metas, bindings)) {
    return null;
  }

  const key = termKey(language, instantiate(value, bindings));
  const variable =
    bindings.get(hole.name) ?? freshVariable(hole.name, hole.sort, term);
  const occurrence =
    variable.kind === "variable"
      ? coerced(language, variable, value.sort)
      : null;

  if (key === null || occurrence === null) {
    return null;
  }

  return new Map([
    ...bindings,
    [hole.name, variable],
    [body.name, abstractOut(language, term, key, occurrence)],
  ]);
}

/**
 * A known body against a term, where the term is the body with one term, the
 * `value` pattern's, at each occurrence of the variable `name`.
 */
function matchFilled(
  language: SurfaceLanguage,
  body: Term,
  name: string,
  value: Term,
  term: Term,
  metas: Metas,
  bindings: Bindings,
): Bindings | null {
  const walk = (
    left: Term,
    right: Term,
    sofar: Bindings | null,
  ): Bindings | null => {
    if (sofar === null) {
      return null;
    }

    if (isHole(language, left, name, value.sort)) {
      return right.sort === value.sort
        ? matchTerm(language, value, right, metas, sofar)
        : null;
    }

    if (!occursFree(left, name)) {
      const key = termKey(language, left);
      return key !== null && key === termKey(language, right) ? sofar : null;
    }

    if (
      left.kind !== "app" ||
      right.kind !== "app" ||
      left.term !== right.term ||
      left.args.length !== right.args.length
    ) {
      return null;
    }

    let result: Bindings | null = sofar;

    for (const [at, argument] of left.args.entries()) {
      result = walk(argument, right.args[at] as Term, result);
    }

    return result;
  };

  return walk(body, term, bindings);
}

/**
 * A reader of a statement's formulas at a sort, as patterns: engine syntax,
 * with the statement's binders in scope. Null for a formula that does not
 * read.
 */
export function statementReader(
  language: SurfaceLanguage,
  statement: AssertStatement,
  sort: string,
): (text: string) => Term | null {
  const scope = new Map<string, string>();

  for (const binder of statement.binders) {
    if ("sort" in binder.type) {
      scope.set(binder.name, binder.type.sort);
    }
  }

  return (text) => {
    try {
      const read = language.parse(text.trim(), {
        lints: false,
        mode: "engine",
        scope,
        sort,
      });
      return read.ok ? read.term : null;
    } catch {
      return null;
    }
  };
}

/**
 * A term's engine text: one canonical spelling, for identity, with each list
 * in it flattened.
 */
export function termKey(
  language: SurfaceLanguage,
  term: Term,
): string | null {
  try {
    return printTerm(language, normal(language, term), "engine");
  } catch (error) {
    if (error instanceof UnprintableTermError) {
      return null;
    }

    throw error;
  }
}

/**
 * Match `pattern` against `term`, extending `bindings`; null where they do
 * not match. A metavariable bound twice must stand for the same term both
 * times (`¬ te = te`). A list pattern matches the first way it can, each
 * run as short as it can be.
 */
export function matchTerm(
  language: SurfaceLanguage,
  pattern: Term,
  term: Term,
  metas: Metas,
  bindings: Bindings = new Map(),
): Bindings | null {
  if (pattern.kind === "variable" && metas.has(pattern.name)) {
    if (
      pattern.sort !== term.sort ||
      (metas.get(pattern.name) === true && term.kind !== "variable")
    ) {
      return null;
    }

    const bound = bindings.get(pattern.name);

    if (bound === undefined) {
      return new Map([...bindings, [pattern.name, term]]);
    }

    const key = termKey(language, bound);

    return key !== null && key === termKey(language, term) ? bindings : null;
  }

  const substitution =
    pattern.kind === "app" ? substitutionOf(language) : null;

  if (pattern.kind === "app" && pattern.term === substitution?.term) {
    const matched = matchSubstitution(
      language,
      substitution,
      pattern,
      term,
      metas,
      bindings,
    );

    if (matched !== undefined) {
      return matched;
    }
  }

  const list =
    pattern.kind === "app" ? listsOf(language).get(pattern.sort) : undefined;

  if (list !== undefined && term.sort === pattern.sort) {
    return matchList(
      language,
      list,
      pattern.sort,
      members(list, pattern),
      members(list, term),
      metas,
      bindings,
    );
  }

  if (pattern.kind === "variable" || term.kind === "variable") {
    return pattern.kind === "variable" &&
      term.kind === "variable" &&
      pattern.name === term.name
      ? bindings
      : null;
  }

  if (
    pattern.term !== term.term ||
    pattern.args.length !== term.args.length
  ) {
    return null;
  }

  let result: Bindings | null = bindings;

  for (const [at, argument] of pattern.args.entries()) {
    result = matchTerm(
      language,
      argument,
      term.args[at] as Term,
      metas,
      result,
    );

    if (result === null) {
      return null;
    }
  }

  return result;
}

/**
 * A list pattern's members against a list's: a metavariable of the list's
 * own sort, not bound, takes a run of members, none included; anything else
 * takes one member.
 */
function matchList(
  language: SurfaceLanguage,
  list: List,
  sort: string,
  patterns: readonly Term[],
  terms: readonly Term[],
  metas: Metas,
  bindings: Bindings,
): Bindings | null {
  const key = (term: Term): string | null => termKey(language, term);
  const from = (
    at: number,
    taken: number,
    sofar: Bindings | null,
  ): Bindings | null => {
    const pattern = patterns[at];

    if (sofar === null) {
      return null;
    }

    if (pattern === undefined) {
      return taken === terms.length ? sofar : null;
    }

    const run =
      pattern.kind === "variable" &&
      metas.get(pattern.name) === false &&
      pattern.sort === sort;

    if (!run || pattern.kind !== "variable") {
      const next = terms[taken];

      return next === undefined
        ? null
        : from(
            at + 1,
            taken + 1,
            matchTerm(language, pattern, next, metas, sofar),
          );
    }

    const bound = sofar.get(pattern.name);

    if (bound !== undefined) {
      const owed = members(list, bound);
      const agrees = owed.every(
        (member, offset) =>
          terms[taken + offset] !== undefined &&
          key(member) === key(terms[taken + offset] as Term),
      );

      return agrees ? from(at + 1, taken + owed.length, sofar) : null;
    }

    for (let end = taken; end <= terms.length; end += 1) {
      const found = from(
        at + 1,
        end,
        new Map([
          ...sofar,
          [pattern.name, listOf(list, sort, terms.slice(taken, end))],
        ]),
      );

      if (found !== null) {
        return found;
      }
    }

    return null;
  };

  return from(0, 0, bindings);
}

/** `template` with each bound metavariable replaced by what it stands for. */
export function instantiate(template: Term, bindings: Bindings): Term {
  if (template.kind === "variable") {
    return bindings.get(template.name) ?? template;
  }

  return {
    ...template,
    args: template.args.map((argument) => instantiate(argument, bindings)),
  };
}

/** Whether a variable occurs free in a term: not in a binding slot, unbound. */
export function occursFree(term: Term, name: string): boolean {
  if (term.kind === "variable") {
    return !term.binder && term.name === name;
  }

  // A binding occurrence scopes over the arguments after it.
  for (const argument of term.args) {
    if (argument.kind === "variable" && argument.binder) {
      if (argument.name === name) {
        return false;
      }

      continue;
    }

    if (occursFree(argument, name)) {
      return true;
    }
  }

  return false;
}

/**
 * The closed subterms of a sort in a term, by engine text, in the order they
 * first occur: the terms a general rule could have been instantiated with.
 * Closed means no variable in it is bound by a quantifier around it, so the
 * `x` of `∀x Fx` is not one, and the `a` of `Fa` is. Of a list, every run of
 * its members is one, the empty run too: `1 . wa` has `1`, `wa`, `1 . wa`
 * and the unit.
 */
export function closedSubterms(
  language: SurfaceLanguage,
  term: Term,
  sort: string,
): string[] {
  const found: string[] = [];
  const lists = listsOf(language);
  const add = (node: Term): void => {
    const key = termKey(language, node);

    if (key !== null && !found.includes(key)) {
      found.push(key);
    }
  };
  const visit = (node: Term, bound: ReadonlySet<string>): void => {
    if (node.kind === "variable" && node.binder) {
      return;
    }

    const list = lists.get(node.sort);
    const parts = list === undefined ? [node] : members(list, node);

    if (node.sort === sort) {
      if (list === undefined) {
        if (closed(node, bound)) {
          add(node);
        }
      } else {
        for (let start = 0; start <= parts.length; start += 1) {
          for (let end = start; end <= parts.length; end += 1) {
            const run = parts.slice(start, end);

            if (run.every((part) => closed(part, bound))) {
              add(listOf(list, sort, run));
            }
          }
        }
      }
    }

    for (const part of parts) {
      if (part.kind !== "app") {
        continue;
      }

      let inner = bound;

      for (const argument of part.args) {
        if (argument.kind === "variable" && argument.binder) {
          inner = new Set([...inner, argument.name]);
          continue;
        }

        visit(argument, inner);
      }
    }
  };

  visit(term, new Set());

  return found;
}

/** Whether no variable in `term` is one of `bound`. */
function closed(term: Term, bound: ReadonlySet<string>): boolean {
  if (term.kind === "variable") {
    return !bound.has(term.name);
  }

  return term.args.every((argument) => closed(argument, bound));
}
