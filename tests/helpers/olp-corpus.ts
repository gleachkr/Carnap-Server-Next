import type { ResolvedTree } from "../../src/worker/exercises/truth-tree/grading";
import type { OlpTableauRow } from "./olp-first-order-tableaux";
import { TreeBuilder } from "./truth-tree";

/**
 * The Open Logic Project's worked tableaux, replayed: each written as a
 * student would write it, every step the book's, by the rule it names and
 * citing the rows it cites, and each branch it closes closed. The book's
 * closures cite nothing, so a closure here cites the branch's first pair of
 * one row signed both ways, and cites nothing where there is none. Shared by
 * the first-order and modal corpora.
 */

/** A row's sign, and the rest after it: `1.1 𝕋 A` is 𝕋 and `A`. */
const SIGNED = /^(.*?)([𝕋𝔽]) (.*)$/u;

function sign(row: OlpTableauRow): string {
  return SIGNED.exec(row.row)?.[2] ?? "";
}

/** The tree's assumptions: the rows from the top that the book justifies so. */
export function assumptions(tree: OlpTableauRow): OlpTableauRow[] {
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
export function question(rows: readonly OlpTableauRow[]): {
  readonly body: string;
  readonly order: readonly OlpTableauRow[];
} | null {
  const assert = rows.filter((row) => sign(row) === "𝕋");
  const deny = rows.filter((row) => sign(row) === "𝔽");
  const formula = (row: OlpTableauRow) =>
    SIGNED.exec(row.row)?.[3] ?? row.row;

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

/** How many rows a stacking rule writes, from the theory. */
function writes(resolved: ResolvedTree, rule: string): number {
  const axiom = resolved.language.spec.ruleAliases.get(rule) ?? rule;
  const written =
    resolved.development.byAxiom.get(axiom)?.variants[0]?.written;
  return written?.length === 1 ? (written[0]?.length ?? 1) : 1;
}

/**
 * The book's tree, written in the builder, and the id each of its written
 * rows got, in preorder.
 */
export function write(
  resolved: ResolvedTree,
  root: readonly OlpTableauRow[],
  order: readonly OlpTableauRow[],
): { readonly tree: TreeBuilder; readonly written: readonly string[] } {
  const tree = new TreeBuilder(order.map((row) => row.row));
  const ids = new Map<OlpTableauRow, string>();
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
    const branch = [...lines.values()];

    for (const yes of branch) {
      const text = engineOf(yes);

      if (text === null || !text.includes("𝕋")) {
        continue;
      }

      const no = branch.find((id) => engineOf(id) === text.replace("𝕋", "𝔽"));

      if (no !== undefined) {
        tree.close(node, yes, no);
        return;
      }
    }

    // No pair to close on, where a row is signed wrong: the closure cites
    // nothing, which is itself a problem.
    tree.close(node);
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
        const id = made.rows[at]?.[0] as string;
        ids.set(row, id);
        after(
          made.nodes[at] as string,
          row,
          line,
          new Map(lines).set(line, id),
        );
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

    const made = tree.stack(
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

    for (const [at, id] of made.entries()) {
      branch.set(line + at, id);
      ids.set(run[at] as OlpTableauRow, id);
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

  const written: string[] = [];
  const walk = (row: OlpTableauRow) => {
    const id = ids.get(row);

    if (id !== undefined) {
      written.push(id);
    }

    row.children?.forEach(walk);
  };
  walk(root[0] as OlpTableauRow);

  return { tree, written };
}

/** Whether the book closes every branch. */
export function closesEverywhere(row: OlpTableauRow): boolean {
  const children = row.children ?? [];
  return children.length === 0
    ? row.closed === true
    : children.every(closesEverywhere);
}

/** The tree with its `n`th written row (in preorder) signed the other way. */
export function flipped(
  tree: OlpTableauRow,
  n: number,
): OlpTableauRow | null {
  let seen = 0;
  let done = false;
  const walk = (row: OlpTableauRow): OlpTableauRow => {
    let text = row.row;

    if (row.by !== undefined && !done) {
      if (seen === n) {
        text = text.includes("𝕋")
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
