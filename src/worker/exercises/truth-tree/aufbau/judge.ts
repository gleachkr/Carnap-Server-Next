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
 * complete by the theory's development criteria (`./complete.ts`), over the
 * steps the engine confirmed, and is not one a closure rule would close.
 *
 * The result is a {@link TreeReport}, the shape the editor and the review
 * already draw.
 *
 * DOM-free and free of i18n.
 */

import type { Term } from "@aufbau/syntax";
import type { TableauDocument } from "../../../../tableau/document";
import { TableauIndex } from "../../../../tableau/document";
import type {
  BranchState,
  EndProblem,
  RowProblem,
  TreeLevelProblem,
  TreeProblem,
  TreeReport,
} from "../report";
import type { TruthTreeFinish } from "../types";
import { TreeCompleteness } from "./complete";
import type { TreeDevelopment } from "./criteria";
import { writesRule } from "./criteria";
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
      default:
        treeProblems.push({ type: "unverified" });
    }
  }

  // A step writes what its rule does: every row of it, even one already on
  // the branch, and no other. The engine takes a row already on the branch
  // as written either way, a branch being a set.
  const termOf = (rowId: string) => {
    const location = index.row(rowId);
    const read = location === null ? null : reader.read(location.row.text);
    return read?.ok === true ? read.term : null;
  };

  for (const step of proof.steps.values()) {
    const rule = input.development.byAxiom.get(step.rule);
    const byNode = new Map<string, Term[]>();
    const cited = step.cites.flatMap((rowId) => termOf(rowId) ?? []);

    for (const rowId of step.rows) {
      const node = index.row(rowId)?.node.id ?? "";
      const term = termOf(rowId);

      if (term !== null) {
        byNode.set(node, [...(byNode.get(node) ?? []), term]);
      }
    }

    if (
      rule !== undefined &&
      !writesRule(reader.language, rule, cited, [...byNode.values()])
    ) {
      for (const rowId of step.rows) {
        flag(rowId, { rule: step.rule, type: "step-wrong" });
      }
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

  for (const node of order) {
    if (node.end !== undefined && index.children(node.id).length > 0) {
      flagEnd(node.id, { type: "end-not-leaf" });
    }

    if (node.rows.length === 0 && node.parent !== null) {
      flagEnd(node.id, { type: "empty-branch" });
    }
  }

  for (const leaf of leaves) {
    const open = leaf.end === undefined || leaf.end.type === "open";
    const state = judged && open ? completeness.branch(leaf) : null;

    if (leaf.end === undefined) {
      branches.set(leaf.id, {
        complete:
          state !== null &&
          state.missing.length === 0 &&
          state.contradiction === null,
        contradiction: state?.contradiction ?? null,
        missing: state?.missing ?? [],
        type: "unfinished",
      });
      continue;
    }

    if (leaf.end.type === "open") {
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
