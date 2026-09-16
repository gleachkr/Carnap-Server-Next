import {
  escapeHtml,
  VISUALLY_HIDDEN_STYLES,
} from "../application/content/render-support";
import groupStyles from "./group.css" with { type: "text" };

/**
 * Every exercise, of every kind, is one named group: a `<fieldset>` whose
 * `<legend>` is the author's title. Assistive technology announces the group name
 * on entering the controls, which is what tells a reader working through a lesson
 * *which* exercise the field in front of them belongs to — otherwise a page of a
 * dozen exercises is a dozen fields all called "Answer".
 *
 * Dependency-free apart from `escapeHtml`, because the per-type
 * `read-only-view.ts` files reach this module and they are compiled into the
 * browser preview bundle. It does not know the types: the generic name for an
 * untitled group is the type's own `name(i18n)`, which each renderer passes in.
 */

export interface ExerciseGroupLabel {
  /** The legend's text. */
  readonly text: string;
  /** Whether to hide it from sight (true when it is the generic kind name). */
  readonly hidden: boolean;
}

/**
 * The name for one exercise group: the author's title when there is one, and
 * otherwise the generic kind name (`ExerciseType.name`), hidden from sight.
 *
 * The fallback is deliberately *not* the exercise id. An id is an authoring
 * handle — `tt_affirming`, `ex_3` — and printing it as a heading is worse than
 * printing nothing. But a group with no name at all is no group as far as
 * assistive technology is concerned, so an untitled exercise still gets a name;
 * it is just one only a screen reader hears, leaving the page visually unchanged.
 */
export function exerciseGroupLabel(
  kindName: string,
  title: string | null | undefined,
): ExerciseGroupLabel {
  const authored = title?.trim() ?? "";

  return authored.length > 0
    ? { hidden: false, text: authored }
    : { hidden: true, text: kindName };
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
