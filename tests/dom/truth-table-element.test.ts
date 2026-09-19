import { describe, expect, test } from "bun:test";
import { dom } from "../helpers/dom";
import {
  compileExercise,
  type MountedExercise,
  markState,
  mountExercise,
  statusText,
} from "./mount-exercise";

/**
 * `<carnap-truth-table>`'s side of the widget: that it enables the grid the
 * server drew, cycles a cell on click and keeps its accessible name true,
 * mirrors the grid into the form, walks the grid with the arrow keys as one
 * tab stop, adds its Check and counterexample controls to the shared action
 * bar, grades locally in the `cells` and `terse` modes, designates a
 * counterexample row, and restores a prior answer. The grading itself is
 * `tests/truth-table.test.ts`'s; what is under test here is what the element
 * does with the verdict.
 */

// After `helpers/dom` has installed the globals, so `extends HTMLElement`
// resolves and `register` lands in the window the fixtures are built in.
await import("../../src/client/components/carnap-truth-table-v1");

/**
 * `P -> Q` with the atoms given and only the connective to fill: one cell a
 * row, four rows, whose correct column (all-true row first) is T F T T.
 */
function connectiveTable(attrs = "") {
  return compileExercise(
    `::::truth-table{#tt fill="connectives" options="autoAtoms"${attrs}}\n- P -> Q\n::::`,
  );
}

function cells(mounted: MountedExercise): HTMLButtonElement[] {
  return Array.from(
    mounted.root.querySelectorAll<HTMLButtonElement>("button.tt-cell"),
  );
}

function barButton(
  mounted: MountedExercise,
  text: string,
): HTMLButtonElement | null {
  return (
    Array.from(
      mounted.form.querySelectorAll<HTMLButtonElement>(
        ".exercise-actions button",
      ),
    ).find((button) => button.textContent === text) ?? null
  );
}

function click(mounted: MountedExercise, text: string): void {
  const button = barButton(mounted, text);
  if (button === null) {
    throw new Error(`no ${text} button`);
  }
  button.click();
}

/** Set the four connective cells to `column`, one click per cycle step. */
function fillColumn(mounted: MountedExercise, column: string): void {
  const steps: Record<string, number> = { "": 0, F: 2, T: 1 };
  cells(mounted).forEach((cell, index) => {
    for (let step = 0; step < (steps[column[index] ?? ""] ?? 0); step += 1) {
      cell.click();
    }
  });
}

function answerOf(mounted: MountedExercise): {
  cells: string[][][];
  counterexample: number | null;
  reference: string[][];
} {
  return JSON.parse(mounted.answerData.value) as ReturnType<typeof answerOf>;
}

function verdicts(mounted: MountedExercise): string[] {
  return cells(mounted).map((cell) =>
    cell.classList.contains("tt-correct")
      ? "correct"
      : cell.classList.contains("tt-incorrect")
        ? "incorrect"
        : "",
  );
}

describe("upgrading", () => {
  test("the cells come alive, and the controls join the action bar before Submit", async () => {
    const mounted = mountExercise(await connectiveTable());

    expect(mounted.element.dataset.enhanced).toBe("true");
    expect(cells(mounted)).toHaveLength(4);
    expect(cells(mounted).every((cell) => !cell.disabled)).toBe(true);
    // The order the bar reads in: Check · Find counterexample · Submit.
    expect(
      Array.from(
        mounted.form.querySelectorAll(".exercise-actions button"),
      ).map((button) => button.textContent),
    ).toEqual(["Check", "Find counterexample", "Submit answer"]);
    // The mirror is the grid as drawn: the given atoms, in the reference
    // columns and again under the formula's own letters, and one blank per
    // row where the connective goes — the worker's grader reads positions.
    expect(answerOf(mounted)).toEqual({
      cells: [
        [
          ["T", "", "T"],
          ["T", "", "F"],
          ["F", "", "T"],
          ["F", "", "F"],
        ],
      ],
      counterexample: null,
      reference: [
        ["T", "T"],
        ["T", "F"],
        ["F", "T"],
        ["F", "F"],
      ],
    });
  });

  test('feedback="none" offers no Check', async () => {
    const mounted = mountExercise(await connectiveTable(), {
      options: { feedback: "none" },
    });

    expect(barButton(mounted, "Check")).toBeNull();
    // The counterexample control is a way of answering, not of checking.
    expect(barButton(mounted, "Find counterexample")).not.toBeNull();
  });
});

