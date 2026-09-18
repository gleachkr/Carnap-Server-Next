import { compileCarnapMarkdown } from "../../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../../src/worker/domain/content";
import { exerciseActionsHtml } from "../../src/worker/exercise-kit/actions";
import { EXERCISE_HYDRATION_VERSION } from "../../src/worker/exercise-kit/hydration";
import { withSystemText } from "../../src/worker/exercise-kit/systems/join";
import { renderAufbauProofTreeElement } from "../../src/worker/exercises/aufbau-proof-tree/read-only-view";
import { buildAufbauProofTreeStrings } from "../../src/worker/exercises/aufbau-proof-tree/strings";
import type {
  AufbauProofTreeAnswerData,
  AufbauProofTreePublicData,
} from "../../src/worker/exercises/aufbau-proof-tree/types";
import { i18nFor } from "../../src/worker/i18n";
import { adoptShadowRoots, dom, domDocument } from "../helpers/dom";

/**
 * `<carnap-aufbau-proof-tree>` under jsdom: compile a document to the widget's
 * public data, then mount the element the way the attempt page does — inside
 * a submission form, with its hydration script and its actions slot.
 *
 * Beside the tests rather than in `tests/helpers/`, because it is typed
 * against the DOM lib (`tsconfig.dom-tests.json`) and the helpers directory
 * is compiled against workers-types. This file does not import the component. A test that mocks the compiler
 * loader has to do so *before* the component module is evaluated, and a
 * static import here would run first; each test file imports the component
 * itself, after its mocks are in place. The layout stubs are here because
 * the vendored ProofML elements measure themselves with a ResizeObserver and
 * lay premises out on animation frames over `DOMRect`s, none of which jsdom
 * has; nothing under test is about layout, so a frame that never comes and
 * a box with no extent are the right ones.
 */

class InertResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
/** Every box jsdom measures is empty; merging two of them needs only this. */
class FlatDOMRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
  get left(): number {
    return this.x;
  }
  get top(): number {
    return this.y;
  }
  get right(): number {
    return this.x + this.width;
  }
  get bottom(): number {
    return this.y + this.height;
  }
}
for (const scope of [
  dom.window as unknown as Record<string, unknown>,
  globalThis as Record<string, unknown>,
]) {
  scope.ResizeObserver = InertResizeObserver;
  scope.requestAnimationFrame ??= (): number => 0;
  scope.DOMRect ??= FlatDOMRect;
}

/**
 * The widget's public data for one tree directive, set over a document-local
 * theory: `prelude` is the `:::aufbau-mm0` block (a forallx Magnus reference
 * by default) and `directive` the exercise that names it.
 */
export async function treePublicDataFor(
  directive: string,
  prelude = `:::aufbau-mm0{name="fx" src="/theories/forallx-magnus.mm0"}\n:::`,
): Promise<AufbauProofTreePublicData> {
  const result = await compileCarnapMarkdown(`${prelude}\n\n${directive}`);
  if (!result.ok) {
    throw new Error(
      `compile failed: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }
  const item = result.artifact.manifest[0] as ExerciseManifestItem;
  // The browser's join: the payload carries the key, the element the text.
  return withSystemText(
    item.publicData,
    result.artifact.systems,
  ) as unknown as AufbauProofTreePublicData;
}

export interface MountedTree {
  readonly answerData: HTMLInputElement;
  readonly element: HTMLElement;
  readonly form: HTMLFormElement;
  readonly root: ShadowRoot;
}

export function mountTree(
  publicData: AufbauProofTreePublicData,
  priorAnswer: AufbauProofTreeAnswerData | null = null,
): MountedTree {
  const i18n = i18nFor("en");
  const actions = exerciseActionsHtml(i18n, { slotted: true });
  const hydration = {
    mode: "answer",
    options: {},
    priorAnswer,
    publicData,
    strings: buildAufbauProofTreeStrings(i18n),
    version: EXERCISE_HYDRATION_VERSION,
  };
  const html = renderAufbauProofTreeElement(
    publicData,
    {
      component: "carnap-aufbau-proof-tree",
      componentVersion: "1",
      exerciseId: "t1",
      exerciseKind: "aufbau-proof-tree@1",
      i18n,
      title: null,
    },
    `${actions}<script data-exercise-hydration type="application/json">${JSON.stringify(hydration)}</script>`,
  );

  // The element scopes its listeners to an `AbortController`, and jsdom's
  // `addEventListener` refuses a signal from Bun's own. Construction (where
  // the controller is made) and the upgrade (where the listeners are added)
  // are both synchronous with building the fixture, so the window's
  // constructor stands in for exactly that long.
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
    "carnap-aufbau-proof-tree",
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

export async function until(
  condition: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("condition never held");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The root node's formula field. Premises render *above* their parent and
 *  so precede it in the DOM; the root is the canvas's own proposition. */
export function treeRootField(mounted: MountedTree): HTMLElement {
  return mounted.root.querySelector(
    ".proof-tree-canvas > proof-tree > proof-proposition .tree-edit",
  ) as HTMLElement;
}

export function typeInto(field: HTMLElement, text: string): void {
  field.textContent = text;
  field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

/** A toolbar button by its accessible name (the toolbars are icon-only). */
export function toolbarButton(
  mounted: MountedTree,
  name: string,
): HTMLButtonElement {
  const button = Array.from(
    mounted.root.querySelectorAll<HTMLButtonElement>(".tree-toolbar button"),
  ).find((candidate) => candidate.getAttribute("aria-label") === name);
  if (button === undefined) {
    throw new Error(`no toolbar button named ${name}`);
  }
  return button;
}
