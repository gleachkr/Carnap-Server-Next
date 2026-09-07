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

import { verifyMmb } from "../src/worker/exercises/aufbau-proof/verifier";
import { fitchToAuf } from "../src/worker/exercises/aufbau-proof-fitch/translate";
import { MAGNUS_CASES } from "../tests/helpers/magnus-cases";
import { magnusExercise } from "../tests/helpers/magnus-theory";

const wasmBytes = await Bun.file(
  "node_modules/@aufbau/compiler/compiler.wasm",
).arrayBuffer();
const compiler = await loadCompiler({ wasmBytes });

let passed = 0;
for (const testCase of MAGNUS_CASES) {
  const { citationShapes, mm0, readRule, readSentence } = magnusExercise(
    testCase.goalName,
    testCase.theoremDecl,
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

console.log(`\n${passed}/${MAGNUS_CASES.length} cases verified.`);
if (passed !== MAGNUS_CASES.length) {
  process.exit(1);
}
