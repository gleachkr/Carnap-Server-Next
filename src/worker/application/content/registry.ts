import type {
  AnswerEnvelope,
  AnswerNormalizationResult,
  AutomaticEvaluation,
  ComponentRegistryMetadata,
  EvaluationContext,
  ExerciseAnswerReview,
  ExerciseCapabilities,
  ExerciseKind,
  ExerciseManifestItem,
  ExerciseReviewContext,
  ManualGradingSpec,
  NormalizedAnswer,
} from "../../domain/content";
import { AufbauProofExerciseType } from "../../exercises/aufbau-proof/assessment";
import { AufbauProofFitchExerciseType } from "../../exercises/aufbau-proof-fitch/assessment";
import { AufbauProofPrawitzExerciseType } from "../../exercises/aufbau-proof-prawitz/assessment";
import { AufbauProofTreeExerciseType } from "../../exercises/aufbau-proof-tree/assessment";
import { FreeResponseExerciseType } from "../../exercises/free-response/assessment";
import { ModelExerciseType } from "../../exercises/model/assessment";
import { MultipleChoiceExerciseType } from "../../exercises/multiple-choice/assessment";
import { ShortAnswerExerciseType } from "../../exercises/short-answer/assessment";
import { TruthTableExerciseType } from "../../exercises/truth-table/assessment";
import { deferred } from "../../i18n/deferred";
import { badRequest } from "../errors";

/**
 * The assessment-side exercise registry: maps an exercise kind to its grading
 * behavior. The per-type logic lives under `src/worker/exercises/<type>/`; this
 * module registers the built-in types and re-exports their constants so existing
 * importers keep a stable surface. The authoring-side registry (the directive →
 * metadata map the content compiler uses) lives in `authoring-registry.ts` and
 * is kept separate so the compile/preview path never imports the grading layer.
 */

export { AufbauProofExerciseType as AufbauProofExerciseHandler } from "../../exercises/aufbau-proof/assessment";
export {
  FREE_RESPONSE_ANSWER_KIND,
  FREE_RESPONSE_COMPONENT_METADATA,
  FREE_RESPONSE_KIND,
  FREE_RESPONSE_SCHEMA_VERSION,
} from "../../exercises/free-response/types";
export { ModelExerciseType as ModelExerciseHandler } from "../../exercises/model/assessment";
export {
  MODEL_ANSWER_KIND,
  MODEL_COMPONENT_METADATA,
  MODEL_KIND,
  MODEL_SCHEMA_VERSION,
} from "../../exercises/model/types";
export { MultipleChoiceExerciseType as MultipleChoiceExerciseHandler } from "../../exercises/multiple-choice/assessment";
export {
  MULTIPLE_CHOICE_ANSWER_KIND,
  MULTIPLE_CHOICE_COMPONENT_METADATA,
  MULTIPLE_CHOICE_KIND,
  MULTIPLE_CHOICE_SCHEMA_VERSION,
} from "../../exercises/multiple-choice/types";
export {
  SHORT_ANSWER_ANSWER_KIND,
  SHORT_ANSWER_COMPONENT_METADATA,
  SHORT_ANSWER_KIND,
  SHORT_ANSWER_SCHEMA_VERSION,
} from "../../exercises/short-answer/types";
export { TruthTableExerciseType as TruthTableExerciseHandler } from "../../exercises/truth-table/assessment";
export {
  TRUTH_TABLE_ANSWER_KIND,
  TRUTH_TABLE_COMPONENT_METADATA,
  TRUTH_TABLE_KIND,
  TRUTH_TABLE_SCHEMA_VERSION,
} from "../../exercises/truth-table/types";
export type {
  AuthoringExerciseType,
  ExerciseCompileDirective,
} from "./authoring-registry";
export {
  AuthoringExerciseRegistry,
  createDefaultAuthoringExerciseRegistry,
} from "./authoring-registry";

export interface AssessmentExerciseType {
  readonly answerKind: string;
  readonly capabilities: ExerciseCapabilities;
  readonly component: ComponentRegistryMetadata;
  readonly kind: ExerciseKind;
  readonly schemaVersion: number;
  evaluate?(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    context: EvaluationContext,
  ): Promise<AutomaticEvaluation>;
  manualGradingSpec?(declaration: ExerciseManifestItem): ManualGradingSpec;
  normalizeAnswer(
    envelope: AnswerEnvelope,
    declaration: ExerciseManifestItem,
  ): AnswerNormalizationResult;
  reviewAnswer?(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    context: ExerciseReviewContext,
  ): ExerciseAnswerReview;
}

export class AssessmentExerciseRegistry {
  private readonly types = new Map<string, AssessmentExerciseType>();

  register(type: AssessmentExerciseType): void {
    this.types.set(type.kind, type);
  }

  typeFor(kind: ExerciseKind): AssessmentExerciseType {
    const type = this.types.get(kind);

    if (type === undefined) {
      throw badRequest(
        "unsupported_exercise_kind",
        deferred.i18n.t("Exercise kind {kind} is not supported.", { kind }),
      );
    }

    return type;
  }

  normalizeAnswer(
    declaration: ExerciseManifestItem,
    envelope: AnswerEnvelope,
  ): AnswerNormalizationResult {
    return this.typeFor(declaration.kind).normalizeAnswer(
      envelope,
      declaration,
    );
  }

  async evaluateAutomatic(
    declaration: ExerciseManifestItem,
    answer: NormalizedAnswer,
    context: EvaluationContext,
  ): Promise<AutomaticEvaluation | null> {
    const type = this.typeFor(declaration.kind);

    if (type.evaluate === undefined) {
      return null;
    }

    return type.evaluate(answer, declaration, context);
  }

  manualGradingSpec(declaration: ExerciseManifestItem): ManualGradingSpec {
    return (
      this.typeFor(declaration.kind).manualGradingSpec?.(declaration) ?? {}
    );
  }

  reviewAnswer(
    declaration: ExerciseManifestItem,
    answer: NormalizedAnswer,
    context: ExerciseReviewContext,
  ): ExerciseAnswerReview {
    return (
      this.typeFor(declaration.kind).reviewAnswer?.(
        answer,
        declaration,
        context,
      ) ?? {
        summary: JSON.stringify(answer.data),
      }
    );
  }

  componentMetadataFor(kind: ExerciseKind): ComponentRegistryMetadata {
    return this.typeFor(kind).component;
  }
}

export const ExerciseKindRegistry = AssessmentExerciseRegistry;

export function createDefaultExerciseKindRegistry(): AssessmentExerciseRegistry {
  const registry = new AssessmentExerciseRegistry();

  registry.register(new MultipleChoiceExerciseType());
  registry.register(new FreeResponseExerciseType());
  registry.register(new ShortAnswerExerciseType());
  registry.register(new TruthTableExerciseType());
  registry.register(new ModelExerciseType());
  registry.register(new AufbauProofExerciseType());
  registry.register(new AufbauProofTreeExerciseType());
  registry.register(new AufbauProofFitchExerciseType());
  registry.register(new AufbauProofPrawitzExerciseType());

  return registry;
}
