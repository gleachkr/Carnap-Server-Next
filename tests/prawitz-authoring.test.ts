import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { renderCompiledContent } from "../src/worker/application/content/renderer";
import type { CompiledContentArtifact } from "../src/worker/domain/content";
import {
  prawitzTreeMarkup,
  renderAufbauProofPrawitzReview,
} from "../src/worker/exercises/aufbau-proof-prawitz/read-only-view";
import {
  type AufbauProofPrawitzPublicData,
  isAufbauProofPrawitzPublicData,
  type PrawitzProofNode,
} from "../src/worker/exercises/aufbau-proof-prawitz/types";
import { i18nFor } from "../src/worker/i18n";
import { PRAWITZ_DEMO_SOURCE } from "./helpers/prawitz-demo";

const THEORY = `:::aufbau-mm0{name="prop" show}
provable sort wff;
term top: wff;
axiom top_i: $ top $;
:::`;

function prawitzSource(directive: string): string {
  return `${THEORY}\n\n${directive}`;
}

async function diagnosticsFor(source: string): Promise<string[]> {
  const compiled = await compileCarnapMarkdown(source);
  return compiled.ok ? [] : compiled.diagnostics.map((entry) => entry.code);
}

function prawitzPublicData(
  artifact: CompiledContentArtifact,
  id: string,
): AufbauProofPrawitzPublicData {
  const item = artifact.manifest.find((entry) => entry.id === id);
  if (
    item === undefined ||
    !isAufbauProofPrawitzPublicData(item.publicData)
  ) {
    throw new Error(`no aufbau-proof-prawitz exercise '${id}'`);
  }
  return item.publicData;
}

