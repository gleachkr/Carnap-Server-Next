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
 *
 * A node's text is not necessarily emitted as typed. `readFormula` reads it in
 * the theory's own language and gives back the engine spelling, so a student
 * may state a node `Ax(F(x)->G(x)) |- G(a)` where the compiler needs it fully
 * parenthesized and spaced. Unlike the Fitch and Prawitz types, whose lines
 * are bare formulas the translator wraps in a sequent, a tree node carries the
 * *whole* judgement — so its text is read at the sort the turnstile yields.
 * A theory that names neither a turnstile role nor a sentence sort passes every
 * node through untouched. A node's rule goes through `readRule` the same way:
 * an alias the theory declares becomes the engine's name, anything else
 * stands.
 */

import type {
  NodeFormulaProblem,
  ProofFormulaReader,
  ProofRuleReader,
} from "../../exercise-kit/proof/formulas";
import {
  ENGINE_RULE,
  ENGINE_TEXT,
  readNodeFormulas,
} from "../../exercise-kit/proof/formulas";
import type { ProofStatement } from "../../exercise-kit/proof/playground";
import type { ProofLineSpan } from "../../exercise-kit/proof/proof-text";
import { assembleProofText } from "../../exercise-kit/proof/proof-text";
import type { ProofTreeNode } from "./types";

/** Where a tree node's generated proof line sits in the assembled `proofText`. */
export interface ProofTreeLineSpan extends ProofLineSpan {
  readonly nodeId: string;
}

export interface FlattenedProofTree {
  /** Nodes whose text the theory's language refused; empty where the proof is
   *  written in engine text and nothing reads it. */
  readonly formulaProblems: readonly NodeFormulaProblem[];
  /** Char-space map from generated line back to the node that produced it. */
  readonly lineSpans: readonly ProofTreeLineSpan[];
  /** `${goalName}\n----\n${body}` — the full text handed to `compile`. */
  readonly proofText: string;
  /**
   * What the root asserts — its sequent, the last emitted `$ … $` — and the
   * variables the reading saw in it; `null` for a root that is a bare `hyp`
   * leaf and so emits no line. What a playground exercise makes its goal.
   */
  readonly statement: ProofStatement | null;
}

/**
 * Flatten `root` (the node proving the goal) into `.auf` text plus a char-space
 * map from each generated line to its source node, used to attribute a compiler
 * diagnostic's byte span back to the offending tree node.
 */
export function flattenProofTree(
  root: ProofTreeNode,
  goalName: string,
  readFormula: ProofFormulaReader = ENGINE_TEXT,
  readRule: ProofRuleReader = ENGINE_RULE,
): FlattenedProofTree {
  const lines: string[] = [];
  const owners: { readonly nodeId: string }[] = [];
  let counter = 0;
  // A `hyp` leaf cites the goal's n-th hypothesis and emits no line at all, so
  // whatever text it holds is never read and never reaches the compiler.
  const read = readNodeFormulas(
    root,
    readFormula,
    (node) => node.hyp === undefined,
  );

  function visit(node: ProofTreeNode): string {
    if (node.hyp !== undefined) {
      return `#${node.hyp}`;
    }

    const refs = node.premises.map(visit);
    counter += 1;
    const label = `l${counter}`;
    owners.push({ nodeId: node.id });
    lines.push(
      `${label}: $ ${node.formula} $ by ${readRule(node.rule)} [${refs.join(", ")}]`,
    );
    return label;
  }

  visit(read.root);

  const statement: ProofStatement | null =
    read.root.hyp === undefined
      ? {
          text: read.root.formula,
          variables: read.variables.get(read.root.id) ?? null,
        }
      : null;

  return {
    ...assembleProofText(goalName, lines, owners),
    formulaProblems: read.problems,
    statement,
  };
}
