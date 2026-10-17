/**
 * Each rule of a proof theory read as sequents: what every premise assumes
 * and concludes, and what the rule concludes from them.
 *
 * Two readers need this, and it is one reading so they cannot disagree. The
 * Fitch translator infers from it how a citation names a rule's premises
 * (`exercises/aufbau-proof-fitch/citations.ts`): a premise that assumes a
 * formula is a subproof. The proof widgets print it, so that a line the rule
 * would not match can show the rule it cited (`./rule-shape.ts`).
 *
 * The reading is a parse, not a tokenization: each premise is read by the
 * theory's own `SurfaceLanguage` in engine mode (rule statements are engine
 * text), under a scope built from the rule's binders — the same trick that
 * lets a goal theorem's lines parse. The turnstile and context-join
 * constructors come from their `@syntax role`s, so nothing here names any
 * particular theory.
 *
 * In the house sequent encoding a premise's context is a join of context
 * metavariables and (via the `hyp` coercion) the formulas the rule asks to be
 * *assumed*: `imp_intro`'s `ga ; ph ⊢ ps` assumes `ph`; `imp_elim`'s
 * `ga ⊢ ph → ps` assumes nothing. An assumption the conclusion also carries is
 * ambient rather than opened by the premise, so a premise's `fresh`
 * assumptions are the ones its conclusion does not have.
 *
 * Everything is conservative. A theory whose text will not read, or that
 * declares no turnstile or context-join role, has no signatures; a rule with
 * a type hypothesis, or a sequent that will not parse or whose context holds
 * something this walk does not recognize, has none either.
 */

import type { AssertStatement, SurfaceLanguage, Term } from "@aufbau/syntax";
import { printTerm } from "@aufbau/syntax";
import { roleIndex } from "../../logic/specs/roles";
import { binderScope, theoryLanguage } from "./formulas";

/** One formula a sequent's context assumes. */
export interface RuleAssumption {
  /** Its engine-mode print: one canonical spelling per term, for identity. */
  readonly key: string;
  readonly term: Term;
}

/** A rule statement's sequent, split at its turnstile and its joins. */
export interface RuleSequent {
  /** The formulas the context assumes, in order; metavariables are not here. */
  readonly assumptions: readonly RuleAssumption[];
  /** What the sequent concludes: the turnstile's right-hand side. */
  readonly consequent: Term;
  /** The whole sequent, as parsed. */
  readonly term: Term;
}

export interface RulePremise {
  /** The assumptions this premise opens: its own, less the conclusion's. */
  readonly fresh: readonly RuleAssumption[];
  readonly sequent: RuleSequent;
}

export interface RuleSignature {
  readonly conclusion: RuleSequent;
  readonly name: string;
  /** In the order the rule states them, which is the order a proof cites. */
  readonly premises: readonly RulePremise[];
}

export interface RuleSignatures {
  /** The language the sequents were read in, which is also how to print them. */
  readonly language: SurfaceLanguage;
  /** Every rule that reads, keyed by name, in declaration order. */
  readonly rules: ReadonlyMap<string, RuleSignature>;
}

/** What reading a sequent needs to know of the theory, resolved once. */
interface SequentReading {
  readonly contextSort: string;
  /** Coercions *into* the context sort — the assumption wrappers. */
  readonly hypCoercions: ReadonlySet<string>;
  readonly join: string;
  readonly judgementSort: string;
  readonly language: SurfaceLanguage;
  readonly turnstile: string;
}

/** Keyed by language, which `theoryLanguage` already caches by source. */
const cache = new WeakMap<SurfaceLanguage, RuleSignatures | null>();

/**
 * The signature of every rule in the theory that reads as sequents, or
 * `null` where the theory will not read or names no sequent structure.
 */
export function ruleSignatures(
  source: string | null | undefined,
): RuleSignatures | null {
  const language = theoryLanguage(source);

  if (language === null) {
    return null;
  }

  if (cache.has(language)) {
    return cache.get(language) ?? null;
  }

  const signatures = readSignatures(language);
  cache.set(language, signatures);

  return signatures;
}

