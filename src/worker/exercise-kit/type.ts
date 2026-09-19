import type { CompilerDiagnostic } from "../application/content/diagnostics";
import type { MarkdownRenderOptions } from "../application/content/markdown";
import type {
  AnswerEnvelope,
  AnswerNormalizationResult,
  AutomaticEvaluation,
  ComponentRegistryMetadata,
  ContentNode,
  EvaluationContext,
  ExerciseAnswerReview,
  ExerciseKind,
  ExerciseManifestItem,
  ExerciseReviewContext,
  NormalizedAnswer,
} from "../domain/content";
import type { Translator } from "../i18n/translator";
import type { CompiledExercise, DirectiveBlock } from "./authoring";
import type { SystemResolver } from "./systems/theory";

/**
 * What one exercise type is, to everything outside its folder.
 *
 * Each folder under `src/worker/exercises/` exports one {@link ExerciseType}
 * from its `index.ts`, and `src/worker/exercises/index.ts` lists them once, in
 * order. The registry (`application/content/registry.ts`) is a set of lookups
 * over that list — by directive name for the compiler, by kind for grading, by
 * asset id for rendering — and nothing else enumerates the types. Before this
 * there were three registries and four hand-written switches, and adding a type
 * meant editing all seven; a type that missed one rendered read-only with no
 * form, which looked like "the widget is not hydrating" and was diagnosed
 * twice before anyone thought to count the registration points.
 *
 * The identity fields say what the type is called in every vocabulary it has
 * a name in: the directive an author writes, the kind a manifest item records,
 * the answer kind an envelope carries, and the component the page renders.
 * `component.capabilities` is the one place capabilities are declared; the
 * compiler copies them onto each manifest item.
 */
export interface ExerciseType extends ExerciseAssessment {
  readonly answerKind: string;
  /** The directive name an author writes: `:::truth-table{…}`. */
  readonly directiveName: string;
  readonly component: ComponentRegistryMetadata;
  readonly kind: ExerciseKind;
  readonly schemaVersion: number;
  /**
   * Compile one directive block to its manifest item and document node, or
   * `null` after reporting why not into `context.diagnostics`.
   */
  compile(
    block: DirectiveBlock,
    context: ExerciseCompileContext,
  ): Promise<CompiledExercise | null>;
  /**
   * What a kind of exercise is called when its author gave it no title. Never
   * shown to sighted readers (see `exerciseGroupLabel`), so it names the kind
   * rather than the task: "Truth table", not "Fill in the truth table". Spelled
   * as an `i18n.t(...)` call at the type so Lingui's extractor finds it.
   */
  name(i18n: Translator): string;
  /**
   * The exercise as markup: the read-only view of a preview, a saved revision,
   * or a reading, and — with `context.actions` supplied — the element a
   * student's submission form wraps. The one function serves both so that what
   * an author is looking at while writing is what a student will work in.
   */
  render(node: ExerciseNode, context: ExerciseRenderContext): string;
  /**
   * The widget's own interface text in the viewer's language, for the
   * hydration payload. Absent for a type whose element shows no text of its
   * own (free response, short answer, multiple choice).
   */
  strings?(i18n: Translator): Readonly<Record<string, string>>;
}

/** The grading half of a type: what `SubmissionService` asks of it. */
export interface ExerciseAssessment {
  evaluate?(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    context: EvaluationContext,
  ): Promise<AutomaticEvaluation>;
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

export type ExerciseNode = Extract<
  ContentNode,
  { readonly kind: "exercise" }
>;

/** What the compiler hands a type along with the block to compile. */
export interface ExerciseCompileContext {
  /** Where to report; an error here makes the whole document refuse to save. */
  readonly diagnostics: CompilerDiagnostic[];
  readonly renderOptions: MarkdownRenderOptions;
  /** Resolves a directive's `system=` to the theory the document froze. */
  readonly resolveSystem: SystemResolver;
}

export interface ExerciseRenderContext {
  /**
   * The action bar to close the exercise with, as a fragment of HTML. Supplied
   * by a submission form, which resolves the bar for the viewer (its status
   * line, its live submit); absent on every no-submission path, where the
   * renderer draws the preview bar with the submit disabled.
   */
  readonly actions?: string;
  readonly contentRevisionId?: string;
  /**
   * The viewer's language, for the widget's own chrome — its group name, its
   * control labels. Required rather than optional: an omitted translator would
   * fall back to English silently, which is the one i18n failure nothing else in
   * the stack can observe.
   */
  readonly i18n: Translator;
  /**
   * The author's title for this exercise, when the caller knows it — the group's
   * visible name. Absent on paths that render a node without its manifest entry;
   * `exerciseGroupLabel` names the group generically in that case.
   */
  readonly title?: string | null;
}
