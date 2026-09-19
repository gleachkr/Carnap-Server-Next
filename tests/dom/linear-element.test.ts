import { describe, expect, test } from "bun:test";
import { diagnosticCount, forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import {
  compileExercise,
  type MountedExercise,
  markState,
  mountExercise,
  until,
} from "./mount-exercise";
import { mockProofCompiler } from "./proof-compiler-mock";

/**
 * `<carnap-aufbau-proof>`, the linear editor, under jsdom: that it upgrades
 * into a CodeMirror seeded with the starter, mirrors `{proofText, mmb}` into
 * the form, compiles the assembled proof against the frozen theory, and turns
 * the verdict into the mark, the certificate, and the editor's squiggles —
 * or withholds the squiggles under terse feedback. The compiler is mocked at
 * the module seam (`./proof-compiler-mock`); what a real certificate proves
 * is `tests/aufbau-proof-verify.test.ts`'s.
 *
 * The editor is driven through CodeMirror's own API rather than keystrokes:
 * jsdom has no layout, so a `beforeinput` would reach nothing, but a
 * `dispatch` runs the same update listener a keystroke ends in.
 */

const compile = await mockProofCompiler();

await import("../../src/client/components/carnap-aufbau-proof-v1");

const MINI = [
  ':::aufbau-mm0{name="mini"}',
  "provable sort wff;",
  "term top: wff;",
  "term imp (a b: wff): wff; infixr imp: $->$ prec 25;",
  "axiom top_i: $ top $;",
  "axiom mp (a b: wff): $ a $ > $ a -> b $ > $ b $;",
  ":::",
].join("\n");

const GOAL = "theorem goal (p: wff): $ p $ > $ p $";
const STARTER = "l1: $ p $ by [#1]";

function linear(attributes = "", body = `${GOAL}\n----\n${STARTER}`): string {
  return `${MINI}\n\n:::aufbau-proof{system="mini" id="p1"${attributes}}\n${body}\n:::`;
}

function editorOf(mounted: MountedExercise): EditorView {
  const view = EditorView.findFromDOM(
    mounted.root.querySelector(".cm-editor") as HTMLElement,
  );
  if (view === null) {
    throw new Error("no editor");
  }
  return view;
}

function bodyOf(mounted: MountedExercise): string {
  return editorOf(mounted).state.doc.toString();
}

/** Replace the whole body, the way a paste would. */
function replaceBody(mounted: MountedExercise, text: string): void {
  const view = editorOf(mounted);
  view.dispatch({
    changes: { from: 0, insert: text, to: view.state.doc.length },
  });
}

function answerOf(mounted: MountedExercise): {
  mmb: string;
  proofText: string;
} {
  return JSON.parse(mounted.answerData.value) as {
    mmb: string;
    proofText: string;
  };
}

function squiggles(mounted: MountedExercise): string[] {
  const messages: string[] = [];
  forEachDiagnostic(editorOf(mounted).state, (diagnostic) => {
    messages.push(diagnostic.message);
  });
  return messages;
}

function goalRow(mounted: MountedExercise): string {
  return mounted.root.querySelector(".proof-goal")?.textContent ?? "";
}

describe("upgrading", () => {
  test("the editor comes alive on the starter, and the proof is mirrored and compiled", async () => {
    const mounted = mountExercise(await compileExercise(linear()));

    expect(mounted.element.dataset.enhanced).toBe("true");
    expect(goalRow(mounted)).toBe("Prove goal (p: wff): $ p $ > $ p $");
    expect(bodyOf(mounted)).toBe(STARTER);
    expect(
      mounted.root.querySelector(".cm-content")?.getAttribute("aria-label"),
    ).toBe("Proof editor");
    // The text is in the form before any compile: the certificate follows.
    expect(answerOf(mounted)).toEqual({
      mmb: "",
      proofText: `goal\n----\n${STARTER}`,
    });
    expect(markState(mounted)).toBe("working");

    await until(() => markState(mounted) === "ok");

    const [mm0, proof] = compile.mock.calls.at(-1) as [string, string];
    // The frozen theory with the goal appended, and the proof under its header.
    expect(mm0).toEndWith(`${GOAL};`);
    expect(mm0).toContain("axiom mp (a b: wff)");
    expect(proof).toBe(`goal\n----\n${STARTER}`);
    expect(answerOf(mounted).mmb).toBe("AQID");
  });

  test("a prior answer's body is restored without its header", async () => {
    const mounted = mountExercise(await compileExercise(linear()), {
      priorAnswer: { mmb: "", proofText: "goal\n----\nl1: $ p $ by [#1]\n" },
    });

    expect(bodyOf(mounted)).toBe("l1: $ p $ by [#1]\n");
  });
});

describe("editing", () => {
  test("an edit drops the certificate at once and recompiles the new text", async () => {
    const mounted = mountExercise(await compileExercise(linear()));
    await until(() => markState(mounted) === "ok");
    const calls = compile.mock.calls.length;

    replaceBody(mounted, "l1: $ top $ by top_i []");

    expect(answerOf(mounted)).toEqual({
      mmb: "",
      proofText: "goal\n----\nl1: $ top $ by top_i []",
    });
    expect(markState(mounted)).toBe("working");

    await until(() => compile.mock.calls.length > calls);
    expect((compile.mock.calls.at(-1) as [string, string])[1]).toBe(
      "goal\n----\nl1: $ top $ by top_i []",
    );
    await until(() => markState(mounted) === "ok");
  });
});

describe("the verdict", () => {
  /** A compile that fails on the body's rule, with a byte span into it. */
  function failsOnRule(_mm0: string, proof: string): unknown {
    const at = proof.indexOf("by");
    return {
      diagnostics: [
        {
          error: "UnknownRule",
          message: "unknown rule",
          severity: "error",
          spanEnd: at + 2,
          spanStart: at,
        },
      ],
      ok: false,
    };
  }

  test("a diagnostic becomes a squiggle on the body, with no certificate", async () => {
    compile.mockImplementationOnce(failsOnRule);
    const mounted = mountExercise(await compileExercise(linear()));

    await until(() => squiggles(mounted).length > 0);

    expect(squiggles(mounted)).toEqual(["unknown rule"]);
    expect(markState(mounted)).toBe("idle");
    expect(answerOf(mounted).mmb).toBe("");
    // The span was into the assembled proof; on the body it lands on `by`.
    forEachDiagnostic(editorOf(mounted).state, (_diagnostic, from, to) => {
      expect(bodyOf(mounted).slice(from, to)).toBe("by");
    });
  });

  test("terse feedback withholds the squiggle, not the verdict", async () => {
    compile.mockImplementationOnce(failsOnRule);
    const calls = compile.mock.calls.length;
    const mounted = mountExercise(await compileExercise(linear()), {
      options: { feedback: "terse" },
    });

    await until(() => compile.mock.calls.length > calls);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(markState(mounted)).toBe("idle");
    expect(diagnosticCount(editorOf(mounted).state)).toBe(0);
  });

  test("a compiler that throws is reported at the top of the body", async () => {
    compile.mockImplementationOnce(() => {
      throw new Error("wasm trap");
    });
    const mounted = mountExercise(await compileExercise(linear()));

    await until(() => squiggles(mounted).length > 0);

    expect(squiggles(mounted)).toEqual([
      "The proof engine couldn't read this proof — check for unexpected characters.",
    ]);
    expect(markState(mounted)).toBe("idle");
  });
});

describe("a playground", () => {
  test("derives its goal from the last line and says what the proof proves", async () => {
    const mounted = mountExercise(
      await compileExercise(linear(" playground", "Build anything.")),
    );

    expect(goalRow(mounted)).toBe("Proves ");
    expect(bodyOf(mounted)).toBe("");
    const calls = compile.mock.calls.length;

    replaceBody(mounted, "l1: $ top $ by top_i []");

    await until(() => compile.mock.calls.length > calls);
    const [mm0, proof] = compile.mock.calls.at(-1) as [string, string];
    expect(mm0).toEndWith("theorem playground: $ top $;");
    expect(proof).toBe("playground\n----\nl1: $ top $ by top_i []");
    expect(goalRow(mounted)).toBe("Proves top");
    await until(() => answerOf(mounted).mmb === "AQID");
    expect(JSON.parse(mounted.answerData.value)).toMatchObject({
      goal: { statement: "top" },
    });
  });
});
