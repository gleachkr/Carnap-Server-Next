/**
 * A truth tree as Aufbau theorems (gh #46).
 *
 * The theory says what a closed branch is and what each rule is; this module
 * only writes the tree down in it. A tree is a derivation of "the root
 * closes", read from the bottom up, and each of its inferences is a theorem
 * of its own, appended to the theory as the spec the certificate must prove:
 *
 * - a closed leaf is a theorem that its branch closes, by the closure rule,
 *   citing the rows its × cites;
 * - a step is a theorem that the branch above it closes if the branches it
 *   writes do, by the rule the student named, focused on the rows they cited
 *   (`focus Γ at Δ`, then `closes Γ` by unfocusing, which checks Δ is on Γ);
 * - a row of a step whose rule counts instances may have a link: a theorem
 *   that the row is the rule's template at a given term (`Rab` is
 *   `{x / a} Rxb`), proved by the judgement relation's reflexivity, so the
 *   engine confirms which instance the step used;
 * - an open leaf, and a step that cannot be written down (no rule, an
 *   unreadable row), is no theorem at all.
 *
 * One theorem per inference rather than one for the tree, so that the
 * engine's errors land on the line of the step at fault, and so that a
 * branch left open is a theorem's missing premise rather than a hole in one
 * proof. The server writes the same theorems from the stored tree, and the
 * tree's shape (which branches are closed, which steps are missing) says the
 * rest.
 *
 * **What a certificate proves.** A certificate proves the statements it is
 * checked against and nothing about how. A step's statement is only "the
 * branch above closes if the branches it writes do"; the rule, the cited
 * rows and the focus are in the proof text, which the browser writes and the
 * server never sees. So a certificate made by hand can prove a step's
 * theorem without its rule wherever the branch above closes anyway, and the
 * step is credited though wrong. This is accepted: proving that branch
 * closes takes a closed tableau for it, which earns the same credit
 * honestly, and nothing the theory does not prove is ever certified. A
 * certificate from the editor proves each theorem as its proof text says.
 *
 * **Nothing here knows a calculus.** The theory names its plumbing by role
 * (`./theory.ts`), and a step is written the same way in any of them:
 * the rule is the student's name for it, resolved through the theory's
 * `@syntax alias`es, and a row is whatever the theory's row sort reads — a
 * sentence, a signed sentence, a sentence at a world. A theorem binds every
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
import type { TreeDevelopment } from "./criteria";
import { matchFocus, templateFor } from "./criteria";
import { closedSubterms, instantiate, termKey } from "./patterns";
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
  /** A link: the row was written with this instance of its rule. */
  | {
      readonly type: "link";
      readonly row: string;
      readonly instance: string;
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
  /** The theorems, to append to the theory. Null if there are none. */
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
  /** Every step written down, by its `dev`. */
  readonly steps: ReadonlyMap<string, EmittedStep>;
  /**
   * The rows whose rule counts instances, each with the terms it could have
   * been written with: the closed terms of the instance's sort in it.
   */
  readonly slots: ReadonlyMap<string, readonly string[]>;
  /** The instances each row's link theorems state, by row. */
  readonly linked: ReadonlyMap<string, readonly string[]>;
}

/** A step written down: the rule it names, what it cites and writes. */
export interface EmittedStep {
  /** The axiom the student's name for the rule resolves to. */
  readonly rule: string;
  readonly cites: readonly string[];
  readonly rows: readonly string[];
}

export interface EmitOptions {
  /** The tree theory, read as a language: rows parse in it. */
  readonly language: SurfaceLanguage;
  readonly theory: TreeTheory;
  /** The rule the student named for each development, by `dev`. */
  readonly rules: ReadonlyMap<string, string>;
  /** The rows' reader, shared with whatever else reads them. */
  readonly reader?: RowSortReader;
  /**
   * How many of the root node's rows are the exercise's root. Every row
   * after them is a step's, cited or not: a row the student wrote with no
   * citation is an unfinished step, never another assumption.
   */
  readonly rootRows: number;
  /** The theory's development rules: where a step's instances are. */
  readonly development?: TreeDevelopment;
  /**
   * The instances to state of each row, by row id: one for a tree to
   * certify, every candidate for a compile that asks which holds. Only a
   * row's own candidates are stated.
   */
  readonly instances?: ReadonlyMap<string, readonly string[]>;
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
  const steps = new Map<string, EmittedStep>();
  const slots = new Map<string, readonly string[]>();
  const linked = new Map<string, readonly string[]>();
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
    rows.length === 0 && theory.empty !== null
      ? theory.empty.engine
      : rows.map((row) => `(${row})`).join(` ${theory.join} `);
  /** Whether a rule is one that cites no row: its focus is the empty branch. */
  const citesNothing = (axiom: string): boolean =>
    options.development?.byAxiom.get(axiom)?.patterns.focus.length === 0;
  const closes = (rows: readonly string[]): string =>
    `${theory.closes} (${branch(rows)})`;

