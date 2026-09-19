import { describe, expect, mock, test } from "bun:test";
import type { TranslationSubmission } from "../../src/worker/exercises/translation/types";
import { dom } from "../helpers/dom";
import {
  compileExercise,
  type ExerciseFixture,
  type MountedExercise,
  type MountOptions,
  markState,
  mountExercise,
  statusText,
  until,
} from "./mount-exercise";
import { mockProofCompiler } from "./proof-compiler-mock";

/**
 * `<carnap-translation>`'s side of the widget: the live preview, the answer
 * mirror, the check pipeline, and the feedback gates. The engines are mocked
 * at their module seams — `proof-search` (the LSP worker) and
 * `proof-compiler` (the wasm) — because what runs here is the *widget's*
 * choreography; the real search/compile/verify loop has its own battery in
 * `tests/translation-engine.test.ts`.
 */

let searchResult: (() => Promise<string | null>) | null = null;
const findEquivalenceProof = mock(async () => {
  if (searchResult === null) {
    throw new Error("unexpected search");
  }
  return searchResult();
});

mock.module("../../src/client/proof-search", () => ({
  findEquivalenceProof,
}));

await mockProofCompiler();

// After `helpers/dom` has installed the globals, so `extends HTMLElement`
// resolves and `register` lands in the window the fixtures are built in.
await import("../../src/client/components/carnap-translation-v1");

function translationExercise(body: string, attrs = "#t1") {
  return compileExercise(`::::translation{${attrs}}\n${body}\n::::`);
}

interface Mounted extends MountedExercise {
  readonly input: HTMLInputElement;
}

function mount(
  fixture: ExerciseFixture,
  options: MountOptions = {},
): Mounted {
  const mounted = mountExercise(fixture, options);
  return {
    ...mounted,
    input: mounted.root.querySelector(
      'input[data-role="text"]',
    ) as HTMLInputElement,
  };
}

function type(mounted: Mounted, value: string): void {
  mounted.input.value = value;
  mounted.input.dispatchEvent(
    new dom.window.Event("input", { bubbles: true }),
  );
}

/** Enter, the explicit check — and never a form submission. */
function pressEnter(mounted: Mounted): void {
  mounted.input.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
  );
}

function answerOf(mounted: Mounted): TranslationSubmission {
  return JSON.parse(mounted.answerData.value) as TranslationSubmission;
}

function previewText(mounted: Mounted): string {
  return (
    mounted.root.querySelector<HTMLElement>('p[data-role="preview"]')
      ?.textContent ?? ""
  );
}

const PROP = "People danced and sang.\n\n- P/\\Q";

describe("upgrading", () => {
  test("the input comes alive, prefilled from the starter", async () => {
    const mounted = mount(
      await translationExercise(PROP, '#t1 starter="P /\\ ..."'),
    );

    expect(mounted.element.dataset.enhanced).toBe("true");
    expect(mounted.input.disabled).toBe(false);
    expect(mounted.input.value).toBe("P /\\ ...");
    expect(
      mounted.root.querySelector("fieldset")?.hasAttribute("aria-busy"),
    ).toBe(false);
  });

  test("a prior answer wins over the starter and is mirrored", async () => {
    const mounted = mount(
      await translationExercise(PROP, '#t1 starter="P /\\ ..."'),
      { priorAnswer: { text: "Q/\\P" } },
    );

    expect(mounted.input.value).toBe("Q/\\P");
    expect(answerOf(mounted).text).toBe("Q/\\P");
  });
});

describe("the live preview", () => {
  test("reads well-formed ASCII back in logical symbols", async () => {
    const mounted = mount(await translationExercise(PROP));

    type(mounted, "P/\\Q");

    expect(previewText(mounted)).toBe("Reads as P ∧ Q");
  });

  test("words the parser's complaint while it does not parse", async () => {
    const mounted = mount(await translationExercise(PROP));

    type(mounted, "P /\\");

    expect(previewText(mounted)).toBe("Expected a formula.");
    expect(
      mounted.root.querySelector<HTMLElement>('p[data-role="preview"]')
        ?.dataset.mood,
    ).toBe("error");
  });
});

