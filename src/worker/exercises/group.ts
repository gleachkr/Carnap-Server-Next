import {
  escapeHtml,
  VISUALLY_HIDDEN_STYLES,
} from "../application/content/render-support";
import type { ExerciseKind } from "../domain/exercises";
import type { Translator } from "../i18n/translator";
import { AUFBAU_PROOF_KIND } from "./aufbau-proof/types";
import { AUFBAU_PROOF_FITCH_KIND } from "./aufbau-proof-fitch/types";
import { AUFBAU_PROOF_PRAWITZ_KIND } from "./aufbau-proof-prawitz/types";
import { AUFBAU_PROOF_TREE_KIND } from "./aufbau-proof-tree/types";
import { FREE_RESPONSE_KIND } from "./free-response/types";
import { MODEL_KIND } from "./model/types";
import { MULTIPLE_CHOICE_KIND } from "./multiple-choice/types";
import { SHORT_ANSWER_KIND } from "./short-answer/types";
import { TRUTH_TABLE_KIND } from "./truth-table/types";

/**
 * Every exercise, of every kind, is one named group: a `<fieldset>` whose
 * `<legend>` is the author's title. Assistive technology announces the group name
 * on entering the controls, which is what tells a reader working through a lesson
 * *which* exercise the field in front of them belongs to — otherwise a page of a
 * dozen exercises is a dozen fields all called "Answer".
 *
 * Dependency-free apart from the {@link Translator} type and `escapeHtml`, because
 * the per-type `read-only-view.ts` files reach this module and they are compiled
 * into the browser preview bundle.
 */

/**
 * What a kind of exercise is called when its author gave it no title. Never
 * shown to sighted readers (see {@link exerciseGroupLabel}), so it names the kind
 * rather than the task: "Truth table", not "Fill in the truth table".
 *
 * The literals sit at the `i18n.t(...)` call sites because Lingui's extractor
 * reads string literals passed to a receiver *named* `i18n` — a lookup table of
 * bare strings would be silently absent from the catalog.
 */
export function exerciseKindName(
  kind: ExerciseKind,
  i18n: Translator,
): string {
  switch (kind) {
    case MULTIPLE_CHOICE_KIND:
      return i18n.t("Multiple-choice question");
    case SHORT_ANSWER_KIND:
      return i18n.t("Short-answer question");
    case FREE_RESPONSE_KIND:
      return i18n.t("Free-response question");
    case TRUTH_TABLE_KIND:
      return i18n.t("Truth table");
    case MODEL_KIND:
      return i18n.t("Model");
    case AUFBAU_PROOF_KIND:
      return i18n.t("Proof");
    case AUFBAU_PROOF_TREE_KIND:
      return i18n.t("Proof tree");
    case AUFBAU_PROOF_FITCH_KIND:
      return i18n.t("Fitch proof");
    case AUFBAU_PROOF_PRAWITZ_KIND:
      return i18n.t("Prawitz proof");
    default:
      return i18n.t("Exercise");
  }
}

export interface ExerciseGroupLabel {
  /** The legend's text. */
  readonly text: string;
  /** Whether to hide it from sight (true when it is the generic kind name). */
  readonly hidden: boolean;
}

/**
 * The name for one exercise group: the author's title when there is one, and
 * otherwise the generic kind name, hidden from sight.
 *
 * The fallback is deliberately *not* the exercise id. An id is an authoring
 * handle — `tt_affirming`, `ex_3` — and printing it as a heading is worse than
 * printing nothing. But a group with no name at all is no group as far as
 * assistive technology is concerned, so an untitled exercise still gets a name;
 * it is just one only a screen reader hears, leaving the page visually unchanged.
 */
export function exerciseGroupLabel(
  kind: ExerciseKind,
  title: string | null | undefined,
  i18n: Translator,
): ExerciseGroupLabel {
  const authored = title?.trim() ?? "";

  return authored.length > 0
    ? { hidden: false, text: authored }
    : { hidden: true, text: exerciseKindName(kind, i18n) };
}

