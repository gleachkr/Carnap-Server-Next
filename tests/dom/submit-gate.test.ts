import { describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";

import { EXERCISE_RUNTIME_SCRIPT } from "../../src/worker/web/assignment-scripts";

/**
 * The exercise runtime's side of a widget's submit gate.
 *
 * The runtime replaces native submission with a `fetch`, from a bubbling
 * listener it registers before any element has upgraded. A widget that will not
 * submit yet (`CarnapExerciseElement.gateSubmit`) cancels the event from a
 * capturing listener, which the target runs first — and the runtime has to
 * honour that cancel the way the browser would have, or the request goes out
 * with a refusal painted under it.
 */
function pageWithRuntime(): {
  readonly fetch: ReturnType<typeof mock>;
  readonly form: HTMLFormElement;
  readonly window: Window & typeof globalThis;
} {
  const dom = new JSDOM(
    `<!doctype html><html lang="en"><head><title>Content</title></head><body>
       <form action="/attempts/a1/submissions" class="exercise-submission"
             data-exercise-id="q1" method="post">
         <input name="csrfToken" type="hidden" value="csrf">
         <input name="exerciseId" type="hidden" value="q1">
         <input name="answerData" type="hidden" value='{"text":"P"}'>
         <input name="answerKind" type="hidden" value="translation@1">
         <input name="schemaVersion" type="hidden" value="1">
         <button type="submit">Submit answer</button>
         <p data-exercise-status></p>
       </form>
     </body></html>`,
    { runScripts: "outside-only", url: "https://example.test/content" },
  );
  const window = dom.window as unknown as Window & typeof globalThis;
  const fetch = mock(async () => ({
    json: async () => ({ recorded: false }),
    ok: true,
  }));

  (window as unknown as { fetch: unknown }).fetch = fetch;
  (window as unknown as { eval(code: string): void }).eval(
    EXERCISE_RUNTIME_SCRIPT,
  );

  return {
    fetch,
    form: window.document.querySelector("form") as HTMLFormElement,
    window,
  };
}

function submit(
  form: HTMLFormElement,
  window: Window & typeof globalThis,
): Event {
  const event = new window.Event("submit", {
    bubbles: true,
    cancelable: true,
  });

  form.dispatchEvent(event);

  return event;
}

describe("the runtime and a widget's submit gate", () => {
  test("a submit nobody cancelled becomes the request", async () => {
    const page = pageWithRuntime();

    submit(page.form, page.window);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(page.fetch).toHaveBeenCalledTimes(1);
  });

  test("a submit a capturing gate cancelled sends nothing", async () => {
    const page = pageWithRuntime();

    // Registered *after* the runtime, as an upgrading element's would be: the
    // capture phase is what puts it first.
    page.form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
      },
      { capture: true },
    );

    const status = page.form.querySelector("[data-exercise-status]");
    const before = status?.textContent;
    const event = submit(page.form, page.window);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(event.defaultPrevented).toBe(true);
    expect(page.fetch).not.toHaveBeenCalled();
    // Not even "Submitting…": nothing was submitted.
    expect(status?.textContent).toBe(before);
  });
});
