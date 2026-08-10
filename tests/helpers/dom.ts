import { JSDOM } from "jsdom";

/**
 * One jsdom window, shared by every test that exercises a client element.
 *
 * It has to be shared. `CarnapExerciseElement extends HTMLElement` resolves
 * `HTMLElement` from `globalThis` when the class is *defined*, which happens
 * once — the first time any test imports `client/components/base`. A second test
 * file that built its own window would then define its elements against one
 * window's `HTMLElement` and register them in another window's
 * `customElements`, and its elements would silently never upgrade. That failure
 * is invisible: the test sees an element that simply did nothing.
 *
 * So: import this module, then `await import(...)` the element under test — the
 * globals have to be in place before the client module is evaluated, which the
 * dynamic import guarantees.
 *
 * The body starts empty. A test that needs a fixture appends its own and does
 * not clear the body, since files share this document and another file's
 * fixtures may be sitting in it.
 */
export const dom = new JSDOM(
  `<!doctype html><html lang="en"><head><title>Widgets</title></head><body></body></html>`,
);

for (const name of [
  "CustomEvent",
  "Element",
  "Event",
  "HTMLElement",
  "Node",
  "customElements",
  "document",
  "window",
]) {
  (globalThis as Record<string, unknown>)[name] = (
    dom.window as unknown as Record<string, unknown>
  )[name];
}

/** The shared document, for building a fixture. */
export const domDocument = dom.window.document;

/**
 * Adopt every declarative shadow root under `container`, which is what a
 * browser's parser does at parse time and jsdom does not do at all.
 *
 * Call it while the container is still detached: an element upgrades when it is
 * connected, and `enhance()` reads `this.shadowRoot`, so the root has to be
 * attached first.
 */
export function adoptShadowRoots(container: {
  querySelectorAll(selector: string): ArrayLike<unknown>;
}): void {
  // Typed structurally rather than as `Element`, because this module is reached
  // from both tsconfig programs and the global `Element` means different things
  // in each — the worker program has no DOM lib.
  for (const node of Array.from(
    container.querySelectorAll("template[shadowrootmode]"),
  )) {
    const template = node as HTMLTemplateElement;
    const host = template.parentElement;

    if (host === null) {
      continue;
    }

    const root = host.attachShadow({ mode: "open" });
    root.append(...Array.from(template.content.childNodes));
    template.remove();
  }
}
