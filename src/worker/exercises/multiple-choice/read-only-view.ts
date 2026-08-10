import {
  contentRevisionAttribute,
  escapeHtml,
  isMultipleChoicePublicData,
  VISUALLY_HIDDEN_STYLES,
} from "../../application/content/render-support";
import type { ExerciseRenderContext } from "../../application/content/renderer";
import type {
  ContentNode,
  MultipleChoicePublicData,
} from "../../domain/content";
import type { Translator } from "../../i18n/translator";
import { previewExerciseActionsHtml } from "../actions";
import {
  EXERCISE_GROUP_SHADOW_STYLES,
  exerciseGroupLabel,
  exerciseLegendHtml,
} from "../group";
import { MULTIPLE_CHOICE_KIND } from "./types";

/**
 * Shadow-DOM chrome styles for the multiple-choice element, server-rendered
 * into its Declarative Shadow Root. The shadow boundary isolates them so author
 * `:::style` CSS cannot reach the chrome; the prompt and option labels are
 * slotted from light DOM, so author CSS and the document's math font still
 * reach
 * them. Custom properties (e.g. `--blue-strong`) inherit across the boundary, so
 * palette tokens resolve to the content document's values.
 */
const MULTIPLE_CHOICE_SHADOW_STYLES = `
  ${EXERCISE_GROUP_SHADOW_STYLES}

  .mc-options {
    display: grid;
    gap: 0.5rem;
  }

  .mc-option {
    align-items: center;
    display: flex;
    font-weight: 460;
    gap: 0.5rem;
  }

  .mc-input {
    margin: 0;
    width: auto;
  }

  /* The element marks the chosen option once it enhances. */
  .mc-option[data-selected] {
    color: var(--blue-strong);
    font-weight: 600;
  }
`;

/**
 * The option labels as light-DOM slotted spans. Kept in light DOM (not the
 * shadow root) so author CSS and the document's math font still reach the option
 * markup. Shared by the answer and review renderers.
 */
function slottedOptionLabels(
  options: MultipleChoicePublicData["options"],
): string {
  return options
    .map(
      (option) =>
        `<span slot="label-${escapeHtml(option.id)}">${option.html}</span>`,
    )
    .join("");
}

