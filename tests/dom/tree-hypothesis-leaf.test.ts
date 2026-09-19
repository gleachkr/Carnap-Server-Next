import { describe, expect, test } from "bun:test";
import { dom } from "../helpers/dom";
import { mockProofCompiler } from "./proof-compiler-mock";
import {
  type MountedTree,
  mountTree,
  toolbarButton,
  treePublicDataFor,
  treeRootField,
  until,
} from "./tree-widget";

/**
 * A hypothesis leaf in `<carnap-aufbau-proof-tree>` is a citation of one of
 * the goal's hypotheses, and looks like one: its text is the cited hypothesis
 * as the goal declares it, fixed rather than typed; its inference slot picks
 * which — a select where the goal offers a choice, a bare `#1` where it does
 * not; and the control that makes one is disabled where the goal declares
 * none. Before this, the leaf was seeded with a copy of the line below it and
 * a `#1` the student was to retype, over goals that mostly had no `#1`.
 *
 * The compiler is mocked at the module seam, as in `playground-tree.test.ts`;
 * that `#n` flattens and verifies is `tests/tree-proof-flatten.test.ts`'s.
 */

const compile = await mockProofCompiler();

await import("../../src/client/components/carnap-aufbau-proof-tree-v1");

/** A propositional theory whose goals can carry `>`-chain hypotheses. */
const MINI = [
  ':::aufbau-mm0{name="mini"}',
  "provable sort wff;",
  "term imp (a b: wff): wff; infixr imp: $->$ prec 25;",
  "axiom mp (a b: wff): $ a $ > $ a -> b $ > $ b $;",
  ":::",
].join("\n");

function tree(goal: string, starter = ""): string {
  return `:::aufbau-proof-tree{system="mini" id="t1"}\nProve it.\n\n${goal}${starter.length === 0 ? "" : `\n----\n${starter}`}\n:::`;
}

function leaves(mounted: MountedTree): HTMLElement[] {
  return Array.from(
    mounted.root.querySelectorAll<HTMLElement>(".tree-hypothesis"),
  );
}

function choice(mounted: MountedTree): HTMLSelectElement | null {
  return mounted.root.querySelector<HTMLSelectElement>(
    ".tree-hypothesis-choice",
  );
}

function storedTree(mounted: MountedTree): unknown {
  return (JSON.parse(mounted.answerData.value) as { tree: unknown }).tree;
}

describe("a hypothesis leaf", () => {
  test("shows the cited hypothesis, fixed, and a select to change which", async () => {
    const mounted = mountTree(
      await treePublicDataFor(
        tree("theorem goal (p q: wff): $ p $ > $ p -> q $ > $ q $"),
        MINI,
      ),
    );
    expect(mounted.element.dataset.enhanced).toBe("true");
    expect(leaves(mounted)).toEqual([]);

    toolbarButton(mounted, "Add hypothesis").click();

    const [leaf] = leaves(mounted);
    expect(leaf?.textContent).toBe("p");
    // A citation, not a line: nothing to type, the same treatment as the goal.
    expect(leaf?.getAttribute("contenteditable")).toBeNull();
    expect(leaf?.classList.contains("tree-fixed")).toBe(true);

    const select = choice(mounted) as HTMLSelectElement;
    expect(select.value).toBe("1");
    expect(
      Array.from(select.options).map((option) => option.textContent),
    ).toEqual(["#1 p", "#2 p -> q"]);
    expect(select.getAttribute("aria-label")).toBe("Cited hypothesis");

    select.value = "2";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    expect(leaves(mounted)[0]?.textContent).toBe("p -> q");
    await until(() => mounted.answerData.value.includes('"hyp":2'));
    expect(storedTree(mounted)).toMatchObject({
      premises: [{ formula: "p -> q", hyp: 2 }],
    });
    // What the compiler is handed cites the hypothesis, not the text.
    await until(() =>
      compile.mock.calls.some(([, proof]) => proof.includes("[#2]")),
    );
  });

  test("over a goal with one hypothesis the citation is a label, not a control", async () => {
    const mounted = mountTree(
      await treePublicDataFor(
        tree("theorem goal (p: wff): $ p $ > $ p $"),
        MINI,
      ),
    );

    toolbarButton(mounted, "Add hypothesis").click();

    expect(leaves(mounted)[0]?.textContent).toBe("p");
    expect(choice(mounted)).toBeNull();
    expect(
      mounted.root.querySelector(".tree-hypothesis-ref")?.textContent,
    ).toBe("#1");
  });

  test("a goal that declares no hypotheses offers none to add", async () => {
    const mounted = mountTree(
      await treePublicDataFor(
        ':::aufbau-proof-tree{system="fx" id="t1"}\nProve it.\n\ntheorem t {a: name}: $ Fa ⊢ Fa $\n:::',
      ),
    );

    expect(toolbarButton(mounted, "Add hypothesis").disabled).toBe(true);
    expect(toolbarButton(mounted, "Add premise").disabled).toBe(false);

    // Nor does the key: the root stays a leaf.
    const root = mounted.root.querySelector<HTMLElement>(".tree-node");
    root?.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { bubbles: true, key: "h" }),
    );
    expect(leaves(mounted)).toEqual([]);
    expect(storedTree(mounted)).toMatchObject({ premises: [] });
  });

  test("a starter's leaves show the goal's text, whatever the starter said", async () => {
    const mounted = mountTree(
      await treePublicDataFor(
        tree(
          "theorem goal (p q: wff): $ p $ > $ p -> q $ > $ q $",
          "l1: $ q $ by mp [#1, #2]",
        ),
        MINI,
      ),
    );

    expect(leaves(mounted).map((leaf) => leaf.textContent)).toEqual([
      "p",
      "p -> q",
    ]);
    expect(treeRootField(mounted).textContent).toBe("q");
  });

  test("a restored leaf citing past the goal's last hypothesis says so", async () => {
    const mounted = mountTree(
      await treePublicDataFor(
        tree("theorem goal (p q: wff): $ p $ > $ p -> q $ > $ q $"),
        MINI,
      ),
      {
        proofText: "",
        tree: {
          formula: "q",
          id: "r",
          premises: [
            { formula: "stale", hyp: 3, id: "h", premises: [], rule: "" },
          ],
          rule: "mp",
        },
      },
    );

    const [leaf] = leaves(mounted);
    expect(leaf?.textContent).toBe("");
    expect(leaf?.classList.contains("is-error")).toBe(true);
    expect(leaf?.getAttribute("title")).toBe("The goal has no hypothesis #3");
    // The select still offers the goal's own, with the stale citation held
    // until one is chosen.
    const select = choice(mounted) as HTMLSelectElement;
    expect(select.value).toBe("3");
    expect(select.options.length).toBe(3);
  });
});
