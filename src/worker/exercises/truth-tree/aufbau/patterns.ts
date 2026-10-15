/**
 * A rule statement's terms as patterns over a tree's rows (gh #46).
 *
 * The development criteria ask which rows a rule applies to, and a closed
 * branch's × which rows close it: both are questions about a rule's focus
 * pattern (`∀ x ph`, `ph ; ¬ ph`) against a row's term. Matching is
 * syntactic, over `@aufbau/syntax` parses: a rule's binders are its
 * metavariables, and anything else must be the same constructor with matching
 * arguments. A pattern that needs the theory's computation to match (a
 * substitution, as the identity rules' `{x / a} ph` does) matches only what
 * it says literally, which is the conservative failure: such a rule imposes
 * nothing it cannot see.
 *
 * Instantiating is the converse, and the engine checks what it produces: a
 * link theorem (`./emit.ts`) states a written row is a rule's template with
 * the instance filled in.
 *
 * DOM-free and free of i18n.
 */

import type { SurfaceLanguage, Term } from "@aufbau/syntax";
import { printTerm, UnprintableTermError } from "@aufbau/syntax";

/** What each metavariable of a pattern stands for. */
export type Bindings = ReadonlyMap<string, Term>;

/** A term's engine text: one canonical spelling, for identity. */
export function termKey(
  language: SurfaceLanguage,
  term: Term,
): string | null {
  try {
    return printTerm(language, term, "engine");
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
 * times (`¬ te = te`).
 */
export function matchTerm(
  language: SurfaceLanguage,
  pattern: Term,
  term: Term,
  metas: ReadonlySet<string>,
  bindings: Bindings = new Map(),
): Bindings | null {
  if (pattern.kind === "variable" && metas.has(pattern.name)) {
    if (pattern.sort !== term.sort) {
      return null;
    }

    const bound = bindings.get(pattern.name);

    if (bound === undefined) {
      return new Map([...bindings, [pattern.name, term]]);
    }

    const key = termKey(language, bound);

    return key !== null && key === termKey(language, term) ? bindings : null;
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
 * `x` of `∀x Fx` is not one, and the `a` of `Fa` is.
 */
export function closedSubterms(
  language: SurfaceLanguage,
  term: Term,
  sort: string,
): string[] {
  const found: string[] = [];
  const visit = (node: Term, bound: ReadonlySet<string>): void => {
    if (node.kind === "variable" && node.binder) {
      return;
    }

    if (node.sort === sort && closed(node, bound)) {
      const key = termKey(language, node);

      if (key !== null && !found.includes(key)) {
        found.push(key);
      }
    }

    if (node.kind === "app") {
      let inner = bound;

      for (const argument of node.args) {
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
