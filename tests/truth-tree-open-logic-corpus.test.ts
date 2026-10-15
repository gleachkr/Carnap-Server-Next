import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../src/worker/domain/content";
import { withSystemText } from "../src/worker/exercise-kit/systems/join";
import type { ResolvedTree } from "../src/worker/exercises/truth-tree/grading";
import { resolveTruthTree } from "../src/worker/exercises/truth-tree/grading";
import type { TreeReport } from "../src/worker/exercises/truth-tree/logic/check";
import type { TruthTreePublicData } from "../src/worker/exercises/truth-tree/types";
import type {
  OlpTableau,
  OlpTableauRow,
} from "./helpers/olp-first-order-tableaux";
import { OLP_FIRST_ORDER_TABLEAUX } from "./helpers/olp-first-order-tableaux";
import { engine, TreeBuilder } from "./helpers/truth-tree";
import { judgeAsBrowser } from "./helpers/truth-tree-differential";

/**
 * Every worked tableau of the Open Logic Project's first-order chapter,
 * written as a student would write it in `open-logic-tableaux` and judged as
 * the browser judges it: each step the book's, by the rule it names and
 * citing the rows it cites, and each branch it closes closed. The book's
 * closures cite nothing, so a closure here cites the branch's first pair of
 * one formula signed both ways.
 */

/**
 * The book's trees with a step wrong: one on purpose (its ∃𝕋 constant is not
 * new, to show why it must be), and one by a slip in the source, which
 * labels the two `∧𝕋` rows below `𝕋 A ∧ B` `→𝕋` (`\TRule{\True}{\lif}[2]`).
 */
const WRONG: ReadonlySet<string> = new Set([
  "tableaux/quantifier-rules.tex #1",
  "proof-systems/tableaux.tex #1",
]);

const SIGNS = /^[𝕋𝔽] /u;

/** The tree's assumptions: the rows from the top that the book justifies so. */
function assumptions(tree: OlpTableauRow): OlpTableauRow[] {
  const rows: OlpTableauRow[] = [];
  let row: OlpTableauRow | undefined = tree;

  while (row !== undefined && row.by === undefined) {
    rows.push(row);
    row = row.children?.length === 1 ? row.children[0] : undefined;
  }

  return rows;
}

/**
 * The exercise the assumptions make, if one can: the true ones premises and
 * one false one the conclusion, or the true ones alone a set to test.
 */
function question(rows: readonly OlpTableauRow[]): {
  readonly body: string;
  readonly order: readonly OlpTableauRow[];
} | null {
  const assert = rows.filter((row) => row.row.startsWith("𝕋"));
  const deny = rows.filter((row) => row.row.startsWith("𝔽"));
  const formula = (row: OlpTableauRow) => row.row.replace(SIGNS, "");

  if (deny.length === 0) {
    return {
      body: assert.map((row) => `- ${formula(row)}`).join("\n"),
      order: assert,
    };
  }

  if (deny.length === 1) {
    return {
      body: `${assert.map(formula).join(", ")} :|-: ${formula(deny[0] as OlpTableauRow)}`,
      order: [...assert, deny[0] as OlpTableauRow],
    };
  }

  return null;
}

async function exercise(body: string): Promise<{
  resolved: ResolvedTree;
  mm0: string;
}> {
  const result = await compileCarnapMarkdown(
    `::::truth-tree{#t system="open-logic-tableaux"}\nShow it.\n\n${body}\n::::`,
  );

  if (!result.ok) {
    throw new Error(
      result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
    );
  }

  const raw = result.artifact.manifest[0] as ExerciseManifestItem;
  const publicData = withSystemText(
    raw.publicData,
    result.artifact.systems,
  ) as unknown as TruthTreePublicData;
  const resolved = resolveTruthTree(publicData);

  if (resolved === null || publicData.mm0 === undefined) {
    throw new Error("the exercise does not resolve");
  }

  return { mm0: publicData.mm0, resolved };
}

/** How many rows a stacking rule writes, from the theory. */
function writes(resolved: ResolvedTree, rule: string): number {
  const axiom = resolved.language.spec.ruleAliases.get(rule) ?? rule;
  const shape = resolved.development.byAxiom.get(axiom)?.shapes[0];
  return shape?.length === 1 ? (shape[0] as number) : 1;
}

