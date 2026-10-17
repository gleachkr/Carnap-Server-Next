import { beforeAll, describe, expect, test } from "bun:test";
import type { LoadedCompiler } from "@aufbau/compiler";
import type { SurfaceLanguage } from "@aufbau/syntax";
import { stripSyntaxAnnotations } from "@aufbau/syntax";
import type { TreeDevelopment } from "../src/worker/exercises/truth-tree/aufbau/criteria";
import { readTreeDevelopment } from "../src/worker/exercises/truth-tree/aufbau/criteria";
import {
  emitTreeProof,
  readTreeDiagnostics,
} from "../src/worker/exercises/truth-tree/aufbau/emit";
import type { OkAxioms } from "../src/worker/exercises/truth-tree/aufbau/ok";
import { okAxioms } from "../src/worker/exercises/truth-tree/aufbau/ok";
import { rowSortReader } from "../src/worker/exercises/truth-tree/aufbau/rows";
import type { TreeTheory } from "../src/worker/exercises/truth-tree/aufbau/theory";
import {
  isTreeTheory,
  readTreeTheory,
} from "../src/worker/exercises/truth-tree/aufbau/theory";
import type { Missing } from "../src/worker/exercises/truth-tree/report";
import {
  LANGUAGE_SPEC_SOURCES,
  languageFromSource,
} from "../src/worker/logic/specs";
import { engine } from "./helpers/engine";
import { TreeBuilder } from "./helpers/truth-tree";

/**
 * A theory's development as axioms (#469): `tree_ok ρ Γ` and
 * `tree_okat_<rule> ρ t Γ`, generated from its rules, asked of real branches
 * and answered by the engine alone.
 */

interface System {
  readonly language: SurfaceLanguage;
  readonly theory: TreeTheory;
  readonly development: TreeDevelopment;
  readonly mm0: string;
  readonly ok: OkAxioms | null;
}

function system(source: string): System {
  const language = languageFromSource(source);

  if (language === null) {
    throw new Error("the theory does not read as a language");
  }

  const theory = readTreeTheory(language);

  if (!isTreeTheory(theory)) {
    throw new Error(`not a tree theory: ${JSON.stringify(theory)}`);
  }

  const development = readTreeDevelopment(language, theory);

  return {
    development,
    language,
    mm0: stripSyntaxAnnotations(source),
    ok: okAxioms(language, theory, development),
    theory,
  };
}

const UBC_SOURCE = LANGUAGE_SPEC_SOURCES["forallx-ubc"] ?? "";
const UBC = system(UBC_SOURCE);
const OLP = system(LANGUAGE_SPEC_SOURCES["open-logic-tableaux"] ?? "");

let compiler: LoadedCompiler;

beforeAll(async () => {
  compiler = await engine();
});

/** A row's engine text. */
function row(on: System, text: string): string {
  const read = rowSortReader(on.language, on.theory.rowSort).read(text);

  if (!read.ok) {
    throw new Error(`the row ${text} does not read`);
  }

  return read.engine;
}

/**
 * What each branch of a tree marked open is missing, by the engine: the
 * theorems the tree's proof states of them that it could not prove, by
 * leaf. Every other line must hold.
 */
function missingOn(
  on: System,
  built: TreeBuilder,
): ReadonlyMap<string, readonly Missing[]> {
  const proof = emitTreeProof(built.tree, {
    development: on.development,
    language: on.language,
    rootRows: built.root.length,
    rules: built.rules,
    theory: on.theory,
  });
  const result = compiler.compile(
    `${on.mm0}\n${proof.goal ?? ""}\n`,
    proof.proof ?? "",
  );
  const missing = new Map<string, Missing[]>();

  for (const error of readTreeDiagnostics(
    result.ok ? [] : result.diagnostics,
    proof,
  )) {
    if (error.subject?.type !== "developed") {
      throw new Error(JSON.stringify(error));
    }

    const { node } = error.subject;
    missing.set(node, [...(missing.get(node) ?? []), error.subject.missing]);
  }

  return missing;
}

/** A branch of rows, no step taken: the root alone. */
function rootBranch(on: System, texts: readonly string[]): string {
  return texts
    .map((text) => `(${row(on, text)})`)
    .join(` ${on.theory.join} `);
}

/** What one judgement asks: its statement, and the axiom it cites. */
interface Ask {
  readonly statement: string;
  readonly by: string;
}

function ok(on: System, text: string, branch: string): Ask {
  const axioms = on.ok as OkAxioms;
  return {
    by: axioms.ok.head,
    statement: `${axioms.ok.term} (${row(on, text)}) (${branch})`,
  };
}

