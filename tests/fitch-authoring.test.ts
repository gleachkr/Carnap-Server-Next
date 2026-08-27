import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { CompiledContentArtifact } from "../src/worker/domain/content";
import { proofTheoryText } from "../src/worker/exercises/aufbau-proof/formulas";
import {
  type AufbauProofFitchPublicData,
  isAufbauProofFitchPublicData,
} from "../src/worker/exercises/aufbau-proof-fitch/types";
import { FITCH_THEORY_BLOCK } from "./helpers/fitch-theory";
import { FORALLX_THEORY_BLOCK } from "./helpers/forallx-theory";

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

describe("a goal binder that shadows the theory's language", () => {
  /** One forallx exercise with the given goal, and the source it compiled. */
  function goalSource(decl: string, body: string): string {
    return `${FORALLX_THEORY_BLOCK}\n\n:::aufbau-proof-fitch{system="forallx" id="g1" points="1"}\nProve it.\n\n${decl}\n----\n${body}\n:::\n`;
  }

  async function compileGoal(decl: string, body: string) {
    return await compileCarnapMarkdown(goalSource(decl, body));
  }

  test("warns, and lets the save through", async () => {
    // The whole point of the severity: shadowing is how a rule schema is
    // written, so the author is told and not stopped.
    const compiled = await compileGoal(
      "theorem mp (a b: wff): $ a ⊢ a $;",
      "a → a    :ax",
    );

    expect(compiled.ok).toBe(true);
    expect(
      compiled.diagnostics.map((entry) => [entry.code, entry.severity]),
    ).toEqual([
      ["goal_binder_shadows_variable", "warning"],
      ["goal_binder_shadows_variable", "warning"],
    ]);
  });

  test("the warning sits on the goal declaration's own line", async () => {
    // Not the directive's line and not the starter's: the binder the author
    // would have to rename is on the `theorem` line.
    const decl = "theorem fc (f: tm): $ _ ⊢ f = f $;";
    const compiled = await compileGoal(decl, "f = f    :eq_intro_nd");
    // Found rather than computed: the arithmetic over a 600-line theory block
    // is what would be wrong, and it is not what the test is about.
    const goalLine =
      goalSource(decl, "f = f    :eq_intro_nd").split("\n").indexOf(decl) + 1;

    expect(compiled.diagnostics).toHaveLength(1);
    expect(compiled.diagnostics[0]?.line).toBe(goalLine);
    expect(compiled.diagnostics[0]?.params).toEqual({
      name: "f",
      sort: "tm",
    });
  });

  test("a goal that displaces nothing says nothing", async () => {
    const compiled = await compileGoal(
      "theorem u {x: var} {a: name}: $ ∀ x F(x) ⊢ F(a) $;",
      "∀ x F(x)    :ax",
    );

    expect(compiled.ok).toBe(true);
    expect(compiled.diagnostics).toEqual([]);
  });

  test("a warning does not suppress an error in the same exercise", async () => {
    const compiled = await compileGoal(
      "theorem mp (a b: wff): $ a ⊢ a $;",
      "a → →    :ax",
    );

    expect(compiled.ok).toBe(false);
    expect(
      compiled.diagnostics.some((entry) => entry.severity === "error"),
    ).toBe(true);
  });
});

describe("aufbau-proof-fitch authoring", () => {
  test("a theory + Fitch proof compiles, freezing goal, starter, and assumption", async () => {
    const compiled = await compileCarnapMarkdown(
      fitchSource(`:::aufbau-proof-fitch{system="prop" id="f1"}
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
    // The frozen theory text is the theory plus the appended goal declaration.
    const mm0 = proofTheoryText(publicData).mm0;
    expect(mm0).toContain("axiom imp_elim");
    expect(mm0.endsWith("theorem mp (a b: wff): $ (a → b) , a ⊢ b $;")).toBe(
      true,
    );
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
      fitchSource(`:::aufbau-proof-fitch{system="prop" id="f1" assumption="hyp"}
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
      fitchSource(`:::aufbau-proof-fitch{system="prop" id="f1" sequent="|-"}
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
      fitchSource(`:::aufbau-proof-fitch{system="prop" id="f1"}
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
      fitchSource(`:::aufbau-proof-fitch{system="prop" id="f1" options="auto complete"}
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
      await diagnosticsFor(`:::aufbau-proof-fitch{system="missing" id="f1"}
theorem mp (a b: wff): $ (a → b) , a ⊢ b $
----
:::`),
    ).toContain("unknown_system");
  });

  test("a missing theorem header is rejected", async () => {
    expect(
      await diagnosticsFor(
        fitchSource(`:::aufbau-proof-fitch{system="prop" id="f1"}
Just some prose, no goal.
:::`),
      ),
    ).toContain("missing_theorem_header");
  });

  test("a header with no underline is rejected", async () => {
    expect(
      await diagnosticsFor(
        fitchSource(`:::aufbau-proof-fitch{system="prop" id="f1"}
theorem mp (a b: wff): $ (a → b) , a ⊢ b $
a → b   :ax
:::`),
      ),
    ).toContain("missing_proof_underline");
  });
});
