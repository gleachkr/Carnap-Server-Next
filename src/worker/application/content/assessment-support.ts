import type {
  ExerciseAnswerReview,
  ExerciseDiagnostic,
  NormalizedAnswer,
} from "../../domain/content";
import type { JsonValue } from "../../domain/json";
import type { Translator } from "../../i18n/translator";

/**
 * Shared, DOM-free assessment helpers used by the per-type exercise classes in
 * `src/worker/exercises/<type>/assessment.ts`. A leaf module: it must not
 * depend on the registry or any per-type class.
 */

export function diagnostic(
  code: string,
  message: string,
  path?: readonly (number | string)[],
): ExerciseDiagnostic {
  if (path === undefined) {
    return { code, message };
  }

  return { code, message, path };
}

export function sameSet(
  first: readonly string[],
  second: readonly string[],
): boolean {
  if (first.length !== second.length) {
    return false;
  }

  const values = new Set(first);

  return second.every((value) => values.has(value));
}

export function isObject(
  value: JsonValue,
): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringArray(value: JsonValue): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function isTextAnswerData(
  value: JsonValue,
): value is { text: string } {
  return isObject(value) && typeof value.text === "string";
}

export function normalizeText(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function textAnswerReview(
  answer: NormalizedAnswer,
  i18n: Translator,
): ExerciseAnswerReview {
  const data = answer.data;
  const text = isTextAnswerData(data) ? data.text : "";

  return {
    details: [{ label: i18n.t("Response"), value: text }],
    summary: text.length === 0 ? i18n.t("Empty response") : text,
  };
}

export function htmlToText(value: string): string {
  return value
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll(/\s+/g, " ")
    .trim();
}
