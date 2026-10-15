/**
 * A truth tree as an Aufbau proof (gh #46).
 *
 * The theory says what a closed branch is and what each rule is; this module
 * only writes the tree down in it. A tree is a derivation of "the root
 * closes", read from the bottom up:
 *
 * - a closed leaf is a closure, citing the rows its × cites;
 * - a step derives the branch above it from the branches it writes, by the
 *   rule the student named, focused on the rows they cited (`focus Γ at Δ`,
 *   then `closes Γ` by unfocusing, which checks Δ is on Γ);
 * - an open leaf is a hypothesis of the theorem: a closed tree proves its root
 *   closes outright, and a finished tree with open branches proves it closes
 *   if they do, which says nothing false about a consistent root;
 * - a step that cannot be written down (no rule, an unreadable row) is a gap,
 *   a line admitted with `sorry!`, so the steps below it are still checked and
 *   the tree cannot verify until it is filled.
 *
 * **Nothing here knows a calculus.** The theory names its plumbing by role
 * (`./theory.ts`), and a step is written the same way in any of them:
 * the rule is the student's name for it, resolved through the theory's
 * `@syntax alias`es, and a row is whatever the theory's row sort reads — a
 * sentence, a signed sentence, a sentence at a world. The theorem binds every
 * name and variable its statement mentions (the root, and the open branches)
 * at the sort whose `@vars` pool holds it; a name a step introduces is the
 * proof's own dummy. Either way a rule asking for a name new to the branch is
 * checked by MM0 dependency typing.
 *
 * DOM-free: the browser emits and compiles, the worker verifies.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import { printTerm } from "@aufbau/syntax";
import type {
  TableauDocument,
  TableauNode,
  TableauRow,
} from "../../../../tableau/document";
import { TableauIndex } from "../../../../tableau/document";
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
  | { readonly type: "closure-citation"; readonly node: string }
  /** A step or end that was not written down; see {@link TreeProof.problems}. */
  | { readonly type: "gap" };

/** Why a step was not written down, and so is not checked. */
export type EmitProblem =
  | { readonly type: "no-rule" }
  | { readonly type: "uncited" }
  | { readonly type: "cites-differ" }
  | { readonly type: "cite-unknown" }
  | { readonly type: "unreadable" }
  | { readonly type: "split-mixed" };

export interface TreeProof {
  /** The theorem, to append to the theory. Null if nothing can be checked. */
  readonly goal: string | null;
  /** The proof body. Null with the goal. */
  readonly proof: string | null;
  readonly lines: ReadonlyMap<string, LineSubject>;
  /** Rows whose step was not written down, and why. */
  readonly problems: ReadonlyMap<string, EmitProblem>;
  /** Node ids whose end was not written down. */
  readonly endProblems: ReadonlyMap<string, EmitProblem>;
  /** How many open branches the proof assumes closed. */
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
  const body: string[] = [];
  const hypotheses = new Map<string, string>();
  const read = new Map<string, string | null>();
  const resolve = (name: string): string =>
    language.spec.ruleAliases.get(name) ?? name;
  let counter = 0;
  let gaps = 0;

