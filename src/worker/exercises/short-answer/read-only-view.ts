import {
  contentRevisionAttribute,
  escapeHtml,
  hasPromptHtml,
} from "../../application/content/render-support";
import type { ExerciseRenderContext } from "../../application/content/renderer";
import type { ContentNode } from "../../domain/content";
import { previewExerciseActionsHtml } from "../actions";
import { exerciseGroupLabel, exerciseLegendHtml } from "../group";
import { SHORT_ANSWER_KIND } from "./types";

export function renderShortAnswer(
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  context: ExerciseRenderContext,
): string {
  if (
    node.exerciseKind !== SHORT_ANSWER_KIND ||
    !hasPromptHtml(node.publicData)
  ) {
    return `<div data-component="${escapeHtml(node.render.component)}" data-exercise-id="${escapeHtml(node.exerciseId)}"></div>`;
  }

  const revisionAttribute = contentRevisionAttribute(
    context.contentRevisionId,
  );
  // Spelled as a local named `i18n` because Lingui's extractor matches the
  // receiver's *name*; `context.i18n.t("Answer")` would render fine in English
  // and never reach a catalog.
  const i18n = context.i18n;
  const legend = exerciseLegendHtml(
    exerciseGroupLabel(node.exerciseKind, context.title, i18n),
  );
  const fieldId = `${node.exerciseId}-answer`;

  // The same closing row a student's copy has, unslotted — a text exercise has no
  // shadow card to project into — and with the submit disabled: there is no
  // attempt behind a preview to record an answer against.
  return `<section class="exercise" data-component="${escapeHtml(node.render.component)}" data-component-version="${escapeHtml(node.render.componentVersion)}" data-exercise-id="${escapeHtml(node.exerciseId)}" data-exercise-kind="${escapeHtml(node.exerciseKind)}"${revisionAttribute}>
        <fieldset class="exercise-group">
          ${legend}
          <div class="exercise-prompt">${node.publicData.promptHtml}</div>
          <label for="${escapeHtml(fieldId)}">${escapeHtml(i18n.t("Answer"))}</label>
          <input disabled id="${escapeHtml(fieldId)}">
        </fieldset>
        ${previewExerciseActionsHtml(i18n, false)}
      </section>`;
}
