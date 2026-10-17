import { beforeEach, describe, expect, test } from "bun:test";
import { UNSAVED_ANSWER_ATTRIBUTE } from "../../src/worker/exercise-kit/answer-events";
import { theorySourceByFileName } from "../../src/worker/logic/theories";
import { dom } from "../helpers/dom";
import { engine } from "../helpers/engine";
import {
  compileExercise,
  type MountedExercise as Mounted,
  markState,
  mountExercise,
  statusText,
  submitForm,
  until,
} from "./mount-exercise";
import { mockProofCompiler } from "./proof-compiler-mock";

/**
 * `<carnap-truth-tree>`'s side of the widget: that the island replaces the
 * inert root with a live tree, that each action works on the branch at the
 * cursor and is announced, and that the answer the form carries is the
 * tree.
 */

// The real engine behind the loader: the tree is compiled as a proof is, and
// what the engine says of it is what these tests are about.
const compiler = await engine();
const compile = await mockProofCompiler((mm0, proof) =>
  compiler.compile(mm0, proof),
);

// After `helpers/dom` has installed the globals, so `extends HTMLElement`
// resolves and `register` lands in the window the fixtures are built in.
await import("../../src/client/components/carnap-truth-tree-v1");

// A widget left in the page from an earlier test, with a compile still
// debounced, would compile under this one's mock: count as this test's call,
// or take a failure meant for this test's widget.
beforeEach(() => {
  for (const form of Array.from(
    dom.window.document.querySelectorAll("form.exercise-submission"),
  )) {
    form.remove();
  }
});

function treeExercise(attrs: string, body: string) {
  return compileExercise(`::::truth-tree{#t ${attrs}}\n${body}\n::::`);
}

interface AnswerRow {
  readonly id: string;
  readonly text: string;
  readonly cites: readonly string[];
  readonly dev: string;
}

interface Answer {
  readonly rules?: Readonly<Record<string, string>>;
  readonly nodes: readonly {
    readonly id: string;
    readonly parent: string | null;
    readonly rows: readonly AnswerRow[];
    readonly end?: { readonly type: string };
  }[];
}

function answerOf(mounted: Mounted): Answer {
  return JSON.parse(mounted.answerData.value) as Answer;
}

function rows(mounted: Mounted): HTMLElement[] {
  return [...mounted.root.querySelectorAll<HTMLElement>("[role='treeitem']")];
}

function row(mounted: Mounted, text: string): HTMLElement {
  const found = rows(mounted).find(
    (each) =>
      each.querySelector(".tableau-text")?.textContent?.trim() === text,
  );

  if (found === undefined) {
    throw new Error(`no row ${text}`);
  }

  return found;
}

function cursor(mounted: Mounted): HTMLElement {
  const found = mounted.root.querySelector<HTMLElement>("[data-cursor]");

  if (found === null) {
    throw new Error("no cursor");
  }

  return found;
}

function press(
  target: Element,
  key: string,
  init: KeyboardEventInit = {},
): void {
  target.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { bubbles: true, key, ...init }),
  );
}

