/**
 * End-to-end validation for the Prawitz proof type over the forallx: Calgary
 * theory. Mirrors the client: translate each worked Prawitz tree to `.auf`
 * with `prawitzToAuf`, compile it against the frozen `theory + goal` mm0 with
 * the real `@aufbau/compiler`, then verify the resulting MMB with the worker's
 * `verifyMmb`. Prints a pass/fail line per case and exits non-zero if any
 * fails.
 *
 * This is the authoritative "does the translation actually verify against the
 * engine" check. It compiles + verifies from source every run and stores no
 * MMB fixture — keeping a compiler-specific byte blob stable is the engine's
 * job, not this repo's. It is not part of `bun run check`/`bun test` because
 * the compiler is untyped and client-only; run it deliberately after touching
 * the theory, the cases, or the translator:
 *
 *   bun run scripts/prawitz-verify.ts
 */
// @ts-expect-error — the compiler package ships no types (client-only; see its d.ts).
import { loadCompiler } from "@aufbau/compiler";

import { verifyMmb } from "../src/worker/exercises/aufbau-proof/verifier";
import { prawitzToAuf } from "../src/worker/exercises/aufbau-proof-prawitz/translate";
import { PRAWITZ_CASES } from "../tests/helpers/prawitz-cases";
import { FORALLX_THEORY_MM0 } from "../tests/helpers/forallx-theory";

const wasmBytes = await Bun.file(
  "node_modules/@aufbau/compiler/compiler.wasm",
).arrayBuffer();
const compiler = await loadCompiler({ wasmBytes });

let passed = 0;
for (const testCase of PRAWITZ_CASES) {
  const mm0 = `${FORALLX_THEORY_MM0}\n${testCase.theoremDecl}`;
  const translation = prawitzToAuf(testCase.root, testCase.goalName, "ax", "⊢");

  if (translation.diagnostics.length > 0) {
    console.log(`✗ ${testCase.name}`);
    console.log(
      `    structural: ${translation.diagnostics
        .map((d) => `${d.code}@${d.nodeId}`)
        .join(", ")}`,
    );
    continue;
  }

  const result = compiler.compile(mm0, translation.proofText);
  if (result.ok !== true || result.mmbBytes === undefined) {
    console.log(`✗ ${testCase.name}`);
    console.log(`    compile: ${JSON.stringify(result.diagnostics)}`);
    continue;
  }

  const verdict = await verifyMmb(mm0, result.mmbBytes);
  if (!verdict.ok) {
    console.log(`✗ ${testCase.name}  verify: ${JSON.stringify(verdict)}`);
    continue;
  }

  console.log(`✓ ${testCase.name}`);
  passed += 1;
}

console.log(`\n${passed}/${PRAWITZ_CASES.length} cases verified.`);
if (passed !== PRAWITZ_CASES.length) {
  process.exit(1);
}
