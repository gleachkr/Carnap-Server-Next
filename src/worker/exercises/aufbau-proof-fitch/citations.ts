/**
 * Infer, from each rule's own signature, how its Fitch citation names its
 * premises — the table Carnap's Haskell declared by hand as `indirectInference`
 * (`PolyProof`, `TypedProof (ProofType 1 2)`, …), derived here instead.
 *
 * The signature carries the information. In the house sequent encoding a
 * premise's context is a join of context metavariables and (via the `hyp`
 * coercion) the formulas the rule asks to be *assumed*: `imp_intro`'s
 * `ga ; ph ⊢ ps` assumes `ph`, so that premise is a subproof; `imp_elim`'s
 * `ga ⊢ ph → ps` assumes nothing, so it is an ordinary line. Premises that
 * assume the *same* formula are drawn from one subproof — Magnus's `¬I`, whose
 * `ga ; ph ⊢ ps` and `de ; ph ⊢ ¬ ps` make one cited range supply the box's
 * last two lines, the textbook's own citation shape. That reproduces every
 * arity Carnap hand-declared for the systems shipped here, without a rule ever
 * saying anything beyond its sequents.
 *
 * The reading is a parse, not a tokenization: each premise is read by the
 * theory's own `SurfaceLanguage` in engine mode (rule statements are engine
 * text), under a scope built from the rule's binders — the same trick that
 * lets a goal theorem's lines parse. The turnstile and context-join
 * constructors come from their `@syntax role`s, so nothing here names any
 * particular theory. Assumption identity is the engine-mode print of the
 * formula, one canonical spelling per term.
 *
 * Everything is conservative. A theory whose text will not read, or that
 * declares no turnstile or context-join role, gets an empty table; a rule
 * whose premises will not parse, or whose context holds something this walk
 * does not recognize (a premise assuming two formulas at once, say), gets no
 * entry. No entry means the translator's plain lowering — which is the correct
 * reading for every such rule we know of — so misclassification degrades to
 * the status quo, never to a wrong proof.
 */

import type { AssertStatement, SurfaceLanguage, Term } from "@aufbau/syntax";
import { printTerm } from "@aufbau/syntax";
import { theoryLanguage } from "../../exercise-kit/proof/formulas";
import { roleIndex } from "../../logic/specs/roles";
import type { CitationSlot, RuleCitationShape } from "./translate";

/** What one theory's classification needs to know, resolved once. */
interface RuleReading {
  readonly contextSort: string;
  /** Coercions *into* the context sort — the assumption wrappers. */
  readonly hypCoercions: ReadonlySet<string>;
  readonly join: string;
  readonly judgementSort: string;
  readonly language: SurfaceLanguage;
  readonly turnstile: string;
}

const EMPTY: ReadonlyMap<string, RuleCitationShape> = new Map();

/** Keyed by the exercise's frozen source, like the language cache it leans on. */
const tables = new Map<string, ReadonlyMap<string, RuleCitationShape>>();

/**
 * The citation shape of every rule the theory's signature classifies, keyed by
 * rule name. Callers hand the result to `fitchToAuf`; an empty map (a theory
 * whose text will not read, or that names no sequent structure) is always safe.
 */
export function ruleCitationShapes(
  source: string | null | undefined,
): ReadonlyMap<string, RuleCitationShape> {
  if (source === null || source === undefined) {
    return EMPTY;
  }

  const cached = tables.get(source);

  if (cached !== undefined) {
    return cached;
  }

  const table = deriveShapes(source);
  tables.set(source, table);

  return table;
}

function deriveShapes(
  source: string,
): ReadonlyMap<string, RuleCitationShape> {
  const language = theoryLanguage(source);

  if (language === null) {
    return EMPTY;
  }

  const roles = roleIndex(language);
  const turnstile = roles.termFor("turnstile");
  const join = roles.termFor("context-join");

  if (turnstile === null || join === null) {
    return EMPTY;
  }

  const { spec } = language;
  const judgementSort = spec.terms.get(turnstile)?.returnSort;
  const contextSort = spec.terms.get(join)?.returnSort;

  if (judgementSort === undefined || contextSort === undefined) {
    return EMPTY;
  }

  const reading: RuleReading = {
    contextSort,
    hypCoercions: new Set(
      spec.coercions
        .filter((coercion) => coercion.to === contextSort)
        .map((coercion) => coercion.name),
    ),
    join,
    judgementSort,
    language,
    turnstile,
  };

  const table = new Map<string, RuleCitationShape>();

  for (const statement of spec.statements) {
    if (statement.kind !== "axiom" || statement.hypotheses.length === 0) {
      continue;
    }

    const shape = classifyRule(statement, reading);

    if (shape !== null) {
      table.set(statement.name, shape);
    }
  }

  return table;
}

