import { describe, expect, test } from "bun:test";

import { GATED_FIELD_SCRIPT } from "../../src/worker/web/layout-scripts";
import { domDocument } from "../helpers/dom";

/**
 * The schedule date under the grade-visibility choice.
 *
 * The label used to call the field optional, which was true of two answers and
 * false of the third. It is now switched off by the answers that ignore it and
 * required by the one that needs it — and since that is a state machine rather
 * than a formatting pass, it is worth running rather than reading. The script is
 * the shell's own source, evaluated here in jsdom exactly as a page evaluates
 * it.
 */
function fixture(selected: string): {
  readonly field: HTMLInputElement;
  readonly gate: HTMLSelectElement;
} {
  const host = domDocument.createElement("div");

  host.innerHTML =
    "<form>" +
    '<select data-gates-field="gradesVisibleAt" data-gates-value="scheduled" name="gradesVisibility">' +
    '<option value="immediate">As soon as work is checked</option>' +
    '<option value="manual">When I release them</option>' +
    '<option value="scheduled">At the time below</option>' +
    "</select>" +
    '<input data-timestamp-local="gradesVisibleAt" type="datetime-local"/>' +
    '<input data-timestamp-hidden="gradesVisibleAt" name="gradesVisibleAt" type="hidden" value=""/>' +
    "</form>";
  domDocument.body.appendChild(host);

  const gate = host.querySelector("select") as unknown as HTMLSelectElement;
  gate.value = selected;

  return {
    field: host.querySelector(
      "[data-timestamp-local]",
    ) as unknown as HTMLInputElement,
    gate,
  };
}

function run(): void {
  // The shell serves this as a hashed asset; a page just evaluates it. The
  // indirect Function call is that, with the jsdom globals this file installed.
  new Function(GATED_FIELD_SCRIPT)();
}

function change(gate: HTMLSelectElement, value: string): void {
  gate.value = value;
  // The jsdom window's own Event, not the ambient one: an event built by a
  // different realm is not an Event to this document's listeners.
  const view = domDocument.defaultView as unknown as {
    readonly Event: typeof Event;
  };

  gate.dispatchEvent(new view.Event("change"));
}

describe("the gated schedule field", () => {
  test("is off under the answers that ignore it", () => {
    const { field, gate } = fixture("immediate");

    run();

    expect(field.disabled).toBe(true);
    expect(field.required).toBe(false);

    change(gate, "manual");

    expect(field.disabled).toBe(true);
  });

  test("is on and required under the answer that needs it", () => {
    const { field, gate } = fixture("immediate");

    run();
    change(gate, "scheduled");

    expect(field.disabled).toBe(false);
    // Required, so the browser asks for it before the server has to refuse the
    // form — the same rule, said earlier.
    expect(field.required).toBe(true);
  });

  test("keeps a date already typed when the answer flips away and back", () => {
    const { field, gate } = fixture("scheduled");

    run();
    field.value = "2030-01-01T09:00";
    change(gate, "manual");
    change(gate, "scheduled");

    expect(field.value).toBe("2030-01-01T09:00");
    expect(field.disabled).toBe(false);
  });
});
