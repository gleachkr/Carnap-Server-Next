import { describe, expect, test } from "bun:test";

import {
  CORRECTNESS_MARK_CLASS,
  CORRECTNESS_MARK_GLYPHS,
  CORRECTNESS_MARK_LABEL_ATTRIBUTES,
  type CorrectnessMarkState,
} from "../src/worker/exercises/correctness-mark";
import { dom } from "./helpers/dom";

/**
 * `CarnapExerciseElement.setMark`: the widget's side of the shared correctness
 * mark, driven straight rather than through a browser.
 *
 * Three of its four states are reachable by working an exercise, and are checked
 * that way. `error` is not: every widget that reaches it does so because the
 * WASM proof engine failed to load, which takes a broken asset to provoke — so
 * the state that carries a *specific* message is exactly the one no ordinary run
 * exercises. That is the branch this file exists for.
 *
 * The base class is browser code, hence the dynamic import after the globals are
 * in place — `extends HTMLElement` resolves at class-definition time. The window
 * is shared with every other element test; `helpers/dom` says why it has to be.
 */
const { CarnapExerciseElement } = await import(
  "../src/client/components/base"
);

/** The narrowest possible widget: it exists to have a mark to set. */
class TestMarkElement extends CarnapExerciseElement {
  protected enhance(): void {
    this.dataset.enhanced = "true";
  }

  protected getAnswer(): unknown {
    return {};
  }

  /** `setMark` is protected, and driving it is the whole point here. */
  mark(state: CorrectnessMarkState, title?: string): void {
    this.setMark(state, title);
  }
}

dom.window.customElements.define("test-mark-exercise", TestMarkElement);

/** The state names the server writes onto the mark, in a recognisable shape. */
const LABELS: Readonly<Record<CorrectnessMarkState, string>> = {
  error: "Could not check",
  idle: "Not correct yet",
  ok: "Correct",
  working: "Checking",
};

function mount(): {
  readonly element: TestMarkElement;
  readonly mark: HTMLElement;
} {
  const form = dom.window.document.createElement("form");
  const labels = Object.entries(CORRECTNESS_MARK_LABEL_ATTRIBUTES)
    .map(
      ([state, attribute]) =>
        `${attribute}="${LABELS[state as CorrectnessMarkState]}"`,
    )
    .join(" ");

  form.className = "exercise";
  form.innerHTML =
    `<input name="answerData" type="hidden">` +
    `<div class="exercise-actions"><span class="${CORRECTNESS_MARK_CLASS}"` +
    ` data-state="idle" role="img" ${labels}` +
    ` aria-label="${LABELS.idle}" title="${LABELS.idle}">` +
    `${CORRECTNESS_MARK_GLYPHS.idle}</span></div>`;
  dom.window.document.body.appendChild(form);

  const element = dom.window.document.createElement(
    "test-mark-exercise",
  ) as TestMarkElement;

  form.appendChild(element);

  return {
    element,
    mark: form.querySelector(`.${CORRECTNESS_MARK_CLASS}`) as HTMLElement,
  };
}

describe("the correctness mark a widget sets", () => {
  test("each state brings its glyph, its name and its tooltip", () => {
    const { element, mark } = mount();

    for (const state of ["ok", "idle", "error"] as const) {
      element.mark(state);

      expect(mark.dataset.state).toBe(state);
      expect(mark.textContent).toBe(CORRECTNESS_MARK_GLYPHS[state]);
      // One string per state, in both places: the tooltip a sighted reader gets
      // and the name a screen reader reads are the same claim.
      expect(mark.getAttribute("aria-label")).toBe(LABELS[state]);
      expect(mark.title).toBe(LABELS[state]);
    }
  });

  test("checking has no glyph, because the stylesheet draws a spinner", () => {
    const { element, mark } = mount();

    element.mark("working");

    expect(mark.dataset.state).toBe("working");
    expect(mark.textContent).toBe("");
    expect(mark.title).toBe(LABELS.working);
  });

  test("a specific complaint becomes the tooltip, not the name", () => {
    const { element, mark } = mount();

    element.mark("error", "Could not load the proof engine.");

    // Named for the general case, described by the particular one — which is
    // what a title beside an aria-label is for.
    expect(mark.getAttribute("aria-label")).toBe(LABELS.error);
    expect(mark.title).toBe("Could not load the proof engine.");
  });

  test("a fixed problem's message does not linger over a green check", () => {
    const { element, mark } = mount();

    element.mark("error", "Could not load the proof engine.");
    element.mark("ok");

    // The title is assigned on every call rather than only when there is
    // something to say. Left conditional, a widget that recovered would show
    // "Could not load the proof engine." on hovering its ✓.
    expect(mark.title).toBe(LABELS.ok);
  });

  test("an empty complaint falls back to the state's name", () => {
    const { element, mark } = mount();

    // The two island widgets keep one status record and pass `markTitle: ""`
    // for every state with nothing to add, so empty has to mean absent — or
    // three of the four states would lose their tooltip in those two widgets
    // and keep it in the other four.
    element.mark("ok", "");

    expect(mark.title).toBe(LABELS.ok);
  });

  test("a widget with no mark in its form does not throw", () => {
    const form = dom.window.document.createElement("form");

    form.className = "exercise";
    form.innerHTML = `<input name="answerData" type="hidden">`;
    dom.window.document.body.appendChild(form);

    const element = dom.window.document.createElement(
      "test-mark-exercise",
    ) as TestMarkElement;

    form.appendChild(element);

    // The preview path renders exercises with no form and no action bar at all,
    // and a widget must not care.
    expect(() => {
      element.mark("ok");
    }).not.toThrow();
  });
});
