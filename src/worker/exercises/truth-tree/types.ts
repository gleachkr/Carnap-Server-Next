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

/**
 * The most rows a tree may have before it is not read: first-order trees
 * need not end, and each row costs a parse and a place in every step's
 * branch.
 */
export const TREE_ROW_CAP = 200;

/**
 * The most text a tree's theorems may state, in characters, before it is not
 * read. Each step restates its branch, so the text grows with the rows times
 * the length of the branch they are on: 100 short rows on one branch state
 * about 1.3 MB, and the engine takes seconds to compile 5 MB in the browser.
 */
export const TREE_TEXT_CAP = 4_000_000;

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

/**
 * When a tree is done, by the directive's `finish=` (gh #46): every branch
 * closed; or every branch closed or marked open and complete; or every branch
 * closed, or one marked open and complete (UBC §5.x).
 */
export type TruthTreeFinish = "closed" | "complete" | "one-open";

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
  /** The same for the engine, without its `@syntax` annotations. */
  readonly mm0?: string;
  /** When the tree is done; `closed` where absent. */
  readonly finish?: TruthTreeFinish;
  readonly task: TruthTreeTask;
  /**
   * The root, as engine text, in order: the premises and then the negated
   * conclusion for a validity task, the set's members for a consistency task.
   */
  readonly root: readonly string[];
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
  /**
   * The instance each row of a general step was written with, by row id, as
   * engine text (`a` for the row `Fa` from `∀x Fx`). The browser finds them
   * by asking the engine, and the certificate it submits proves each one, so
   * a stored instance is one the engine confirmed. Completeness counts them.
   */
  readonly instances?: Readonly<Record<string, string>>;
  /**
   * The statement of a rule on a pair of rows each row it sets off is
   * developed by, on a branch marked open, keyed `"<leaf id> <row id>"`: the
   * direction an identity is substituted in there (`tb_id_ba`, every `b` made
   * `a`). The browser finds it by asking the engine, and the certificate
   * proves the branch developed in it. A row with none is asked by its
   * rule's own statement.
   */
  readonly directions?: Readonly<Record<string, string>>;
}
