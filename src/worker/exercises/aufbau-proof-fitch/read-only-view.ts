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
import type { AufbauProofFitchPublicData } from "./types";
import {
  AUFBAU_PROOF_FITCH_COMPONENT_METADATA,
  AUFBAU_PROOF_FITCH_KIND,
  isAufbauProofFitchPublicData,
} from "./types";

/**
 * The client component bundle, loaded on review/results pages so the read-only
 * `<carnap-aufbau-proof-fitch>` upgrade can mount a *read-only* CodeMirror that draws
 * the subproof scope-lines — the same rendering the interactive editor uses.
 * Deduped by URL, so many reviews on a page load it once; without it the review
 * degrades gracefully to the inert `<pre>` of source text.
 */
const FITCH_ASSET_URL = `/assets/components/${AUFBAU_PROOF_FITCH_COMPONENT_METADATA.assetId}.js`;

/**
 * Shadow-DOM chrome styles for the Fitch proof element, server-rendered into its
 * Declarative Shadow Root so author `:::style` CSS cannot reach the chrome. The
 * prompt is slotted from light DOM so author CSS and the document's math font
 * still reach
 * it. The client (Stage 3) replaces the inert `<pre>` with a CodeMirror editor
 * that draws the subproof scope-lines; the inert view is just the source text.
 */
const AUFBAU_PROOF_FITCH_SHADOW_STYLES = `
  ${EXERCISE_GROUP_SHADOW_STYLES}

  .proof-source {
    background: var(--surface-soft, #f8f2e8);
    border: 1px solid var(--rule, #d8d0c3);
    border-radius: 0.4rem;
    font-family: "Fira Code", ui-monospace, monospace;
    font-size: 0.9rem;
    line-height: 1.5;
    margin: 0.75rem 0 0;
    overflow-x: auto;
    padding: 0.75rem 0.9rem;
    white-space: pre;
  }
`;

interface AufbauProofFitchElementMeta {
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
 * The Fitch proof custom element with its Declarative Shadow Root. The SSR markup
 * is inert (the starter Fitch source shown read-only, `aria-busy`) and styled
 * with no JS. On the interactive path the element upgrades in place — mounting a
 * CodeMirror editor with subproof scope-lines, translating to `.auf` and
 * compiling as the student types, and mirroring `{ fitchText, proofText, mmb }`
 * into the form's `answerData`. The preview paths reuse this markup and upgrade
 * it too — no form to mirror into, so the editor works but has nothing to
 * submit.
 */
export function renderAufbauProofFitchElement(
  publicData: AufbauProofFitchPublicData,
  meta: AufbauProofFitchElementMeta,
  actions = "",
): string {
  return `<carnap-aufbau-proof-fitch data-component="${escapeHtml(meta.component)}" data-component-version="${escapeHtml(meta.componentVersion)}" data-exercise-id="${escapeHtml(meta.exerciseId)}" data-exercise-kind="${escapeHtml(meta.exerciseKind)}"${contentRevisionAttribute(meta.contentRevisionId)}>
        <template shadowrootmode="open">
          <style>${AUFBAU_PROOF_FITCH_SHADOW_STYLES}</style>
          <fieldset aria-busy="true" class="exercise-group proof">
            ${exerciseLegendHtml(exerciseGroupLabel(meta.exerciseKind, meta.title, meta.i18n))}
            <slot name="prompt"></slot>
            <pre class="proof-source">${escapeHtml(publicData.starterBody)}</pre>
            <slot name="exercise-actions"></slot>
          </fieldset>
        </template>
        <div class="exercise-prompt" slot="prompt">${publicData.promptHtml}</div>
        ${actions}
      </carnap-aufbau-proof-fitch>`;
}

/**
 * The Fitch proof element in `review` mode: the submitted Fitch source, drawn
 * read-only. The Declarative Shadow Root attaches at parse time, so the inert
 * `<pre>` of source text renders inline on the review and results pages with no
 * JS. The appended module then upgrades the element in place, replacing that
 * `<pre>` with a read-only CodeMirror that draws the subproof scope-lines — the
 * same rendering the interactive editor uses; without JS it stays the `<pre>`.
 * The `data-assumption-rule` seeds the scope walk (which lines open a subproof);
 * the correctness verdict comes from the recorded evaluation, not re-verifying.
 *
 * The embedded hydration payload is what tells the element to take that
 * read-only path — `data-review` is a marker for styling and tests, not the
 * signal — and carries the widget's text in the viewer's language, since this is
 * the one review that runs client code today.
 */
export function renderAufbauProofFitchReview(
  review: {
    readonly assumptionRule: string;
    readonly exerciseId: string;
    readonly fitchText: string;
  },
  i18n: Translator,
): string {
  const hydration = reviewHydrationScript(
    AUFBAU_PROOF_FITCH_COMPONENT_METADATA.assetId,
    i18n,
  );

  return `<carnap-aufbau-proof-fitch data-exercise-id="${escapeHtml(review.exerciseId)}" data-review data-assumption-rule="${escapeHtml(review.assumptionRule)}">
        <template shadowrootmode="open">
          <style>${AUFBAU_PROOF_FITCH_SHADOW_STYLES}</style>
          <pre class="proof-source">${escapeHtml(review.fitchText)}</pre>
        </template>
        ${hydration}
      </carnap-aufbau-proof-fitch><script type="module" src="${FITCH_ASSET_URL}"></script>`;
}

export function renderAufbauProofFitch(
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  context: ExerciseRenderContext,
): string {
  if (
    node.exerciseKind !== AUFBAU_PROOF_FITCH_KIND ||
    !isAufbauProofFitchPublicData(node.publicData)
  ) {
    return `<div data-component="${escapeHtml(node.render.component)}" data-exercise-id="${escapeHtml(node.exerciseId)}"></div>`;
  }

  return renderAufbauProofFitchElement(
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
