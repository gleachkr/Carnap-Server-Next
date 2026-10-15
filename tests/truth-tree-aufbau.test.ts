import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { LoadedCompiler } from "@aufbau/compiler";
import { loadCompiler } from "@aufbau/compiler";
import type { SurfaceLanguage } from "@aufbau/syntax";
import { stripSyntaxAnnotations } from "@aufbau/syntax";
import type { TableauDocument, TableauNode } from "../src/tableau/document";
import { verifyMmb } from "../src/worker/exercise-kit/proof/verifier";
import type { TreeDiagnostic } from "../src/worker/exercises/truth-tree/aufbau/emit";
import {
  emitTreeProof,
  readTreeDiagnostics,
} from "../src/worker/exercises/truth-tree/aufbau/emit";
import type { TreeTheory } from "../src/worker/exercises/truth-tree/aufbau/theory";
import {
  isTreeTheory,
  readTreeTheory,
} from "../src/worker/exercises/truth-tree/aufbau/theory";
import {
  LANGUAGE_SPEC_SOURCES,
  languageFromSource,
} from "../src/worker/logic/specs";

/**
 * Truth trees checked as Aufbau derivations (gh #46), on the Rudolf-style
 * encoding with rows kept (the tree half of `forallx-ubc.mm0`). Real
 * compiler, real verifier.
 */

/** A tree theory as the emitter and the engine take it. */
interface TreeSystem {
  readonly language: SurfaceLanguage;
  readonly mm0: string;
  readonly theory: TreeTheory;
}

function treeSystem(source: string): TreeSystem {
  const language = languageFromSource(source);

  if (language === null) {
    throw new Error("the tree theory does not read as a language");
  }

  const theory = readTreeTheory(language);

  if (!isTreeTheory(theory)) {
    throw new Error(`not a tree theory: ${JSON.stringify(theory)}`);
  }

  return { language, mm0: stripSyntaxAnnotations(source), theory };
}

/** forall x: UBC, its language and its tree rules. */
const UBC = treeSystem(LANGUAGE_SPEC_SOURCES["forallx-ubc"] ?? "");

/** A signed (Smullyan) propositional tableau, a theory of its own. */
const SIGNED = treeSystem(
  readFileSync(
    new URL("./helpers/signed-tableau.mm0", import.meta.url),
    "utf8",
  ),
);

let compiler: LoadedCompiler;

beforeAll(async () => {
  compiler = await loadCompiler({
    wasmBytes: readFileSync(
      new URL(
        "../node_modules/@aufbau/compiler/compiler.wasm",
        import.meta.url,
      ),
    ),
  });
});

/** A row: number (its id), text, the rows it cites, and the rule written. */
type Row = readonly [string, string, readonly string[], string?];

/** A node: its rows, and its children or its end. */
interface Shape {
  readonly rows: readonly Row[];
  readonly children?: readonly Shape[];
  /** The rows a × cites; absent for an open or unfinished branch. */
  readonly closed?: readonly string[];
}

/**
 * The tree as the editor stores it. Rows that cite the same rows with the
 * same rule, in one node or at the head of a split's children, are one
 * development, as the editor writes them.
 */
function tree(root: Shape): {
  document: TableauDocument;
  rules: Map<string, string>;
} {
  const nodes: TableauNode[] = [];
  const rules = new Map<string, string>();
  let nodeCount = 0;

  const add = (shape: Shape, parent: string | null, splitDev?: string) => {
    const id = `n${nodeCount++}`;
    let previous: string | null = null;
    const rows = shape.rows.map(([rowId, text, cites, rule], at) => {
      const key = `${parent ?? "root"}:${cites.join(",")}:${rule ?? ""}`;
      const dev =
        cites.length === 0
          ? "root"
          : at === 0 && splitDev !== undefined
            ? splitDev
            : previous?.startsWith(key)
              ? previous
              : `${key}@${id}:${rowId}`;
      previous = dev;

      if (rule !== undefined) {
        rules.set(dev, rule);
      }

      return { cites, dev, id: rowId, text };
    });

    nodes.push({
      id,
      parent,
      rows,
      ...(shape.closed === undefined
        ? {}
        : { end: { cites: shape.closed, type: "closed" as const } }),
    });

    const children = shape.children ?? [];
    const first = children[0]?.rows[0];
    const split =
      first === undefined
        ? undefined
        : `split@${id}:${first[2].join(",")}:${first[3] ?? ""}`;

    for (const child of children) {
      add(child, id, split);
    }
  };

  add(root, null);
  return { document: { nodes }, rules };
}

