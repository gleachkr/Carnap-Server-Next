/**
 * Putting a {@link ModelVerdict} into words.
 *
 * Shared by the widget's local Check and the server's review view so the two
 * cannot drift: a student who pressed Check before submitting reads the same
 * sentence back on the results page. It takes a {@link ModelStrings} lookup
 * rather than a translator, so it works in the browser where no i18n runtime
 * ships.
 *
 * Which nouns a sentence uses depends on the variant, which is the only thing
 * the variant is still needed for after compilation: a validity exercise talks
 * about premises and conclusions, a constraint exercise about constraints, and a
 * simple one about formulas.
 */

import type {
  FirstOrderDialect,
  Formula,
  ModelProblem,
  ModelTarget,
  ModelVerdict,
} from "./logic";
import { formulaToDisplay } from "./logic";
import type { ModelStringId, ModelStrings } from "./strings";
import type { ModelVariant } from "./types";

/**
 * The formulas at these indices, in the logical symbols the exercise shows them
 * in rather than the ASCII they are stored as — the original words these
 * messages with `rewriteWith opts . show` for the same reason.
 */
function nameFormulas(
  formulas: readonly Formula[],
  indices: readonly number[],
  dialect: FirstOrderDialect,
): string {
  return indices
    .map((index) => {
      const formula = formulas[index];
      return formula === undefined ? "" : formulaToDisplay(formula, dialect);
    })
    .filter((source) => source !== "")
    .join(", ");
}

/** Why a submitted model is not a model, in one sentence. */
export function describeProblem(
  problem: ModelProblem,
  strings: ModelStrings,
): string {
  switch (problem.kind) {
    case "domain-empty":
      return strings("The domain cannot be empty.");
    case "domain-unreadable":
      return strings("The domain must be a comma-separated list of numbers.");
    case "domain-too-large":
      return strings("A domain may have at most {max} elements.", {
        max: String(problem.max),
      });
    case "field-unreadable":
      return strings("Could not read the value of {field}.", {
        field: problem.field,
      });
    case "field-outside-domain":
      return strings(
        "The extension of {field} is not contained in the domain.",
        { field: problem.field },
      );
    case "function-incomplete":
      return strings("In this model {field} has no value for {argument}.", {
        argument: problem.argument,
        field: problem.field,
      });
    case "function-ambiguous":
      return strings(
        "In this model {field} has more than one value for {argument}.",
        { argument: problem.argument, field: problem.field },
      );
    default:
      return strings(
        "This domain gives {field} too many arguments to fill in.",
        { field: problem.field },
      );
  }
}

/** Which sentence names the required formulas that came out false. */
function requiredMessageId(variant: ModelVariant): ModelStringId {
  return variant === "validity"
    ? "Not all premises are true in this model. Take another look at: {formulas}."
    : "Not all of this problem's constraints hold in this model. Take another look at: {formulas}.";
}

/** Which sentence names the targeted formulas that missed the target. */
function targetMessageId(
  variant: ModelVariant,
  target: ModelTarget,
): ModelStringId {
  if (target === "not-all-equal") {
    return "Every formula has the same truth value in this model, so it is not a counterexample to equivalence.";
  }

  if (variant === "validity") {
    return target === "all-true"
      ? "Not all conclusions are true in this model. Take another look at: {formulas}."
      : "Not all conclusions are false in this model. Take another look at: {formulas}.";
  }

  return target === "all-true"
    ? "Not all formulas are true in this model. Take another look at: {formulas}."
    : "Not all formulas are false in this model. Take another look at: {formulas}.";
}

export interface VerdictContext {
  readonly dialect: FirstOrderDialect;
  readonly required: readonly Formula[];
  readonly target: ModelTarget;
  readonly targeted: readonly Formula[];
  readonly variant: ModelVariant;
}

/**
 * The whole verdict as prose.
 *
 * A failed prerequisite and a missed target are reported together rather than
 * one at a time, which is what Carnap's validity checker does — "not all
 * conclusions are false in this model, and not all premises are true" — because
 * fixing one and rediscovering the other is a wasted round trip.
 */
export function describeVerdict(
  verdict: ModelVerdict,
  context: VerdictContext,
  strings: ModelStrings,
): string {
  if (verdict.problem !== null) {
    return describeProblem(verdict.problem, strings);
  }

  if (verdict.ok) {
    return strings("This model does everything the exercise asks.");
  }

  const sentences: string[] = [];

  if (verdict.requiredFalse.length > 0) {
    sentences.push(
      strings(requiredMessageId(context.variant), {
        formulas: nameFormulas(
          context.required,
          verdict.requiredFalse,
          context.dialect,
        ),
      }),
    );
  }

  if (verdict.targetMissed) {
    sentences.push(
      strings(targetMessageId(context.variant, context.target), {
        formulas: nameFormulas(
          context.targeted,
          verdict.targetOffenders,
          context.dialect,
        ),
      }),
    );
  }

  return sentences.join(" ");
}