function fill(input: HTMLInputElement | null, value: string): void {
  if (input === null) {
    throw new Error("no input");
  }

  input.value = value;
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function announced(mounted: Mounted): string {
  return (
    mounted.root
      .querySelector("[data-role='announce']")
      ?.textContent?.trim() ?? ""
  );
}

/** Write a row's text, then cite a row by number, as a student types them. */
function write(mounted: Mounted, text: string, cite: string): void {
  fill(mounted.root.querySelector<HTMLInputElement>(".tableau-input"), text);
  press(mounted.root.querySelector(".tableau-input") as Element, "c", {
    altKey: true,
    code: "KeyC",
  });
  const input = mounted.root.querySelector<HTMLInputElement>(
    ".tableau-cite-input",
  );
  fill(input, cite);
  press(input as Element, "Enter");
}

/** Name the rule of the step at the cursor, as a student types it. */
function name(mounted: Mounted, rule: string, key = "Enter"): void {
  press(cursor(mounted), "j");
  const input = mounted.root.querySelector<HTMLInputElement>(
    ".tableau-rule-input",
  );
  fill(input, rule);
  press(input as Element, key);
}

/** A field of the margin on a line, found by the line number beside it. */
function marginField(
  mounted: Mounted,
  line: number,
  field: "cites" | "rule",
): HTMLElement | null {
  const number = [
    ...mounted.root.querySelectorAll<HTMLElement>(".tableau-number"),
  ].find((each) => each.textContent === String(line));
  const margin = [
    ...mounted.root.querySelectorAll<HTMLElement>(".tableau-margin"),
  ].find((each) => each.style.gridRow === number?.style.gridRow);

  return (
    margin?.querySelector<HTMLElement>(`.tableau-margin-${field}`) ?? null
  );
}

describe("upgrading", () => {
  test("the toolbar is icon buttons, named for their actions", async () => {
    const mounted = mountExercise(await treeExercise("", "- P & Q\n- ¬P"));
    const buttons = [
      ...mounted.root.querySelectorAll<HTMLButtonElement>(
        "[role='toolbar'] button",
      ),
    ];

    // Every branch is to close, so no branch is marked open.
    expect(
      buttons.map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Stack",
      "Split",
      "Add row",
      "Close",
      "Delete",
      "Undo",
      "Redo",
    ]);

    const open = mountExercise(
      await treeExercise('finish="one-open"', "- P & Q\n- ¬P"),
    );
    expect(
      [
        ...open.root.querySelectorAll<HTMLButtonElement>(
          "[role='toolbar'] button",
        ),
      ].map((button) => button.getAttribute("aria-label")),
    ).toContain("Mark open");
    expect(buttons.every((button) => button.textContent === "")).toBe(true);
    expect(
      buttons.every((button) => button.querySelector("svg") !== null),
    ).toBe(true);
  });

  test("the island draws the root as a tree, and the answer is the root", async () => {
    const mounted = mountExercise(await treeExercise("", "- P & Q\n- ¬P"));

    expect(mounted.element.dataset.enhanced).toBe("true");
    expect(
      mounted.root.querySelector("fieldset")?.hasAttribute("aria-busy"),
    ).toBe(false);
    expect(mounted.root.querySelector("[role='tree']")).not.toBeNull();
    expect(
      rows(mounted).map((each) => each.getAttribute("aria-label")),
    ).toEqual(["Row 1: P & Q", "Row 2: ¬P"]);
    expect(answerOf(mounted).nodes[0]?.rows.map((each) => each.text)).toEqual(
      ["P & Q", "¬P"],
    );
  });

  test("a prior answer is restored, with fresh ids", async () => {
    const prior = {
      nodes: [
        {
          id: "old-root",
          parent: null,
          rows: [
            { cites: [], dev: "root", id: "r1", text: "P & Q" },
            { cites: [], dev: "root", id: "r2", text: "¬P" },
            { cites: ["r1"], dev: "d1", id: "r3", text: "P" },
            { cites: ["r1"], dev: "d1", id: "r4", text: "Q" },
          ],
        },
      ],
      rules: { d1: "&" },
    };
    const mounted = mountExercise(await treeExercise("", "- P & Q\n- ¬P"), {
      priorAnswer: prior,
    });
    const answer = answerOf(mounted);
    const restored = answer.nodes[0]?.rows ?? [];

    expect(restored.map((each) => each.text)).toEqual([
      "P & Q",
      "¬P",
      "P",
      "Q",
    ]);
    expect(restored.some((each) => each.id === "r1")).toBe(false);
    // The citation followed its row to the new id, and the rule its step.
    expect(restored[2]?.cites).toEqual([restored[0]?.id ?? ""]);
    expect(restored[2]?.dev).not.toBe("d1");
    expect(answer.rules).toEqual({ [restored[2]?.dev ?? ""]: "&" });
  });

  test("a general step's instances are asked of the engine, and go in the answer", async () => {
    // `Rab` could be the instance at a or at b: a first compile asks, and a
    // second certifies the instances that held.
    const prior = {
      nodes: [
        {
          end: { type: "open" },
          id: "old-root",
          parent: null,
          rows: [
            { cites: [], dev: "root", id: "r1", text: "∀xRxb" },
            { cites: [], dev: "root", id: "r2", text: "Fa" },
            { cites: ["r1"], dev: "d1", id: "r3", text: "Rab" },
            { cites: ["r1"], dev: "d1", id: "r4", text: "Rbb" },
          ],
        },
      ],
      rules: { d1: "∀" },
    };
    const mounted = mountExercise(
      await treeExercise(
        'finish="one-open"',
        "Is this set consistent?\n\n- ∀x Rxb\n- Fa",
      ),
      { priorAnswer: prior },
    );

    mounted.form
      .querySelector<HTMLButtonElement>(".truth-tree-check")
      ?.click();
    await until(() => statusText(mounted) !== "", 3_000);

    expect(markState(mounted)).toBe("ok");

    const answer = JSON.parse(mounted.answerData.value) as {
      instances?: Record<string, string>;
      mmb?: string;
      nodes: Answer["nodes"];
    };
    const [, , rab, rbb] = answer.nodes[0]?.rows ?? [];

    expect(answer.instances).toEqual({
      [rab?.id ?? ""]: "a",
      [rbb?.id ?? ""]: "b",
    });
    // The certificate states only the instances that held, a second compile
    // that waits for a submit: typing pays for one compile, not two.
    expect(answer.mmb).toBeUndefined();
    // What the engine made of the tree is not work the student has to save.
    expect(mounted.element.hasAttribute(UNSAVED_ANSWER_ATTRIBUTE)).toBe(
      false,
    );

    // The page runtime's bubbling listener: a submit that is not cancelled
    // would be fetched, never navigated.
    const sent: string[] = [];
    mounted.form.addEventListener("submit", (event) => {
      if (!event.defaultPrevented) {
        sent.push(mounted.answerData.value);
        event.preventDefault();
      }
    });

    expect(submitForm(mounted).defaultPrevented).toBe(true);
    await until(() => sent.length > 0, 3_000);

    const submitted = JSON.parse(sent[0] ?? "{}") as { mmb?: string };
    expect(submitted.mmb).toBeDefined();
  });

  test("a prior answer's instances are kept until the engine says again, and an edit keeps them", async () => {
    const prior = {
      nodes: [
        {
          id: "old-root",
          parent: null,
          rows: [
            { cites: [], dev: "root", id: "r1", text: "∀xRxb" },
            { cites: [], dev: "root", id: "r2", text: "Fa" },
            { cites: ["r1"], dev: "d1", id: "r3", text: "Rab" },
            { cites: ["r1"], dev: "d1", id: "r4", text: "Rbb" },
          ],
        },
      ],
      instances: { r3: "a", r4: "b" },
      rules: { d1: "∀" },
    };
    const mounted = mountExercise(
      await treeExercise(
        'finish="one-open"',
        "Is this set consistent?\n\n- ∀x Rxb\n- Fa",
      ),
      { priorAnswer: prior },
    );
    const instancesOf = () =>
      (
        JSON.parse(mounted.answerData.value) as {
          instances?: Record<string, string>;
        }
      ).instances;
    const [, , rab, rbb] = answerOf(mounted).nodes[0]?.rows ?? [];

    // Before any compile: the prior's, on their rows' fresh ids.
    expect(instancesOf()).toEqual({
      [rab?.id ?? ""]: "a",
      [rbb?.id ?? ""]: "b",
    });

    // Marking the branch open is an edit; the general row is still
    // instantiated for both names, so the branch is not flagged incomplete
    // while the compile it starts is pending.
    press(cursor(mounted), "o");
    const end = mounted.root.querySelector(".tableau-end");

    expect(end).not.toBeNull();
    expect(end?.hasAttribute("data-flagged")).toBe(false);
    expect(instancesOf()).toEqual({
      [rab?.id ?? ""]: "a",
      [rbb?.id ?? ""]: "b",
    });
  });

  test("the rules are the answer in one order, however they were typed", async () => {
    const mounted = mountExercise(await treeExercise("", "- P & Q\n- ¬P"));

    press(cursor(mounted), "t");
    write(mounted, "P", "1");
    name(mounted, "&");
    press(cursor(mounted), "t");
    write(mounted, "Q", "1");
    name(mounted, "&");

    const typed = mounted.answerData.value;
    const first = rows(mounted).find(
      (each) => each.querySelector(".tableau-text")?.textContent === "P",
    );

    // Clear the first step's rule and type it again: the same answer.
    first?.click();
    name(mounted, "");
    name(mounted, "&");

    expect(mounted.answerData.value).toBe(typed);
  });

  test("a tree past the row cap is refused without asking the engine", async () => {
    const extra = Array.from({ length: 200 }, (_, at) => ({
      cites: ["r1"],
      dev: `d${at}`,
      id: `x${at}`,
      text: "P",
    }));
    const prior = {
      nodes: [
        {
          id: "old-root",
          parent: null,
          rows: [{ cites: [], dev: "root", id: "r1", text: "P" }, ...extra],
        },
      ],
      // Each step names a rule, so the tree is a derivation the engine
      // could be asked about.
      rules: Object.fromEntries(extra.map((each) => [each.dev, "∧"])),
    };
    const mounted = mountExercise(
      await treeExercise(
        'finish="one-open"',
        "Is this set consistent?\n\n- P",
      ),
      { priorAnswer: prior },
    );
    const before = compile.mock.calls.length;

    mounted.form
      .querySelector<HTMLButtonElement>(".truth-tree-check")
      ?.click();
    await until(() => statusText(mounted) !== "", 3_000);

    expect(statusText(mounted)).toContain("at most 200 rows");
    expect(compile.mock.calls.length).toBe(before);
  });

  test("a prior answer on a root the exercise no longer gives is set aside", async () => {
    // As after a correction changed the root: the root cannot be edited, so
    // restoring this tree would leave it wrong for good.
    const prior = {
      nodes: [
        {
          id: "old-root",
          parent: null,
          rows: [
            { cites: [], dev: "root", id: "r1", text: "Q & P" },
            { cites: [], dev: "root", id: "r2", text: "¬P" },
            { cites: ["r1"], dev: "d1", id: "r3", text: "Q" },
          ],
        },
      ],
    };
    const mounted = mountExercise(await treeExercise("", "- P & Q\n- ¬P"), {
      priorAnswer: prior,
    });

    expect(answerOf(mounted).nodes[0]?.rows.map((each) => each.text)).toEqual(
      ["P & Q", "¬P"],
    );
  });
});

