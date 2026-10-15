/**
 * A truth tree as Aufbau proofs (gh #46).
 *
 * The theory says what a closed branch is and what each rule is; this module
 * only writes the tree down in it. A tree is a derivation of "the root
 * closes", read from the bottom up, and each of its inferences is a lemma of
 * its own:
 *
 * - a closed leaf is a lemma that its branch closes, by the closure rule,
 *   citing the rows its × cites;
 * - a step is a lemma that the branch above it closes if the branches it
 *   writes do, by the rule the student named, focused on the rows they cited
 *   (`focus Γ at Δ`, then `closes Γ` by unfocusing, which checks Δ is on Γ);
 * - an open leaf, and a step that cannot be written down (no rule, an
 *   unreadable row), is no lemma at all.
 *
 * Lemmas rather than one theorem, because a certificate proves the statements
 * it is checked against and nothing about how. One theorem, "the root
 * closes", would be proved as well by any other tree with that root; one
 * lemma per inference is proved only by the inferences this tree makes. The
 * server writes the same lemmas from the stored tree, so a certificate that
 * verifies says that every step and closure written is right, and the tree's
 * shape (which branches are closed, which steps are missing) says the rest.
 *
 * **Nothing here knows a calculus.** The theory names its plumbing by role
 * (`./theory.ts`), and a step is written the same way in any of them:
 * the rule is the student's name for it, resolved through the theory's
 * `@syntax alias`es, and a row is whatever the theory's row sort reads — a
 * sentence, a signed sentence, a sentence at a world. A lemma binds every
 * name and variable its statements mention at the sort whose `@vars` pool
 * holds it, so a rule asking for a name new to the branch is checked by MM0
 * dependency typing: the branch above may not mention the name.
 *
 * DOM-free: the browser emits and compiles, the worker verifies.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import type {
  TableauDocument,
  TableauNode,
  TableauRow,
} from "../../../../tableau/document";
import { TableauIndex } from "../../../../tableau/document";
import { type RowSortReader, rowSortReader } from "./rows";
import type { TreeTheory } from "./theory";
/** The theorem every emitted proof proves. */
export const TREE_THEOREM = "tree";

/** What a proof line is about, so a diagnostic finds its way back. */
export type LineSubject =
  /** A step: the rows the development wrote. */
  | {
      readonly type: "step";
      readonly dev: string;
      readonly rows: readonly string[];
    }
  /** The step's citation: the cited rows are not on the branch. */
  | {
      readonly type: "citation";
      readonly dev: string;
      readonly rows: readonly string[];
    }
  /** A branch's ×. */
  | { readonly type: "closure"; readonly node: string }
  /** The closure's citation. */
  | { readonly type: "closure-citation"; readonly node: string };

/** Why a step was not written down, and so is not checked. */
export type EmitProblem =
  | { readonly type: "no-rule" }
  | { readonly type: "uncited" }
  | { readonly type: "cites-differ" }
  | { readonly type: "cite-unknown" }
  | { readonly type: "unreadable" }
  | { readonly type: "split-mixed" };

export interface TreeProof {
  /** The lemmas, to append to the theory. Null if there are none. */
  readonly goal: string | null;
  /** Their proofs. Null with the goal. */
  readonly proof: string | null;
  readonly lines: ReadonlyMap<string, LineSubject>;
  /** Rows whose step was not written down, and why. */
  readonly problems: ReadonlyMap<string, EmitProblem>;
  /** Node ids whose end was not written down. */
  readonly endProblems: ReadonlyMap<string, EmitProblem>;
  /** How many branches are open: neither closed nor ended by a step. */
  readonly hypotheses: number;
  /** How many steps or ends were not written down. */
  readonly gaps: number;
}

export interface EmitOptions {
  /** The tree theory, read as a language: rows parse in it. */
  readonly language: SurfaceLanguage;
  readonly theory: TreeTheory;
  /** The rule the student named for each development, by `dev`. */
  readonly rules: ReadonlyMap<string, string>;
  /** The rows' reader, shared with whatever else reads them. */
  readonly reader?: RowSortReader;
}

/** The run of rows from `start` that one development wrote. */
function groupAt(rows: readonly TableauRow[], start: number): TableauRow[] {
  const dev = rows[start]?.dev;
  const group: TableauRow[] = [];

  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index] as TableauRow;

    if (row.dev !== dev) {
      break;
    }

    group.push(row);
  }

  return group;
}

