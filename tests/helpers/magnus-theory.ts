/**
 * The forallx (P.D. Magnus) natural-deduction theory, as the tests see it.
 *
 * The theory itself ships at `src/worker/logic/theories/forallx-magnus.mm0` and
 * is served at `/theories/forallx-magnus.mm0`; its header is where the
 * rule→axiom table and the list of what Magnus's system does *not* share with
 * its Calgary descendant live. This module is a re-export, so the verify script
 * and the tests exercise the text an author actually gets and cannot drift from
 * it. It is `forallx-theory.ts` with one constant changed; the two are kept
 * apart rather than parameterised because each is read alongside its own cases.
 */

import { stripSyntaxAnnotations } from "@aufbau/syntax";
import type { ProofFormulaReader } from "../../src/worker/exercises/aufbau-proof/formulas";
import {
  proofFormulaReader,
  proofTheoryText,
} from "../../src/worker/exercises/aufbau-proof/formulas";
import { withSystemText } from "../../src/worker/exercises/systems";
import { THEORY_SOURCES } from "../../src/worker/logic/theories";

const source = THEORY_SOURCES["forallx-magnus.mm0"];

if (source === undefined) {
  throw new Error("the forallx-magnus theory is no longer registered");
}

/** The artifact as it is served and as an author reads it, `@syntax` and all. */
export const MAGNUS_THEORY_SOURCE = source;

/**
 * The same theory as the *engine* sees it: this file is also Magnus's language,
 * so it carries `@syntax` annotations, and the engine rejects an annotation
 * that is not its own. See the note in `forallx-theory.ts`.
 */
export const MAGNUS_THEORY_MM0 = stripSyntaxAnnotations(source);

/** The `:::aufbau-mm0{name="magnus"}` block wrapping the artifact as authored. */
export const MAGNUS_THEORY_BLOCK = `:::aufbau-mm0{name="magnus"}\n${MAGNUS_THEORY_SOURCE}\n:::`;

/**
 * What one exercise over this theory freezes, and how its lines are read —
 * exactly what the authoring compiler would have produced for that goal.
 */
export function magnusExercise(
  goalName: string,
  theoremDecl: string,
): {
  readonly mm0: string;
  readonly readSentence: ProofFormulaReader;
} {
  const frozen = withSystemText(
    { goalDecl: theoremDecl, system: "magnus" },
    { magnus: MAGNUS_THEORY_SOURCE },
  );
  const resolved = proofTheoryText(frozen as { readonly source?: string });

  return {
    mm0: resolved.mm0,
    readSentence: proofFormulaReader(resolved.source, "sentence", goalName),
  };
}