function okat(
  on: System,
  rule: string,
  text: string,
  term: string,
  branch: string,
): Ask {
  const judgement = (on.ok as OkAxioms).general.get(rule);

  if (judgement === undefined) {
    throw new Error(`no judgement for ${rule}`);
  }

  return {
    by: judgement.head,
    statement: `${judgement.term} (${row(on, text)}) (${term}) (${branch})`,
  };
}

/** Whether each judgement holds, by the engine's word. */
function holds(on: System, asks: readonly Ask[]): boolean[] {
  const pools = new Map<string, string>();

  for (const [sort, info] of on.language.spec.sorts) {
    for (const token of info.vars) {
      pools.set(token, sort);
    }
  }

  const goals = asks.map(({ statement }, at) => {
    const bound = new Map<string, string[]>();

    for (const token of new Set(statement.split(/[\s(),]+/u))) {
      const sort = pools.get(token);

      if (sort !== undefined) {
        bound.set(sort, [...(bound.get(sort) ?? []), token]);
      }
    }

    const binders = [...bound]
      .map(([sort, names]) => ` {${names.join(" ")}: ${sort}}`)
      .join("");
    return `theorem ok_${at}${binders}: $ ${statement} $;`;
  });
  const proofs = asks.map(
    ({ by, statement }, at) =>
      `ok_${at}\n----\nk_${at}: $ ${statement} $ by ${by} []`,
  );
  const result = compiler.compile(
    `${on.mm0}\n${on.ok?.text ?? ""}\n${goals.join("\n")}\n`,
    `${proofs.join("\n\n")}\n`,
  );
  const errors = (
    Array.isArray(result.diagnostics) ? result.diagnostics : []
  ) as readonly Record<string, unknown>[];
  const failed = new Set(
    errors
      .filter((each) => each.severity === "error")
      .map((each) => String(each.lineLabel ?? each.theorem ?? each.name)),
  );

  if ([...failed].some((label) => !/^(k|ok)_\d+$/u.test(label))) {
    throw new Error(JSON.stringify(result.diagnostics, null, 1));
  }

  return asks.map(
    (_, at) => !failed.has(`k_${at}`) && !failed.has(`ok_${at}`),
  );
}

describe("the generated axioms", () => {
  const trees = [
    "forallx-ubc",
    "open-logic-tableaux",
    "open-logic-intuitionistic",
    "open-logic-simple-s5",
    "open-logic-modal-k",
    "open-logic-modal-t",
    "open-logic-modal-d",
    "open-logic-modal-k4",
    "open-logic-modal-b",
    "open-logic-modal-s4",
    "open-logic-modal-s5",
  ];

  test.each(trees)("compile with %s", (id) => {
    const each = system(LANGUAGE_SPEC_SOURCES[id] ?? "");
    const result = compiler.compile(
      `${each.mm0}\n${each.ok?.text ?? ""}`,
      "",
    );

    expect(each.ok).not.toBeNull();
    expect(result.diagnostics ?? []).toEqual([]);
  });

  test("say what they cannot state", () => {
    expect(UBC.ok?.problems).toEqual([]);
    expect(OLP.ok?.problems).toEqual([]);
    // A modal prefix's step is a bound variable, with no relation for a
    // congruence to pair, but `□𝕋` is asked for its witnesses, at the
    // branch sort.
    expect(
      system(LANGUAGE_SPEC_SOURCES["open-logic-modal-k"] ?? "").ok?.problems,
    ).toEqual([]);
  });

  test("judge a theory whose rules write no marks by its contents", () => {
    const unmarked = UBC_SOURCE.replace(
      "--| @syntax role tree.mark\n",
      "",
    ).replace("--| @syntax role tree.mark.instance\n", "");

    expect(unmarked).not.toContain("role tree.mark");
    expect(UBC.theory.byContents).toBe(false);
    expect(OLP.theory.byContents).toBe(true);
    expect(system(unmarked).theory.byContents).toBe(true);
    expect(system(unmarked).ok).not.toBeNull();
  });
});

