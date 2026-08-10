import {
  diagnostic,
  isObject,
} from "../../application/content/assessment-support";
import type { AssessmentExerciseType } from "../../application/content/registry";
import type {
  AnswerEnvelope,
  AnswerNormalizationResult,
  AutomaticEvaluation,
  AutomaticEvaluationStatus,
  EvaluationContext,
  ExerciseAnswerReview,
  ExerciseManifestItem,
  ExerciseReviewContext,
  NormalizedAnswer,
} from "../../domain/content";
import type { JsonValue } from "../../domain/json";
import {
  gradeTruthTable,
  isTruthTableAnswerData,
  isTruthTablePublicData,
  resolveTable,
  truthTableScoreFraction,
} from "./grading";
import { renderTruthTableReview } from "./read-only-view";
import { buildTruthTableStrings } from "./strings";
import type { TruthTableAnswerData } from "./types";
import {
  TRUTH_TABLE_ANSWER_KIND,
  TRUTH_TABLE_COMPONENT_METADATA,
  TRUTH_TABLE_KIND,
  TRUTH_TABLE_SCHEMA_VERSION,
} from "./types";

const TRUTH_TABLE_EVALUATOR_VERSION = "truth-table-evaluator@1";

function truthTableAnswerData(
  answer: NormalizedAnswer,
): TruthTableAnswerData {
  return answer.data as unknown as TruthTableAnswerData;
}

/**
 * Confirm the submitted grid has exactly the dimensions the public formulas
 * imply, so evaluation and review can index it positionally without surprises.
 */
function hasExpectedDimensions(
  answer: TruthTableAnswerData,
  declaration: ExerciseManifestItem,
): boolean {
  if (!isTruthTablePublicData(declaration.publicData)) {
    return false;
  }

  const table = resolveTable(declaration.publicData.formulas);

  if (table === null) {
    return false;
  }

  // A partial table is a single free row, whatever the atom count; every other
  // variant fills all 2ⁿ valuations.
  const rows =
    declaration.publicData.variant === "partial"
      ? 1
      : table.valuations.length;

  // A validity table carries a turnstile column: one mark per row.
  if (
    declaration.publicData.variant === "validity" &&
    (answer.validity === undefined || answer.validity.length !== rows)
  ) {
    return false;
  }

  // A designated counterexample row must index an actual row.
  if (
    answer.counterexample !== undefined &&
    answer.counterexample !== null &&
    (answer.counterexample < 0 || answer.counterexample >= rows)
  ) {
    return false;
  }

  if (answer.reference.length !== rows) {
    return false;
  }

  if (answer.reference.some((row) => row.length !== table.atoms.length)) {
    return false;
  }

  if (answer.cells.length !== table.formulas.length) {
    return false;
  }

  return table.formulas.every((formula, index) => {
    const grid = answer.cells[index];
    return (
      grid !== undefined &&
      grid.length === rows &&
      grid.every((row) => row.length === formula.cells.length)
    );
  });
}

export class TruthTableExerciseType implements AssessmentExerciseType {
  readonly answerKind = TRUTH_TABLE_ANSWER_KIND;
  readonly capabilities = {
    supportsAutomaticEvaluation: true,
    supportsManualReview: true,
  };
  readonly component = {
    ...TRUTH_TABLE_COMPONENT_METADATA,
    capabilities: this.capabilities,
  };
  readonly kind = TRUTH_TABLE_KIND;
  readonly schemaVersion = TRUTH_TABLE_SCHEMA_VERSION;

