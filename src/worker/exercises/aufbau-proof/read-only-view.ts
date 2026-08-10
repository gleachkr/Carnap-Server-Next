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
import type { AufbauProofPublicData } from "./types";
import {
  AUFBAU_PROOF_COMPONENT_METADATA,
  AUFBAU_PROOF_KIND,
  isAufbauProofPublicData,
} from "./types";

/**
 * Shadow-DOM chrome styles for the proof element, server-rendered into its
 * Declarative Shadow Root so author `:::style` CSS cannot reach the chrome. The
 * prompt is slotted from light DOM so author CSS and the document's math
 * font still reach it. The client (Stage 3) replaces the inert `<pre>` with a
 * CodeMirror editor.
 */
const AUFBAU_PROOF_SHADOW_STYLES = `
  ${EXERCISE_GROUP_SHADOW_STYLES}

  .proof-source {
    background: var(--surface-soft, #f8f2e8);
    border: 1px solid var(--rule, #d8d0c3);
    border-radius: 0.4rem;
    font-family: ui-monospace, "Fira Code", monospace;
    font-size: 0.9rem;
    line-height: 1.5;
    margin: 0.75rem 0 0;
    overflow-x: auto;
    padding: 0.75rem 0.9rem;
    white-space: pre;
  }

`;

interface AufbauProofElementMeta {
  readonly component: string;
  readonly componentVersion: string;
  readonly contentRevisionId?: string | undefined;
  readonly exerciseId: string;
  readonly exerciseKind: string;
  readonly i18n: Translator;
  /** The author's title, or null for the hidden generic group name. */
  readonly title: string | null;
}

/** The `.auf` source the student starts from: the goal header, then the body. */
export function starterProofText(publicData: AufbauProofPublicData): string {
  return `${publicData.goalName}\n----\n${publicData.starterBody}`;
}

/**
 * The proof custom element with its Declarative Shadow Root. The SSR markup is
 * inert (the proof source shown read-only, `aria-busy`) and styled with no JS.
 * On the interactive path the element upgrades in place — mounting the editor,
 * compiling as the student types, and mirroring `{ proofText, mmb }` into the
 * form's `answerData`. The preview paths reuse this markup and upgrade it too —
 * their document carries the hydration table but no form, so the editor works
 * and simply has nothing to submit into.
 */
export function renderAufbauProofElement(
  publicData: AufbauProofPublicData,
  meta: AufbauProofElementMeta,
  actions = "",
): string {
  return `<carnap-aufbau-proof data-component="${escapeHtml(meta.component)}" data-component-version="${escapeHtml(meta.componentVersion)}" data-exercise-id="${escapeHtml(meta.exerciseId)}" data-exercise-kind="${escapeHtml(meta.exerciseKind)}"${contentRevisionAttribute(meta.contentRevisionId)}>
        <template shadowrootmode="open">
          <style>${AUFBAU_PROOF_SHADOW_STYLES}</style>
          <fieldset aria-busy="true" class="exercise-group proof">
            ${exerciseLegendHtml(exerciseGroupLabel(meta.exerciseKind, meta.title, meta.i18n))}
            <slot name="prompt"></slot>
            <pre class="proof-source">${escapeHtml(starterProofText(publicData))}</pre>
            <slot name="exercise-actions"></slot>
          </fieldset>
        </template>
        <div class="exercise-prompt" slot="prompt">${publicData.promptHtml}</div>
        ${actions}
      </carnap-aufbau-proof>`;
}

/**
 * The proof element in `review` mode: the submitted `.auf` shown read-only in a
 * shadow-isolated `<pre>`. The Declarative Shadow Root attaches at parse time
 * (no JS), so it renders inline on the review and results pages. The correctness
 * verdict comes from the recorded evaluation, not from re-verifying here.
 *
 * The embedded hydration payload is what tells the element it is in `review`
 * mode — the `data-review` attribute is a marker for styling and tests, not the
 * signal — and carries the widget's text in the viewer's language for anything
 * the element goes on to say.
 */
export function renderAufbauProofReview(
  review: {
    readonly exerciseId: string;
    readonly proofText: string;
  },
  i18n: Translator,
): string {
  return `<carnap-aufbau-proof data-exercise-id="${escapeHtml(review.exerciseId)}" data-review>
        <template shadowrootmode="open">
          <style>${AUFBAU_PROOF_SHADOW_STYLES}</style>
          <pre class="proof-source">${escapeHtml(review.proofText)}</pre>
        </template>
        ${reviewHydrationScript(AUFBAU_PROOF_COMPONENT_METADATA.assetId, i18n)}
      </carnap-aufbau-proof>`;
}

export function renderAufbauProof(
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  context: ExerciseRenderContext,
): string {
  if (
    node.exerciseKind !== AUFBAU_PROOF_KIND ||
    !isAufbauProofPublicData(node.publicData)
  ) {
    return `<div data-component="${escapeHtml(node.render.component)}" data-exercise-id="${escapeHtml(node.exerciseId)}"></div>`;
  }

  return renderAufbauProofElement(
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
