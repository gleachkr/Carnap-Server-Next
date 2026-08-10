/**
 * End-to-end validation for the Gentzen (classical LK) tree-proof suite. Mirrors
 * the client: flatten each worked proof *tree* to `.auf`, compile it against the
 * frozen `theory + goal` mm0 with the real `@aufbau/compiler`, then verify the
 * resulting MMB with the worker's `verifyMmb`. Prints a pass/fail line per case
 * and exits non-zero if any case fails.
 *
 * This is the authoritative "does the tree actually verify against the engine"
 * check for the sequent-calculus cases. It compiles + verifies from source every
 * run and stores no MMB fixture — keeping a compiler-specific byte blob stable is
 * the engine's job, not this repo's. It is not part of `bun run check`/`bun test`
 * because the compiler is untyped and client-only; run it deliberately after
 * touching the theory or the cases:
 *
 *   bun run scripts/gentzen-verify.ts
 */
// @ts-expect-error — the compiler package ships no types (client-only; see its d.ts).
import { loadCompiler } from "@aufbau/compiler";

import { flattenProofTree } from "../src/worker/exercises/aufbau-proof-tree/flatten";
import { verifyMmb } from "../src/worker/exercises/aufbau-proof/verifier";
import { GENTZEN_CASES } from "../tests/helpers/gentzen-cases";
import { GENTZEN_THEORY_MM0 } from "../tests/helpers/gentzen-theory";

const wasmBytes = await Bun.file(
  "node_modules/@aufbau/compiler/compiler.wasm",
).arrayBuffer();
const compiler = await loadCompiler({ wasmBytes });

let passed = 0;
for (const testCase of GENTZEN_CASES) {
  const mm0 = `${GENTZEN_THEORY_MM0}\n${testCase.theoremDecl}`;
  const { proofText } = flattenProofTree(testCase.tree, testCase.goalName);

  const result = compiler.compile(mm0, proofText);
  if (result.ok !== true || result.mmbBytes === undefined) {
    console.log(`✗ ${testCase.goalName}`);
    console.log(`    compile: ${JSON.stringify(result.diagnostics)}`);
    continue;
  }

  const verdict = await verifyMmb(mm0, result.mmbBytes);
  if (!verdict.ok) {
    console.log(`✗ ${testCase.goalName}  verify: ${JSON.stringify(verdict)}`);
    continue;
  }

  console.log(`✓ ${testCase.goalName}`);
  passed += 1;
}

console.log(`\n${passed}/${GENTZEN_CASES.length} cases verified.`);
if (passed !== GENTZEN_CASES.length) {
  process.exit(1);
}