  /** A row as engine text at the row sort, or null if it does not read. */
  const engineOf = (row: TableauRow): string | null => {
    const text = row.text.trim();
    let engine = read.get(text);

    if (engine === undefined) {
      const parsed = language.parse(text, { sort: theory.rowSort });
      engine = parsed.ok ? printTerm(language, parsed.term, "engine") : null;
      read.set(text, engine);
    }

    return engine;
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

  /** A branch the proof assumes closed. */
  const assume = (state: readonly string[]): string => {
    const text = closes(state);
    let reference = hypotheses.get(text);

    if (reference === undefined) {
      reference = `#${hypotheses.size + 1}`;
      hypotheses.set(text, reference);
    }

    return reference;
  };

  /** A branch whose step could not be written down: admitted, not checked. */
  const gap = (state: readonly string[]): string => {
    counter += 1;
    const label = `g_${counter}`;

    body.push(`${label}: $ ${closes(state)} $ by sorry!`);
    lines.set(label, { type: "gap" });
    gaps += 1;

    return label;
  };

  /**
   * Write `closes state` down by focusing on `cites` and applying `rule` to
   * `premises`: the focused line, then the unfocusing one. The label of the
   * second.
   */
  const focused = (
    state: readonly string[],
    cites: readonly string[],
    rule: string,
    premises: readonly string[],
    subject: (label: "main" | "cite") => LineSubject,
  ): string => {
    counter += 1;
    const main = `s_${counter}`;
    const cite = `u_${counter}`;

    body.push(
      `${main}: $ ${theory.focus} (${branch(state)}) (${branch(cites)}) $ by ${rule} [${premises.join(", ")}]`,
      `${cite}: $ ${closes(state)} $ by ${theory.unfocus} [${main}]`,
    );
    lines.set(main, subject("main"));
    lines.set(cite, subject("cite"));

    return cite;
  };

  /**
   * A development: the rows it wrote, one group per branch it opens, and the
   * proofs of those branches. The label proving the branch above it.
   */
  const step = (
    state: readonly string[],
    groups: readonly (readonly TableauRow[])[],
    premises: readonly string[],
  ): string => {
    const rows = groups.flat();
    const ids = rows.map((row) => row.id);
    const first = rows[0] as TableauRow;
    const fail = (problem: EmitProblem): string => {
      for (const id of ids) {
        problems.set(id, problem);
      }

      return gap(state);
    };

    if (groups.some((group) => group[0]?.dev !== first.dev)) {
      return fail({ type: "split-mixed" });
    }

    if (first.cites.length === 0) {
      return fail({ type: "uncited" });
    }

    const citeKey = first.cites.join(" ");

    if (rows.some((row) => row.cites.join(" ") !== citeKey)) {
      return fail({ type: "cites-differ" });
    }

    if (rows.some((row) => engineOf(row) === null)) {
      return fail({ type: "unreadable" });
    }

    const cites = first.cites.map(engineOfId);

    if (cites.some((cite) => cite === null)) {
      return fail({ type: "cite-unknown" });
    }

    const rule = options.rules.get(first.dev)?.trim() ?? "";

    if (rule.length === 0) {
      return fail({ type: "no-rule" });
    }

    return focused(
      state,
      cites as string[],
      resolve(rule),
      premises,
      (label) => ({
        dev: first.dev,
        rows: ids,
        type: label === "main" ? "step" : "citation",
      }),
    );
  };

  /** The end of a branch: a closure, or a branch the proof assumes. */
  const end = (node: TableauNode, state: readonly string[]): string => {
    if (node.end?.type !== "closed") {
      return assume(state);
    }

    const cites = node.end.cites.map(engineOfId);

    if (cites.length === 0) {
      endProblems.set(node.id, { type: "uncited" });
      return gap(state);
    }

    if (cites.some((cite) => cite === null)) {
      endProblems.set(node.id, { type: "cite-unknown" });
      return gap(state);
    }

    return focused(state, cites as string[], theory.closure, [], (label) => ({
      node: node.id,
      type: label === "main" ? "closure" : "closure-citation",
    }));
  };

  /** The label proving that the branch `state` closes, from `start` in `node`. */
  const prove = (
    node: TableauNode,
    start: number,
    state: readonly string[],
  ): string => {
    if (start < node.rows.length) {
      const group = groupAt(node.rows, start);
      const below = prove(node, start + group.length, [
        ...state,
        ...readable(group),
      ]);

      return step(state, [group], [below]);
    }

    const children = index.children(node.id);

    if (children.length === 0) {
      return end(node, state);
    }

    const groups = children.map((child) => groupAt(child.rows, 0));
    const premises = children.map((child, at) => {
      const group = groups[at] as TableauRow[];
      return prove(child, group.length, [...state, ...readable(group)]);
    });

    return step(state, groups, premises);
  };

  const root = index.root;
  const empty: TreeProof = {
    endProblems,
    gaps: 0,
    goal: null,
    hypotheses: 0,
    lines,
    problems,
    proof: null,
  };

  if (root === null) {
    return empty;
  }

  const rootRows = root.rows.slice(0, rootLength(root));
  const rootState = readable(rootRows);

  if (rootState.length !== rootRows.length) {
    return empty;
  }

  const last = prove(root, rootRows.length, rootState);

  if (last.startsWith("#")) {
    // The root is an open leaf: nothing has been written to check.
    return { ...empty, hypotheses: hypotheses.size };
  }

  // Bind every name and variable the statement mentions at its own sort.
  const sortOf = new Map<string, string>();

  for (const [sort, info] of language.spec.sorts) {
    for (const token of info.vars) {
      sortOf.set(token, sort);
    }
  }

  const bound = new Map<string, string[]>();
  const statements = [...hypotheses.keys(), closes(rootState)];

  for (const token of new Set(statements.flatMap(tokens))) {
    const sort = sortOf.get(token);

    if (sort !== undefined) {
      bound.set(sort, [...(bound.get(sort) ?? []), token]);
    }
  }

  const binders = [...bound]
    .map(([sort, names]) => `{${names.join(" ")}: ${sort}}`)
    .join(" ");
  const premises = [...hypotheses.keys()]
    .map((statement) => `$ ${statement} $ > `)
    .join("");

  return {
    endProblems,
    gaps,
    goal: `theorem ${TREE_THEOREM} ${binders}: ${premises}$ ${closes(rootState)} $;`,
    hypotheses: hypotheses.size,
    lines,
    problems,
    proof: `${TREE_THEOREM}\n----\n${body.join("\n")}\n`,
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
