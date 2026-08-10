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
import type { AufbauProofPrawitzPublicData, PrawitzProofNode } from "./types";
import {
  AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA,
  AUFBAU_PROOF_PRAWITZ_KIND,
  isAufbauProofPrawitzPublicData,
} from "./types";

/**
 * The client component bundle, loaded on review/results pages purely for its
 * side effect of registering the vendored ProofML elements so the read-only
 * tree lays out with inference lines. The bundle also defines
 * `<carnap-aufbau-proof-prawitz>`, but that upgrade is a no-op once the element
 * reads `review` from its payload. Deduped by URL, so many reviews on a page
 * load it once; without it the tree still renders, just as nested text.
 */
const PRAWITZ_ASSET_URL = `/assets/components/${AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA.assetId}.js`;

/**
 * Shadow-DOM chrome styles for the Prawitz proof element. The prompt is slotted
 * from light DOM (so author `:::style` CSS and the document's math font reach
 * it) while
 * the tree canvas is isolated. The tree itself is drawn by the vendored ProofML
 * custom elements; these rules only theme them. The discharge superscripts (the
 * `¹` on a bracketed assumption and beside the discharging inference) are plain
 * `<sup>`s inside ProofML propositions/inferences.
 */
const AUFBAU_PROOF_PRAWITZ_SHADOW_STYLES = `
  ${EXERCISE_GROUP_SHADOW_STYLES}

  .prawitz-canvas {
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

  proof-proposition sup,
  proof-inference sup {
    font-size: 0.85em;
  }

  /* The assumption label hangs off the proposition's top-right corner instead
     of taking inline width — otherwise it widens the box and shoves the
     centered formula leftward under its inference line. */
  proof-proposition { position: relative; }
  proof-proposition > sup {
    left: 100%;
    position: absolute;
    top: -0.55em;
  }
`;

interface AufbauProofPrawitzElementMeta {
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
 * Render a Prawitz tree to nested ProofML markup in the textbook notation: a
 * labeled assumption leaf is bracketed with its superscript label (`[A]¹`), an
 * unlabeled leaf is a bare standing premise, and a discharging inference shows
 * its rule with the discharged labels superscripted beside it. Assumption
 * leaves stay forest-less — an assumption has no inference line above it —
 * while every derived node keeps a `<proof-forest>` even when empty, which is
 * what makes ProofML draw (and restyle) the line for zero-premise rules. Used
 * for the read-only review; the client editor (Stage 3) draws its own.
 */
export function prawitzTreeMarkup(
  node: PrawitzProofNode,
  assumptionRule: string,
): string {
  if (node.rule === assumptionRule) {
    const label = node.label?.trim() ?? "";
    const proposition =
      label.length > 0
        ? `[${escapeHtml(node.formula)}]<sup>${escapeHtml(label)}</sup>`
        : escapeHtml(node.formula);
    return `<proof-tree><proof-proposition>${proposition}</proof-proposition></proof-tree>`;
  }

  const forest = `<proof-forest>${node.premises
    .map((premise) => prawitzTreeMarkup(premise, assumptionRule))
    .join("")}</proof-forest>`;
  const marks = (node.discharge ?? [])
    .map((mark) => mark.trim())
    .filter((mark) => mark.length > 0);
  const markup =
    marks.length > 0 ? `<sup>${escapeHtml(marks.join(","))}</sup>` : "";
  const inference =
    node.rule.length > 0
      ? `<proof-inference>${escapeHtml(node.rule)}${markup}</proof-inference>`
      : "";

  return `<proof-tree>${forest}<proof-proposition>${escapeHtml(node.formula)}</proof-proposition>${inference}</proof-tree>`;
}

/**
 * The Prawitz proof custom element with its Declarative Shadow Root. The SSR
 * markup is inert: a single ProofML node showing the goal, styled with no JS.
 * On the interactive path the client adopts this shadow root and rebuilds the
 * workspace with editing controls, compiling as the student works and
 * mirroring `{ mmb, proofText, tree }` into the form's `answerData`. The
 * preview paths reuse this markup and upgrade it too — no form to mirror into,
 * so the tree is editable but unsubmittable.
 */
export function renderAufbauProofPrawitzElement(
  publicData: AufbauProofPrawitzPublicData,
  meta: AufbauProofPrawitzElementMeta,
  actions = "",
): string {
  const seed = `<proof-tree><proof-proposition>${escapeHtml(publicData.goalFormula)}</proof-proposition></proof-tree>`;

  return `<carnap-aufbau-proof-prawitz data-component="${escapeHtml(meta.component)}" data-component-version="${escapeHtml(meta.componentVersion)}" data-exercise-id="${escapeHtml(meta.exerciseId)}" data-exercise-kind="${escapeHtml(meta.exerciseKind)}"${contentRevisionAttribute(meta.contentRevisionId)}>
        <template shadowrootmode="open">
          <style>${AUFBAU_PROOF_PRAWITZ_SHADOW_STYLES}</style>
          <fieldset aria-busy="true" class="exercise-group proof-prawitz">
            ${exerciseLegendHtml(exerciseGroupLabel(meta.exerciseKind, meta.title, meta.i18n))}
            <slot name="prompt"></slot>
            <div class="prawitz-canvas">${seed}</div>
            <slot name="exercise-actions"></slot>
          </fieldset>
        </template>
        <div class="exercise-prompt" slot="prompt">${publicData.promptHtml}</div>
        ${actions}
      </carnap-aufbau-proof-prawitz>`;
}

/**
 * The Prawitz proof element in `review` mode: the submitted tree drawn
 * read-only in textbook notation. The Declarative Shadow Root attaches at
 * parse time, so it renders inline on the review and results pages; those
 * pages load the component module so the ProofML layout resolves (without it
 * the tree degrades to nested text). The correctness verdict comes from the
 * recorded evaluation, not from re-verifying.
 */
export function renderAufbauProofPrawitzReview(
  review: {
    readonly assumptionRule: string;
    readonly exerciseId: string;
    readonly tree: PrawitzProofNode;
  },
  i18n: Translator,
): string {
  const hydration = reviewHydrationScript(
    AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA.assetId,
    i18n,
  );

  return `<carnap-aufbau-proof-prawitz data-exercise-id="${escapeHtml(review.exerciseId)}" data-review>
        <template shadowrootmode="open">
          <style>${AUFBAU_PROOF_PRAWITZ_SHADOW_STYLES}</style>
          <div class="prawitz-canvas">${prawitzTreeMarkup(review.tree, review.assumptionRule)}</div>
        </template>
        ${hydration}
      </carnap-aufbau-proof-prawitz><script type="module" src="${PRAWITZ_ASSET_URL}"></script>`;
}

export function renderAufbauProofPrawitz(
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  context: ExerciseRenderContext,
): string {
  if (
    node.exerciseKind !== AUFBAU_PROOF_PRAWITZ_KIND ||
    !isAufbauProofPrawitzPublicData(node.publicData)
  ) {
    return `<div data-component="${escapeHtml(node.render.component)}" data-exercise-id="${escapeHtml(node.exerciseId)}"></div>`;
  }

  return renderAufbauProofPrawitzElement(
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
