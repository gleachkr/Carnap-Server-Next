import { describe, expect, test } from "bun:test";

import {
  ANSWER_RECORDED_EVENT,
  UNSAVED_ANSWER_ATTRIBUTE,
} from "../src/worker/exercises/answer-events";
import { dom } from "./helpers/dom";

/**
 * `CarnapExerciseElement`'s side of the unsaved-work contract: an exercise
 * element flags itself while the reader's answer is ahead of the server's.
 *
 * It has to be the element that decides. The obvious alternative — the page
 * runtime diffing the form's hidden field against what arrived — cannot work,
 * because the four proof types recompile a certificate into that field on a
 * debounce, seconds after the page has settled and with nobody touching it.
 * The `derived` test below is that case, and it is a regression this file
 * exists to hold: without it, every reload of an answered proof warned.
 *
 * The base class is browser code, so a jsdom window stands in as the global one
 * — hence the dynamic import, which has to come after the globals are in place
 * for `extends HTMLElement` to resolve. The window is shared with every other
 * element test; `helpers/dom` says why it has to be.
 */
const { CarnapExerciseElement, withoutCertificate } = await import(
  "../src/client/components/base"
);

/**
 * A widget in the shape of the proof types: an answer of some reader-authored
 * text plus a certificate the engine derives from it.
 */
class TestProofElement extends CarnapExerciseElement {
  proofText = "";
  certificate = "";
  /** Set by the subclass under test to switch the override on and off. */
  static excludeCertificate = true;

  protected enhance(): void {
    this.dataset.enhanced = "true";
  }

  protected getAnswer(): unknown {
    return { mmb: this.certificate, proofText: this.proofText };
  }

  protected override authoredAnswer(): string {
    return JSON.stringify(
      TestProofElement.excludeCertificate
        ? withoutCertificate(this.getAnswer())
        : this.getAnswer(),
    );
  }

  /** Stand-in for a reader edit: change the answer, then mirror it. */
  edit(text: string): void {
    this.proofText = text;
    this.certificate = "";
    this.syncAnswer();
  }

  /** Stand-in for the engine finishing a compile nobody asked for. */
  compile(certificate: string): void {
    this.certificate = certificate;
    this.syncAnswer();
  }
}

dom.window.customElements.define("test-proof-exercise", TestProofElement);

/** A fresh form with a hydrated element in it, restoring `priorAnswer`. */
function mount(priorAnswer: unknown): {
  readonly element: TestProofElement;
  readonly form: HTMLFormElement;
} {
  const form = dom.window.document.createElement("form");

  form.className = "exercise";
  form.innerHTML = `<input name="answerData" type="hidden">`;
  dom.window.document.body.appendChild(form);

  const element = dom.window.document.createElement(
    "test-proof-exercise",
  ) as TestProofElement;

  // What the element restores before it connects — the widgets read this out of
  // their hydration payload; here it is set directly, since the payload plumbing
  // is not what these tests are about.
  if (typeof priorAnswer === "string") {
    element.proofText = priorAnswer;
  }

  form.appendChild(element);

  return { element, form: form as HTMLFormElement };
}

const isUnsaved = (element: Element): boolean =>
  element.hasAttribute(UNSAVED_ANSWER_ATTRIBUTE);

describe("an exercise element's unsaved flag", () => {
  test("a freshly connected element is not unsaved", () => {
    const { element } = mount(null);

    expect(isUnsaved(element)).toBe(false);
  });

  test("a restored prior answer is not unsaved", () => {
    const { element } = mount("l1: $ a |- a $ by ax []");

    expect(isUnsaved(element)).toBe(false);
  });

  test("an edit is unsaved", () => {
    const { element } = mount("l1: $ a |- a $ by ax []");

    element.edit("l1: $ a |- a $ by ax []\nl2: something new");

    expect(isUnsaved(element)).toBe(true);
  });

  test("an edit taken back is no longer unsaved", () => {
    const { element } = mount("the original");

    element.edit("the original, changed");
    element.edit("the original");

    expect(isUnsaved(element)).toBe(false);
  });

  test("a derived field settling after connect is not an edit", () => {
    const { element } = mount("l1: $ a |- a $ by ax []");

    // The debounced compile lands; the reader has done nothing.
    element.compile("Q01CAAEDAAA=");

    expect(isUnsaved(element)).toBe(false);
  });

  /**
   * The counterpart, so the test above is known to be testing the override and
   * not something incidental: without it, that same compile reads as an edit.
   */
  test("without the override, the derived field would read as an edit", () => {
    TestProofElement.excludeCertificate = false;

    try {
      const { element } = mount("l1: $ a |- a $ by ax []");

      element.compile("Q01CAAEDAAA=");

      expect(isUnsaved(element)).toBe(true);
    } finally {
      TestProofElement.excludeCertificate = true;
    }
  });

  test("a recorded submission clears the flag", () => {
    const { element, form } = mount("the original");

    element.edit("the original, edited");
    form.dispatchEvent(new dom.window.Event("submit"));
    form.dispatchEvent(new dom.window.CustomEvent(ANSWER_RECORDED_EVENT));

    expect(isUnsaved(element)).toBe(false);
  });

  /**
   * What gets recorded is the answer as it stood when the submit began. An edit
   * made while the request was in flight is still unsaved when it lands.
   */
  test("an edit made during the submit survives the recording", () => {
    const { element, form } = mount("the original");

    element.edit("the submitted version");
    form.dispatchEvent(new dom.window.Event("submit"));
    element.edit("a further thought, typed while waiting");
    form.dispatchEvent(new dom.window.CustomEvent(ANSWER_RECORDED_EVENT));

    expect(isUnsaved(element)).toBe(true);
  });
});

describe("withoutCertificate", () => {
  test("drops mmb and keeps everything else", () => {
    expect(
      withoutCertificate({ mmb: "AAAA", proofText: "p", tree: { id: "n1" } }),
    ).toEqual({ proofText: "p", tree: { id: "n1" } });
  });

  test("leaves an answer that has no certificate alone", () => {
    expect(withoutCertificate({ cells: ["T"] })).toEqual({ cells: ["T"] });
  });
});
