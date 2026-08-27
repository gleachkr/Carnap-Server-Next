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

/**
 * What kind of source a content item holds — a lesson, or an MM0 artifact.
 *
 * `markdown` is a lesson in Carnap markdown: it compiles to a document, it is
 * what an assignment points at, and it is what every item was until MM0 items
 * arrived. `mm0` is a theory or a language — the same kind of file
 * `/theories/` serves, hosted by an instructor instead of shipped by us. It
 * compiles to nothing readable: its "document" is a validation, and what a
 * lesson does with it is name it in an `aufbau-mm0` block's `src=`.
 *
 * The two share ownership, revisions with the author's note, and the library
 * listing, because those are properties of *authored text* and not of what the
 * text says. What they do not share is anywhere a compiled document is
 * expected — which is why an assignment cannot be set on an `mm0` revision.
 */
export type ContentSourceFormat = "markdown" | "mm0";
export type ContentSourceProfile = "carnap-markdown-v1";
export type MultipleChoiceMode = "single" | "multiple";

export interface ContentItem {
  readonly id: AppId;
  readonly ownerUserId: AppId;
  readonly title: string;
  /**
   * The format of every revision of this item, fixed when it was created.
   *
   * It lives on the item rather than only on the revision because the question
   * is asked before there is a revision to ask it of — the first editor page
   * has to know which editor to open — and because an item that changed kind
   * between revisions would break the thing pinning makes safe: an assignment
   * points at revision 3, and revision 4 turning into a theory would leave a
   * course pointing at a lesson that has stopped being one. A revision still
   * carries its own copy, written from here, so a row that has been read out
   * of the database alone still knows what it is.
   */
  readonly sourceFormat: ContentSourceFormat;
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

/**
 * One system's frozen text, in whichever of the two shapes it is usable in.
 *
 * The same discriminated pair a proof exercise's `publicData` used to carry
 * directly, and for the same reason (see `exercises/aufbau-proof/formulas.ts`):
 * `source` is the artifact as written, `@syntax` annotations intact, and its
 * presence *is* the statement that this artifact is a language whose formulas
 * can be read as surface text. `mm0` is the engine input for an artifact that
 * is not one. Exactly one of the two is written, so a reader cannot be told one
 * and shown the other.
 */
export interface CompiledSystem {
  readonly mm0?: string;
  readonly source?: string;
}

/** Every system a document's exercises name, by the name they name it with. */
export type CompiledSystems = Readonly<Record<string, CompiledSystem>>;

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
  /**
   * The MM0 every exercise in this document is set in, frozen once and keyed by
   * the name the exercise wrote. Absent in an artifact compiled before the
   * table existed, and in a document whose exercises are set in nothing; see
   * `exercises/systems.ts` for the join that hands an exercise its copy.
   */
  readonly systems?: CompiledSystems;
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
