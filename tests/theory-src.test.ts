import { describe, expect, test } from "bun:test";
import { stripSyntaxAnnotations } from "@aufbau/syntax";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { proofTheoryText } from "../src/worker/exercises/aufbau-proof/formulas";
import type { AufbauProofFitchPublicData } from "../src/worker/exercises/aufbau-proof-fitch/types";
import { isAufbauProofFitchPublicData } from "../src/worker/exercises/aufbau-proof-fitch/types";
import { THEORY_SOURCES } from "../src/worker/logic/theories";

/**
 * `src=` on an `:::aufbau-mm0` block: what a path resolves to, what it composes
 * with, and what each way of getting it wrong says.
 *
 * The resolution itself is a lookup in the module graph rather than a fetch, so
 * every case here runs with no server — which is the property that matters, and
 * is why the same compile behaves identically in the worker and in the browser
 * preview.
 */

const FORALLX = "/theories/forallx-calgary-2019.mm0";

const FORALLX_SOURCE = THEORY_SOURCES["forallx-calgary-2019.mm0"] ?? "";

/**
 * What the engine gets. forallx: Calgary is one artifact serving as both the
 * proof theory and the course's language, so it carries `@syntax` annotations;
 * they are the surface parser's and the engine rejects an annotation that is
 * not its own, so freezing strips them. That is a property of the freeze, not
 * of this theory — an author's own extension is stripped on the same terms.
 */
const FORALLX_FROZEN = stripSyntaxAnnotations(FORALLX_SOURCE);

function lesson(theoryBlock: string, goal = "andcomm"): string {
  return `${theoryBlock}

:::aufbau-proof-fitch{theory="forallx" id="ex1"}
Take it apart and put it back.

theorem ${goal} (P Q: wff): $ P ∧ Q ⊢ Q ∧ P $
----
P ∧ Q   :ax
:::`;
}

async function publicDataOf(
  source: string,
): Promise<AufbauProofFitchPublicData> {
  const compiled = await compileCarnapMarkdown(source);

  if (!compiled.ok) {
    throw new Error(
      `compile failed: ${compiled.diagnostics.map((one) => one.code).join(", ")}`,
    );
  }

  const item = compiled.artifact.manifest.find((entry) => entry.id === "ex1");

  if (item === undefined || !isAufbauProofFitchPublicData(item.publicData)) {
    throw new Error("no aufbau-proof-fitch exercise 'ex1'");
  }

  return item.publicData;
}

async function frozenMm0(source: string): Promise<string> {
  const compiled = await compileCarnapMarkdown(source);

  if (!compiled.ok) {
    throw new Error(
      `compile failed: ${compiled.diagnostics.map((one) => one.code).join(", ")}`,
    );
  }

  const item = compiled.artifact.manifest.find((entry) => entry.id === "ex1");

  if (item === undefined || !isAufbauProofFitchPublicData(item.publicData)) {
    throw new Error("no aufbau-proof-fitch exercise 'ex1'");
  }

  return proofTheoryText(item.publicData).mm0;
}

async function codesFor(source: string): Promise<string[]> {
  const compiled = await compileCarnapMarkdown(source);

  return compiled.ok ? [] : compiled.diagnostics.map((one) => one.code);
}

