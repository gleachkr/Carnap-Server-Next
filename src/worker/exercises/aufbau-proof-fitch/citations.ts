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
 * The signature itself is read once, for every proof widget, in
 * `exercise-kit/proof/rule-signatures.ts`: each premise's context split at the
 * theory's own context-join role, and its *fresh* assumptions — the ones the
 * rule's conclusion does not also carry — set apart. This module only groups
 * premises by them.
 *
 * Everything is conservative. A theory whose text will not read, or that
 * declares no turnstile or context-join role, gets an empty table; a rule
 * whose premises will not parse, or whose context holds something this walk
 * does not recognize (a premise assuming two formulas at once, say), gets no
 * entry. No entry means the translator's plain lowering — which is the correct
 * reading for every such rule we know of — so misclassification degrades to
 * the status quo, never to a wrong proof.
 */

import type { RuleSignature } from "../../exercise-kit/proof/rule-signatures";
import { ruleSignatures } from "../../exercise-kit/proof/rule-signatures";
import type { CitationSlot, RuleCitationShape } from "./translate";

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
  const signatures = ruleSignatures(source);

  if (signatures === null) {
    return EMPTY;
  }

  const table = new Map<string, RuleCitationShape>();

  for (const signature of signatures.rules.values()) {
    if (signature.premises.length === 0) {
      continue;
    }

    const shape = classifyRule(signature);

    if (shape !== null) {
      table.set(signature.name, shape);
    }
  }

  return table;
}

function classifyRule(signature: RuleSignature): RuleCitationShape | null {
  const premises: (string | null)[] = [];

  for (const { fresh } of signature.premises) {
    if (fresh.length > 1) {
      return null; // a several-assumption subproof: no Fitch box has that shape
    }

    premises.push(fresh[0]?.key ?? null);
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
