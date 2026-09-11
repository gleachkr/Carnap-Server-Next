import type {
  FreeResponsePublicData,
  MultipleChoicePublicData,
  ShortAnswerPublicData,
} from "../../domain/content";
import type { JsonValue } from "../../domain/json";
import visuallyHiddenStyles from "./visually-hidden.css" with {
  type: "text",
};

/**
 * Shared helpers for the no-submission exercise renderers (the previews:
 * `submission === null`). A leaf module the per-type `read-only-view.ts` files
 * depend on.
 */

export const VISUALLY_HIDDEN_STYLES = visuallyHiddenStyles;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function contentRevisionAttribute(contentRevisionId?: string): string {
  if (contentRevisionId === undefined) {
    return "";
  }

  return ` data-content-revision-id="${escapeHtml(contentRevisionId)}"`;
}

/**
 * What every exercise type's renderer needs to put on its root element: the
 * identity the runtime and the tests find a widget by, and the revision it was
 * rendered from. Each type extends this with the things only its own markup
 * uses — the translator and the author's title.
 */
export interface ExerciseElementMeta {
  readonly component: string;
  readonly componentVersion: string;
  readonly contentRevisionId?: string | undefined;
  readonly exerciseId: string;
  readonly exerciseKind: string;
}

/**
 * The attributes that make an element *the exercise*, opening tag onward — for
 * a `<section>` in the two text kinds and a `<carnap-…>` custom element in the
 * other eight.
 *
 * One function rather than the same five attributes written out per type,
 * because `class="exercise"` is among them and a type that forgets it renders
 * an exercise with no space around it: the class is what `content.css` styles
 * an exercise's box by, and for a long time only the two `<section>` kinds
 * carried it. Interactively the element is nested inside a `<form class=
 * "exercise">` (see `ExerciseFormShell`), which is why the stylesheet has to
 * say that only the outer box is spaced.
 */
export function exerciseRootAttributes(meta: ExerciseElementMeta): string {
  return ` class="exercise" data-component="${escapeHtml(meta.component)}" data-component-version="${escapeHtml(meta.componentVersion)}" data-exercise-id="${escapeHtml(meta.exerciseId)}" data-exercise-kind="${escapeHtml(meta.exerciseKind)}"${contentRevisionAttribute(meta.contentRevisionId)}`;
}

function isObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasPromptHtml(
  value: JsonValue,
): value is JsonValue & (FreeResponsePublicData | ShortAnswerPublicData) {
  return isObject(value) && typeof value.promptHtml === "string";
}

export function isMultipleChoicePublicData(
  value: JsonValue,
): value is JsonValue & MultipleChoicePublicData {
  if (!isObject(value)) {
    return false;
  }

  const options = value.options;

  return (
    (value.mode === "single" || value.mode === "multiple") &&
    typeof value.promptHtml === "string" &&
    Array.isArray(options) &&
    options.every(
      (option) =>
        isObject(option) &&
        typeof option.id === "string" &&
        typeof option.html === "string",
    )
  );
}
