/**
 * A rule's shape, for a student whose line the rule would not match.
 *
 * The engine's message for that — "the statement and cited premises could not
 * be matched against this rule" — is accurate and no help: it does not say
 * what the rule wanted, and a student who misremembers it (gh #36: both of
 * ∨E's subproofs must end in the line's own formula) reads a correct
 * rejection as a bug. So the rule is shown, from its own axiom, in the
 * theory's language: `∨E: ph ∨ ps, ph … ch, ps … ch ∴ ch`.
 *
 * The shape is data — a label, the premises, the conclusion, each premise its
 * own text — and the widgets draw each premise in its own box
 * (`client/components/proof-problem.ts`), so nothing between two premises
 * has to be a character a formula or a context could also contain.
 * {@link ruleShapeText} spells it out for what has to be text: what F8 reads
 * aloud, and a test's expectation.
 *
 * Each widget gets the rule in its own idiom. A tree node and a linear `.auf`
 * line state whole sequents, so their shape is the axiom's sequents as they
 * stand. A Fitch line or a Prawitz node states only a formula, with its
 * context implicit in where it sits, so there the context metavariables are
 * dropped and a premise's fresh assumption ({@link ruleSignatures}) is drawn
 * the way that proof draws it: Fitch opens a subproof (`ph … ch`), and one
 * subproof supplies every premise that assumes the same formula, as Magnus's
 * ¬I cites one range for `ps` and `¬ps`; Prawitz discharges it (`[ph] … ch`).
 * A Fitch subproof opens one assumption, so a premise opening more is shown
 * as sequents instead.
 *
 * The metavariables are the axiom's own binder names (`ph`, `ga`). A theory
 * cannot yet say how to print them; a textbook's 𝒜 and ℬ would need it to.
 *
 * A rule paired with another by `@fallback` — ∧E, whose two sides are two
 * axioms — is shown as both, one line each, in declaration order. Each line is
 * named as the proof cites it: where a proof cites by alias, by the pair's
 * first `@syntax alias` (the textbook's name), or the rule's own where it has
 * none; in a linear `.auf` proof, which cites axioms by name, by each one's.
 */

import { printTerm, type Term, UnprintableTermError } from "@aufbau/syntax";
import { displayStatement } from "./formulas";
import {
  type RulePremise,
  type RuleSignature,
  type RuleSignatures,
  ruleSignatures,
} from "./rule-signatures";

/** How the widget writes a proof, which is how it wants a rule shown. */
export type RuleShapeStyle = "fitch" | "prawitz" | "sequent";

/** How the proof names a rule: by its textbook alias, or by the axiom. */
export type RuleNaming = "alias" | "axiom";

/** One premise, as the citation names it. */
export interface RuleShapePremise {
  readonly text: string;
  /** A Fitch subproof, `ph … ch`: drawn as a box, as the editor draws one. */
  readonly subproof: boolean;
}

/** One rule: one axiom, or one side of a `@fallback` pair. */
export interface RuleShapeLine {
  readonly conclusion: string;
  readonly label: string;
  readonly premises: readonly RuleShapePremise[];
}

/** A rule's shape: a line per side of a `@fallback` pair, otherwise one. */
export type RuleShape = readonly RuleShapeLine[];

/** A rule name the engine reported, to its shape. */
export type RuleShapeReader = (rule: string) => RuleShape | null;

/** Shows nothing — the reader where the theory cannot say. */
export const NO_RULE_SHAPES: RuleShapeReader = () => null;

/**
 * The shape reader for a proof exercise's frozen theory text, in `style`:
 * the rule's shape, or `null` for a rule the theory does not state as
 * sequents.
 */
export function ruleShapeReader(
  source: string | null | undefined,
  style: RuleShapeStyle,
  naming: RuleNaming = "alias",
): RuleShapeReader {
  const signatures = ruleSignatures(source);

  if (signatures === null) {
    return NO_RULE_SHAPES;
  }

  const shown = new Map<string, RuleShape | null>();

  return (rule) => {
    if (!shown.has(rule)) {
      shown.set(rule, readShape(signatures, rule, style, naming));
    }

    return shown.get(rule) ?? null;
  };
}

/**
 * The shape as text, a line per rule: `∨E: ph ∨ ps, ph … ch, ps … ch ∴ ch`.
 * For what has to be text — what is read aloud, and the hidden separators the
 * drawn shape carries for a reader that meets it as text — where a comma
 * between premises is a pause, not a parse.
 */
