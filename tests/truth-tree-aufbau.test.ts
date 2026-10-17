import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { SurfaceLanguage } from "@aufbau/syntax";
import { stripSyntaxAnnotations } from "@aufbau/syntax";
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
import type { RowProblem } from "../src/worker/exercises/truth-tree/report";
import {
  LANGUAGE_SPEC_SOURCES,
  languageFromSource,
} from "../src/worker/logic/specs";
import { engine } from "./helpers/engine";
import { TreeBuilder } from "./helpers/truth-tree";

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

interface Checked {
  readonly ok: boolean;
  readonly verified: boolean;
  readonly hypotheses: number;
  /** The rows whose step was not written down, and why. */
  readonly problems: ReadonlyMap<string, RowProblem>;
  readonly errors: readonly TreeDiagnostic[];
  readonly milliseconds: number;
  /** The proof text, and its certificate's size in bytes (0 if none). */
  readonly proof: string;
  readonly mmbBytes: number;
}

async function check(tree: TreeBuilder, system = UBC): Promise<Checked> {
  const proof = emitTreeProof(tree.tree, {
    language: system.language,
    rootRows: tree.root.length,
    rules: tree.rules,
    theory: system.theory,
  });

  if (proof.goal === null || proof.proof === null) {
    throw new Error("nothing to check");
  }

  const compiler = await engine();
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
    hypotheses: proof.hypotheses,
    milliseconds,
    mmbBytes: result.ok ? (result.mmbBytes?.length ?? 0) : 0,
    ok: result.ok === true,
    problems: proof.problems,
    proof: proof.proof,
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

/**
 * P ⊃ Q, Q ⊃ R :|-: P ⊃ R, closed, with the mistakes asked for: the ¬⊃
 * step citing the wrong row or naming no rule, the first ⊃ step naming the
 * wrong rule, its branches swapped, the left branch closed on two rows that
 * do not contradict.
 */
function chain(
  mistakes: {
    readonly citeWrong?: boolean;
    readonly noRule?: boolean;
    readonly wrongRule?: boolean;
    readonly swap?: boolean;
    readonly closeWrong?: boolean;
  } = {},
) {
  const tree = new TreeBuilder(["P ⊃ Q", "Q ⊃ R", "¬(P ⊃ R)"]);
  const developed = tree.stack(
    tree.rootNode,
    mistakes.citeWrong ? "r2" : "r3",
    ["P", "¬R"],
    mistakes.noRule ? undefined : "¬⊃",
  );
  const [p, nr] = developed as [string, string];
  const branches = [["¬P"], ["Q"]];
  const split = tree.split(
    tree.rootNode,
    "r1",
    mistakes.swap ? [...branches].reverse() : branches,
    mistakes.wrongRule ? "∨" : "⊃",
  );
  const [leftAt, rightAt] = mistakes.swap ? [1, 0] : [0, 1];
  const left = split.nodes[leftAt] as string;
  const right = split.nodes[rightAt] as string;
  const np = split.rows[leftAt]?.[0] as string;
  const q = split.rows[rightAt]?.[0] as string;
  const below = tree.split(right, "r2", [["¬Q"], ["R"]], "⊃");
  tree.close(left, ...(mistakes.closeWrong ? [p, nr] : [p, np]));
  tree.close(below.nodes[0], q, below.rows[0][0] as string);
  tree.close(below.nodes[1], nr, below.rows[1][0] as string);

  return { left, p, nr, np, q, tree };
}

describe("a sentential tree", () => {
  test("a closed tree proves its root closes, and verifies", async () => {
    const checked = await check(chain().tree);
    expect(where(checked.errors)).toEqual([]);
    expect(checked.hypotheses).toBe(0);
    expect(checked.verified).toBe(true);
  });

  test("a split's branches may come in either order", async () => {
    const checked = await check(chain({ swap: true }).tree);
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
  });

  test("citing the wrong row is an error at that step", async () => {
    const { p, nr, tree } = chain({ citeWrong: true });
    expect(where((await check(tree)).errors)).toEqual([`step ${p},${nr}`]);
  });

  test("naming the wrong rule is an error at that step", async () => {
    const { np, q, tree } = chain({ wrongRule: true });
    expect(where((await check(tree)).errors)).toEqual([`step ${np},${q}`]);
  });

  test("a closure on rows that do not contradict is an error at that end", async () => {
    const { left, tree } = chain({ closeWrong: true });
    expect(where((await check(tree)).errors)).toEqual([`closure ${left}`]);
  });

  test("every mistake is reported in one compile", async () => {
    const { left, np, nr, p, q, tree } = chain({
      citeWrong: true,
      closeWrong: true,
      wrongRule: true,
    });
    expect(where((await check(tree)).errors)).toEqual([
      `step ${p},${nr}`,
      `step ${np},${q}`,
      `closure ${left}`,
    ]);
  });

  test("a branch may close on a row it has developed", async () => {
    const tree = new TreeBuilder(["P & Q", "¬(P & Q)"]);
    tree.stack(tree.rootNode, "r1", ["P", "Q"], "&");
    tree.close(tree.rootNode, "r1", "r2");
    const checked = await check(tree);
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
  });

  test("citing a row that is not above the step is an error in its citation", async () => {
    // P and Q develop P & Q, which is written below them.
    const tree = new TreeBuilder(["¬¬(P & Q)", "¬P"]);
    const [p, q] = tree.stack(tree.rootNode, "r1", ["P", "Q"], "&");
    const [both] = tree.stack(tree.rootNode, "r1", ["P & Q"], "¬¬");
    tree.recite([p as string, q as string], both as string);
    tree.close(tree.rootNode, "r2", p as string);
    expect(where((await check(tree)).errors)).toEqual([`citation ${p},${q}`]);
  });

  test("a step with no rule is left out, and everything else is checked", async () => {
    const { left, nr, p, tree } = chain({ closeWrong: true, noRule: true });
    const checked = await check(tree);
    expect(where(checked.errors)).toEqual([`closure ${left}`]);
    expect([...checked.problems]).toEqual([
      [p, { type: "no-rule-named" }],
      [nr, { type: "no-rule-named" }],
    ]);
    expect(checked.hypotheses).toBe(0);
  });

  test("an open branch is assumed, not checked, and the rest still is", async () => {
    // P ∨ Q, ¬P: the right branch stays open.
    const tree = new TreeBuilder(["P ∨ Q", "¬P"]);
    const { nodes, rows } = tree.split(
      tree.rootNode,
      "r1",
      [["P"], ["Q"]],
      "∨",
    );
    tree.close(nodes[0], "r2", rows[0][0] as string);
    const checked = await check(tree);
    expect(where(checked.errors)).toEqual([]);
    expect(checked.hypotheses).toBe(1);
    expect(checked.ok).toBe(true);
  });
});

describe("a first-order tree", () => {
  // ∀x(Fx ⊃ Gx), ∃xFx :|-: ∃xGx, below any `before` rows.
  const quantifiers = (before: readonly string[] = []) => {
    const tree = new TreeBuilder([...before, "∀x(Fx ⊃ Gx)", "∃xFx", "¬∃xGx"]);
    const root = (at: number) => `r${before.length + at}`;
    const [fa] = tree.stack(tree.rootNode, root(2), ["Fa"], "∃");
    const [imp] = tree.stack(tree.rootNode, root(1), ["Fa ⊃ Ga"], "∀");
    const [nga] = tree.stack(tree.rootNode, root(3), ["¬Ga"], "¬∃");
    const { nodes, rows } = tree.split(
      tree.rootNode,
      imp as string,
      [["¬Fa"], ["Ga"]],
      "⊃",
    );
    tree.close(nodes[0], fa as string, rows[0][0] as string);
    tree.close(nodes[1], nga as string, rows[1][0] as string);
    return { fa: fa as string, tree };
  };

  test("a closed tree verifies, with every instance inferred", async () => {
    const checked = await check(quantifiers().tree);
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
  });

  test("∃ to a name already on the branch is refused", async () => {
    const { fa, tree } = quantifiers(["Ha"]);
    expect(where((await check(tree)).errors)).toEqual([`step ${fa}`]);
  });

  // Fa, Fb, ∀x¬Fx: one ∀ step writes both instances.
  const twoInstances = (second: string) => {
    const tree = new TreeBuilder(["Fa", "Fb", "∀x¬Fx"]);
    const rows = tree.stack(tree.rootNode, "r3", ["¬Fa", second], "∀");
    tree.close(tree.rootNode, "r1", rows[0] as string);
    return { rows, tree };
  };

  test("one ∀ step may write several instances", async () => {
    const checked = await check(twoInstances("¬Fb").tree);
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
  });

  test("a row in a ∀ step that is no instance is refused", async () => {
    const { rows, tree } = twoInstances("¬Ga");
    expect(where((await check(tree)).errors)).toEqual([
      `step ${rows.join(",")}`,
    ]);
  });
});

describe("identity", () => {
  test("a = b rewrites a row, and a ≠ a closes alone", async () => {
    const tree = new TreeBuilder(["∀x a = x", "∃x x ≠ a"]);
    const [bna] = tree.stack(tree.rootNode, "r2", ["b ≠ a"], "∃");
    const [ab] = tree.stack(tree.rootNode, "r1", ["a = b"], "∀");
    const [ana] = tree.stack(
      tree.rootNode,
      [bna as string, ab as string],
      ["a ≠ a"],
      "=",
    );
    tree.close(tree.rootNode, ana as string);
    const checked = await check(tree);
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
  });

  test("a rewrite that leaves an a behind is refused", async () => {
    const tree = new TreeBuilder(["a = b", "Faa", "¬Fbb"]);
    const [fab] = tree.stack(tree.rootNode, ["r1", "r2"], ["Fab"], "=");
    const [nfab] = tree.stack(tree.rootNode, ["r1", "r3"], ["¬Fab"], "=");
    tree.close(tree.rootNode, fab as string, nfab as string);
    expect(where((await check(tree)).errors)).toEqual([
      `step ${fab}`,
      `step ${nfab}`,
    ]);
  });
});

describe("size", () => {
  test("a chain of 30 conditionals, 92 rows, checks in under two seconds", async () => {
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
    const tree = new TreeBuilder([
      atoms[0] as string,
      ...atoms.slice(0, n).map((atom, i) => `${atom} ⊃ ${atoms[i + 1]}`),
      `¬${atoms[n]}`,
    ]);
    let node = tree.rootNode;
    let atom = "r1";

    for (let k = 0; k < n; k += 1) {
      const { nodes, rows } = tree.split(
        node,
        `r${k + 2}`,
        [[`¬${atoms[k]}`], [atoms[k + 1] as string]],
        "⊃",
      );
      tree.close(nodes[0], atom, rows[0][0] as string);
      node = nodes[1];
      atom = rows[1][0] as string;
    }

    tree.close(node, atom, `r${n + 2}`);
    const rows = tree.tree.nodes.flatMap((each) => each.rows).length;
    const checked = await check(tree);
    expect(rows).toBe(92);
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
    console.log(
      `  ${rows} rows: compile ${checked.milliseconds.toFixed(0)} ms`,
    );
    expect(checked.milliseconds).toBeLessThan(2000);
  });
});

describe("a step's certificate", () => {
  // The emitter names no binder on a step's lines; the engine keeps the
  // branch in the order the line writes it. A row written twice, a row a
  // view computes, and rows and marks in another order than the rule's each
  // used to cost a rearrangement of the whole branch (design/
  // aufbau-issues-2026-10-17, followup/ and followup-2/).
  const middle = "abcdefghijklm"
    .split("")
    .flatMap((name) => ["F", "G", "H"].map((p) => `${p}${name}`));

  test("grows with the step, not with the branch's order", async () => {
    const tree = new TreeBuilder([
      "P & Q",
      ...middle,
      ...middle.slice(0, 4),
      "¬P",
    ]);
    const [p] = tree.stack(tree.rootNode, "r1", ["P", "Q"], "&");
    tree.close(tree.rootNode, p as string, `r${tree.root.length}`);
    const checked = await check(tree);

    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
    expect(checked.mmbBytes).toBeLessThan(60_000);
  });

  test("a ∀ step grows with the step, not with the branch", async () => {
    const tree = new TreeBuilder(["∀x Jx", ...middle, "¬Jn"]);
    const [jn] = tree.stack(tree.rootNode, "r1", ["Jn"], "∀");
    tree.close(tree.rootNode, jn as string, `r${tree.root.length}`);
    const checked = await check(tree);

    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
    expect(checked.mmbBytes).toBeLessThan(50_000);
  });
});

describe("check marks", () => {
  // UBC's rules write `✓ ρ` (and ∀'s `✓ᵢ ρ ↦ ψ`) beside a step's rows, so a
  // step whose child branch lacks them proves nothing: the emitter must
  // write what the theory's mark roles name.
  const unmarked: TreeSystem = {
    ...UBC,
    theory: { ...UBC.theory, mark: null, markInstance: null },
  };
  const once = () => {
    const tree = new TreeBuilder(["P & Q", "¬P"]);
    const rows = tree.stack(tree.rootNode, "r1", ["P", "Q"], "&");
    tree.close(tree.rootNode, rows[0] as string, "r2");
    return { rows, tree };
  };
  const general = () => {
    const tree = new TreeBuilder(["∀x Fx", "¬Fa"]);
    const rows = tree.stack(tree.rootNode, "r1", ["Fa"], "∀");
    tree.close(tree.rootNode, rows[0] as string, "r2");
    return { rows, tree };
  };

  test("a step writes the mark its rule asks for", async () => {
    for (const [make, mark] of [
      [once, "chk "],
      [general, "chki "],
    ] as const) {
      const checked = await check(make().tree);

      expect(where(checked.errors)).toEqual([]);
      expect(checked.verified).toBe(true);
      expect(checked.proof).toContain(mark);
    }
  });

  test("a step without its mark is refused at that step", async () => {
    for (const make of [once, general]) {
      const { rows, tree } = make();

      expect(where((await check(tree, unmarked)).errors)).toEqual([
        `step ${rows.join(",")}`,
      ]);
    }
  });
});

describe("a signed tableau, from its own theory", () => {
  // P → (Q → P), its second step's first row signed `second`.
  const conditional = (second: string) => {
    const tree = new TreeBuilder(["F P → (Q → P)"]);
    const first = tree.stack(tree.rootNode, "r1", ["T P", second], "F→");
    const next = tree.stack(
      tree.rootNode,
      first[1] as string,
      ["T Q", "F P"],
      "F→",
    );
    tree.close(tree.rootNode, first[0] as string, next[1] as string);
    return { first, next, tree };
  };

  test("a closed tree verifies: P → (Q → P)", async () => {
    const checked = await check(conditional("F Q → P").tree, SIGNED);
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
  });

  test("a split, with its branches in either order", async () => {
    // T P ∨ Q, F P, F Q
    const tree = new TreeBuilder(["T P ∨ Q", "F P", "F Q"]);
    const { nodes, rows } = tree.split(
      tree.rootNode,
      "r1",
      [["T Q"], ["T P"]],
      "T∨",
    );
    tree.close(nodes[0], rows[0][0] as string, "r3");
    tree.close(nodes[1], "r2", rows[1][0] as string);
    const checked = await check(tree, SIGNED);
    expect(where(checked.errors)).toEqual([]);
    expect(checked.verified).toBe(true);
  });

  test("a wrong sign is an error at that step", async () => {
    const { first, next, tree } = conditional("T Q → P");
    expect(where((await check(tree, SIGNED)).errors)).toEqual([
      `step ${first.join(",")}`,
      `step ${next.join(",")}`,
    ]);
  });
});
