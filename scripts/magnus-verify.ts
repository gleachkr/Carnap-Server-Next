/**
 * End-to-end validation for the forallx (P.D. Magnus) theory — system SL's
 * connective rules plus system QL's identity and quantifier rules. Mirrors the
 * client: translate each worked Fitch proof to `.auf`, compile it against the
 * frozen `theory + goal` mm0 with the real `@aufbau/compiler`, then verify the
 * resulting MMB with the worker's `verifyMmb`. Prints a pass/fail line per case
 * and exits non-zero if any fails.
 *
 * The sibling of `scripts/forallx-verify.ts`, and the same authoritative check:
 * it compiles + verifies from source every run and stores no MMB fixture. Not
 * part of `bun run check`/`bun test` because the compiler is untyped and
 * client-only; run it deliberately after touching the theory, the cases, or
 * the translator:
 *
 *   bun run scripts/magnus-verify.ts
 */
// @ts-expect-error — the compiler package ships no types (client-only; see its d.ts).
import { loadCompiler } from "@aufbau/compiler";

import {
  proofFormulaReader,
  proofRuleReader,
  proofTheoryText,
} from "../src/worker/exercises/aufbau-proof/formulas";
import {
  PLAYGROUND_GOAL_NAME,
  playgroundGoal,
  playgroundGoalText,
  playgroundTheoryText,
} from "../src/worker/exercises/aufbau-proof/playground";
import { verifyMmb } from "../src/worker/exercises/aufbau-proof/verifier";
import { ruleCitationShapes } from "../src/worker/exercises/aufbau-proof-fitch/citations";
import { fitchToAuf } from "../src/worker/exercises/aufbau-proof-fitch/translate";
import { MAGNUS_CASES } from "../tests/helpers/magnus-cases";
import {
  MAGNUS_THEORY_SOURCE,
  magnusExercise,
} from "../tests/helpers/magnus-theory";

const wasmBytes = await Bun.file(
  "node_modules/@aufbau/compiler/compiler.wasm",
).arrayBuffer();
const compiler = await loadCompiler({ wasmBytes });

let passed = 0;
for (const testCase of MAGNUS_CASES) {
  const { citationShapes, mm0, readRule, readSentence } = magnusExercise(
    testCase.goalName,
    testCase.theoremDecl,
    testCase.system,
  );
  const translation = fitchToAuf(
    testCase.fitch,
    testCase.goalName,
    "AS",
    "⊢",
    ";",
    readSentence,
    citationShapes,
    readRule,
  );

  if (translation.formulaProblems.length > 0 && testCase.shouldFail !== true) {
    console.log(`✗ ${testCase.goalName}`);
    console.log(
      `    unreadable: ${translation.formulaProblems
        .map((one) => `${one.error.message}@${one.sourceLine}`)
        .join(", ")}`,
    );
    continue;
  }

  if (translation.diagnostics.length > 0 && testCase.shouldFail !== true) {
    console.log(`✗ ${testCase.goalName}`);
    console.log(
      `    structural: ${translation.diagnostics
        .map((d) => `${d.code}@${d.sourceLine}`)
        .join(", ")}`,
    );
    continue;
  }

  const result = compiler.compile(mm0, translation.proofText);
  const verdict =
    result.ok === true && result.mmbBytes !== undefined
      ? await verifyMmb(mm0, result.mmbBytes)
      : { errored: false, ok: false };

  // A `shouldFail` case is a proviso violation: passing means being *refused*,
  // at either the compiler or the verifier.
  if (testCase.shouldFail === true) {
    if (verdict.ok) {
      console.log(`✗ ${testCase.goalName}  accepted an invalid proof`);
      continue;
    }
    console.log(`✓ ${testCase.goalName}  (refused, as it should be)`);
    passed += 1;
    continue;
  }

  if (result.ok !== true || result.mmbBytes === undefined) {
    console.log(`✗ ${testCase.goalName}`);
    console.log(`    compile: ${JSON.stringify(result.diagnostics)}`);
    continue;
  }

  if (!verdict.ok) {
    console.log(`✗ ${testCase.goalName}  verify: ${JSON.stringify(verdict)}`);
    continue;
  }

  console.log(`✓ ${testCase.goalName}`);
  passed += 1;
}

// Playground cases (#305): no goal is set, so the statement is derived from
// the proof's last line, bound over the `@vars` tokens it holds, appended to
// the theory as `theorem playground …`, and compiled and verified against
// *that* — the same declaration the worker rebuilds from the answer.
const PLAYGROUND_CASES: readonly (readonly [string, string])[] = [
  [
    "quantifiers and names",
    "∀x(Fx → Gx)  :AS\nFa           :AS\nFa → Ga      :∀E 1\nGa           :→E 3 2",
  ],
  ["sentence letters", "P → Q  :AS\nP      :AS\nQ      :→E 1 2"],
  [
    "discharge, empty context",
    "  P        :AS\n  P ∨ Q    :∨I 1\nP → (P ∨ Q)  :→I 1-2",
  ],
];

let playgroundPassed = 0;
for (const [name, fitch] of PLAYGROUND_CASES) {
  const translation = fitchToAuf(
    fitch,
    PLAYGROUND_GOAL_NAME,
    "AS",
    "⊢",
    ";",
    proofFormulaReader(MAGNUS_THEORY_SOURCE, "sentence", PLAYGROUND_GOAL_NAME),
    ruleCitationShapes(MAGNUS_THEORY_SOURCE),
    proofRuleReader(MAGNUS_THEORY_SOURCE),
  );
  const goal =
    translation.statement === null
      ? null
      : playgroundGoal(MAGNUS_THEORY_SOURCE, translation.statement);

  if (
    goal === null ||
    translation.diagnostics.length > 0 ||
    translation.formulaProblems.length > 0
  ) {
    console.log(`✗ playground: ${name}  no goal derived`);
    continue;
  }

  const theory = playgroundTheoryText(
    proofTheoryText({ source: MAGNUS_THEORY_SOURCE }),
    goal,
  );
  const result = compiler.compile(theory.mm0, translation.proofText);
  const verdict =
    result.ok === true && result.mmbBytes !== undefined
      ? await verifyMmb(theory.mm0, result.mmbBytes)
      : { errored: false, ok: false };

  if (!verdict.ok) {
    console.log(`✗ playground: ${name}  ${JSON.stringify(result.diagnostics)}`);
    continue;
  }

  console.log(
    `✓ playground: ${name}  proves ${playgroundGoalText(MAGNUS_THEORY_SOURCE, goal)}`,
  );
  playgroundPassed += 1;
}

console.log(
  `\n${passed}/${MAGNUS_CASES.length} cases verified, ${playgroundPassed}/${PLAYGROUND_CASES.length} playground cases.`,
);
if (
  passed !== MAGNUS_CASES.length ||
  playgroundPassed !== PLAYGROUND_CASES.length
) {
  process.exit(1);
}