interface Checked {
  readonly ok: boolean;
  readonly verified: boolean;
  readonly hypotheses: number;
  readonly gaps: number;
  readonly errors: readonly TreeDiagnostic[];
  readonly milliseconds: number;
}

async function check(root: Shape, system = UBC): Promise<Checked> {
  const { document, rules } = tree(root);
  const proof = emitTreeProof(document, {
    language: system.language,
    rules,
    theory: system.theory,
  });

  if (proof.goal === null || proof.proof === null) {
    throw new Error("nothing to check");
  }

  const mm0 = `${system.mm0}\n${proof.goal}\n`;
  const started = performance.now();
  const result = compiler.compile(mm0, proof.proof);
  const milliseconds = performance.now() - started;
  const verified =
    result.ok && result.mmbBytes !== undefined
      ? (await verifyMmb(mm0, result.mmbBytes)).ok
      : false;

  return {
    errors: readTreeDiagnostics(result.diagnostics, proof),
    gaps: proof.gaps,
    hypotheses: proof.hypotheses,
    milliseconds,
    ok: result.ok === true,
    verified,
  };
}

/** The rows each error is about, and what kind of line it was. */
function where(errors: readonly TreeDiagnostic[]): string[] {
  return errors.map((error) => {
    const subject = error.subject;

    if (subject === null) {
      return `whole proof: ${error.message}`;
    }

    switch (subject.type) {
      case "step":
      case "citation":
        return `${subject.type} ${subject.rows.join(",")}`;
      case "link":
        return `link ${subject.row} ${subject.instance}`;
      default:
        return `${subject.type} ${subject.node}`;
    }
  });
}

// P ⊃ Q, Q ⊃ R :|-: P ⊃ R
const chain = (
  overrides: {
    cite3?: string;
    rule6?: string;
    swap?: boolean;
    close?: readonly string[];
  } = {},
): Shape => {
  const left: Shape = {
    closed: overrides.close ?? ["4", "6"],
    rows: [["6", "¬P", ["1"], overrides.rule6 ?? "⊃"]],
  };
  const right: Shape = {
    children: [
      { closed: ["7", "8"], rows: [["8", "¬Q", ["2"], "⊃"]] },
      { closed: ["5", "9"], rows: [["9", "R", ["2"], "⊃"]] },
    ],
    rows: [["7", "Q", ["1"], overrides.rule6 ?? "⊃"]],
  };

  return {
    children: overrides.swap ? [right, left] : [left, right],
    rows: [
      ["1", "P ⊃ Q", []],
      ["2", "Q ⊃ R", []],
      ["3", "¬(P ⊃ R)", []],
      ["4", "P", [overrides.cite3 ?? "3"], "¬⊃"],
      ["5", "¬R", [overrides.cite3 ?? "3"], "¬⊃"],
    ],
  };
};

