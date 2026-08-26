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
import {
  proofFormulaReader,
  proofTheoryText,
} from "../src/worker/exercises/aufbau-proof/formulas";
import { verifyMmb } from "../src/worker/exercises/aufbau-proof/verifier";
import { fitchToAuf } from "../src/worker/exercises/aufbau-proof-fitch/translate";
import { flattenProofTree } from "../src/worker/exercises/aufbau-proof-tree/flatten";
import { SHOWCASE_DEMO_SOURCE } from "../tests/helpers/showcase-demo";

/**
 * The exercises the showcase deliberately leaves *unfinished*, and the proof
 * their prompt tells the student to write. Both state the same task — `pf_yours`
 * introduces the widget, `pf_sealed` demonstrates `feedback="none"` — so both
 * open on the premise line alone and neither starter is meant to verify.
 *
 * This is a set rather than one id because it was one id: `pf_sealed` arrived
 * with the feedback section and fell through to the "must verify" path, where
 * the honest report that its starter does not prove its goal looked like a
 * broken lesson.
 */
const UNFINISHED_IDS = new Set(["pf_yours", "pf_sealed"]);
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

/**
 * Lower a proof exercise's starter to `.auf`, the way its editor would —
 * including reading each formula in the theory's language where the exercise
 * was frozen with one, which is the whole of what the editor does before it
 * compiles. Reading it any other way would verify a proof no student can type.
 */
function lower(
  assetId: string,
  publicData: Record<string, string & Record<string, unknown>>,
  source: string | null,
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
      publicData.contextSymbol ?? ",",
      proofFormulaReader(source, "sentence", publicData.goalName),
    );

    if (translated.diagnostics.length > 0) {
      console.log(`    structural: ${JSON.stringify(translated.diagnostics)}`);
      return null;
    }

    if (translated.formulaProblems.length > 0) {
      console.log(
        `    unreadable: ${translated.formulaProblems
          .map((one) => `${one.formula} — ${one.error.message}`)
          .join(", ")}`,
      );
      return null;
    }

    return translated.proofText;
  }

  const flattened = flattenProofTree(
    publicData.starterTree as never,
    publicData.goalName,
    proofFormulaReader(source, "sequent", publicData.goalName),
  );

  if (flattened.formulaProblems.length > 0) {
    console.log(
      `    unreadable: ${flattened.formulaProblems
        .map((one) => `${one.formula} — ${one.error.message}`)
        .join(", ")}`,
    );
    return null;
  }

  return flattened.proofText;
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

  if (
    typeof publicData.mm0 !== "string" &&
    typeof publicData.source !== "string"
  ) {
    continue;
  }

  // One of the two theory texts is frozen, never both; which one decides
  // whether the starter is read as surface text. See `aufbau-proof/formulas`.
  const { mm0, source } = proofTheoryText(publicData);
  const label = `${node.exerciseId} (${node.render.assetId})`;

  if (UNFINISHED_IDS.has(node.exerciseId)) {
    const starter = lower(node.render.assetId, publicData, source);
    const starterVerifies =
      starter !== null && (await verify(mm0, starter, true));

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
      publicData.contextSymbol ?? ",",
      proofFormulaReader(source, "sentence", publicData.goalName),
    );

    if (
      translated.diagnostics.length > 0 ||
      translated.formulaProblems.length > 0 ||
      !(await verify(mm0, translated.proofText))
    ) {
      console.log(`✗ ${label} — the intended solution does not verify`);
      failed += 1;
      continue;
    }

    console.log(`✓ ${label} — unfinished as intended, and solvable as prompted`);
    continue;
  }

  const proofText = lower(node.render.assetId, publicData, source);

  if (proofText === null || !(await verify(mm0, proofText))) {
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
