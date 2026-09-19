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
  // Unique per document, and safe as an id: `EXERCISE_ID_PATTERN` admits
  // anything HTML admits as an id, which is what `for` matches against —
  // exactly, with no escaping — and refuses the whitespace that would keep the
  // two from ever pairing. Associated by `for`/`id` rather than by nesting, so
  // the label and the control are siblings the layout can place independently
  // — and so the field's accessible name never depends on what else the label
  // wraps.
  const fieldId = `${node.exerciseId}-answer`;
  // With an action bar this is a student's form, and the field is the answer
  // the runtime reads (`name="text"`, the one native field it knows). Without
  // one it is a preview or a saved revision, and the field is inert: there is
  // no attempt behind it to record an answer against. Either way the closing
  // row sits unslotted — a text exercise has no shadow card to project into.
  const field = context.actions === undefined ? " disabled" : ' name="text"';
  return `<section${rootAttributes}>
        <fieldset class="exercise-group">
          ${legend}
          <div class="exercise-prompt">${node.publicData.promptHtml}</div>
          <label for="${escapeHtml(fieldId)}">${escapeHtml(i18n.t("Answer"))}</label>
          <input${field} id="${escapeHtml(fieldId)}">
        </fieldset>
        ${context.actions ?? previewExerciseActionsHtml(i18n, false)}
      </section>`;
}