  normalizeAnswer(
    envelope: AnswerEnvelope,
    declaration: ExerciseManifestItem,
  ): AnswerNormalizationResult {
    if (envelope.kind !== this.answerKind) {
      return {
        diagnostics: [
          diagnostic(
            "wrong_answer_kind",
            `Expected answer kind ${this.answerKind}.`,
            ["kind"],
          ),
        ],
        ok: false,
        reason: "wrong-kind",
      };
    }

    if (envelope.schemaVersion !== this.schemaVersion) {
      return {
        diagnostics: [
          diagnostic(
            "unsupported_answer_schema_version",
            "The answer schema version is not supported.",
            ["schemaVersion"],
          ),
        ],
        ok: false,
        reason: "schema-invalid",
      };
    }

    if (!isObject(envelope.data) || !isTruthTableAnswerData(envelope.data)) {
      return {
        diagnostics: [
          diagnostic(
            "malformed_answer_data",
            "A truth-table answer must be a grid of T, F, or blank cells.",
            ["data"],
          ),
        ],
        ok: false,
        reason: "malformed",
      };
    }

    if (!hasExpectedDimensions(envelope.data, declaration)) {
      return {
        diagnostics: [
          diagnostic(
            "answer_shape_mismatch",
            "The submitted table does not match the exercise's shape.",
            ["data"],
          ),
        ],
        ok: false,
        reason: "schema-invalid",
      };
    }

    return {
      answer: {
        data: {
          cells: envelope.data.cells,
          reference: envelope.data.reference,
          // Preserve the counterexample-row index only when the student actually
          // designated one, so ordinary full-table answers stay unchanged.
          ...(envelope.data.counterexample == null
            ? {}
            : { counterexample: envelope.data.counterexample }),
          // Preserve the turnstile column of a validity submission.
          ...(envelope.data.validity === undefined
            ? {}
            : { validity: envelope.data.validity }),
        } as unknown as JsonValue,
        kind: this.answerKind,
        schemaVersion: this.schemaVersion,
      },
      ok: true,
    };
  }

  async evaluate(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    _context: EvaluationContext,
  ): Promise<AutomaticEvaluation> {
    const base = {
      declarationHash: declaration.declarationHash,
      evaluatorVersion: TRUTH_TABLE_EVALUATOR_VERSION,
      kind: "automatic" as const,
      nominalMaxScore: declaration.nominalPoints,
    };

    if (!isTruthTablePublicData(declaration.publicData)) {
      return {
        ...base,
        awardedScore: 0,
        feedback: {
          diagnostics: [
            {
              code: "invalid_declaration_public_data",
            },
          ],
        },
        status: "error",
      };
    }

    const grade = gradeTruthTable(
      declaration.publicData,
      truthTableAnswerData(answer),
    );

    if (grade === null) {
      return {
        ...base,
        awardedScore: 0,
        status: "error",
      };
    }

    const fraction = truthTableScoreFraction(
      grade,
      declaration.publicData.options.grading,
    );
    const status: AutomaticEvaluationStatus = grade.allCorrect
      ? "correct"
      : // A counterexample is all-or-nothing, so never "partial".
        grade.counterexample === null &&
          grade.correctCount > 0 &&
          declaration.publicData.options.grading === "partial"
        ? "partial"
        : "incorrect";

    return {
      ...base,
      awardedScore: fraction * declaration.nominalPoints,
      feedback: {
        correctCount: grade.correctCount,
        fillableCount: grade.fillableCount,
      },
      status,
    };
  }

  reviewAnswer(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    context: ExerciseReviewContext,
  ): ExerciseAnswerReview {
    const i18n = context.i18n;
    const data = truthTableAnswerData(answer);

    if (!isTruthTablePublicData(declaration.publicData)) {
      return { summary: i18n.t("Truth table") };
    }

    const grade = gradeTruthTable(declaration.publicData, data);
    // The same sentences the widget's own Check shows, so a student who checked
    // before submitting reads the identical verdict back on the review page.
    const strings = buildTruthTableStrings(i18n);
    // A table is graded from the formulas the student can see, so this review
    // recomputes the verdict rather than reading one off a stored evaluation.
    // That is what made a sealed evaluation insufficient on its own: withhold
    // the score and the marked-up grid still said everything it said.
    const reveal = context.revealCorrectness !== false;
    const summary =
      grade === null || !reveal
        ? i18n.t("Truth table")
        : grade.counterexample !== null
          ? grade.allCorrect
            ? strings["Valid counterexample."]
            : strings["Not a valid counterexample."]
          : grade.allCorrect
            ? strings["All cells correct."]
            : i18n.t("Correct cells: {count} of {total}", {
                count: grade.correctCount,
                total: grade.fillableCount,
              });

    return {
      ...(reveal
        ? { details: [{ label: i18n.t("Result"), value: summary }] }
        : {}),
      elementHtml: renderTruthTableReview(
        declaration.publicData,
        {
          answer: data,
          exerciseId: declaration.id,
        },
        i18n,
        reveal,
      ),
      summary,
    };
  }
}
