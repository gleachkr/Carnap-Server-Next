/**
 * Constants and data shapes for the Aufbau *tree* proof exercise type — a
 * tree-shaped input modality over the same engine as {@link
 * ../aufbau-proof/types the linear proof type}. DOM-free; the authoring
 * compiler, flattener, assessment, read-only view, and client editor share it.
 *
 * The student builds a proof *tree* of {@link ProofTreeNode}s. A postorder
 * traversal ({@link ../aufbau-proof-tree/flatten flattenProofTree}) turns the
 * tree into the exact linear `.auf` the linear editor already produces, which
 * the browser compiles to an MMB certificate against the frozen theory. The
 * trust boundary is unchanged: the worker re-verifies the MMB against
 * `publicData.mm0` (the frozen theory + goal), never the student's tree. See
 * [[aufbau-engine-packages]], [[aufbau-proof-exercise]].
 */

import type { AufbauProofOptions } from "../aufbau-proof/types";

export const AUFBAU_PROOF_TREE_KIND = "aufbau-proof-tree@1";
export const AUFBAU_PROOF_TREE_SCHEMA_VERSION = 1;
export const AUFBAU_PROOF_TREE_ANSWER_KIND = "aufbau-proof-tree-answer@1";
export const AUFBAU_PROOF_TREE_COMPONENT_METADATA = {
  assetId: "carnap-aufbau-proof-tree-v1",
  clientModule: true,
  component: "carnap-aufbau-proof-tree",
  componentVersion: "1",
} as const;

/**
 * One node of a proof tree: a conclusion `formula` justified by a `rule` citing
 * its child `premises` (visited before it when flattening, so every reference
 * is backward — the `.auf` grammar forbids forward references). A leaf with
 * `hyp` set is instead a reference to the goal theorem's `hyp`-th hypothesis; it
 * contributes `#hyp` to its parent's citation list and emits no proof line of
 * its own. `id` is a stable handle for editing and for attributing a compiler
 * diagnostic back to the node that produced the offending line.
 */
export interface ProofTreeNode {
  readonly formula: string;
  readonly hyp?: number;
  readonly id: string;
  readonly premises: readonly ProofTreeNode[];
  readonly rule: string;
}

/**
 * Everything the widget and grader need, frozen at authoring time.
 *   - `goalFormula` the goal's conclusion (inside `$ … $`), seeding the tree's
 *                   read-only root node
 *   - `goalName`    the theorem name the root proves
 *   - `mm0`         the resolved theory plus the appended goal declaration
 *                   `theorem <goalName> …: $ … $;` — the sole verification input
 *   - `options`     the shared editor-assistance toggles (reused from the linear
 *                   proof type)
 *   - `promptHtml`  the rendered prose above the goal
 *   - `starterTree` an optional pre-populated tree the editor seeds from instead
 *                   of a bare goal root (parsed from the author's `.auf` starter)
 */
export interface AufbauProofTreePublicData {
  readonly goalFormula: string;
  readonly goalName: string;
  readonly mm0: string;
  readonly options: AufbauProofOptions;
  readonly promptHtml: string;
  readonly starterTree?: ProofTreeNode;
}

/**
 * The submitted answer. `mmb` is the base64 MMB certificate the client compiled
 * from the flattened tree — the only thing graded. `proofText` (the flattened
 * `.auf`) and `tree` (the structure) are retained for review and to restore the
 * editor; neither is trusted for grading.
 */
export interface AufbauProofTreeAnswerData {
  readonly mmb: string;
  readonly proofText: string;
  readonly tree: ProofTreeNode;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isProofTreeNode(value: unknown): value is ProofTreeNode {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.formula === "string" &&
    typeof value.rule === "string" &&
    (value.hyp === undefined || typeof value.hyp === "number") &&
    Array.isArray(value.premises) &&
    value.premises.every(isProofTreeNode)
  );
}

export function isAufbauProofTreePublicData(
  value: unknown,
): value is AufbauProofTreePublicData {
  return (
    isObject(value) &&
    typeof value.goalFormula === "string" &&
    typeof value.goalName === "string" &&
    typeof value.mm0 === "string" &&
    typeof value.promptHtml === "string" &&
    (value.starterTree === undefined || isProofTreeNode(value.starterTree)) &&
    isObject(value.options) &&
    typeof value.options.allowAuto === "boolean" &&
    typeof value.options.allowCompletion === "boolean"
  );
}

export function isAufbauProofTreeAnswerData(
  value: unknown,
): value is AufbauProofTreeAnswerData {
  return (
    isObject(value) &&
    typeof value.mmb === "string" &&
    typeof value.proofText === "string" &&
    isProofTreeNode(value.tree)
  );
}