function classifyRule(
  statement: AssertStatement,
  reading: RuleReading,
): RuleCitationShape | null {
  const scope = new Map<string, string>();

  for (const binder of statement.binders) {
    if ("sort" in binder.type) {
      scope.set(binder.name, binder.type.sort);
    }
  }

  const conclusion = contextAssumptions(
    statement.conclusion.text,
    scope,
    reading,
  );

  if (conclusion === null) {
    return null;
  }

  // An assumption the conclusion *also* carries is ambient, not something the
  // premise's subproof opens — a rule usable inside a box cites lines there.
  // No shipped rule concludes into a hypothetical context, but the subtraction
  // is what the classification means, so it is stated.
  const ambient = new Set(conclusion);
  const premises: (string | null)[] = [];

  for (const hypothesis of statement.hypotheses) {
    if ("sort" in hypothesis) {
      return null; // a type hypothesis is not a citable premise
    }

    const assumptions = contextAssumptions(hypothesis.text, scope, reading);

    if (assumptions === null) {
      return null;
    }

    const fresh = [
      ...new Set(assumptions.filter((key) => !ambient.has(key))),
    ];

    if (fresh.length > 1) {
      return null; // a several-assumption subproof: no Fitch box has that shape
    }

    premises.push(fresh[0] ?? null);
  }

  const groups = new Map<string, number[]>();

  for (const [index, key] of premises.entries()) {
    if (key !== null) {
      const members = groups.get(key);

      if (members === undefined) {
        groups.set(key, [index]);
      } else {
        members.push(index);
      }
    }
  }

  const slots: CitationSlot[] = [];
  const placed = new Set<string>();

  for (const [index, key] of premises.entries()) {
    if (key === null) {
      slots.push({ kind: "line", premises: [index] });
    } else if (!placed.has(key)) {
      placed.add(key);
      slots.push({ kind: "range", premises: groups.get(key) ?? [index] });
    }
  }

  return { premiseCount: premises.length, slots };
}

/**
 * The assumption formulas in one sequent's context, as canonical engine
 * spellings — or `null` where the text does not parse as a sequent or its
 * context holds something this walk does not recognize.
 */
function contextAssumptions(
  text: string,
  scope: ReadonlyMap<string, string>,
  reading: RuleReading,
): readonly string[] | null {
  let result: ReturnType<SurfaceLanguage["parse"]>;

  try {
    result = reading.language.parse(text.trim(), {
      mode: "engine",
      scope,
      sort: reading.judgementSort,
    });
  } catch {
    return null;
  }

  if (!result.ok) {
    return null;
  }

  const sequent = result.term;

  if (sequent.kind !== "app" || sequent.term !== reading.turnstile) {
    return null;
  }

  const contexts = sequent.args.filter(
    (argument) => argument.sort === reading.contextSort,
  );
  const context = contexts[0];

  if (contexts.length !== 1 || context === undefined) {
    return null;
  }

  const assumptions: string[] = [];

  return collectAssumptions(context, reading, assumptions)
    ? assumptions
    : null;
}

/**
 * Flatten a context term over the join, sorting each leaf: a context
 * metavariable contributes nothing, an assumption (a formula under a `hyp`
 * coercion, or a bare schematic variable of another sort) contributes its
 * engine spelling, an elided empty context is ignored, and anything else
 * fails the rule into the safe no-entry default.
 */
function collectAssumptions(
  term: Term,
  reading: RuleReading,
  out: string[],
): boolean {
  if (term.kind === "app" && term.term === reading.join) {
    return term.args.every((argument) =>
      collectAssumptions(argument, reading, out),
    );
  }

  if (term.kind === "variable") {
    if (term.sort !== reading.contextSort) {
      out.push(printTerm(reading.language, term, "engine"));
    }

    return true;
  }

  if (reading.hypCoercions.has(term.term)) {
    const inner = term.args[0];

    if (inner === undefined) {
      return false;
    }

    out.push(printTerm(reading.language, inner, "engine"));

    return true;
  }

  // The elided empty context (`_`), should a rule ever spell one.
  if (term.sort === reading.contextSort && term.args.length === 0) {
    return true;
  }

  // A compound of another sort is a formula the parser did not wrap — the
  // same assumption as the coerced case, printed the same way.
  if (term.sort !== reading.contextSort) {
    out.push(printTerm(reading.language, term, "engine"));

    return true;
  }

  return false;
}
