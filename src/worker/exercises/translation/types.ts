/**
 * Constants and data shapes for the translation exercise type. DOM-free; the
 * logic core, authoring, assessment, view, and client element all share it.
 */

import type { TranslationTest } from "./logic/tests";

export const TRANSLATION_KIND = "translation@1";
export const TRANSLATION_SCHEMA_VERSION = 1;
export const TRANSLATION_ANSWER_KIND = "translation-answer@1";
export const TRANSLATION_COMPONENT_METADATA = {
  assetId: "carnap-translation-v1",
  clientModule: true,
  component: "carnap-translation",
  componentVersion: "1",
} as const;

/**
 * The task shape, following Carnap's three `Translate` classes:
 *   - `prop`        Carnap `.Prop`: a propositional symbolization, judged up
 *                   to logical equivalence; the default.
 *   - `first-order` Carnap `.FOL`: a first-order symbolization, judged up to
 *                   equivalence as far as the rewrite theory reaches.
 *   - `exact`       Carnap `.Exact`: the submission must *be* one of the
 *                   solutions, compared as parsed formulas — for "what is the
 *                   missing premise" exercises, where an equivalent formula is
 *                   not an answer.
 */
export type TranslationVariant = "prop" | "first-order" | "exact";

export interface TranslationPublicData {
  /**
   * Whether an exam answer must parse before the client will submit it —
   * Carnap's `checksyntax`. Grading is unaffected: an unparseable submission
   * that arrives anyway is simply wrong.
   */
  readonly checksyntax: boolean;
  /** The id of the notation system the formulas are written in. */
  readonly dialect: string;
  readonly promptHtml: string;
  /**
   * The admissible solutions, in canonical source. Public of necessity: the
   * client proves equivalence *to a solution*, so it must hold them — the
   * same exposure the original Carnap accepted. `feedback`/`exam` remain
   * display and recording controls, not a wall around the key.
   */
  readonly solutions: readonly string[];
  /** Prefilled input text (Carnap's partial solution). May be prose. */
  readonly starter?: string;
  /** Extra conditions on the submission, from the `tests=` attribute. */
  readonly tests: readonly TranslationTest[];
  readonly variant: TranslationVariant;
}

/**
 * A submitted translation: the text as typed, plus — when the widget's check
 * found one — the equivalence certificate and which solution it certifies
 * against. The certificate is the graded input for the equivalence variants;
 * the text is what review pages show, and all `exact` needs.
 */
export interface TranslationAnswerData {
  /** Base64 MMB certifying `text ↔ solutions[solutionIndex]`. */
  readonly mmb?: string;
  readonly solutionIndex?: number;
  readonly text: string;
}

export function isTranslationPublicData(
  value: unknown,
): value is TranslationPublicData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const data = value as Partial<TranslationPublicData>;

  return (
    typeof data.checksyntax === "boolean" &&
    typeof data.dialect === "string" &&
    typeof data.promptHtml === "string" &&
    Array.isArray(data.solutions) &&
    data.solutions.every((entry) => typeof entry === "string") &&
    (data.starter === undefined || typeof data.starter === "string") &&
    Array.isArray(data.tests) &&
    data.tests.every(isTranslationTest) &&
    (data.variant === "prop" ||
      data.variant === "first-order" ||
      data.variant === "exact")
  );
}

function isTranslationTest(value: unknown): value is TranslationTest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const test = value as Partial<TranslationTest> & {
    readonly kind?: unknown;
  };

  if (test.kind === "cnf" || test.kind === "dnf" || test.kind === "pnf") {
    return true;
  }

  return (
    test.kind === "count" &&
    "feature" in test &&
    typeof test.feature === "string" &&
    "max" in test &&
    typeof test.max === "number"
  );
}

export function isTranslationAnswerData(
  value: unknown,
): value is TranslationAnswerData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const data = value as Partial<TranslationAnswerData>;

  return (
    typeof data.text === "string" &&
    (data.mmb === undefined || typeof data.mmb === "string") &&
    (data.solutionIndex === undefined ||
      (typeof data.solutionIndex === "number" &&
        Number.isInteger(data.solutionIndex) &&
        data.solutionIndex >= 0))
  );
}
