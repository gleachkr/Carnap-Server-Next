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
