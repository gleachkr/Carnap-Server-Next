import { describe, expect, test } from "bun:test";
import { EditorView } from "@codemirror/view";
import {
  compileExercise,
  type MountedExercise,
  markState,
  mountExercise,
  until,
} from "./mount-exercise";
import { compilesFine, mockProofCompiler } from "./proof-compiler-mock";

/**
 * The compile pipeline the four proof widgets share
 * (`components/proof-element.ts`), driven through the linear editor: that a
 * run in flight when the proof changes is superseded rather than landed over
 * the newer text, and that a widget taken out of the page compiles nothing.
 * The verdicts themselves, and the hold-and-resubmit gate, are each widget
 * file's own tests.
 *
 * The engine's load is the one asynchronous step in a compile, so the mock's
 * loader is held open here: a compile started before the hold is exactly a
 * run in flight while the student keeps typing on a cold cache.
 */

let engineHeld: Promise<void> = Promise.resolve();
let releaseEngine: () => void = () => {};
let loads = 0;

const compile = await mockProofCompiler(compilesFine, () => {
  loads += 1;
  return engineHeld;
});

await import("../../src/client/components/carnap-aufbau-proof-v1");

const MINI = [
  ':::aufbau-mm0{name="mini"}',
  "provable sort wff;",
  "term top: wff;",
  "axiom top_i: $ top $;",
  ":::",
].join("\n");

const DOCUMENT = `${MINI}\n\n:::aufbau-proof{system="mini" id="p1"}\ntheorem goal: $ top $\n----\nl1: $ top $ by top_i []\n:::`;

function holdEngine(): void {
  engineHeld = new Promise((resolve) => {
    releaseEngine = resolve;
  });
}

function replaceBody(mounted: MountedExercise, text: string): void {
  const view = EditorView.findFromDOM(
    mounted.root.querySelector(".cm-editor") as HTMLElement,
  ) as EditorView;
  view.dispatch({
    changes: { from: 0, insert: text, to: view.state.doc.length },
  });
}

function proofsCompiled(): string[] {
  return compile.mock.calls.map(([, proof]) => proof);
}

describe("a compile in flight", () => {
  test("is superseded by an edit, and the newer text alone is compiled", async () => {
    holdEngine();
    const mounted = mountExercise(await compileExercise(DOCUMENT));
    // The starter's compile has asked for the engine and is waiting on it.
    await until(() => loads > 0);
    const before = compile.mock.calls.length;

    replaceBody(mounted, "l2: $ top $ by top_i []");
    expect(markState(mounted)).toBe("working");
    releaseEngine();

    // The held run comes back to find itself stale and compiles nothing; the
    // edit's own run, once its debounce fires, compiles the new body.
    await until(() => compile.mock.calls.length > before);
    await until(() => markState(mounted) === "ok");
    expect(proofsCompiled().slice(before)).toEqual([
      "goal\n----\nl2: $ top $ by top_i []",
    ]);
    expect(JSON.parse(mounted.answerData.value)).toEqual({
      mmb: "AQID",
      proofText: "goal\n----\nl2: $ top $ by top_i []",
    });
  });
});

describe("a widget taken out of the page", () => {
  test("does not run the compile it had pending", async () => {
    const mounted = mountExercise(await compileExercise(DOCUMENT));
    await until(() => markState(mounted) === "ok");
    const before = compile.mock.calls.length;

    replaceBody(mounted, "l2: $ top $ by top_i []");
    mounted.form.remove();
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(compile.mock.calls.length).toBe(before);
  });
});