  /** The binders of a theorem: what its statements mention, by sort. */
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
   * A step's theorem: `state` closes if each of `children` does, by focusing on
   * `cites` and applying `rule`.
   */
  const inference = (
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
   * The links of a step whose rule counts instances: for each row it wrote
   * and each instance asked of it, a theorem that the row is the rule's
   * template with that instance, which the engine proves only if it is.
   */
  const links = (
    rule: string,
    cited: readonly string[],
    rows: readonly TableauRow[],
  ): void => {
    const development = options.development;
    const developing = development?.byAxiom.get(rule);
    const slot = developing?.instance ?? null;
    const relation = development?.relation ?? null;
    const focus = cited.length === 1 ? reader.read(cited[0] as string) : null;

    if (
      developing === undefined ||
      slot === null ||
      relation === null ||
      focus?.ok !== true
    ) {
      return;
    }

    const bindings = matchFocus(language, developing, focus.term);

    if (bindings === null) {
      return;
    }

    for (const row of rows) {
      const read = reader.read(row.text);

      if (!read.ok) {
        continue;
      }

      const candidates = closedSubterms(language, read.term, slot.sort);
      const asked = (options.instances?.get(row.id) ?? []).filter(
        (instance, at, all) =>
          candidates.includes(instance) && all.indexOf(instance) === at,
      );

      slots.set(row.id, candidates);

      for (const instance of asked) {
        const term = language.parse(instance, {
          lints: false,
          mode: "engine",
          sort: slot.sort,
        });
        const written = term.ok
          ? termKey(
              language,
              instantiate(
                templateFor(language, developing, slot, bindings, read.term),
                new Map([...bindings, [slot.binder, term.term]]),
              ),
            )
          : null;

        if (written === null) {
          continue;
        }

        counter += 1;
        const name = `${TREE_THEOREM}_${counter}`;
        const label = `k_${counter}`;
        const premise = closes([read.engine]);
        const conclusion = closes([written]);

        statements.push(
          `theorem ${name}${binders([premise, conclusion])}: $ ${premise} $ > $ ${conclusion} $;`,
        );
        proofs.push(
          [
            name,
            "----",
            `${label}: $ ${conclusion} $ by ${relation.mp} [${relation.refl} [], #1]`,
          ].join("\n"),
        );
        lines.set(label, { instance, row: row.id, type: "link" });
        linked.set(row.id, [...(linked.get(row.id) ?? []), instance]);
      }
    }
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

    const rule = options.rules.get(first.dev)?.trim() ?? "";
    const axiom = resolve(rule);

    // A step that cites nothing is unfinished, unless its rule cites nothing
    // (Cut): it focuses on the empty branch.
    if (first.cites.length === 0 && !citesNothing(axiom)) {
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

    if (rule.length === 0) {
      fail({ type: "no-rule" });
      return;
    }

    inference(state, children, cites as string[], axiom, (label) => ({
      dev: first.dev,
      rows: ids,
      type: label === "main" ? "step" : "citation",
    }));
    steps.set(first.dev, { cites: first.cites, rows: ids, rule: axiom });
    links(
      axiom,
      first.cites.map((cite) => index.row(cite)?.row.text ?? ""),
      rows,
    );
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

    inference(state, [], cites as string[], theory.closure, (label) => ({
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
    linked,
    lines,
    problems,
    proof: null,
    slots,
    steps,
  });

  if (root === null) {
    return nothing(0);
  }

  const rootRows = root.rows.slice(0, options.rootRows);
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
    linked,
    lines,
    problems,
    proof: `${proofs.join("\n\n")}\n`,
    slots,
    steps,
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

/**
 * The instance each row was written with, from a compile that stated every
 * candidate (`instances` = a proof's own `slots`): the first whose link the
 * engine did not refuse. A row whose every link failed has none.
 */
export function heldInstances(
  asked: TreeProof,
  errors: readonly TreeDiagnostic[],
): Map<string, string> {
  const refused = new Set<string>();

  for (const error of errors) {
    if (error.subject?.type === "link") {
      refused.add(`${error.subject.row} ${error.subject.instance}`);
    }
  }

  const held = new Map<string, string>();

  for (const [row, candidates] of asked.linked) {
    const instance = candidates.find(
      (candidate) => !refused.has(`${row} ${candidate}`),
    );

    if (instance !== undefined) {
      held.set(row, instance);
    }
  }

  return held;
}