/** {@link exerciseGroupLabel} as markup, for the string-building renderers. */
export function exerciseLegendHtml(label: ExerciseGroupLabel): string {
  const className = label.hidden
    ? "exercise-legend visually-hidden"
    : "exercise-legend";

  return `<legend class="${className}">${escapeHtml(label.text)}</legend>`;
}

/**
 * Shared look for the group and its legend, in a form both the page stylesheet
 * and the widgets' shadow roots can use — a shadow root inherits no page CSS, so
 * without one constant the same legend drifts into six slightly different labels.
 *
 * The fieldset itself is reset to nothing: a border around a truth table or a
 * CodeMirror editor reads as a second card inside the card, and the exercise is
 * already separated from its neighbours by `.exercise`'s margins. Palette tokens
 * carry literal fallbacks because the shadow roots of a preview iframe may resolve
 * them against a document that never set them.
 */
export const EXERCISE_GROUP_STYLES = `
  .exercise-group {
    border: 0;
    margin: 0;
    min-inline-size: 0;
    padding: 0;
  }

  .exercise-legend {
    color: var(--ink-muted, #5f7388);
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    margin-bottom: 0.55rem;
    padding: 0;
    text-transform: uppercase;
  }

  /* A visible title runs in with the prompt's first line rather than sitting on a
     line of its own. \`float\` is what makes that possible at all: an unfloated
     \`<legend>\` is the fieldset's *rendered legend*, which the browser lifts out of
     the flow, so no value of \`display\` will put it beside the prompt. Two
     corollaries, both load-bearing:

     - a group that wants the run-in title cannot be a grid or flex container,
       since floats do not apply to those items (see \`.tt-wrap\`);
     - the padding is a baseline nudge — a float aligns by its top edge, and the
       small caps would otherwise ride above the prompt's much larger text. */
  /* The run-in title lives on a height budget: a float excludes text by its
     *margin* box, so that box has to stay shorter than one line of the prompt
     (1.5rem = 24px at the default size). Overshoot it and the prompt's *second*
     line clips the float and comes out indented — a ragged left edge that appears
     and vanishes with the font size. Line-height 1.15 plus the baseline padding
     spends 20px of the 24, and there is deliberately no bottom margin: 0.35rem
     there was enough to break it. Both texts are sized in rem, so the budget
     scales with the root font size rather than drifting against it. */
  .exercise-legend:not(.visually-hidden) {
    float: left;
    line-height: 1.15;
    margin-bottom: 0;
    margin-right: 0.6rem;
    /* Sits the small caps on the prompt's baseline. A float aligns by its top
       edge, and the two texts differ in size, so the nudge is the difference
       between their baseline positions within their own line boxes — measured
       (0.1px residual), not derived: no CSS length expresses "one font's ascent
       minus another's". */
    padding-top: 0.4rem;
  }

  /* Whatever follows the prompt begins on a fresh line. A float only pushes
     *inline* content aside, so a block sibling — the grid, an editor, the action
     bar — would slide under a title taller than the prompt beside it. Two
     selectors for the two shapes the prompt takes: a named slot in the widgets'
     shadow roots, a light-DOM div in the text kinds. */
  .exercise-group > slot[name="prompt"] ~ *,
  .exercise-group > .exercise-prompt ~ * {
    clear: left;
  }
`;

/**
 * {@link EXERCISE_GROUP_STYLES} for a widget's **shadow root**, which inherits no
 * page CSS: it ships the rule that hides the generic legend alongside the group
 * itself, so a widget cannot render the group without the means to hide its name.
 *
 * That coupling is the fix for a shipped bug — the three proof widgets
 * interpolated the group styles alone, so every *untitled* proof printed "PROOF" /
 * "PROOF TREE" / "FITCH PROOF" above its editor: `visually-hidden` with nothing in
 * the root to act on it. `tests/exercise-contract.test.ts` now checks every shadow
 * root that emits the class also carries the rule.
 *
 * The page stylesheet keeps its own independent `.visually-hidden` (used app-wide),
 * so `EXERCISE_GROUP_STYLES` stays free of it there.
 */
export const EXERCISE_GROUP_SHADOW_STYLES = `${VISUALLY_HIDDEN_STYLES}
${EXERCISE_GROUP_STYLES}`;