describe("when the engine fails", () => {
  const ENGINE_FAILURE =
    "The proof engine couldn't read this proof — check for unexpected characters.";

  test("the mark says so, and so does the Check", async () => {
    const mounted = mountExercise(await treeExercise("", "- P & Q\n- ¬P"));

    compile.mockImplementationOnce(() => {
      throw new Error("wasm trap");
    });
    // A step nothing but the engine could find fault with.
    press(cursor(mounted), "t");
    write(mounted, "P", "1");
    name(mounted, "&");
    press(cursor(mounted), "r");
    write(mounted, "Q", "1");

    await until(() => markState(mounted) === "error", 3_000);

    mounted.form
      .querySelector<HTMLButtonElement>(".truth-tree-check")
      ?.click();
    await until(() => statusText(mounted) !== "", 3_000);

    expect(statusText(mounted)).toBe(ENGINE_FAILURE);
    expect(markState(mounted)).toBe("error");
  });

  test("a certificate that does not compile at submit takes back the check, and the submit", async () => {
    const prior = {
      nodes: [
        {
          end: { type: "open" },
          id: "old-root",
          parent: null,
          rows: [
            { cites: [], dev: "root", id: "r1", text: "∀xRxb" },
            { cites: [], dev: "root", id: "r2", text: "Fa" },
            { cites: ["r1"], dev: "d1", id: "r3", text: "Rab" },
            { cites: ["r1"], dev: "d1", id: "r4", text: "Rbb" },
          ],
        },
      ],
      rules: { d1: "∀" },
    };
    const mounted = mountExercise(
      await treeExercise(
        'finish="one-open"',
        "Is this set consistent?\n\n- ∀x Rxb\n- Fa",
      ),
      { priorAnswer: prior },
    );

    mounted.form
      .querySelector<HTMLButtonElement>(".truth-tree-check")
      ?.click();
    await until(() => statusText(mounted) !== "", 3_000);
    expect(markState(mounted)).toBe("ok");

    const sent: string[] = [];
    mounted.form.addEventListener("submit", (event) => {
      if (!event.defaultPrevented) {
        sent.push(mounted.answerData.value);
        event.preventDefault();
      }
    });

    // The certificate the submit waits on does not come.
    compile.mockImplementationOnce(() => ({ diagnostics: [], ok: false }));
    expect(submitForm(mounted).defaultPrevented).toBe(true);
    await until(() => markState(mounted) !== "ok", 3_000);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sent).toEqual([]);
  });
});

