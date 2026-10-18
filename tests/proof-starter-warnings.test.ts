import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";

/**
 * A starter formula the language refuses is a warning, not an error
 * (gh #44): an author may hand over a broken proof for the student to repair,
 * so the save goes through, the starter is frozen as written, and the author
 * is still told which line will not read. What the editors do with it is
 * `tests/dom/broken-starter.test.ts`'s.
 */

const FORALLX = `:::aufbau-mm0{name="forallx" src="/theories/forallx-calgary.mm0"}\n:::`;
const GOAL = "theorem g: $ P → Q ; P ⊢ Q $";

async function compile(kind: string, starter: string) {
  return await compileCarnapMarkdown(
    `${FORALLX}\n\n:::aufbau-proof-${kind}{system="forallx" id="x"}\nRepair it.\n\n${GOAL}\n----\n${starter}\n:::\n`,
  );
}

/** The publicData the save froze for exercise `x`. */
function publicData(
  compiled: Awaited<ReturnType<typeof compile>>,
): Record<string, unknown> {
  if (!compiled.ok) {
    throw new Error("did not compile");
  }
  const item = compiled.artifact.manifest.find((entry) => entry.id === "x");
  return item?.publicData as Record<string, unknown>;
}

/** Every diagnostic as `[code, severity, line]`. */
function said(compiled: Awaited<ReturnType<typeof compile>>) {
  return compiled.diagnostics.map((entry) => [
    entry.code,
    entry.severity,
    entry.line,
  ]);
}

// The directive opens on line 4; the starter's first line is line 9.
describe("a starter formula that does not read", () => {
  test("Fitch saves, warning on each line, with the text kept as written", async () => {
    const starter = ["P → Q :PR", "P :PR", "?", "Q ∧ :→E 1 2"].join("\n");
    const compiled = await compile("fitch", starter);

    expect(compiled.ok).toBe(true);
    expect(said(compiled)).toEqual([
      ["invalid_formula", "warning", 11],
      ["invalid_formula", "warning", 12],
    ]);
    expect(publicData(compiled).starterBody).toBe(starter);
  });

  test("the proof tree saves, warning on the node's line", async () => {
    const compiled = await compile(
      "tree",
      [
        "l1: $ P → Q ; P ⊢ ? $ by ax []",
        "l2: $ P → Q ; P ⊢ P $ by ax []",
        "l3: $ P → Q ; P ⊢ Q $ by imp_elim [l1, l2]",
      ].join("\n"),
    );

    expect(compiled.ok).toBe(true);
    expect(said(compiled)).toEqual([["invalid_formula", "warning", 9]]);
    expect(publicData(compiled).starterTree).toMatchObject({
      premises: [{ formula: "P → Q ; P ⊢ ?" }, { formula: "P → Q ; P ⊢ P" }],
    });
  });

  test("Prawitz saves, warning on the node's line", async () => {
    const compiled = await compile(
      "prawitz",
      [
        "a1: $ P → Q ⊢ ? $ by ax []",
        "a2: $ P ⊢ P $ by ax []",
        "l1: $ _ ⊢ Q $ by imp_elim [a1, a2]",
      ].join("\n"),
    );

    expect(compiled.ok).toBe(true);
    expect(said(compiled)).toEqual([["invalid_formula", "warning", 9]]);
    expect(publicData(compiled).starterTree).toMatchObject({
      premises: [{ formula: "?" }, { formula: "P" }],
    });
  });

  test("a Prawitz starter that is not a tree is still refused", async () => {
    // What the editor cannot lay out is not a broken proof but no proof: the
    // warning is for formulas, not shape.
    const compiled = await compile(
      "prawitz",
      ["a1: $ P ⊢ ? $ by ax []", "l1: $ _ ⊢ Q $ by imp_elim [a1, a1]"].join(
        "\n",
      ),
    );

    expect(compiled.ok).toBe(false);
  });
});
