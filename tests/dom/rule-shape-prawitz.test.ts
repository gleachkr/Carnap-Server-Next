import { describe, expect, test } from "bun:test";
import {
  ruleShapeReader,
  ruleShapeText,
} from "../../src/worker/exercise-kit/proof/rule-shape";
import { dom } from "../helpers/dom";
import { MAGNUS_THEORY_SOURCE } from "../helpers/magnus-theory";
import {
  compileExercise,
  mountExercise,
  typeInto,
  until,
} from "./mount-exercise";
import {
  prawitzButton,
  prawitzFormulaFieldOf,
  prawitzItems,
  prawitzPress,
} from "./prawitz-widget";
import { mockProofCompiler } from "./proof-compiler-mock";

/**
 * A rule's shape in the Prawitz editor (gh #36), which draws a problem the
 * way the tree editor does (`rule-shape-tree.test.ts`): once, into the hidden
 * note a line is described by, copied from there to the problem line F8
 * leaves and the popup a hover floats. Prawitz shows a premise's fresh
 * assumption as a discharge, `[ph] … ch`.
 *
 * The compiler is mocked to reject the proof's last line the way the engine
 * does, naming an axiom it could not match: Magnus's ¬I, which discharges
 * one assumption for each of its two premises.
 */

const MESSAGE =
  "the statement and cited premises could not be matched against this rule";

await mockProofCompiler((_mm0: string, proof: string) => {
  const at = proof.lastIndexOf("\n") + 1;
  return {
    diagnostics: [
      {
        error: "UnifyMismatch",
        message: `${MESSAGE}\nrule: neg_intro`,
        rule: "neg_intro",
        severity: "error",
        spanEnd: Buffer.byteLength(proof),
        spanStart: Buffer.byteLength(proof.slice(0, at)),
      },
    ],
    ok: false,
  };
});

await import("../../src/client/components/carnap-aufbau-proof-prawitz-v1");

const SHAPE = ruleShapeText(
  ruleShapeReader(MAGNUS_THEORY_SOURCE, "prawitz")("neg_intro") ?? [],
);

const PRAWITZ = [
  ':::aufbau-mm0{name="fx" src="/theories/forallx-magnus.mm0"}',
  ":::",
  "",
  ':::aufbau-proof-prawitz{system="fx" id="z"}',
  "Prove it.",
  "",
  "theorem goal: $ P ⊢ P $",
  ":::",
].join("\n");

describe("a rule's shape in the Prawitz editor", () => {
  test("the note reads as the shape; the problem line and the popup draw it", async () => {
    const mounted = mountExercise(await compileExercise(PRAWITZ));
    prawitzButton(mounted, "New assumption").click();
    const [line] = prawitzItems(mounted);
    const field = prawitzFormulaFieldOf(line as HTMLElement);
    typeInto(field, "P");

    // Read as text — what a screen reader hears on the line.
    expect(SHAPE).toBe("¬I: [ph] … ps, [ph] … ¬ps ∴ ¬ph");
    await until(
      () => field.getAttribute("data-problem") === `${MESSAGE}\n${SHAPE}`,
    );
    const note = mounted.root.getElementById(
      (line as HTMLElement).getAttribute("aria-describedby") ?? "",
    );
    expect(note?.textContent).toBe(`${MESSAGE}\n${SHAPE}`);

    // F8 pins it under the proof, drawn: a box per premise.
    prawitzPress(line as HTMLElement, "F8");
    const pinned = mounted.root.querySelector<HTMLElement>(".problem-line");
    expect(pinned?.hidden).toBe(false);
    expect(
      Array.from(
        pinned?.querySelectorAll(".rule-shape-premise") ?? [],
        (box) => box.textContent,
      ),
    ).toEqual(["[ph] … ps", "[ph] … ¬ps"]);
    expect(pinned?.querySelector("[id]")).toBeNull();

    // A hover floats the same drawing.
    field.dispatchEvent(
      new dom.window.PointerEvent("pointerover", {
        bubbles: true,
        pointerType: "mouse",
      }),
    );
    const popup = mounted.root.querySelector<HTMLElement>(".problem-popup");
    await until(() => popup?.hidden === false);
    expect(popup?.querySelectorAll(".rule-shape-premise").length).toBe(2);
    expect(popup?.textContent).toBe(`${MESSAGE}\n${SHAPE}`);
  });
});