export function ruleShapeText(shape: RuleShape): string {
  return shape
    .map(({ conclusion, label, premises }) =>
      premises.length === 0
        ? `${label}: ${conclusion}`
        : `${label}: ${premises.map(({ text }) => text).join(", ")} ∴ ${conclusion}`,
    )
    .join("\n");
}

function readShape(
  signatures: RuleSignatures,
  rule: string,
  style: RuleShapeStyle,
  naming: RuleNaming,
): RuleShape | null {
  const { spec } = signatures.language;
  const pair = fallbackPair(signatures, rule);
  const alias = pair
    .map((name) => spec.rules.get(name)?.aliases[0])
    .find((first) => first !== undefined);
  const lines = pair
    .map((name) => signatures.rules.get(name))
    .filter((signature) => signature !== undefined)
    .map((signature) => ({
      ...shapeLine(signatures, signature, style),
      label: naming === "alias" ? (alias ?? signature.name) : signature.name,
    }));

  return lines.length === 0 ? null : lines;
}

/**
 * The rule and every rule its `@fallback` chain reaches, in declaration
 * order. A fallback always names an earlier rule (the reader refuses any
 * other), so the chain ends, and reversed it is in declaration order.
 */
function fallbackPair(
  signatures: RuleSignatures,
  rule: string,
): readonly string[] {
  const { spec } = signatures.language;
  const chain: string[] = [];

  for (
    let name: string | null | undefined = rule;
    name !== null && name !== undefined;
    name = spec.rules.get(name)?.fallback
  ) {
    chain.push(name);
  }

  return chain.reverse();
}

function shapeLine(
  signatures: RuleSignatures,
  signature: RuleSignature,
  style: RuleShapeStyle,
): Omit<RuleShapeLine, "label"> {
  const { language } = signatures;
  // Engine text can spell what display text cannot (an elided term); such a
  // term is shown as the axiom spells it.
  const orEngine =
    (display: (term: Term) => string) =>
    (term: Term): string => {
      try {
        return display(term);
      } catch (error) {
        if (error instanceof UnprintableTermError) {
          return printTerm(language, term, "engine");
        }
        throw error;
      }
    };
  const print = orEngine((term) => printTerm(language, term, "display"));
  const sequent = orEngine((term) => displayStatement(language, term));
  const plain = (text: string): RuleShapePremise => ({
    subproof: false,
    text,
  });

  const fitchable = signature.premises.every(
    ({ fresh }) => fresh.length <= 1,
  );

  if (style === "sequent" || (style === "fitch" && !fitchable)) {
    return {
      conclusion: sequent(signature.conclusion.term),
      premises: signature.premises.map((premise) =>
        plain(sequent(premise.sequent.term)),
      ),
    };
  }

  return {
    conclusion: print(signature.conclusion.consequent),
    premises:
      style === "fitch"
        ? fitchPremises(signature.premises, print)
        : signature.premises.map(({ fresh, sequent: { consequent } }) =>
            plain(
              [
                ...fresh.map((assumption) => `[${print(assumption.term)}]`),
                print(consequent),
              ].join(" … "),
            ),
          ),
  };
}

/**
 * A Fitch rule's premises as its citation names them: an ordinary line by
 * its formula, and a subproof once, from its assumption through every premise
 * it supplies — at the first of them, as the citation lists it.
 */
function fitchPremises(
  premises: readonly RulePremise[],
  print: (term: Term) => string,
): readonly RuleShapePremise[] {
  const boxes = new Map<string, string[]>();
  const slots: { readonly lines: string[]; readonly subproof: boolean }[] =
    [];

  for (const { fresh, sequent } of premises) {
    const [assumption] = fresh;
    const consequent = print(sequent.consequent);

    if (assumption === undefined) {
      slots.push({ lines: [consequent], subproof: false });
      continue;
    }

    const box = boxes.get(assumption.key);

    if (box === undefined) {
      const opened = [print(assumption.term), consequent];
      boxes.set(assumption.key, opened);
      slots.push({ lines: opened, subproof: true });
    } else {
      box.push(consequent);
    }
  }

  return slots.map(({ lines, subproof }) => ({
    subproof,
    text: lines.join(" … "),
  }));
}
