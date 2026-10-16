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
 * - a leaf marked open is a theorem for each row on its branch, that the row
 *   is developed there (`tree_ok`, `./ok.ts`), and for each general row and
 *   each term on the branch, that it is developed at the term (`tree_okat`),
 *   or, for one owed only what its side rows witness, for each witness
 *   (`tree_okwith`), where the theory says how; the engine proves each only
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

import type { SurfaceLanguage, Term } from "@aufbau/syntax";
import type {
  TableauDocument,
  TableauNode,
  TableauRow,
} from "../../../../tableau/document";
import { TableauIndex } from "../../../../tableau/document";
import type { Missing } from "../report";
import { isLiteral, isSelfIdentity } from "./branch";
import type { RulePatterns, TreeDevelopment } from "./criteria";
import {
  instanceShower,
  matchFocus,
  rulePatterns,
  templateFor,
  witnesses,
} from "./criteria";
import { atWitnesses, okAxioms } from "./ok";
import type { Bindings } from "./patterns";
import {
  closedSubterms,
  conclude,
  instantiate,
  matchAll,
  termKey,
} from "./patterns";
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

/** Why a step was not written down, and so is not checked. */
export type EmitProblem =
  | { readonly type: "no-rule" }
  | { readonly type: "uncited" }
  | { readonly type: "cites-differ" }
  | { readonly type: "cite-unknown" }
  | { readonly type: "unreadable" }
  | { readonly type: "split-mixed" }
  /** A split one of whose branches has no rows. */
  | { readonly type: "empty-branch" };

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
    gaps: 0,
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
   * The instances to state of each row, by row id: one for a tree to
   * certify, every candidate for a compile that asks which holds. Only a
   * row's own candidates are stated.
   */
  readonly instances?: ReadonlyMap<string, readonly string[]>;
  /**
   * The statements to ask each paired row by, by {@link pairingKey}: every
   * candidate for a compile that asks which holds, the one chosen for a tree
   * to certify. A row with none here is asked by its rule's own statement.
   */
  readonly directions?: ReadonlyMap<string, readonly string[]>;
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

/**
 * A member of a branch, as engine text, with the development that wrote it
 * and the row it is, or is the mark beside; null for the mark of the row a
 * development cites.
 */