describe("a sentential tree", () => {
  test("a closed tree proves its root closes, and verifies", async () => {
    const checked = await check(chain());
    expect(where(checked.errors)).toEqual([]);
    expect(checked.hypotheses).toBe(0);
    expect(checked.verified).toBe(true);
  });

  test("a split's branches may come in either order", async () => {
    const checked = await check(chain({ swap: true }));
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
  });

  test("citing the wrong row is an error at that step", async () => {
    const checked = await check(chain({ cite3: "2" }));
    expect(where(checked.errors)).toEqual(["step 4,5"]);
  });

  test("naming the wrong rule is an error at that step", async () => {
    const checked = await check(chain({ rule6: "∨" }));
    expect(where(checked.errors)).toEqual(["step 6,7"]);
  });

  test("a closure on rows that do not contradict is an error at that end", async () => {
    const checked = await check(chain({ close: ["4", "5"] }));
    expect(where(checked.errors)).toEqual(["closure n1"]);
  });

  test("every mistake is reported in one compile", async () => {
    const checked = await check(
      chain({ cite3: "2", close: ["4", "5"], rule6: "∨" }),
    );
    expect(where(checked.errors)).toEqual([
      "step 4,5",
      "step 6,7",
      "closure n1",
    ]);
  });

  test("a branch may close on a row it has developed", async () => {
    const checked = await check({
      rows: [
        ["1", "P & Q", []],
        ["2", "¬(P & Q)", []],
        ["3", "P", ["1"], "&"],
        ["4", "Q", ["1"], "&"],
      ],
      closed: ["1", "2"],
    });
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
  });

  test("citing a row that is not above the step is an error in its citation", async () => {
    // Rows 3 and 4 develop row 5, which is written below them.
    const checked = await check({
      closed: ["2", "3"],
      rows: [
        ["1", "¬¬(P & Q)", []],
        ["2", "¬P", []],
        ["3", "P", ["5"], "&"],
        ["4", "Q", ["5"], "&"],
        ["5", "P & Q", ["1"], "¬¬"],
      ],
    });
    expect(where(checked.errors)).toEqual(["citation 3,4"]);
  });

  test("a step with no rule is left out, and everything else is checked", async () => {
    const shape = chain({ close: ["4", "5"] });
    const checked = await check({
      ...shape,
      rows: shape.rows.map((row) =>
        row[0] === "4" || row[0] === "5" ? [row[0], row[1], row[2]] : row,
      ),
    });
    expect(where(checked.errors)).toEqual(["closure n1"]);
    expect(checked.gaps).toBe(1);
    expect(checked.hypotheses).toBe(0);
  });

  test("an open branch is assumed, not checked, and the rest still is", async () => {
    // P ∨ Q, ¬P: the right branch stays open.
    const checked = await check({
      children: [
        { closed: ["2", "3"], rows: [["3", "P", ["1"], "∨"]] },
        { rows: [["4", "Q", ["1"], "∨"]] },
      ],
      rows: [
        ["1", "P ∨ Q", []],
        ["2", "¬P", []],
      ],
    });
    expect(where(checked.errors)).toEqual([]);
    expect(checked.hypotheses).toBe(1);
    expect(checked.ok).toBe(true);
  });
});

describe("a first-order tree", () => {
  // ∀x(Fx ⊃ Gx), ∃xFx :|-: ∃xGx
  const quantifiers = (name4 = "a"): Shape => ({
    children: [
      { closed: ["4", "7"], rows: [["7", `¬F${name4}`, ["5"], "⊃"]] },
      { closed: ["6", "8"], rows: [["8", `G${name4}`, ["5"], "⊃"]] },
    ],
    rows: [
      ["1", "∀x(Fx ⊃ Gx)", []],
      ["2", "∃xFx", []],
      ["3", "¬∃xGx", []],
      ["4", `F${name4}`, ["2"], "∃"],
      ["5", `F${name4} ⊃ G${name4}`, ["1"], "∀"],
      ["6", `¬G${name4}`, ["3"], "¬∃"],
    ],
  });

  test("a closed tree verifies, with every instance inferred", async () => {
    const checked = await check(quantifiers());
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
  });

  test("∃ to a name already on the branch is refused", async () => {
    const shape = quantifiers();
    const checked = await check({
      ...shape,
      rows: [
        ["0", "Ha", []],
        ...shape.rows.slice(0, 3),
        ...shape.rows.slice(3),
      ],
    });
    expect(where(checked.errors)).toEqual(["step 4"]);
  });

  // Fa, Fb, ∀x¬Fx: one ∀ step writes both instances.
  const twoInstances = (second: string): Shape => ({
    rows: [
      ["1", "Fa", []],
      ["2", "Fb", []],
      ["3", "∀x¬Fx", []],
      ["4", "¬Fa", ["3"], "∀"],
      ["5", second, ["3"], "∀"],
    ],
    closed: ["1", "4"],
  });

  test("one ∀ step may write several instances", async () => {
    const checked = await check(twoInstances("¬Fb"));
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
  });

  test("a row in a ∀ step that is no instance is refused", async () => {
    const checked = await check(twoInstances("¬Ga"));
    expect(where(checked.errors)).toEqual(["step 4,5"]);
  });
});

