/**
 * End-to-end validation for the showcase lesson's engine-checked proofs.
 * Compiles the lesson through the authoring pipeline, then for each proof
 * exercise does exactly what the browser does — lower the starter to `.auf`
 * (Fitch translation / tree flattening / Prawitz translation / already linear),
 * compile it against the exercise's own frozen `publicData.mm0` with the real
 * `@aufbau/compiler`, and verify the resulting MMB with the worker's
 * `verifyMmb`.
 *
 * The closing Fitch exercise (`pf_yours`) is deliberately unfinished, so its
 * starter is *expected* to fail to compile; the script checks the intended
 * solution instead, which is what makes it a fair thing to assign.
 *
 * The two playgrounds have no goal of their own: their starters are lowered
 * the same way, then the goal is read off the lowered proof and appended to
 * the theory before compiling, which is what the widget and the worker both
 * do (`exercise-kit/proof/playground`).
 *
 * Not part of `bun test`: it loads the compiler's wasm and runs every proof
 * through it, which is slow, and the lesson's *compiling* is already
 * `tests/showcase-demo.test.ts`'s. Run it after touching the lesson, the
 * theory, or the translator:
 *
 *   bun run scripts/showcase-verify.ts
 */
import { loadCompiler } from "@aufbau/compiler";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import {
  proofFormulaReader,
  proofRuleReader,
  proofTheoryText,
} from "../src/worker/exercise-kit/proof/formulas";
import {
  isPlaygroundExercise,
  lastProofStatement,
  type ProofStatement,
  playgroundGoal,
  playgroundTheoryText,
} from "../src/worker/exercise-kit/proof/playground";
import { verifyMmb } from "../src/worker/exercise-kit/proof/verifier";
import {
  AUFBAU_PROOF_COMPONENT_METADATA,
  type AufbauProofPublicData,
} from "../src/worker/exercises/aufbau-proof/types";
import { ruleCitationShapes } from "../src/worker/exercises/aufbau-proof-fitch/citations";
import { fitchToAuf } from "../src/worker/exercises/aufbau-proof-fitch/translate";
import {
  AUFBAU_PROOF_FITCH_COMPONENT_METADATA,
  type AufbauProofFitchPublicData,
} from "../src/worker/exercises/aufbau-proof-fitch/types";
import { prawitzToAuf } from "../src/worker/exercises/aufbau-proof-prawitz/translate";
import {
  AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA,
  type AufbauProofPrawitzPublicData,
} from "../src/worker/exercises/aufbau-proof-prawitz/types";
import { flattenProofTree } from "../src/worker/exercises/aufbau-proof-tree/flatten";
import {
  AUFBAU_PROOF_TREE_COMPONENT_METADATA,
  type AufbauProofTreePublicData,
} from "../src/worker/exercises/aufbau-proof-tree/types";
import { SHOWCASE_DEMO_SOURCE } from "../tests/helpers/showcase-demo";

/**
 * Which exercises this script is about, named by the element that renders them.
 *
 * It used to ask instead whether `publicData` carried theory text, which was
 * the same question until #257: the systems join now fills `mm0` and `source`
 * on *every* exercise set in a system, truth tables and models included, so the
 * lesson's opening truth table walked into the tree branch below and read a
 * `starterTree` that was not there.
 */
const PROOF_ASSET_IDS: ReadonlySet<string> = new Set([
  AUFBAU_PROOF_COMPONENT_METADATA.assetId,
  AUFBAU_PROOF_FITCH_COMPONENT_METADATA.assetId,
  AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA.assetId,
  AUFBAU_PROOF_TREE_COMPONENT_METADATA.assetId,
]);

/** The public data of any of the four; which one, the asset id says. */
type ProofPublicData =
  | AufbauProofPublicData
  | AufbauProofFitchPublicData
  | AufbauProofPrawitzPublicData
  | AufbauProofTreePublicData;

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
  "¬ ¬ P    :AS",
  "    ¬ P  :AS",
  "    ⊥    :¬E 2 1",
  "P        :IP 2-3",
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

/** What the three structural lowerings have in common, for the report below. */
interface Lowering {
  readonly diagnostics?: readonly unknown[];
  readonly formulaProblems: readonly {
    readonly error: { readonly message: string };
    readonly formula: string;
  }[];
  readonly proofText: string;
  readonly statement: ProofStatement | null;
}

/** A starter lowered to `.auf`, with the last line's statement for a playground. */
interface Lowered {
  readonly proofText: string;
  readonly statement: ProofStatement | null;
}

/** The lowered `.auf`, or `null` and the reason it could not be produced. */
function lowered(translation: Lowering): Lowered | null {
  if ((translation.diagnostics ?? []).length > 0) {
    console.log(`    structural: ${JSON.stringify(translation.diagnostics)}`);
    return null;
  }

  if (translation.formulaProblems.length > 0) {
    console.log(
      `    unreadable: ${translation.formulaProblems
        .map((one) => `${one.formula} — ${one.error.message}`)
        .join(", ")}`,
    );
    return null;
  }

  return {
    proofText: translation.proofText,
    statement: translation.statement,
  };
}

