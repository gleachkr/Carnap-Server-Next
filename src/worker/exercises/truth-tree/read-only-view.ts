import type { TableauDocument } from "../../../tableau/document";
import { tableauGridHtml, tableauOutlineHtml } from "../../../tableau/html";
import { layoutTableau } from "../../../tableau/layout";
import tableauStyles from "../../../tableau/tableau.css" with {
  type: "text",
};
import {
  type ExerciseElementMeta,
  escapeHtml,
  exerciseRootAttributes,
  VISUALLY_HIDDEN_STYLES,
} from "../../application/content/render-support";
import type { ContentNode } from "../../domain/content";
import { previewExerciseActionsHtml } from "../../exercise-kit/actions";
import {
  EXERCISE_GROUP_SHADOW_STYLES,
  type ExerciseHeading,
  exerciseGroupLabel,
  exerciseLegendHtml,
} from "../../exercise-kit/group";
import { EXERCISE_TOKEN_STYLES } from "../../exercise-kit/tokens";
import type { ExerciseRenderContext } from "../../exercise-kit/type";
import type { Translator } from "../../i18n/translator";
import { stringsResolver } from "../../i18n/translator";
import { treeAnnotations } from "./annotations";
import type { ResolvedTree, TreeJudgement } from "./grading";
import {
  answerRules,
  isTruthTreePublicData,
  judgeTree,
  resolveTruthTree,
  startingTree,
} from "./grading";
import type { TreeReport } from "./report";
import reviewStyles from "./review.css" with { type: "text" };
import shadowStyles from "./shadow.css" with { type: "text" };
import { buildTruthTreeStrings } from "./strings";
import type { TruthTreeAnswerData, TruthTreePublicData } from "./types";
import { TRUTH_TREE_KIND, truthTreeName } from "./types";
import type { TreeWords } from "./verdict-text";

const TRUTH_TREE_SHADOW_STYLES = [
  EXERCISE_GROUP_SHADOW_STYLES,
  tableauStyles,
  shadowStyles,
].join("\n");
const TRUTH_TREE_REVIEW_STYLES = [
  EXERCISE_TOKEN_STYLES,
  VISUALLY_HIDDEN_STYLES,
  tableauStyles,
  shadowStyles,
  reviewStyles,
].join("\n");

/**
 * The tree, drawn: the grid for the eye and the outline for a screen reader.
 * `rules` are the rules its steps name; `report` is the tree's own, when the
 * caller has already checked it.
 */
function treeHtml(
  tree: TableauDocument,
  resolved: ResolvedTree,
  words: TreeWords,
  rules: ReadonlyMap<string, string> = new Map(),
  report: TreeReport = judgeTree(
    resolved,
    { nodes: tree.nodes, rules: Object.fromEntries(rules) },
    { kind: "none" },
  ).report,
): string {
  const layout = layoutTableau(tree);
  const annotations = treeAnnotations(
    tree,
    layout,
    report,
    resolved.language,
    words,
    { flag: false, rootRows: resolved.root.length, rules },
  );

  return `<div class="tableau-scroller" data-role="tree">${tableauGridHtml(
    tree,
    layout,
    annotations,
  )}${tableauOutlineHtml(tree, annotations)}</div>`;
}

interface TruthTreeElementMeta extends ExerciseElementMeta {
  readonly i18n: Translator;
  readonly heading: ExerciseHeading;
  readonly title: string | null;
}

/**
 * The truth-tree element with its Declarative Shadow Root: the root drawn,
 * `aria-busy` until the island takes over.
 */
export function renderTruthTreeElement(
  publicData: TruthTreePublicData,
  meta: TruthTreeElementMeta,
  actions = "",
): string {
  const resolved = resolveTruthTree(publicData);
  const words = stringsResolver(buildTruthTreeStrings(meta.i18n));
  const legend = exerciseLegendHtml(
    exerciseGroupLabel(truthTreeName(meta.i18n), meta),
  );
  const body =
    resolved === null
      ? ""
      : treeHtml(startingTree(resolved), resolved, words);

  return `<carnap-truth-tree${exerciseRootAttributes(meta)}>
        <template shadowrootmode="open">
          <style>${TRUTH_TREE_SHADOW_STYLES}</style>
          <fieldset aria-busy="true" class="exercise-group truth-tree" data-task="${publicData.task}">
            ${legend}
            <slot name="prompt"></slot>
            <div class="truth-tree-body" data-role="body">${body}</div>
            <slot name="exercise-actions"></slot>
          </fieldset>
        </template>
        <div class="exercise-prompt" slot="prompt">${publicData.promptHtml}</div>
        ${actions}
      </carnap-truth-tree>`;
}

export interface TruthTreeReview {
  readonly answer: TruthTreeAnswerData;
  readonly exerciseId: string;
  readonly judgement: TreeJudgement;
  readonly resolved: ResolvedTree;
  /** Said above the tree; empty where a sealed exercise keeps it back. */
  readonly verdict: string;
}

/**
 * The submitted tree, drawn statically for the review and results pages,
 * with the verdict above it. The tree is drawn from the judgement's own
 * report, not checked again.
 */
export function renderTruthTreeReview(
  review: TruthTreeReview,
  words: TreeWords,
): string {
  const tree: TableauDocument = { nodes: review.answer.nodes };
  const body = treeHtml(
    tree,
    review.resolved,
    words,
    answerRules(review.answer),
    review.judgement.report,
  );

  return `<carnap-truth-tree data-exercise-id="${escapeHtml(review.exerciseId)}" data-review>
        <template shadowrootmode="open">
          <style>${TRUTH_TREE_REVIEW_STYLES}</style>
          ${review.verdict.length === 0 ? "" : `<p class="truth-tree-review-verdict">${escapeHtml(review.verdict)}</p>`}
          <div class="truth-tree truth-tree-review truth-tree-body">${body}</div>
        </template>
      </carnap-truth-tree>`;
}

export function renderTruthTree(
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  context: ExerciseRenderContext,
): string {
  if (
    node.exerciseKind !== TRUTH_TREE_KIND ||
    !isTruthTreePublicData(node.publicData)
  ) {
    return `<div data-component="${escapeHtml(node.render.component)}" data-exercise-id="${escapeHtml(node.exerciseId)}"></div>`;
  }

  return renderTruthTreeElement(
    node.publicData,
    {
      component: node.render.component,
      componentVersion: node.render.componentVersion,
      contentRevisionId: context.contentRevisionId,
      exerciseId: node.exerciseId,
      exerciseKind: node.exerciseKind,
      i18n: context.i18n,
      heading: context.heading,
      title: context.title ?? null,
    },
    context.actions ?? previewExerciseActionsHtml(context.i18n, true),
  );
}