describe("identity", () => {
  test("a = b rewrites a row, and a ≠ a closes alone", async () => {
    // ∀x a = x, ∃x x ≠ a
    const checked = await check({
      closed: ["5"],
      rows: [
        ["1", "∀x a = x", []],
        ["2", "∃x x ≠ a", []],
        ["3", "b ≠ a", ["2"], "∃"],
        ["4", "a = b", ["1"], "∀"],
        ["5", "a ≠ a", ["3", "4"], "="],
      ],
    });
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
  });

  test("a rewrite that leaves an a behind is refused", async () => {
    const checked = await check({
      closed: ["4", "5"],
      rows: [
        ["1", "a = b", []],
        ["2", "Faa", []],
        ["3", "¬Fbb", []],
        ["4", "Fab", ["1", "2"], "="],
        ["5", "¬Fab", ["1", "3"], "="],
      ],
    });
    expect(where(checked.errors)).toEqual(["step 4", "step 5"]);
  });
});

describe("size", () => {
  test("a 61-row chain checks in well under a second", async () => {
    const n = 30;
    // Atoms A₁…: use predicate letters with names, Fa₁ … Fa₉, Ga₁ … so the
    // chain has enough distinct atoms.
    const atoms = Array.from({ length: n + 1 }, (_, i) =>
      i < 9
        ? `F${"abcdefghi"[i]}`
        : i < 18
          ? `G${"abcdefghi"[i - 9]}`
          : i < 27
            ? `H${"abcdefghi"[i - 18]}`
            : `J${"abcdefghi"[i - 27]}`,
    );
    let row = 0;
    const id = () => `${++row}`;
    const rootRows: Row[] = [[id(), atoms[0] as string, []]];
    const conditionals: string[] = [];

    for (let i = 0; i < n; i += 1) {
      const rowId = id();
      conditionals.push(rowId);
      rootRows.push([rowId, `${atoms[i]} ⊃ ${atoms[i + 1]}`, []]);
    }

    const last = id();
    rootRows.push([last, `¬${atoms[n]}`, []]);
    const atomRow = new Map<number, string>([[0, "1"]]);

    const develop = (k: number): Shape => {
      if (k === n) {
        return { closed: [atomRow.get(n) as string, last], rows: [] };
      }

      const leftId = id();
      const rightId = id();
      atomRow.set(k + 1, rightId);
      return {
        children: [
          {
            closed: [atomRow.get(k) as string, leftId],
            rows: [
              [leftId, `¬${atoms[k]}`, [conditionals[k] as string], "⊃"],
            ],
          },
          {
            ...develop(k + 1),
            rows: [
              [
                rightId,
                atoms[k + 1] as string,
                [conditionals[k] as string],
                "⊃",
              ],
            ],
          },
        ],
        rows: [],
      };
    };

    const body = develop(0);
    const checked = await check({ ...body, rows: rootRows });
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
    console.log(
      `  ${row} rows: compile ${checked.milliseconds.toFixed(0)} ms`,
    );
    expect(checked.milliseconds).toBeLessThan(1000);
  });
});

describe("a signed tableau, from its own theory", () => {
  test("a closed tree verifies: P → (Q → P)", async () => {
    const checked = await check(
      {
        closed: ["2", "5"],
        rows: [
          ["1", "F P → (Q → P)", []],
          ["2", "T P", ["1"], "F→"],
          ["3", "F Q → P", ["1"], "F→"],
          ["4", "T Q", ["3"], "F→"],
          ["5", "F P", ["3"], "F→"],
        ],
      },
      SIGNED,
    );
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
  });

  test("a split, with its branches in either order", async () => {
    // T P ∨ Q, F P, F Q
    const checked = await check(
      {
        children: [
          { closed: ["5", "3"], rows: [["5", "T Q", ["1"], "T∨"]] },
          { closed: ["2", "4"], rows: [["4", "T P", ["1"], "T∨"]] },
        ],
        rows: [
          ["1", "T P ∨ Q", []],
          ["2", "F P", []],
          ["3", "F Q", []],
        ],
      },
      SIGNED,
    );
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
  });

  test("a wrong sign is an error at that step", async () => {
    const checked = await check(
      {
        closed: ["2", "5"],
        rows: [
          ["1", "F P → (Q → P)", []],
          ["2", "T P", ["1"], "F→"],
          ["3", "T Q → P", ["1"], "F→"],
          ["4", "T Q", ["3"], "F→"],
          ["5", "F P", ["3"], "F→"],
        ],
      },
      SIGNED,
    );
    expect(where(checked.errors)).toEqual(["step 2,3", "step 4,5"]);
  });
});
