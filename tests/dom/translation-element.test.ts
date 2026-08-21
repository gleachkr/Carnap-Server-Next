import { describe, expect, mock, test } from "bun:test";
import { compileCarnapMarkdown } from "../../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../../src/worker/domain/content";
import { exerciseActionsHtml } from "../../src/worker/exercises/actions";
import { CORRECTNESS_MARK_CLASS } from "../../src/worker/exercises/correctness-mark";
import { EXERCISE_HYDRATION_VERSION } from "../../src/worker/exercises/hydration";
import { renderTranslationElement } from "../../src/worker/exercises/translation/read-only-view";
import { buildTranslationStrings } from "../../src/worker/exercises/translation/strings";
import type {
  TranslationAnswerData,
  TranslationPublicData,
} from "../../src/worker/exercises/translation/types";
import { i18nFor } from "../../src/worker/i18n";
import { adoptShadowRoots, dom, domDocument } from "../helpers/dom";

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

const compile = mock((_mm0: string, _proof: string) => ({
  mmbBytes: new Uint8Array([1, 2, 3]),
  ok: true,
}));

mock.module("../../src/client/proof-compiler", () => ({
  loadProofCompiler: async () => ({ compile }),
  proofCompilerLocale: () => undefined,
}));

// After `helpers/dom` has installed the globals, so `extends HTMLElement`
// resolves and `register` lands in the window the fixtures are built in.
await import("../../src/client/components/carnap-translation-v1");

