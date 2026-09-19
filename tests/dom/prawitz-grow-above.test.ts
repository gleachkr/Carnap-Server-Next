import { describe, expect, test } from "bun:test";
import { mountExercise, typeInto, until } from "./mount-exercise";
import {
  prawitzButton as button,
  prawitzExercise as exercise,
  prawitzItems as items,
  prawitzLineOf as lineOf,
  prawitzPress as press,
  prawitzRuleFieldOf as ruleFieldOf,
} from "./prawitz-widget";
import { mockProofCompiler } from "./proof-compiler-mock";

/**
 * Growing a Prawitz proof upward from an assumption. The workspace is
 * top-down by design — assumptions first, rules applied below them — so its
 * leaves are all assumptions, and *Add premise above* used to refuse every
 * one of them: on a fresh assumption `p` and `h` did nothing until a rule had
 * been applied below it. Now an unlabelled assumption grows
 * like any derived line, becoming one; a labelled assumption still refuses,
 * because the label names a discharge a derived line cannot carry.
 *
 * The compiler is mocked at the module seam, as in the tree widget's tests.
 */

await mockProofCompiler();

await import("../../src/client/components/carnap-aufbau-proof-prawitz-v1");

describe("growing a Prawitz proof above an assumption", () => {
  test("p on a fresh assumption makes it a derived line with a premise", async () => {
    const mounted = mountExercise(await exercise());
    expect(mounted.element.dataset.enhanced).toBe("true");
    // The workspace opens empty; the first line is an assumption.
    expect(items(mounted)).toHaveLength(0);
    button(mounted, "New assumption").click();
    const [only] = items(mounted);
    expect(only).toBeDefined();
    expect(
      lineOf(only as HTMLElement).classList.contains("pz-assumption"),
    ).toBe(true);
    expect(button(mounted, "Add premise above").disabled).toBe(false);
    expect(button(mounted, "Add assumption above").disabled).toBe(false);

    press(only as HTMLElement, "p");

    // The one line is now derived — a rule field beneath it — and the new
    // premise (itself derived, empty) sits above.
    expect(items(mounted)).toHaveLength(2);
    const grown = lineOf(only as HTMLElement);
    expect(grown.classList.contains("pz-assumption")).toBe(false);
    expect(ruleFieldOf(grown)).not.toBeNull();
    const premise = grown.querySelector("proof-forest > proof-tree");
    expect(premise?.classList.contains("pz-assumption")).toBe(false);

    // What is stored says the same: the root cites no assumption axiom now.
    await until(() => mounted.answerData.value.includes('"premises":[{'));
    const { tree } = JSON.parse(mounted.answerData.value) as {
      tree: { rule: string; premises: { rule: string }[] };
    };
    expect(tree.rule).toBe("");
    expect(tree.premises).toHaveLength(1);
  });

  test("h makes it a derived line with an assumption above, and undo restores it", async () => {
    const mounted = mountExercise(await exercise());
    button(mounted, "New assumption").click();
    const [only] = items(mounted);

    press(only as HTMLElement, "h");

    const grown = lineOf(only as HTMLElement);
    expect(grown.classList.contains("pz-assumption")).toBe(false);
    expect(
      grown
        .querySelector("proof-forest > proof-tree")
        ?.classList.contains("pz-assumption"),
    ).toBe(true);

    button(mounted, "Undo").click();

    expect(items(mounted)).toHaveLength(1);
    expect(
      lineOf(items(mounted)[0] as HTMLElement).classList.contains(
        "pz-assumption",
      ),
    ).toBe(true);
  });

  test("a labelled assumption still refuses to grow", async () => {
    const mounted = mountExercise(await exercise());
    button(mounted, "New assumption").click();
    const [only] = items(mounted);
    (only as HTMLElement).click();
    typeInto(
      (only as HTMLElement).querySelector(".pz-label") as HTMLElement,
      "1",
    );

    expect(button(mounted, "Add premise above").disabled).toBe(true);
    expect(button(mounted, "Add assumption above").disabled).toBe(true);

    press(only as HTMLElement, "p");
    press(only as HTMLElement, "h");

    expect(items(mounted)).toHaveLength(1);
    expect(
      lineOf(only as HTMLElement).classList.contains("pz-assumption"),
    ).toBe(true);
  });
});
