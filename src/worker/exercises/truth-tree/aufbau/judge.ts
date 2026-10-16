/**
 * What a tree shows, from its structure and the engine's word on it (gh #46).
 *
 * The engine checks every step, citation and closure: in the browser by
 * compiling the tree's proof ({@link TreeEvidence} `compiled`, whose errors
 * say which line failed), on the server by verifying the certificate that
 * compile produced against a goal the server wrote itself (`verified`, which
 * says only whether it holds). What the engine does not see is checked here,
 * at the theory's row sort and so for any calculus: the root is the one the
 * exercise gives, every row reads, every end is on a leaf, no branch is
 * empty, and the tree is not past the caps. A step left unwritten (no rule
 * named, no row cited) is unfinished, not wrong.
 *
 * When a tree is done is the exercise's `finish=`. A branch marked open is
 * complete by the theory's development criteria, and is not one a closure
 * rule would close. Where the theory states its criteria as axioms
 * (`./ok.ts`), the engine is asked whether each row on the branch is
 * developed, and a theorem it cannot prove says what the branch is missing;
 * otherwise, and for what those axioms do not state, `./complete.ts` judges
 * it, over the steps the engine confirmed.
 *
 * The result is a {@link TreeReport}, the shape the editor and the review
 * already draw.
 *
 * DOM-free and free of i18n.
 */

import type {
  TableauDocument,
  TableauNode,
} from "../../../../tableau/document";
import { TableauIndex } from "../../../../tableau/document";
import type {
  BranchState,
  EndProblem,
  Missing,
  RowProblem,
  TreeLevelProblem,
  TreeProblem,
  TreeReport,
} from "../report";
import type { TruthTreeFinish } from "../types";
import { TreeCompleteness } from "./complete";
import type { TreeDevelopment } from "./criteria";
import type {
  EmitProblem,
  EmittedStep,
  TreeDiagnostic,
  TreeProof,
} from "./emit";
import type { RowSortReader } from "./rows";

/** What the engine has said about a tree's proof. */
export type TreeEvidence =
  /**
   * Nothing to hand: the compile has not run yet, or this is a review, which
   * has the tree and not the certificate.
   */
  | { readonly kind: "none" }
  /** The browser's compile: the lines that failed, and whether it certified. */
  | {
      readonly kind: "compiled";
      readonly errors: readonly TreeDiagnostic[];
      readonly certified: boolean;
    }
  /** The server's verification of the certificate the browser sent. */
  | { readonly kind: "verified"; readonly ok: boolean }
  /**
   * The browser's engine could not run: it would not load, or could not read
   * the derivation. It has no word on the tree, as with `none`, and the
   * failure is the editor's to say.
   */
  | { readonly kind: "failed"; readonly reason: EngineFailure };

/** Why the engine had no word on a tree. */
export type EngineFailure = "unavailable" | "unreadable";

export interface JudgeInput {
  readonly tree: TableauDocument;
  readonly reader: RowSortReader;
  /** The exercise's root, as engine text at the row sort, in order. */
  readonly root: readonly string[];
  /** The tree's proof, as `emitTreeProof` wrote it. */
  readonly proof: TreeProof;
  readonly evidence: TreeEvidence;
  readonly finish: TruthTreeFinish;
  /** The theory's development rules, for completeness and marks. */
  readonly development: TreeDevelopment;
}

/**
 * An unwritten step's problem, as the report names it; `null` for a step with
 * a row that does not read, which is reported on that row.
 */
function emitted(problem: EmitProblem, cite: string): RowProblem | null {
  switch (problem.type) {
    case "no-rule":
      return { type: "no-rule-named" };
    case "uncited":
      return { type: "uncited" };
    case "cites-differ":
      return { type: "cites-differ" };
    case "cite-unknown":
      return { cite, type: "cite-not-above" };
    case "split-mixed":
      return { type: "split-mixed" };
    // Reported on the rows that do not read, and on the empty branch.
    case "unreadable":
    case "empty-branch":
      return null;
  }
}

/**
 * The engine's refusals on a branch as what it is missing: a row not
 * developed, once; a general row, once with every term it is not developed
 * at.
 */
