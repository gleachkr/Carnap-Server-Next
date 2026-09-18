import type { ExerciseCapabilities } from "../../domain/exercises";
import type { Translator } from "../../i18n/translator";
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
 * trust boundary is unchanged: the worker re-verifies the MMB against the
 * frozen theory + goal, never the student's tree. See
 * [[aufbau-engine-packages]], [[aufbau-proof-exercise]].
 */

import type { AufbauProofOptions } from "../../exercise-kit/proof/options";
import type { PlaygroundGoal } from "../../exercise-kit/proof/playground";
import { isPlaygroundGoal } from "../../exercise-kit/proof/playground";
import type { ProofTreeNode } from "../../exercise-kit/proof/tree-parse";
import { isProofTreeNode } from "../../exercise-kit/proof/tree-parse";

// The node shape is the kit's (`exercise-kit/proof/tree-parse.ts`), because the
// Prawitz type parses its starters with the same tree parser; it is re-exported
// here so this type's own modules and the client editor keep one import for
// "the tree type's shapes".
export type { ProofTreeNode };
export { isProofTreeNode };

export const AUFBAU_PROOF_TREE_KIND = "aufbau-proof-tree@1";
export const AUFBAU_PROOF_TREE_SCHEMA_VERSION = 1;
export const AUFBAU_PROOF_TREE_ANSWER_KIND = "aufbau-proof-tree-answer@1";
export const AUFBAU_PROOF_TREE_COMPONENT_METADATA = {
  assetId: "carnap-aufbau-proof-tree-v1",
  clientModule: true,
  component: "carnap-aufbau-proof-tree",
  componentVersion: "1",
} as const;

/** What grading can do for this type; declared once, copied onto each manifest item. */
export const AUFBAU_PROOF_TREE_CAPABILITIES: ExerciseCapabilities = {
  supportsAutomaticEvaluation: true,
  supportsManualReview: true,
};

/** The generic group name for an untitled exercise of this type. */
export function aufbauProofTreeName(i18n: Translator): string {
  return i18n.t("Proof tree");
}

/**
 * Everything the widget and grader need, frozen at authoring time.
 *   - `allowSorry`  set when a line may be admitted with `sorry!`: the
 *                   widget marks such a line as a warning, not an error,
 *                   and (outside an exam) will not submit the proof while
 *                   one stands; it never scores either way
 *   - `goalFormula` the goal's conclusion (inside `$ … $`), seeding the tree's
 *                   read-only root node
 *   - `goalName`    the theorem name the root proves
 *   - `source`      the resolved theory plus the appended goal declaration
 *                   `theorem <goalName> …: $ … $;`, `@syntax` intact — the
 *                   language a node's sequent is read in, and (once stripped)
 *                   the sole verification input. Absent where the proof stays
 *                   engine text; see {@link proofTheoryText}
 *   - `mm0`         the same text already stripped, for artifacts compiled
 *                   before `source` existed. Read the pair through
 *                   {@link proofTheoryText}, never directly
 *   - `options`     the shared editor-assistance toggles (reused from the linear
 *                   proof type)
 *   - `promptHtml`  the rendered prose above the goal
 *   - `starterTree` an optional pre-populated tree the editor seeds from instead
 *                   of a bare goal root (parsed from the author's `.auf` starter)
 *   - `goalDecl`    this exercise's own `theorem <goalName> …: $ … $;`, which the
 *                   join appends to the system's text. Stored beside the key
 *                   rather than inside the frozen text, because the key is per
 *                   document and the declaration is per exercise
 *   - `system`      which of the document's systems this exercise is set in;
 *                   `source`/`mm0` above are what the join fills in from it.
 *                   Absent in an artifact compiled before the table existed,
 *                   which froze its text inline instead
 *   - `playground`  set when the exercise has no goal of its own: no
 *                   declaration is frozen, `goalFormula` is empty (the root is
 *                   the student's to write), `goalName` is the fixed
 *                   `playground`, and the answer carries the statement its
 *                   proof derived (see `exercise-kit/proof/playground.ts`)
 */
export interface AufbauProofTreePublicData {
  readonly allowSorry?: boolean;
  readonly goalDecl?: string;
  readonly goalEngineDecl?: string;
  readonly goalFormula: string;
  readonly goalName: string;
  readonly mm0?: string;
  readonly options: AufbauProofOptions;
  readonly playground?: boolean;
  readonly promptHtml: string;
  readonly source?: string;
  readonly starterTree?: ProofTreeNode;
  readonly system?: string;
}

/**
 * The answer as stored: `proofText` (the flattened `.auf`) and `tree` (the
 * structure) are shown on review and restored into the editor; neither is
 * trusted for grading. The envelope the client submits carries one more field,
 * `mmb`, the base64 MMB certificate it compiled from the flattened text — the
 * only thing graded, and not kept once `evaluate` has verified it; see
 * {@link ../../exercise-kit/proof/certificate readCertificate}.
 */
export interface AufbauProofTreeAnswerData {
  /** A playground's derived goal — what its certificate is verified against. */
  readonly goal?: PlaygroundGoal;
  readonly proofText: string;
  readonly tree: ProofTreeNode;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAufbauProofTreePublicData(
  value: unknown,
): value is AufbauProofTreePublicData {
  return (
    isObject(value) &&
    typeof value.goalFormula === "string" &&
    typeof value.goalName === "string" &&
    // Either theory text will do, and exactly one is ever written; which of
    // them arrived is what says whether the proof is read as surface text.
    (typeof value.mm0 === "string" || typeof value.source === "string") &&
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
    typeof value.proofText === "string" &&
    isProofTreeNode(value.tree) &&
    (value.goal === undefined || isPlaygroundGoal(value.goal))
  );
}
