/**
 * Wording for a failed `tests=` check, shared by the widget's local Check and
 * any server-side rendering of the same complaint. DOM-free and free of any
 * i18n import: it speaks through a {@link TranslationStrings} lookup, exactly
 * as `model/verdict-text.ts` does.
 */

import type { TranslationTestFailure } from "./logic/tests";
import type { TranslationStringId, TranslationStrings } from "./strings";

const COUNT_SENTENCES: Readonly<Record<string, TranslationStringId>> = {
  atoms: "You have {count} atomic sentences, but should have {max} at most.",
  biconditionals:
    "You have {count} biconditionals, but should have {max} at most.",
  conditionals:
    "You have {count} conditionals, but should have {max} at most.",
  conjunctions:
    "You have {count} conjunctions, but should have {max} at most.",
  connectives: "You have {count} connectives, but should have {max} at most.",
  disjunctions:
    "You have {count} disjunctions, but should have {max} at most.",
  falsums:
    "You have {count} falsity constants, but should have {max} at most.",
  negations: "You have {count} negations, but should have {max} at most.",
};

export function describeTestFailure(
  failure: TranslationTestFailure,
  strings: TranslationStrings,
): string {
  switch (failure.test.kind) {
    case "cnf":
      return strings("This submission is not in Conjunctive Normal Form.");
    case "dnf":
      return strings("This submission is not in Disjunctive Normal Form.");
    case "pnf":
      return strings("This submission is not in Prenex Normal Form.");
    case "count": {
      const id =
        COUNT_SENTENCES[failure.test.feature] ??
        "You have {count} connectives, but should have {max} at most.";
      return strings(id, {
        count: String(failure.count),
        max: String(failure.test.max),
      });
    }
  }
}
