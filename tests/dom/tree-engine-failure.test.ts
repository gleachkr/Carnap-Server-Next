import { describe, expect, test } from "bun:test";
import { mountExercise, typeInto, until } from "./mount-exercise";
import { mockProofCompiler } from "./proof-compiler-mock";
import { treeExercise, treeRootField, treeRootRule } from "./tree-widget";

/**
 * A compiler that throws rather than reports used to leave
 * `<carnap-aufbau-proof-tree>` blank: no diagnostic, no sentence, and a
 * spinner that had stopped for no stated reason. The linear and Fitch editors
 * put one generic sentence at the top of the body for that case; the tree
 * puts it on the root line — and, like every reason, withholds it under
 * `terse`.
 */

const ENGINE_FAILURE =
  "The proof engine couldn't read this proof — check for unexpected characters.";

const compile = await mockProofCompiler((_mm0: string, _proof: string) => {
  throw new Error("wasm trap");
});

await import("../../src/client/components/carnap-aufbau-proof-tree-v1");

const MINI = [
  ':::aufbau-mm0{name="mini"}',
  "provable sort wff;",
  "term imp (a b: wff): wff; infixr imp: $->$ prec 25;",
  "axiom mp (a b: wff): $ a $ > $ a -> b $ > $ b $;",
  ":::",
].join("\n");

const TREE = `:::aufbau-proof-tree{system="mini" id="t1"}\nProve it.\n\ntheorem goal (p: wff): $ p $\n:::`;

describe("a compiler that throws", () => {
  test("is reported on the root line", async () => {
    const mounted = mountExercise(await treeExercise(TREE, MINI));

    typeInto(treeRootRule(mounted), "mp");
    await until(() => compile.mock.calls.length > 0);
    await until(() => treeRootField(mounted).classList.contains("is-error"));

    expect(treeRootField(mounted).getAttribute("title")).toBe(ENGINE_FAILURE);
  });

  test("says nothing under terse feedback, like any other reason", async () => {
    const calls = compile.mock.calls.length;
    const mounted = mountExercise(await treeExercise(TREE, MINI), {
      options: { feedback: "terse" },
    });

    typeInto(treeRootRule(mounted), "mp");
    await until(() => compile.mock.calls.length > calls);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(treeRootField(mounted).classList.contains("is-error")).toBe(false);
  });
});
