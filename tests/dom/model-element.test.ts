import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../../src/worker/domain/content";
import { CORRECTNESS_MARK_CLASS } from "../../src/worker/exercises/correctness-mark";
import { EXERCISE_HYDRATION_VERSION } from "../../src/worker/exercises/hydration";
import { renderModelElement } from "../../src/worker/exercises/model/read-only-view";
import { buildModelStrings } from "../../src/worker/exercises/model/strings";
import type {
  ModelAnswerData,
  ModelPublicData,
} from "../../src/worker/exercises/model/types";
import { i18nFor } from "../../src/worker/i18n";
import { adoptShadowRoots, dom, domDocument } from "../helpers/dom";

/**
 * `<carnap-model>`'s side of the widget: that it enables the fields, keeps the
 * constant and function controls in step with the domain, warns about a field it
 * cannot read, mirrors the model into the form, and grades it locally.
 *
 * This is the one test that holds the *duplication* the design accepts: the
 * server renders each field's markup as a string and the element rebuilds two of
 * them with DOM calls, so a class or `data-` name changing on one side and not
 * the other is a real failure mode. Nothing else would catch it.
 *
 * jsdom does not implement declarative shadow DOM — `<template shadowrootmode>`
 * stays a template — so {@link mount} performs the adoption a browser's parser
 * does, then inserts the element so it upgrades with its shadow root already in
 * place. That ordering is the point: `enhance()` reads `this.shadowRoot`.
 */

// After `helpers/dom` has installed the globals, so `extends HTMLElement`
// resolves and `register` lands in the window the fixtures are built in.
await import("../../src/client/components/carnap-model-v1");

