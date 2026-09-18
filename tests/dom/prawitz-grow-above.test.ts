import { afterAll, describe, expect, mock, test } from "bun:test";
import { compileCarnapMarkdown } from "../../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../../src/worker/domain/content";
import { exerciseActionsHtml } from "../../src/worker/exercise-kit/actions";
import { EXERCISE_HYDRATION_VERSION } from "../../src/worker/exercise-kit/hydration";
import { withSystemText } from "../../src/worker/exercise-kit/systems/join";
import { renderAufbauProofPrawitzElement } from "../../src/worker/exercises/aufbau-proof-prawitz/read-only-view";
import { buildAufbauProofPrawitzStrings } from "../../src/worker/exercises/aufbau-proof-prawitz/strings";
import type { AufbauProofPrawitzPublicData } from "../../src/worker/exercises/aufbau-proof-prawitz/types";
import { i18nFor } from "../../src/worker/i18n";
import { adoptShadowRoots, dom, domDocument } from "../helpers/dom";
// Also installs the ProofML layout stubs (ResizeObserver, rAF, DOMRect) the
// Prawitz canvas needs under jsdom, exactly as the tree widget does.
import { until } from "./tree-widget";

/**
 * Growing a Prawitz proof upward from an assumption. The workspace is
 * top-down by design — assumptions first, rules applied below them — so its
 * leaves are all assumptions, and *Add premise above* used to refuse every
 * one of them: on a fresh assumption `p` and `h` did nothing until a rule had
 * been applied below it. Now an unlabelled assumption grows
 * like any derived line, becoming one; a labelled assumption still refuses,
 * because the label names a discharge a derived line cannot carry.
 *
 * The compiler is mocked at the module seam, as in the tree widget's tests.
 */

const compile = mock((_mm0: string, _proof: string) => ({
  mmbBytes: new Uint8Array([1, 2, 3]),
  ok: true,
}));

const PROOF_COMPILER = "../../src/client/proof-compiler";
const realProofCompiler = { ...(await import(PROOF_COMPILER)) };

mock.module(PROOF_COMPILER, () => ({
  ...realProofCompiler,
  loadProofCompiler: async () => ({ compile }),
}));

afterAll(() => {
  mock.module(PROOF_COMPILER, () => ({ ...realProofCompiler }));
});

await import("../../src/client/components/carnap-aufbau-proof-prawitz-v1");

/** The smallest theory a Prawitz exercise compiles over (prawitz-authoring). */
const THEORY = `:::aufbau-mm0{name="prop"}
provable sort wff;
sort ctx;
term top: wff;
term imp (a b: wff): wff;
infixr imp: $→$ prec 25;
--| @syntax role context-join
term join (g h: ctx): ctx;
infixl join: $,$ prec 5;
term hyp (a: wff): ctx;
coercion hyp: wff > ctx;
--| @syntax role turnstile
term nd (g: ctx) (a: wff): wff;
infixl nd: $⊢$ prec 0;
--| @syntax role assumption
axiom ax (g: ctx) (a: wff): $ g , a ⊢ a $;
axiom top_i: $ top $;
:::`;

