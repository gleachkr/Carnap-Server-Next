import type { Translator } from "../i18n/translator";
import type { AppId } from "./ids";
import type { JsonValue } from "./json";

export type ExerciseKind = string;
export type AnswerKind = string;

/**
 * How much a student is told about whether their work is right.
 *
 * One vocabulary for all nine types, because it is one question. Before this
 * there were two spellings of it — the truth table's `check="cells|terse|off"`
 * and the model's `check="on|off"` — and the four proof types, which give the
 * loudest feedback of the lot, had no say at all: they compiled on a debounce
 * and put up a green check on their own.
 *
 *   - `full`  the local Check button at full detail, the correctness mark, and
 *             a review that marks up the work.
 *   - `terse` right or wrong and nothing more: the mark, but no cell marks, no
 *             compiler squiggles, no naming of which formula failed.
 *   - `none`  no Check, no mark going green, no verdict on review, and the
 *             recorded evaluation's verdict withheld.
 *
 * It answers one of three questions an exercise faces, and only one. What is
 * *kept* is `exam`; what the student sees in *numbers* is grade release, which
 * no feedback setting can open early and none can close late. This is the
 * middle one: what they are told, and in how much detail.
 *
 * What it is *not* is a security boundary. Six of the nine types are checked in
 * the browser — the four proof types compile there (the worker holds only the
 * verifier), and the truth table and the model are computable from public data
 * by construction — so a student with devtools can run the same check the widget
 * runs. The seal that does hold is the recorded evaluation, which the server
 * withholds on its own authority. See `resolveExerciseFeedback`.
 */
export type ExerciseFeedback = "full" | "terse" | "none";

export interface ExerciseDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path?: readonly (number | string)[];
}

export interface ExerciseRenderSpec {
  readonly assetId: string;
  readonly component: string;
  readonly componentVersion: string;
}

export interface ExerciseCapabilities {
  readonly supportsAutomaticEvaluation: boolean;
  readonly supportsManualReview: boolean;
}

export interface ExerciseAnswerReviewDetail {
  readonly label: string;
  readonly value: string;
}

export type ExerciseReviewAudience = "instructor" | "student";

export interface ExerciseReviewContext {
  readonly audience: ExerciseReviewAudience;
  /**
   * Whether this reader may be told, here, whether the work is right.
   *
   * Distinct from {@link audience}, which asks who is looking. An instructor is
   * always shown everything; a student is shown a verdict when the exercise's
   * {@link ExerciseFeedback} permits it — which releasing grades settles only
   * for an author who left it unsaid.
   * Two review renderers re-derive correctness rather than reading it off an
   * evaluation — the truth table marks every cell against `correctCells`, the
   * model re-runs `checkModel` — so a sealed evaluation alone did not stop a
   * student reading a graded exam out of their own submission history.
   *
   * It is not the same question as "may this reader see the answer key".
   * Multiple choice withholds `correctOptionIds` from students outright, on
   * {@link audience}, and keeps doing so: which options were right is more than
   * whether this answer was.
   *
   * Defaults to true where it is not supplied, because everywhere it is not
   * supplied is an instructor-facing or author-facing render.
   */
  readonly revealCorrectness?: boolean;
  /**
   * The viewer's translator, for the summary, the detail labels, and the rich
   * review widget. Review text is computed at read time rather than stored, so
   * the same recorded answer reads in whatever language the viewer has chosen.
   */
  readonly i18n: Translator;
}

export interface ExerciseAnswerReview {
  readonly details?: readonly ExerciseAnswerReviewDetail[];
  /**
   * A rich, self-isolating read-only rendering of the answer (the exercise
   * element in `review` mode: a shadow-DOM widget with correctness marks). When
   * present it is the primary per-submission display; `summary`/`details` stay
   * as the compact fallback for lists and types without a rich review.
   */
  readonly elementHtml?: string;
  readonly rubricHtml?: string;
  readonly summary: string;
}

export interface ExerciseManifestItem {
  readonly answerKind: AnswerKind;
  readonly capabilities: ExerciseCapabilities;
  readonly declarationHash: string;
  /**
   * Exam exercises record every submission, including incorrect autograded
   * answers; `false` checks autograded work on submit but records it only once
   * it is fully correct. Absent means "no instruction", which is neither: an
   * assignment holding its grades back defaults to an exam and one that has
   * released them to homework. `resolveExerciseExam` resolves the absence.
   */
  readonly exam?: boolean;
  /**
   * What the author asked to be told, if they said. Absent means "no
   * instruction", which is not the same as `full`: the default depends on the
   * assignment an exercise is used in, and one compiled artifact serves many.
   * {@link ExerciseFeedback} explains the vocabulary and
   * `resolveExerciseFeedback` resolves the absence.
   */
  readonly feedback?: ExerciseFeedback;
  readonly id: string;
  readonly kind: ExerciseKind;
  readonly nominalPoints: number;
  readonly privateData: JsonValue;
  readonly publicData: JsonValue;
  readonly render: ExerciseRenderSpec;
  readonly schemaVersion: number;
  readonly title?: string;
}

export interface AnswerEnvelope {
  readonly data: JsonValue;
  readonly kind: AnswerKind;
  readonly schemaVersion: number;
}

export interface NormalizedAnswer {
  readonly data: JsonValue;
  readonly kind: AnswerKind;
  readonly schemaVersion: number;
}

export type AnswerNormalizationFailureReason =
  | "malformed"
  | "schema-invalid"
  | "wrong-kind";

export type AnswerNormalizationResult =
  | {
      readonly answer: NormalizedAnswer;
      readonly ok: true;
    }
  | {
      readonly diagnostics: readonly ExerciseDiagnostic[];
      readonly ok: false;
      readonly reason: AnswerNormalizationFailureReason;
    };

export interface EvaluationContext {
  readonly actorId?: AppId;
  readonly now: string;
}

export type AutomaticEvaluationStatus =
  | "correct"
  | "error"
  | "incorrect"
  | "invalid"
  | "partial";

export interface AutomaticEvaluation {
  readonly awardedScore: number;
  readonly declarationHash: string;
  readonly evaluatorVersion: string;
  readonly feedback?: JsonValue;
  readonly kind: "automatic";
  readonly nominalMaxScore: number;
  readonly status: AutomaticEvaluationStatus;
}

export interface RubricCriterionSpec {
  readonly description: string;
  readonly id: string;
  readonly maxPoints: number;
}

export interface RubricSpec {
  readonly criteria: readonly RubricCriterionSpec[];
}

export interface ManualGradingSpec {
  readonly rubric?: RubricSpec;
}

export interface ComponentRegistryMetadata {
  readonly assetId: string;
  readonly capabilities: ExerciseCapabilities;
  /**
   * Whether a client bundle exists at `/assets/components/<assetId>.js`. False
   * for the types whose answering UI is an ordinary server-rendered form field
   * (short answer, free response): they need no element to become usable, and
   * asking the loader for a bundle that was never built only earns a 404 in the
   * console. The asset id still identifies the server renderer.
   *
   * A type's metadata constant doubles as its {@link ExerciseRenderSpec}, so this
   * flag rides along into compiled artifacts. The registry is the authority:
   * artifacts compiled before it existed simply do not carry it.
   */
  readonly clientModule: boolean;
  readonly component: string;
  readonly componentVersion: string;
}
