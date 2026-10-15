/**
 * Stored truth-tree data turned back into something the checker can judge,
 * and the judgement itself: the tree's report, and what the tree shows.
 *
 * The tree's steps and closures are the engine's to check (gh #46): the
 * caller hands over what it has said, the browser's compile or the server's
 * verification, as {@link TreeEvidence}. Everything else is judged here.
 *
 * DOM-free and free of i18n, because the client element judges the same
 * public data for its live feedback and its Check.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import type {
  TableauDocument,
  TableauEnd,
  TableauNode,
  TableauRow,
} from "../../../tableau/document";
import { firstOrderLanguageFor } from "../../exercise-kit/formula";
import type { TreeDevelopment } from "./aufbau/criteria";
import { readTreeDevelopment } from "./aufbau/criteria";
import type { TreeProof } from "./aufbau/emit";
import { emitTreeProof } from "./aufbau/emit";
import type { TreeEvidence } from "./aufbau/judge";
import { judgeTreeProof } from "./aufbau/judge";
import type { RowSortReader } from "./aufbau/rows";
import { displayRow, rowSortReader } from "./aufbau/rows";
import type { TreeTheory } from "./aufbau/theory";
import { isTreeTheory, readTreeTheory } from "./aufbau/theory";
import type { TreeProblem, TreeReport } from "./logic/check";
import type { TableauSystem } from "./logic/system";
import { FORALLX_UBC } from "./logic/system";
import type {
  TruthTreeAnswerData,
  TruthTreeFinish,
  TruthTreePublicData,
  TruthTreeTask,
  TruthTreeVerdict,
} from "./types";

/** Every tree rule system, by the id a declaration stores. */
const SYSTEMS: ReadonlyMap<string, TableauSystem> = new Map([
  [FORALLX_UBC.id, FORALLX_UBC],
]);

export function tableauSystemById(id: string): TableauSystem | null {
  return SYSTEMS.get(id) ?? null;
}

/**
 * The most a submitted tree may carry before it is not a tree at all: rows,
 * nodes, characters in a row, and characters in all. The checker reads no
 * tree past the system's `rowCap` (200), so these only bound the work of
 * refusing one; a row longer than any sentence a student would type is not a
 * row. A 200-row tree of long sentences is some 40,000 characters.
 */
const MAX_SUBMITTED_ROWS = 1000;
const MAX_SUBMITTED_NODES = 1000;
const MAX_ROW_TEXT = 1000;
const MAX_SUBMITTED_LENGTH = 131_072;
/** The longest rule name a margin holds: longer than any book's label. */
const MAX_RULE_TEXT = 64;
/** The longest instance a row is written with: a term, not a sentence. */
const MAX_INSTANCE_TEXT = 256;

export interface ResolvedTree {
  readonly language: SurfaceLanguage;
  readonly theory: TreeTheory;
  /** Reads a row at the theory's row sort. */
  readonly reader: RowSortReader;
  /** The root, as engine text at the row sort, in order. */
  readonly root: readonly string[];
  /** Each root row as a reader is shown it. */
  readonly rootText: readonly string[];
  readonly task: TruthTreeTask;
  readonly finish: TruthTreeFinish;
  /** The most rows a tree may have before it is not read. */
  readonly rowCap: number;
  /** When a row is developed, and what closes a branch, as the theory says. */
  readonly development: TreeDevelopment;
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

export function isTruthTreePublicData(
  value: unknown,
): value is TruthTreePublicData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const data = value as Partial<TruthTreePublicData>;

  return (
    typeof data.promptHtml === "string" &&
    typeof data.system === "string" &&
    typeof data.rules === "string" &&
    (data.task === "validity" || data.task === "consistency") &&
    (data.finish === undefined ||
      data.finish === "closed" ||
      data.finish === "complete" ||
      data.finish === "one-open") &&
    isStringArray(data.root) &&
    typeof data.premises === "number"
  );
}

function isRow(value: unknown): value is TableauRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const row = value as Partial<TableauRow>;

  return (
    typeof row.id === "string" &&
    typeof row.text === "string" &&
    row.text.length <= MAX_ROW_TEXT &&
    typeof row.dev === "string" &&
    isStringArray(row.cites)
  );
}