/**
 * Lower a proof exercise's starter to `.auf`, the way its editor would —
 * including reading each formula in the theory's language where the exercise
 * was frozen with one, which is the whole of what the editor does before it
 * compiles. Reading it any other way would verify a proof no student can type.
 *
 * Every id in `PROOF_ASSET_IDS` has its own branch, and the fall-through says
 * so rather than assuming a tree: the branches used to end in an `else`, which
 * is how a truth table came to be read as one.
 */
function lower(
  assetId: string,
  publicData: ProofPublicData,
  source: string | null,
): Lowered | null {
  if (assetId === AUFBAU_PROOF_COMPONENT_METADATA.assetId) {
    const data = publicData as AufbauProofPublicData;
    // Linear lines are engine text already; nothing has read them, so the
    // statement's variables are left for `playgroundGoal` to find.
    const text = lastProofStatement(data.starterBody);

    return {
      proofText: `${data.goalName}\n----\n${data.starterBody}`,
      statement: text === null ? null : { text, variables: null },
    };
  }

  if (assetId === AUFBAU_PROOF_FITCH_COMPONENT_METADATA.assetId) {
    const data = publicData as AufbauProofFitchPublicData;
    return lowered(
      fitchToAuf(
        data.starterBody,
        data.goalName,
        data.assumptionRule,
        data.sequentSymbol ?? "⊢",
        data.contextSymbol ?? ",",
        proofFormulaReader(source, "sentence", data.goalName),
        ruleCitationShapes(source),
        proofRuleReader(source),
      ),
    );
  }

  if (assetId === AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA.assetId) {
    const data = publicData as AufbauProofPrawitzPublicData;
    if (data.starterTree === undefined) {
      console.log("    no starter to lower");
      return null;
    }
    return lowered(
      prawitzToAuf(
        data.starterTree,
        data.goalName,
        data.assumptionRule,
        data.sequentSymbol ?? "⊢",
        data.contextSymbol ?? ",",
        // A Prawitz node carries a bare formula; the translator builds the
        // sequent around it, as in Fitch.
        proofFormulaReader(source, "sentence", data.goalName),
        proofRuleReader(source),
      ),
    );
  }

  if (assetId === AUFBAU_PROOF_TREE_COMPONENT_METADATA.assetId) {
    const data = publicData as AufbauProofTreePublicData;
    if (data.starterTree === undefined) {
      console.log("    no starter to lower");
      return null;
    }
    return lowered(
      flattenProofTree(
        data.starterTree,
        data.goalName,
        proofFormulaReader(source, "sequent", data.goalName),
        proofRuleReader(source),
      ),
    );
  }

  console.log(`    no lowering for ${assetId}`);
  return null;
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

  if (!PROOF_ASSET_IDS.has(node.render.assetId)) {
    continue;
  }

  const publicData = node.publicData as unknown as ProofPublicData;

  // The engine input, and the text the starter is read as surface formulas in.
  // Since #257 both are filled by the systems join, and the stripped `mm0` is
  // derived from `source`; only an artifact compiled before `source` existed
  // has the one without the other. See `exercise-kit/proof/formulas`.
  const theory = proofTheoryText(publicData);
  const { mm0, source } = theory;
  const label = `${node.exerciseId} (${node.render.assetId})`;

  if (UNFINISHED_IDS.has(node.exerciseId)) {
    const starter = lower(node.render.assetId, publicData, source);
    const starterVerifies =
      starter !== null && (await verify(mm0, starter.proofText, true));

    if (starterVerifies) {
      console.log(
        `✗ ${label} — the exercise left for the student is already solved`,
      );
      failed += 1;
      continue;
    }

    // Both unfinished exercises are Fitch, as their intended solution is.
    const fitch = publicData as AufbauProofFitchPublicData;
    const translated = fitchToAuf(
      INTENDED_SOLUTION,
      fitch.goalName,
      fitch.assumptionRule,
      fitch.sequentSymbol ?? "⊢",
      fitch.contextSymbol ?? ",",
      proofFormulaReader(source, "sentence", fitch.goalName),
      ruleCitationShapes(source),
      proofRuleReader(source),
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

    console.log(
      `✓ ${label} — unfinished as intended, and solvable as prompted`,
    );
    continue;
  }

  const starter = lower(node.render.assetId, publicData, source);

  if (starter === null) {
    console.log(`✗ ${label}`);
    failed += 1;
    continue;
  }

  if (isPlaygroundExercise(publicData)) {
    const goal =
      starter.statement === null
        ? null
        : playgroundGoal(source, starter.statement);

    if (goal === null) {
      console.log(`✗ ${label} — could not work out what the starter states`);
      failed += 1;
      continue;
    }

    if (
      !(await verify(
        playgroundTheoryText(theory, goal).mm0,
        starter.proofText,
      ))
    ) {
      console.log(`✗ ${label}`);
      failed += 1;
      continue;
    }

    console.log(`✓ ${label} — proves ${goal.statement}`);
    continue;
  }

  if (!(await verify(mm0, starter.proofText))) {
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