interface Member {
  readonly text: string;
  readonly dev: string;
  readonly row: string | null;
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

/**
 * A name of `sort` a branch does not mention: a token of the first pool that
 * reads at the sort, for a general row that must be developed at some term
 * on a branch with none (`nonempty`). Developed at a new name, it is
 * developed at one, vacuously; otherwise it is not.
 */
function newName(
  language: SurfaceLanguage,
  sort: string,
  mentioned: ReadonlySet<string>,
): string | null {
  for (const info of language.spec.sorts.values()) {
    for (const token of info.vars) {
      if (mentioned.has(token)) {
        continue;
      }

      const read = language.parse(token, {
        lints: false,
        mode: "engine",
        sort,
      });
      const key = read.ok ? termKey(language, read.term) : null;

      if (key === null) {
        break;
      }

      return key;
    }
  }

  return null;
}

/**
 * The key of a row a rule on a pair of rows sets off, on the branch ending at
 * a leaf: each branch is complete in a direction of its own.
 */
export function pairingKey(leaf: string, row: string): string {
  return `${leaf} ${row}`;
}

/** A {@link pairingKey}'s leaf and row; null for a key that is not one. */
export function pairingOf(
  key: string,
): { readonly leaf: string; readonly row: string } | null {
  const [leaf, row, ...rest] = key.split(" ");
  return leaf === undefined || row === undefined || rest.length > 0
    ? null
    : { leaf, row };
}

/** Every variable in a term, binding occurrences too. */
function variablesOf(term: Term): Extract<Term, { kind: "variable" }>[] {
  return term.kind === "variable" ? [term] : term.args.flatMap(variablesOf);
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
  const pairings = new Map<string, readonly string[]>();
  const reader = options.reader ?? rowSortReader(language, theory.rowSort);
  const resolve = (name: string): string =>
    language.spec.ruleAliases.get(name) ?? name;
  const sortOf = new Map<string, string>();
  let counter = 0;
  let gaps = 0;
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
    rows.length === 0 && theory.empty !== null
      ? theory.empty.engine
      : rows.map((row) => `(${row})`).join(` ${theory.join} `);
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
    // The branch less the cited rows, given to `unfocus` rather than left to
    // the engine to find: found, its proof re-sorts the whole branch, and
    // grows with the branch rather than with the step (design/
    // aufbau-issues-2026-10-17). A cited row not on the branch is left in,
    // and `unfocus` refuses the step as it would anyway.
    const rest = [...state];

    for (const row of cites) {
      const at = rest.indexOf(row);

      if (at >= 0) {
        rest.splice(at, 1);
      }
    }

    const bound =
      theory.unfocusRest === null
        ? ""
        : ` (${theory.unfocusRest} := $ ${branch(rest)} $)`;

    record(
      `theorem ${name}${binders([...premises, conclusion])}: ${premises
        .map((premise) => `$ ${premise} $ > `)
        .join("")}$ ${conclusion} $;`,
      [
        name,
        "----",
        `${main}: $ ${theory.focus} (${branch(state)}) (${branch(cites)}) $ by ${rule} [${premises.map((_, at) => `#${at + 1}`).join(", ")}]`,
        `${cite}: $ ${conclusion} $ by ${theory.unfocus}${bound} [${main}]`,
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
        if (stated > textCap) {
          return;
        }

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
    const fail = (problem: EmitProblem): void => {
      for (const id of ids) {
        problems.set(id, problem);
      }

      gaps += 1;
    };

    if (first === undefined || groups.some((group) => group.length === 0)) {
      fail({ type: "empty-branch" });
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

  const ok =
    options.development === undefined
      ? null
      : okAxioms(language, theory, options.development);
  const rules = options.development?.rules ?? [];
  // The general rules, with the slot and judgement each is asked by: at each
  // term, or at each witness on the branch. A rule whose axioms could not be
  // stated has none (an author's diagnostic, `./ok.ts`), and is not asked.
  const general = rules.flatMap((rule) => {
    const slot = rule.instance;
    const judgement = ok?.general.get(rule.name);

    return slot === null || judgement === undefined
      ? []
      : [{ judgement, rule, slot, witnessed: atWitnesses(rule) }];
  });
  const paired = rules.filter((rule) => rule.criterion?.kind === "pairs");
  const asked = new Set<string>();

  /**
   * The bindings that tell the engine how a statement of a rule on a pair of
   * rows matched them, as a proof line writes them: the matcher's, with each
   * variable it made up (the hole of `{x / b} ph`) given a token of its
   * sort's pool that `text` does not mention. Only a hint: the engine proves
   * the theorem from them or not at all.
   */
  const pairBindings = (
    patterns: RulePatterns,
    bindings: Bindings,
    text: string,
  ): string | null => {
    const taken = new Set(tokens(text));
    const renames = new Map<string, Term>();

    for (const value of bindings.values()) {
      for (const variable of variablesOf(value)) {
        if (sortOf.has(variable.name) || renames.has(variable.name)) {
          continue;
        }

        const token = language.spec.sorts
          .get(variable.sort)
          ?.vars.find((each) => !taken.has(each));

        if (token === undefined) {
          return null;
        }

        taken.add(token);
        renames.set(variable.name, { ...variable, name: token });
      }
    }

    const written = [...bindings]
      .filter(([meta]) => meta !== patterns.branch)
      .map(([meta, value]) => {
        const engine = termKey(language, instantiate(value, renames));
        return engine === null ? null : `${meta} := $ ${engine} $`;
      });

    return written.some((each) => each === null) ? null : written.join(", ");
  };

  /**
   * A theorem that a row is developed on a branch, by the chain `by`, with
   * `bindings` for its binders where the engine cannot find them; if the
   * engine cannot prove it, the branch is missing `missing`.
   */
  const developed = (
    node: string,
    statement: string,
    by: string,
    missing: Missing,
    pair?: {
      readonly bindings: string;
      readonly key: string;
      readonly statement: string;
    },
  ): void => {
    counter += 1;
    const name = `${TREE_THEOREM}_${counter}`;
    const label = `o_${counter}`;
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

  /**
   * What a branch marked open is asked, where the theory says when a row is
   * developed: of each row, that it is, and of each general row, that it is
   * at each term of its instance's sort on the branch, or for each witness
   * on it.
   */
  const askDeveloped = (
    node: TableauNode,
    members: readonly Member[],
  ): void => {
    if (ok === null) {
      return;
    }

    asked.add(node.id);

    const mentioned = new Set(tokens(branch(texts(members))));
    // The branch is a multiset, so its members may be stated in any order:
    // the ones a row's own steps wrote go last, where the engine looks first,
    // and the rest of the branch need not be sorted to find them
    // (design/aufbau-issues-2026-10-17). A row developed some other way is
    // found all the same, at the cost of the sort.
    const citing = new Map<string, Set<string>>();

    for (const [dev, step] of steps) {
      for (const cite of step.cites) {
        citing.set(cite, (citing.get(cite) ?? new Set()).add(dev));
      }
    }

    const rows = index.branchRows(node.id).flatMap((row) => {
      const read = reader.read(row.text);
      return read.ok
        ? [{ engine: read.engine, id: row.id, term: read.term }]
        : [];
    });
    // A row written twice is asked about once, on its first copy, and the
    // steps citing either copy develop it.
    const copies = new Map<string, string[]>();

    for (const row of rows) {
      copies.set(row.engine, [...(copies.get(row.engine) ?? []), row.id]);
    }

    const ordered = (text: string, last: (member: Member) => boolean) => {
      const devs = new Set(
        (copies.get(text) ?? []).flatMap((id) => [...(citing.get(id) ?? [])]),
      );
      const rank = (member: Member): number =>
        devs.has(member.dev) ? (last(member) ? 2 : 1) : 0;

      return branch(
        texts(
          [0, 1, 2].flatMap((at) =>
            members.filter((member) => rank(member) === at),
          ),
        ),
      );
    };
    const instanceOf = (row: string | null): string | null => {
      const instances =
        row === null ? undefined : options.instances?.get(row);
      return instances?.length === 1 ? (instances[0] as string) : null;
    };
    const terms = new Map<string, readonly string[]>();
    const termsOf = (sort: string): readonly string[] => {
      let found = terms.get(sort);

      if (found === undefined) {
        found = [
          ...new Set(
            rows.flatMap((row) => closedSubterms(language, row.term, sort)),
          ),
        ];
        terms.set(sort, found);
      }

      return found;
    };

    for (const row of rows) {
      if (copies.get(row.engine)?.[0] !== row.id) {
        continue;
      }

      developed(
        node.id,
        `${ok.ok.term} (${row.engine}) (${ordered(row.engine, () => false)})`,
        ok.ok.head,
        { row: row.id },
      );

      for (const { judgement, rule, slot, witnessed } of general) {
        const bindings = matchFocus(language, rule, row.term);

        if (bindings === null) {
          continue;
        }

        const shown = instanceShower(language, rule, bindings);

        if (witnessed) {
          for (const witness of witnesses(
            language,
            rule,
            row.term,
            rows.map((each) => each.term),
          )) {
            developed(
              node.id,
              `${judgement.term} (${row.engine}) (${branch(witness.rows)}) (${ordered(
                row.engine,
                (member) => instanceOf(member.row) === witness.instance,
              )})`,
              judgement.head,
              { names: [shown(witness.instance)], row: row.id },
            );
          }

          continue;
        }

        const at = (term: string, names: readonly string[]): void =>
          developed(
            node.id,
            `${judgement.term} (${row.engine}) (${term}) (${ordered(
              row.engine,
              (member) => instanceOf(member.row) === term,
            )})`,
            judgement.head,
            { names, row: row.id },
          );
        const all = termsOf(slot.sort);

        for (const term of all) {
          at(term, [shown(term)]);
        }

        const fresh =
          all.length === 0 && rule.flags.has("nonempty")
            ? newName(language, slot.sort, mentioned)
            : null;

        if (fresh !== null) {
          at(fresh, []);
        }
      }
    }

    // Each row a rule on a pair of rows sets off (an identity), with every
    // other row it pairs with, by one statement of the rule: it is developed
    // one way round for all of them. Which way is the browser's to find, by
    // asking each, and the answer's to say.
    const firsts = rows.filter(
      (row) => copies.get(row.engine)?.[0] === row.id,
    );

    for (const rule of paired) {
      for (const row of firsts) {
        // Each statement the row sets off, with how its first focus row
        // matched: the first way, as an identity `a = b` matches one way.
        const starts = rule.variants.flatMap((patterns) => {
          const [first, second] = patterns.focus;
          const judgement = ok.pairs.get(patterns.name);
          const start =
            first === undefined || patterns.focus.length !== 2
              ? null
              : matchAll(language, first, row.term, patterns.metas).next();

          return judgement === undefined ||
            second === undefined ||
            start === null ||
            start.done === true
            ? []
            : [{ judgement, patterns, second, start: start.value }];
        });

        if (starts.length === 0) {
          continue;
        }

        const key = pairingKey(node.id, row.id);
        // The rule's own statement first, where it applies: asked when the
        // answer names none, and kept on a tie.
        const names = starts.map((each) => each.patterns.name);
        const candidates = [
          ...names.filter((name) => name === rule.patterns.name),
          ...names.filter((name) => name !== rule.patterns.name),
        ];
        const stated = options.directions?.get(key) ?? [
          candidates[0] as string,
        ];
        const partners = firsts.filter(
          (each) =>
            each.id !== row.id &&
            (!rule.flags.has("literals") || isLiteral(language, each.term)),
        );

        pairings.set(key, candidates);

        for (const { judgement, patterns, second, start } of starts) {
          if (!stated.includes(patterns.name)) {
            continue;
          }

          for (const partner of partners) {
            const devs = new Set(
              (copies.get(partner.engine) ?? []).flatMap((id) => [
                ...(citing.get(id) ?? []),
              ]),
            );

            for (const bindings of matchAll(
              language,
              second,
              partner.term,
              patterns.metas,
              start,
            )) {
              // A conclusion that is a self-identity (`b = b`) is true on
              // any branch, and no step need write it.
              const waived = patterns.written.some(
                (premise) =>
                  premise.length > 0 &&
                  premise.every((each) =>
                    isSelfIdentity(
                      language,
                      conclude(language, each, bindings),
                    ),
                  ),
              );
              const hints = waived
                ? null
                : pairBindings(
                    patterns,
                    bindings,
                    `${row.engine} ${partner.engine}`,
                  );

              if (hints === null) {
                continue;
              }

              developed(
                node.id,
                `${judgement.term} (${row.engine}) (${partner.engine}) (${ordered(
                  row.engine,
                  (member) => devs.has(member.dev),
                )})`,
                judgement.head,
                { row: row.id, substitution: true },
                { bindings: hints, key, statement: patterns.name },
              );
            }
          }
        }
      }
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
    gaps,
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
    gaps,
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
