/**
 * The forallx: Calgary natural-deduction theory, as the tests see it.
 *
 * The theory itself ships at `src/worker/logic/theories/forallx-calgary-2019.mm0`
 * and is served at `/theories/forallx-calgary-2019.mm0`; its header is where the
 * rule→axiom table, the eigenvariable discussion, and the warning about
 * dependency lists now live. This module is a re-export so that the demo
 * lessons and `scripts/{forallx,prawitz,showcase}-verify.ts` exercise the text
 * an author actually gets, and cannot drift from it.
 */

import { stripSyntaxAnnotations } from "@aufbau/syntax";
import type { ProofFormulaReader } from "../../src/worker/exercises/aufbau-proof/formulas";
import {
  proofFormulaReader,
  proofTheoryText,
} from "../../src/worker/exercises/aufbau-proof/formulas";
import { withSystemText } from "../../src/worker/exercises/systems";
import { THEORY_SOURCES } from "../../src/worker/logic/theories";

const source = THEORY_SOURCES["forallx-calgary-2019.mm0"];

if (source === undefined) {
  throw new Error("the forallx-calgary-2019 theory is no longer registered");
}

/** The artifact as it is served and as an author reads it, `@syntax` and all. */
export const FORALLX_THEORY_SOURCE = source;

/**
 * The same theory as the *engine* sees it.
 *
 * This file is also forallx: Calgary's language, so it carries `@syntax`
 * annotations, and the engine rejects an annotation that is not its own. The
 * authoring compiler strips them where it freezes a theory into
 * `publicData.mm0`; anything handing the text straight to the compiler — the
 * verify scripts, and the tests that mirror them — has to do the same, which
 * is what this constant is for.
 */
export const FORALLX_THEORY_MM0 = stripSyntaxAnnotations(source);

/** The `:::aufbau-mm0{name="forallx"}` block wrapping the artifact as authored. */
export const FORALLX_THEORY_BLOCK = `:::aufbau-mm0{name="forallx"}\n${FORALLX_THEORY_SOURCE}\n:::`;

/**
 * What one exercise over this theory freezes, and how its lines are read —
 * exactly what the authoring compiler would have produced for that goal.
 *
 * Going through the table and the join rather than assembling the two texts
 * here is the point: the engine text a certificate is verified against is
 * derived, not authored, so a test or a verify script cannot accidentally
 * exercise a path an author cannot reach.
 */
export function forallxExercise(
  goalName: string,
  theoremDecl: string,
): {
  readonly mm0: string;
  readonly readSentence: ProofFormulaReader;
} {
  const frozen = withSystemText(
    { goalDecl: theoremDecl, system: "forallx" },
    { forallx: FORALLX_THEORY_SOURCE },
  );
  const resolved = proofTheoryText(frozen as { readonly source?: string });

  return {
    mm0: resolved.mm0,
    readSentence: proofFormulaReader(resolved.source, "sentence", goalName),
  };
}
