import {
  contentRevisionAttribute,
  escapeHtml,
} from "../../application/content/render-support";
import type { ExerciseRenderContext } from "../../application/content/renderer";
import type { ContentNode } from "../../domain/content";
import type { Translator } from "../../i18n/translator";
import { previewExerciseActionsHtml } from "../actions";
import {
  EXERCISE_GROUP_SHADOW_STYLES,
  exerciseGroupLabel,
  exerciseLegendHtml,
} from "../group";
import { reviewHydrationScript } from "../hydration";
import type { AufbauProofTreePublicData, ProofTreeNode } from "./types";
import {
  AUFBAU_PROOF_TREE_COMPONENT_METADATA,
  AUFBAU_PROOF_TREE_KIND,
  isAufbauProofTreePublicData,
} from "./types";

/**
 * The client component bundle, loaded on review/results pages purely for its
 * side effect of registering the vendored ProofML elements so the read-only
 * tree lays out with fitch bars. The bundle also defines `<carnap-aufbau-proof-tree>`,
 * but that upgrade is a no-op once the element reads `review` from its payload.
 * Deduped by URL, so many reviews on a page load it once; without it the tree
 * still renders, just as nested text.
 */
const TREE_ASSET_URL = `/assets/components/${AUFBAU_PROOF_TREE_COMPONENT_METADATA.assetId}.js`;

/**
 * Shadow-DOM chrome styles for the tree proof element. The prompt is slotted
 * from light DOM (so author `:::style` CSS and the document's math font reach
 * it) while
 * the tree canvas is isolated. The tree itself is drawn by the vendored ProofML
 * custom elements (`<proof-tree>` etc.); these rules only theme them (border
 * colour, fonts) — ProofML computes the fitch-bar layout client-side. The client
 * editor (Stage 3) adopts this same shadow root and rebuilds the tree with
 * editing affordances.
 */
const AUFBAU_PROOF_TREE_SHADOW_STYLES = `
  ${EXERCISE_GROUP_SHADOW_STYLES}

  .proof-tree-canvas {
    --border-color: var(--ink, #16324a);
    --inference-size: 0.72rem;
    margin: 0.85rem 0 0;
    overflow-x: auto;
    padding: 1.3rem 0;
  }

  proof-proposition {
    font-family: "STIX Two Math", Cambria, Georgia, serif;
    font-size: 1.02rem;
  }

  proof-inference {
    color: var(--ink-muted, #5f7388);
    font-family: ui-sans-serif, system-ui, sans-serif;
  }
`;

interface AufbauProofTreeElementMeta {
  readonly component: string;
  readonly componentVersion: string;
  readonly contentRevisionId?: string | undefined;
  readonly exerciseId: string;
  readonly exerciseKind: string;
  readonly i18n: Translator;
  /** The author's title, or null for the hidden generic group name. */
  readonly title: string | null;
}

/**
 * Render a proof tree to the nested ProofML markup that lays out as a
 * fitch-style derivation. A derived node wraps its premises in a `<proof-forest>`
 * and labels itself with `<proof-inference>`; a `hyp` leaf shows the referenced
 * hypothesis index. Used for the read-only review and the inert SSR seed.
 */
export function proofTreeMarkup(node: ProofTreeNode): string {
  if (node.hyp !== undefined) {
    return `<proof-tree><proof-proposition>${escapeHtml(node.formula)}</proof-proposition><proof-inference>#${node.hyp}</proof-inference></proof-tree>`;
  }

  const forest =
    node.premises.length > 0
      ? `<proof-forest>${node.premises.map(proofTreeMarkup).join("")}</proof-forest>`
      : "";
  const inference =
    node.rule.length > 0
      ? `<proof-inference>${escapeHtml(node.rule)}</proof-inference>`
      : "";

  return `<proof-tree>${forest}<proof-proposition>${escapeHtml(node.formula)}</proof-proposition>${inference}</proof-tree>`;
}

