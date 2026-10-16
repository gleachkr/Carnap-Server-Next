import { describe, expect, test } from "bun:test";
import { dirname, posix } from "node:path";
import { TableauIndex } from "../src/tableau/document";
import {
  insertRowAfter,
  remint,
  removeChildren,
  removeRow,
  setRowCites,
} from "../src/tableau/edit";
import { guideRows } from "../src/tableau/html";
import type { Guide } from "../src/tableau/layout";
import { layoutTableau, rowAtLine } from "../src/tableau/layout";
import { keyAction, moveCursor } from "../src/tableau/navigate";
import { TreeBuilder } from "./helpers/truth-tree";

/**
 * The tableau core: the logic-free document, its edits and its layout. The
 * trees are built with the truth-tree test helper because it is a convenient
 * way to make one, but nothing here asks what a row means.
 */

/** §5.4's tree, which the mockup draws: shared lines 4, 5 and 6. */
function mockupTree() {
  const t = new TreeBuilder(["(D & ¬R) ∨ Q", "¬Q ∨ R"]);
  const split = t.split(t.rootNode, "r1", [["D & ¬R"], ["Q"]]);
  const [left, right] = split.nodes;
  const dAndNotR = split.rows[0]?.[0] as string;
  const inner = t.split(left, "r2", [["¬Q"], ["R"]]);
  const [notQ, r] = inner.nodes;
  const leftRows = t.stack(notQ, dAndNotR, ["D", "¬R"]);
  const rightRows = t.stack(r, dAndNotR, ["D", "¬R"]);
  const outer = t.split(right, "r2", [["¬Q"], ["R"]]);
  return { dAndNotR, inner, leftRows, outer, rightRows, t };
}

describe("layout", () => {
  test("a step repeated on two branches shares its lines", () => {
    const { inner, leftRows, outer, rightRows, t } = mockupTree();
    const layout = layoutTableau(t.tree);
    const line = (id: string | undefined) => layout.rows.get(id ?? "")?.line;

    expect(line("r1")).toBe(1);
    expect(line("r2")).toBe(2);
    // Both sides of the first split, on line 3.
    expect(layout.lineRows.get(3)?.length).toBe(2);
    // Row 2's development on all four branches: line 4, under one margin.
    expect(line(inner.rows[0]?.[0])).toBe(4);
    expect(line(outer.rows[1]?.[0])).toBe(4);
    expect(layout.lineRows.get(4)?.length).toBe(4);
    // Row 3's development on both left branches: lines 5 and 6.
    expect(leftRows.map(line)).toEqual([5, 6]);
    expect(rightRows.map(line)).toEqual([5, 6]);
    expect(layout.columns).toBe(4);
    expect(layout.guides).toEqual([]);
  });

  test("a step's margin is on its first line, and its other rows continue it", () => {
    const { dAndNotR, leftRows, t } = mockupTree();
    const [d, notR] = leftRows as [string, string];
    const leaf = new TableauIndex(t.tree).row(notR)?.node.id ?? "";
    const again = t.stack(leaf, dAndNotR, ["D"]);
    const layout = layoutTableau(t.tree);

    // Line 6 only continues the steps begun on line 5: its margin is blank.
    expect(layout.heads.get(d)).toBe(d);
    expect(layout.heads.get(notR)).toBe(d);
    expect(layout.marginLines.has(5)).toBe(true);
    expect(layout.marginLines.has(6)).toBe(false);
    // A second step under it begins afresh, though it cites a row as well.
    expect(layout.heads.get(again[0] ?? "")).toBe(again[0]);
    expect(layout.marginLines.has(7)).toBe(true);
    // Each side of a split begins the step on its own branch.
    expect(layout.marginLines.has(3)).toBe(true);
    expect(layout.marginLines.has(4)).toBe(true);
  });

  test("a different step waits for fresh lines, and the gap is a guide", () => {
    const t = new TreeBuilder(["A ∨ B", "C & D", "E & F"]);
    const {
      nodes: [a, b],
    } = t.split(t.rootNode, "r1", [["A"], ["B"]]);
    t.stack(a as string, "r2", ["C", "D"]);
    const [e] = t.stack(b as string, "r3", ["E", "F"]);
    const layout = layoutTableau(t.tree);

    // Lines 5 and 6 carry row 2's margin, so row 3's step starts at 7.
    expect(layout.rows.get(e ?? "")?.line).toBe(7);
    expect(layout.guides).toEqual([
      { from: 5, fromFork: false, span: { end: 2, start: 1 }, to: 6 },
    ]);
  });

  test("a guide under a fork starts where the fork's arm ends", () => {
    const t = new TreeBuilder(["A ∨ B", "C & D", "E ∨ F"]);
    const {
      nodes: [a, b],
    } = t.split(t.rootNode, "r1", [["A"], ["B"]]);
    t.stack(a as string, "r2", ["C", "D"]);
    // Lines 5 and 6 carry row 2's margin, so B's split writes on line 7, and
    // its two branches run down to it from the fork under B.
    t.split(b as string, "r3", [["E"], ["F"]]);
    const layout = layoutTableau(t.tree);

    expect(
      layout.guides.map(({ from, fromFork, to }) => ({ from, fromFork, to })),
    ).toEqual([
      { from: 5, fromFork: true, to: 6 },
      { from: 5, fromFork: true, to: 6 },
    ]);
    // The content row of line 5, not the connector row above it.
    expect(guideRows(layout.guides[0] as Guide)).toBe("10 / 13");
  });

  test("columns are leaves, and a node spans the leaves below it", () => {
    const { t } = mockupTree();
    const layout = layoutTableau(t.tree);

    expect(layout.nodes.get(t.rootNode)?.span).toEqual({ end: 4, start: 0 });
    expect(layout.forks[0]).toMatchObject({
      children: [
        { end: 2, start: 0 },
        { end: 4, start: 2 },
      ],
      line: 3,
      span: { end: 4, start: 0 },
    });
  });

  test("an end mark sits on the line under its branch", () => {
    const t = new TreeBuilder(["A", "¬A"]);
    t.close(t.rootNode, "r1", "r2");
    const layout = layoutTableau(t.tree);

    expect(layout.ends.get(t.rootNode)?.line).toBe(3);
    expect(layout.lines).toBe(3);
  });

  test("a typed row number finds the row on this branch", () => {
    const { inner, outer, t } = mockupTree();
    const index = new TableauIndex(t.tree);
    const layout = layoutTableau(t.tree);
    const [notQ] = inner.nodes;
    const [, rightR] = outer.nodes;

    expect(rowAtLine(index, layout, notQ, 4)).toBe(
      inner.rows[0]?.[0] ?? null,
    );
    expect(rowAtLine(index, layout, rightR, 4)).toBe(
      outer.rows[1]?.[0] ?? null,
    );
    // Line 5 is on the left branches only.
    expect(rowAtLine(index, layout, rightR, 5)).toBeNull();
  });
});