describe("what cannot be stated", () => {
  test("a judgement no rule could be stated for is not declared", () => {
    const source = UBC_SOURCE.replace(
      "$ closes ga ; chki (∀ x ph) ({x / te} ph) ; {x / te} ph $",
      "$ closes ga ; {x / te} ph $",
    ).replace(
      "$ closes ga ; chki (¬ ∃ x ph) (¬ {x / te} ph) ; ¬ {x / te} ph $",
      "$ closes ga ; ¬ {x / te} ph $",
    );
    const unmarked = system(source);
    const result = compiler.compile(
      `${unmarked.mm0}\n${unmarked.ok?.text ?? ""}`,
      "",
    );

    expect(unmarked.ok?.problems).toEqual([
      { problem: { type: "unmarked" }, rule: "tb_all1" },
      { problem: { type: "unmarked" }, rule: "tb_nex1" },
    ]);
    expect(unmarked.ok?.general.size).toBe(0);
    expect(unmarked.ok?.text).not.toContain("tree_okat");
    expect(result.diagnostics ?? []).toEqual([]);
  });

  test("a row developed by a new name needs its rule's view", () => {
    const view =
      "--| @view {x: var} {a: name} (ga: ctx x) (ph: wff x) (ps: wff): $ closes ga ; 𝕋 ps $ > $ focus ga at (𝕋 ∃ x ph) $\n";
    const olp = LANGUAGE_SPEC_SOURCES["open-logic-tableaux"] ?? "";
    const viewless = system(olp.replace(view, ""));

    expect(olp).toContain(view);
    expect(viewless.ok?.problems).toEqual([
      { problem: { type: "no-view" }, rule: "tb_t_ex" },
    ]);
  });
});

describe("by marks (UBC)", () => {
  test("a row is developed by its step, not by its conclusions", () => {
    const branch = rootBranch(UBC, ["A", "B", "A & B"]);

    expect(
      holds(UBC, [
        ok(UBC, "A & B", branch),
        ok(UBC, "A", branch),
        ok(UBC, "B", branch),
      ]),
    ).toEqual([false, true, true]);

    const tree = new TreeBuilder(["A & B"]);
    tree.stack(tree.rootNode, "r1", ["A", "B"], "&");
    tree.open(tree.rootNode);

    expect(missingOn(UBC, tree)).toEqual(new Map());
  });

  test("a split's row is developed on each branch", () => {
    const tree = new TreeBuilder(["A ∨ B"]);
    const { nodes } = tree.split(tree.rootNode, "r1", [["A"], ["B"]], "∨");
    tree.open(nodes[0]).open(nodes[1]);

    expect(missingOn(UBC, tree)).toEqual(new Map());

    const bare = new TreeBuilder(["A ∨ B"]);
    bare.open(bare.rootNode);

    expect(missingOn(UBC, bare)).toEqual(
      new Map([[bare.rootNode, [{ kind: "developed", row: "r1" }]]]),
    );
  });

  test("every rule but identity owes its step", () => {
    const rows = ["A ≡ B", "¬(A ≡ B)", "¬¬A", "¬(A ⊃ B)", "¬∀xFx", "∃xFx"];
    const branch = rootBranch(UBC, rows);

    expect(
      holds(
        UBC,
        rows.map((text) => ok(UBC, text, branch)),
      ),
    ).toEqual(rows.map(() => false));
  });

  test("a row no rule develops owes nothing", () => {
    const rows = ["Fa", "¬Fa", "a = b", "¬a = b", "∀xFx", "¬∃xFx"];
    const branch = rootBranch(UBC, rows);

    expect(
      holds(
        UBC,
        rows.map((text) => ok(UBC, text, branch)),
      ),
    ).toEqual(rows.map(() => true));
  });

  test("a general row is developed at each name it was instantiated at", () => {
    const tree = new TreeBuilder(["∀xFx", "Ga", "Gb", "Gc"]);
    tree.stack(tree.rootNode, "r1", ["Fa"], "∀");
    tree.open(tree.rootNode);

    expect(missingOn(UBC, tree)).toEqual(
      new Map([
        [
          tree.rootNode,
          [
            { kind: "general", names: ["b"], row: "r1" },
            { kind: "general", names: ["c"], row: "r1" },
          ],
        ],
      ]),
    );

    const negated = new TreeBuilder(["¬∃xFx", "Ga"]);
    negated.stack(negated.rootNode, "r1", ["¬Fa"], "¬∃");
    negated.open(negated.rootNode);

    expect(missingOn(UBC, negated)).toEqual(new Map());
  });

  test("a general row on a branch with no names needs one (nonempty)", () => {
    const bare = new TreeBuilder(["∀xFx"]);
    bare.open(bare.rootNode);

    expect(missingOn(UBC, bare)).toEqual(
      new Map([[bare.rootNode, [{ kind: "general", names: [], row: "r1" }]]]),
    );

    const vacuous = new TreeBuilder(["∀xP"]);
    vacuous.stack(vacuous.rootNode, "r1", ["P"], "∀");
    vacuous.open(vacuous.rootNode);

    expect(missingOn(UBC, vacuous)).toEqual(new Map());
  });

  test("a vacuous general row, used once, is developed at every name", () => {
    const tree = new TreeBuilder(["∀xGa", "Fb"]);
    tree.stack(tree.rootNode, "r1", ["Ga"], "∀");
    tree.open(tree.rootNode);

    expect(missingOn(UBC, tree)).toEqual(new Map());
  });

  test("a vacuous general row, not used, needs any one instance", () => {
    const tree = new TreeBuilder(["∀xGa", "Fb", "Hc"]);
    tree.open(tree.rootNode);

    expect(missingOn(UBC, tree)).toEqual(
      new Map([[tree.rootNode, [{ kind: "general", names: [], row: "r1" }]]]),
    );
  });

  test("a rule whose premise writes no mark is never developed", () => {
    const source = UBC_SOURCE.replace(
      "$ closes ga ; chk (¬ ¬ ph) ; ph $",
      "$ closes ga ; ph $",
    );
    const unmarked = system(source);

    expect(source).not.toBe(UBC_SOURCE);
    expect(unmarked.ok?.problems).toEqual([
      { problem: { type: "unmarked" }, rule: "tb_nn" },
    ]);

    const tree = new TreeBuilder(["¬¬A"]);
    tree.stack(tree.rootNode, "r1", ["A"], "¬¬");
    tree.open(tree.rootNode);

    expect(missingOn(unmarked, tree)).toEqual(
      new Map([[tree.rootNode, [{ kind: "developed", row: "r1" }]]]),
    );
  });
});