async function publicDataFor(
  body: string,
  attrs = "#t1",
): Promise<TranslationPublicData> {
  const result = await compileCarnapMarkdown(
    `::::translation{${attrs}}\n${body}\n::::`,
  );

  if (!result.ok) {
    throw new Error(
      `compile failed: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }

  const item = result.artifact.manifest[0] as ExerciseManifestItem;

  return item.publicData as unknown as TranslationPublicData;
}

interface Mounted {
  readonly answerData: HTMLInputElement;
  readonly element: HTMLElement;
  readonly form: HTMLFormElement;
  readonly input: HTMLInputElement;
  readonly root: ShadowRoot;
}

/** Render an exercise server-side, then upgrade it the way a browser would. */
function mount(
  publicData: TranslationPublicData,
  priorAnswer: TranslationAnswerData | null = null,
  options: { readonly feedback?: string } = {},
): Mounted {
  const i18n = i18nFor("en");
  // The real bar, not a hand-written stand-in: the widget writes its verdict to
  // the check status line inside it, and a fixture spelling its own markup would
  // keep passing after that line had moved.
  const actions = exerciseActionsHtml(i18n, { slotted: true });
  const hydration = {
    mode: "answer",
    options,
    priorAnswer,
    publicData,
    strings: buildTranslationStrings(i18n),
    version: EXERCISE_HYDRATION_VERSION,
  };
  const html = renderTranslationElement(
    publicData,
    {
      component: "carnap-translation",
      componentVersion: "1",
      exerciseId: "t1",
      exerciseKind: "translation@1",
      i18n,
      title: null,
    },
    `${actions}<script data-exercise-hydration type="application/json">${JSON.stringify(hydration)}</script>`,
  );

  const form = domDocument.createElement("form");
  form.className = "exercise";
  form.innerHTML = `<input name="answerData" type="hidden">${html}`;
  adoptShadowRoots(form);
  domDocument.body.append(form);

  const element = form.querySelector("carnap-translation") as HTMLElement;
  const root = element.shadowRoot as ShadowRoot;

  return {
    answerData: form.querySelector(
      'input[name="answerData"]',
    ) as HTMLInputElement,
    element,
    form,
    input: root.querySelector('input[data-role="text"]') as HTMLInputElement,
    root,
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

function answerOf(mounted: Mounted): TranslationAnswerData {
  return JSON.parse(mounted.answerData.value) as TranslationAnswerData;
}

function previewText(mounted: Mounted): string {
  return (
    mounted.root.querySelector<HTMLElement>('p[data-role="preview"]')
      ?.textContent ?? ""
  );
}

/**
 * The Check's verdict, on the line the shared action bar keeps for it — light
 * DOM, outside the shadow root, the same element every locally-checking type
 * writes to. The preview above stays inside the card: it reads the student's own
 * keystrokes back and belongs beside the input, not down in the button row.
 */
function statusText(mounted: Mounted): string {
  return (
    mounted.form.querySelector<HTMLElement>("[data-exercise-check-status]")
      ?.textContent ?? ""
  );
}

function markState(mounted: Mounted): string {
  const mark = mounted.form.querySelector<HTMLElement>(
    `.${CORRECTNESS_MARK_CLASS}`,
  );

  return mark?.dataset.state ?? "";
}

async function until(
  condition: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("condition never held");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const PROP = "People danced and sang.\n\n- P/\\Q";

describe("upgrading", () => {
  test("the input comes alive, prefilled from the starter", async () => {
    const mounted = mount(
      await publicDataFor(PROP, '#t1 starter="P /\\ ..."'),
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
      await publicDataFor(PROP, '#t1 starter="P /\\ ..."'),
      { text: "Q/\\P" },
    );

    expect(mounted.input.value).toBe("Q/\\P");
    expect(answerOf(mounted).text).toBe("Q/\\P");
  });
});

describe("the live preview", () => {
  test("reads well-formed ASCII back in logical symbols", async () => {
    const mounted = mount(await publicDataFor(PROP));

    type(mounted, "P/\\Q");

    expect(previewText(mounted)).toBe("Reads as P ∧ Q");
  });

  test("words the parser's complaint while it does not parse", async () => {
    const mounted = mount(await publicDataFor(PROP));

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
    const mounted = mount(await publicDataFor(PROP));

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
    const mounted = mount(await publicDataFor(PROP));

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
    const mounted = mount(await publicDataFor(PROP));

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
    const mounted = mount(await publicDataFor(PROP));

    type(mounted, "Q/\\P");
    pressEnter(mounted);
    await until(() => markState(mounted) === "error");
  });

  test("the tests gate words its complaint before any search runs", async () => {
    searchResult = null;
    const mounted = mount(await publicDataFor(PROP, '#t1 tests="maxNot:0"'));

    type(mounted, "~~(P/\\Q)");
    pressEnter(mounted);

    expect(statusText(mounted)).toBe(
      "You have 2 negations, but should have 0 at most.",
    );
    expect(markState(mounted)).toBe("idle");
  });

  test("exact refuses an equivalent that is not the formula", async () => {
    searchResult = null;
    const mounted = mount(await publicDataFor(PROP, '#t1 variant="exact"'));

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
    const mounted = mount(await publicDataFor(PROP), null, {
      feedback: "terse",
    });

    type(mounted, "P\\/Q");
    pressEnter(mounted);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(statusText(mounted)).toBe("");
    expect(markState(mounted)).toBe("idle");
  });

  test("none still computes the certificate but never goes green", async () => {
    searchResult = async () => "expanded proof";
    const mounted = mount(await publicDataFor(PROP), null, {
      feedback: "none",
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

describe("the checksyntax gate", () => {
  test("refuses to submit text that does not parse, and says why", async () => {
    const mounted = mount(
      await publicDataFor(PROP, '#t1 options="checksyntax"'),
    );

    type(mounted, "P /\\");
    const submit = new dom.window.Event("submit", { cancelable: true });
    mounted.form.dispatchEvent(submit);

    expect(submit.defaultPrevented).toBe(true);
    expect(statusText(mounted)).toBe(
      "This answer does not parse, so it cannot be submitted on an exam.",
    );
  });

  test("lets a parsed answer through", async () => {
    const mounted = mount(
      await publicDataFor(PROP, '#t1 options="checksyntax"'),
    );

    type(mounted, "P\\/Q");
    const submit = new dom.window.Event("submit", { cancelable: true });
    mounted.form.dispatchEvent(submit);

    expect(submit.defaultPrevented).toBe(false);
  });
});
