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
 * rule would close. The criteria are axioms (`./ok.ts`): the engine is asked
 * whether each row on the branch is developed, and a theorem it cannot prove
 * says what the branch is missing. That no closure rule closes the branch is
 * read here (`./branch.ts`), since no theorem says a rule fails.
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
import { closing } from "./branch";
import type { TreeDevelopment } from "./criteria";
import type { TreeDiagnostic, TreeProof } from "./emit";
import { treeMarks } from "./marks";
import type { RowSortReader } from "./rows";
import { isDeclaredRoot } from "./rows";

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
 * The engine's refusals on a branch as what it is missing, once a row: of a
 * row not developed, or not with a row it pairs with, the first refusal; of
 * a general row, every term it is not developed at.
 */
function merged(refused: readonly Missing[]): Missing[] {
  const missing: Missing[] = [];
  const general = new Map<string, string[]>();
  const said = new Set<string>();

  for (const each of refused) {
    if (each.kind !== "general") {
      if (!said.has(each.row)) {
        said.add(each.row);
        missing.push(each);
      }

      continue;
    }

    const names = general.get(each.row);

    if (names === undefined) {
      const entry = {
        kind: "general" as const,
        names: [...each.names],
        row: each.row,
      };
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
      finishedIfConfirmed: false,
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

    if (!isDeclaredRoot(reader, row, expected)) {
      rowProblems.set(row.id, { type: "root-mismatch" });
    }
  }

  // The steps the proof could not write down, and why.
  for (const [rowId, problem] of proof.problems) {
    flag(rowId, problem);
  }

  for (const [nodeId, problem] of proof.endProblems) {
    flagEnd(nodeId, problem);
  }

  // What the engine refused, on the step or end it is about. A link that
  // does not hold says only that its row was not written with that
  // instance, which the step's own line reports if it is wrong.
  const engineErrors = evidence.kind === "compiled" ? evidence.errors : [];
  const unlinked = new Set<string>();
  // What each branch marked open is missing, by the engine's word: its leaf,
  // then each row's entries.
  const undeveloped = new Map<string, Missing[]>();
  // An engine refusal about no line Carnap wrote.
  let unattributed = false;

  for (const error of engineErrors) {
    const subject = error.subject;

    switch (subject?.type) {
      case "step":
        for (const rowId of subject.rows) {
          flag(rowId, { rule: error.rule, type: "step-wrong" });
        }
        break;
      case "citation": {
        // The engine says only that the step's cites are not all on its
        // branch; which one is not, the tree says.
        const first = subject.rows[0] ?? "";
        const above = new Set(index.rowsAbove(first).map((row) => row.id));
        const cites = index.row(first)?.row.cites ?? [];
        const cite = cites.find((each) => !above.has(each)) ?? cites[0] ?? "";

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
        unattributed = true;
    }
  }

  // A tree with no inference to state (its root alone, or nothing written
  // that reads as a step) gives the engine nothing to confirm or refuse: what
  // is wrong with it is said above, without the engine.
  const unstated = proof.goal === null;
  const refused = !unstated && evidence.kind === "verified" && !evidence.ok;

  // Said once, of the whole tree, however many refusals name no line.
  if (unattributed || refused) {
    treeProblems.push({ type: "unverified" });
  }

  // Ends and branches.
  const judged = finish !== "closed" && input.development.annotated;
  const branches = new Map<string, BranchState>();
  const leaves = index.leaves();
  const asked = proof.developed;
  /**
   * What an open branch is missing, by the engine's refusals, and what
   * closes it; null where the engine was not asked about it. Without the
   * engine's word (a review, or a refused certificate, which says nothing of
   * which theorem failed) it is missing nothing that can be said.
   */
  const branchState = (leaf: TableauNode) => {
    if (asked === null || !asked.has(leaf.id)) {
      return null;
    }

    const rows = index.branchRows(leaf.id).flatMap((row) => {
      const read = reader.read(row.text);
      return read.ok ? [{ id: row.id, term: read.term }] : [];
    });
    const order = new Map(rows.map((row, at) => [row.id, at]));
    const missing = merged(undeveloped.get(leaf.id) ?? []).sort(
      (a, b) => (order.get(a.row) ?? 0) - (order.get(b.row) ?? 0),
    );

    return {
      contradiction: closing(reader.language, input.development, rows),
      missing,
    };
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
  // How the tree stands, the engine's confirmation aside.
  const allClosed =
    leaves.length > 0 &&
    proof.hypotheses === 0 &&
    rightly("closed") === leaves.length;
  const someOpen = finish !== "closed" && rightly("open") > 0;
  const done =
    allClosed ||
    (finish === "one-open" && someOpen) ||
    (finish === "complete" &&
      someOpen &&
      rightly("closed") + rightly("open") === leaves.length);
  const closed = confirmed && allClosed;
  const open = confirmed && someOpen;

  return {
    branches,
    closed,
    ends: endProblems,
    finished: confirmed && done,
    finishedIfConfirmed: done,
    // Marks count the steps the engine has not refused; whether it has
    // confirmed them is `confirmed`, above.
    marks: treeMarks({
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
    }),
    open,
    problems,
    rows: rowProblems,
  };
}