describe("by contents (Open Logic)", () => {
  test("a row a general rule develops still owes a rule used once", () => {
    // In T, `□𝕋` takes `𝕋 □A` to every prefix the branch uses, and `T□`
    // takes it to its own once.
    const T = system(LANGUAGE_SPEC_SOURCES["open-logic-modal-t"] ?? "");
    const bare = new TreeBuilder(["1 T: □A"]);
    bare.open(bare.rootNode);

    expect(missingOn(T, bare)).toEqual(
      new Map([[bare.rootNode, [{ kind: "developed", row: "r1" }]]]),
    );

    const tree = new TreeBuilder(["1 T: □A"]);
    tree.stack(tree.rootNode, "r1", ["1 T: A"], "T□");
    tree.open(tree.rootNode);

    expect(missingOn(T, tree)).toEqual(new Map());
  });

  test("a row is developed where a premise's rows are on the branch", () => {
    const asks = (rows: readonly string[]) =>
      ok(OLP, rows[0] as string, rootBranch(OLP, rows));

    expect(
      holds(OLP, [
        asks(["F: A ∨ B", "F: A", "F: B"]),
        asks(["F: A ∨ B", "F: A"]),
        asks(["T: A ∨ B", "T: B"]),
        asks(["T: A ∨ B"]),
      ]),
    ).toEqual([true, false, true, false]);
  });

  test("a premise's two rows can be one row", () => {
    expect(
      holds(OLP, [
        ok(OLP, "T: A ∧ A", rootBranch(OLP, ["T: A ∧ A", "T: A"])),
        ok(OLP, "T: A ∧ A", rootBranch(OLP, ["T: A ∧ A"])),
      ]),
    ).toEqual([true, false]);
  });

  test("a row whose rule writes a new name is developed by any instance", () => {
    expect(
      holds(OLP, [
        ok(OLP, "T: ∃x F(x)", rootBranch(OLP, ["T: ∃x F(x)", "T: F(a)"])),
        ok(OLP, "T: ∃x F(x)", rootBranch(OLP, ["T: ∃x F(x)", "T: G(a)"])),
        ok(OLP, "F: ∀x F(x)", rootBranch(OLP, ["F: ∀x F(x)", "F: F(b)"])),
      ]),
    ).toEqual([true, false, true]);
  });

  test("a general row is developed at each term with its instance", () => {
    const branch = rootBranch(OLP, ["T: ∀x F(x)", "T: F(a)", "T: G(b)"]);

    expect(
      holds(OLP, [
        okat(OLP, "tb_t_all", "T: ∀x F(x)", "a", branch),
        okat(OLP, "tb_t_all", "T: ∀x F(x)", "b", branch),
        ok(OLP, "T: ∀x F(x)", branch),
        ok(OLP, "T: G(b)", branch),
      ]),
    ).toEqual([true, false, true, true]);
  });
});
