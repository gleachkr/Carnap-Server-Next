import {
  escapeHtml,
  exerciseRootAttributes,
} from "../../application/content/render-support";
import type { ContentNode } from "../../domain/content";
import { previewExerciseActionsHtml } from "../../exercise-kit/actions";
import {
  exerciseGroupLabel,
  exerciseLegendHtml,
} from "../../exercise-kit/group";
import type { ExerciseRenderContext } from "../../exercise-kit/type";
import {
  isShortAnswerPublicData,
  SHORT_ANSWER_KIND,
  shortAnswerName,
} from "./types";

export function renderShortAnswer(
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  context: ExerciseRenderContext,
): string {
  if (
    node.exerciseKind !== SHORT_ANSWER_KIND ||
    !isShortAnswerPublicData(node.publicData)
  ) {
    return `<div data-component="${escapeHtml(node.render.component)}" data-exercise-id="${escapeHtml(node.exerciseId)}"></div>`;
  }

  const rootAttributes = exerciseRootAttributes({
    component: node.render.component,
    componentVersion: node.render.componentVersion,
    contentRevisionId: context.contentRevisionId,
    exerciseId: node.exerciseId,
    exerciseKind: node.exerciseKind,
  });
  // Spelled as a local named `i18n` because Lingui's extractor matches the
  // receiver's *name*; `context.i18n.t("Answer")` would render fine in English
  // and never reach a catalog.
  const i18n = context.i18n;
  const legend = exerciseLegendHtml(
    exerciseGroupLabel(shortAnswerName(i18n), context.title),
  );
  const fieldId = `${node.exerciseId}-answer`;

  // The same closing row a student's copy has, unslotted — a text exercise has no
  // shadow card to project into — and with the submit disabled: there is no
  // attempt behind a preview to record an answer against.
  return `<section${rootAttributes}>
        <fieldset class="exercise-group">
          ${legend}
          <div class="exercise-prompt">${node.publicData.promptHtml}</div>
          <label for="${escapeHtml(fieldId)}">${escapeHtml(i18n.t("Answer"))}</label>
          <input disabled id="${escapeHtml(fieldId)}">
        </fieldset>
        ${context.actions ?? previewExerciseActionsHtml(i18n, false)}
      </section>`;
}
