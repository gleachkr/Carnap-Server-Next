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
 * empty, and the tree is not past the row cap. A step left unwritten (no rule
 * named, no row cited) is unfinished, not wrong.
 *
 * When a tree is done is the exercise's `finish=`. A branch marked open is
 * complete by the development criteria (#437); until those land, by the old
 * checker's report where its rows are sentences (`completeness`), and
 * otherwise not at all.
 *
 * The result is a {@link TreeReport}, the shape the editor and the review
 * already draw.
 *
 * DOM-free and free of i18n.
 */

import type { TableauDocument } from "../../../../tableau/document";
import { TableauIndex } from "../../../../tableau/document";
import type {
  BranchState,
  EndProblem,
  RowProblem,
  TreeLevelProblem,
  TreeProblem,
  TreeReport,
} from "../logic/check";
import type { TruthTreeFinish } from "../types";
import type { EmitProblem, TreeDiagnostic, TreeProof } from "./emit";
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
  | { readonly kind: "verified"; readonly ok: boolean };

export interface JudgeInput {
  readonly tree: TableauDocument;
  readonly reader: RowSortReader;
  /** The exercise's root, as engine text at the row sort, in order. */
  readonly root: readonly string[];
  /** The tree's proof, as `emitTreeProof` wrote it. */
  readonly proof: TreeProof;
  readonly evidence: TreeEvidence;
  readonly finish: TruthTreeFinish;
  readonly rowCap: number;
  /**
   * The old checker's report, for the marks and for whether a branch marked
   * open is complete; `null` where it cannot read the rows. Until #437.
   */
  readonly completeness: TreeReport | null;
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
    default:
      return null;
  }
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
  const rowCount = order.reduce((sum, node) => sum + node.rows.length, 0);

  // A tree past the cap is not read: every row costs a parse.
  if (rowCount > input.rowCap) {
    return {
      branches: new Map(),
      closed: false,
      ends: new Map(),
      finished: false,
      justifications: new Map(),
      marks: new Map(),
      open: false,
      problems: [
        {
          at: {
            problem: { limit: input.rowCap, type: "too-many-rows" },
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

  // What the engine refused, on the step or end it is about.
  const engineErrors = evidence.kind === "compiled" ? evidence.errors : [];

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
      case "closure":
        flagEnd(subject.node, { type: "closure-wrong" });
        break;
      case "closure-citation":
        flagEnd(subject.node, { type: "closure-cite-off-branch" });
        break;
      default:
        treeProblems.push({ type: "unverified" });
    }
  }

  if (evidence.kind === "verified" && !evidence.ok) {
    treeProblems.push({ type: "unverified" });
  }

  // Ends and branches.
  const completeness = input.completeness;
  const branches = new Map<string, BranchState>();
  const leaves = index.leaves();

  for (const node of order) {
    if (node.end !== undefined && index.children(node.id).length > 0) {
      flagEnd(node.id, { type: "end-not-leaf" });
    }
  }

  for (const leaf of leaves) {
    if (leaf.rows.length === 0 && leaf.parent !== null) {
      flagEnd(leaf.id, { type: "empty-branch" });
    }

    if (leaf.end === undefined) {
      const old = completeness?.branches.get(leaf.id);

      branches.set(
        leaf.id,
        old?.type === "unfinished" && finish !== "closed"
          ? old
          : {
              complete: false,
              contradiction: null,
              missing: [],
              type: "unfinished",
            },
      );
      continue;
    }

    if (leaf.end.type === "open") {
      if (finish === "closed") {
        flagEnd(leaf.id, { type: "open-not-offered" });
      } else if (completeness === null) {
        flagEnd(leaf.id, { type: "open-unjudged" });
      } else {
        const old = completeness.ends.get(leaf.id);

        if (
          old?.type === "open-contradiction" ||
          old?.type === "open-incomplete"
        ) {
          flagEnd(leaf.id, old);
        }
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
    evidence.kind === "verified"
      ? evidence.ok
      : evidence.kind === "compiled" &&
        evidence.certified &&
        engineErrors.length === 0;
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
    justifications: new Map(),
    marks: completeness?.marks ?? new Map(),
    open,
    problems,
    rows: rowProblems,
  };
}