describe("aufbau-mm0 src", () => {
  test("a built-in path is frozen into the exercise, ahead of the goal", async () => {
    const mm0 = await frozenMm0(
      lesson(`:::aufbau-mm0{name="forallx" src="${FORALLX}"}\n:::`),
    );

    // Cheap proof the fixture is not empty, which would make the rest vacuous.
    expect(FORALLX_SOURCE.length).toBeGreaterThan(1000);
    expect(FORALLX_SOURCE).toContain("--| @syntax");
    expect(FORALLX_FROZEN).not.toContain("--| @syntax");
    expect(mm0).toBe(
      `${FORALLX_FROZEN}\ntheorem andcomm (P Q: wff): $ P ∧ Q ⊢ Q ∧ P $;`,
    );
  });

  test("a body alongside src extends the named theory, and comes last", async () => {
    const mm0 = await frozenMm0(
      lesson(`:::aufbau-mm0{name="forallx" src="${FORALLX}"}
term Cube (x: tm): wff;

--| @congr
axiom Cube_congr (a b: tm): $ a = b $ > $ Cube a ↔ Cube b $;
:::`),
    );

    expect(mm0).toBe(
      `${FORALLX_FROZEN}
term Cube (x: tm): wff;

--| @congr
axiom Cube_congr (a b: tm): $ a = b $ > $ Cube a ↔ Cube b $;
theorem andcomm (P Q: wff): $ P ∧ Q ⊢ Q ∧ P $;`,
    );
  });

  test("a body with no src is still the whole theory", async () => {
    const mm0 = await frozenMm0(
      lesson(`:::aufbau-mm0{name="forallx"}
provable sort wff;
term and (a b: wff): wff;
:::`),
    );

    expect(mm0).toBe(
      "provable sort wff;\nterm and (a b: wff): wff;\ntheorem andcomm (P Q: wff): $ P ∧ Q ⊢ Q ∧ P $;",
    );
  });

  /**
   * A theory that is also a language cannot spell its context separator `,` —
   * the comma is the student's argument separator in `R(a,b)` and MM0 gives a
   * math token one meaning — so forallx spells it `;`. The alternative to
   * reading that off the artifact is every exercise ever set from the theory
   * repeating `context=";"`, and forgetting once produces `.auf` the engine
   * rejects for reasons that point nowhere near the mistake.
   */
  test("a theory's own notations reach the exercise with no attribute", async () => {
    const data = await publicDataOf(
      lesson(`:::aufbau-mm0{name="forallx" src="${FORALLX}"}\n:::`),
    );

    expect({
      context: data.contextSymbol,
      sequent: data.sequentSymbol,
    }).toEqual({ context: ";", sequent: "⊢" });
  });

  test("an attribute overrides what the theory says", async () => {
    const data = await publicDataOf(
      `:::aufbau-mm0{name="forallx" src="${FORALLX}"}
:::

:::aufbau-proof-fitch{theory="forallx" id="ex1" context="," sequent="|-"}
Take it apart and put it back.

theorem andcomm (P Q: wff): $ P ∧ Q ⊢ Q ∧ P $
----
P ∧ Q   :ax
:::`,
    );

    expect({
      context: data.contextSymbol,
      sequent: data.sequentSymbol,
    }).toEqual({ context: ",", sequent: "|-" });
  });

  test("a theory that says nothing leaves the house defaults", async () => {
    const data = await publicDataOf(
      lesson(`:::aufbau-mm0{name="forallx"}
provable sort wff;
term and (a b: wff): wff;
:::`),
    );

    expect({
      context: data.contextSymbol,
      sequent: data.sequentSymbol,
    }).toEqual({ context: ",", sequent: "⊢" });
  });

  test("a path no theory answers to says so, and lists what does", async () => {
    const codes = await codesFor(
      lesson(
        `:::aufbau-mm0{name="forallx" src="/theories/forallx-magnus.mm0"}\n:::`,
      ),
    );

    expect(codes).toContain("unknown_theory_src");
  });

  test("a path outside the theory namespace is the same miss", async () => {
    const codes = await codesFor(
      lesson(
        `:::aufbau-mm0{name="forallx" src="/content/revisions/abc/source"}\n:::`,
      ),
    );

    expect(codes).toContain("unknown_theory_src");
  });

  test("a theory kept elsewhere is refused as a feature, not a typo", async () => {
    for (const src of [
      "https://example.test/forallx.mm0",
      "http://example.test/forallx.mm0",
      "//example.test/forallx.mm0",
      "file:///etc/forallx.mm0",
    ]) {
      const codes = await codesFor(
        lesson(`:::aufbau-mm0{name="forallx" src="${src}"}\n:::`),
      );

      expect({ codes, src }).toEqual({
        codes: expect.arrayContaining(["remote_theory_src"]),
        src,
      });
    }
  });

  test("a src that did not resolve does not compile its extension alone", async () => {
    const compiled = await compileCarnapMarkdown(
      lesson(`:::aufbau-mm0{name="forallx" src="/theories/nope.mm0"}
term Cube (x: tm): wff;
:::`),
    );

    expect(compiled.ok).toBe(false);

    // No theory was declared, so the proof block below it has nothing to
    // reference — which is the honest outcome. What must not happen is a
    // theory named `forallx` holding one stray declaration.
    const codes = compiled.ok
      ? []
      : compiled.diagnostics.map((one) => one.code);

    expect(codes).toContain("unknown_theory_src");
    expect(codes).toContain("unknown_theory");
  });

  test("a block with neither a src nor a body is empty", async () => {
    const codes = await codesFor(
      lesson(`:::aufbau-mm0{name="forallx"}\n:::`),
    );

    expect(codes).toContain("empty_theory");
  });

  test("show renders the resolved theory, extension and all", async () => {
    const compiled = await compileCarnapMarkdown(
      lesson(`:::aufbau-mm0{name="forallx" src="${FORALLX}" show}
term Cube (x: tm): wff;
:::`),
    );

    if (!compiled.ok) {
      throw new Error("expected the lesson to compile");
    }

    const panel = compiled.artifact.document.nodes.find(
      (node) => node.kind === "theory",
    );

    // The panel shows the artifact as authored and as the route serves it,
    // `@syntax` and all — a file that is also the course's language says so
    // there, and a reader shown only the engine half is shown half of it.
    expect(panel).toEqual({
      kind: "theory",
      mm0: `${FORALLX_SOURCE}\nterm Cube (x: tm): wff;`,
      name: "forallx",
    });
  });
});