/**
 * The tree proof custom element with its Declarative Shadow Root. The SSR markup
 * is inert: a single ProofML node showing the goal, styled with no JS. On the
 * interactive path the client adopts this shadow root and rebuilds the tree with
 * editing controls, compiling as the student works and mirroring `{ mmb,
 * proofText, tree }` into the form's `answerData`. The preview paths reuse this
 * markup and upgrade it too — no form to mirror into, so the tree is editable
 * but unsubmittable.
 */
export function renderAufbauProofTreeElement(
  publicData: AufbauProofTreePublicData,
  meta: AufbauProofTreeElementMeta,
  actions = "",
): string {
  const seed =
    publicData.starterTree === undefined
      ? `<proof-tree><proof-proposition>${escapeHtml(publicData.goalFormula)}</proof-proposition></proof-tree>`
      : proofTreeMarkup(publicData.starterTree);

  return `<carnap-aufbau-proof-tree data-component="${escapeHtml(meta.component)}" data-component-version="${escapeHtml(meta.componentVersion)}" data-exercise-id="${escapeHtml(meta.exerciseId)}" data-exercise-kind="${escapeHtml(meta.exerciseKind)}"${contentRevisionAttribute(meta.contentRevisionId)}>
        <template shadowrootmode="open">
          <style>${AUFBAU_PROOF_TREE_SHADOW_STYLES}</style>
          <fieldset aria-busy="true" class="exercise-group proof-tree">
            ${exerciseLegendHtml(exerciseGroupLabel(meta.exerciseKind, meta.title, meta.i18n))}
            <slot name="prompt"></slot>
            <div class="proof-tree-canvas">${seed}</div>
            <slot name="exercise-actions"></slot>
          </fieldset>
        </template>
        <div class="exercise-prompt" slot="prompt">${publicData.promptHtml}</div>
        ${actions}
      </carnap-aufbau-proof-tree>`;
}

/**
 * The tree proof element in `review` mode: the submitted tree drawn read-only.
 * The Declarative Shadow Root attaches at parse time, so it renders inline on the
 * review and results pages; those pages load the vendored ProofML module so the
 * fitch layout resolves (without it the tree degrades to nested text). The
 * correctness verdict comes from the recorded evaluation, not from re-verifying.
 *
 * That module also defines `<carnap-aufbau-proof-tree>`, so the element does upgrade
 * here; the embedded hydration payload is what tells it this is `review` mode
 * and leaves the drawn tree alone. The `data-review` attribute is a marker for
 * styling and tests, not the signal.
 */
export function renderAufbauProofTreeReview(
  review: {
    readonly exerciseId: string;
    readonly tree: ProofTreeNode;
  },
  i18n: Translator,
): string {
  const hydration = reviewHydrationScript(
    AUFBAU_PROOF_TREE_COMPONENT_METADATA.assetId,
    i18n,
  );

  return `<carnap-aufbau-proof-tree data-exercise-id="${escapeHtml(review.exerciseId)}" data-review>
        <template shadowrootmode="open">
          <style>${AUFBAU_PROOF_TREE_SHADOW_STYLES}</style>
          <div class="proof-tree-canvas">${proofTreeMarkup(review.tree)}</div>
        </template>
        ${hydration}
      </carnap-aufbau-proof-tree><script type="module" src="${TREE_ASSET_URL}"></script>`;
}

export function renderAufbauProofTree(
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  context: ExerciseRenderContext,
): string {
  if (
    node.exerciseKind !== AUFBAU_PROOF_TREE_KIND ||
    !isAufbauProofTreePublicData(node.publicData)
  ) {
    return `<div data-component="${escapeHtml(node.render.component)}" data-exercise-id="${escapeHtml(node.exerciseId)}"></div>`;
  }

  return renderAufbauProofTreeElement(
    node.publicData,
    {
      component: node.render.component,
      componentVersion: node.render.componentVersion,
      contentRevisionId: context.contentRevisionId,
      exerciseId: node.exerciseId,
      exerciseKind: node.exerciseKind,
      i18n: context.i18n,
      title: context.title ?? null,
    },
    // A preview has no attempt to submit to, but it gets the same closing row a
    // student's copy has, with the button disabled: the shape the author is
    // writing towards, and the row this widget's own controls land in.
    previewExerciseActionsHtml(context.i18n, true),
  );
}