describe("checking", () => {
  test("a verbatim solution goes green with no engine at all", async () => {
    searchResult = null; // any search would throw
    const mounted = mount(await translationExercise(PROP));

    type(mounted, "(P & Q)");
    pressEnter(mounted);
    await until(() => markState(mounted) === "ok");

    expect(statusText(mounted)).toBe(
      "This translation is logically equivalent to the intended answer.",
    );
    expect(answerOf(mounted)).toEqual({ text: "(P & Q)" });
  });

  test("an equivalent answer earns a certificate naming its solution", async () => {
    searchResult = async () => "expanded proof";
    const mounted = mount(await translationExercise(PROP));

    type(mounted, "Q/\\P");
    pressEnter(mounted);
    await until(() => markState(mounted) === "ok");

    expect(answerOf(mounted)).toEqual({
      mmb: "AQID",
      solutionIndex: 0,
      text: "Q/\\P",
    });
  });

  test("a refused search reads as not equivalent", async () => {
    searchResult = async () => null;
    const mounted = mount(await translationExercise(PROP));

    type(mounted, "P\\/Q");
    pressEnter(mounted);
    await until(
      () => markState(mounted) === "idle" && statusText(mounted) !== "",
    );

    expect(statusText(mounted)).toBe(
      "This translation is not equivalent to the intended answer.",
    );
    expect(answerOf(mounted)).toEqual({ text: "P\\/Q" });
  });

  test("a dead engine is a malfunction, not a verdict", async () => {
    searchResult = () => Promise.reject(new Error("worker gone"));
    const mounted = mount(await translationExercise(PROP));

    type(mounted, "Q/\\P");
    pressEnter(mounted);
    await until(() => markState(mounted) === "error");
  });

  test("the tests gate words its complaint before any search runs", async () => {
    searchResult = null;
    const mounted = mount(
      await translationExercise(PROP, '#t1 tests="maxNot:0"'),
    );

    type(mounted, "~~(P/\\Q)");
    pressEnter(mounted);

    expect(statusText(mounted)).toBe(
      "You have 2 negations, but should have 0 at most.",
    );
    expect(markState(mounted)).toBe("idle");
  });

  test("exact refuses an equivalent that is not the formula", async () => {
    searchResult = null;
    const mounted = mount(
      await translationExercise(PROP, '#t1 variant="exact"'),
    );

    type(mounted, "Q/\\P");
    pressEnter(mounted);

    expect(statusText(mounted)).toBe(
      "This does not exactly match the intended answer.",
    );
    expect(markState(mounted)).toBe("idle");
  });
});

describe("feedback", () => {
  test("terse keeps the mark and drops the sentences", async () => {
    searchResult = async () => null;
    const mounted = mount(await translationExercise(PROP), {
      options: {
        feedback: "terse",
      },
    });

    type(mounted, "P\\/Q");
    pressEnter(mounted);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(statusText(mounted)).toBe("");
    expect(markState(mounted)).toBe("idle");
  });

  test("none still computes the certificate but never goes green", async () => {
    searchResult = async () => "expanded proof";
    const mounted = mount(await translationExercise(PROP), {
      options: {
        feedback: "none",
      },
    });

    type(mounted, "Q/\\P");
    pressEnter(mounted);
    await until(() => answerOf(mounted).mmb === "AQID");

    // The submission carries the graded input; the reader is told nothing.
    expect(answerOf(mounted).solutionIndex).toBe(0);
    expect(markState(mounted)).toBe("idle");
    expect(statusText(mounted)).toBe("");
  });
});

/**
 * The page runtime's half of the submit contract, in miniature: it runs after
 * the widget's capturing gate, sends nothing if the gate cancelled, and
 * otherwise takes the answer as the form holds it at that moment. (The real
 * script is pinned against a gate in `submit-gate.test.ts`.)
 */
