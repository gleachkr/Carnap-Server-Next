/**
 * What a spec's constructors *mean*, and how they are spelled.
 *
 * `@aufbau/syntax` deliberately has no connective set: it parses a signature
 * into a term tree and leaves what a node denotes to whoever teaches with it.
 * `@syntax role` is the channel it provides for saying so, and this module is
 * the reading end — the one place a Carnap exercise type turns
 * `term and (p q: wff): wff` into "this is conjunction".
 *
 * Two things come out of it, and the second is the less obvious one.
 *
 * **The role index** lets a semantic exercise convert a parse into its own
 * tree. The model type evaluates a `Formula`; the truth-table type builds
 * columns from one; neither can work on a bare constructor name, and neither
 * should have to know that this textbook happens to call conjunction `and`.
 *
 * **The canonical spelling** is how a formula is written back out. A spec
 * lists every accepted spelling of a connective as a separate notation and
 * the *last* is canonical — Aufbau's own rule, and the reason a spec puts its
 * ASCII forms first and its display glyph last. So forallx writes `∧` and
 * carnap-prop, which declares nothing but ASCII, writes `/\`; both are simply
 * that spec's last word on the matter. Before this existed the display
 * symbols were a hardcoded table in the parser and the source symbols a
 * second one in the dialect record, and the two could disagree with the
 * language they claimed to spell.
 */

import type { NotationInfo, SurfaceLanguage } from "@aufbau/syntax";

export interface RoleIndex {
  /**
   * The role a constructor plays, or `null` for one with no role at all —
   * every lexicon letter, and the coercions between sorts.
   *
   * A term may carry more than one `@syntax role`; the first wins, since a
   * consumer asking "what is this node" wants one answer.
   */
  roleOf(term: string): string | null;
  /**
   * The canonical spelling of the role's constructor.
   *
   * `null` when the spec has no such role, or gives its constructor no
   * notation — a constructor spelled by its own name (a lexicon letter) has
   * none to report.
   */
  spellingFor(role: string): string | null;
  /**
   * Every spelling the spec gives the role's constructor, canonical first,
   * then the rest in declaration order — what to *recognize* where
   * `spellingFor` is what to *write*. A student types the ASCII `|-` more
   * readily than `⊢`, and a starter pasted in either should read. Empty when
   * the spec has no such role or gives it no notation.
   */
  spellingsFor(role: string): readonly string[];
  /** The constructor playing a role, or `null` if the spec omits it. */
  termFor(role: string): string | null;
  /**
   * The axiom or theorem playing a role, or `null` if the spec omits it.
   *
   * Rules and terms are separate namespaces to the engine and separate maps
   * here: `assumption` names a rule, `turnstile` a term, and a consumer asks
   * for the one it means.
   */
  ruleFor(role: string): string | null;
}

/**
 * The sort a student's formula is read at: the one carrying
 * `@syntax role sentence`, or `undefined` where the spec says nothing.
 *
 * `undefined` is not a failure — `parse` then reads at the first sort the file
 * marks `provable`, which is the whole story for a language-only spec like
 * `carnap-prop` with exactly one. It is a file that is *also* a proof theory
 * that has a choice to make: forallx: Calgary declares both `wff` and the
 * `judgement` that `⊢` yields, and a model exercise asking for a formula must
 * not be handed a sequent. Naming the sort is how it says which, and the library
 * reads the role no further than this — it interprets none of them.
 */
export function sentenceSort(lang: SurfaceLanguage): string | undefined {
  for (const info of lang.spec.sorts.values()) {
    if (info.roles.includes("sentence")) {
      return info.name;
    }
  }

  return undefined;
}

/**
 * The sort a symbol's argument list is built in: the one carrying
 * `@syntax role argument-list`, or `undefined` where the spec has none.
 *
 * A textbook's predicate letters are variadic — `F`, `F(a)` and `R(a,b)` are
 * one letter — and a spec makes them so by giving each letter a single
 * argument of a list sort, with the empty list elided and the rest joined by
 * a comma or by nothing. Which sort that is, the spec says here; *how* its
 * lists are built it need not say, because a reader flattens any node of the
 * sort by structure (`readArguments` in `exercises/first-order/formula.ts`).
 * A spec whose symbols all have fixed arity has no such sort, and `undefined`
 * is the right answer: nothing is a list, every binder is one argument.
 */
export function argumentListSort(lang: SurfaceLanguage): string | undefined {
  for (const info of lang.spec.sorts.values()) {
    if (info.roles.includes("argument-list")) {
      return info.name;
    }
  }

  return undefined;
}

/** Built once per language, like the language's own tables. */
const indexes = new WeakMap<SurfaceLanguage, RoleIndex>();

/**
 * A notation's leading token.
 *
 * A simple notation (`infixl and: $∧$ prec 30`) is its token. A general one
 * (`notation bot: wff = ($⊥$:max)`) is a list of constants and variable
 * slots, and the spelling is its first constant — which for the nullary
 * constants a textbook writes this way is the whole notation.
 */
function leadingToken(notation: NotationInfo): string | null {
  if (notation.form === "simple") {
    return notation.token;
  }

  for (const literal of notation.literals) {
    if (literal.kind === "constant") {
      return literal.token;
    }
  }

  return null;
}

export function roleIndex(lang: SurfaceLanguage): RoleIndex {
  const cached = indexes.get(lang);

  if (cached !== undefined) {
    return cached;
  }

  const roleOfTerm = new Map<string, string>();
  const termOfRole = new Map<string, string>();
  const ruleOfRole = new Map<string, string>();

  for (const [name, info] of lang.spec.rules) {
    for (const role of info.roles) {
      if (!ruleOfRole.has(role)) {
        ruleOfRole.set(role, name);
      }
    }
  }

  for (const [name, info] of lang.spec.terms) {
    const role = info.roles[0];

    if (role === undefined) {
      continue;
    }

    roleOfTerm.set(name, role);

    // A role declared twice is a spec bug rather than something to arbitrate,
    // and `tests/language-specs.test.ts` is where it would surface; the first
    // declaration wins so the reading is at least stable.
    if (!termOfRole.has(role)) {
      termOfRole.set(role, name);
    }
  }

  const index: RoleIndex = {
    roleOf: (term) => roleOfTerm.get(term) ?? null,
    spellingFor: (role) => {
      const term = termOfRole.get(role);

      if (term === undefined) {
        return null;
      }

      const notation = lang.canonical.get(term);

      return notation === undefined ? null : leadingToken(notation);
    },
    spellingsFor: (role) => {
      const term = termOfRole.get(role);

      if (term === undefined) {
        return [];
      }

      const spellings: string[] = [];
      const canonical = index.spellingFor(role);

      if (canonical !== null) {
        spellings.push(canonical);
      }

      for (const notation of lang.spec.notations) {
        const token = notation.term === term ? leadingToken(notation) : null;

        if (token !== null && !spellings.includes(token)) {
          spellings.push(token);
        }
      }

      return spellings;
    },
    termFor: (role) => termOfRole.get(role) ?? null,
    ruleFor: (role) => ruleOfRole.get(role) ?? null,
  };

  indexes.set(lang, index);

  return index;
}
