/**
 * MM0 emission for the translation type: turn a pair of parsed formulas into
 * the `(mm0, auf)` sources whose one-line `auto?` proof — found by the
 * engine's search in the browser, verified from its MMB certificate on the
 * worker — is the statement that the two are logically equivalent.
 *
 * DOM-free and deterministic, because it runs on both sides of the trust
 * boundary: the client builds these sources to *search*, the worker rebuilds
 * the same mm0 from its own parse to *verify*, and a certificate for anything
 * else simply fails verification.
 *
 * Two emission choices carry the correctness weight:
 *
 *   - **Every quantifier occurrence gets its own bound name** (`v0`, `v1`, …,
 *     left formula first). Nothing has to be canonicalized: the calculus in
 *     [`theories.ts`](./theories.ts) handles alpha-equivalence itself, through
 *     `@alpha` rules and the `@freshen` repair the quantifier rules carry, so
 *     `∀x∀y H(x,y)` and `∀y∀x H(y,x)` are proved equal rather than made equal
 *     by spelling. Distinct names also keep MM0's dependency discipline —
 *     which is what enforces the eigenvariable side condition — from ever
 *     aliasing two different binders.
 *   - **Surface symbols are mangled with their arity** (`p_Fs2_1` for `F_2`
 *     used one-place). A dialect name is a single letter plus an optional
 *     numeric subscript, so encoding `_` as `s` is collision-free, and keying
 *     by arity keeps a formula pair that uses one letter at two arities from
 *     emitting a duplicate declaration — such a pair is simply inequivalent
 *     over distinct symbols, never invalid MM0.
 *
 * The signature's own symbols are applied by bare prefix application
 * (`(p_F_1 c_a)`); the calculus's connectives use the notation the theory
 * declares, so the emitted goal reads like ordinary logic.
 */

import type { Formula, Term } from "../../first-order";
import { buildTheory, type TranslationSignature } from "./theories";

/** What the equivalence check hands the engine: the theory (calculus + symbol
 * declarations + the `check` theorem) and the one-line proof to search. */
export interface EquivalenceCheckSources {
  readonly mm0: string;
  readonly auf: string;
  /** Zero-based position of the `auto?` placeholder inside `auf`, where the
   * LSP `textDocument/codeAction` request must point. */
  readonly placeholder: { readonly line: number; readonly character: number };
}

const CONNECTIVE_TERMS: Record<"and" | "or" | "if" | "iff", string> = {
  and: "∧",
  if: "→",
  iff: "↔",
  or: "∨",
};

/** `F_2` → `Fs2`. Dialect names are one letter plus an optional `_digits`
 * subscript, so this cannot collide. */
function encodeName(name: string): string {
  return name.replace(/_/g, "s");
}

/** Mutable signature accumulated while emitting, handed to `buildTheory`. */
interface Collector {
  readonly predicates: Map<string, number>;
  readonly functions: Map<string, number>;
  readonly constants: Set<string>;
  usesIdentity: boolean;
  readonly boundNames: string[];
}

function declarePredicate(
  collector: Collector,
  name: string,
  arity: number,
): string {
  const mangled = `p_${encodeName(name)}_${String(arity)}`;
  collector.predicates.set(mangled, arity);
  return mangled;
}

function declareConstant(collector: Collector, name: string): string {
  const mangled = `c_${encodeName(name)}`;
  collector.constants.add(mangled);
  return mangled;
}

function declareFunction(
  collector: Collector,
  name: string,
  arity: number,
): string {
  const mangled = `f_${encodeName(name)}_${String(arity)}`;
  collector.functions.set(mangled, arity);
  return mangled;
}

/** Bound-variable environment: surface name → emitted binder name. */
type Scope = ReadonlyMap<string, string>;

function emitTerm(term: Term, collector: Collector, scope: Scope): string {
  switch (term.type) {
    case "variable": {
      const bound = scope.get(term.name);
      if (bound === undefined) {
        // Translations are closed sentences; the callers reject free
        // variables with a reader-facing message before emission.
        throw new Error(`free variable in emission: ${term.name}`);
      }
      return bound;
    }
    case "constant":
      return declareConstant(collector, term.name);
    case "function": {
      const mangled = declareFunction(collector, term.name, term.args.length);
      const args = term.args.map((arg) => emitTerm(arg, collector, scope));
      return `(${mangled} ${args.join(" ")})`;
    }
  }
}

function emitFormula(
  formula: Formula,
  collector: Collector,
  scope: Scope,
): string {
  switch (formula.type) {
    case "predicate": {
      const mangled = declarePredicate(
        collector,
        formula.name,
        formula.args.length,
      );
      if (formula.args.length === 0) {
        return mangled;
      }
      const args = formula.args.map((arg) => emitTerm(arg, collector, scope));
      return `(${mangled} ${args.join(" ")})`;
    }
    case "identity": {
      collector.usesIdentity = true;
      const left = emitTerm(formula.left, collector, scope);
      const right = emitTerm(formula.right, collector, scope);
      return `(ideq ${left} ${right})`;
    }
    case "falsum":
      return "⊥";
    case "verum":
      return "⊤";
    case "not":
      return `(¬ ${emitFormula(formula.operand, collector, scope)})`;
    case "and":
    case "or":
    case "if":
    case "iff": {
      const left = emitFormula(formula.left, collector, scope);
      const right = emitFormula(formula.right, collector, scope);
      return `(${left} ${CONNECTIVE_TERMS[formula.type]} ${right})`;
    }
    case "forall":
    case "exists": {
      const bound = `v${String(collector.boundNames.length)}`;
      collector.boundNames.push(bound);
      const inner = new Map(scope);
      inner.set(formula.variable, bound);
      const body = emitFormula(formula.body, collector, inner);
      const quantifier = formula.type === "forall" ? "∀" : "∃";
      return `(${quantifier} ${bound} ${body})`;
    }
  }
}

/**
 * Build the sources whose successful search certifies `student ↔ solution`
 * over the calculus in [`theories.ts`](./theories.ts).
 *
 * Both formulas must be closed; the goal name is always `check`; the
 * signature is sorted before it reaches the theory, so the worker's rebuild is
 * byte-identical to the client's.
 */
export function buildEquivalenceCheck(
  student: Formula,
  solution: Formula,
): EquivalenceCheckSources {
  const collector: Collector = {
    boundNames: [],
    constants: new Set(),
    functions: new Map(),
    predicates: new Map(),
    usesIdentity: false,
  };
  const scope: Scope = new Map();
  const left = emitFormula(student, collector, scope);
  const right = emitFormula(solution, collector, scope);
  const goal = `⊢ (${left} ↔ ${right})`;

  const signature: TranslationSignature = {
    boundNames: collector.boundNames,
    constants: [...collector.constants].sort(),
    functions: new Map([...collector.functions].sort(byName)),
    predicates: new Map([...collector.predicates].sort(byName)),
    usesIdentity: collector.usesIdentity,
  };

  const binders =
    collector.boundNames.length === 0
      ? ""
      : ` {${collector.boundNames.join(" ")}: obj}`;

  const mm0 = `${buildTheory(signature)}\ntheorem check${binders}: $ ${goal} $;\n`;
  const goalLine = `goal: $ ${goal} $ by auto?`;
  const auf = `check\n-----\n${goalLine}\n`;

  return {
    auf,
    mm0,
    placeholder: { character: goalLine.indexOf("auto?"), line: 2 },
  };
}

function byName(a: readonly [string, number], b: readonly [string, number]) {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}
