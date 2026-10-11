import { describe, expect, test } from "bun:test";
import { EditorView } from "@codemirror/view";
import {
  compileExercise,
  type MountedExercise,
  markState,
  mountExercise,
  statusText,
  submitForm,
  until,
} from "./mount-exercise";
import { mockProofCompiler } from "./proof-compiler-mock";

/**
 * Submit follows the correctness mark where only a correct answer is
 * recorded (gh #41): outside an exam, a widget that grades itself holds
 * Submit — `aria-disabled`, still focusable — until its mark is a check, and
 * a press meanwhile does nothing.
 *
 * Three widgets stand for the three cases: a truth table, whose Check button
 * writes the mark; a linear proof, whose compile writes it as it is typed;
 * and multiple choice, which cannot grade itself and so never holds Submit.
 */

const compile = await mockProofCompiler();

await import("../../src/client/components/carnap-truth-table-v1");
await import("../../src/client/components/carnap-multiple-choice-v1");
await import("../../src/client/components/carnap-aufbau-proof-v1");

/** `P -> Q` with only the connective to fill; the right column is T F T T. */
function connectiveTable(attrs = "") {
  return compileExercise(
    `::::truth-table{#tt fill="connectives" options="autoAtoms"${attrs}}\n- P -> Q\n::::`,
  );
}

function submitButton(mounted: MountedExercise): HTMLButtonElement {
  return mounted.form.querySelector(
    "button[type=submit]",
  ) as HTMLButtonElement;
}

function held(mounted: MountedExercise): boolean {
  return submitButton(mounted).getAttribute("aria-disabled") === "true";
}

function fillColumn(mounted: MountedExercise, column: string): void {
  const steps: Record<string, number> = { F: 2, T: 1 };
  const cells =
    mounted.root.querySelectorAll<HTMLButtonElement>("button.tt-cell");
  cells.forEach((cell, index) => {
    for (let step = 0; step < (steps[column[index] ?? ""] ?? 0); step += 1) {
      cell.click();
    }
  });
}

function check(mounted: MountedExercise): void {
  const button = Array.from(
    mounted.form.querySelectorAll<HTMLButtonElement>(
      ".exercise-actions button",
    ),
  ).find((candidate) => candidate.textContent === "Check");
  if (button === undefined) {
    throw new Error("no Check button");
  }
  button.click();
}

describe("a widget with a Check button", () => {
  test("holds Submit until a Check passes, and again after an edit", async () => {
    const mounted = mountExercise(await connectiveTable());

    expect(held(mounted)).toBe(true);
    expect(submitButton(mounted).disabled).toBe(false);

    // A press while held sends nothing, and says nothing.
    expect(submitForm(mounted).defaultPrevented).toBe(true);
    expect(statusText(mounted)).toBe("");

    fillColumn(mounted, "TFTF");
    check(mounted);
    expect(markState(mounted)).toBe("idle");
    expect(held(mounted)).toBe(true);

    // The last cell, F → blank → T, makes the column right.
    const last =
      mounted.root.querySelectorAll<HTMLButtonElement>("button.tt-cell")[3];
    last?.click();
    last?.click();
    check(mounted);
    expect(markState(mounted)).toBe("ok");
    expect(held(mounted)).toBe(false);
    expect(submitForm(mounted).defaultPrevented).toBe(false);

    // An edit withdraws the check, and Submit with it.
    last?.click();
    expect(markState(mounted)).toBe("idle");
    expect(held(mounted)).toBe(true);
  });

  test("starts released when the recorded answer was correct", async () => {
    const mounted = mountExercise(await connectiveTable(), { mark: "ok" });

    expect(markState(mounted)).toBe("ok");
    expect(held(mounted)).toBe(false);
  });

  test("does not hold Submit on an exam, where a wrong answer is kept", async () => {
    const mounted = mountExercise(await connectiveTable(), {
      options: { exam: true, feedback: "full" },
    });

    expect(held(mounted)).toBe(false);
    expect(submitForm(mounted).defaultPrevented).toBe(false);
  });

  test('does not hold Submit under feedback="none", where the mark stays silent', async () => {
    const mounted = mountExercise(await connectiveTable(), {
      options: { exam: false, feedback: "none" },
    });

    expect(held(mounted)).toBe(false);
    expect(submitForm(mounted).defaultPrevented).toBe(false);
  });

  test("does not hold Submit where the author turned Check off", async () => {
    const mounted = mountExercise(await connectiveTable(' check="off"'));

    expect(held(mounted)).toBe(false);
  });
});

describe("a widget that cannot grade itself", () => {
  test("multiple choice never holds Submit", async () => {
    const mounted = mountExercise(
      await compileExercise(
        "::::multiple-choice{#q1}\nChoose yes.\n\n- [x] yes | Yes\n- [ ] no | No\n::::",
      ),
    );

    expect(held(mounted)).toBe(false);
    expect(submitForm(mounted).defaultPrevented).toBe(false);
  });
});

describe("a proof, checked as it is typed", () => {
  const MINI = [
    ':::aufbau-mm0{name="mini"}',
    "provable sort wff;",
    "term top: wff;",
    "axiom top_i: $ top $;",
    ":::",
  ].join("\n");
  const PROOF = `${MINI}\n\n:::aufbau-proof{system="mini" id="p1"}\ntheorem goal: $ top $\n----\nl1: $ top $ by top_i []\n:::`;

  function replaceBody(mounted: MountedExercise, text: string): void {
    const view = EditorView.findFromDOM(
      mounted.root.querySelector(".cm-editor") as HTMLElement,
    );
    if (view === null) {
      throw new Error("no editor");
    }
    view.dispatch({
      changes: { from: 0, insert: text, to: view.state.doc.length },
    });
  }

  test("releases Submit on a check, and keeps it through a recompile", async () => {
    const mounted = mountExercise(await compileExercise(PROOF));

    await until(() => markState(mounted) === "ok");
    expect(held(mounted)).toBe(false);

    // The edit puts the mark to `working`; Submit stays as it was rather than
    // flickering on every keystroke.
    compile.mockImplementationOnce(() => ({ diagnostics: [], ok: false }));
    const calls = compile.mock.calls.length;
    replaceBody(mounted, "l1: $ top $ by top_i [#1]");
    expect(markState(mounted)).toBe("working");
    expect(held(mounted)).toBe(false);

    await until(() => compile.mock.calls.length > calls);
    await until(() => markState(mounted) === "idle");
    expect(held(mounted)).toBe(true);
  });

  test("a press while the check runs waits for it, and is refused if it fails", async () => {
    const mounted = mountExercise(await compileExercise(PROOF));
    await until(() => markState(mounted) === "ok");

    // What reaches the runtime: a submit event nothing cancelled.
    let sent = 0;
    mounted.form.addEventListener("submit", (event) => {
      if (!event.defaultPrevented) {
        sent += 1;
      }
      event.preventDefault();
    });

    compile.mockImplementationOnce(() => ({ diagnostics: [], ok: false }));
    replaceBody(mounted, "l1: $ top $ by top_i [#1]");

    // Submit is still released, so the press is the proof widget's to hold
    // until the compile is in; the resubmit then meets the failed check.
    expect(submitForm(mounted).defaultPrevented).toBe(true);
    await until(() => markState(mounted) === "idle");
    // The resubmit after the compile is a separate turn of the loop.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toBe(0);

    // Fixed, the next press goes.
    replaceBody(mounted, "l1: $ top $ by top_i []");
    submitForm(mounted);
    await until(() => sent === 1);
    expect(markState(mounted)).toBe("ok");
  });
});