async function publicDataFor(
  body: string,
  attrs = "#m1",
): Promise<ModelPublicData> {
  const result = await compileCarnapMarkdown(
    `::::model{${attrs}}\n${body}\n::::`,
  );

  if (!result.ok) {
    throw new Error(
      `compile failed: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }

  const item = result.artifact.manifest[0] as ExerciseManifestItem;

  return item.publicData as unknown as ModelPublicData;
}

interface Mounted {
  readonly answerData: HTMLInputElement;
  readonly element: HTMLElement;
  readonly root: ShadowRoot;
}

/** Render an exercise server-side, then upgrade it the way a browser would. */
function mount(
  publicData: ModelPublicData,
  priorAnswer: ModelAnswerData | null = null,
  options: { readonly feedback?: string } = {},
): Mounted {
  const i18n = i18nFor("en");
  const actions =
    '<div class="exercise-actions" slot="exercise-actions">' +
    '<button class="exercise-submit" type="submit">Submit</button>' +
    // The shared correctness mark, abbreviated to the attributes `setMark`
    // writes through — it lives in the light-DOM bar, outside every widget's
    // shadow root, which is exactly why one widget can overwrite what another
    // part of the page put there.
    `<span class="${CORRECTNESS_MARK_CLASS}" data-state="idle"` +
    ' data-label-idle="Not correct" data-label-ok="Correct"' +
    ' data-label-error="Could not check" data-label-working="Checking">-</span>' +
    "</div>";
  const hydration = {
    mode: "answer",
    options,
    priorAnswer,
    publicData,
    strings: buildModelStrings(i18n),
    version: EXERCISE_HYDRATION_VERSION,
  };
  const html = renderModelElement(
    publicData,
    {
      component: "carnap-model",
      componentVersion: "1",
      exerciseId: "m1",
      exerciseKind: "model@1",
      i18n,
      title: null,
    },
    `${actions}<script data-exercise-hydration type="application/json">${JSON.stringify(hydration)}</script>`,
  );

  // A fresh form appended to the shared body, never a replacement of it: other
  // element tests keep their fixtures in the same document.
  const form = domDocument.createElement("form");
  form.className = "exercise";
  form.innerHTML = `<input name="answerData" type="hidden">${html}`;
  adoptShadowRoots(form);
  domDocument.body.append(form);

  const element = form.querySelector("carnap-model") as HTMLElement;

  return {
    answerData: form.querySelector(
      'input[name="answerData"]',
    ) as HTMLInputElement,
    element,
    root: element.shadowRoot as ShadowRoot,
  };
}

function rowFor(root: ShadowRoot, label: string): HTMLElement {
  const row = root.querySelector<HTMLElement>(
    `.model-row[data-field="${label}"]`,
  );

  if (row === null) {
    throw new Error(`No row for field ${label}.`);
  }

  return row;
}

function valueControl(
  root: ShadowRoot,
  label: string,
): HTMLInputElement | HTMLSelectElement {
  const control = rowFor(root, label).querySelector<
    HTMLInputElement | HTMLSelectElement
  >('[data-role="value"]');

  if (control === null) {
    throw new Error(`No control for field ${label}.`);
  }

  return control;
}

/** Type into a text field, the way an edit reaches the element. */
function type(control: HTMLInputElement | HTMLSelectElement, value: string) {
  control.value = value;
  control.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function choose(control: HTMLSelectElement, value: string) {
  control.value = value;
  control.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

function answerOf(mounted: Mounted): ModelAnswerData {
  return JSON.parse(mounted.answerData.value) as ModelAnswerData;
}

function statusText(root: ShadowRoot): string {
  return (
    root.querySelector<HTMLElement>('p[data-role="status"]')?.textContent ??
    ""
  );
}

function markState(mounted: Mounted): string {
  const mark = mounted.element
    .closest("form")
    ?.querySelector<HTMLElement>(`.${CORRECTNESS_MARK_CLASS}`);

  return mark?.dataset.state ?? "";
}

function clickCheck(mounted: Mounted): void {
  const button = mounted.element.querySelector<HTMLButtonElement>(
    "button.model-check",
  );

  if (button === null) {
    throw new Error("No Check button.");
  }

  button.click();
}

describe("upgrading", () => {
  test("the fields come alive and the busy flag goes", async () => {
    const mounted = mount(await publicDataFor("- AxF(x), G(a)"));

    expect(mounted.element.dataset.enhanced).toBe("true");
    expect(
      mounted.root.querySelector("fieldset")?.hasAttribute("aria-busy"),
    ).toBe(false);
    expect(valueControl(mounted.root, "Domain").disabled).toBe(false);
    expect(valueControl(mounted.root, "F(_)").disabled).toBe(false);
  });

  test("the answer is mirrored into the form on connect", async () => {
    const mounted = mount(await publicDataFor("- AxF(x)"));

    // Carnap seeds the domain with `0`, so an untouched exercise already has a
    // model in it — a one-element domain and an empty extension.
    expect(answerOf(mounted)).toEqual({
      domain: "0",
      fields: { "F(_)": "" },
    });
  });

  test("a locked given stays inert", async () => {
    const mounted = mount(
      await publicDataFor(
        "- AxF(x)\n| Domain : 0,1",
        '#m1 options="strictGivens"',
      ),
    );

    expect(valueControl(mounted.root, "Domain").disabled).toBe(true);
    expect(valueControl(mounted.root, "F(_)").disabled).toBe(false);
  });
});

describe("the domain drives the other fields", () => {
  test("a constant's options follow the domain", async () => {
    const mounted = mount(await publicDataFor("- F(a)"));
    const constant = valueControl(
      mounted.root,
      "a",
    ) as unknown as HTMLSelectElement;

    expect(constant.options.length).toBe(1);

    type(valueControl(mounted.root, "Domain"), "0,1,2");

    expect(Array.from(constant.options).map((o) => o.value)).toEqual([
      "0",
      "1",
      "2",
    ]);
  });

  test("a chosen constant survives a widening of the domain", async () => {
    const mounted = mount(await publicDataFor("- F(a)"));

    type(valueControl(mounted.root, "Domain"), "0,1,2");
    choose(valueControl(mounted.root, "a") as HTMLSelectElement, "2");
    type(valueControl(mounted.root, "Domain"), "0,1,2,3");

    expect(answerOf(mounted).fields.a).toBe("2");
  });

  test("a constant outside a narrowed domain falls back inside it", async () => {
    const mounted = mount(await publicDataFor("- F(a)"));

    type(valueControl(mounted.root, "Domain"), "0,1,2");
    choose(valueControl(mounted.root, "a") as HTMLSelectElement, "2");
    type(valueControl(mounted.root, "Domain"), "0,1");

    // Never a value the model could not interpret.
    expect(answerOf(mounted).fields.a).toBe("0");
  });

  test("a function gets one control per argument tuple", async () => {
    const mounted = mount(await publicDataFor("- Axf(x) = x"));
    const table = () =>
      rowFor(mounted.root, "f(_)").querySelectorAll("select[data-argument]");

    expect(table().length).toBe(1);

    type(valueControl(mounted.root, "Domain"), "0,1,2");

    expect(table().length).toBe(3);
    expect(
      Array.from(table()).map(
        (s) => (s as HTMLSelectElement).dataset.argument,
      ),
    ).toEqual(["0", "1", "2"]);
  });

  test("a binary function's table is the whole square", async () => {
    const mounted = mount(await publicDataFor("- AxAyf(x,y) = f(y,x)"));

    type(valueControl(mounted.root, "Domain"), "0,1");

    const args = Array.from(
      rowFor(mounted.root, "f(_,_)").querySelectorAll<HTMLSelectElement>(
        "select[data-argument]",
      ),
    ).map((select) => select.dataset.argument);

    expect(args).toEqual(["0,0", "0,1", "1,0", "1,1"]);
  });

  test("a function serializes to the spelling Carnap stores", async () => {
    const mounted = mount(await publicDataFor("- Axf(x) = x"));

    type(valueControl(mounted.root, "Domain"), "0,1");

    const selects = Array.from(
      rowFor(mounted.root, "f(_)").querySelectorAll<HTMLSelectElement>(
        "select[data-argument]",
      ),
    );

    choose(selects[0] as HTMLSelectElement, "1");
    choose(selects[1] as HTMLSelectElement, "0");

    // The value table is an editor over this string, not a different format —
    // which is what lets an author write the same thing in a given.
    expect(answerOf(mounted).fields["f(_)"]).toBe("[0;1],[1;0]");
  });

  test("choices already made survive a function's rebuild", async () => {
    const mounted = mount(await publicDataFor("- Axf(x) = x"));

    type(valueControl(mounted.root, "Domain"), "0,1");

    const first = rowFor(
      mounted.root,
      "f(_)",
    ).querySelector<HTMLSelectElement>('select[data-argument="0"]');

    choose(first as HTMLSelectElement, "1");
    type(valueControl(mounted.root, "Domain"), "0,1,2");

    expect(answerOf(mounted).fields["f(_)"]).toContain("[0;1]");
  });

  test("a seeded function row is what the answer carries, and survives a rebuild", async () => {
    const mounted = mount(
      await publicDataFor("- Axf(x) = x\n| Domain : 0,1\n| f(_) : [0;1]"),
    );

    // The given is the model the exercise starts from: an untouched widget
    // records it, rather than a table of first elements.
    expect(answerOf(mounted).fields["f(_)"]).toBe("[0;1],[1;0]");

    type(valueControl(mounted.root, "Domain"), "0,1,2");

    expect(answerOf(mounted).fields["f(_)"]).toBe("[0;1],[1;0],[2;0]");
  });

  test("strictGivens locks the rows a function's given names, and no others", async () => {
    const mounted = mount(
      await publicDataFor(
        "- Axf(x) = x\n| Domain : 0,1\n| f(_) : [0;1]",
        '#m2 options="strictGivens"',
      ),
    );
    const cells = () =>
      Array.from(
        rowFor(mounted.root, "f(_)").querySelectorAll<HTMLSelectElement>(
          "select[data-argument]",
        ),
      );

    expect(cells().map((select) => select.disabled)).toEqual([true, false]);

    // The lock has to survive the rebuild the domain drives, or widening the
    // domain would hand the student the row the exercise fixed.
    type(valueControl(mounted.root, "Domain"), "0,1,2");

    expect(cells().map((select) => select.disabled)).toEqual([
      true,
      false,
      false,
    ]);
    expect(cells()[0]?.value).toBe("1");
  });

  test("an unreadable domain leaves the dependent controls alone", async () => {
    const mounted = mount(await publicDataFor("- F(a)"));

    type(valueControl(mounted.root, "Domain"), "0,1,2");
    type(valueControl(mounted.root, "Domain"), "0,x");

    // Rebuilding against a domain that does not parse would empty the select.
    expect(
      (valueControl(mounted.root, "a") as unknown as HTMLSelectElement)
        .options.length,
    ).toBe(3);
  });
});

describe("warnings", () => {
  test("a field that will not read is marked, and unmarked when fixed", async () => {
    const mounted = mount(await publicDataFor("- AxF(x)"));
    const warning = () =>
      rowFor(mounted.root, "F(_)").querySelector<HTMLElement>(
        '[data-role="warning"]',
      );

    expect(warning()?.textContent).toBe("");

    type(valueControl(mounted.root, "F(_)"), "[0,1]");

    // A 2-tuple in a one-place extension.
    expect(warning()?.textContent).toBe("⚠");
    expect(warning()?.getAttribute("title")).toBe(
      "This value cannot be read.",
    );

    type(valueControl(mounted.root, "F(_)"), "0");

    expect(warning()?.textContent).toBe("");
    expect(warning()?.hasAttribute("title")).toBe(false);
  });

  test("an empty extension is not a warning", async () => {
    const mounted = mount(await publicDataFor("- AxF(x)"));

    // The empty relation is a perfectly good interpretation.
    expect(
      rowFor(mounted.root, "F(_)").querySelector<HTMLElement>(
        '[data-role="warning"]',
      )?.textContent,
    ).toBe("");
  });
});

describe("the local Check", () => {
  test("agrees with the server on a model that works", async () => {
    const mounted = mount(await publicDataFor("- AxF(x), ExG(x)"));

    type(valueControl(mounted.root, "Domain"), "0,1");
    type(valueControl(mounted.root, "F(_)"), "0,1");
    type(valueControl(mounted.root, "G(_)"), "1");
    clickCheck(mounted);

    expect(statusText(mounted.root)).toBe(
      "This model does everything the exercise asks.",
    );
    expect(
      mounted.root
        .querySelector('p[data-role="status"]')
        ?.getAttribute("data-state"),
    ).toBe("correct");
  });

  test("names the formulas that came out wrong", async () => {
    const mounted = mount(await publicDataFor("- AxF(x)"));

    type(valueControl(mounted.root, "Domain"), "0,1");
    type(valueControl(mounted.root, "F(_)"), "0");
    clickCheck(mounted);

    expect(statusText(mounted.root)).toBe(
      "Not all formulas are true in this model. Take another look at: ∀xF(x).",
    );
  });

  test("reports an unreadable model rather than judging it", async () => {
    const mounted = mount(await publicDataFor("- AxF(x)"));

    type(valueControl(mounted.root, "Domain"), "");
    clickCheck(mounted);

    expect(statusText(mounted.root)).toBe("The domain cannot be empty.");
  });

  test("an edit clears the last verdict", async () => {
    const mounted = mount(await publicDataFor("- AxF(x)"));

    clickCheck(mounted);
    expect(statusText(mounted.root)).not.toBe("");

    type(valueControl(mounted.root, "F(_)"), "0");

    expect(statusText(mounted.root)).toBe("");
  });

  test("check=off offers no button", async () => {
    const mounted = mount(await publicDataFor("- AxF(x)", '#m1 check="off"'));

    expect(mounted.element.querySelector("button.model-check")).toBeNull();
  });

  test('feedback="none" takes the button and refuses the mark', async () => {
    const answer = { domain: "0", fields: { "F(_)": "0" } };
    // A correct model, so the mark would go green if anything let it.
    const withFeedback = mount(await publicDataFor("- AxF(x)"), answer);
    const sealed = mount(await publicDataFor("- AxF(x)"), answer, {
      feedback: "none",
    });

    clickCheck(withFeedback);
    expect(markState(withFeedback)).toBe("ok");

    expect(sealed.element.querySelector("button.model-check")).toBeNull();
    expect(markState(sealed)).toBe("idle");
  });

  /**
   * The reported bug, in miniature. The server correctly withheld an exam's
   * evaluation and the widget then wrote `ok` over the same element — one mark
   * in the light DOM, and the widget touched it last. So the refusal lives in
   * the base class, where a widget cannot route around it by forgetting.
   */
  test("a widget that asks for a green check under none still does not get one", async () => {
    const sealed = mount(await publicDataFor("- AxF(x)"), null, {
      feedback: "none",
    });
    const element = sealed.element as unknown as {
      setMark(state: string, title?: string): void;
    };

    element.setMark("ok");
    expect(markState(sealed)).toBe("idle");

    element.setMark("working");
    expect(markState(sealed)).toBe("idle");

    // Not a verdict: a proof engine that will not load is a malfunction, and a
    // student staring at a dead widget should still be told.
    element.setMark("error", "Could not load the proof engine.");
    expect(markState(sealed)).toBe("error");
  });
});

describe("restoring a prior answer", () => {
  test("text fields and the domain come back", async () => {
    const mounted = mount(await publicDataFor("- AxF(x)"), {
      domain: "0,1,2",
      fields: { "F(_)": "0,1,2" },
    });

    expect(valueControl(mounted.root, "Domain").value).toBe("0,1,2");
    expect(valueControl(mounted.root, "F(_)").value).toBe("0,1,2");
    expect(answerOf(mounted)).toEqual({
      domain: "0,1,2",
      fields: { "F(_)": "0,1,2" },
    });
  });

  test("a function's table comes back from its serialized form", async () => {
    const mounted = mount(await publicDataFor("- Axf(x) = x"), {
      domain: "0,1",
      fields: { "f(_)": "[0;1],[1;0]" },
    });

    // The table has to be rebuilt for the restored domain first, or there is
    // nowhere to put the second row's value.
    expect(answerOf(mounted).fields["f(_)"]).toBe("[0;1],[1;0]");
  });

  test("a constant's choice comes back", async () => {
    const mounted = mount(await publicDataFor("- F(a)"), {
      domain: "0,1,2",
      fields: { a: "2", "F(_)": "" },
    });

    expect(answerOf(mounted).fields.a).toBe("2");
  });
});
