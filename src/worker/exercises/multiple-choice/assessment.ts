import {
  diagnostic,
  htmlToText,
  isObject,
  isStringArray,
  sameSet,
} from "../../application/content/assessment-support";
import type { AssessmentExerciseType } from "../../application/content/registry";
import { isMultipleChoicePublicData } from "../../application/content/render-support";
import type {
  AnswerEnvelope,
  AnswerNormalizationResult,
  AutomaticEvaluation,
  EvaluationContext,
  ExerciseAnswerReview,
  ExerciseManifestItem,
  ExerciseReviewContext,
  NormalizedAnswer,
} from "../../domain/content";
import type { JsonValue } from "../../domain/json";
import { renderMultipleChoiceReview } from "./read-only-view";
import type {
  MultipleChoiceAnswerData,
  MultipleChoicePrivateData,
} from "./types";
import {
  MULTIPLE_CHOICE_ANSWER_KIND,
  MULTIPLE_CHOICE_COMPONENT_METADATA,
  MULTIPLE_CHOICE_KIND,
  MULTIPLE_CHOICE_SCHEMA_VERSION,
} from "./types";

const MULTIPLE_CHOICE_EVALUATOR_VERSION = "multiple-choice-evaluator@1";

function isMultipleChoicePrivateData(
  value: JsonValue,
): value is JsonValue & MultipleChoicePrivateData {
  if (!isObject(value)) {
    return false;
  }

  return (
    (value.mode === "single" || value.mode === "multiple") &&
    isStringArray(value.correctOptionIds ?? null)
  );
}

function multipleChoiceAnswerData(
  answer: NormalizedAnswer,
): MultipleChoiceAnswerData {
  return answer.data as unknown as MultipleChoiceAnswerData;
}

function optionLabels(
  declaration: ExerciseManifestItem,
  optionIds: readonly string[],
): string[] {
  if (!isMultipleChoicePublicData(declaration.publicData)) {
    return optionIds.map((id) => `Unknown option ${id}`);
  }

  const labels = new Map(
    declaration.publicData.options.map((option) => [
      option.id,
      htmlToText(option.html),
    ]),
  );

  return optionIds.map((id) => labels.get(id) ?? `Unknown option ${id}`);
}

function selectedOptionLabels(
  answer: NormalizedAnswer,
  declaration: ExerciseManifestItem,
): string[] {
  return optionLabels(
    declaration,
    multipleChoiceAnswerData(answer).selectedOptionIds,
  );
}

export class MultipleChoiceExerciseType implements AssessmentExerciseType {
  readonly answerKind = MULTIPLE_CHOICE_ANSWER_KIND;
  readonly capabilities = {
    supportsAutomaticEvaluation: true,
    supportsManualReview: true,
  };
  readonly component = {
    ...MULTIPLE_CHOICE_COMPONENT_METADATA,
    capabilities: this.capabilities,
  };
  readonly kind = MULTIPLE_CHOICE_KIND;
  readonly schemaVersion = MULTIPLE_CHOICE_SCHEMA_VERSION;

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

    if (!isObject(envelope.data)) {
      return {
        diagnostics: [
          diagnostic(
            "malformed_answer_data",
            "A multiple-choice answer data object is required.",
            ["data"],
          ),
        ],
        ok: false,
        reason: "malformed",
      };
    }

    const rawSelectedOptionIds = envelope.data.selectedOptionIds ?? null;

    if (!isStringArray(rawSelectedOptionIds)) {
      return {
        diagnostics: [
          diagnostic(
            "invalid_selected_options",
            "Selected option IDs must be strings.",
            ["data", "selectedOptionIds"],
          ),
        ],
        ok: false,
        reason: "schema-invalid",
      };
    }

    if (!isMultipleChoicePublicData(declaration.publicData)) {
      return {
        diagnostics: [
          diagnostic(
            "invalid_declaration_public_data",
            "The exercise declaration has invalid public data.",
          ),
        ],
        ok: false,
        reason: "schema-invalid",
      };
    }

