import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  ANSWER_RECORDED_EVENT,
  UNSAVED_ANSWER_ATTRIBUTE,
} from "../../src/worker/exercises/answer-events";
import { EXERCISE_HYDRATION_VERSION } from "../../src/worker/exercises/hydration";
import { adoptShadowRoots, dom, domDocument } from "../helpers/dom";

/**
 * The base class's local drafts: unsaved work mirrored into localStorage on
 * every edit, restored on the next connect, cleared once a submission is
 * recorded. This is base behaviour with no widget code in it, so the element
 * under test is a minimal probe rather than a real exercise type — a real one
 * would test its own rendering on top and this file is not about that.
 */

// After `helpers/dom` has installed the globals, so `extends HTMLElement`
// resolves in the shared window (see the helper's header).
const { CarnapExerciseElement, register } = await import(
  "../../src/client/components/base"
);

class DraftProbe extends CarnapExerciseElement {
  text = "";

  protected enhance(): void {
    const prior = this.priorAnswer as { text?: unknown } | null;

    if (prior !== null && typeof prior?.text === "string") {
      this.text = prior.text;
    }

    this.dataset.enhanced = "true";
  }

  protected getAnswer(): unknown {
    return { text: this.text };
  }

  /** An edit, the way every widget reports one: mutate, then syncAnswer. */
  type(value: string): void {
    this.text = value;
    this.syncAnswer();
  }
}

register("draft-probe", DraftProbe);

/** The structural slice the base reads; a Map wearing localStorage's names. */
class MemoryStorage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const storage = new MemoryStorage();

(globalThis as { localStorage?: unknown }).localStorage = storage;

