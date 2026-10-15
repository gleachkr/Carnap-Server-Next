/**
 * Stored truth-tree data turned back into something the checker can judge,
 * and the judgement itself: the tree's report, and what the tree shows.
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
import type { Formula } from "../../exercise-kit/formula";
import {
  firstOrderLanguageFor,
  parseEngineFormula,
  sameFormula,
} from "../../exercise-kit/formula";
import type { TreeProblem, TreeReport } from "./logic/check";
import { checkTree } from "./logic/check";
import type { RowReader } from "./logic/formulas";
import { displayEngine, rowReader } from "./logic/formulas";
import type { TableauSystem } from "./logic/system";
import { FORALLX_UBC } from "./logic/system";
import type {
  TruthTreeAnswerData,
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

export interface ResolvedTree {
  readonly language: SurfaceLanguage;
  readonly reader: RowReader;
  readonly root: readonly Formula[];
  /** Each root row as a reader is shown it. */
  readonly rootText: readonly string[];
  readonly system: TableauSystem;
  readonly task: TruthTreeTask;
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
    isOneTree(nodes)
  );
}

/**
 * The declaration's root and language, read back. `null` when the stored data
 * no longer resolves (a language that does not read, a root that will not
 * parse, rules that do not exist); none can happen for data this compiler
 * wrote.
 */
export function resolveTruthTree(
  publicData: TruthTreePublicData,
): ResolvedTree | null {
  const language = firstOrderLanguageFor(publicData);
  const system = tableauSystemById(publicData.rules);

  if (language === null || system === null) {
    return null;
  }

  const root: Formula[] = [];
  const rootText: string[] = [];

  for (const engine of publicData.root) {
    const read = parseEngineFormula(engine, language);

    if (!read.ok) {
      return null;
    }

    root.push(read.formula);
    rootText.push(displayEngine(engine, language) ?? engine);
  }

  return {
    language,
    reader: rowReader(language),
    root,
    rootText,
    system,
    task: publicData.task,
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

    return read?.ok === true && sameFormula(read.formula, expected);
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
  | { readonly type: "unfinished" };

export interface TreeJudgement {
  readonly ok: boolean;
  readonly report: TreeReport;
  /** What the tree shows, once it is done. */
  readonly shows: TruthTreeVerdict | null;
  readonly problem: TreeJudgementProblem | null;
}

/**
 * The whole verdict: every row and end right, and the tree done. All or
 * nothing.
 */
export function judgeTree(
  resolved: ResolvedTree,
  answer: TruthTreeAnswerData,
): TreeJudgement {
  const report = checkTree({
    reader: resolved.reader,
    root: resolved.root,
    system: resolved.system,
    tree: { nodes: answer.nodes },
  });
  const shows = treeVerdict(resolved.task, report);
  const first = report.problems[0];
  const problem: TreeJudgementProblem | null =
    first !== undefined
      ? { problem: first, type: "tree" }
      : !report.finished || shows === null
        ? { type: "unfinished" }
        : null;

  return { ok: problem === null, problem, report, shows };
}