function isEnd(value: unknown): value is TableauEnd {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const end = value as { type?: unknown; cites?: unknown };

  return (
    end.type === "open" || (end.type === "closed" && isStringArray(end.cites))
  );
}

function isNode(value: unknown): value is TableauNode {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const node = value as Partial<TableauNode>;

  return (
    typeof node.id === "string" &&
    (node.parent === null || typeof node.parent === "string") &&
    Array.isArray(node.rows) &&
    node.rows.every(isRow) &&
    (node.end === undefined || isEnd(node.end))
  );
}

/**
 * Whether the nodes form one tree, as the editor writes it: the root first,
 * every other node after its parent, and no id, of a node or a row, used
 * twice. The checker keys everything by id, and walks the tree from the root
 * down, so a repeated id or a cycle would have it judge a tree other than the
 * one stored, or never finish.
 */
function isOneTree(nodes: readonly TableauNode[]): boolean {
  const nodeIds = new Set<string>();
  const rowIds = new Set<string>();

  for (const [at, node] of nodes.entries()) {
    const placed =
      at === 0
        ? node.parent === null
        : node.parent !== null && nodeIds.has(node.parent);

    if (!placed || nodeIds.has(node.id)) {
      return false;
    }

    nodeIds.add(node.id);

    for (const row of node.rows) {
      if (rowIds.has(row.id)) {
        return false;
      }

      rowIds.add(row.id);
    }
  }

  return true;
}

/**
 * The answer's JSON shape: a list of nodes that form one tree, within the
 * size limits. A tree that is wrong, however badly, is still this shape; only
 * something that is not a tree at all is refused.
 */
export function isTruthTreeAnswerData(
  value: unknown,
): value is TruthTreeAnswerData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const data = value as Record<string, unknown>;

  if (
    !Array.isArray(data.nodes) ||
    data.nodes.length > MAX_SUBMITTED_NODES ||
    !data.nodes.every(isNode)
  ) {
    return false;
  }

  const nodes = data.nodes as TableauNode[];
  const rows = nodes.reduce((sum, node) => sum + node.rows.length, 0);

  return (
    rows <= MAX_SUBMITTED_ROWS &&
    JSON.stringify(nodes).length <= MAX_SUBMITTED_LENGTH &&
    isOneTree(nodes) &&
    (data.rules === undefined ||
      isEntries(data.rules, rows, MAX_RULE_TEXT)) &&
    (data.instances === undefined ||
      isEntries(data.instances, rows, MAX_INSTANCE_TEXT))
  );
}

/** The rule each development of an answer names, by its `dev`. */
export function answerRules(
  answer: TruthTreeAnswerData,
): ReadonlyMap<string, string> {
  return new Map(Object.entries(answer.rules ?? {}));
}

/** The instance each row was written with, by row id. */
export function answerInstances(
  answer: TruthTreeAnswerData,
): ReadonlyMap<string, readonly string[]> {
  return new Map(
    Object.entries(answer.instances ?? {}).map(([row, instance]) => [
      row,
      [instance],
    ]),
  );
}

/** Rules by development, or instances by row: at most one per row, short. */
function isEntries(value: unknown, rows: number, longest: number): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);

  return (
    entries.length <= rows &&
    entries.every(
      ([, entry]) => typeof entry === "string" && entry.length <= longest,
    )
  );
}

/**
 * The declaration's root, language and tree theory, read back. `null` when
 * the stored data no longer resolves (a language that does not read, one
 * that is not a tree theory, a root that will not parse); none can happen for
 * data this compiler wrote.
 */
export function resolveTruthTree(
  publicData: TruthTreePublicData,
): ResolvedTree | null {
  const language = firstOrderLanguageFor(publicData);
  const theory = language === null ? null : readTreeTheory(language);

  if (language === null || theory === null || !isTreeTheory(theory)) {
    return null;
  }

  const reader = rowSortReader(language, theory.rowSort);
  const rootText: string[] = [];

  for (const engine of publicData.root) {
    const shown = displayRow(engine, language, theory.rowSort);

    if (shown === null) {
      return null;
    }

    rootText.push(shown);
  }

  return {
    development: readTreeDevelopment(language, theory),
    finish: publicData.finish ?? "closed",
    language,
    reader,
    root: publicData.root,
    rootText,
    rowCap: FORALLX_UBC.rowCap,
    task: publicData.task,
    theory,
  };
}

