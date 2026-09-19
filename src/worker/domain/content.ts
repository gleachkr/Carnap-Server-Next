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
  NormalizedAnswer,
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

/**
 * Who may read a saved revision besides the author who owns it.
 *
 * `private` is what every revision was before there was a choice, and what
 * every revision still is until its author says otherwise. `authors` is the
 * signed-in people who may write content — the colleague being handed a theory
 * to name from their own lesson, and nobody's students. `public` is the open
 * web, and the only scope an anonymous request can satisfy.
 *
 * Three values rather than a flag because `authors` is what a sharing layer
 * will want and because it is the setting that says "not the open web" out
 * loud. With no discovery anywhere, it differs from `public` today by exactly
 * the login wall — which is the difference an author is asking for.
 */
export type ContentSharing = "authors" | "private" | "public";

export const CONTENT_SHARING_VALUES: readonly ContentSharing[] = [
  "private",
  "authors",
  "public",
];

export function isContentSharing(value: unknown): value is ContentSharing {
  return (
    typeof value === "string" &&
    (CONTENT_SHARING_VALUES as readonly string[]).includes(value)
  );
}
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
  /**
   * When the author retired this item from their library, or null while it is
   * in use.
   *
   * Archiving is a fact about the *library view* and about nothing else. An
   * assignment points at a revision, not an item, and a shared revision is
   * held under an address somebody else may have written into a lesson — so
   * an archived item's revisions go on resolving exactly as they did, and
   * what changes is that the library folds the item away and stops offering
   * it for new assignments. Nothing deletes a content item, for the same
   * reason nothing deletes a course.
   */
  readonly archivedAt: Timestamp | null;
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
  /**
   * Who may read this revision, besides the owner. See `ContentSharing`;
   * `private` until the author shares it, which is what every revision saved
   * before there was a column reads as, and what every new one starts as.
   *
   * On the revision rather than the item because the revision is the thing
   * with an address: sharing means handing somebody a URL, and every URL under
   * `/content/revisions/<id>` names one immutable revision. A scope on the
   * item would hand over every draft behind the one that was sent.
   */
  readonly sharing: ContentSharing;
  /**
   * Whether `sharing` reaches the source text as well as the reading of it.
   *
   * Two settings rather than one because a lesson and its Markdown are not the
   * same disclosure. A `short-answer` directive's accepted answers and a
   * `free-response` directive's rubric are kept out of the compiled artifact
   * precisely so they never reach a student's browser — and both are written
   * as attributes in the source, which `/source` hands over verbatim. So
   * "read my lesson" is safe in a way "read what I wrote" is not, and an
   * author has to ask for the second.
   *
   * Meaningless for an MM0 revision, whose source *is* the thing the theory
   * route already serves: there is no rendering of a theory to share instead.
   */
  readonly shareSource: boolean;
  readonly sourceFormat: ContentSourceFormat;
  readonly sourceText: string;
  readonly contentHash: string;
  readonly compiled: JsonValue;
  readonly createdById: AppId;
  readonly createdAt: Timestamp;
}

/**
 * A revision without the two columns that grow: the source and the artifact.
 *
 * This is what a history lists, a picker offers and a save compares against,
 * none of which shows a word of the text — while a lesson's artifact runs to
 * hundreds of kilobytes and an item keeps every revision it ever had. A
 * reader who wants the text follows the id to the revision itself.
 */
export type ContentRevisionSummary = Omit<
  ContentRevision,
  "sourceText" | "compiled"
>;

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
 * Every system a document's exercises name, by the name they name it with: the
 * MM0 artifact as written, `@syntax` annotations intact.
 *
 * **One text, not a pair.** This used to hold `{mm0} | {source}` — the
 * discriminated pair a proof exercise's `publicData` carried before the table
 * existed — where `source` present meant "this artifact is a language, read the
 * student's formulas as surface text" and `mm0` meant "engine text only". Both
 * of that flag's jobs have since moved. The wire saving it bought is now the
 * table's (a keyed payload carries neither text), and the surface/engine
 * question is re-asked at the point of use, of the spec itself, by
 * `proofLanguage`. What was left was a way for the compiler to pick the lossy
 * arm and throw an author's annotations away at the one point where the table
 * is the only copy — which is exactly what it did to a document-local
 * propositional language. The engine text is derived by stripping, which is
 * cheap and total, so nothing needs the choice.
 */
export type CompiledSystems = Readonly<Record<string, string>>;

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
   * `exercise-kit/systems/join.ts` for the join that hands an exercise its copy.
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