/** The leading rows of the root node: the declared root, citing nothing. */
function rootLength(root: TableauNode): number {
  let length = 0;

  while (
    length < root.rows.length &&
    (root.rows[length] as TableauRow).cites.length === 0
  ) {
    length += 1;
  }

  return length;
}

/** Every token of engine text, for finding the names and variables in it. */
function tokens(engine: string): string[] {
  return engine.split(/[\s(),]+/u).filter((token) => token.length > 0);
}

export function emitTreeProof(
  document: TableauDocument,
  options: EmitOptions,
): TreeProof {
  const { language, theory } = options;
  const index = new TableauIndex(document);
  const lines = new Map<string, LineSubject>();
  const problems = new Map<string, EmitProblem>();
  const endProblems = new Map<string, EmitProblem>();
  const statements: string[] = [];
  const proofs: string[] = [];
  const reader = options.reader ?? rowSortReader(language, theory.rowSort);
  const resolve = (name: string): string =>
    language.spec.ruleAliases.get(name) ?? name;
  const sortOf = new Map<string, string>();
  let counter = 0;
  let gaps = 0;
  let hypotheses = 0;

  for (const [sort, info] of language.spec.sorts) {
    for (const token of info.vars) {
      sortOf.set(token, sort);
    }
  }

  /** A row as engine text at the row sort, or null if it does not read. */
  const engineOf = (row: TableauRow): string | null => {
    const read = reader.read(row.text);
    return read.ok ? read.engine : null;
  };
  const engineOfId = (rowId: string): string | null => {
    const location = index.row(rowId);
    return location === null ? null : engineOf(location.row);
  };
  const readable = (rows: readonly TableauRow[]): string[] =>
    rows.flatMap((row) => {
      const engine = engineOf(row);
      return engine === null ? [] : [engine];
    });
  const branch = (rows: readonly string[]): string =>
    rows.map((row) => `(${row})`).join(` ${theory.join} `);
  const closes = (rows: readonly string[]): string =>
    `${theory.closes} (${branch(rows)})`;

  /** The binders of a lemma: what its statements mention, by sort. */
  const binders = (texts: readonly string[]): string => {
    const bound = new Map<string, string[]>();

    for (const token of new Set(texts.flatMap(tokens))) {
      const sort = sortOf.get(token);

      if (sort !== undefined) {
        bound.set(sort, [...(bound.get(sort) ?? []), token]);
      }
    }

    return [...bound]
      .map(([sort, names]) => ` {${names.join(" ")}: ${sort}}`)
      .join("");
  };

  /**
   * A lemma: `state` closes if each of `children` does, by focusing on
   * `cites` and applying `rule`.
   */
  const lemma = (
    state: readonly string[],
    children: readonly (readonly string[])[],
    cites: readonly string[],
    rule: string,
    subject: (label: "main" | "cite") => LineSubject,
  ): void => {
    counter += 1;
    const name = `${TREE_THEOREM}_${counter}`;
    const main = `f_${counter}`;
    const cite = `u_${counter}`;
    const premises = children.map((child) => closes(child));
    const conclusion = closes(state);

    statements.push(
      `theorem ${name}${binders([...premises, conclusion])}: ${premises
        .map((premise) => `$ ${premise} $ > `)
        .join("")}$ ${conclusion} $;`,
    );
    proofs.push(
      [
        name,
        "----",
        `${main}: $ ${theory.focus} (${branch(state)}) (${branch(cites)}) $ by ${rule} [${premises.map((_, at) => `#${at + 1}`).join(", ")}]`,
        `${cite}: $ ${conclusion} $ by ${theory.unfocus} [${main}]`,
      ].join("\n"),
    );
    lines.set(main, subject("main"));
    lines.set(cite, subject("cite"));
  };

  /**
   * A development: the rows it wrote, one group per branch it opens, and the
   * states of those branches.
   */
  const step = (
    state: readonly string[],
    groups: readonly (readonly TableauRow[])[],
    children: readonly (readonly string[])[],
  ): void => {
    const rows = groups.flat();
    const ids = rows.map((row) => row.id);
    const first = rows[0] as TableauRow;
    const fail = (problem: EmitProblem): void => {
      for (const id of ids) {
        problems.set(id, problem);
      }

      gaps += 1;
    };

    if (groups.some((group) => group[0]?.dev !== first.dev)) {
      fail({ type: "split-mixed" });
      return;
    }

    if (first.cites.length === 0) {
      fail({ type: "uncited" });
      return;
    }

    const citeKey = first.cites.join(" ");

    if (rows.some((row) => row.cites.join(" ") !== citeKey)) {
      fail({ type: "cites-differ" });
      return;
    }

    if (rows.some((row) => engineOf(row) === null)) {
      fail({ type: "unreadable" });
      return;
    }

    const cites = first.cites.map(engineOfId);

    if (cites.some((cite) => cite === null)) {
      fail({ type: "cite-unknown" });
      return;
    }

    const rule = options.rules.get(first.dev)?.trim() ?? "";

    if (rule.length === 0) {
      fail({ type: "no-rule" });
      return;
    }

    lemma(state, children, cites as string[], resolve(rule), (label) => ({
      dev: first.dev,
      rows: ids,
      type: label === "main" ? "step" : "citation",
    }));
  };

  /** The end of a branch: a closure, or a branch left open. */
  const end = (node: TableauNode, state: readonly string[]): void => {
    if (node.end?.type !== "closed") {
      hypotheses += 1;
      return;
    }

    const cites = node.end.cites.map(engineOfId);

    if (cites.length === 0) {
      endProblems.set(node.id, { type: "uncited" });
      gaps += 1;
      return;
    }

    if (cites.some((cite) => cite === null)) {
      endProblems.set(node.id, { type: "cite-unknown" });
      gaps += 1;
      return;
    }

    lemma(state, [], cites as string[], theory.closure, (label) => ({
      node: node.id,
      type: label === "main" ? "closure" : "closure-citation",
    }));
  };

  /** Write down the branch `state`, from `start` in `node`, and below it. */
  const walk = (
    node: TableauNode,
    start: number,
    state: readonly string[],
  ): void => {
    if (start < node.rows.length) {
      const group = groupAt(node.rows, start);
      const below = [...state, ...readable(group)];

      step(state, [group], [below]);
      walk(node, start + group.length, below);
      return;
    }

    const children = index.children(node.id);

    if (children.length === 0) {
      end(node, state);
      return;
    }

    const groups = children.map((child) => groupAt(child.rows, 0));
    const states = groups.map((group) => [...state, ...readable(group)]);

    step(state, groups, states);

    for (const [at, child] of children.entries()) {
      walk(child, (groups[at] as TableauRow[]).length, states[at] ?? state);
    }
  };

  const root = index.root;
  const nothing = (count: number): TreeProof => ({
    endProblems,
    gaps,
    goal: null,
    hypotheses: count,
    lines,
    problems,
    proof: null,
  });

  if (root === null) {
    return nothing(0);
  }

  const rootRows = root.rows.slice(0, rootLength(root));
  const rootState = readable(rootRows);

  if (rootState.length !== rootRows.length) {
    return nothing(0);
  }

  walk(root, rootRows.length, rootState);

  if (statements.length === 0) {
    return nothing(hypotheses);
  }

  return {
    endProblems,
    gaps,
    goal: statements.join("\n"),
    hypotheses,
    lines,
    problems,
    proof: `${proofs.join("\n\n")}\n`,
  };
}

/** An engine error, with what in the tree it is about, where it says. */
export interface TreeDiagnostic {
  readonly error: string | null;
  readonly message: string | null;
  /** The axiom a step cited; the student's alias resolves to it. */
  readonly rule: string | null;
  /** Null for an error about the proof as a whole. */
  readonly subject: LineSubject | null;
}

/** The errors of a compile, each led back to the step or end it is about. */
export function readTreeDiagnostics(
  diagnostics: unknown,
  proof: TreeProof,
): readonly TreeDiagnostic[] {
  if (!Array.isArray(diagnostics)) {
    return [];
  }

  return diagnostics.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }

    const record = item as Record<string, unknown>;

    if (record.severity !== "error") {
      return [];
    }

    const text = (value: unknown): string | null =>
      typeof value === "string" ? value : null;
    const label = text(record.lineLabel);

    return [
      {
        error: text(record.error),
        message: text(record.message)?.split("\n")[0] ?? null,
        rule: text(record.rule),
        subject: label === null ? null : (proof.lines.get(label) ?? null),
      },
    ];
  });
}
