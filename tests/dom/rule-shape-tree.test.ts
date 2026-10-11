import { describe, expect, test } from "bun:test";
import {
  ruleShapeReader,
  ruleShapeText,
} from "../../src/worker/exercise-kit/proof/rule-shape";
import { dom } from "../helpers/dom";
import { MAGNUS_THEORY_SOURCE } from "../helpers/magnus-theory";
import { mountExercise, until } from "./mount-exercise";
import { compilesFine, mockProofCompiler } from "./proof-compiler-mock";
import { treeExercise, treeRootField, treeRootRule } from "./tree-widget";

/**
 * A rule's shape in the tree editor (gh #36), where a problem is drawn once,
 * into the hidden note a line is described by, and copied from there: the
 * note reads as the shape's text, and the problem line F8 leaves and the
 * popup a hover floats show it as boxes. The Fitch side is in
 * `fitch-element.test.ts`, the shapes themselves in `rule-shape.test.ts`.
 *
 * The compiler is mocked to reject any proof citing →E the way the engine
 * does, naming the axiom it could not match — and to warn on the same line,
 * as an admitted `sorry!` would where the exercise allows it, so the line has
 * a problem on each field.
 */

const MESSAGE =
  "the statement and cited premises could not be matched against this rule";
const WARNING = "admitted without proof";

await mockProofCompiler((mm0: string, proof: string) => {
  const at = proof.indexOf("imp_elim");
  if (at === -1) {
    return compilesFine(mm0, proof);
  }
  const spanStart = Buffer.byteLength(proof.slice(0, at));
  const span = { spanEnd: spanStart + "imp_elim".length, spanStart };
  return {
    diagnostics: [
      {
        error: "UnifyMismatch",
        message: `${MESSAGE}\nrule: imp_elim`,
        rule: "imp_elim",
        severity: "error",
        ...span,
      },
      { error: "SorryLine", message: WARNING, severity: "warning", ...span },
    ],
    ok: false,
  };
});

await import("../../src/client/components/carnap-aufbau-proof-tree-v1");

const TREE = [
  ':::aufbau-proof-tree{system="fx" id="t1" allow-sorry}',
  "Prove it.",
  "",
  "theorem t1: $ P ⊢ Q $",
  "----",
  "l1: $ P ⊢ P $ by AS []",
  "l2: $ P ⊢ Q $ by →E [l1]",
  ":::",
].join("\n");

const SHAPE = ruleShapeText(
  ruleShapeReader(MAGNUS_THEORY_SOURCE, "sequent")("imp_elim") ?? [],
);

/** Rest the mouse on `field`, and the popup it floats. */
async function hover(
  field: HTMLElement,
  popup: HTMLElement | null,
  text: string,
): Promise<void> {
  field.dispatchEvent(
    new dom.window.PointerEvent("pointerover", {
      bubbles: true,
      pointerType: "mouse",
    }),
  );
  await until(() => popup?.hidden === false && popup.textContent === text);
}

describe("a rule's shape in the tree editor", () => {
  test("the note reads as the shape; the problem line and the popup draw it", async () => {
    const mounted = mountExercise(await treeExercise(TREE));
    const root = mounted.root.querySelector<HTMLElement>(
      ".proof-tree-canvas > proof-tree > proof-proposition [role='treeitem']",
    ) as HTMLElement;
    await until(() => root.hasAttribute("aria-describedby"));

    // Read as text — what a screen reader hears on the line.
    const note = mounted.root.getElementById(
      root.getAttribute("aria-describedby") ?? "",
    );
    expect(SHAPE).toStartWith("→E: ");
    expect(note?.textContent).toBe(`${MESSAGE}\n${SHAPE}\n${WARNING}`);

    // F8 pins it under the proof, drawn.
    root.focus();
    root.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "F8",
      }),
    );
    const line = mounted.root.querySelector<HTMLElement>(".problem-line");
    expect(line?.hidden).toBe(false);
    const boxes = line?.querySelectorAll(".rule-shape-premise") ?? [];
    expect(boxes.length).toBeGreaterThan(0);
    // A copy, not the note itself: its ids stay with the original.
    expect(line?.querySelector("[id]")).toBeNull();

    // A hover floats the drawing of that field's own problem: the formula's
    // error, not the rule's warning.
    const popup = mounted.root.querySelector<HTMLElement>(".problem-popup");
    await hover(treeRootField(mounted), popup, `${MESSAGE}\n${SHAPE}`);
    expect(popup?.querySelectorAll(".rule-shape-premise").length).toBe(
      boxes.length,
    );
    expect(popup?.querySelector("[id]")).toBeNull();

    await hover(treeRootRule(mounted), popup, WARNING);
    expect(popup?.querySelector(".rule-shape")).toBeNull();
  });
});
