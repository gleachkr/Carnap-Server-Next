import type {
  FreeResponsePublicData,
  MultipleChoicePublicData,
  ShortAnswerPublicData,
} from "../../domain/content";
import type { JsonValue } from "../../domain/json";

/**
 * Shared helpers for the no-submission exercise renderers (the previews:
 * `submission === null`). A leaf module the per-type `read-only-view.ts` files
 * depend on.
 */

/**
 * The one rule that hides an element from sight while leaving it in the
 * accessibility tree. The page stylesheet has its own copy for light DOM
 * (`.visually-hidden` in `web/styles.ts`); shadow roots inherit no page CSS, so
 * every widget that hides a name or a verdict has to carry the rule itself. This
 * is that copy — one constant rather than the per-widget duplicates it replaces,
 * because a *slightly* wrong version of this (a `display: none` say) silently
 * takes the text out of the a11y tree too.
 */
export const VISUALLY_HIDDEN_STYLES = `
  .visually-hidden {
    border: 0;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    height: 1px;
    margin: -1px;
    overflow: hidden;
    padding: 0;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }
`;

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