describe("navigation", () => {
  test("a branch's end mark is a stop below its last row", () => {
    const t = new TreeBuilder(["A ∨ B", "¬A"]);
    const {
      nodes: [a, b],
      rows: [[aRow], [bRow]],
    } = t.split(t.rootNode, "r1", [["A"], ["B"]]);
    t.close(a as string, aRow as string, "r2");
    t.open(b as string);
    const index = new TableauIndex(t.tree);
    const layout = layoutTableau(t.tree);
    const move = (
      from: string,
      direction: "up" | "down" | "left" | "right",
    ) => moveCursor(index, layout, from, direction);

    expect(move(aRow as string, "down")).toBe(a);
    expect(move(a as string, "up")).toBe(aRow as string);
    expect(move(a as string, "down")).toBeNull();
    // Across, from one end mark to its neighbour, on the same line.
    expect(move(a as string, "right")).toBe(b);
    expect(move(b as string, "left")).toBe(a);
    expect(move(bRow as string, "down")).toBe(b);
  });
});

describe("edits", () => {
  test("removing a branch's only row removes the branch", () => {
    const { outer, t } = mockupTree();
    const [, r] = outer.nodes;
    const rRow = outer.rows[1]?.[0] as string;
    const after = removeRow(t.tree, rRow);
    const index = new TableauIndex(after);

    expect(index.nodes.has(r)).toBe(false);
  });

  test("removing a split takes back every branch below the node", () => {
    const { t } = mockupTree();
    const after = removeChildren(t.tree, t.rootNode);

    expect(after.nodes.map((node) => node.id)).toEqual([t.rootNode]);
  });

  test("a row inserted after another joins its node", () => {
    const t = new TreeBuilder(["A ≡ B"]);
    const split = t.split(t.rootNode, "r1", [["A"], ["¬A"]]);
    const left = split.nodes[0];
    const a = split.rows[0]?.[0];
    const made = insertRowAfter(
      t.tree,
      a as string,
      { cites: ["r1"], dev: "x", text: "B" },
      () => "new",
    );
    const node = made?.document.nodes.find((each) => each.id === left);

    expect(node?.rows.map((row) => row.text)).toEqual(["A", "B"]);
  });

  test("citations are set for a whole step at once", () => {
    const t = new TreeBuilder(["A & B"]);
    const rows = t.stack(t.rootNode, null, ["A", "B"]);
    const after = setRowCites(t.tree, rows, ["r1"]);

    expect(after.nodes[0]?.rows.slice(1).map((row) => row.cites)).toEqual([
      ["r1"],
      ["r1"],
    ]);
  });

  test("reminting renames every id and keeps every link", () => {
    const { t } = mockupTree();
    let next = 0;
    const fresh = remint(t.tree, () => {
      next += 1;
      return `m${next}`;
    });
    const before = layoutTableau(t.tree);
    const after = layoutTableau(fresh);

    // Same shape, same lines.
    expect(after.columns).toBe(before.columns);
    expect(
      [...after.lineRows].map(([line, ids]) => [line, ids.length]),
    ).toEqual([...before.lineRows].map(([line, ids]) => [line, ids.length]));
    // No old id survives, and every citation names a row that exists.
    const ids = new Set(
      fresh.nodes.flatMap((node) => node.rows.map((row) => row.id)),
    );
    const cites = fresh.nodes.flatMap((node) =>
      node.rows.flatMap((row) => row.cites),
    );

    expect(
      [...ids].some((id) => id.startsWith("r") || id.startsWith("t")),
    ).toBe(false);
    expect(cites.every((cite) => ids.has(cite))).toBe(true);
  });
});

