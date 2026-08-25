/**
 * Whether a submitted formula *is* one of the intended answers, typed out.
 *
 * This is the fast path both the widget and the grader take before any
 * equivalence search, and the two have to agree exactly — a student told "this
 * matches" by the widget and marked wrong by the server would have no way to
 * make sense of it — so they share this rather than each comparing strings.
 *
 * The comparison canonicalizes *both* sides. The stored solutions were
 * canonical when the revision was compiled, so re-parsing them is a no-op
 * whenever the canonical form has not moved; when it has — and it moved once
 * already, when the spelling table became the spec's rather than a hardcoded
 * one — a stored artifact keeps grading correctly instead of silently failing
 * to match every submission until someone re-saves it. A solution that no
 * longer parses at all is skipped, which is the same "cannot be correct" it
 * would be if it were compared and missed.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import type { Formula } from "../../first-order";
import { formulaToString, parseFormula } from "../../first-order";

/**
 * The index of the first stored solution the formula matches verbatim, or
 * `-1`. The index matters: it is what a certificate names.
 */
export function verbatimSolutionIndex(
  formula: Formula,
  solutions: readonly string[],
  lang: SurfaceLanguage,
): number {
  const canonical = formulaToString(formula, lang);

  return solutions.findIndex((solution) => {
    const parsed = parseFormula(solution, lang);

    return parsed.ok && formulaToString(parsed.formula, lang) === canonical;
  });
}
