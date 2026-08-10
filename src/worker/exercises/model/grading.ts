/**
 * Turning stored exercise data back into something the logic core can judge.
 *
 * The field list is **derived**, not stored: it follows from the formulas, so
 * keeping a copy in `publicData` would only be a second thing that could drift.
 * This is the same choice `truth-table/grading.ts` makes with `resolveTable`,
 * and the parse it costs is a handful of formulas.
 *
 * DOM-free and free of i18n, because the client element resolves the same public
 * data to run its local Check.
 */

import type {
  FirstOrderDialect,
  Formula,
  ModelField,
  ModelTarget,
  ModelTask,
} from "./logic";
import {
  DOMAIN_FIELD_LABEL,
  dialectById,
  modelSignature,
  parseFormula,
} from "./logic";
import type { ModelAnswerData, ModelPublicData, ModelVariant } from "./types";

/** A resolved exercise: its dialect, its parsed formulas, and its field list. */
export interface ResolvedModel {
  readonly dialect: FirstOrderDialect;
  readonly signature: readonly ModelField[];
  readonly task: ModelTask;
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isTarget(value: unknown): value is ModelTarget {
  return (
    value === "all-true" || value === "all-false" || value === "not-all-equal"
  );
}

function isVariant(value: unknown): value is ModelVariant {
  return value === "simple" || value === "validity" || value === "constraint";
}

export function isModelPublicData(value: unknown): value is ModelPublicData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const data = value as Partial<ModelPublicData>;

  return (
    typeof data.dialect === "string" &&
    typeof data.promptHtml === "string" &&
    isStringArray(data.required) &&
    isStringArray(data.targeted) &&
    isTarget(data.target) &&
    isVariant(data.variant) &&
    typeof data.options === "object" &&
    data.options !== null
  );
}

export function isModelAnswerData(value: unknown): value is ModelAnswerData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const data = value as Partial<ModelAnswerData>;

  if (typeof data.domain !== "string") {
    return false;
  }

  if (typeof data.fields !== "object" || data.fields === null) {
    return false;
  }

  return Object.values(data.fields).every(
    (entry) => typeof entry === "string",
  );
}

/**
 * Parse the stored formulas and work out which fields they ask for.
 *
 * `null` when the stored data no longer resolves — an unknown dialect id, or a
 * formula that will not parse. Neither can happen for data this compiler wrote;
 * both are how a revision authored against a future version fails safely rather
 * than being graded against half a signature.
 */
export function resolveModel(
  publicData: ModelPublicData,
): ResolvedModel | null {
  const dialect = dialectById(publicData.dialect);

  if (dialect === null) {
    return null;
  }

  const parseAll = (sources: readonly string[]): Formula[] | null => {
    const formulas: Formula[] = [];

    for (const source of sources) {
      const parsed = parseFormula(source, dialect);

      if (!parsed.ok) {
        return null;
      }

      formulas.push(parsed.formula);
    }

    return formulas;
  };

  const required = parseAll(publicData.required);
  const targeted = parseAll(publicData.targeted);

  if (required === null || targeted === null || targeted.length === 0) {
    return null;
  }

  return {
    dialect,
    signature: modelSignature([...required, ...targeted]),
    task: { required, target: publicData.target, targeted },
  };
}

/**
 * The seeded value for a field, or `""`.
 *
 * A locked given (`strictGivens`) is a requirement rather than a hint, so
 * grading substitutes it for whatever arrived: the field renders inert, and an
 * answer that disagrees with it has been tampered with rather than worked. The
 * original crashes the widget in that case (`Prelude.error "input not equal to
 * given"`); ignoring the submitted value grades the exercise that was set.
 */
export function givenFor(
  publicData: ModelPublicData,
  label: string,
): string | null {
  return publicData.givens?.[label] ?? null;
}

/**
 * The model to grade: the student's fields, with any locked given put back.
 */
export function effectiveAnswer(
  publicData: ModelPublicData,
  answer: ModelAnswerData,
): ModelAnswerData {
  if (!publicData.options.strictGivens || publicData.givens === undefined) {
    return answer;
  }

  const givens = publicData.givens;
  const fields = { ...answer.fields };

  for (const [label, value] of Object.entries(givens)) {
    if (label !== DOMAIN_FIELD_LABEL) {
      fields[label] = value;
    }
  }

  return { domain: givens[DOMAIN_FIELD_LABEL] ?? answer.domain, fields };
}
