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
   * The core role a constructor plays, or `null` for one with no core role —
   * every lexicon letter, the coercions between sorts, and a constructor
   * whose only roles are namespaced ({@link isNamespacedRole}).
   *
   * A term may carry more than one `@syntax role`; the first core one wins,
   * since a consumer asking "what is this node" wants one answer.
   */
  roleOf(term: string): string | null;
  /**
   * Every role in a namespace, mapped to the constructor playing it:
   * `rolesIn("blocks")` might give `blocks.cube → Cube`. The consumer that
   * owns the namespace reads these; to everyone else the constructors are
   * role-less. The first constructor declared with a role wins, as for
   * {@link termFor}.
   */
  rolesIn(namespace: string): ReadonlyMap<string, string>;
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
  return sortsWithRole(lang, "sentence")[0];
}

/**
 * The sorts whose values are the *individuals* a model's domain holds: those
 * carrying `@syntax role individual`, in declaration order.
 *
 * This is the positive half of what the first-order readers interpret. A
 * symbol's argument is an individual when its sort is one of these or coerces
 * into one — forallx: Calgary marks `tm`, and `var` and `name` reach it by
 * coercion — and a symbol whose every argument is an individual (or an
 * argument list of them) is a function or predicate in the ordinary sense.
 * Anything else, a sentence-sorted argument say, has no value in a finite
 * model and is refused where it stands. Several sorts here would be a
 * many-sorted language; the model tool reads one domain today, so the
 * shipped specs name exactly one.
 */
export function individualSorts(lang: SurfaceLanguage): readonly string[] {
  return sortsWithRole(lang, "individual");
}

/** The sorts carrying `@syntax role <role>`, in declaration order. */
export function sortsWithRole(lang: SurfaceLanguage, role: string): string[] {
  const sorts: string[] = [];

  for (const info of lang.spec.sorts.values()) {
    if (info.roles.includes(role)) {
      sorts.push(info.name);
    }
  }

  return sorts;
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
 * sort by structure (`readArguments` in `exercise-kit/formula/formula.ts`).
 * A spec whose symbols all have fixed arity has no such sort, and `undefined`
 * is the right answer: nothing is a list, every binder is one argument.
 */
export function argumentListSort(lang: SurfaceLanguage): string | undefined {
  return sortsWithRole(lang, "argument-list")[0];
}

/**
 * Whether a role belongs to one consumer's namespace rather than the core
 * vocabulary: `blocks.left-of` does, `conjunction` does not.
 *
 * A dotted role is the convention by which a spec says what a symbol means to
 * one exercise type without saying anything to the others. The world exercise
 * reads `blocks.cube` as "the block is a cube"; the model and the translation
 * read the same constructor as an ordinary predicate, because to them it has
 * no role at all. So one blocks language serves all three.
 */
export function isNamespacedRole(role: string): boolean {
  return role.includes(".");
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
    const core = info.roles.find((role) => !isNamespacedRole(role));

    if (core !== undefined) {
      roleOfTerm.set(name, core);
    }

    // A role declared twice is a spec bug rather than something to arbitrate,
    // and `tests/language-specs.test.ts` is where it would surface; the first
    // declaration wins so the reading is at least stable.
    for (const role of info.roles) {
      if (!termOfRole.has(role)) {
        termOfRole.set(role, name);
      }
    }
  }

  const index: RoleIndex = {
    roleOf: (term) => roleOfTerm.get(term) ?? null,
    rolesIn: (namespace) => {
      const prefix = `${namespace}.`;
      const roles = new Map<string, string>();

      for (const [role, term] of termOfRole) {
        if (role.startsWith(prefix)) {
          roles.set(role, term);
        }
      }

      return roles;
    },
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