afterAll(() => {
  // The dom-test files share one process and one set of globals; later files
  // must find them the way they were.
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

beforeEach(() => {
  storage.clear();
});

const ACTION = "/courses/c1/assignments/a1/attempts/at1/submissions";

function keyFor(exerciseId: string): string {
  return `carnap:draft:${ACTION}#${exerciseId}`;
}

function mount(
  exerciseId: string,
  options: {
    readonly mode?: string;
    readonly priorAnswer?: unknown;
  } = {},
): { element: DraftProbe; form: HTMLFormElement } {
  const hydration = {
    mode: options.mode ?? "answer",
    options: {},
    priorAnswer: options.priorAnswer ?? null,
    publicData: null,
    strings: {},
    version: EXERCISE_HYDRATION_VERSION,
  };
  const form = domDocument.createElement("form");

  form.className = "exercise-submission";
  form.setAttribute("action", ACTION);
  form.dataset.exerciseId = exerciseId;
  form.innerHTML =
    `<input name="answerData" type="hidden">` +
    `<script data-exercise-hydration type="application/json">${JSON.stringify(hydration)}</script>` +
    `<draft-probe></draft-probe>`;
  domDocument.body.append(form);

  return {
    element: form.querySelector("draft-probe") as DraftProbe,
    form,
  };
}

function recordAnswer(form: HTMLFormElement): void {
  form.dispatchEvent(new dom.window.CustomEvent(ANSWER_RECORDED_EVENT));
}

function draftAuthored(exerciseId: string): string | null {
  const text = storage.getItem(keyFor(exerciseId));

  if (text === null) {
    return null;
  }

  return (JSON.parse(text) as { authored: string }).authored;
}

describe("housekeeping", () => {
  // First in the file by necessity: the sweep runs once per bundle load, and
  // any earlier mount would spend it on an empty store.
  test("drafts past the age bound are swept when an exercise connects", () => {
    const monthAndMoreAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const fresh = JSON.stringify({
      authored: JSON.stringify({ text: "kept" }),
      saved: JSON.stringify({ text: "" }),
      savedAt: Date.now(),
      version: 1,
    });

    storage.setItem(
      "carnap:draft:/courses/old/attempts/x/submissions#q9",
      JSON.stringify({
        authored: JSON.stringify({ text: "gone" }),
        saved: JSON.stringify({ text: "" }),
        savedAt: monthAndMoreAgo,
        version: 1,
      }),
    );
    storage.setItem(
      "carnap:draft:/courses/new/attempts/y/submissions#q8",
      fresh,
    );
    storage.setItem("someone-elses-key", "left alone");

    mount("q-sweep");

    expect(
      storage.getItem("carnap:draft:/courses/old/attempts/x/submissions#q9"),
    ).toBeNull();
    expect(
      storage.getItem("carnap:draft:/courses/new/attempts/y/submissions#q8"),
    ).toBe(fresh);
    expect(storage.getItem("someone-elses-key")).toBe("left alone");
  });
});

describe("writing and clearing", () => {
  test("an edit writes a draft and a recorded submission removes it", () => {
    const { element, form } = mount("q-write");

    expect(storage.getItem(keyFor("q-write"))).toBeNull();

    element.type("half a proof");

    expect(draftAuthored("q-write")).toBe(
      JSON.stringify({ text: "half a proof" }),
    );
    expect(element.hasAttribute(UNSAVED_ANSWER_ATTRIBUTE)).toBe(true);

    recordAnswer(form);

    expect(storage.getItem(keyFor("q-write"))).toBeNull();
    expect(element.hasAttribute(UNSAVED_ANSWER_ATTRIBUTE)).toBe(false);
  });

  test("editing back to the recorded state removes the draft too", () => {
    const { element } = mount("q-revert", {
      priorAnswer: { text: "recorded" },
    });

    element.type("something else");

    expect(draftAuthored("q-revert")).not.toBeNull();

    element.type("recorded");

    expect(storage.getItem(keyFor("q-revert"))).toBeNull();
    expect(element.hasAttribute(UNSAVED_ANSWER_ATTRIBUTE)).toBe(false);
  });

  test("connecting a pristine exercise writes nothing", () => {
    mount("q-pristine", { priorAnswer: { text: "recorded" } });

    expect(storage.length).toBe(0);
  });
});

describe("restoring", () => {
  test("a surviving draft is rendered, flagged unsaved, and mirrored", () => {
    const first = mount("q-crash");

    first.element.type("interrupted work");
    first.form.remove();

    const second = mount("q-crash");
    const answerData = second.form.querySelector(
      'input[name="answerData"]',
    ) as HTMLInputElement;

    expect(second.element.text).toBe("interrupted work");
    expect(answerData.value).toBe(
      JSON.stringify({ text: "interrupted work" }),
    );
    // The render is ahead of the server, so the flag (and with it the
    // beforeunload guard) comes up already set.
    expect(second.element.hasAttribute(UNSAVED_ANSWER_ATTRIBUTE)).toBe(true);

    // The baseline is what the server held when the draft was written: typing
    // back to it is not unsaved work, and clears the draft.
    second.element.type("");

    expect(second.element.hasAttribute(UNSAVED_ANSWER_ATTRIBUTE)).toBe(false);
    expect(storage.getItem(keyFor("q-crash"))).toBeNull();
  });

  test("a draft identical to the server state is dropped, not restored", () => {
    const saved = JSON.stringify({ text: "same" });

    storage.setItem(
      keyFor("q-same"),
      JSON.stringify({
        authored: saved,
        saved,
        savedAt: Date.now(),
        version: 1,
      }),
    );

    const { element } = mount("q-same", { priorAnswer: { text: "same" } });

    expect(element.text).toBe("same");
    expect(element.hasAttribute(UNSAVED_ANSWER_ATTRIBUTE)).toBe(false);
    expect(storage.getItem(keyFor("q-same"))).toBeNull();
  });

  test("a corrupted record is removed instead of restored", () => {
    storage.setItem(keyFor("q-corrupt"), "not even json");

    const { element } = mount("q-corrupt", {
      priorAnswer: { text: "recorded" },
    });

    expect(element.text).toBe("recorded");
    expect(storage.getItem(keyFor("q-corrupt"))).toBeNull();
  });
});

describe("when drafts are off", () => {
  test("review mode neither restores nor writes", () => {
    const authored = JSON.stringify({ text: "someone's work" });

    storage.setItem(
      keyFor("q-review"),
      JSON.stringify({
        authored,
        saved: JSON.stringify({ text: "" }),
        savedAt: Date.now(),
        version: 1,
      }),
    );

    const { element } = mount("q-review", { mode: "review" });

    element.type("reviewer scribble");

    expect(element.text).toBe("reviewer scribble");
    // Untouched either way: not consumed, not overwritten.
    expect(draftAuthored("q-review")).toBe(authored);
  });

  test("a formless element (a preview) keeps no drafts", () => {
    const element = domDocument.createElement("draft-probe") as DraftProbe;

    domDocument.body.append(element);
    element.type("scratch work");

    expect(storage.length).toBe(0);
  });
});

describe("a real widget", () => {
  test("multiple-choice drafts and restores with no code of its own", async () => {
    await import("../../src/client/components/carnap-multiple-choice-v1");

    const { i18nFor } = await import("../../src/worker/i18n");
    const { renderMultipleChoiceElement } = await import(
      "../../src/worker/exercises/multiple-choice/read-only-view"
    );
    const publicData = {
      mode: "single" as const,
      options: [
        { html: "A", id: "a" },
        { html: "B", id: "b" },
      ],
      promptHtml: "<p>Pick one</p>",
    };

    function mountChoice(): {
      element: HTMLElement;
      form: HTMLFormElement;
      option: (id: string) => HTMLInputElement;
    } {
      const hydration = {
        mode: "answer",
        options: {},
        priorAnswer: null,
        publicData,
        strings: {},
        version: EXERCISE_HYDRATION_VERSION,
      };
      const form = domDocument.createElement("form");

      form.className = "exercise-submission";
      form.setAttribute("action", ACTION);
      form.dataset.exerciseId = "mc1";
      form.innerHTML =
        `<input name="answerData" type="hidden">` +
        `<script data-exercise-hydration type="application/json">${JSON.stringify(hydration)}</script>` +
        renderMultipleChoiceElement(publicData, {
          component: "carnap-multiple-choice",
          componentVersion: "1",
          exerciseId: "mc1",
          exerciseKind: "multiple-choice@1",
          i18n: i18nFor("en"),
          title: null,
        });
      adoptShadowRoots(form);
      domDocument.body.append(form);

      const element = form.querySelector(
        "carnap-multiple-choice",
      ) as HTMLElement;

      return {
        element,
        form,
        option: (id: string) =>
          element.shadowRoot?.querySelector(
            `input[value="${id}"]`,
          ) as HTMLInputElement,
      };
    }

    // Pick an option, then lose the page without submitting.
    const first = mountChoice();
    const optionB = first.option("b");

    optionB.checked = true;
    optionB.dispatchEvent(new dom.window.Event("change"));

    expect(draftAuthored("mc1")).toBe(
      JSON.stringify({ selectedOptionIds: ["b"] }),
    );

    first.form.remove();

    // The next visit gets the selection back, flagged as unsaved work.
    const second = mountChoice();

    expect(second.option("b").checked).toBe(true);
    expect(second.element.hasAttribute(UNSAVED_ANSWER_ATTRIBUTE)).toBe(true);

    recordAnswer(second.form);

    expect(storage.getItem(keyFor("mc1"))).toBeNull();
    expect(second.element.hasAttribute(UNSAVED_ANSWER_ATTRIBUTE)).toBe(false);
  });
});
