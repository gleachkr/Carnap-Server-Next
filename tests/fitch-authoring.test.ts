import { describe, expect, test } from "bun:test";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { CompiledContentArtifact } from "../src/worker/domain/content";
import {
  type AufbauProofFitchPublicData,
  isAufbauProofFitchPublicData,
} from "../src/worker/exercises/aufbau-proof-fitch/types";
import { FITCH_THEORY_BLOCK } from "./helpers/fitch-theory";

function fitchSource(directive: string): string {
  return `${FITCH_THEORY_BLOCK}\n\n${directive}`;
}

async function diagnosticsFor(source: string): Promise<string[]> {
  const compiled = await compileCarnapMarkdown(source);
  return compiled.ok ? [] : compiled.diagnostics.map((entry) => entry.code);
}

function fitchPublicData(
  artifact: CompiledContentArtifact,
  id: string,
): AufbauProofFitchPublicData {
  const item = artifact.manifest.find((entry) => entry.id === id);
  if (item === undefined || !isAufbauProofFitchPublicData(item.publicData)) {
    throw new Error(`no aufbau-proof-fitch exercise '${id}'`);
  }
  return item.publicData;
}

describe("aufbau-proof-fitch authoring", () => {
  test("a theory + Fitch proof compiles, freezing goal, starter, and assumption", async () => {
    const compiled = await compileCarnapMarkdown(
      fitchSource(`:::aufbau-proof-fitch{theory="prop" id="f1"}
Prove modus ponens.

theorem mp (a b: wff): $ (a → b) , a ⊢ b $
----
a → b   :ax
a       :ax
b       :imp_elim 1 2
:::`),
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    const item = compiled.artifact.manifest.find(
      (entry) => entry.id === "f1",
    );
    expect(item?.kind).toBe("aufbau-proof-fitch@1");
    expect(item?.answerKind).toBe("aufbau-proof-fitch-answer@1");
    expect(item?.capabilities).toEqual({
      supportsAutomaticEvaluation: true,
      supportsManualReview: true,
    });

    const publicData = fitchPublicData(compiled.artifact, "f1");
    expect(publicData.goalName).toBe("mp");
    expect(publicData.assumptionRule).toBe("ax");
    expect(publicData.sequentSymbol).toBe("⊢");
    // The frozen mm0 is the theory plus the appended goal declaration.
    expect(publicData.mm0).toContain("axiom imp_elim");
    expect(
      publicData.mm0.endsWith("theorem mp (a b: wff): $ (a → b) , a ⊢ b $;"),
    ).toBe(true);
    expect(publicData.starterBody).toBe(
      ["a → b   :ax", "a       :ax", "b       :imp_elim 1 2"].join("\n"),
    );
    expect(publicData.promptHtml).toContain("Prove modus ponens.");
    expect(publicData.options).toEqual({
      allowAuto: false,
      allowCompletion: false,
    });
  });

  test("the assumption= attribute overrides the default assumption axiom", async () => {
    const compiled = await compileCarnapMarkdown(
      fitchSource(`:::aufbau-proof-fitch{theory="prop" id="f1" assumption="hyp"}
theorem mp (a b: wff): $ (a → b) , a ⊢ b $
----
:::`),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    expect(fitchPublicData(compiled.artifact, "f1").assumptionRule).toBe(
      "hyp",
    );
  });

  test("the sequent= attribute overrides the default turnstile", async () => {
    const compiled = await compileCarnapMarkdown(
      fitchSource(`:::aufbau-proof-fitch{theory="prop" id="f1" sequent="|-"}
theorem mp (a b: wff): $ (a → b) , a ⊢ b $
----
:::`),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    expect(fitchPublicData(compiled.artifact, "f1").sequentSymbol).toBe("|-");
  });

  test("an empty starter body is allowed", async () => {
    const compiled = await compileCarnapMarkdown(
      fitchSource(`:::aufbau-proof-fitch{theory="prop" id="f1"}
theorem mp (a b: wff): $ (a → b) , a ⊢ b $
----
:::`),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    expect(fitchPublicData(compiled.artifact, "f1").starterBody).toBe("");
  });

  test("options=auto complete toggles editor assistance", async () => {
    const compiled = await compileCarnapMarkdown(
      fitchSource(`:::aufbau-proof-fitch{theory="prop" id="f1" options="auto complete"}
theorem mp (a b: wff): $ (a → b) , a ⊢ b $
----
:::`),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    expect(fitchPublicData(compiled.artifact, "f1").options).toEqual({
      allowAuto: true,
      allowCompletion: true,
    });
  });

  test("a Fitch proof referencing an undeclared theory is rejected", async () => {
    expect(
      await diagnosticsFor(`:::aufbau-proof-fitch{theory="missing" id="f1"}
theorem mp (a b: wff): $ (a → b) , a ⊢ b $
----
:::`),
    ).toContain("unknown_theory");
  });

  test("a missing theorem header is rejected", async () => {
    expect(
      await diagnosticsFor(
        fitchSource(`:::aufbau-proof-fitch{theory="prop" id="f1"}
Just some prose, no goal.
:::`),
      ),
    ).toContain("missing_theorem_header");
  });

  test("a header with no underline is rejected", async () => {
    expect(
      await diagnosticsFor(
        fitchSource(`:::aufbau-proof-fitch{theory="prop" id="f1"}
theorem mp (a b: wff): $ (a → b) , a ⊢ b $
a → b   :ax
:::`),
      ),
    ).toContain("missing_proof_underline");
  });
});
