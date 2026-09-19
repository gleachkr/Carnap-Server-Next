import { compileCarnapMarkdown } from "../../src/worker/application/content/compiler";
import { createDefaultExerciseRegistry } from "../../src/worker/application/content/registry";
import type { ExerciseManifestItem } from "../../src/worker/domain/content";
import type { JsonValue } from "../../src/worker/domain/json";
import { exerciseActionsHtml } from "../../src/worker/exercise-kit/actions";
import { CORRECTNESS_MARK_CLASS } from "../../src/worker/exercise-kit/correctness-mark";
import {
  EXERCISE_HYDRATION_VERSION,
  type ExerciseHydration,
  type ExerciseHydrationOptions,
} from "../../src/worker/exercise-kit/hydration";
import { withSystemText } from "../../src/worker/exercise-kit/systems/join";
import type { ExerciseNode } from "../../src/worker/exercise-kit/type";
import { i18nFor } from "../../src/worker/i18n";
import { adoptShadowRoots, dom, domDocument } from "../helpers/dom";

/**
 * A client element under jsdom, mounted the way the attempt page mounts it:
 * compile a document, render the exercise through the registry with the real
 * action bar and a hydration payload, wrap it in a submission form, adopt the
 * declarative shadow root, and connect it so it upgrades. One mount for every
 * type — the widget under test is whatever the document's directive names.
 *
 * Beside the tests rather than in `tests/helpers/`, because it is typed
 * against the DOM lib (`tsconfig.dom-tests.json`) and the helpers directory
 * is compiled against workers-types. It imports no component: a test that
 * mocks the compiler loader has to do so *before* the component module is
 * evaluated, and a static import here would run first. Each test file mocks
 * what it mocks (`./proof-compiler-mock`) and then imports the component
 * itself.
 *
 * jsdom does not implement declarative shadow DOM — `<template
 * shadowrootmode>` stays a template — so {@link mountExercise} performs the
 * adoption a browser's parser does, then inserts the element so it upgrades
 * with its shadow root already in place. That ordering is the point:
 * `enhance()` reads `this.shadowRoot`.
 */

// The ProofML elements the tree and Prawitz widgets vendor measure
// themselves with a ResizeObserver and lay premises out on animation frames
// over `DOMRect`s, none of which jsdom has; nothing under test is about
// layout, so a frame that never comes and a box with no extent are the right
// ones. Installed here, for every file, because they are harmless to the
// widgets that never ask.
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

const registry = createDefaultExerciseRegistry();

/** One compiled exercise: its document node (systems joined) and its manifest entry. */
export interface ExerciseFixture {
  readonly item: ExerciseManifestItem;
  readonly node: ExerciseNode;
}

/**
 * Compile a document and pick out one exercise, the first by default. The
 * node's `publicData` is joined against the document's systems table here,
 * as `parseContentArtifact` does for a stored artifact: the render reads the
 * text, and the payload carries it, since a jsdom fixture has no
 * `data-carnap-systems` script for the element to join against.
 */
export async function compileExercise(
  source: string,
  index = 0,
): Promise<ExerciseFixture> {
  const result = await compileCarnapMarkdown(source);
  if (!result.ok) {
    throw new Error(
      `compile failed: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }
  const exercises = result.artifact.document.nodes.filter(
    (node): node is ExerciseNode => node.kind === "exercise",
  );
  const node = exercises[index];
  if (node === undefined) {
    throw new Error(`the document has no exercise #${index}`);
  }
  const item = result.artifact.manifest.find(
    (candidate) => candidate.id === node.exerciseId,
  );
  if (item === undefined) {
    throw new Error(`no manifest entry for ${node.exerciseId}`);
  }
  return {
    item,
    node: {
      ...node,
      publicData: withSystemText(node.publicData, result.artifact.systems),
    },
  };
}

export interface MountedExercise {
  readonly answerData: HTMLInputElement;
  readonly element: HTMLElement;
  readonly form: HTMLFormElement;
  readonly root: ShadowRoot;
}

export interface MountOptions {
  readonly mode?: ExerciseHydration["mode"];
  readonly options?: ExerciseHydrationOptions;
  readonly priorAnswer?: JsonValue | null;
}

/** The widget's public data as the payload will carry it. */
export function publicDataOf<T>(fixture: ExerciseFixture): T {
  return fixture.node.publicData as unknown as T;
}

/**
 * Render the exercise server-side, then upgrade it the way a browser would.
 *
 * The action bar is the real one, not a hand-written stand-in for it:
 * everything a widget writes to — the correctness mark, the check status
 * line, the Check button a truth table adds — lives in it, in light DOM
 * outside the shadow root, and a fixture that spelled its own would go on
 * passing after the bar had changed underneath it.
 *
 * A fresh form appended to the shared body, never a replacement of it: other
 * element tests keep their fixtures in the same document.
 */
export function mountExercise(
  fixture: ExerciseFixture,
  { mode = "answer", options = {}, priorAnswer = null }: MountOptions = {},
): MountedExercise {
  const i18n = i18nFor("en");
  const { node } = fixture;
  const hydration: ExerciseHydration = {
    mode,
    options,
    priorAnswer,
    publicData: node.publicData,
    strings: registry.strings(node.render.assetId, i18n),
    version: EXERCISE_HYDRATION_VERSION,
  };
  const html = registry.renderExercise(node, {
    actions: `${exerciseActionsHtml(i18n, { slotted: true })}<script data-exercise-hydration type="application/json">${JSON.stringify(hydration)}</script>`,
    i18n,
    title: fixture.item.title ?? null,
  });

  // An element scopes its listeners to an `AbortController`, and jsdom's
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

  const element = form.querySelector(node.render.component) as HTMLElement;
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

/** The correctness mark's state (`idle`, `working`, `ok`, `error`), on the bar. */
export function markState(mounted: MountedExercise): string {
  return (
    mounted.form.querySelector<HTMLElement>(`.${CORRECTNESS_MARK_CLASS}`)
      ?.dataset.state ?? ""
  );
}

/**
 * The Check's verdict, on the line the shared action bar keeps for it. Light
 * DOM, outside the shadow root: it is the same element for every type that
 * checks locally, which is what makes the sentence come out the same size
 * and in the same place for all of them.
 */
export function checkStatus(mounted: MountedExercise): HTMLElement | null {
  return mounted.form.querySelector<HTMLElement>(
    "[data-exercise-check-status]",
  );
}

export function statusText(mounted: MountedExercise): string {
  return checkStatus(mounted)?.textContent ?? "";
}

/** Submit the form the way the page runtime sees it: cancelable, and — as
 *  the runtime does — never allowed to navigate. */
export function submitForm(mounted: MountedExercise): Event {
  const event = new dom.window.Event("submit", {
    bubbles: true,
    cancelable: true,
  });
  mounted.form.dispatchEvent(event);
  return event;
}

/** Type into a contenteditable field, the way an edit reaches the element. */
export function typeInto(field: HTMLElement, text: string): void {
  field.textContent = text;
  field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}