describe("the key map", () => {
  const press = (key: string, extra: Partial<Record<string, unknown>> = {}) =>
    keyAction({
      altKey: false,
      ctrlKey: false,
      key,
      metaKey: false,
      shiftKey: false,
      ...extra,
    });

  test("Alt-C cites, by its letter or, where Alt types none, its physical key, and Tab is left to the page", () => {
    expect(press("c")).toBe("cite");
    expect(press("c", { altKey: true, code: "KeyC" })).toBe("cite");
    // A Mac's Option-C writes ç.
    expect(press("ç", { altKey: true, code: "KeyC" })).toBe("cite");
    expect(press("x", { altKey: true, code: "KeyX" })).toBeNull();
    expect(press("Tab")).toBeNull();
  });

  test("Alt-J names the rule on a layout whose J is QWERTY's C", () => {
    // Dvorak types j on the key QWERTY calls C, and c on QWERTY's I.
    expect(press("j", { altKey: true, code: "KeyC" })).toBe("rule");
    expect(press("c", { altKey: true, code: "KeyI" })).toBe("cite");
  });
});

describe("the tableau core's import boundary", () => {
  test("src/tableau imports nothing outside itself", async () => {
    const outward: string[] = [];

    for await (const path of new Bun.Glob("src/tableau/**/*.ts").scan(".")) {
      const source = await Bun.file(path).text();

      for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        const specifier = match[1] ?? "";
        const target = posix.normalize(posix.join(dirname(path), specifier));

        if (
          !specifier.startsWith(".") ||
          !target.startsWith("src/tableau/")
        ) {
          outward.push(`${path} → ${specifier}`);
        }
      }
    }

    expect(outward).toEqual([]);
  });
});

describe("the tableau view's import boundary", () => {
  test("src/client/tableau imports the core and Preact, nothing else", async () => {
    const outward: string[] = [];

    for await (const path of new Bun.Glob(
      "src/client/tableau/**/*.{ts,tsx}",
    ).scan(".")) {
      const source = await Bun.file(path).text();

      for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        const specifier = match[1] ?? "";
        const target = posix.normalize(posix.join(dirname(path), specifier));
        const allowed = specifier.startsWith(".")
          ? target.startsWith("src/tableau/") ||
            target.startsWith("src/client/tableau/")
          : specifier === "preact" || specifier.startsWith("preact/");

        if (!allowed) {
          outward.push(`${path} → ${specifier}`);
        }
      }
    }

    expect(outward).toEqual([]);
  });
});
