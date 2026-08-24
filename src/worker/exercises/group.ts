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
import groupStyles from "./group.css" with { type: "text" };
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

export const EXERCISE_GROUP_STYLES = groupStyles;

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