/** The book's tree, written in the builder. */
function write(
  resolved: ResolvedTree,
  root: readonly OlpTableauRow[],
  order: readonly OlpTableauRow[],
): TreeBuilder {
  const tree = new TreeBuilder(order.map((row) => row.row));
  // A line is a row's depth, from 1: the row on this branch at that depth.
  const rootLines = new Map(
    root.map((row, at) => [at + 1, `r${order.indexOf(row) + 1}`]),
  );
  const engineOf = (id: string): string | null => {
    const location = tree.tree.nodes
      .flatMap((node) => node.rows)
      .find((row) => row.id === id);
    const read =
      location === undefined ? null : resolved.reader.read(location.text);
    return read?.ok === true ? read.engine : null;
  };
  const cited = (lines: Map<number, string>, cites: readonly number[]) =>
    cites.map((line) => lines.get(line) as string);

  const close = (node: string, lines: Map<number, string>) => {
    const ids = [...lines.values()];

    for (const yes of ids) {
      const text = engineOf(yes);

      if (text === null || !text.startsWith("(𝕋")) {
        continue;
      }

      const no = ids.find((id) => engineOf(id) === text.replace("𝕋", "𝔽"));

      if (no !== undefined) {
        tree.close(node, yes, no);
        return;
      }
    }

    throw new Error("the book closes a branch with no pair to close on");
  };

  const after = (
    node: string,
    row: OlpTableauRow,
    line: number,
    lines: Map<number, string>,
  ) => {
    if (row.closed === true) {
      close(node, lines);
    } else {
      develop(node, row.children ?? [], line + 1, lines);
    }
  };

  const develop = (
    node: string,
    rows: readonly OlpTableauRow[],
    line: number,
    lines: Map<number, string>,
  ) => {
    const first = rows[0];

    if (first === undefined) {
      return;
    }

    const rule = first.by as string;
    const cites = cited(lines, first.cites ?? []);

    if (rows.length > 1) {
      const made = tree.split(
        node,
        cites[0] ?? null,
        rows.map((row) => [row.row]),
        rule,
      );

      for (const [at, row] of rows.entries()) {
        const branch = new Map(lines).set(line, made.rows[at]?.[0] as string);
        after(made.nodes[at] as string, row, line, branch);
      }

      return;
    }

    // One step's rows: as many as the rule writes, down one branch.
    const run: OlpTableauRow[] = [first];

    while (run.length < writes(resolved, rule)) {
      const next = run[run.length - 1]?.children?.[0];

      if (next === undefined || next.by !== rule) {
        break;
      }

      run.push(next);
    }

    const ids = tree.stack(
      node,
      cites.length === 0
        ? null
        : cites.length === 1
          ? (cites[0] as string)
          : cites,
      run.map((row) => row.row),
      rule,
    );
    const branch = new Map(lines);

    for (const [at, id] of ids.entries()) {
      branch.set(line + at, id);
    }

    after(
      node,
      run[run.length - 1] as OlpTableauRow,
      line + run.length - 1,
      branch,
    );
  };

  const last = root[root.length - 1] as OlpTableauRow;
  after(tree.rootNode, last, root.length, rootLines);
  return tree;
}

/** Whether the book closes every branch. */
function closesEverywhere(row: OlpTableauRow): boolean {
  const children = row.children ?? [];
  return children.length === 0
    ? row.closed === true
    : children.every(closesEverywhere);
}

function problems(report: TreeReport): string[] {
  return report.problems.map(({ at }) =>
    at.type === "tree"
      ? `tree: ${at.problem.type}`
      : `${at.type} ${at.id}: ${at.problem.type}`,
  );
}

async function judge(
  tableau: OlpTableau,
): Promise<{ report: TreeReport } | null> {
  const root = assumptions(tableau.tree);
  const asked = question(root);

  if (asked === null) {
    return null;
  }

  const { mm0, resolved } = await exercise(asked.body);
  const tree = write(resolved, root, asked.order);
  return {
    report: judgeAsBrowser(await engine(), resolved, mm0, tree.answer()),
  };
}

describe("the Open Logic Project's first-order tableaux", () => {
  for (const tableau of OLP_FIRST_ORDER_TABLEAUX) {
    test(tableau.from, async () => {
      const judged = await judge(tableau);

      if (judged === null) {
        throw new Error("its assumptions are no exercise");
      }

      if (WRONG.has(tableau.from)) {
        expect(problems(judged.report).join("\n")).toContain("step-wrong");
        return;
      }

      expect(problems(judged.report)).toEqual([]);
      expect(judged.report.closed).toBe(closesEverywhere(tableau.tree));
    }, 60_000);
  }
});

/** The tree with its `n`th written row (in preorder) signed the other way. */
function flipped(tree: OlpTableauRow, n: number): OlpTableauRow | null {
  let seen = 0;
  let done = false;
  const walk = (row: OlpTableauRow): OlpTableauRow => {
    let text = row.row;

    if (row.by !== undefined && !done) {
      if (seen === n) {
        text = text.startsWith("𝕋")
          ? text.replace("𝕋", "𝔽")
          : text.replace("𝔽", "𝕋");
        done = true;
      }

      seen += 1;
    }

    return {
      ...row,
      row: text,
      ...(row.children === undefined
        ? {}
        : { children: row.children.map(walk) }),
    };
  };
  const result = walk(tree);
  return done ? result : null;
}

describe("a book tableau with one row signed wrong is refused", () => {
  for (const tableau of OLP_FIRST_ORDER_TABLEAUX) {
    if (WRONG.has(tableau.from)) {
      continue;
    }

    test(tableau.from, async () => {
      const refused: string[] = [];

      for (let n = 0; ; n += 1) {
        const tree = flipped(tableau.tree, n);

        if (tree === null) {
          break;
        }

        let judged: { report: TreeReport } | null;

        try {
          judged = await judge({ from: tableau.from, tree });
        } catch {
          // The book's closure has no pair to close on: refused all the same.
          refused.push(`row ${n}`);
          continue;
        }

        if (judged !== null && problems(judged.report).length > 0) {
          refused.push(`row ${n}`);
        }

        expect(refused).toContain(`row ${n}`);
      }
    }, 120_000);
  }
});
