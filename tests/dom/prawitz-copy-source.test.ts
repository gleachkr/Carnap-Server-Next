import { describe, expect, test } from "bun:test";
import { dom } from "../helpers/dom";
import { compileExercise, mountExercise } from "./mount-exercise";
import {
  prawitzButton as button,
  prawitzItems as items,
  PRAWITZ_THEORY,
} from "./prawitz-widget";
import { mockProofCompiler } from "./proof-compiler-mock";

/**
 * The author preview's "Copy as source" on the Prawitz editor: the tree as it
 * stands, written back as the starter lines `parsePrawitzStarter` reads, so a
 * tree built in the preview can be pasted under the directive's `----`.
 */

await mockProofCompiler();

await import("../../src/client/components/carnap-aufbau-proof-prawitz-v1");

/** {@link PRAWITZ_THEORY} with an introduction rule that discharges. */
const THEORY = PRAWITZ_THEORY.replace(
  "axiom top_i",
  "axiom imp_i (g: ctx) (a b: wff): $ g , a ⊢ b $ > $ g ⊢ a → b $;\naxiom top_i",
);

const STARTER = [
  "a1: $ top ⊢ top $ by ax [] -- label:1",
  "c1: $ _ ⊢ top → top $ by imp_i [a1] -- label:1",
].join("\n");

function exercise() {
  return compileExercise(
    `${THEORY}\n\n:::aufbau-proof-prawitz{system="prop" id="z"}\nProve it.\n\ntheorem goal: $ top ⊢ top $\n----\n${STARTER}\n:::`,
  );
}

/** Click the bar's Copy as source with a clipboard and an `about:srcdoc` frame. */
async function copy(form: HTMLFormElement): Promise<string[]> {
  const copied: string[] = [];
  const globals = globalThis as Record<string, unknown>;
  const saved = { location: globals.location, navigator: globals.navigator };

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text: string) => {
          copied.push(text);
        },
      },
    },
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { href: "about:srcdoc" },
  });

  try {
    form
      .querySelector<HTMLButtonElement>(".copy-source")
      ?.dispatchEvent(new dom.window.Event("click"));
    await Promise.resolve();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
  }

  return copied;
}

describe("Copy as source on the Prawitz editor", () => {
  test("writes the tree back as the starter it was seeded from", async () => {
    const mounted = mountExercise(await exercise(), { preview: true });

    expect(await copy(mounted.form)).toEqual([
      [
        "l1: $ top ⊢ top $ by ax [] -- label:1",
        "l2: $ _ ⊢ top → top $ by imp_i [l1] -- label:1",
      ].join("\n"),
    ]);
  });

  test("is held while the forest is in pieces, and copies nothing", async () => {
    const mounted = mountExercise(await exercise(), { preview: true });
    const copySource = mounted.form.querySelector(".copy-source");
    expect(copySource?.hasAttribute("aria-disabled")).toBe(false);

    button(mounted, "New assumption").click();
    expect(items(mounted)).toHaveLength(3);
    expect(copySource?.getAttribute("aria-disabled")).toBe("true");
    expect(await copy(mounted.form)).toEqual([]);

    button(mounted, "Undo").click();
    expect(items(mounted)).toHaveLength(2);
    expect(copySource?.hasAttribute("aria-disabled")).toBe(false);
  });

  test("a student's form has no button", async () => {
    const mounted = mountExercise(await exercise());

    expect(mounted.element.dataset.enhanced).toBe("true");
    expect(mounted.form.querySelector(".copy-source")).toBeNull();
  });
});
