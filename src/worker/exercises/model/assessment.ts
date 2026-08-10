import {
  diagnostic,
  isObject,
} from "../../application/content/assessment-support";
import type { AssessmentExerciseType } from "../../application/content/registry";
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
import { stringsResolver } from "../../i18n/translator";
import {
  effectiveAnswer,
  isModelAnswerData,
  isModelPublicData,
  resolveModel,
} from "./grading";
import { checkModel } from "./logic";
import { renderModelReview } from "./read-only-view";
import { buildModelStrings } from "./strings";
import type { ModelAnswerData } from "./types";
import {
  MODEL_ANSWER_KIND,
  MODEL_COMPONENT_METADATA,
  MODEL_KIND,
  MODEL_SCHEMA_VERSION,
} from "./types";
import { describeVerdict } from "./verdict-text";

const MODEL_EVALUATOR_VERSION = "model-evaluator@1";

function modelAnswerData(answer: NormalizedAnswer): ModelAnswerData {
  return answer.data as unknown as ModelAnswerData;
}

export class ModelExerciseType implements AssessmentExerciseType {
  readonly answerKind = MODEL_ANSWER_KIND;
  readonly capabilities = {
    supportsAutomaticEvaluation: true,
    supportsManualReview: true,
  };
  readonly component = {
    ...MODEL_COMPONENT_METADATA,
    capabilities: this.capabilities,
  };
  readonly kind = MODEL_KIND;
  readonly schemaVersion = MODEL_SCHEMA_VERSION;

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

    if (!isObject(envelope.data) || !isModelAnswerData(envelope.data)) {
      return {
        diagnostics: [
          diagnostic(
            "malformed_answer_data",
            "A model answer must be a domain and a value for each field.",
            ["data"],
          ),
        ],
        ok: false,
        reason: "malformed",
      };
    }

    if (!isModelPublicData(declaration.publicData)) {
      return {
        diagnostics: [
          diagnostic(
            "answer_shape_mismatch",
            "The submitted model does not match the exercise's shape.",
            ["data"],
          ),
        ],
        ok: false,
        reason: "schema-invalid",
      };
    }

    // Keep only the fields the exercise actually asks for, and put back any
    // locked given: a `strictGivens` given is a requirement, so an answer that
    // changed one is graded against the exercise as set rather than crashing
    // the widget the way the original does.
    const resolved = resolveModel(declaration.publicData);
    const submitted = effectiveAnswer(declaration.publicData, envelope.data);
    const fields: Record<string, string> = {};

    for (const field of resolved?.signature ?? []) {
      if (field.kind !== "domain") {
        fields[field.label] = submitted.fields[field.label] ?? "";
      }
    }

    return {
      answer: {
        data: {
          domain: submitted.domain,
          fields,
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
      evaluatorVersion: MODEL_EVALUATOR_VERSION,
      kind: "automatic" as const,
      nominalMaxScore: declaration.nominalPoints,
    };

    if (!isModelPublicData(declaration.publicData)) {
      return {
        ...base,
        awardedScore: 0,
        feedback: {
          diagnostics: [{ code: "invalid_declaration_public_data" }],
        },
        status: "error",
      };
    }

    const resolved = resolveModel(declaration.publicData);

    if (resolved === null) {
      return { ...base, awardedScore: 0, status: "error" };
    }

    const verdict = checkModel(
      resolved.signature,
      resolved.task,
      effectiveAnswer(declaration.publicData, modelAnswerData(answer)),
    );

    // A model either does what was asked or it does not; there is no fraction
    // of a countermodel, so this is always all-or-nothing.
    return {
      ...base,
      awardedScore: verdict.ok ? declaration.nominalPoints : 0,
      status: verdict.ok ? "correct" : "incorrect",
    };
  }

  reviewAnswer(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    context: ExerciseReviewContext,
  ): ExerciseAnswerReview {
    const i18n = context.i18n;
    const data = modelAnswerData(answer);

    if (!isModelPublicData(declaration.publicData)) {
      return { summary: i18n.t("Model") };
    }

    const resolved = resolveModel(declaration.publicData);

    if (resolved === null) {
      return { summary: i18n.t("Model") };
    }

    const graded = effectiveAnswer(declaration.publicData, data);
    const verdict = checkModel(resolved.signature, resolved.task, graded);
    // The same sentences the widget's own Check shows, so a student who checked
    // before submitting reads the identical verdict back on the review page.
    const strings = stringsResolver(buildModelStrings(i18n));
    // A model has no secret key — it is checked against public formulas — so
    // this review recomputes rather than reading a stored evaluation. Sealing
    // the evaluation alone therefore left the verdict on the page.
    const reveal = context.revealCorrectness !== false;
    const summary = describeVerdict(
      verdict,
      {
        dialect: resolved.dialect,
        required: resolved.task.required,
        target: resolved.task.target,
        targeted: resolved.task.targeted,
        variant: declaration.publicData.variant,
      },
      strings,
    );

    return {
      ...(reveal
        ? { details: [{ label: i18n.t("Result"), value: summary }] }
        : {}),
      elementHtml: renderModelReview(
        declaration.publicData,
        { answer: graded, exerciseId: declaration.id, verdict },
        i18n,
        reveal,
      ),
      summary: reveal ? summary : i18n.t("Model"),
    };
  }
}
