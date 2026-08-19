import { describe, expect, test } from "bun:test";

import { TABLE_SORT_SCRIPT } from "../../src/worker/web/layout-scripts";
import { domDocument } from "../helpers/dom";

/**
 * Column sorting for the ledger tables.
 *
 * The server ships the values and the browser does the reordering, so what the
 * server emits can be read off the rendered page but the ordering itself only
 * exists once the script has run. It is the shell's own source, evaluated here
 * in jsdom exactly as a page evaluates it.
 */
interface Fixture {
  readonly headings: readonly HTMLTableCellElement[];
  readonly order: () => readonly string[];
  readonly table: HTMLTableElement;
}

function fixture(rows: readonly string[]): Fixture {
  // Only this file's fixture is cleared: the document is shared, and another
  // file's markup may be sitting in the body.
  for (const stale of domDocument.querySelectorAll("[data-sort-fixture]")) {
    stale.remove();
  }

  const host = domDocument.createElement("div");

  host.setAttribute("data-sort-fixture", "");
  host.innerHTML =
    "<table><thead><tr>" +
    '<th data-sort="" scope="col">User</th>' +
    '<th data-sort="" scope="col">Score</th>' +
    '<th scope="col">Actions</th>' +
    "</tr></thead><tbody>" +
    rows.join("") +
    "</tbody></table>";
  domDocument.body.appendChild(host);

  const table = host.querySelector("table") as unknown as HTMLTableElement;

  new Function(TABLE_SORT_SCRIPT)();

  return {
    headings: Array.from(
      table.querySelectorAll("thead th"),
    ) as unknown as readonly HTMLTableCellElement[],
    order: () =>
      Array.from(table.tBodies[0]?.rows ?? []).map(
        (row) => row.cells[0]?.textContent ?? "",
      ),
    table,
  };
}

function row(name: string, score: string): string {
  const value = score === "" ? "" : ` data-sort-value="${score}"`;

  return `<tr><td>${name}</td><td${value}>${score}</td><td>…</td></tr>`;
}

function click(heading: HTMLTableCellElement): void {
  const button = heading.querySelector("button");
  // The jsdom window's own Event: one built by another realm is not an Event
  // to this document's listeners.
  const view = domDocument.defaultView as unknown as {
    readonly Event: typeof Event;
  };

  button?.dispatchEvent(new view.Event("click"));
}

describe("table column sorting", () => {
  test("a sortable heading becomes a button, and the others do not", () => {
    const { headings } = fixture([row("Zoe", "1"), row("Ada", "2")]);

    expect(headings[0]?.querySelector("button")).not.toBeNull();
    expect(headings[1]?.querySelector("button")).not.toBeNull();
    // The actions column has nothing to sort by, so it stays plain text.
    expect(headings[2]?.querySelector("button")).toBeNull();
    // The heading's own words name the control — there is no second string.
    expect(headings[0]?.querySelector("button")?.textContent).toContain(
      "User",
    );
  });

  test("one click sorts by the column, a second reverses it", () => {
    const { headings, order } = fixture([
      row("Zoe", "1"),
      row("Ada", "2"),
      row("Mo", "3"),
    ]);
    const user = headings[0] as HTMLTableCellElement;

    click(user);

    expect(order()).toEqual(["Ada", "Mo", "Zoe"]);
    expect(user.getAttribute("aria-sort")).toBe("ascending");
    expect(user.querySelector(".column-sort-mark")?.textContent).toBe("▲");

    click(user);

    expect(order()).toEqual(["Zoe", "Mo", "Ada"]);
    expect(user.getAttribute("aria-sort")).toBe("descending");
    expect(user.querySelector(".column-sort-mark")?.textContent).toBe("▼");
  });

  test("a column of numbers compares as numbers", () => {
    const { headings, order } = fixture([
      row("Ada", "9"),
      row("Mo", "10"),
      row("Zoe", "0.5"),
    ]);

    click(headings[1] as HTMLTableCellElement);

    // "10" before "9" would be the answer if these were compared as text.
    expect(order()).toEqual(["Zoe", "Ada", "Mo"]);
  });

  test("an absent value sorts last, and reversing brings it to the top", () => {
    const { headings, order } = fixture([
      row("Ada", ""),
      row("Mo", "2"),
      row("Zoe", "1"),
    ]);
    const score = headings[1] as HTMLTableCellElement;

    click(score);

    // Nothing submitted is not a zero: it sorts after every real score.
    expect(order()).toEqual(["Zoe", "Mo", "Ada"]);

    click(score);

    expect(order()).toEqual(["Ada", "Mo", "Zoe"]);
  });

  test("rows that tie keep the order the server sent them in", () => {
    const { headings, order } = fixture([
      row("Zoe", "1"),
      row("Ada", "1"),
      row("Mo", "1"),
    ]);
    const score = headings[1] as HTMLTableCellElement;

    click(score);

    expect(order()).toEqual(["Zoe", "Ada", "Mo"]);

    // Even reversed: the tiebreaker is where a row arrived, not where the
    // previous sort left it, so ties do not shuffle from click to click.
    click(score);

    expect(order()).toEqual(["Zoe", "Ada", "Mo"]);
  });

  test("sorting another column starts it over and clears the first", () => {
    const { headings, order } = fixture([
      row("Zoe", "1"),
      row("Ada", "2"),
      row("Mo", "3"),
    ]);
    const user = headings[0] as HTMLTableCellElement;
    const score = headings[1] as HTMLTableCellElement;

    click(user);
    click(score);

    expect(order()).toEqual(["Zoe", "Ada", "Mo"]);
    expect(user.getAttribute("aria-sort")).toBeNull();
    expect(user.querySelector(".column-sort-mark")?.textContent).toBe("");
    expect(score.getAttribute("aria-sort")).toBe("ascending");
  });
});
