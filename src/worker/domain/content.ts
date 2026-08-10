import type { ExerciseManifestItem, ExerciseRenderSpec } from "./exercises";
import type { AppId } from "./ids";
import type { JsonValue } from "./json";
import type { Timestamp } from "./time";

export type {
  AnswerEnvelope,
  AnswerKind,
  AnswerNormalizationFailureReason,
  AnswerNormalizationResult,
  AutomaticEvaluation,
  AutomaticEvaluationStatus,
  ComponentRegistryMetadata,
  EvaluationContext,
  ExerciseAnswerReview,
  ExerciseAnswerReviewDetail,
  ExerciseCapabilities,
  ExerciseDiagnostic,
  ExerciseFeedback,
  ExerciseKind,
  ExerciseManifestItem,
  ExerciseRenderSpec,
  ExerciseReviewAudience,
  ExerciseReviewContext,
  ManualGradingSpec,
  NormalizedAnswer,
  RubricCriterionSpec,
  RubricSpec,
} from "./exercises";

export type ContentSourceFormat = "markdown";
export type ContentSourceProfile = "carnap-markdown-v1";
export type MultipleChoiceMode = "single" | "multiple";

export interface ContentItem {
  readonly id: AppId;
  readonly ownerUserId: AppId;
  readonly title: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface ContentRevision {
  readonly id: AppId;
  readonly itemId: AppId;
  readonly revisionNumber: number;
  /**
   * Why the author made this revision, or the empty string when they said
   * nothing. The ordinal above orders revisions; this is what tells them apart,
   * and it is what the library and the assignment pickers show.
   */
  readonly details: string;
  readonly sourceFormat: ContentSourceFormat;
  readonly sourceText: string;
  readonly contentHash: string;
  readonly compiled: JsonValue;
  readonly createdById: AppId;
  readonly createdAt: Timestamp;
}

export type ContentNode =
  | {
      readonly html: string;
      readonly kind: "markdown";
    }
  | {
      readonly exerciseId: string;
      readonly exerciseKind: string;
      readonly kind: "exercise";
      readonly publicData: JsonValue;
      readonly render: ExerciseRenderSpec;
    }
  /**
   * A shown `:::aufbau-mm0` theory: the axioms a proof exercise is built from,
   * offered to the reader as a disclosure. The node carries the MM0 source
   * rather than finished markup so the panel's own chrome — the word "Theory" —
   * is written in the reader's language at render time, not frozen in English
   * when the author saved.
   */
  | {
      readonly kind: "theory";
      readonly mm0: string;
      readonly name: string;
    };

export interface CompiledContentDocument {
  readonly nodes: readonly ContentNode[];
  readonly profile: ContentSourceProfile;
}

export interface CompiledContentArtifact {
  readonly componentRegistryVersion: string;
  /** Author stylesheet from `:::style` blocks, applied only in the isolated content document. */
  readonly css?: string;
  /** External stylesheet URLs from `:::style{src=…}`, linked before the inline `css`. */
  readonly cssHrefs?: readonly string[];
  /** When true (`:::style{reset}`), the content document omits the default content styles. */
  readonly cssReset?: boolean;
  readonly document: CompiledContentDocument;
  readonly manifest: readonly ExerciseManifestItem[];
  readonly manifestVersion: 1;
  readonly sourceProfile: ContentSourceProfile;
}

export interface MultipleChoiceOptionPublicData {
  readonly html: string;
  readonly id: string;
}

export interface MultipleChoicePublicData {
  readonly mode: MultipleChoiceMode;
  readonly options: readonly MultipleChoiceOptionPublicData[];
  readonly promptHtml: string;
}

export interface MultipleChoicePrivateData {
  readonly correctOptionIds: readonly string[];
  readonly mode: MultipleChoiceMode;
}

export interface MultipleChoiceAnswerData {
  readonly selectedOptionIds: readonly string[];
}

export interface FreeResponsePublicData {
  readonly promptHtml: string;
}

export interface FreeResponsePrivateData {
  readonly rubricHtml?: string;
}

export interface FreeResponseAnswerData {
  readonly text: string;
}

export interface ShortAnswerPublicData {
  readonly promptHtml: string;
}

export interface ShortAnswerPrivateData {
  readonly acceptedAnswers: readonly string[];
  readonly caseSensitive: boolean;
}

export interface ShortAnswerAnswerData {
  readonly text: string;
}
