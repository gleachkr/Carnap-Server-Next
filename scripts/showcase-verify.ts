/**
 * End-to-end validation for the showcase lesson's three engine-checked proofs.
 * Compiles the lesson through the authoring pipeline, then for each proof
 * exercise does exactly what the browser does — lower the starter to `.auf`
 * (Fitch translation / tree flattening / already linear), compile it against the
 * exercise's own frozen `publicData.mm0` with the real `@aufbau/compiler`, and
 * verify the resulting MMB with the worker's `verifyMmb`.
 *
 * The closing Fitch exercise (`pf_yours`) is deliberately unfinished, so its
 * starter is *expected* to fail to compile; the script checks the intended
 * solution instead, which is what makes it a fair thing to assign.
 *
 * Not part of `bun run check` / `bun test` because the compiler is untyped and
 * client-only. Run it after touching the lesson, the theory, or the translator:
 *
 *   bun run scripts/showcase-verify.ts
 */
// @ts-expect-error — the compiler package ships no types (client-only; see its d.ts).
import { loadCompiler } from "@aufbau/compiler";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { verifyMmb } from "../src/worker/exercises/aufbau-proof/verifier";
import { fitchToAuf } from "../src/worker/exercises/aufbau-proof-fitch/translate";
import { flattenProofTree } from "../src/worker/exercises/aufbau-proof-tree/flatten";
import { SHOWCASE_DEMO_SOURCE } from "../tests/helpers/showcase-demo";

/** The `pf_yours` exercise as the prompt tells the student to solve it. */
const UNFINISHED_ID = "pf_yours";
const INTENDED_SOLUTION = [
  "¬ ¬ P    :ax",
  "    ¬ P  :ax",
  "    ⊥    :neg_elim 2 1",
  "P        :ip 2-3",
].join("\n");

const compiled = await compileCarnapMarkdown(SHOWCASE_DEMO_SOURCE);

if (!compiled.ok) {
  console.log("✗ the lesson does not compile");
  console.log(JSON.stringify(compiled.diagnostics, null, 2));
  process.exit(1);
}

const wasmBytes = await Bun.file(
  "node_modules/@aufbau/compiler/compiler.wasm",
).arrayBuffer();
const compiler = await loadCompiler({ wasmBytes });

/** Lower a proof exercise's starter to `.auf`, the way its editor would. */
function lower(
  assetId: string,
  publicData: Record<string, string & Record<string, unknown>>,
): string | null {
  if (assetId === "carnap-aufbau-proof-v1") {
    return `${publicData.goalName}\n----\n${publicData.starterBody}`;
  }

  if (assetId === "carnap-aufbau-proof-fitch-v1") {
    const translated = fitchToAuf(
      publicData.starterBody,
      publicData.goalName,
      publicData.assumptionRule,
      publicData.sequentSymbol ?? "⊢",
    );

    if (translated.diagnostics.length > 0) {
      console.log(`    structural: ${JSON.stringify(translated.diagnostics)}`);
      return null;
    }

    return translated.proofText;
  }

  return flattenProofTree(
    publicData.starterTree as never,
    publicData.goalName,
  ).proofText;
}

/**
 * Compile + verify one `.auf` proof against a frozen mm0. `quiet` is for the
 * checks that *expect* a failure, where the engine's diagnostic is not news.
 */
async function verify(
  mm0: string,
  proofText: string,
  quiet = false,
): Promise<boolean> {
  const result = compiler.compile(mm0, proofText);

  if (result.ok !== true || result.mmbBytes === undefined) {
    if (!quiet) {
      console.log(`    compile: ${JSON.stringify(result.diagnostics)}`);
    }

    return false;
  }

  const verdict = await verifyMmb(mm0, result.mmbBytes);

  if (!verdict.ok && !quiet) {
    console.log(`    verify: ${JSON.stringify(verdict)}`);
  }

  return verdict.ok;
}

let failed = 0;

for (const node of compiled.artifact.document.nodes) {
  if (node.kind !== "exercise") {
    continue;
  }

  const publicData = node.publicData as Record<
    string,
    string & Record<string, unknown>
  >;

  if (typeof publicData.mm0 !== "string") {
    continue;
  }

  const label = `${node.exerciseId} (${node.render.assetId})`;

  if (node.exerciseId === UNFINISHED_ID) {
    const starter = lower(node.render.assetId, publicData);
    const starterVerifies =
      starter !== null && (await verify(publicData.mm0, starter, true));

    if (starterVerifies) {
      console.log(
        `✗ ${label} — the exercise left for the student is already solved`,
      );
      failed += 1;
      continue;
    }

    const translated = fitchToAuf(
      INTENDED_SOLUTION,
      publicData.goalName,
      publicData.assumptionRule,
      publicData.sequentSymbol ?? "⊢",
    );

    if (
      translated.diagnostics.length > 0 ||
      !(await verify(publicData.mm0, translated.proofText))
    ) {
      console.log(`✗ ${label} — the intended solution does not verify`);
      failed += 1;
      continue;
    }

    console.log(`✓ ${label} — unfinished as intended, and solvable as prompted`);
    continue;
  }

  const proofText = lower(node.render.assetId, publicData);

  if (proofText === null || !(await verify(publicData.mm0, proofText))) {
    console.log(`✗ ${label}`);
    failed += 1;
    continue;
  }

  console.log(`✓ ${label}`);
}

console.log(
  failed === 0
    ? "\nEvery proof in the showcase behaves as the lesson claims."
    : `\n${failed} proof(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);