async function publicData(): Promise<AufbauProofPrawitzPublicData> {
  const source = `${THEORY}\n\n:::aufbau-proof-prawitz{system="prop" id="z"}\nProve it.\n\ntheorem goal: $ top $\n:::`;
  const result = await compileCarnapMarkdown(source);
  if (!result.ok) {
    throw new Error(
      `compile failed: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }
  const item = result.artifact.manifest[0] as ExerciseManifestItem;
  return withSystemText(
    item.publicData,
    result.artifact.systems,
  ) as unknown as AufbauProofPrawitzPublicData;
}

interface Mounted {
  readonly answerData: HTMLInputElement;
  readonly element: HTMLElement;
  readonly root: ShadowRoot;
}

function mountPrawitz(data: AufbauProofPrawitzPublicData): Mounted {
  const i18n = i18nFor("en");
  const hydration = {
    mode: "answer",
    options: {},
    priorAnswer: null,
    publicData: data,
    strings: buildAufbauProofPrawitzStrings(i18n),
    version: EXERCISE_HYDRATION_VERSION,
  };
  const html = renderAufbauProofPrawitzElement(
    data,
    {
      component: "carnap-aufbau-proof-prawitz",
      componentVersion: "1",
      exerciseId: "z",
      exerciseKind: "aufbau-proof-prawitz@1",
      i18n,
      title: null,
    },
    `${exerciseActionsHtml(i18n, { slotted: true })}<script data-exercise-hydration type="application/json">${JSON.stringify(hydration)}</script>`,
  );

  // See tests/dom/tree-widget.ts for why the window's AbortController stands
  // in while the fixture is built.
  const globals = globalThis as Record<string, unknown>;
  const saved = globals.AbortController;
  globals.AbortController = (
    dom.window as unknown as Record<string, unknown>
  ).AbortController;
  const form = domDocument.createElement("form");
  try {
    form.className = "exercise-submission";
    form.innerHTML = `<input name="answerData" type="hidden">${html}`;
    adoptShadowRoots(form);
    domDocument.body.append(form);
  } finally {
    globals.AbortController = saved;
  }
  const element = form.querySelector(
    "carnap-aufbau-proof-prawitz",
  ) as HTMLElement;
  return {
    answerData: form.querySelector(
      'input[name="answerData"]',
    ) as HTMLInputElement,
    element,
    root: element.shadowRoot as ShadowRoot,
  };
}

function items(mounted: Mounted): HTMLElement[] {
  return Array.from(
    mounted.root.querySelectorAll<HTMLElement>('[role="treeitem"]'),
  );
}

/** The line's `<proof-tree>`, whose class says whether it is an assumption. */
function lineOf(item: HTMLElement): HTMLElement {
  return item.closest("proof-tree") as HTMLElement;
}

/** A derived line's own rule field (a premise's is inside the forest, and
 *  `:scope >` is not something jsdom resolves through a custom element). */
function ruleFieldOf(line: HTMLElement): Element | null {
  const inference = Array.from(line.children).find(
    (child) => child.tagName === "PROOF-INFERENCE",
  );
  return inference?.querySelector(".pz-rule") ?? null;
}

function press(item: HTMLElement, key: string): void {
  item.focus();
  item.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
    }),
  );
}

function button(mounted: Mounted, name: string): HTMLButtonElement {
  const found = Array.from(
    mounted.root.querySelectorAll<HTMLButtonElement>(".pz-toolbar button"),
  ).find((candidate) => candidate.getAttribute("aria-label") === name);
  if (found === undefined) {
    throw new Error(`no toolbar button named ${name}`);
  }
  return found;
}

function typeInto(field: HTMLElement, text: string): void {
  field.textContent = text;
  field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

describe("growing a Prawitz proof above an assumption", () => {
  test("p on a fresh assumption makes it a derived line with a premise", async () => {
    const mounted = mountPrawitz(await publicData());
    expect(mounted.element.dataset.enhanced).toBe("true");
    // The workspace opens empty; the first line is an assumption.
    expect(items(mounted)).toHaveLength(0);
    button(mounted, "New assumption").click();
    const [only] = items(mounted);
    expect(only).toBeDefined();
    expect(
      lineOf(only as HTMLElement).classList.contains("pz-assumption"),
    ).toBe(true);
    expect(button(mounted, "Add premise above").disabled).toBe(false);
    expect(button(mounted, "Add assumption above").disabled).toBe(false);

    press(only as HTMLElement, "p");

    // The one line is now derived — a rule field beneath it — and the new
    // premise (itself derived, empty) sits above.
    expect(items(mounted)).toHaveLength(2);
    const grown = lineOf(only as HTMLElement);
    expect(grown.classList.contains("pz-assumption")).toBe(false);
    expect(ruleFieldOf(grown)).not.toBeNull();
    const premise = grown.querySelector("proof-forest > proof-tree");
    expect(premise?.classList.contains("pz-assumption")).toBe(false);

    // What is stored says the same: the root cites no assumption axiom now.
    await until(() => mounted.answerData.value.includes('"premises":[{'));
    const { tree } = JSON.parse(mounted.answerData.value) as {
      tree: { rule: string; premises: { rule: string }[] };
    };
    expect(tree.rule).toBe("");
    expect(tree.premises).toHaveLength(1);
  });

  test("h makes it a derived line with an assumption above, and undo restores it", async () => {
    const mounted = mountPrawitz(await publicData());
    button(mounted, "New assumption").click();
    const [only] = items(mounted);

    press(only as HTMLElement, "h");

    const grown = lineOf(only as HTMLElement);
    expect(grown.classList.contains("pz-assumption")).toBe(false);
    expect(
      grown
        .querySelector("proof-forest > proof-tree")
        ?.classList.contains("pz-assumption"),
    ).toBe(true);

    button(mounted, "Undo").click();

    expect(items(mounted)).toHaveLength(1);
    expect(
      lineOf(items(mounted)[0] as HTMLElement).classList.contains(
        "pz-assumption",
      ),
    ).toBe(true);
  });

  test("a labelled assumption still refuses to grow", async () => {
    const mounted = mountPrawitz(await publicData());
    button(mounted, "New assumption").click();
    const [only] = items(mounted);
    (only as HTMLElement).click();
    typeInto(
      (only as HTMLElement).querySelector(".pz-label") as HTMLElement,
      "1",
    );

    expect(button(mounted, "Add premise above").disabled).toBe(true);
    expect(button(mounted, "Add assumption above").disabled).toBe(true);

    press(only as HTMLElement, "p");
    press(only as HTMLElement, "h");

    expect(items(mounted)).toHaveLength(1);
    expect(
      lineOf(only as HTMLElement).classList.contains("pz-assumption"),
    ).toBe(true);
  });
});
