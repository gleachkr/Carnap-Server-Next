import type { TableauNode } from "../../../tableau/document";
import type { ExerciseCapabilities } from "../../domain/exercises";
import type { Translator } from "../../i18n/translator";

/**
 * Constants and data shapes for the truth-tree exercise type. DOM-free; the
 * logic core, authoring, assessment, view, and client element all share it.
 */

export const TRUTH_TREE_KIND = "truth-tree@1";
export const TRUTH_TREE_SCHEMA_VERSION = 1;
export const TRUTH_TREE_ANSWER_KIND = "truth-tree-answer@1";
export const TRUTH_TREE_COMPONENT_METADATA = {
  assetId: "carnap-truth-tree-v1",
  clientModule: true,
  component: "carnap-truth-tree",
  componentVersion: "1",
} as const;

export const TRUTH_TREE_CAPABILITIES: ExerciseCapabilities = {
  supportsAutomaticEvaluation: true,
  supportsManualReview: true,
};

/** The generic group name for an untitled exercise of this type. */
export function truthTreeName(i18n: Translator): string {
  return i18n.t("Truth tree");
}

/**
 * What the tree is asked to decide, inferred from the body: an argument line
 * (`premises :|-: conclusion`) asks whether the argument is valid, and a list
 * of sentences whether the set is consistent.
 */
export type TruthTreeTask = "validity" | "consistency";

/** What a done tree shows, in its task's terms. */
export type TruthTreeVerdict =
  | "valid"
  | "invalid"
  | "consistent"
  | "inconsistent";

export interface TruthTreePublicData {
  readonly promptHtml: string;
  /** Which of the document's systems the sentences are written in. */
  readonly system: string;
  /** The system's text, which the join fills in on every read. */
  readonly source?: string;
  /** The tree rules, by the id of a `TableauSystem` record. */
  readonly rules: string;
  readonly task: TruthTreeTask;
  /**
   * The root, as engine text, in order: the premises and then the negated
   * conclusion for a validity task, the set's members for a consistency task.
   */
  readonly root: readonly string[];
  /** How many of the root rows are premises; the rest negate the conclusion. */
  readonly premises: number;
}

/**
 * A submitted tree: the tableau document. The root node's first rows are the
 * root, as the exercise gives it, and every other row is as the student typed
 * it. Citations name rows by id. The tree is the
 * whole answer: what it shows follows from it, so the student is not asked
 * to say.
 */
export interface TruthTreeAnswerData {
  readonly nodes: readonly TableauNode[];
  /**
   * The rule each development names, by its `dev`, as the theory spells it.
   * Kept beside the document, which knows no logic. A development missing
   * here names no rule; a tree saved before rules were typed has none.
   */
  readonly rules?: Readonly<Record<string, string>>;
}