describe("type mode", () => {
  test("stack, write, cite, close, and check", async () => {
    const mounted = mountExercise(await treeExercise("", "- P & Q\n- ¬P"));

    press(cursor(mounted), "t");
    expect(announced(mounted)).toBe("New row 3.");
    write(mounted, "P", "1");
    expect(announced(mounted)).toBe("Row 3 now cites row 1.");
    name(mounted, "&");

    press(cursor(mounted), "r");
    write(mounted, "Q", "1");

    // x, then the two rows it closes on, ticked in their circles.
    press(cursor(mounted), "x");
    const circle = () => mounted.root.activeElement as HTMLElement;
    press(circle(), "ArrowUp");
    press(circle(), "Enter");
    press(circle(), "ArrowUp");
    press(circle(), "Enter");
    expect(announced(mounted)).toBe("Branch closed on rows 3 and 2");

    mounted.form
      .querySelector<HTMLButtonElement>(".truth-tree-check")
      ?.click();
    await until(() => statusText(mounted) !== "", 3_000);
    expect(statusText(mounted)).toBe("Right: every branch closes.");
    expect(markState(mounted)).toBe("ok");
    // The answer carries the engine's certificate, for the server to verify.
    expect(
      (JSON.parse(mounted.answerData.value) as { mmb?: string }).mmb,
    ).toBeDefined();
    // The tree is the whole answer: there is no question to answer.
    expect(mounted.root.querySelector("input[type='radio']")).toBeNull();
  });

  test("the arrows go on from the end of a line to its citation", async () => {
    const mounted = mountExercise(await treeExercise("", "- P & Q\n- ¬P"));
    const active = () => mounted.root.activeElement as HTMLElement;
    const stop = () =>
      mounted.root.querySelector<HTMLElement>("[data-margin-stop]");

    press(cursor(mounted), "t");
    fill(active() as HTMLInputElement, "P");
    press(active(), "Escape");

    // → from the end of the line selects its citation, the tree's one stop.
    press(active(), "ArrowRight");
    expect(active()).toBe(stop() as HTMLElement);
    expect(active().getAttribute("role")).toBe("treeitem");
    expect(active().getAttribute("aria-label")).toBe(
      "Citation of row 3, not yet written",
    );
    expect(row(mounted, "P").tabIndex).toBe(-1);

    // Enter types it, and finishing goes back to the citation, not the row.
    press(active(), "Enter");
    fill(active() as HTMLInputElement, "1");
    press(active(), "Enter");
    expect(active()).toBe(stop() as HTMLElement);
    expect(active().getAttribute("aria-label")).toBe("Citation of row 3: 1");

    // Delete clears the citation and keeps the row.
    press(active(), "Delete");
    expect(announced(mounted)).toBe("Row 3 no longer cites a row.");
    expect(answerOf(mounted).nodes[0]?.rows[2]).toMatchObject({
      cites: [],
      text: "P",
    });

    // ← goes back to the row.
    press(active(), "ArrowLeft");
    expect(stop()).toBeNull();
    expect(active()).toBe(row(mounted, "P"));

    // A row that continues a step has no citation of its own to go on to.
    press(active(), "r");
    fill(active() as HTMLInputElement, "Q");
    press(active(), "Escape");
    press(active(), "ArrowRight");
    expect(stop()).toBeNull();
    expect(active()).toBe(row(mounted, "Q"));

    // ↑ and ↓ go between the citations of the lines that have one.
    press(active(), "t");
    fill(active() as HTMLInputElement, "¬Q");
    press(active(), "Escape");
    press(active(), "ArrowRight");
    expect(active().getAttribute("aria-label")).toBe(
      "Citation of row 5, not yet written",
    );
    press(active(), "ArrowUp");
    expect(active().getAttribute("aria-label")).toBe(
      "Citation of row 3, not yet written",
    );
  });

  test("a step is justified once, beside its first row, as in the book", async () => {
    const mounted = mountExercise(await treeExercise("", "- P & Q\n- ¬P"));
    // The margin on a line, found by the line number beside it.
    const marginOn = (line: number): HTMLElement | undefined => {
      const number = [
        ...mounted.root.querySelectorAll<HTMLElement>(".tableau-number"),
      ].find((each) => each.textContent === String(line));

      return [
        ...mounted.root.querySelectorAll<HTMLElement>(".tableau-margin"),
      ].find((each) => each.style.gridRow === number?.style.gridRow);
    };

    press(cursor(mounted), "t");
    write(mounted, "P", "1");
    // The rule is typed, in any of its spellings, and shown in the book's.
    name(mounted, "^");
    expect(announced(mounted)).toBe("Row 3 now names the rule &.");
    press(cursor(mounted), "r");
    fill(mounted.root.querySelector<HTMLInputElement>(".tableau-input"), "Q");
    press(mounted.root.querySelector(".tableau-input") as Element, "Enter");

    // Row 4 continues row 3's step: its margin is blank, and not a slot.
    expect(marginOn(3)?.textContent).toBe("1 &");
    expect(answerOf(mounted)).toMatchObject({
      rules: { [answerOf(mounted).nodes[0]?.rows[2]?.dev ?? ""]: "&" },
    });
    expect(marginOn(4)).toBeUndefined();

    // Citing from row 4 types the step's citation, beside row 3.
    press(cursor(mounted), "c");
    const input = mounted.root.querySelector<HTMLInputElement>(
      ".tableau-cite-input",
    );
    expect(input?.value).toBe("1");
    expect(marginOn(3)?.contains(input as Node)).toBe(true);
    press(input as Element, "Escape");

    // A new step citing the same row says so in its own margin, with a slot
    // for the rule it has not named yet.
    press(cursor(mounted), "Delete");
    press(cursor(mounted), "t");
    write(mounted, "Q", "1");
    expect(marginField(mounted, 4, "cites")?.textContent).toBe("1");
    expect(
      marginField(mounted, 4, "rule")?.querySelector(".tableau-margin-slot"),
    ).not.toBeNull();
  });

  test("a branch's end mark takes the cursor, and Delete takes it back", async () => {
    const mounted = mountExercise(await treeExercise("", "- P & Q\n- ¬P"));
    // x, then a click on the circle of each row it closes on.
    const close = () => {
      press(cursor(mounted), "x");
      for (const line of [2, 3]) {
        mounted.root
          .querySelector<HTMLInputElement>(
            `.tableau-pick[aria-label='Close the branch on row ${line}']`,
          )
          ?.click();
      }
    };

    press(cursor(mounted), "t");
    write(mounted, "P", "1");
    close();

    // ↓ from the branch's last row lands on its ×, a tree item of its own.
    press(cursor(mounted), "ArrowDown");
    expect(cursor(mounted).classList.contains("tableau-end")).toBe(true);
    expect(cursor(mounted).getAttribute("role")).toBe("treeitem");
    expect(cursor(mounted).getAttribute("aria-label")).toBe(
      "Branch closed on rows 2 and 3",
    );
    expect(mounted.root.activeElement).toBe(cursor(mounted));
    // The row above no longer says it, now the mark does.
    expect(row(mounted, "P").getAttribute("aria-label")).not.toContain(
      "Branch closed",
    );

    press(cursor(mounted), "Delete");
    expect(announced(mounted)).toBe("Branch reopened.");
    expect(mounted.root.querySelector(".tableau-end")).toBeNull();
    expect(cursor(mounted)).toBe(row(mounted, "P"));
    expect(mounted.root.activeElement).toBe(cursor(mounted));

    // A click puts the cursor on the mark, and nothing is typed there.
    close();
    mounted.root.querySelector<HTMLElement>(".tableau-end")?.click();
    expect(cursor(mounted).classList.contains("tableau-end")).toBe(true);
    expect(mounted.root.querySelector(".tableau-input")).toBeNull();
    press(cursor(mounted), "c");
    expect(mounted.root.querySelector(".tableau-input")).toBeNull();
    expect(mounted.root.querySelector(".tableau-cite-input")).toBeNull();

    // Undo brings the mark back, and the cursor with it.
    press(cursor(mounted), "Delete");
    press(cursor(mounted), "z", { ctrlKey: true });
    expect(cursor(mounted).classList.contains("tableau-end")).toBe(true);
  });

  test("closing marks its rows, as a counterexample row is marked", async () => {
    const mounted = mountExercise(
      await treeExercise("", "- A ∨ B\n- ¬A\n- ¬B"),
    );
    const marked = () =>
      rows(mounted)
        .filter((each) => each.hasAttribute("data-picked"))
        .map((each) => each.getAttribute("aria-label"));
    const closeButton = () =>
      mounted.root.querySelector<HTMLButtonElement>(
        "[role='toolbar'] button[aria-label='Close']",
      );

    press(cursor(mounted), "s");
    write(mounted, "A", "1");
    press(cursor(mounted), "ArrowRight");
    press(cursor(mounted), "Enter");
    fill(mounted.root.querySelector<HTMLInputElement>(".tableau-input"), "B");
    press(mounted.root.querySelector(".tableau-input") as Element, "Enter");
    press(cursor(mounted), "ArrowLeft");
    press(cursor(mounted), "x");

    const circles = () => [
      ...mounted.root.querySelectorAll<HTMLInputElement>(".tableau-pick"),
    ];
    const focused = () => mounted.root.activeElement as HTMLElement;

    // The mode says what to do, with a circle beside each of the branch's
    // rows and none for the other branch's (B shares line 4 with A), and
    // focus goes to the cursor's circle.
    expect(
      mounted.root.querySelector("[data-role='closing'] p")?.textContent,
    ).toBe("Mark the rows that close this branch");
    expect(closeButton()?.getAttribute("aria-pressed")).toBe("true");
    expect(circles().map((each) => each.getAttribute("aria-label"))).toEqual([
      "Close the branch on row 1",
      "Close the branch on row 2",
      "Close the branch on row 3",
      "Close the branch on row 4",
    ]);
    expect(focused()).toBe(circles()[3] as HTMLElement);

    // The circles are the only way in: the rows leave the tab order, and a
    // click on one marks nothing.
    expect(rows(mounted).some((each) => each.hasAttribute("tabindex"))).toBe(
      false,
    );
    row(mounted, "A").click();
    expect(marked()).toEqual([]);
    // Nor does a press on a row take focus off the circle.
    const mousedown = new dom.window.MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    row(mounted, "A").dispatchEvent(mousedown);
    expect(mousedown.defaultPrevented).toBe(true);

    // Up and down move between the circles, taking the cursor along; Enter
    // ticks one, as a click does, and focus stays on it.
    press(focused(), "ArrowUp");
    press(focused(), "ArrowUp");
    expect(focused()).toBe(circles()[1] as HTMLElement);
    expect(cursor(mounted)).toBe(row(mounted, "¬A"));
    press(focused(), "Enter");
    expect(announced(mounted)).toBe("Row 2 marked.");
    expect(circles()[1]?.checked).toBe(true);
    expect(row(mounted, "¬A").hasAttribute("data-picked")).toBe(true);
    circles()[1]?.click();
    expect(announced(mounted)).toBe("Row 2 unmarked.");
    expect(focused()).toBe(circles()[1] as HTMLElement);
    expect(marked()).toEqual([]);

    // Esc puts it away: the tree is as it was, and focus is back on a row.
    press(focused(), "Escape");
    expect(mounted.root.querySelector("[data-role='closing']")).toBeNull();
    expect(closeButton()?.getAttribute("aria-pressed")).toBe("false");
    expect(mounted.root.querySelector(".tableau-end")).toBeNull();
    expect(focused()).toBe(cursor(mounted));

    // Closed on two circles; Enter on the × marks them again, from its own.
    press(cursor(mounted), "ArrowDown");
    press(cursor(mounted), "ArrowDown");
    press(cursor(mounted), "x");
    circles()[3]?.click();
    circles()[1]?.click();
    expect(announced(mounted)).toBe("Branch closed on rows 4 and 2");
    expect(circles()).toEqual([]);
    expect(focused()).toBe(cursor(mounted));
    press(row(mounted, "A"), "ArrowDown");
    press(cursor(mounted), "Enter");
    expect(marked()).toHaveLength(2);
  });

  test("a substitution cites two rows, and a ≠ a closes on one circle", async () => {
    const mounted = mountExercise(await treeExercise("", "- Fa\n- a = b"));

    press(cursor(mounted), "t");
    write(mounted, "Fb", "1, 2");
    expect(announced(mounted)).toBe("Row 3 now cites rows 1 and 2.");
    expect(row(mounted, "Fb").getAttribute("aria-label")).toBe(
      "Row 3: Fb, from rows 1 and 2, no rule named",
    );
    name(mounted, "=");
    expect(row(mounted, "Fb").getAttribute("aria-label")).toBe(
      "Row 3: Fb, from rows 1 and 2, =",
    );
    expect(mounted.root.querySelector("[data-flagged]")).toBeNull();

    press(cursor(mounted), "t");
    write(mounted, "b ≠ b", "2, 3");
    name(mounted, "=");
    // Not what the identity writes from row 3, so the engine refuses it; a ≠ a
    // closes alone all the same, at its first tick.
    await until(
      () => row(mounted, "b ≠ b").hasAttribute("data-flagged"),
      3_000,
    );
    press(cursor(mounted), "x");
    press(mounted.root.activeElement as Element, "Enter");
    expect(announced(mounted)).toBe("Branch closed on row 4");
    const end = mounted.root.querySelector(".tableau-end");
    expect(end?.getAttribute("aria-label")).toBe("Branch closed on row 4");
  });

  test("two splits on one row share a line only when their rules agree", async () => {
    const mounted = mountExercise(
      await treeExercise(
        'finish="one-open"',
        "- ∃xFx\n- ∃xGx\n- ¬∃x(Fx & Gx)",
      ),
    );
    const leave = () =>
      press(
        mounted.root.querySelector(".tableau-input") as Element,
        "Escape",
      );
    const typeAt = (target: HTMLElement, text: string) => {
      target.click();
      fill(
        mounted.root.querySelector<HTMLInputElement>(".tableau-input"),
        text,
      );
      leave();
    };
    const blank = () =>
      rows(mounted).find(
        (each) => each.querySelector(".tableau-text")?.textContent === "",
      ) as HTMLElement;
    const second = (text: string) =>
      rows(mounted).filter(
        (each) => each.querySelector(".tableau-text")?.textContent === text,
      )[1] as HTMLElement;
    const line = (target: HTMLElement) =>
      target.getAttribute("aria-label")?.match(/^Row (\d+)/)?.[1];

    for (const [text, cite, rule] of [
      ["Fa", "1", "∃"],
      ["Gb", "2", "∃"],
      ["¬(Fa & Ga)", "3", "¬∃"],
      ["¬(Fb & Gb)", "3", "¬∃"],
    ] as const) {
      press(cursor(mounted), "t");
      write(mounted, text, cite);
      name(mounted, rule);
    }

    press(cursor(mounted), "s");
    write(mounted, "¬Fb", "7");
    name(mounted, "¬&");
    typeAt(blank(), "¬Gb");
    // The left split, by ¬& from row 6.
    row(mounted, "¬Fb").click();
    leave();
    press(cursor(mounted), "s");
    write(mounted, "¬Fa", "6");
    name(mounted, "¬&");
    typeAt(blank(), "¬Ga");
    // The right split, cited from row 6 with no rule yet: its own line, whose
    // margin says so, not the left split's line and rule.
    row(mounted, "¬Gb").click();
    leave();
    press(cursor(mounted), "s");
    write(mounted, "¬Fa", "6");
    typeAt(blank(), "¬Ga");

    expect(line(second("¬Fa"))).toBe("10");
    expect(marginField(mounted, 9, "rule")?.textContent).toBe("¬&");
    expect(marginField(mounted, 10, "cites")?.textContent).toBe("6");
    expect(marginField(mounted, 10, "rule")?.textContent).toBe("");

    // A wrong rule shows beside the rows it is wrong for.
    second("¬Ga").click();
    leave();
    name(mounted, "¬∃");
    expect(marginField(mounted, 10, "rule")?.textContent).toBe("¬∃");
    await until(() => second("¬Fa").hasAttribute("data-flagged"), 3_000);

    // The same rule as the left split's: the two share line 9, under one
    // margin that is true of both.
    second("¬Ga").click();
    leave();
    name(mounted, "¬&");
    expect(line(second("¬Fa"))).toBe("9");
    expect(marginField(mounted, 9, "rule")?.textContent).toBe("¬&");
    expect(marginField(mounted, 10, "rule")).toBeNull();
    await until(
      () => mounted.root.querySelector("[data-flagged]") === null,
      3_000,
    );
  }, 30_000);

  test("a closure rule citing three rows closes at the third circle", async () => {
    // An author's theory whose closure also cites a sentence, another, and the
    // negation of their conjunction.
    const ubc = (theorySourceByFileName("forallx-ubc.mm0") ?? "").replace(
      "--| @fallback tb_close_neq\n",
      "--| @fallback tb_close_neq\naxiom tb_close_three (ga: ctx) (ph ps: wff): $ focus ga at (ph ; ps ; ¬ (ph & ps)) $;\n--| @fallback tb_close_three\n",
    );
    const mounted = mountExercise(
      await compileExercise(
        `:::aufbau-mm0{name="three"}\n${ubc}\n:::\n\n::::truth-tree{#t system="three"}\nShow it.\n\n- P\n- Q\n- ¬(P & Q)\n::::`,
      ),
    );
    const tick = (line: number) =>
      mounted.root
        .querySelector<HTMLInputElement>(
          `.tableau-pick[aria-label='Close the branch on row ${line}']`,
        )
        ?.click();

    press(cursor(mounted), "x");
    tick(1);
    tick(2);
    // Two rows that close nothing under a rule citing three: still marking.
    expect(announced(mounted)).toBe("Row 2 marked.");
    expect(mounted.root.querySelector(".tableau-end")).toBeNull();
    tick(3);
    expect(announced(mounted)).toBe("Branch closed on rows 1, 2, 3");
    const end = answerOf(mounted).nodes[0]?.end as {
      readonly cites?: readonly string[];
    };
    expect(end.cites).toHaveLength(3);
  });

  test("a wrong step is flagged as it is written, under full feedback", async () => {
    const mounted = mountExercise(await treeExercise("", "- A ∨ B"));

    press(cursor(mounted), "t");
    write(mounted, "A", "1");
    // A stack where ∨ splits: the engine refuses the step, once it is named.
    name(mounted, "∨");

    await until(() => cursor(mounted).hasAttribute("data-flagged"), 3_000);
    expect(
      mounted.root.querySelector("[data-role='note']")?.textContent,
    ).toBe("Row 2: The rule named does not give this from row 1.");
  });

  test("a click types in a row, leaving it ends typing, and the margin cites", async () => {
    const mounted = mountExercise(await treeExercise("", "- A ∨ B"));
    // jsdom's document has no focus between a blur and the next focus, which
    // a browser's has; the editor keeps typing open only when the window
    // itself loses focus.
    const document = dom.window.document;
    const hasFocus = document.hasFocus;
    document.hasFocus = () => true;

    press(cursor(mounted), "s");
    press(mounted.root.querySelector(".tableau-input") as Element, "Escape");
    // Blank rows are unfinished, not wrong.
    expect(
      rows(mounted).some((row) => row.hasAttribute("data-flagged")),
    ).toBe(false);

    // A click on the empty right-hand row types in it.
    const right = rows(mounted)[2] as HTMLElement;
    right.click();
    expect(right.querySelector(".tableau-input")).not.toBeNull();
    fill(right.querySelector<HTMLInputElement>(".tableau-input"), "B");

    // Leaving it by the mouse ends typing, so the arrows move the cursor
    // rather than finding the input again.
    const root = row(mounted, "A ∨ B");
    root.focus();
    root.click();
    expect(mounted.root.querySelector(".tableau-input")).toBeNull();
    press(root, "ArrowDown");
    expect(mounted.root.querySelector(".tableau-input")).toBeNull();
    expect(cursor(mounted).querySelector(".tableau-text")?.textContent).toBe(
      "",
    );

    // An uncited line's margin is a slot a click types the citation into,
    // and leaving it keeps what was typed.
    const margin = mounted.root.querySelector<HTMLElement>(
      ".tableau-margin[data-editable] .tableau-margin-cites",
    );
    expect(margin?.querySelector(".tableau-margin-slot")).not.toBeNull();
    margin?.click();
    fill(
      mounted.root.querySelector<HTMLInputElement>(".tableau-cite-input"),
      "1",
    );
    root.focus();
    expect(mounted.root.querySelector(".tableau-cite-input")).toBeNull();
    const [, left, written] = answerOf(mounted).nodes;
    const rootId = answerOf(mounted).nodes[0]?.rows[0]?.id ?? "";
    expect(left?.rows[0]?.cites).toEqual([rootId]);
    expect(written?.rows[0]).toMatchObject({ cites: [rootId], text: "B" });
    document.hasFocus = hasFocus;
  });

  test("an input blurred by something other than a click hands focus back to its row", async () => {
    const mounted = mountExercise(await treeExercise("", "- A ∨ B"));
    const document = dom.window.document;
    const hasFocus = document.hasFocus;
    document.hasFocus = () => true;

    // As a browser extension that takes Esc for itself does: the input is
    // blurred, and focus is left on nothing.
    press(cursor(mounted), "t");
    mounted.root.querySelector<HTMLInputElement>(".tableau-input")?.blur();

    expect(mounted.root.querySelector(".tableau-input")).toBeNull();
    expect(mounted.root.activeElement).toBe(cursor(mounted));

    press(cursor(mounted), "c");
    mounted.root
      .querySelector<HTMLInputElement>(".tableau-cite-input")
      ?.blur();

    expect(mounted.root.querySelector(".tableau-cite-input")).toBeNull();
    expect(mounted.root.activeElement).toBe(cursor(mounted));
    document.hasFocus = hasFocus;
  });

  test("a problem is drawn on its own field, and a bad citation is kept", async () => {
    const mounted = mountExercise(await treeExercise("", "- A ∨ B"));
    const margin = () =>
      [
        ...mounted.root.querySelectorAll<HTMLElement>(
          ".tableau-margin-cites",
        ),
      ].at(-1);
    const cite = (text: string, key: string) => {
      press(cursor(mounted), "c", { altKey: true, code: "KeyC" });
      const input = mounted.root.querySelector<HTMLInputElement>(
        ".tableau-cite-input",
      );
      fill(input, text);
      press(input as Element, key);
    };

    press(cursor(mounted), "t");
    fill(mounted.root.querySelector<HTMLInputElement>(".tableau-input"), "A");
    press(mounted.root.querySelector(".tableau-input") as Element, "Escape");

    // Uncited is unfinished, not wrong: neither the sentence nor the blank
    // margin is drawn as wrong.
    expect(cursor(mounted).hasAttribute("data-flagged")).toBe(false);
    expect(margin()?.hasAttribute("data-flagged")).toBe(false);

    // A citation that names no row above is kept, squiggled, and said.
    cite("9", "Escape");
    expect(mounted.root.querySelector(".tableau-cite-input")).toBeNull();
    expect(margin()?.textContent).toBe("9");
    expect(margin()?.hasAttribute("data-flagged")).toBe(true);
    expect(
      mounted.root.querySelector("[data-role='note']")?.textContent,
    ).toBe("Row 2: Row 9 is not above this row on its branch.");
    expect(answerOf(mounted).nodes[0]?.rows[1]?.cites).toEqual([]);

    // Put right, the margin reads, and the wrong shape is the sentence's.
    cite("1", "Enter");
    name(mounted, "∨");
    expect(margin()?.textContent).toBe("1");
    expect(margin()?.hasAttribute("data-flagged")).toBe(false);
    await until(() => cursor(mounted).hasAttribute("data-flagged"), 3_000);

    // Undo takes back the rule named, and then the citation.
    press(cursor(mounted), "z", { ctrlKey: true });
    expect(margin()?.textContent).toBe("1");
    press(cursor(mounted), "z", { ctrlKey: true });
    expect(margin()?.textContent).toBe("9");
  });

  test("the rule is the margin's second field, typed as the citation is", async () => {
    const mounted = mountExercise(await treeExercise("", "- A ∨ B"));
    const active = () => mounted.root.activeElement as HTMLElement;
    const rule = () => marginField(mounted, 2, "rule");

    press(cursor(mounted), "t");
    fill(mounted.root.querySelector<HTMLInputElement>(".tableau-input"), "A");

    // Alt-C from the row, then Tab from the citation on to the rule.
    press(mounted.root.querySelector(".tableau-input") as Element, "c", {
      altKey: true,
      code: "KeyC",
    });
    fill(active() as HTMLInputElement, "1");
    press(active(), "Tab");
    expect(active().classList.contains("tableau-rule-input")).toBe(true);
    expect(answerOf(mounted).nodes[0]?.rows[1]?.cites).toHaveLength(1);

    // A rule the theory has no name for is kept, squiggled, and said; the
    // step names no rule.
    fill(active() as HTMLInputElement, "v");
    press(active(), "Enter");
    expect(rule()?.textContent).toBe("v");
    expect(rule()?.hasAttribute("data-flagged")).toBe(true);
    expect(announced(mounted)).toBe("This system has no rule called “v”.");
    expect(answerOf(mounted).rules).toBeUndefined();

    // Put right in another of its spellings, it is shown in the book's.
    name(mounted, "\\/");
    expect(rule()?.textContent).toBe("∨");
    expect(rule()?.hasAttribute("data-flagged")).toBe(false);
    expect(Object.values(answerOf(mounted).rules ?? {})).toEqual(["∨"]);

    // → from the end of the line reaches the citation, → again the rule;
    // Delete clears the rule and leaves the citation.
    press(cursor(mounted), "ArrowRight");
    expect(active().getAttribute("aria-label")).toBe("Citation of row 2: 1");
    press(active(), "ArrowRight");
    expect(active().getAttribute("aria-label")).toBe("Rule of row 2: ∨");
    press(active(), "Delete");
    expect(announced(mounted)).toBe("Row 2 no longer names a rule.");
    expect(answerOf(mounted).rules).toBeUndefined();
    expect(answerOf(mounted).nodes[0]?.rows[1]?.cites).toHaveLength(1);
    expect(active().getAttribute("aria-label")).toBe(
      "Rule of row 2, not yet named",
    );

    // Undo brings the rule back.
    press(active(), "z", { ctrlKey: true });
    expect(Object.values(answerOf(mounted).rules ?? {})).toEqual(["∨"]);
  });

  test("opening a row and leaving it untouched records no undo step", async () => {
    const mounted = mountExercise(await treeExercise("", "- A ∨ B"));

    press(cursor(mounted), "t");
    fill(mounted.root.querySelector<HTMLInputElement>(".tableau-input"), "A");
    press(mounted.root.querySelector(".tableau-input") as Element, "Escape");
    press(cursor(mounted), "Enter");
    press(mounted.root.querySelector(".tableau-input") as Element, "Escape");
    press(cursor(mounted), "z", { ctrlKey: true });

    // The one undo takes back the new row, not an empty edit.
    expect(rows(mounted)).toHaveLength(1);
  });

  test("the root is given, and a split's own row takes the split back", async () => {
    const mounted = mountExercise(await treeExercise("", "- A ∨ B"));

    press(row(mounted, "A ∨ B"), "Delete");
    expect(announced(mounted)).toBe(
      "The root's rows are given, and cannot be changed.",
    );

    press(cursor(mounted), "s");
    expect(announced(mounted)).toBe("Split below row 1: two new branches.");
    expect(answerOf(mounted).nodes).toHaveLength(3);

    press(mounted.root.querySelector(".tableau-input") as Element, "Escape");
    press(cursor(mounted), "Delete");
    expect(announced(mounted)).toBe("Split taken back.");
    expect(answerOf(mounted).nodes).toHaveLength(1);

    press(cursor(mounted), "z", { ctrlKey: true });
    expect(answerOf(mounted).nodes).toHaveLength(3);
  });
});
