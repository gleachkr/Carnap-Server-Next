import { describe, expect, test } from "bun:test";
import { mockProofCompiler } from "./proof-compiler-mock";
import {
  mountTree,
  toolbarButton,
  treePublicDataFor,
  treeRootField,
  typeInto,
  until,
} from "./tree-widget";

/**
 * `<carnap-aufbau-proof-tree>` in playground mode (#305): the root is the
 * student's to write, the "Proves" line follows it, and what the compiler is
 * handed is the frozen theory *plus* the goal the root makes — the same text
 * the worker will rebuild from the answer's `goal`. The compiler is mocked at
 * the module seam; that the derived declaration compiles and verifies for
 * real is `tests/playground.test.ts`'s business.
 */

const compile = await mockProofCompiler();

await import("../../src/client/components/carnap-aufbau-proof-tree-v1");

describe("a playground tree", () => {
  test("the root is the student's to write, and the compiler gets the goal it makes", async () => {
    const mounted = mountTree(
      await treePublicDataFor(
        `:::aufbau-proof-tree{system="fx" id="t1" playground}\nBuild anything.\n:::`,
      ),
    );

    expect(mounted.element.dataset.enhanced).toBe("true");
    const field = treeRootField(mounted);
    expect(field.getAttribute("contenteditable")).toBe("true");
    expect(field.classList.contains("tree-fixed")).toBe(false);
    // A hypothesis leaf cites the goal's n-th hypothesis; a playground's has none.
    expect(toolbarButton(mounted, "Add hypothesis").disabled).toBe(true);
    // Nothing to prove yet: no compile, no goal in the answer.
    expect(compile).toHaveBeenCalledTimes(0);
    expect(JSON.parse(mounted.answerData.value)).not.toHaveProperty("goal");

    typeInto(field, "Fa ⊢ Fa");

    await until(() => compile.mock.calls.length > 0);

    const [mm0, proof] = compile.mock.calls[0] as [string, string];
    expect(mm0).toEndWith(
      "theorem playground {a: name}: $ ((F (a)) ⊢ (F (a))) $;",
    );
    expect(proof).toStartWith("playground\n----\n");
    expect(mounted.root.querySelector(".proof-goal")?.textContent).toBe(
      "Proves Fa ⊢ Fa",
    );

    await until(() => mounted.answerData.value.includes('"mmb":"AQID"'));
    expect(JSON.parse(mounted.answerData.value)).toMatchObject({
      goal: {
        binders: [{ name: "a", sort: "name" }],
        statement: "((F (a)) ⊢ (F (a)))",
      },
    });
  });

  test("an ordinary exercise keeps its fixed root and says nothing about proving", async () => {
    const mounted = mountTree(
      await treePublicDataFor(
        `:::aufbau-proof-tree{system="fx" id="t1"}\nProve it.\n\ntheorem t {a: name}: $ Fa ⊢ Fa $\n:::`,
      ),
    );

    expect(treeRootField(mounted).classList.contains("tree-fixed")).toBe(
      true,
    );
    expect(mounted.root.querySelector(".proof-goal")).toBeNull();
  });
});