    const selectedOptionIds = [...new Set(rawSelectedOptionIds)];

    if (selectedOptionIds.length !== rawSelectedOptionIds.length) {
      return {
        diagnostics: [
          diagnostic(
            "duplicate_selected_option",
            "Selected option IDs must be unique.",
            ["data", "selectedOptionIds"],
          ),
        ],
        ok: false,
        reason: "schema-invalid",
      };
    }

    if (
      declaration.publicData.mode === "single" &&
      selectedOptionIds.length > 1
    ) {
      return {
        diagnostics: [
          diagnostic(
            "too_many_selected_options",
            "Single-select answers may contain at most one option.",
            ["data", "selectedOptionIds"],
          ),
        ],
        ok: false,
        reason: "schema-invalid",
      };
    }

    const validOptionIds = new Set(
      declaration.publicData.options.map((option) => option.id),
    );
    const invalidOptionId = selectedOptionIds.find(
      (id) => !validOptionIds.has(id),
    );

    if (invalidOptionId !== undefined) {
      return {
        diagnostics: [
          diagnostic(
            "unknown_selected_option",
            `Selected option ${invalidOptionId} is not part of this exercise.`,
            ["data", "selectedOptionIds"],
          ),
        ],
        ok: false,
        reason: "schema-invalid",
      };
    }

    return {
      answer: {
        data: { selectedOptionIds },
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
    if (!isMultipleChoicePrivateData(declaration.privateData)) {
      return {
        awardedScore: 0,
        declarationHash: declaration.declarationHash,
        evaluatorVersion: MULTIPLE_CHOICE_EVALUATOR_VERSION,
        feedback: {
          diagnostics: [
            {
              code: "invalid_declaration_private_data",
            },
          ],
        },
        kind: "automatic",
        nominalMaxScore: declaration.nominalPoints,
        status: "error",
      };
    }

    const data = multipleChoiceAnswerData(answer);
    const correct = sameSet(
      data.selectedOptionIds,
      declaration.privateData.correctOptionIds,
    );

    return {
      awardedScore: correct ? declaration.nominalPoints : 0,
      declarationHash: declaration.declarationHash,
      evaluatorVersion: MULTIPLE_CHOICE_EVALUATOR_VERSION,
      feedback: {
        selectedOptionIds: data.selectedOptionIds,
      },
      kind: "automatic",
      nominalMaxScore: declaration.nominalPoints,
      status: correct ? "correct" : "incorrect",
    };
  }

  reviewAnswer(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    context: ExerciseReviewContext,
  ): ExerciseAnswerReview {
    const i18n = context.i18n;
    const labels = selectedOptionLabels(answer, declaration);
    const selected =
      labels.length === 0 ? i18n.t("No option selected") : labels.join("\n");
    const details = [{ label: i18n.t("Selected"), value: selected }];
    // The correctness key is shown to instructors; students see only their own
    // choice, so the rich widget is built with a null key for them.
    const correctOptionIds =
      context.audience === "instructor" &&
      isMultipleChoicePrivateData(declaration.privateData)
        ? declaration.privateData.correctOptionIds
        : null;

    if (correctOptionIds !== null) {
      details.push({
        label: i18n.t("Correct"),
        value: optionLabels(declaration, correctOptionIds).join("\n"),
      });
    }

    const summary =
      labels.length === 0 ? i18n.t("No option selected") : labels.join(", ");

    if (!isMultipleChoicePublicData(declaration.publicData)) {
      return { details, summary };
    }

    return {
      details,
      elementHtml: renderMultipleChoiceReview(
        declaration.publicData,
        {
          correctOptionIds,
          exerciseId: declaration.id,
          selectedOptionIds:
            multipleChoiceAnswerData(answer).selectedOptionIds,
        },
        i18n,
      ),
      summary,
    };
  }
}
