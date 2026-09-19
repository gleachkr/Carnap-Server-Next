import { compileCarnapMarkdown } from "../../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../../src/worker/domain/content";
import { exerciseActionsHtml } from "../../src/worker/exercise-kit/actions";
import {
  EXERCISE_HYDRATION_VERSION,
  type ExerciseHydrationOptions,
} from "../../src/worker/exercise-kit/hydration";
import { withSystemText } from "../../src/worker/exercise-kit/systems/join";
import { renderAufbauProofPrawitzElement } from "../../src/worker/exercises/aufbau-proof-prawitz/read-only-view";
import { buildAufbauProofPrawitzStrings } from "../../src/worker/exercises/aufbau-proof-prawitz/strings";
import type { AufbauProofPrawitzPublicData } from "../../src/worker/exercises/aufbau-proof-prawitz/types";
import { i18nFor } from "../../src/worker/i18n";
import { adoptShadowRoots, dom, domDocument } from "../helpers/dom";
// Also installs the ProofML layout stubs (ResizeObserver, rAF, DOMRect) the
// Prawitz canvas needs under jsdom, exactly as the tree widget does.
import "./tree-widget";

/**
 * `<carnap-aufbau-proof-prawitz>` under jsdom, on the same terms as
 * `./tree-widget.ts`: compile a document to the widget's public data, then
 * mount the element the way the attempt page does. This file does not import
 * the component, for the reason given there — each test file mocks the
 * compiler first and imports the component itself.
 */

/** The smallest theory a Prawitz exercise compiles over (prawitz-authoring). */
export const PRAWITZ_THEORY = `:::aufbau-mm0{name="prop"}
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

/** Public data for `theorem goal: $ top $` over {@link PRAWITZ_THEORY}. */
export async function prawitzPublicData(
  attributes = "",
  theory = PRAWITZ_THEORY,
): Promise<AufbauProofPrawitzPublicData> {
  const source = `${theory}\n\n:::aufbau-proof-prawitz{system="prop" id="z"${attributes}}\nProve it.\n\ntheorem goal: $ top $\n:::`;
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

export interface MountedPrawitz {
  readonly answerData: HTMLInputElement;
  readonly element: HTMLElement;
  readonly form: HTMLFormElement;
  readonly root: ShadowRoot;
}

export function mountPrawitz(
  data: AufbauProofPrawitzPublicData,
  options: ExerciseHydrationOptions = {},
): MountedPrawitz {
  const i18n = i18nFor("en");
  const hydration = {
    mode: "answer",
    options,
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
    form,
    root: element.shadowRoot as ShadowRoot,
  };
}

/** Every line of the forest, in document order. */
export function prawitzItems(mounted: MountedPrawitz): HTMLElement[] {
  return Array.from(
    mounted.root.querySelectorAll<HTMLElement>('[role="treeitem"]'),
  );
}

/** The line's `<proof-tree>`, whose class says whether it is an assumption. */
export function prawitzLineOf(item: HTMLElement): HTMLElement {
  return item.closest("proof-tree") as HTMLElement;
}

/** A derived line's own rule field (a premise's is inside the forest, and
 *  `:scope >` is not something jsdom resolves through a custom element). */
export function prawitzRuleFieldOf(line: HTMLElement): Element | null {
  const inference = Array.from(line.children).find(
    (child) => child.tagName === "PROOF-INFERENCE",
  );
  return inference?.querySelector(".pz-rule") ?? null;
}

/** A line's own formula field. */
export function prawitzFormulaFieldOf(item: HTMLElement): HTMLElement {
  return item.querySelector(".pz-edit") as HTMLElement;
}

export function prawitzPress(item: HTMLElement, key: string): void {
  item.focus();
  item.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
    }),
  );
}

/** A toolbar button by its accessible name (the toolbar is icon-only). */
export function prawitzButton(
  mounted: MountedPrawitz,
  name: string,
): HTMLButtonElement {
  const found = Array.from(
    mounted.root.querySelectorAll<HTMLButtonElement>(".pz-toolbar button"),
  ).find((candidate) => candidate.getAttribute("aria-label") === name);
  if (found === undefined) {
    throw new Error(`no toolbar button named ${name}`);
  }
  return found;
}

export function prawitzTypeInto(field: HTMLElement, text: string): void {
  field.textContent = text;
  field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}
