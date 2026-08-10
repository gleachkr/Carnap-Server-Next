import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { renderCompiledContent } from "../src/worker/application/content/renderer";
import type { CompiledContentArtifact } from "../src/worker/domain/content";
import {
  type AufbauProofTreePublicData,
  isAufbauProofTreePublicData,
} from "../src/worker/exercises/aufbau-proof-tree/types";
import { i18nFor } from "../src/worker/i18n";

const THEORY = `:::aufbau-mm0{name="prop" show}
provable sort wff;
term top: wff;
axiom top_i: $ top $;
:::`;

function treeSource(directive: string): string {
  return `${THEORY}\n\n${directive}`;
}

async function diagnosticsFor(source: string): Promise<string[]> {
  const compiled = await compileCarnapMarkdown(source);
  return compiled.ok ? [] : compiled.diagnostics.map((entry) => entry.code);
}

function treePublicData(
  artifact: CompiledContentArtifact,
  id: string,
): AufbauProofTreePublicData {
  const item = artifact.manifest.find((entry) => entry.id === id);
  if (item === undefined || !isAufbauProofTreePublicData(item.publicData)) {
    throw new Error(`no aufbau-proof-tree exercise '${id}'`);
  }
  return item.publicData;
}

describe("aufbau-proof-tree authoring", () => {
  test("a theory + tree proof compiles, freezing the goal and its formula", async () => {
    const compiled = await compileCarnapMarkdown(
      treeSource(`:::aufbau-proof-tree{theory="prop" id="t1"}
Build a proof that top holds.

theorem thm_top: $ top $
:::`),
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    const item = compiled.artifact.manifest.find(
      (entry) => entry.id === "t1",
    );
    expect(item?.kind).toBe("aufbau-proof-tree@1");
    expect(item?.answerKind).toBe("aufbau-proof-tree-answer@1");
    expect(item?.capabilities).toEqual({
      supportsAutomaticEvaluation: true,
      supportsManualReview: true,
    });

    const publicData = treePublicData(compiled.artifact, "t1");
    expect(publicData.goalName).toBe("thm_top");
    expect(publicData.goalFormula).toBe("top");
    // The theory text plus the appended goal declaration — the sole grading input.
    expect(publicData.mm0).toBe(
      "provable sort wff;\nterm top: wff;\naxiom top_i: $ top $;\ntheorem thm_top: $ top $;",
    );
    expect(publicData.promptHtml).toContain("Build a proof that top holds.");
    expect(publicData.options).toEqual({
      allowAuto: false,
      allowCompletion: false,
    });
  });

  test("the tree proof renders its element with the goal seeded", async () => {
    const compiled = await compileCarnapMarkdown(
      treeSource(`:::aufbau-proof-tree{theory="prop" id="t1"}
theorem thm_top: $ top $
:::`),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    const html = renderCompiledContent(compiled.artifact, i18nFor("en"));
    expect(html).toContain('<details class="aufbau-theory">');
    expect(html).toContain("<carnap-aufbau-proof-tree ");
    // The inert SSR seed shows the goal as a single ProofML node.
    expect(html).toContain(
      "<proof-tree><proof-proposition>top</proof-proposition></proof-tree>",
    );
  });

  test("options=auto complete toggles editor assistance", async () => {
    const compiled = await compileCarnapMarkdown(
      treeSource(`:::aufbau-proof-tree{theory="prop" id="t1" options="auto complete"}
theorem thm_top: $ top $
:::`),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    expect(treePublicData(compiled.artifact, "t1").options).toEqual({
      allowAuto: true,
      allowCompletion: true,
    });
  });

  test("a tree proof referencing an undeclared theory is rejected", async () => {
    expect(
      await diagnosticsFor(`:::aufbau-proof-tree{theory="missing" id="t1"}
theorem thm_top: $ top $
:::`),
    ).toContain("unknown_theory");
  });

  test("a missing theorem header is rejected", async () => {
    expect(
      await diagnosticsFor(
        treeSource(`:::aufbau-proof-tree{theory="prop" id="t1"}
Just some prose, no goal.
:::`),
      ),
    ).toContain("missing_theorem_header");
  });

  test("a header with no goal formula is rejected", async () => {
    expect(
      await diagnosticsFor(
        treeSource(`:::aufbau-proof-tree{theory="prop" id="t1"}
theorem thm_top:
:::`),
      ),
    ).toContain("missing_goal_formula");
  });

  test("an unknown option flag is rejected", async () => {
    expect(
      await diagnosticsFor(
        treeSource(`:::aufbau-proof-tree{theory="prop" id="t1" options="cheat"}
theorem thm_top: $ top $
:::`),
      ),
    ).toContain("unknown_proof_option");
  });

  test("no starter body leaves starterTree undefined (build from scratch)", async () => {
    const compiled = await compileCarnapMarkdown(
      treeSource(`:::aufbau-proof-tree{theory="prop" id="t1"}
theorem thm_top: $ top $
:::`),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    expect(
      treePublicData(compiled.artifact, "t1").starterTree,
    ).toBeUndefined();
  });

  test("a `----` starter body pre-populates the tree", async () => {
    const compiled = await compileCarnapMarkdown(
      treeSource(`:::aufbau-proof-tree{theory="prop" id="t1"}
theorem thm_top: $ top $
----
l1: $ a $ by ax []
l2: $ top $ by mp [l1]
:::`),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    const starter = treePublicData(compiled.artifact, "t1").starterTree;
    expect(starter?.formula).toBe("top");
    expect(starter?.rule).toBe("mp");
    expect(starter?.premises.map((p) => p.formula)).toEqual(["a"]);
    expect(starter?.premises[0]?.rule).toBe("ax");
  });

  test("the starter tree is drawn into the inert SSR seed", async () => {
    const compiled = await compileCarnapMarkdown(
      treeSource(`:::aufbau-proof-tree{theory="prop" id="t1"}
theorem thm_top: $ top $
----
l1: $ a $ by ax []
l2: $ top $ by mp [l1]
:::`),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    const html = renderCompiledContent(compiled.artifact, i18nFor("en"));
    // The seed is now the whole starter tree: a forest holding the premise `a`.
    expect(html).toContain("<proof-forest>");
    expect(html).toContain("<proof-proposition>a</proof-proposition>");
    expect(html).toContain("<proof-inference>ax</proof-inference>");
  });

  test("a starter proof that is a graph, not a tree, is rejected", async () => {
    expect(
      await diagnosticsFor(
        treeSource(`:::aufbau-proof-tree{theory="prop" id="t1"}
theorem thm_top: $ top $
----
l1: $ a $ by ax []
l2: $ b $ by r [l1]
l3: $ c $ by r [l1]
l4: $ top $ by r [l2, l3]
:::`),
      ),
    ).toContain("proof_is_not_a_tree");
  });
});
