import {
  contentRevisionAttribute,
  escapeHtml,
} from "../../application/content/render-support";
import type { ExerciseRenderContext } from "../../application/content/renderer";
import type { ContentNode } from "../../domain/content";
import type { Translator } from "../../i18n/translator";
import { stringsResolver } from "../../i18n/translator";
import { previewExerciseActionsHtml } from "../actions";
import {
  EXERCISE_GROUP_SHADOW_STYLES,
  exerciseGroupLabel,
  exerciseLegendHtml,
} from "../group";
import { buildTranslationStrings } from "./strings";
import type { TranslationPublicData } from "./types";
import { isTranslationPublicData, TRANSLATION_KIND } from "./types";

/**
 * Shadow-DOM chrome styles for the translation element, server-rendered into
 * its Declarative Shadow Root. The shadow boundary isolates them from author
 * `:::style` CSS; the prompt is slotted from light DOM so author CSS and the
 * document's math font still reach it. Custom properties inherit across the
 * boundary, so the palette tokens resolve to the content document's values —
 * which is also why nothing here is a hex literal.
 */
const TRANSLATION_SHADOW_STYLES = `
  ${EXERCISE_GROUP_SHADOW_STYLES}

  .translation-row {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .translation-input {
    background: var(--control-surface, #fbf7ef);
    border: 1px solid var(--rule, #d8d0c3);
    border-radius: 3px;
    color: inherit;
    flex: 1 1 24ch;
    font: inherit;
    min-width: 12ch;
    padding: 0.25rem 0.45rem;
  }

  .translation-input:disabled {
    opacity: 0.75;
  }

  /* What the typed ASCII parses as, in logical symbols — or, while it does
     not parse, the parser's complaint. Same line, two moods. */
  .translation-preview {
    margin: 0.35rem 0 0;
    min-height: 1.4em;
  }

  .translation-preview[data-mood="error"] {
    color: var(--red, #b42318);
  }

  .translation-preview:empty {
    display: none;
  }
`;

interface TranslationElementMeta {
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
 * The translation custom element with its Declarative Shadow Root.
 *
 * The SSR markup is inert (input disabled, `aria-busy`) and correctly styled
 * with no JS. On connect the element enables the input, restores the prior
 * answer, and keeps the preview line current as the reader types.
 */
export function renderTranslationElement(
  publicData: TranslationPublicData,
  meta: TranslationElementMeta,
  actions = "",
): string {
  const strings = stringsResolver(buildTranslationStrings(meta.i18n));
  const legend = exerciseLegendHtml(
    exerciseGroupLabel(meta.exerciseKind, meta.title, meta.i18n),
  );
  const inputId = "translation-input";

  return `<carnap-translation data-component="${escapeHtml(meta.component)}" data-component-version="${escapeHtml(meta.componentVersion)}" data-exercise-id="${escapeHtml(meta.exerciseId)}" data-exercise-kind="${escapeHtml(meta.exerciseKind)}"${contentRevisionAttribute(meta.contentRevisionId)}>
        <template shadowrootmode="open">
          <style>${TRANSLATION_SHADOW_STYLES}</style>
          <fieldset aria-busy="true" class="exercise-group translation">
            ${legend}
            <slot name="prompt"></slot>
            <div class="translation-row"><label class="visually-hidden" for="${inputId}">${escapeHtml(strings("Your translation"))}</label><input autocapitalize="off" autocomplete="off" class="translation-input" data-role="text" disabled id="${inputId}" spellcheck="false" type="text" value="${escapeHtml(publicData.starter ?? "")}"></div>
            <p aria-live="polite" class="translation-preview" data-role="preview"></p>
            <slot name="exercise-actions"></slot>
          </fieldset>
        </template>
        <div class="exercise-prompt" slot="prompt">${publicData.promptHtml}</div>
        ${actions}
      </carnap-translation>`;
}

/**
 * Shadow-DOM styles for the translation review widget: the submitted formula,
 * shown once in logical symbols and once as typed when the two differ.
 */
const TRANSLATION_REVIEW_STYLES = `
  .translation-review-display {
    font-size: 1.05rem;
    margin: 0;
  }

  .translation-review-source {
    color: var(--ink-muted, #5f7388);
    font-family: ui-monospace, "Fira Code", monospace;
    font-size: 0.9em;
    margin: 0.25rem 0 0;
  }
`;

export interface TranslationReview {
  /** The submission in logical symbols — or as typed, when it won't parse. */
  readonly display: string;
  readonly exerciseId: string;
  readonly text: string;
}

/**
 * The submitted translation, rendered statically for the review and results
 * pages. No verdict lives here: whether the answer was right is the recorded
 * evaluation's to report, since equivalence cannot be recomputed without the
 * search engine.
 */
export function renderTranslationReview(
  review: TranslationReview,
  _i18n: Translator,
): string {
  const source =
    review.display === review.text
      ? ""
      : `<p class="translation-review-source">${escapeHtml(review.text)}</p>`;

  return `<carnap-translation data-exercise-id="${escapeHtml(review.exerciseId)}" data-review>
        <template shadowrootmode="open">
          <style>${TRANSLATION_REVIEW_STYLES}</style>
          <p class="translation-review-display">${escapeHtml(review.display)}</p>
          ${source}
        </template>
      </carnap-translation>`;
}

export function renderTranslation(
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  context: ExerciseRenderContext,
): string {
  if (
    node.exerciseKind !== TRANSLATION_KIND ||
    !isTranslationPublicData(node.publicData)
  ) {
    return `<div data-component="${escapeHtml(node.render.component)}" data-exercise-id="${escapeHtml(node.exerciseId)}"></div>`;
  }

  return renderTranslationElement(
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
    // A preview has no attempt to submit to, but it gets the same closing row
    // a student's copy has, with the button disabled.
    previewExerciseActionsHtml(context.i18n, true),
  );
}