describe("aufbau-proof-prawitz authoring", () => {
  test("a theory + prawitz proof compiles, freezing the goal and its formula", async () => {
    const compiled = await compileCarnapMarkdown(
      prawitzSource(`:::aufbau-proof-prawitz{theory="prop" id="p1"}
Build a natural-deduction tree for top.

theorem thm_top: $ top $
:::`),
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    const item = compiled.artifact.manifest.find(
      (entry) => entry.id === "p1",
    );
    expect(item?.kind).toBe("aufbau-proof-prawitz@1");
    expect(item?.answerKind).toBe("aufbau-proof-prawitz-answer@1");
    expect(item?.capabilities).toEqual({
      supportsAutomaticEvaluation: true,
      supportsManualReview: true,
    });

    const publicData = prawitzPublicData(compiled.artifact, "p1");
    expect(publicData.goalName).toBe("thm_top");
    expect(publicData.goalFormula).toBe("top");
    expect(publicData.assumptionRule).toBe("ax");
    // The theory text plus the appended goal declaration — the sole grading input.
    expect(publicData.mm0).toBe(
      "provable sort wff;\nterm top: wff;\naxiom top_i: $ top $;\ntheorem thm_top: $ top $;",
    );
    expect(publicData.promptHtml).toContain(
      "Build a natural-deduction tree for top.",
    );
    expect(publicData.options).toEqual({
      allowAuto: false,
      allowCompletion: false,
    });
  });

  test("assumption= overrides the assumption axiom the translator keys on", async () => {
    const compiled = await compileCarnapMarkdown(
      prawitzSource(`:::aufbau-proof-prawitz{theory="prop" id="p1" assumption="hyp_intro"}
theorem thm_top: $ top $
:::`),
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    expect(prawitzPublicData(compiled.artifact, "p1").assumptionRule).toBe(
      "hyp_intro",
    );
  });

  test("sequent= overrides the turnstile; ⊢ is the default", async () => {
    const compiled = await compileCarnapMarkdown(
      prawitzSource(`:::aufbau-proof-prawitz{theory="prop" id="p1" sequent="|-"}
theorem thm_top: $ top $
:::

:::aufbau-proof-prawitz{theory="prop" id="p2"}
theorem thm_top2: $ top $
:::`),
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    expect(prawitzPublicData(compiled.artifact, "p1").sequentSymbol).toBe(
      "|-",
    );
    expect(prawitzPublicData(compiled.artifact, "p2").sequentSymbol).toBe(
      "⊢",
    );
  });

  test("an optional ---- + starter body freezes a labeled tree into publicData", async () => {
    const compiled = await compileCarnapMarkdown(
      prawitzSource(`:::aufbau-proof-prawitz{theory="prop" id="p1"}
Finish the discharge.

theorem thm_top: $ top → top $
----
a1: $ top ⊢ top $ by ax [] -- label:1
c1: $ _ ⊢ top → top $ by imp_intro [a1] -- label:1
:::`),
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    const publicData = prawitzPublicData(compiled.artifact, "p1");
    expect(publicData.starterTree).toMatchObject({
      discharge: ["1"],
      formula: "top → top",
      premises: [{ formula: "top", label: "1", rule: "ax" }],
      rule: "imp_intro",
    });
  });

  test("a pasted context left of the exercise's sequent symbol is discarded", async () => {
    const compiled = await compileCarnapMarkdown(
      prawitzSource(`:::aufbau-proof-prawitz{theory="prop" id="p1" sequent="|-"}
theorem thm_top: $ top $
----
l1: $ G |- top $ by top_i []
:::`),
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    expect(
      prawitzPublicData(compiled.artifact, "p1").starterTree?.formula,
    ).toBe("top");
  });

  test("without an underline there is no starter and the canvas stays blank", async () => {
    const compiled = await compileCarnapMarkdown(
      prawitzSource(`:::aufbau-proof-prawitz{theory="prop" id="p1"}
Prose only, as before.

theorem thm_top: $ top $
:::`),
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    expect(
      prawitzPublicData(compiled.artifact, "p1").starterTree,
    ).toBeUndefined();
  });

  test("a malformed starter line is a compile diagnostic", async () => {
    expect(
      await diagnosticsFor(
        prawitzSource(`:::aufbau-proof-prawitz{theory="prop" id="p1"}
theorem thm_top: $ top $
----
this is not a proof line
:::`),
      ),
    ).toContain("malformed_proof_line");
  });

  test("a starter discharge mark that binds to nothing fails the compile", async () => {
    expect(
      await diagnosticsFor(
        prawitzSource(`:::aufbau-proof-prawitz{theory="prop" id="p1"}
theorem thm_top: $ top → top $
----
a1: $ top ⊢ top $ by ax []
c1: $ _ ⊢ top → top $ by imp_intro [a1] -- label:1
:::`),
      ),
    ).toContain("discharge_without_leaf");
  });

  test("a bare-formula starter line is refused — one canonical sequent format", async () => {
    expect(
      await diagnosticsFor(
        prawitzSource(`:::aufbau-proof-prawitz{theory="prop" id="p1"}
theorem thm_top: $ top $
----
l1: $ top $ by top_i []
:::`),
      ),
    ).toContain("starter_line_not_sequent");
  });

  test("options=auto complete toggles editor assistance", async () => {
    const compiled = await compileCarnapMarkdown(
      prawitzSource(`:::aufbau-proof-prawitz{theory="prop" id="p1" options="auto complete"}
theorem thm_top: $ top $
:::`),
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    expect(prawitzPublicData(compiled.artifact, "p1").options).toEqual({
      allowAuto: true,
      allowCompletion: true,
    });
  });

  test("an unknown theory is a compile diagnostic", async () => {
    expect(
      await diagnosticsFor(
        prawitzSource(`:::aufbau-proof-prawitz{theory="nope" id="p1"}
theorem thm_top: $ top $
:::`),
      ),
    ).toContain("unknown_theory");
  });

  test("a goal header without a formula is a compile diagnostic", async () => {
    expect(
      await diagnosticsFor(
        prawitzSource(`:::aufbau-proof-prawitz{theory="prop" id="p1"}
theorem thm_top:
:::`),
      ),
    ).toContain("missing_goal_formula");
  });

  test("a missing id is a compile diagnostic", async () => {
    expect(
      await diagnosticsFor(
        prawitzSource(`:::aufbau-proof-prawitz{theory="prop"}
theorem thm_top: $ top $
:::`),
      ),
    ).toContain("missing_id");
  });

  test("the prawitz proof renders its element with the goal seeded", async () => {
    const compiled = await compileCarnapMarkdown(
      prawitzSource(`:::aufbau-proof-prawitz{theory="prop" id="p1"}
theorem thm_top: $ top $
:::`),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    const html = renderCompiledContent(compiled.artifact, i18nFor("en"));
    expect(html).toContain('<details class="aufbau-theory">');
    expect(html).toContain("<carnap-aufbau-proof-prawitz ");
    // The inert SSR seed shows the goal as a single ProofML node.
    expect(html).toContain(
      "<proof-tree><proof-proposition>top</proof-proposition></proof-tree>",
    );
  });

  test("the demo lesson compiles through the authoring pipeline", async () => {
    const compiled = await compileCarnapMarkdown(PRAWITZ_DEMO_SOURCE);
    expect(
      compiled.diagnostics.map((entry) => entry.code),
      JSON.stringify(compiled.diagnostics),
    ).toEqual([]);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    const ids = compiled.artifact.manifest.map((entry) => entry.id);
    expect(ids).toEqual([
      "pz_mp",
      "pz_self",
      "pz_dni",
      "pz_orcomm",
      "pz_kcomb",
      "pz_exelim",
      "pz_starter",
    ]);
    // The starter exercise ships its pre-built tree with the discharge it
    // already makes intact: the root is the inner `imp_intro`, marked `2`, and
    // the `b` leaf it discharges carries the matching label. The outer
    // discharge is the student's, so nothing else is labeled.
    const starter = prawitzPublicData(compiled.artifact, "pz_starter");
    expect(starter.starterTree?.formula).toBe("b → a ∧ b");
    expect(starter.starterTree?.rule).toBe("imp_intro");
    expect(starter.starterTree?.discharge).toEqual(["2"]);
    const conjunction = starter.starterTree?.premises[0];
    expect(conjunction?.premises[0]?.label).toBeUndefined();
    expect(conjunction?.premises[1]?.label).toBe("2");
  });
});

describe("prawitzTreeMarkup — textbook notation", () => {
  const tree: PrawitzProofNode = {
    discharge: ["1"],
    formula: "a → a",
    id: "root",
    premises: [
      { formula: "a", id: "leaf", label: "1", premises: [], rule: "ax" },
    ],
    rule: "imp_intro",
  };

  test("a labeled assumption is bracketed with a superscript and no inference line", () => {
    expect(prawitzTreeMarkup(tree, "ax")).toBe(
      "<proof-tree>" +
        "<proof-forest><proof-tree><proof-proposition>[a]<sup>1</sup></proof-proposition></proof-tree></proof-forest>" +
        "<proof-proposition>a → a</proof-proposition>" +
        "<proof-inference>imp_intro<sup>1</sup></proof-inference>" +
        "</proof-tree>",
    );
  });

  test("an unlabeled assumption is a bare premise; a zero-premise rule keeps its empty forest", () => {
    const premise: PrawitzProofNode = {
      formula: "a",
      id: "n1",
      premises: [],
      rule: "ax",
    };
    expect(prawitzTreeMarkup(premise, "ax")).toBe(
      "<proof-tree><proof-proposition>a</proof-proposition></proof-tree>",
    );

    const nullary: PrawitzProofNode = {
      formula: "x = x",
      id: "n2",
      premises: [],
      rule: "eq_intro_nd",
    };
    // The empty <proof-forest> is load-bearing: ProofML draws and restyles the
    // inference line off the forest's presence (see the tree type's gotcha).
    expect(prawitzTreeMarkup(nullary, "ax")).toBe(
      "<proof-tree><proof-forest></proof-forest><proof-proposition>x = x</proof-proposition><proof-inference>eq_intro_nd</proof-inference></proof-tree>",
    );
  });

  test("the review element embeds the tree and loads the component module", () => {
    const html = renderAufbauProofPrawitzReview(
      { assumptionRule: "ax", exerciseId: "p1", tree },
      i18nFor("en"),
    );
    expect(html).toContain("<carnap-aufbau-proof-prawitz ");
    expect(html).toContain("data-review");
    expect(html).toContain("[a]<sup>1</sup>");
    expect(html).toContain("carnap-aufbau-proof-prawitz-v1.js");
  });
});
