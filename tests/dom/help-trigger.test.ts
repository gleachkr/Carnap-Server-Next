import { describe, expect, test } from "bun:test";

import { dom, domDocument } from "../helpers/dom";

/**
 * Where the `(?)` goes.
 *
 * It used to be drawn by each widget's own toolbar, inside that widget's shadow
 * root: a different position in every widget that had one, and no position at all
 * in the ones with no toolbar. It is now one light-DOM button at the head of the
 * exercise's action bar, which is the row every one of the nine types ends with.
 *
 * The point of testing it here rather than through a widget is that the widgets
 * that use it are Preact islands over a WASM proof engine, and none of that is
 * involved in the question being asked. What can regress is this: which bar the
 * button lands in, whether it goes first, and whether it carries a name — the
 * glyph is decoration, so without one a screen reader announces "question mark".
 */

// After `helpers/dom` has installed the globals: the module builds elements
// through the document it finds on `globalThis`.
const { createHelpDialog, mountHelpTrigger } = await import(
  "../../src/client/components/help-dialog"
);

function fixture(bar: string): HTMLElement {
  const host = domDocument.createElement("div");
  host.innerHTML = bar;
  domDocument.body.appendChild(host);

  return host as unknown as HTMLElement;
}

describe("mountHelpTrigger", () => {
  test("puts a named (?) first in the exercise's action bar", () => {
    const host = fixture(
      '<div class="exercise-actions">' +
        '<button class="tt-check" type="button">Check</button>' +
        '<button class="exercise-submit" type="submit">Submit answer</button>' +
        "</div>",
    );
    const opened: unknown[] = [];

    const trigger = mountHelpTrigger(
      host,
      "Usage and keyboard shortcuts",
      (element) => {
        opened.push(element);
      },
    );

    expect(trigger).not.toBeNull();

    const bar = host.querySelector(".exercise-actions") as HTMLElement;

    // First, ahead of the widget's own Check and of Submit — a fixed end of the
    // row, so a widget that grows another button cannot shunt it along.
    expect(bar.firstElementChild).toBe(trigger as unknown as Element);
    expect(Array.from(bar.children).map((child) => child.className)).toEqual([
      "help-trigger",
      "tt-check",
      "exercise-submit",
    ]);

    // `type="button"`, because the bar is inside a form on the submission path
    // and the default would submit the answer instead of opening the help.
    expect((trigger as HTMLButtonElement).type).toBe("button");
    expect(trigger?.getAttribute("aria-label")).toBe(
      "Usage and keyboard shortcuts",
    );
    expect(trigger?.title).toBe("Usage and keyboard shortcuts");

    // Opening reports the button itself, which is what the dialog anchors to and
    // hands focus back to on close.
    trigger?.dispatchEvent(new dom.window.Event("click"));
    expect(opened).toEqual([trigger]);
  });

  test("does nothing, rather than throwing, where there is no bar", () => {
    const host = fixture("<p>No actions here.</p>");

    expect(
      mountHelpTrigger(host, "Usage and keyboard shortcuts", () => {}),
    ).toBe(null);
    expect(host.querySelector(".help-trigger")).toBeNull();
  });
});

/**
 * The legend. The tree and Prawitz toolbars show glyphs and no words, so the
 * key table is where a glyph is first seen beside its meaning: a row whose
 * action has a button draws that button's icon ahead of its keys. The icon
 * is decoration — the row's text names the action — and the cell is present
 * on every row so the keys stay a column.
 */
describe("createHelpDialog", () => {
  test("draws the toolbar glyph beside the keys of an action that has one", () => {
    const dialog = createHelpDialog({
      close: "Close help",
      intro: [],
      keyboard: "Keyboard",
      shortcuts: [
        { action: "Move between lines", keys: ["↑", "↓"] },
        {
          action: "Add a premise above the line",
          icon: "add-above",
          keys: ["p"],
        },
      ],
      title: "Using the proof tree editor",
    });
    const rows = Array.from(dialog.querySelectorAll(".help-shortcuts dt"));

    expect(rows).toHaveLength(2);

    const [keysOnly, withIcon] = rows as [Element, Element];

    // Both rows carry the cell; only the second has anything in it.
    expect(keysOnly.querySelector(".help-shortcut-icon")).not.toBeNull();
    expect(keysOnly.querySelector("svg")).toBeNull();

    const icon = withIcon.querySelector(".help-shortcut-icon svg");

    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(icon?.querySelector("g")?.getAttribute("stroke")).toBe(
      "currentColor",
    );
    expect(
      Array.from(withIcon.querySelectorAll("kbd")).map((k) => k.textContent),
    ).toEqual(["p"]);
  });
});