interface MultipleChoiceElementMeta {
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
 * The multiple-choice custom element with its Declarative Shadow Root. The SSR
 * markup is inert (inputs disabled, `aria-busy`) and correctly styled with no
 * JS. On the interactive path the element upgrades in place — enabling the
 * controls, wiring listeners, and restoring the prior answer. The preview paths
 * reuse this exact markup and upgrade it too: their document carries the
 * hydration table but no form, so the options are live and unsubmittable.
 */
export function renderMultipleChoiceElement(
  publicData: MultipleChoicePublicData,
  meta: MultipleChoiceElementMeta,
  actions = "",
): string {
  const inputType = publicData.mode === "single" ? "radio" : "checkbox";
  const legend = exerciseLegendHtml(
    exerciseGroupLabel(meta.exerciseKind, meta.title, meta.i18n),
  );
  // Associated by `for`/`id` with the input as the label's *sibling*, so the
  // option's accessible name is exactly the authored prose and the row's layout
  // is free of the DOM nesting. Ids inside a shadow root are scoped to that root,
  // so these cannot collide with anything on the page.
  const controls = publicData.options
    .map((option) => {
      const optionId = `mc-option-${escapeHtml(option.id)}`;

      return `<div class="mc-option">
            <input class="mc-input" disabled id="${optionId}" name="mc-choice" type="${inputType}" value="${escapeHtml(option.id)}">
            <label class="mc-label" for="${optionId}"><slot name="label-${escapeHtml(option.id)}"></slot></label>
          </div>`;
    })
    .join("");
  const labels = slottedOptionLabels(publicData.options);

  return `<carnap-multiple-choice data-component="${escapeHtml(meta.component)}" data-component-version="${escapeHtml(meta.componentVersion)}" data-exercise-id="${escapeHtml(meta.exerciseId)}" data-exercise-kind="${escapeHtml(meta.exerciseKind)}"${contentRevisionAttribute(meta.contentRevisionId)}>
        <template shadowrootmode="open">
          <style>${MULTIPLE_CHOICE_SHADOW_STYLES}</style>
          <fieldset aria-busy="true" class="exercise-group mc">
            ${legend}
            <slot name="prompt"></slot>
            <div class="mc-options">${controls}</div>
            <slot name="exercise-actions"></slot>
          </fieldset>
        </template>
        <div class="exercise-prompt" slot="prompt">${publicData.promptHtml}</div>
        ${labels}
        ${actions}
      </carnap-multiple-choice>`;
}

/**
 * Shadow-DOM styles for the multiple-choice `review` widget. Marks colour only
 * the glyph; the option text is muted unless the student chose it. The state
 * words are visually hidden but read by assistive tech.
 */
const MULTIPLE_CHOICE_REVIEW_STYLES = `
  ${VISUALLY_HIDDEN_STYLES}

  .mc-review {
    display: grid;
    gap: 0.5rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* The review list renders on the submission card's --surface-soft fill, which
     is one of the warm ones plain --ink-muted misses AA on (4.39:1). */
  .mc-review-option {
    align-items: baseline;
    color: var(--ink-muted-strong, #4d5f72);
    display: flex;
    gap: 0.5rem;
  }

  .mc-review-option[data-selected] {
    color: inherit;
    font-weight: 600;
  }

  .mc-review-mark {
    flex: none;
    font-weight: 700;
    min-width: 1.1rem;
    text-align: center;
  }

  .mc-review-option[data-correct] .mc-review-mark {
    color: var(--green, #1b7048);
  }

  .mc-review-option[data-incorrect] .mc-review-mark {
    color: var(--red, #b42318);
  }

`;

interface MultipleChoiceReview {
  /** The correct option ids, or null to withhold the key (student audience). */
  readonly correctOptionIds: readonly string[] | null;
  readonly exerciseId: string;
  readonly selectedOptionIds: readonly string[];
}

/**
 * The mark, the styling hook, and the state named in words. The glyph is
 * `aria-hidden`, so this sentence is the only thing that tells a screen-reader
 * user which option was chosen and whether it was right — it has to be
 * translated, not just the visible prose.
 */
function reviewOptionState(
  selected: boolean,
  correct: boolean | null,
  i18n: Translator,
): { readonly attrs: string; readonly mark: string; readonly state: string } {
  if (correct === null) {
    return selected
      ? { attrs: " data-selected", mark: "●", state: i18n.t("Your answer") }
      : { attrs: "", mark: "○", state: "" };
  }

  if (selected && correct) {
    return {
      attrs: " data-selected data-correct",
      mark: "✓",
      state: i18n.t("Correct — your answer"),
    };
  }

  if (selected) {
    return {
      attrs: " data-selected data-incorrect",
      mark: "✗",
      state: i18n.t("Incorrect — your answer"),
    };
  }

  if (correct) {
    return {
      attrs: " data-correct",
      mark: "✓",
      state: i18n.t("Correct answer"),
    };
  }

  return { attrs: "", mark: "○", state: "" };
}

/**
 * The multiple-choice element in `review` mode: a read-only, shadow-isolated
 * widget showing each option with the student's choice and (for instructors)
 * which was correct. Because the Declarative Shadow Root attaches at parse time
 * — no JS needed — it renders inline on the review and results pages without an
 * iframe and cannot be reached by author CSS.
 */
export function renderMultipleChoiceReview(
  publicData: MultipleChoicePublicData,
  review: MultipleChoiceReview,
  i18n: Translator,
): string {
  const selected = new Set(review.selectedOptionIds);
  const correct =
    review.correctOptionIds === null
      ? null
      : new Set(review.correctOptionIds);
  const rows = publicData.options
    .map((option) => {
      const { attrs, mark, state } = reviewOptionState(
        selected.has(option.id),
        correct === null ? null : correct.has(option.id),
        i18n,
      );
      const stateSpan =
        state === ""
          ? ""
          : `<span class="visually-hidden">${escapeHtml(state)}</span>`;

      return `<li class="mc-review-option"${attrs}>
            <span aria-hidden="true" class="mc-review-mark">${mark}</span>
            <span class="mc-review-label"><slot name="label-${escapeHtml(option.id)}"></slot>${stateSpan}</span>
          </li>`;
    })
    .join("");
  const labels = slottedOptionLabels(publicData.options);

  return `<carnap-multiple-choice data-exercise-id="${escapeHtml(review.exerciseId)}" data-review>
        <template shadowrootmode="open">
          <style>${MULTIPLE_CHOICE_REVIEW_STYLES}</style>
          <ul class="mc-review">${rows}</ul>
        </template>
        ${labels}
      </carnap-multiple-choice>`;
}

export function renderMultipleChoice(
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  context: ExerciseRenderContext,
): string {
  if (
    node.exerciseKind !== MULTIPLE_CHOICE_KIND ||
    !isMultipleChoicePublicData(node.publicData)
  ) {
    return `<div data-component="${escapeHtml(node.render.component)}" data-exercise-id="${escapeHtml(node.exerciseId)}"></div>`;
  }

  return renderMultipleChoiceElement(
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
