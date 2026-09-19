import { describe, expect, test } from "bun:test";
import { diagnosticCount, forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { FITCH_THEORY_BLOCK } from "../helpers/fitch-theory";
import {
  compileExercise,
  type MountedExercise,
  markState,
  mountExercise,
  until,
} from "./mount-exercise";
import { mockProofCompiler } from "./proof-compiler-mock";

/**
 * `<carnap-aufbau-proof-fitch>` under jsdom: that it upgrades into a
 * CodeMirror seeded with the starter's Fitch text, mirrors `{fitchText,
 * proofText, mmb}` into the form, translates the Fitch shape to the `.auf`
 * the compiler is handed, and turns the verdict into the mark and the
 * certificate. Two kinds of problem reach the editor as squiggles: the
 * translator's own (a citation of a line that does not exist — no compile
 * is run for those) and the compiler's, mapped back from the generated line
 * onto the source line that produced it. Both are withheld under terse
 * feedback. The compiler is mocked at the module seam
 * (`./proof-compiler-mock`); that the translation compiles and verifies
 * for real is `tests/fitch-verify.test.ts`'s.
 *
 * Driven through CodeMirror's API, as `linear-element.test.ts` is.
 */

const compile = await mockProofCompiler();

await import("../../src/client/components/carnap-aufbau-proof-fitch-v1");

const GOAL = "theorem mp (a b: wff): $ (a → b) , a ⊢ b $";
const STARTER = ["a → b   :ax", "a       :ax"].join("\n");
const PROOF = `${STARTER}\nb       :imp_elim 1 2`;

function fitch(attributes = "", body = `${GOAL}\n----\n${STARTER}`): string {
  return `${FITCH_THEORY_BLOCK}\n\n:::aufbau-proof-fitch{system="prop" id="f1"${attributes}}\nProve it.\n\n${body}\n:::`;
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

function textOf(mounted: MountedExercise): string {
  return editorOf(mounted).state.doc.toString();
}

function replaceText(mounted: MountedExercise, text: string): void {
  const view = editorOf(mounted);
  view.dispatch({
    changes: { from: 0, insert: text, to: view.state.doc.length },
  });
}

interface FitchAnswer {
  readonly fitchText: string;
  readonly mmb: string;
  readonly proofText: string;
}

function answerOf(mounted: MountedExercise): FitchAnswer {
  return JSON.parse(mounted.answerData.value) as FitchAnswer;
}

/** Every squiggle as `[message, underlined text]`. */
function squiggles(mounted: MountedExercise): [string, string][] {
  const found: [string, string][] = [];
  const text = textOf(mounted);
  forEachDiagnostic(editorOf(mounted).state, (diagnostic, from, to) => {
    found.push([diagnostic.message, text.slice(from, to)]);
  });
  return found;
}

describe("upgrading", () => {
  test("the editor holds the starter, and the translated proof is mirrored and compiled", async () => {
    const mounted = mountExercise(await compileExercise(fitch()));

    expect(mounted.element.dataset.enhanced).toBe("true");
    expect(mounted.root.querySelector(".proof-goal")?.textContent).toBe(
      "Prove (a → b) , a ⊢ b",
    );
    expect(textOf(mounted)).toBe(STARTER);
    expect(
      mounted.root.querySelector(".cm-content")?.getAttribute("aria-label"),
    ).toBe("Fitch proof editor");

    // Both texts are in the form before any compile: the Fitch source the
    // student wrote, and the `.auf` it translates to, one line per line.
    const answer = answerOf(mounted);
    expect(answer.mmb).toBe("");
    expect(answer.fitchText).toBe(STARTER);
    expect(answer.proofText).toStartWith("mp\n----\n");
    expect(answer.proofText.split("\n")).toHaveLength(2 + 2);
    expect(markState(mounted)).toBe("working");

    await until(() => markState(mounted) === "ok");

    const [mm0, proof] = compile.mock.calls.at(-1) as [string, string];
    // The frozen theory with the goal in its engine form (`goalEngineDecl`),
    // which is what the certificate is verified against server-side too.
    expect(mm0).toEndWith("theorem mp (a b: wff): $ (((a → b) , a) ⊢ b) $;");
    expect(proof).toBe(answerOf(mounted).proofText);
    expect(answerOf(mounted).mmb).toBe("AQID");
  });

  test("a prior answer restores its Fitch text, not its translation", async () => {
    const mounted = mountExercise(await compileExercise(fitch()), {
      priorAnswer: { fitchText: PROOF, mmb: "", proofText: "stale" },
    });

    expect(textOf(mounted)).toBe(PROOF);
    expect(answerOf(mounted).proofText).not.toBe("stale");
  });
});

describe("editing", () => {
  test("an edit drops the certificate at once and compiles the new translation", async () => {
    const mounted = mountExercise(await compileExercise(fitch()));
    await until(() => markState(mounted) === "ok");
    const calls = compile.mock.calls.length;

    replaceText(mounted, PROOF);

    expect(answerOf(mounted).mmb).toBe("");
    expect(answerOf(mounted).fitchText).toBe(PROOF);
    expect(markState(mounted)).toBe("working");

    await until(() => compile.mock.calls.length > calls);
    const [, proof] = compile.mock.calls.at(-1) as [string, string];
    expect(proof.split("\n")).toHaveLength(2 + 3);
    expect(proof).toContain("imp_elim");
    await until(() => markState(mounted) === "ok");
    expect(answerOf(mounted).mmb).toBe("AQID");
  });
});

describe("the translator's own problems", () => {
  test("a citation of a line that is not there is underlined, and nothing is compiled", async () => {
    const mounted = mountExercise(await compileExercise(fitch()));
    await until(() => markState(mounted) === "ok");
    const calls = compile.mock.calls.length;

    replaceText(mounted, `${STARTER}\nb       :imp_elim 1 9`);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(squiggles(mounted)).toEqual([
      [
        "Reference “9” is not an earlier proof step.",
        "b       :imp_elim 1 9",
      ],
    ]);
    expect(markState(mounted)).toBe("idle");
    expect(answerOf(mounted).mmb).toBe("");
    expect(compile.mock.calls.length).toBe(calls);
  });

  test("terse feedback withholds the underline", async () => {
    const mounted = mountExercise(await compileExercise(fitch()), {
      options: { feedback: "terse" },
    });
    await until(() => markState(mounted) === "ok");

    replaceText(mounted, `${STARTER}\nb       :imp_elim 1 9`);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(markState(mounted)).toBe("idle");
    expect(diagnosticCount(editorOf(mounted).state)).toBe(0);
  });
});

describe("the compiler's verdict", () => {
  /** A compile that fails on the generated proof's last line. */
  function failsOnLastLine(_mm0: string, proof: string): unknown {
    const at = proof.lastIndexOf("\n") + 1;
    return {
      diagnostics: [
        {
          error: "TypeError",
          message: "the rule does not apply",
          severity: "error",
          spanEnd: Buffer.byteLength(proof),
          spanStart: Buffer.byteLength(proof.slice(0, at)),
        },
      ],
      ok: false,
    };
  }

  test("a diagnostic on a generated line underlines the source line that made it", async () => {
    compile.mockImplementationOnce(failsOnLastLine);
    const mounted = mountExercise(await compileExercise(fitch()));

    await until(() => squiggles(mounted).length > 0);

    expect(squiggles(mounted)).toEqual([
      ["the rule does not apply", "a       :ax"],
    ]);
    expect(markState(mounted)).toBe("idle");
    expect(answerOf(mounted).mmb).toBe("");
  });

  test("terse feedback withholds the underline, not the verdict", async () => {
    compile.mockImplementationOnce(failsOnLastLine);
    const calls = compile.mock.calls.length;
    const mounted = mountExercise(await compileExercise(fitch()), {
      options: { feedback: "terse" },
    });

    await until(() => compile.mock.calls.length > calls);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(markState(mounted)).toBe("idle");
    expect(diagnosticCount(editorOf(mounted).state)).toBe(0);
  });

  test("a compiler that throws is reported at the top of the text", async () => {
    compile.mockImplementationOnce(() => {
      throw new Error("wasm trap");
    });
    const mounted = mountExercise(await compileExercise(fitch()));

    await until(() => squiggles(mounted).length > 0);

    expect(squiggles(mounted).map(([message]) => message)).toEqual([
      "The proof engine couldn't read this proof — check for unexpected characters.",
    ]);
    expect(markState(mounted)).toBe("idle");
  });
});
