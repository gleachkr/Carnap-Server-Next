/**
 * End-to-end validation for the forallx: Calgary theory (TFL + the first-order
 * fragment). Mirrors the client: translate each worked Fitch proof to `.auf`,
 * compile it against the frozen `theory + goal` mm0 with the real
 * `@aufbau/compiler`, then verify the resulting MMB with the worker's `verifyMmb`.
 * Prints a pass/fail line per rule and exits non-zero if any case fails.
 *
 * This is the authoritative "does the translation actually verify against the
 * engine" check. It compiles + verifies from source every run and stores no MMB
 * fixture — keeping a compiler-specific byte blob stable is the engine's job, not
 * this repo's. It is not part of `bun run check`/`bun test` because the compiler
 * is untyped and client-only; run it deliberately after touching the theory,
 * the cases, or the translator:
 *
 *   bun run scripts/forallx-verify.ts
 */
// @ts-expect-error — the compiler package ships no types (client-only; see its d.ts).
import { loadCompiler } from "@aufbau/compiler";

import { verifyMmb } from "../src/worker/exercises/aufbau-proof/verifier";
import { fitchToAuf } from "../src/worker/exercises/aufbau-proof-fitch/translate";
import { FORALLX_CASES } from "../tests/helpers/forallx-cases";
import { FORALLX_THEORY_MM0 } from "../tests/helpers/forallx-theory";

const wasmBytes = await Bun.file(
  "node_modules/@aufbau/compiler/compiler.wasm",
).arrayBuffer();
const compiler = await loadCompiler({ wasmBytes });

let passed = 0;
for (const testCase of FORALLX_CASES) {
  const mm0 = `${FORALLX_THEORY_MM0}\n${testCase.theoremDecl}`;
  const translation = fitchToAuf(testCase.fitch, testCase.goalName, "ax", "⊢");

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

console.log(`\n${passed}/${FORALLX_CASES.length} cases verified.`);
if (passed !== FORALLX_CASES.length) {
  process.exit(1);
}