/** The tree the student starts from: the root, and nothing else. */
export function startingTree(resolved: ResolvedTree): TableauDocument {
  return {
    nodes: [
      {
        id: "root",
        parent: null,
        rows: resolved.rootText.map((text, at) => ({
          cites: [],
          dev: "root",
          id: `root-${at + 1}`,
          text,
        })),
      },
    ],
  };
}

/**
 * Whether a saved tree starts from the declaration's root. It may not: the
 * root is given, and cannot be edited, so a tree saved before a correction
 * changed the root could never be put right.
 */
export function startsFromRoot(
  tree: TableauDocument,
  resolved: ResolvedTree,
): boolean {
  const rows = tree.nodes[0]?.rows ?? [];

  return resolved.root.every((expected, at) => {
    const text = rows[at]?.text;
    const read = text === undefined ? null : resolved.reader.read(text);

    return read?.ok === true && read.engine === expected;
  });
}

/** What a done tree shows, in the task's own terms. */
export function treeVerdict(
  task: TruthTreeTask,
  report: TreeReport,
): TruthTreeVerdict | null {
  if (report.closed) {
    return task === "validity" ? "valid" : "inconsistent";
  }

  if (report.finished && report.open) {
    return task === "validity" ? "invalid" : "consistent";
  }

  return null;
}

/** Why a submitted tree is not right, first thing first. */
export type TreeJudgementProblem =
  | { readonly type: "tree"; readonly problem: TreeProblem }
  | { readonly type: "unfinished"; readonly finish: TruthTreeFinish }
  /** Finished as far as can be seen, and the engine's word is not to hand. */
  | { readonly type: "unconfirmed" };

export interface TreeJudgement {
  readonly ok: boolean;
  readonly report: TreeReport;
  /** What the tree shows, once it is done. */
  readonly shows: TruthTreeVerdict | null;
  readonly problem: TreeJudgementProblem | null;
}

/** A tree written down as a derivation, for the engine to check. */
export function treeProofOf(
  resolved: ResolvedTree,
  answer: TruthTreeAnswerData,
  instances: ReadonlyMap<string, readonly string[]> = answerInstances(answer),
): TreeProof {
  return emitTreeProof(
    { nodes: answer.nodes },
    {
      development: resolved.development,
      instances,
      language: resolved.language,
      reader: resolved.reader,
      rootRows: resolved.root.length,
      rules: answerRules(answer),
      theory: resolved.theory,
    },
  );
}

/**
 * The whole verdict: every row and end right, the engine's confirmation of
 * every step and closure, and the tree done. All or nothing.
 */
export function judgeTree(
  resolved: ResolvedTree,
  answer: TruthTreeAnswerData,
  evidence: TreeEvidence,
  proof: TreeProof = treeProofOf(resolved, answer),
): TreeJudgement {
  const tree = { nodes: answer.nodes };
  const judge = (given: TreeEvidence) =>
    judgeTreeProof({
      development: resolved.development,
      evidence: given,
      finish: resolved.finish,
      proof,
      reader: resolved.reader,
      root: resolved.root,
      rowCap: resolved.rowCap,
      tree,
    });
  const report = judge(evidence);
  const shows = treeVerdict(resolved.task, report);
  const first = report.problems[0];
  // Without the engine's word, a tree it would finish is unconfirmed, not
  // unfinished.
  const unconfirmed =
    evidence.kind === "none" &&
    judge({ kind: "verified", ok: true }).finished;
  const problem: TreeJudgementProblem | null =
    first !== undefined
      ? { problem: first, type: "tree" }
      : report.finished && shows !== null
        ? null
        : unconfirmed
          ? { type: "unconfirmed" }
          : { finish: resolved.finish, type: "unfinished" };

  return { ok: problem === null, problem, report, shows };
}
