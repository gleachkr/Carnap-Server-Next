import {
  type ExerciseElementMeta,
  escapeHtml,
  exerciseRootAttributes,
} from "../../application/content/render-support";
import type { ContentNode } from "../../domain/content";
import { previewExerciseActionsHtml } from "../../exercise-kit/actions";
import {
  EXERCISE_GROUP_SHADOW_STYLES,
  exerciseGroupLabel,
  exerciseLegendHtml,
} from "../../exercise-kit/group";
import { EXERCISE_TOKEN_STYLES } from "../../exercise-kit/tokens";
import type { ExerciseRenderContext } from "../../exercise-kit/type";
import type { Translator } from "../../i18n/translator";
import { stringsResolver } from "../../i18n/translator";
import reviewStyles from "./review.css" with { type: "text" };
import shadowStyles from "./shadow.css" with { type: "text" };
import { buildTranslationStrings } from "./strings";
import type { TranslationPublicData } from "./types";
import {
  isTranslationPublicData,
  TRANSLATION_KIND,
  translationName,
} from "./types";

const TRANSLATION_SHADOW_STYLES = [
  EXERCISE_GROUP_SHADOW_STYLES,
  shadowStyles,
].join("\n");

interface TranslationElementMeta extends ExerciseElementMeta {
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
    exerciseGroupLabel(translationName(meta.i18n), meta.title),
  );
  const inputId = "translation-input";

  return `<carnap-translation${exerciseRootAttributes(meta)}>
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

const TRANSLATION_REVIEW_STYLES = [EXERCISE_TOKEN_STYLES, reviewStyles].join(
  "\n",
);

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
    context.actions ?? previewExerciseActionsHtml(context.i18n, true),
  );
}
