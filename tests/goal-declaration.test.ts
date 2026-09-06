import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { LoadedCompiler } from "@aufbau/compiler";
import { loadCompiler } from "@aufbau/compiler";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import {
  proofFormulaReader,
  proofTheoryText,
} from "../src/worker/exercises/aufbau-proof/formulas";
import { ruleCitationShapes } from "../src/worker/exercises/aufbau-proof-fitch/citations";
import { fitchToAuf } from "../src/worker/exercises/aufbau-proof-fitch/translate";
import { isAufbauProofFitchPublicData } from "../src/worker/exercises/aufbau-proof-fitch/types";

/**
 * A goal declaration read through the system's language, checked against the
 * real engine — the check that matters, since the reason the goal is read at
 * all is that the engine's own math parser refused what an author writes.
 * The lesson here is the one that was reported: over the shipped Calgary
 * system with no block, a goal spelled the way its lines are, which the
 * engine used to answer with "extra proof block with no matching theorem".
 */

let compiler: LoadedCompiler;

beforeAll(async () => {
  compiler = await loadCompiler({
    wasmBytes: readFileSync(
      new URL(
        "../node_modules/@aufbau/compiler/compiler.wasm",
        import.meta.url,
      ),
    ),
  });
});

async function frozen(directive: string) {
  const compiled = await compileCarnapMarkdown(directive);

  if (!compiled.ok) {
    throw new Error(JSON.stringify(compiled.diagnostics));
  }

  const [item] = compiled.artifact.manifest;

  if (item === undefined || !isAufbauProofFitchPublicData(item.publicData)) {
    throw new Error("no Fitch exercise compiled");
  }

  return item.publicData;
}

describe("a goal read into engine text", () => {
  test("declares, and its starter verifies, against the real engine", async () => {
    const data =
      await frozen(`:::aufbau-proof-fitch{system="forallx-calgary-2019" id="cd" points="3"}
Constructive dilemma

theorem cd : $ P \\/ Q ; P -> S ; Q -> S ⊢ S $
----
P \\/ Q :ax
P -> S :ax
Q -> S :ax
 P    :ax
 S    :imp_elim 2 4
 Q    :ax
 S    :imp_elim 3 6
S     :or_elim 1 4-5 6-7
:::
`);
    const theory = proofTheoryText(data);
    const translated = fitchToAuf(
      data.starterBody,
      data.goalName,
      data.assumptionRule,
      data.sequentSymbol ?? "⊢",
      data.contextSymbol ?? ";",
      proofFormulaReader(theory.source, "sentence", data.goalName),
      ruleCitationShapes(theory.source),
    );

    expect(translated.formulaProblems).toEqual([]);
    expect(translated.diagnostics).toEqual([]);

    const result = compiler.compile(theory.mm0, translated.proofText);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("a quantifier touching its variable declares cleanly", async () => {
    const data =
      await frozen(`:::aufbau-proof-fitch{system="forallx-calgary-2019" id="ex" points="3"}
Prove it.

theorem exelim {x y: var} : $ ∃x F(x) ; ∀x (F(x) → G(x)) ⊢ ∃x G(x) $
----
:::
`);
    const result = compiler.compile(
      proofTheoryText(data).mm0,
      `${data.goalName}\n----\n`,
    );

    // The one complaint left is the one an empty proof earns.
    const diagnostics = result.diagnostics as readonly {
      readonly message?: unknown;
    }[];

    expect(
      diagnostics.map((one) => String(one.message).split("\n")[0]),
    ).toEqual(["proof block is empty"]);
  });
});