function readSignatures(language: SurfaceLanguage): RuleSignatures | null {
  const roles = roleIndex(language);
  const turnstile = roles.termFor("turnstile");
  const join = roles.termFor("context-join");

  if (turnstile === null || join === null) {
    return null;
  }

  const { spec } = language;
  const judgementSort = spec.terms.get(turnstile)?.returnSort;
  const contextSort = spec.terms.get(join)?.returnSort;

  if (judgementSort === undefined || contextSort === undefined) {
    return null;
  }

  const reading: SequentReading = {
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

  const rules = new Map<string, RuleSignature>();

  for (const statement of spec.statements) {
    if (statement.kind !== "axiom") {
      continue;
    }

    const signature = readSignature(statement, reading);

    if (signature !== null) {
      rules.set(statement.name, signature);
    }
  }

  return { language, rules };
}

function readSignature(
  statement: AssertStatement,
  reading: SequentReading,
): RuleSignature | null {
  const scope = binderScope(statement);
  const conclusion = readSequent(statement.conclusion.text, scope, reading);

  if (conclusion === null) {
    return null;
  }

  const ambient = new Set(conclusion.assumptions.map(({ key }) => key));
  const premises: RulePremise[] = [];

  for (const hypothesis of statement.hypotheses) {
    if ("sort" in hypothesis) {
      return null; // a type hypothesis is not a citable premise
    }

    const sequent = readSequent(hypothesis.text, scope, reading);

    if (sequent === null) {
      return null;
    }

    const seen = new Set<string>();
    const fresh = sequent.assumptions.filter(({ key }) => {
      if (ambient.has(key) || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    premises.push({ fresh, sequent });
  }

  return { conclusion, name: statement.name, premises };
}

/**
 * One rule statement's sequent, or `null` where the text does not parse as a
 * sequent or its context holds something this walk does not recognize.
 */
function readSequent(
  text: string,
  scope: ReadonlyMap<string, string>,
  reading: SequentReading,
): RuleSequent | null {
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
  const consequents = sequent.args.filter(
    (argument) => argument.sort !== reading.contextSort,
  );
  const context = contexts[0];
  const consequent = consequents[0];

  if (
    contexts.length !== 1 ||
    context === undefined ||
    consequents.length !== 1 ||
    consequent === undefined
  ) {
    return null;
  }

  const assumptions: RuleAssumption[] = [];

  return collectAssumptions(context, reading, assumptions)
    ? { assumptions, consequent, term: sequent }
    : null;
}

/**
 * Flatten a context term over the join, sorting each leaf: a context
 * metavariable contributes nothing, an assumption (a formula under a `hyp`
 * coercion, or a bare schematic variable of another sort) contributes
 * itself, an elided empty context is ignored, and anything else fails the
 * sequent.
 */
function collectAssumptions(
  term: Term,
  reading: SequentReading,
  out: RuleAssumption[],
): boolean {
  const assume = (formula: Term): void => {
    out.push({
      key: printTerm(reading.language, formula, "engine"),
      term: formula,
    });
  };

  if (term.kind === "app" && term.term === reading.join) {
    return term.args.every((argument) =>
      collectAssumptions(argument, reading, out),
    );
  }

  if (term.kind === "variable") {
    if (term.sort !== reading.contextSort) {
      assume(term);
    }

    return true;
  }

  if (reading.hypCoercions.has(term.term)) {
    const inner = term.args[0];

    if (inner === undefined) {
      return false;
    }

    assume(inner);

    return true;
  }

  // The elided empty context (`_`), should a rule ever spell one.
  if (term.sort === reading.contextSort && term.args.length === 0) {
    return true;
  }

  // A compound of another sort is a formula the parser did not wrap — the
  // same assumption as the coerced case.
  if (term.sort !== reading.contextSort) {
    assume(term);

    return true;
  }

  return false;
}
