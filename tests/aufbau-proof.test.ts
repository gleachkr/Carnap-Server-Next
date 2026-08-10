import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { renderCompiledContent } from "../src/worker/application/content/renderer";
import type { CompiledContentArtifact } from "../src/worker/domain/content";
import {
  type AufbauProofPublicData,
  isAufbauProofPublicData,
} from "../src/worker/exercises/aufbau-proof/types";
import { i18nFor } from "../src/worker/i18n";

const THEORY = `:::aufbau-mm0{name="prop" show}
provable sort wff;
term top: wff;
axiom top_i: $ top $;
:::`;

function proofSource(directive: string): string {
  return `${THEORY}\n\n${directive}`;
}

async function diagnosticsFor(source: string): Promise<string[]> {
  const compiled = await compileCarnapMarkdown(source);
  return compiled.ok ? [] : compiled.diagnostics.map((entry) => entry.code);
}

function proofPublicData(
  artifact: CompiledContentArtifact,
  id: string,
): AufbauProofPublicData {
  const item = artifact.manifest.find((entry) => entry.id === id);
  if (item === undefined || !isAufbauProofPublicData(item.publicData)) {
    throw new Error(`no aufbau-proof exercise '${id}'`);
  }
  return item.publicData;
}

describe("aufbau-proof authoring", () => {
  test("a theory + proof compiles and freezes the goal into the mm0", async () => {
    const compiled = await compileCarnapMarkdown(
      proofSource(`:::aufbau-proof{theory="prop" id="p1"}
Show that top holds.

theorem thm_top: $ top $
----
l1: $ top $ by top_i []
:::`),
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    const item = compiled.artifact.manifest.find(
      (entry) => entry.id === "p1",
    );
    expect(item?.kind).toBe("aufbau-proof@1");
    expect(item?.answerKind).toBe("aufbau-proof-answer@1");
    expect(item?.capabilities).toEqual({
      supportsAutomaticEvaluation: true,
      supportsManualReview: true,
    });

    const publicData = proofPublicData(compiled.artifact, "p1");
    expect(publicData.goalName).toBe("thm_top");
    // The theory text plus the appended goal declaration — the sole grading input.
    expect(publicData.mm0).toBe(
      "provable sort wff;\nterm top: wff;\naxiom top_i: $ top $;\ntheorem thm_top: $ top $;",
    );
    expect(publicData.starterBody).toBe("l1: $ top $ by top_i []");
    expect(publicData.promptHtml).toContain("Show that top holds.");
    expect(publicData.options).toEqual({
      allowAuto: false,
      allowCompletion: false,
    });
  });

  test("the theory renders a read-only panel and the proof its inert source", async () => {
    const compiled = await compileCarnapMarkdown(
      proofSource(`:::aufbau-proof{theory="prop" id="p1"}
theorem thm_top: $ top $
----
l1: $ top $ by top_i []
:::`),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    const html = renderCompiledContent(compiled.artifact, i18nFor("en"));
    // Theory panel, with the MM0 escaped inside a <pre>.
    expect(html).toContain('<details class="aufbau-theory">');
    expect(html).toContain("axiom top_i: $ top $;");
    // Proof element with its inert starter source (goal header + body).
    expect(html).toContain("<carnap-aufbau-proof ");
    expect(html).toContain("thm_top\n----\nl1: $ top $ by top_i []");
  });

  test("a theory without show is usable but renders nothing", async () => {
    const compiled = await compileCarnapMarkdown(
      `:::aufbau-mm0{name="prop"}
provable sort wff;
term top: wff;
axiom top_i: $ top $;
:::

:::aufbau-proof{theory="prop" id="p1"}
theorem thm_top: $ top $
----
l1: $ top $ by top_i []
:::`,
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    // The theory is still declared — the proof resolves it and freezes it into
    // publicData — it just does not reach the document.
    expect(proofPublicData(compiled.artifact, "p1").mm0).toContain(
      "axiom top_i: $ top $;",
    );
    expect(compiled.artifact.document.nodes.map((node) => node.kind)).toEqual(
      ["exercise"],
    );

    const html = renderCompiledContent(compiled.artifact, i18nFor("en"));
    expect(html).not.toContain("aufbau-theory");
    expect(html).not.toContain("axiom top_i");
  });

  test("the panel's own chrome is written in the reader's language", async () => {
    const compiled = await compileCarnapMarkdown(
      proofSource(`:::aufbau-proof{theory="prop" id="p1"}
theorem thm_top: $ top $
----
l1: $ top $ by top_i []
:::`),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    // The word is chosen when the page is rendered, not when the author saved:
    // one stored document, two languages.
    expect(renderCompiledContent(compiled.artifact, i18nFor("en"))).toContain(
      ">Theory</span>",
    );
    expect(renderCompiledContent(compiled.artifact, i18nFor("de"))).toContain(
      ">Theorie</span>",
    );
  });

  test("show rejects a value that is not a boolean", async () => {
    expect(
      await diagnosticsFor(`:::aufbau-mm0{name="prop" show="sometimes"}
provable sort wff;
:::`),
    ).toContain("invalid_show");
  });

  test("options=auto complete toggles editor assistance", async () => {
    const compiled = await compileCarnapMarkdown(
      proofSource(`:::aufbau-proof{theory="prop" id="p1" options="auto complete"}
theorem thm_top: $ top $
----
l1: $ top $ by top_i []
:::`),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    expect(proofPublicData(compiled.artifact, "p1").options).toEqual({
      allowAuto: true,
      allowCompletion: true,
    });
  });

  test("an unknown option flag is rejected", async () => {
    expect(
      await diagnosticsFor(
        proofSource(`:::aufbau-proof{theory="prop" id="p1" options="cheat"}
theorem thm_top: $ top $
----
l1: $ top $ by top_i []
:::`),
      ),
    ).toContain("unknown_proof_option");
  });

  test("a proof referencing an undeclared theory is rejected", async () => {
    expect(
      await diagnosticsFor(`:::aufbau-proof{theory="missing" id="p1"}
theorem thm_top: $ top $
----
l1: $ top $ by top_i []
:::`),
    ).toContain("unknown_theory");
  });

  test("a proof declared before its theory cannot see it (declare before use)", async () => {
    expect(
      await diagnosticsFor(`:::aufbau-proof{theory="prop" id="p1"}
theorem thm_top: $ top $
----
l1: $ top $ by top_i []
:::

${THEORY}`),
    ).toContain("unknown_theory");
  });

  test("a missing theorem header is rejected", async () => {
    expect(
      await diagnosticsFor(
        proofSource(`:::aufbau-proof{theory="prop" id="p1"}
Just some prose, no goal.
:::`),
      ),
    ).toContain("missing_theorem_header");
  });

  test("a header with no underline is rejected", async () => {
    expect(
      await diagnosticsFor(
        proofSource(`:::aufbau-proof{theory="prop" id="p1"}
theorem thm_top: $ top $
l1: $ top $ by top_i []
:::`),
      ),
    ).toContain("missing_proof_underline");
  });

  test("a duplicate theory name is rejected", async () => {
    expect(
      await diagnosticsFor(`${THEORY}

${THEORY}`),
    ).toContain("duplicate_theory");
  });

  test("an empty theory body is rejected", async () => {
    expect(await diagnosticsFor(`:::aufbau-mm0{name="prop"}\n:::`)).toContain(
      "empty_theory",
    );
  });

  test("a theory with no name is rejected", async () => {
    expect(
      await diagnosticsFor(`:::aufbau-mm0\nprovable sort wff;\n:::`),
    ).toContain("missing_name");
  });

  test("a theory src attribute is rejected (deferred)", async () => {
    expect(
      await diagnosticsFor(
        `:::aufbau-mm0{name="prop" src="/theories/prop.mm0"}\nprovable sort wff;\n:::`,
      ),
    ).toContain("unsupported_theory_src");
  });

  test("MM0 notation containing angle brackets is not flagged as raw HTML", async () => {
    const compiled = await compileCarnapMarkdown(`:::aufbau-mm0{name="bicond"}
provable sort wff;
term iff (a b: wff): wff; infixl iff: $<->$ prec 20;
:::

:::aufbau-proof{theory="bicond" id="p1"}
theorem thm: $ top $
----
l1: $ top $ by top_i []
:::`);
    // No unsafe_raw_html from the `$<->$` notation; compile may still fail on the
    // logic, but never on a raw-HTML false positive.
    const codes = compiled.ok
      ? []
      : compiled.diagnostics.map((entry) => entry.code);
    expect(codes).not.toContain("unsafe_raw_html");
  });
});
