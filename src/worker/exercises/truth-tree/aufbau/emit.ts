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
 * - a leaf marked open is a theorem for each question `./developed.ts` asks
 *   of its branch: that each row on it is developed there, by the axioms
 *   `./ok.ts` states, where the theory says how; the engine proves each only
 *   if it is;
 * - a step that cannot be written down (no rule, an unreadable row), and a
 *   branch left unfinished, is no theorem at all.
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
import { languageRuleReader } from "../../../exercise-kit/proof/formulas";
import type { EndProblem, Missing, RowProblem } from "../report";
import type { TreeDevelopment } from "./criteria";
import { rulePatterns, templateFor } from "./criteria";
import type { Question } from "./developed";
import { branchQuestions } from "./developed";
import { okAxioms } from "./ok";
import type { RulePatterns } from "./patterns";
import { closedSubterms, instantiate, matchFocus, termKey } from "./patterns";
import type { Member, RowSortReader } from "./rows";
import { branchText, engineTokens, readEngine, rowSortReader } from "./rows";
import type { TreeTheory } from "./theory";

/** The theorem every emitted proof proves. */
const TREE_THEOREM = "tree";

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
  | { readonly type: "closure-citation"; readonly node: string }
  /**
   * That a row is developed on a branch marked open, at a term for a
   * general row: what the branch is missing if not.
   */
  | {
      readonly type: "developed";
      readonly node: string;
      readonly missing: Missing;
      /** For a pair, the identity it is asked of and the statement asking. */
      readonly pair?: { readonly key: string; readonly statement: string };
    };

export interface TreeProof {
  /** The theorems, to append to the theory. Null if there are none. */
  readonly goal: string | null;
  /** Their proofs. Null with the goal. */
  readonly proof: string | null;
  readonly lines: ReadonlyMap<string, LineSubject>;
  /**
   * Rows whose step was not written down, and why; not those whose step has
   * a row that does not read, or a branch with none, which are reported on
   * that row and that branch.
   */
  readonly problems: ReadonlyMap<string, RowProblem>;
  /** Node ids whose end was not written down, and why. */
  readonly endProblems: ReadonlyMap<string, EndProblem>;
  /** How many branches are open: neither closed nor ended by a step. */
  readonly hypotheses: number;
  /** Every step written down, by its `dev`. */
  readonly steps: ReadonlyMap<string, EmittedStep>;
  /**
   * The rows whose rule counts instances, each with the terms it could have
   * been written with: the closed terms of the instance's sort in it.
   */
  readonly slots: ReadonlyMap<string, readonly string[]>;
  /** The instances each row's link theorems state, by row. */
  readonly linked: ReadonlyMap<string, readonly string[]>;
  /**
   * The rows of branches marked open that a rule on a pair of rows sets off
   * (an identity), by {@link pairingKey}, each with the statements of the
   * rule that could develop it: the directions it could be substituted in.
   */
  readonly pairings: ReadonlyMap<string, readonly string[]>;
  /**
   * Why the tree was too big to write down, if it was: past the row cap, or
   * its theorems past the text cap. Nothing is stated of such a tree.
   */
  readonly oversize: Oversize | null;
  /**
   * The leaves of the branches marked open it asks the engine about, whether
   * each row on them is developed (`./ok.ts`); null where the theory says
   * nothing of when a row is, and nothing is asked.
   */
  readonly developed: ReadonlySet<string> | null;
}

/** Which cap a tree is past. */
export type Oversize =
  | { readonly cap: "rows"; readonly limit: number }
  | { readonly cap: "text" };

