/**
 * Flatten a proof *tree* into the linear `.auf` proof text the Aufbau compiler
 * consumes. This is the crux of the tree exercise type: it is pure and DOM-free
 * so both the client editor (which compiles the result) and the server tests can
 * share it.
 *
 * A postorder traversal assigns each derived node a fresh label `l1..lN` —
 * children before their parent — so every citation is to an *earlier* line, as
 * the `.auf` grammar requires (no forward references). Each node emits
 *   `lN: $ <formula> $ by <rule> [<refs>]`
 * where `<refs>` is the comma-joined citation list of its premises: a child
 * derivation contributes its label, and a `hyp` leaf contributes `#<hyp>`
 * (a reference to the goal theorem's n-th hypothesis) without emitting a line.
 * Premise order is preserved left-to-right because rules are order-sensitive
 * (e.g. `and_intro [l3, l2]`).
 */

import type { ProofTreeNode } from "./types";

/** The header that separates the goal name from the proof body in `.auf`. */
const HEADER_SEPARATOR = "\n----\n";

/** Where a tree node's generated proof line sits in the assembled `proofText`. */
export interface ProofTreeLineSpan {
  /** Character offset of the line start within `proofText`. */
  readonly from: number;
  readonly nodeId: string;
  /** Character offset of the line end (exclusive) within `proofText`. */
  readonly to: number;
}

export interface FlattenedProofTree {
  /** Char-space map from generated line back to the node that produced it. */
  readonly lineSpans: readonly ProofTreeLineSpan[];
  /** `${goalName}\n----\n${body}` — the full text handed to `compile`. */
  readonly proofText: string;
}

/**
 * Flatten `root` (the node proving the goal) into `.auf` text plus a char-space
 * map from each generated line to its source node, used to attribute a compiler
 * diagnostic's byte span back to the offending tree node.
 */
export function flattenProofTree(
  root: ProofTreeNode,
  goalName: string,
): FlattenedProofTree {
  const lines: string[] = [];
  const owners: string[] = [];
  let counter = 0;

  function visit(node: ProofTreeNode): string {
    if (node.hyp !== undefined) {
      return `#${node.hyp}`;
    }

    const refs = node.premises.map(visit);
    counter += 1;
    const label = `l${counter}`;
    owners.push(node.id);
    lines.push(
      `${label}: $ ${node.formula} $ by ${node.rule} [${refs.join(", ")}]`,
    );
    return label;
  }

  visit(root);

  const proofText = `${goalName}${HEADER_SEPARATOR}${lines.join("\n")}`;
  const bodyStart = goalName.length + HEADER_SEPARATOR.length;

  const lineSpans: ProofTreeLineSpan[] = [];
  let offset = bodyStart;
  for (const [index, line] of lines.entries()) {
    lineSpans.push({
      from: offset,
      nodeId: owners[index] ?? "",
      to: offset + line.length,
    });
    // + 1 for the newline joining this line to the next.
    offset += line.length + 1;
  }

  return { lineSpans, proofText };
}
