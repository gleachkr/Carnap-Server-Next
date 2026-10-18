import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dom, domDocument } from "../helpers/dom";
import { compileExercise, mountExercise } from "./mount-exercise";
import { prawitzButton as button, PRAWITZ_THEORY } from "./prawitz-widget";
import { mockProofCompiler } from "./proof-compiler-mock";

/**
 * Ctrl-?: a widget's work shown as directive source, in a dialog, on any form.
 * The helper is tested on a bare host for the key and the panel, then through
 * the Prawitz editor, whose bare `?` opens the help and whose split workspace
 * has no source to show.
 */

await mockProofCompiler();

const { mountShowSource } = await import(
  "../../src/client/components/show-source"
);
await import("../../src/client/components/carnap-aufbau-proof-prawitz-v1");

// jsdom has the dialog element but not its modal methods.
const proto = (
  dom.window as unknown as { HTMLDialogElement: typeof HTMLDialogElement }
).HTMLDialogElement.prototype;
const saved = { close: proto.close, showModal: proto.showModal };

beforeAll(() => {
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new dom.window.Event("close"));
  };
});

afterAll(() => {
  Object.assign(proto, saved);
});

const T = (id: string) => id;

function press(
  target: Element,
  init: { ctrlKey?: boolean; key: string; metaKey?: boolean },
): KeyboardEvent {
  const event = new dom.window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function host(source: () => string | null, unavailable?: string) {
  const element = domDocument.createElement("div");
  domDocument.body.appendChild(element);
  const root = element.attachShadow({ mode: "open" });
  const field = domDocument.createElement("input");
  root.appendChild(field);
  mountShowSource(element, root, T, source, unavailable);
  const dialog = root.querySelector("dialog") as HTMLDialogElement;
  return { dialog, field, root };
}

describe("mountShowSource", () => {
  test("Ctrl-? from inside a field opens the source on Copy, and the field never sees the key", () => {
    const { dialog, field, root } = host(() => "l1: $ p $ by ax []");
    let reached = false;
    field.addEventListener("keydown", () => {
      reached = true;
    });

    const event = press(field, { ctrlKey: true, key: "?" });

    expect(event.defaultPrevented).toBe(true);
    expect(reached).toBe(false);
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.querySelector(".dialog-title")?.textContent).toBe(
      "Your work as source",
    );
    const text = dialog.querySelector("textarea") as HTMLTextAreaElement;
    expect(text.value).toBe("l1: $ p $ by ax []");
    expect(text.readOnly).toBe(true);
    // Focus on Copy, the text left unselected.
    expect(root.activeElement?.textContent).toBe("Copy");
    expect(text.selectionStart).toBe(text.selectionEnd);
  });

  test("reads the source afresh each time it opens", () => {
    let current = "first";
    const { dialog, field } = host(() => current);

    press(field, { ctrlKey: true, key: "?" });
    dialog.close();
    current = "second";
    press(field, { ctrlKey: true, key: "?" });

    expect(dialog.querySelector("textarea")?.value).toBe("second");
  });

  test("a bare ? and Cmd-? are left alone", () => {
    const { dialog, field } = host(() => "text");

    expect(press(field, { key: "?" }).defaultPrevented).toBe(false);
    expect(
      press(field, { ctrlKey: true, key: "?", metaKey: true })
        .defaultPrevented,
    ).toBe(false);
    expect(dialog.hasAttribute("open")).toBe(false);
  });

  test("says why where there is no source, with nothing to copy", () => {
    const { dialog, field } = host(() => null, "Not one tree.");

    press(field, { ctrlKey: true, key: "?" });

    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.querySelector("textarea")?.hidden).toBe(true);
    expect(
      (dialog.querySelector(".source-dialog-actions") as HTMLElement).hidden,
    ).toBe(true);
    const said = Array.from(dialog.querySelectorAll("p")).find(
      (p) => !p.hidden,
    );
    expect(said?.textContent).toBe("Not one tree.");
  });

  test("Copy puts the text on the clipboard and says so", async () => {
    const copied: string[] = [];
    const globals = globalThis as Record<string, unknown>;
    const navigator = globals.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText: async (text: string) => {
            copied.push(text);
          },
        },
      },
    });

    try {
      const { dialog, field } = host(() => "l1: $ p $ by ax []");
      press(field, { ctrlKey: true, key: "?" });
      const copy = dialog.querySelector(
        ".source-dialog-actions button",
      ) as HTMLButtonElement;
      copy.dispatchEvent(new dom.window.Event("click"));
      await Promise.resolve();
      await Promise.resolve();

      expect(copied).toEqual(["l1: $ p $ by ax []"]);
      expect(dialog.querySelector('[role="status"]')?.textContent).toBe(
        "Copied.",
      );
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: navigator,
      });
    }
  });

  test("keys pressed in the open panel stay in it", () => {
    const { dialog, root } = host(() => "text");
    let reached = false;
    root.addEventListener("keydown", () => {
      reached = true;
    });

    press(dialog.querySelector("textarea") as HTMLTextAreaElement, {
      ctrlKey: true,
      key: "z",
    });

    expect(reached).toBe(false);
  });
});

describe("Ctrl-? on the Prawitz editor", () => {
  const STARTER = "a1: $ top ⊢ top $ by ax []";

  function exercise() {
    return compileExercise(
      `${PRAWITZ_THEORY}\n\n:::aufbau-proof-prawitz{system="prop" id="z"}\nProve it.\n\ntheorem goal: $ top ⊢ top $\n----\n${STARTER}\n:::`,
    );
  }

  function dialogs(root: ShadowRoot) {
    return {
      help: root.querySelector("dialog.help-dialog:not(.source-dialog)"),
      source: root.querySelector("dialog.source-dialog"),
    };
  }

  test("on a student's form, from a line, shows the starter and not the help", async () => {
    const mounted = mountExercise(await exercise());
    const line = mounted.root.querySelector('[role="treeitem"]') as Element;

    press(line, { ctrlKey: true, key: "?" });

    const { help, source } = dialogs(mounted.root);
    expect(source?.hasAttribute("open")).toBe(true);
    expect(help?.hasAttribute("open")).toBe(false);
    expect(source?.querySelector("textarea")?.value).toBe(
      "l1: $ top ⊢ top $ by ax []",
    );
    (source as HTMLDialogElement).close();

    // The bare key is still the help's.
    press(line, { key: "?" });
    expect(help?.hasAttribute("open")).toBe(true);
    (help as HTMLDialogElement).close();
  });

  test("says why while the workspace is in pieces", async () => {
    const mounted = mountExercise(await exercise());
    button(mounted, "New assumption").click();
    const line = mounted.root.querySelector('[role="treeitem"]') as Element;

    press(line, { ctrlKey: true, key: "?" });

    const { source } = dialogs(mounted.root);
    expect(source?.querySelector("textarea")?.hidden).toBe(true);
    expect(
      Array.from(source?.querySelectorAll("p") ?? []).find((p) => !p.hidden)
        ?.textContent,
    ).toBe("The workspace must hold a single tree to be shown as source.");
    (source as HTMLDialogElement).close();
  });

  test("lists the key in the help", async () => {
    const mounted = mountExercise(await exercise());
    const { help } = dialogs(mounted.root);
    const rows = Array.from(
      help?.querySelectorAll(".help-shortcuts dt") ?? [],
    );

    expect(rows.some((row) => row.textContent?.includes("Ctrl-?"))).toBe(
      true,
    );
  });
});