describe("a cell", () => {
  test("cycles blank → T → F → blank, and its name and the mirror follow", async () => {
    const mounted = mountExercise(await connectiveTable());
    const [cell] = cells(mounted) as [HTMLButtonElement];

    expect(cell.getAttribute("aria-label")).toBe("->, row 1: blank");

    cell.click();
    expect(cell.dataset.ttValue).toBe("T");
    expect(cell.textContent).toBe("T");
    expect(cell.getAttribute("aria-label")).toBe("->, row 1: true");
    expect(answerOf(mounted).cells[0]?.[0]).toEqual(["T", "T", "T"]);

    cell.click();
    expect(cell.dataset.ttValue).toBe("F");
    expect(cell.getAttribute("aria-label")).toBe("->, row 1: false");

    cell.click();
    expect(cell.dataset.ttValue).toBe("");
    expect(cell.textContent).toBe("–");
    expect(answerOf(mounted).cells[0]?.[0]).toEqual(["T", "", "T"]);
  });

  test("the grid is one tab stop, walked with the arrows", async () => {
    const mounted = mountExercise(await connectiveTable());
    const [first, second] = cells(mounted) as [
      HTMLButtonElement,
      HTMLButtonElement,
    ];

    expect(cells(mounted).map((cell) => cell.tabIndex)).toEqual([
      0, -1, -1, -1,
    ]);

    first.focus();
    first.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowDown",
      }),
    );

    expect(mounted.root.activeElement).toBe(second);
    expect(cells(mounted).map((cell) => cell.tabIndex)).toEqual([
      -1, 0, -1, -1,
    ]);
  });
});

describe("Check", () => {
  test("marks every cell and counts the correct ones", async () => {
    const mounted = mountExercise(await connectiveTable());

    fillColumn(mounted, "TTTT");
    click(mounted, "Check");

    expect(statusText(mounted)).toBe("Correct cells: 3 of 4");
    expect(verdicts(mounted)).toEqual([
      "correct",
      "incorrect",
      "correct",
      "correct",
    ]);
    expect(markState(mounted)).toBe("idle");

    // Fixing the cell wipes the verdict: it was about a different grid.
    (cells(mounted)[1] as HTMLButtonElement).click();
    expect(verdicts(mounted)).toEqual(["", "", "", ""]);
    expect(statusText(mounted)).toBe("");

    click(mounted, "Check");
    expect(statusText(mounted)).toBe("All cells correct.");
    expect(markState(mounted)).toBe("ok");
  });

  test("in terse mode says only whether the table is right", async () => {
    const mounted = mountExercise(await connectiveTable(), {
      options: { feedback: "terse" },
    });

    fillColumn(mounted, "TTTT");
    click(mounted, "Check");

    expect(statusText(mounted)).toBe("There's an error somewhere.");
    expect(verdicts(mounted)).toEqual(["", "", "", ""]);
  });
});

describe("a counterexample", () => {
  test("is a designated row of the grid as the student filled it", async () => {
    const mounted = mountExercise(await connectiveTable());
    fillColumn(mounted, "TFTT");

    click(mounted, "Find counterexample");

    const toggle = barButton(mounted, "Cancel counterexample");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(statusText(mounted)).toBe(
      "Fill in a row where every formula is false, then mark it as your counterexample.",
    );
    const radios = Array.from(
      mounted.root.querySelectorAll<HTMLInputElement>("input.tt-ce-radio"),
    );
    expect(radios).toHaveLength(4);
    expect(radios.every((radio) => !radio.disabled)).toBe(true);

    // No row yet: Check asks for one rather than grading nothing.
    click(mounted, "Check");
    expect(statusText(mounted)).toBe(
      "Choose the row you're claiming as a counterexample.",
    );

    // Row 2 (P true, Q false) is where P -> Q is false.
    const row = radios[1] as HTMLInputElement;
    row.checked = true;
    row.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(answerOf(mounted).counterexample).toBe(1);
    expect(
      mounted.root
        .querySelectorAll("tbody tr")[1]
        ?.classList.contains("tt-ce-row"),
    ).toBe(true);

    click(mounted, "Check");
    expect(statusText(mounted)).toBe("That's a valid counterexample.");
    expect(markState(mounted)).toBe("ok");

    // Leaving the mode makes it an ordinary submission of the whole grid.
    click(mounted, "Cancel counterexample");
    expect(answerOf(mounted).counterexample).toBeNull();
    expect(barButton(mounted, "Find counterexample")).not.toBeNull();
  });
});

describe("a prior answer", () => {
  test("comes back into the cells, and a designated row comes back designated", async () => {
    const mounted = mountExercise(await connectiveTable(), {
      priorAnswer: {
        cells: [
          [
            ["T", "T", "T"],
            ["T", "F", "F"],
            ["F", "", "T"],
            ["F", "T", "F"],
          ],
        ],
        counterexample: 1,
        reference: [
          ["T", "T"],
          ["T", "F"],
          ["F", "T"],
          ["F", "F"],
        ],
      },
    });

    expect(cells(mounted).map((cell) => cell.dataset.ttValue)).toEqual([
      "T",
      "F",
      "",
      "T",
    ]);
    expect(barButton(mounted, "Cancel counterexample")).not.toBeNull();
    expect(
      mounted.root.querySelector<HTMLInputElement>(
        'input.tt-ce-radio[value="1"]',
      )?.checked,
    ).toBe(true);
    expect(answerOf(mounted)).toMatchObject({
      cells: [
        [
          ["T", "T", "T"],
          ["T", "F", "F"],
          ["F", "", "T"],
          ["F", "T", "F"],
        ],
      ],
      counterexample: 1,
    });
  });
});