/** A tree too big to write down: nothing stated, nothing to report on. */
function tooBig(oversize: Oversize): TreeProof {
  return {
    developed: null,
    endProblems: new Map(),
    goal: null,
    hypotheses: 0,
    linked: new Map(),
    lines: new Map(),
    oversize,
    pairings: new Map(),
    problems: new Map(),
    proof: null,
    slots: new Map(),
    steps: new Map(),
  };
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
   * The instance each general row was written with, by row id, for a tree
   * to certify; one that is not among the row's own candidates is not
   * stated.
   */
  readonly instances?: ReadonlyMap<string, string>;
  /**
   * The statement each paired row is developed by, by {@link pairingKey},
   * for a tree to certify. A row with none here is asked by its rule's own
   * statement.
   */
  readonly directions?: ReadonlyMap<string, string>;
  /**
   * State every candidate instance and direction instead, for a compile
   * that asks which hold: a link or pair the engine refuses says only that
   * it was not that one (`heldInstances`, `heldDirections`).
   */
  readonly asking?: boolean;
  /** The most rows a tree may have to be written down. */
  readonly rowCap?: number;
  /**
   * The most text its theorems may state. Each step restates its branch, so
   * the text grows with rows times the branch they are on, not with the
   * tree's own size: a long branch of long rows states tens of megabytes,
   * and the engine reads every byte, in the browser and on the server.
   */
  readonly textCap?: number;
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

export function emitTreeProof(
  document: TableauDocument,
  options: EmitOptions,
): TreeProof {
  const { language, theory } = options;
  const index = new TableauIndex(document);
  const lines = new Map<string, LineSubject>();
  const problems = new Map<string, RowProblem>();
  const endProblems = new Map<string, EndProblem>();
  const statements: string[] = [];
  const proofs: string[] = [];
  const steps = new Map<string, EmittedStep>();
  const slots = new Map<string, readonly string[]>();
  const linked = new Map<string, readonly string[]>();
  const pairings = new Map<string, readonly string[]>();
  const reader = options.reader ?? rowSortReader(language, theory.rowSort);
  const resolve = languageRuleReader(language);
  const sortOf = new Map<string, string>();
  let counter = 0;
  let hypotheses = 0;
  let stated = 0;
  const textCap = options.textCap ?? Number.POSITIVE_INFINITY;
  const record = (statement: string, proof: string): void => {
    statements.push(statement);
    proofs.push(proof);
    stated += statement.length;
  };

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
  const rowsOf = (rows: readonly TableauRow[]): Member[] =>
    rows.flatMap((row) => {
      const engine = engineOf(row);
      return engine === null
        ? []
        : [{ dev: row.dev, row: row.id, text: engine }];
    });
  const texts = (members: readonly Member[]): string[] =>
    members.map((member) => member.text);
  const branch = (rows: readonly string[]): string =>
    branchText(theory, rows);
  /** Whether a rule is one that cites no row: its focus is the empty branch. */
  const citesNothing = (axiom: string): boolean =>
    options.development?.byAxiom.get(axiom)?.patterns.focus.length === 0;
  const closes = (rows: readonly string[]): string =>
    `${theory.closes} (${branch(rows)})`;
  const patternsByAxiom = new Map<string, RulePatterns | null>();
  const patternsOf = (axiom: string): RulePatterns | null => {
    if (!patternsByAxiom.has(axiom)) {
      const statement = language.spec.statements.find(
        (each) =>
          (each.kind === "axiom" || each.kind === "theorem") &&
          each.name === axiom,
      );
      patternsByAxiom.set(
        axiom,
        statement?.kind === "axiom" || statement?.kind === "theorem"
          ? rulePatterns(language, theory, statement)
          : null,
      );
    }

    return patternsByAxiom.get(axiom) ?? null;
  };

  /**
   * The check marks a development writes beside its rows, which the student
   * does not type: the mark of the row it cites, if its rule writes one
   * (`tree.mark`), and beside each row, if its rule marks instances
   * (`tree.mark.instance`). The engine checks them against the rule as it
   * checks the rows, so a mark written wrong fails the step.
   */
  const marksFor = (group: readonly TableauRow[]): Member[] => {
    const first = group[0];
    const cited =
      first?.cites.length === 1 ? (first.cites[0] as string) : null;
    const patterns =
      first === undefined
        ? null
        : patternsOf(resolve(options.rules.get(first.dev)?.trim() ?? ""));
    const terms = new Set(
      (patterns?.marks ?? [])
        .flat()
        .flatMap((mark) => (mark.kind === "app" ? [mark.term] : [])),
    );
    const cite = cited === null ? null : engineOfId(cited);

    if (cite === null || terms.size === 0) {
      return [];
    }

    const dev = first?.dev ?? "";

    return [
      ...(theory.mark !== null && terms.has(theory.mark)
        ? [{ dev, row: null, text: `${theory.mark} (${cite})` }]
        : []),
      ...(theory.markInstance !== null && terms.has(theory.markInstance)
        ? rowsOf(group).map((row) => ({
            ...row,
            text: `${theory.markInstance} (${cite}) (${row.text})`,
          }))
        : []),
    ];
  };

  /** What a development puts on its branch: its rows, then their marks. */
  const writtenBy = (group: readonly TableauRow[]): Member[] => [
    ...rowsOf(group),
    ...marksFor(group),
  ];

  /** The binders of a theorem: what its statements mention, by sort. */
  const binders = (texts: readonly string[]): string => {
    const bound = new Map<string, string[]>();

    for (const token of new Set(texts.flatMap(engineTokens))) {
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

    record(
      `theorem ${name}${binders([...premises, conclusion])}: ${premises
        .map((premise) => `$ ${premise} $ > `)
        .join("")}$ ${conclusion} $;`,
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

    const bindings = matchFocus(language, developing.patterns, focus.term);

    if (bindings === null) {
      return;
    }

    for (const row of rows) {
      const read = reader.read(row.text);

      if (!read.ok) {
        continue;
      }

      const candidates = closedSubterms(language, read.term, slot.sort);
      const chosen = options.instances?.get(row.id);
      const asked = options.asking
        ? candidates
        : chosen !== undefined && candidates.includes(chosen)
          ? [chosen]
          : [];

      slots.set(row.id, candidates);

      for (const instance of asked) {
        if (stated > textCap) {
          return;
        }

        const term = readEngine(language, instance, slot.sort);

        if (term === null) {
          continue;
        }

        const written = termKey(
          language,
          instantiate(
            templateFor(language, developing, slot, bindings, read.term),
            new Map([...bindings, [slot.binder, term]]),
          ),
        );
        counter += 1;
        const name = `${TREE_THEOREM}_${counter}`;
        const label = `k_${counter}`;
        const premise = closes([read.engine]);
        const conclusion = closes([written]);

        record(
          `theorem ${name}${binders([premise, conclusion])}: $ ${premise} $ > $ ${conclusion} $;`,
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
    const first = rows[0];
    const fail = (problem: RowProblem): void => {
      for (const id of ids) {
        problems.set(id, problem);
      }
    };

    // A branch with no rows is reported on that branch.
    if (first === undefined || groups.some((group) => group.length === 0)) {
      return;
    }

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

    // A row that does not read is reported on that row.
    if (rows.some((row) => engineOf(row) === null)) {
      return;
    }

    const cites = first.cites.map(engineOfId);
    const unknown = first.cites.find((_, at) => cites[at] === null);

    if (unknown !== undefined) {
      fail({ cite: unknown, type: "cite-not-above" });
      return;
    }

    if (rule.length === 0) {
      fail({ type: "no-rule-named" });
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

  const ok =
    options.development === undefined
      ? null
      : okAxioms(language, theory, options.development);
  const questions =
    ok === null || options.development === undefined
      ? null
      : branchQuestions({
          development: options.development,
          directions: options.asking
            ? "every"
            : (options.directions ?? new Map()),
          index,
          // While every candidate is asked, a row's instance is known only
          // where it has one. The branch is walked down to its leaf before
          // it is asked about, so its rows' candidates are in.
          instanceOf: (row) => {
            if (!options.asking) {
              return options.instances?.get(row) ?? null;
            }

            const candidates = slots.get(row);
            return candidates?.length === 1
              ? (candidates[0] as string)
              : null;
          },
          language,
          ok,
          reader,
          steps,
          theory,
        });
  // The leaves of the branches marked open that were asked about.
  const asked = new Set<string>();

  /**
   * A theorem that a row is developed on a branch, by its judgement's chain,
   * with the matcher's bindings where the engine cannot find them; if the
   * engine cannot prove it, the branch is missing what it says.
   */
  const developed = (node: string, question: Question): void => {
    counter += 1;
    const name = `${TREE_THEOREM}_${counter}`;
    const label = `o_${counter}`;
    const { by, missing, pair, statement } = question;
    const bound = pair === undefined ? "" : ` (${pair.bindings})`;

    record(
      `theorem ${name}${binders([statement, bound])}: $ ${statement} $;`,
      [name, "----", `${label}: $ ${statement} $ by ${by}${bound} []`].join(
        "\n",
      ),
    );
    lines.set(label, {
      missing,
      node,
      type: "developed",
      ...(pair === undefined
        ? {}
        : { pair: { key: pair.key, statement: pair.statement } }),
    });
  };

  /** Ask the engine whether every row on a branch marked open is developed. */
  const askDeveloped = (node: TableauNode, members: readonly Member[]) => {
    if (questions === null) {
      return;
    }

    asked.add(node.id);

    const branchAsks = questions(node, members);

    for (const question of branchAsks.questions) {
      developed(node.id, question);
    }

    for (const [key, candidates] of branchAsks.pairings) {
      pairings.set(key, candidates);
    }
  };

  /** The end of a branch: a closure, or a branch left open. */
  const end = (node: TableauNode, members: readonly Member[]): void => {
    const state = texts(members);

    if (node.end?.type !== "closed") {
      hypotheses += 1;

      if (node.end?.type === "open") {
        askDeveloped(node, members);
      }

      return;
    }

    const cites = node.end.cites.map(engineOfId);

    if (cites.length === 0) {
      endProblems.set(node.id, { type: "closure-uncited" });
      return;
    }

    if (cites.some((cite) => cite === null)) {
      endProblems.set(node.id, { type: "closure-cite-off-branch" });
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
    state: readonly Member[],
  ): void => {
    if (stated > textCap) {
      return;
    }

    if (start < node.rows.length) {
      const group = groupAt(node.rows, start);
      const below = [...state, ...writtenBy(group)];

      step(texts(state), [group], [texts(below)]);
      walk(node, start + group.length, below);
      return;
    }

    const children = index.children(node.id);

    if (children.length === 0) {
      end(node, state);
      return;
    }

    const groups = children.map((child) => groupAt(child.rows, 0));
    const states = groups.map((group) => [...state, ...writtenBy(group)]);

    step(texts(state), groups, states.map(texts));

    for (const [at, child] of children.entries()) {
      walk(child, (groups[at] as TableauRow[]).length, states[at] ?? state);
    }
  };

  const root = index.root;
  const nothing = (count: number): TreeProof => ({
    developed: null,
    endProblems,
    goal: null,
    hypotheses: count,
    linked,
    lines,
    oversize: null,
    pairings,
    problems,
    proof: null,
    slots,
    steps,
  });
  const rows = document.nodes.reduce(
    (sum, node) => sum + node.rows.length,
    0,
  );

  if (options.rowCap !== undefined && rows > options.rowCap) {
    return tooBig({ cap: "rows", limit: options.rowCap });
  }

  if (root === null) {
    return nothing(0);
  }

  const rootRows = root.rows.slice(0, options.rootRows);
  const rootState = rowsOf(rootRows);

  if (rootState.length !== rootRows.length) {
    return nothing(0);
  }

  walk(root, rootRows.length, rootState);

  if (stated > textCap) {
    return tooBig({ cap: "text" });
  }

  if (statements.length === 0) {
    return nothing(hypotheses);
  }

  return {
    developed: ok === null ? null : asked,
    endProblems,
    // The axioms saying when a row is developed come first, where a theorem
    // asks whether one is.
    goal: [
      ...(asked.size > 0 && ok !== null ? [ok.text] : []),
      ...statements,
    ].join("\n"),
    hypotheses,
    linked,
    lines,
    oversize: null,
    pairings,
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

/**
 * The statement each paired row is developed by, from a compile that asked
 * every candidate (`directions` = a proof's own `pairings`): one the engine
 * refused nothing of, else the one it refused least of, the rule's own first
 * on a tie, so that what the branch is missing is said in one direction.
 */
export function heldDirections(
  asked: TreeProof,
  errors: readonly TreeDiagnostic[],
): Map<string, string> {
  const refused = new Map<string, number>();

  for (const error of errors) {
    const pair =
      error.subject?.type === "developed" ? error.subject.pair : undefined;

    if (pair !== undefined) {
      const at = `${pair.key}\n${pair.statement}`;
      refused.set(at, (refused.get(at) ?? 0) + 1);
    }
  }

  const held = new Map<string, string>();

  for (const [key, candidates] of asked.pairings) {
    const count = (statement: string) =>
      refused.get(`${key}\n${statement}`) ?? 0;
    const best = [...candidates].sort((a, b) => count(a) - count(b))[0];

    if (best !== undefined) {
      held.set(key, best);
    }
  }

  return held;
}

/**
 * A compile's errors, less the refusals of the directions not chosen
 * (`heldDirections`): what the tree shows is said in the one it is
 * developed by.
 */
export function inDirections(
  errors: readonly TreeDiagnostic[],
  directions: ReadonlyMap<string, string>,
): TreeDiagnostic[] {
  return errors.filter((error) => {
    const pair =
      error.subject?.type === "developed" ? error.subject.pair : undefined;
    return pair === undefined || directions.get(pair.key) === pair.statement;
  });
}
