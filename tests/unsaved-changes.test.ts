import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import { warnBeforeDiscarding } from "../src/client/unsaved-changes";
import {
  ANSWER_RECORDED_EVENT,
  UNSAVED_ANSWER_ATTRIBUTE,
} from "../src/worker/exercises/answer-events";
import { EXERCISE_RUNTIME_SCRIPT } from "../src/worker/web/assignment-scripts";

/**
 * Leaving a page with work on it should ask first — on the assignment page,
 * where an unsubmitted answer is lost, and in the revision editor, where an
 * unsaved source is.
 *
 * Both guards are `beforeunload` handlers, and neither can be observed from the
 * server render: what matters is whether the handler *cancels*. So both are
 * driven here in jsdom, against a cancelable `beforeunload` — `defaultPrevented`
 * is exactly the signal the browser reads to decide whether to prompt.
 */

/** Does a `beforeunload` on this window get cancelled? */
function warnsOnUnload(window: Window & typeof globalThis): boolean {
  const event = new window.Event("beforeunload", { cancelable: true });

  window.dispatchEvent(event);

  return event.defaultPrevented;
}

describe("the assignment page's unsaved-answer guard", () => {
  /**
   * A content document with one text exercise (whose answer is a native field,
   * rendered with whatever the server has) and one widget exercise (whose answer
   * only reaches the hidden field once its element hydrates) — the two shapes
   * the runtime has to tell apart. jsdom does not upgrade custom elements or
   * parse a declarative shadow root, so the widget's part of the contract is
   * played by hand: it writes `answerData` and announces the baseline, exactly
   * as `CarnapExerciseElement` does on connect.
   */
  function runtimeDocument(): {
    readonly textForm: HTMLFormElement;
    readonly widgetForm: HTMLFormElement;
    readonly window: Window & typeof globalThis;
  } {
    const dom = new JSDOM(
      `<!doctype html><html lang="en"><head><title>Content</title></head><body>
         <form action="/attempts/a1/submissions" class="exercise"
               data-exercise-id="text_1" method="post">
           <input name="csrfToken" type="hidden" value="csrf">
           <input name="exerciseId" type="hidden" value="text_1">
           <input name="answerData" type="hidden">
           <input name="answerKind" type="hidden" value="free-response@1">
           <input name="schemaVersion" type="hidden" value="1">
           <textarea name="text">already saved</textarea>
           <button type="submit">Submit answer</button>
           <p data-exercise-status></p>
         </form>
         <form action="/attempts/a1/submissions" class="exercise"
               data-exercise-id="widget_1" method="post">
           <input name="csrfToken" type="hidden" value="csrf">
           <input name="exerciseId" type="hidden" value="widget_1">
           <input name="answerData" type="hidden">
           <input name="answerKind" type="hidden" value="truth-table@1">
           <input name="schemaVersion" type="hidden" value="1">
           <carnap-truth-table data-exercise-id="widget_1"></carnap-truth-table>
           <button type="submit">Submit answer</button>
           <p data-exercise-status></p>
         </form>
       </body></html>`,
      { runScripts: "outside-only", url: "https://example.test/content" },
    );
    const window = dom.window as unknown as Window & typeof globalThis;

    // Run the runtime the way the document would. Not via `runScripts:
    // "dangerously"`, which needs a `vm` jsdom cannot get under Bun — eval in
    // the window is the same execution context by a door that works here.
    (window as unknown as { eval(code: string): void }).eval(
      EXERCISE_RUNTIME_SCRIPT,
    );

    const forms = window.document.querySelectorAll("form.exercise");

    return {
      textForm: forms[0] as HTMLFormElement,
      widgetForm: forms[1] as HTMLFormElement,
      window,
    };
  }

  /** The element's half of the contract: flag itself when the reader is ahead. */
  function flagUnsaved(form: HTMLFormElement, unsaved: boolean): void {
    const element = form.querySelector("[data-exercise-id]") as HTMLElement;

    element.toggleAttribute(UNSAVED_ANSWER_ATTRIBUTE, unsaved);
  }

  test("an untouched page leaves without asking", () => {
    const { window } = runtimeDocument();

    expect(warnsOnUnload(window)).toBe(false);
  });

  test("an edited text answer is warned about", () => {
    const { textForm, window } = runtimeDocument();
    const field = textForm.querySelector("textarea") as HTMLTextAreaElement;

    field.value = "a thought I have not submitted";

    expect(warnsOnUnload(window)).toBe(true);
  });

  test("a widget that flags itself unsaved is warned about", () => {
    const { widgetForm, window } = runtimeDocument();

    flagUnsaved(widgetForm, true);

    expect(warnsOnUnload(window)).toBe(true);
  });

  /**
   * The hidden field fills in on hydration and keeps changing afterwards — the
   * proof types recompile a certificate into it on a debounce. Only the element
   * can tell that from an edit, so the runtime must not second-guess it.
   */
  test("a widget's own answer field is not read as an edit", () => {
    const { widgetForm, window } = runtimeDocument();
    const field = widgetForm.querySelector(
      "input[name=answerData]",
    ) as HTMLInputElement;

    field.value = '{"mmb":"AAAA","proofText":"a"}';

    expect(warnsOnUnload(window)).toBe(false);
  });

  test("a recorded submission clears the warning", async () => {
    const { textForm, window } = runtimeDocument();
    const field = textForm.querySelector("textarea") as HTMLTextAreaElement;

    respondWith(window, {
      evaluation: { maxScore: 1, score: 1 },
      submission: {
        answerKind: "free-response@1",
        exerciseId: "text_1",
        id: "s1",
        submittedAt: "2026-08-02T00:00:00.000Z",
      },
    });

    field.value = "my answer";
    await submitAndSettle(textForm, window);

    expect(warnsOnUnload(window)).toBe(false);
  });

  test("a recorded submission tells the element it is saved", async () => {
    const { textForm, window } = runtimeDocument();
    const heard: string[] = [];

    textForm.addEventListener(ANSWER_RECORDED_EVENT, () =>
      heard.push("saved"),
    );
    respondWith(window, { submission: { submittedAt: "2026-08-02" } });
    await submitAndSettle(textForm, window);

    expect(heard).toEqual(["saved"]);
  });

  test("a checked-but-not-recorded submission tells it nothing", async () => {
    const { textForm, window } = runtimeDocument();
    const heard: string[] = [];

    textForm.addEventListener(ANSWER_RECORDED_EVENT, () =>
      heard.push("saved"),
    );
    respondWith(window, { recorded: false });
    await submitAndSettle(textForm, window);

    expect(heard).toEqual([]);
  });

  /**
   * The check-style types (truth tables, the proofs) answer a wrong attempt with
   * `recorded: false` — nothing was stored, so the work is still only in the
   * browser and leaving still loses it.
   */
  test("a checked-but-not-recorded submission still warns", async () => {
    const { textForm, window } = runtimeDocument();
    const field = textForm.querySelector("textarea") as HTMLTextAreaElement;

    respondWith(window, { recorded: false });

    field.value = "not right yet";
    await submitAndSettle(textForm, window);

    expect(warnsOnUnload(window)).toBe(true);
  });

  /**
   * jsdom implements no fetch, so the runtime's one call is stubbed with the
   * two properties it reads. Deliberately not a real Response: the point of
   * these two tests is the branch on `recorded`, not the wire format.
   */
  function respondWith(
    window: Window & typeof globalThis,
    body: unknown,
  ): void {
    (window as { fetch?: unknown }).fetch = async () => ({
      json: async () => body,
      ok: true,
    });
  }

  /** The runtime's submit handler is async; give its promise chain a turn. */
  async function submitAndSettle(
    form: HTMLFormElement,
    window: Window & typeof globalThis,
  ): Promise<void> {
    form.dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );

    for (let turn = 0; turn < 10; turn += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
});

describe("the revision editor's unsaved-source guard", () => {
  function editorDocument(): {
    readonly form: HTMLFormElement;
    readonly window: Window & typeof globalThis;
  } {
    const dom = new JSDOM(
      `<!doctype html><html lang="en"><head><title>New revision</title></head>
       <body>
         <form action="/content/i1/revisions/new" method="post">
           <input name="csrfToken" type="hidden" value="csrf">
           <input class="details-field" name="details" value="">
           <textarea data-editor-source name="sourceText">the saved source</textarea>
           <button type="submit">Create revision</button>
         </form>
       </body></html>`,
      { url: "https://example.test/content/i1/revisions/new" },
    );
    const window = dom.window as unknown as Window & typeof globalThis;
    const form = window.document.querySelector("form") as HTMLFormElement;

    warnBeforeDiscarding(form);

    return { form, window };
  }

  test("an untouched editor leaves without asking", () => {
    const { window } = editorDocument();

    expect(warnsOnUnload(window)).toBe(false);
  });

  test("an edited source is warned about", () => {
    const { form, window } = editorDocument();
    const source = form.querySelector("textarea") as HTMLTextAreaElement;

    source.value = "the saved source, plus a paragraph";

    expect(warnsOnUnload(window)).toBe(true);
  });

  /** The note travels with the save, so it is unsaved work in its own right. */
  test("a typed revision note is warned about", () => {
    const { form, window } = editorDocument();
    const details = form.querySelector("[name=details]") as HTMLInputElement;

    details.value = "fixed the second exercise";

    expect(warnsOnUnload(window)).toBe(true);
  });

  test("saving is not itself warned about", () => {
    const { form, window } = editorDocument();
    const source = form.querySelector("textarea") as HTMLTextAreaElement;

    source.value = "the saved source, plus a paragraph";
    form.dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );

    expect(warnsOnUnload(window)).toBe(false);
  });
});