function merged(refused: readonly Missing[]): Missing[] {
  const missing: Missing[] = [];
  const general = new Map<string, string[]>();

  for (const each of refused) {
    if (each.names === undefined) {
      missing.push(each);
      continue;
    }

    const names = general.get(each.row);

    if (names === undefined) {
      const entry = { names: [...each.names], row: each.row };
      general.set(each.row, entry.names);
      missing.push(entry);
    } else {
      names.push(...each.names.filter((name) => !names.includes(name)));
    }
  }

  return missing;
}

export function judgeTreeProof(input: JudgeInput): TreeReport {
  const { evidence, finish, proof, reader, root, tree } = input;
  const index = new TableauIndex(tree);
  const order = index.preorder();
  const rowProblems = new Map<string, RowProblem>();
  const endProblems = new Map<string, EndProblem>();
  const treeProblems: TreeLevelProblem[] = [];
  const flag = (rowId: string, problem: RowProblem): void => {
    if (!rowProblems.has(rowId)) {
      rowProblems.set(rowId, problem);
    }
  };
  const flagEnd = (nodeId: string, problem: EndProblem): void => {
    if (!endProblems.has(nodeId)) {
      endProblems.set(nodeId, problem);
    }
  };
  // A tree past the caps is not read, and was not written down: every row
  // costs a parse, and every step restates its branch for the engine.
  if (proof.oversize !== null) {
    return {
      branches: new Map(),
      closed: false,
      ends: new Map(),
      finished: false,
      marks: new Map(),
      open: false,
      problems: [
        {
          at: {
            problem:
              proof.oversize.cap === "rows"
                ? { limit: proof.oversize.limit, type: "too-many-rows" }
                : { type: "too-large" },
            type: "tree",
          },
        },
      ],
      rows: new Map(),
    };
  }

  // Every row reads at the row sort.
  for (const node of order) {
    for (const row of node.rows) {
      if (row.text.trim() === "") {
        flag(row.id, { type: "empty" });
        continue;
      }

      const read = reader.read(row.text);

      if (!read.ok) {
        flag(row.id, { errors: read.errors, type: "unreadable" });
      }
    }
  }

  // The root node starts with the declared root, one row per sentence.
  const rootNode = index.root;

  if (rootNode === null || rootNode.rows.length < root.length) {
    treeProblems.push({ type: "root-missing" });
  }

  for (const [at, expected] of root.entries()) {
    const row = rootNode?.rows[at];

    if (row === undefined) {
      break;
    }

    const read = reader.read(row.text);

    if (row.cites.length > 0 || !read.ok || read.engine !== expected) {
      rowProblems.set(row.id, { type: "root-mismatch" });
    }
  }

  // The steps the proof could not write down, and why.
  for (const [rowId, problem] of proof.problems) {
    const named = emitted(problem, index.row(rowId)?.row.cites[0] ?? "");

    if (named !== null) {
      flag(rowId, named);
    }
  }

  for (const [nodeId, problem] of proof.endProblems) {
    flagEnd(
      nodeId,
      problem.type === "uncited"
        ? { type: "closure-uncited" }
        : { type: "closure-cite-off-branch" },
    );
  }

  // What the engine refused, on the step or end it is about. A link that
  // does not hold says only that its row was not written with that
  // instance, which the step's own line reports if it is wrong.
  const engineErrors = evidence.kind === "compiled" ? evidence.errors : [];
  const unlinked = new Set<string>();
  // What each branch marked open is missing, by the engine's word: its leaf,
  // then each row's entries.
  const undeveloped = new Map<string, Missing[]>();

  for (const error of engineErrors) {
    const subject = error.subject;

    switch (subject?.type) {
      case "step":
        for (const rowId of subject.rows) {
          flag(rowId, { rule: error.rule, type: "step-wrong" });
        }
        break;
      case "citation": {
        const cite = index.row(subject.rows[0] ?? "")?.row.cites[0] ?? "";

        for (const rowId of subject.rows) {
          flag(rowId, { cite, type: "cite-not-above" });
        }
        break;
      }
      case "link":
        unlinked.add(subject.row);
        break;
      case "closure":
        flagEnd(subject.node, { type: "closure-wrong" });
        break;
      case "closure-citation":
        flagEnd(subject.node, { type: "closure-cite-off-branch" });
        break;
      case "developed":
        undeveloped.set(subject.node, [
          ...(undeveloped.get(subject.node) ?? []),
          subject.missing,
        ]);
        break;
      default:
        treeProblems.push({ type: "unverified" });
    }
  }

  // A tree with no inference to state (its root alone, or nothing written
  // that reads as a step) gives the engine nothing to confirm or refuse: what
  // is wrong with it is said above, without the engine.
  const unstated = proof.goal === null;
  const refused = !unstated && evidence.kind === "verified" && !evidence.ok;

  if (refused) {
    treeProblems.push({ type: "unverified" });
  }

  // Ends and branches. Completeness counts the steps the engine has not
  // refused; whether it has confirmed them is `confirmed`, below.
  const completeness = new TreeCompleteness({
    development: input.development,
    index,
    instance: (rowId) => {
      const linked = proof.linked.get(rowId);
      return !refused && linked?.length === 1 && !unlinked.has(rowId)
        ? (linked[0] as string)
        : null;
    },
    proof,
    reader,
    verified: (step: EmittedStep) =>
      !refused && step.rows.every((rowId) => !rowProblems.has(rowId)),
  });
  const judged = finish !== "closed" && input.development.annotated;
  const branches = new Map<string, BranchState>();
  const leaves = index.leaves();
  const asked = proof.developed;
  /**
   * What an open branch is missing and what closes it. Where the engine was
   * asked, its refusals, and the theory's other rules here; without its word
   * (a review, or a refused certificate, which says nothing of which), only
   * the other rules.
   */
  const branchState = (leaf: TableauNode) => {
    if (asked === null || !asked.leaves.has(leaf.id)) {
      return completeness.branch(leaf);
    }

    const state = completeness.branch(leaf, asked.rules);
    const order = new Map(
      index.branchRows(leaf.id).map((row, at) => [row.id, at]),
    );
    const missing = [
      ...merged(undeveloped.get(leaf.id) ?? []),
      ...state.missing,
    ].sort((a, b) => (order.get(a.row) ?? 0) - (order.get(b.row) ?? 0));

    return { contradiction: state.contradiction, missing };
  };

  for (const node of order) {
    if (node.end !== undefined && index.children(node.id).length > 0) {
      flagEnd(node.id, { type: "end-not-leaf" });
    }

    if (node.rows.length === 0 && node.parent !== null) {
      flagEnd(node.id, { type: "empty-branch" });
    }
  }

  for (const leaf of leaves) {
    if (leaf.end === undefined) {
      branches.set(leaf.id, { type: "unfinished" });
      continue;
    }

    if (leaf.end.type === "open") {
      const state = judged ? branchState(leaf) : null;

      if (finish === "closed") {
        flagEnd(leaf.id, { type: "open-not-offered" });
      } else if (state === null) {
        flagEnd(leaf.id, { type: "open-unjudged" });
      } else if (state.contradiction !== null) {
        flagEnd(leaf.id, {
          rows: state.contradiction,
          type: "open-contradiction",
        });
      } else if (state.missing.length > 0) {
        flagEnd(leaf.id, { missing: state.missing, type: "open-incomplete" });
      }
    }

    branches.set(leaf.id, {
      right: !endProblems.has(leaf.id),
      type: leaf.end.type,
    });
  }

  const problems: TreeProblem[] = treeProblems.map((problem) => ({
    at: { problem, type: "tree" },
  }));

  for (const node of order) {
    for (const row of node.rows) {
      const problem = rowProblems.get(row.id);

      if (problem !== undefined) {
        problems.push({ at: { id: row.id, problem, type: "row" } });
      }
    }

    const problem = endProblems.get(node.id);

    if (problem !== undefined) {
      problems.push({ at: { id: node.id, problem, type: "end" } });
    }
  }

  // The engine has confirmed every step and closure written.
  const confirmed =
    unstated ||
    (evidence.kind === "verified"
      ? evidence.ok
      : evidence.kind === "compiled" &&
        evidence.certified &&
        engineErrors.length === 0);
  const states = leaves.map((leaf) => branches.get(leaf.id));
  const rightly = (type: "closed" | "open") =>
    states.filter((state) => state?.type === type && state.right).length;
  const closed =
    confirmed &&
    leaves.length > 0 &&
    proof.hypotheses === 0 &&
    rightly("closed") === leaves.length;
  const open = confirmed && finish !== "closed" && rightly("open") > 0;
  const finished =
    closed ||
    (finish === "one-open" && open) ||
    (finish === "complete" &&
      open &&
      rightly("closed") + rightly("open") === leaves.length);

  return {
    branches,
    closed,
    ends: endProblems,
    finished,
    marks: completeness.marks(),
    open,
    problems,
    rows: rowProblems,
  };
}
