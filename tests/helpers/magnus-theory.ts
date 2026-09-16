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
import type {
  ProofFormulaReader,
  ProofRuleReader,
} from "../../src/worker/exercise-kit/proof/formulas";
import {
  goalEngineDeclaration,
  proofFormulaReader,
  proofRuleReader,
  proofTheoryText,
} from "../../src/worker/exercise-kit/proof/formulas";
import { withSystemText } from "../../src/worker/exercise-kit/systems/join";
import { ruleCitationShapes } from "../../src/worker/exercises/aufbau-proof-fitch/citations";
import type { RuleCitationShape } from "../../src/worker/exercises/aufbau-proof-fitch/translate";
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
 *
 * `system` is the built-in the exercise names; the default is the basic
 * system, and a case over the book's derived rules names `forallx-magnus-plus`.
 */
export function magnusExercise(
  goalName: string,
  theoremDecl: string,
  system: string = "forallx-magnus",
): {
  readonly citationShapes: ReadonlyMap<string, RuleCitationShape>;
  readonly mm0: string;
  readonly readRule: ProofRuleReader;
  readonly readSentence: ProofFormulaReader;
} {
  // The goal is frozen twice over, as the compiler freezes it: as written,
  // for the readers and the student, and in engine text for the engine. A
  // goal the language refuses is thrown here, since the compiler would have
  // refused the exercise.
  const source = THEORY_SOURCES[`${system}.mm0`];

  if (source === undefined) {
    throw new Error(`no ${system} theory is registered`);
  }

  const goal = goalEngineDeclaration(`${source}\n${theoremDecl}`, goalName);

  if (goal !== null && !goal.ok) {
    throw new Error(
      `the goal of ${goalName} does not read: ${goal.problems
        .map((problem) => problem.error.message)
        .join("; ")}`,
    );
  }

  const frozen = withSystemText(
    {
      goalDecl: theoremDecl,
      ...(goal === null ? {} : { goalEngineDecl: goal.declaration }),
      system,
    },
    { [system]: source },
  );
  const resolved = proofTheoryText(frozen as { readonly source?: string });

  return {
    citationShapes: ruleCitationShapes(resolved.source),
    mm0: resolved.mm0,
    readRule: proofRuleReader(resolved.source),
    readSentence: proofFormulaReader(resolved.source, "sentence", goalName),
  };
}