function recordSubmissions(mounted: Mounted): TranslationSubmission[] {
  const sent: TranslationSubmission[] = [];

  mounted.form.addEventListener("submit", (event) => {
    if (event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    sent.push(answerOf(mounted));
  });

  return sent;
}

describe("the submit hold", () => {
  test("a submit during the typing pause runs the check first", async () => {
    searchResult = async () => "expanded proof";
    const mounted = mount(await translationExercise(PROP));
    const sent = recordSubmissions(mounted);

    type(mounted, "Q/\\P");
    // Inside the debounce: no check has run, the answer is text alone.
    expect(answerOf(mounted)).toEqual({ text: "Q/\\P" });
    mounted.form.requestSubmit();

    expect(sent).toEqual([]);
    expect(markState(mounted)).toBe("working");
    await until(() => sent.length > 0);

    expect(sent).toEqual([{ mmb: "AQID", solutionIndex: 0, text: "Q/\\P" }]);
  });

  test("a submit while the search runs waits for it, and a second click is the same request", async () => {
    let release: (proof: string) => void = () => {};
    searchResult = () =>
      new Promise<string | null>((resolve) => {
        release = resolve;
      });
    const mounted = mount(await translationExercise(PROP));
    const sent = recordSubmissions(mounted);

    type(mounted, "Q/\\P");
    pressEnter(mounted);
    expect(markState(mounted)).toBe("working");

    mounted.form.requestSubmit();
    mounted.form.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual([]);

    release("expanded proof");
    await until(() => sent.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sent).toEqual([{ mmb: "AQID", solutionIndex: 0, text: "Q/\\P" }]);
  });

  test("a settled check goes straight through", async () => {
    searchResult = async () => "expanded proof";
    const mounted = mount(await translationExercise(PROP));
    const sent = recordSubmissions(mounted);

    type(mounted, "Q/\\P");
    pressEnter(mounted);
    await until(() => markState(mounted) === "ok");

    mounted.form.requestSubmit();

    expect(sent).toEqual([{ mmb: "AQID", solutionIndex: 0, text: "Q/\\P" }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(1);
  });

  test("a verbatim answer settles at once and needs no wait", async () => {
    searchResult = null;
    const mounted = mount(await translationExercise(PROP));
    const sent = recordSubmissions(mounted);

    type(mounted, "(P & Q)");
    mounted.form.requestSubmit();

    expect(sent).toEqual([{ text: "(P & Q)" }]);
    expect(markState(mounted)).toBe("ok");
  });

  test("an edit during the wait abandons the held submit", async () => {
    let release: (proof: string) => void = () => {};
    searchResult = () =>
      new Promise<string | null>((resolve) => {
        release = resolve;
      });
    const mounted = mount(await translationExercise(PROP));
    const sent = recordSubmissions(mounted);

    type(mounted, "Q/\\P");
    pressEnter(mounted);
    mounted.form.requestSubmit();
    type(mounted, "Q/\\P/\\P");
    release("expanded proof");
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Nothing left: what was asked for is not what the field holds now.
    expect(sent).toEqual([]);
  });
});

describe("the checksyntax gate", () => {
  test("refuses to submit text that does not parse, and says why", async () => {
    const mounted = mount(
      await translationExercise(PROP, '#t1 options="checksyntax"'),
    );

    type(mounted, "P /\\");
    const submit = new dom.window.Event("submit", { cancelable: true });
    mounted.form.dispatchEvent(submit);

    expect(submit.defaultPrevented).toBe(true);
    expect(statusText(mounted)).toBe(
      "This answer does not parse, so it cannot be submitted on an exam.",
    );
  });

  test("lets a parsed answer through, right or wrong", async () => {
    searchResult = async () => null;
    const mounted = mount(
      await translationExercise(PROP, '#t1 options="checksyntax"'),
    );

    type(mounted, "P\\/Q");
    // Checked and found wanting — the gate is about syntax, not the verdict.
    pressEnter(mounted);
    await until(
      () => markState(mounted) === "idle" && statusText(mounted) !== "",
    );
    const submit = new dom.window.Event("submit", { cancelable: true });
    mounted.form.dispatchEvent(submit);

    expect(submit.defaultPrevented).toBe(false);
  });
});
