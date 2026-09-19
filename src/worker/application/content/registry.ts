import type {
  AnswerEnvelope,
  AnswerNormalizationResult,
  AutomaticEvaluation,
  ComponentRegistryMetadata,
  EvaluationContext,
  ExerciseAnswerReview,
  ExerciseKind,
  ExerciseManifestItem,
  ExerciseRenderSpec,
  ExerciseReviewContext,
  NormalizedAnswer,
} from "../../domain/content";
import type {
  ExerciseNode,
  ExerciseRenderContext,
  ExerciseType,
} from "../../exercise-kit/type";
import { EXERCISE_TYPES } from "../../exercises";
import { deferred } from "../../i18n/deferred";
import type { Translator } from "../../i18n/translator";
import { badRequest } from "../errors";
import { contentRevisionAttribute, escapeHtml } from "./render-support";

/**
 * The exercise registry: every {@link ExerciseType}, reachable by each name it
 * goes by. The compiler asks by directive name, grading asks by kind, and
 * rendering asks by the client asset id a document node carries — three
 * lookups over one list (`src/worker/exercises/index.ts`), rather than the
 * three registries and four switches that used to each enumerate the types
 * on their own.
 *
 * The grading conveniences below are what `SubmissionService` calls; they
 * resolve the type from the manifest item and forward, so the service never
 * holds a type in its hands. The render conveniences are what
 * `renderCompiledContent` and the submission forms call, with one fallback:
 * a node whose asset id no type claims renders as an empty placeholder rather
 * than throwing, because a stored document is not made unreadable by a type
 * that was later removed.
 */
export class ExerciseRegistry {
  private readonly ordered: ExerciseType[] = [];
  private readonly byAssetId = new Map<string, ExerciseType>();
  private readonly byDirective = new Map<string, ExerciseType>();
  private readonly byKind = new Map<ExerciseKind, ExerciseType>();

  constructor(types: readonly ExerciseType[] = []) {
    for (const type of types) {
      this.register(type);
    }
  }

  register(type: ExerciseType): void {
    this.ordered.push(type);
    this.byAssetId.set(type.component.assetId, type);
    this.byDirective.set(type.directiveName, type);
    this.byKind.set(type.kind, type);
  }

  /** Every registered type, in registration order. */
  types(): readonly ExerciseType[] {
    return this.ordered;
  }

  /**
   * Every directive an author may write. Exists for the sweep in
   * `tests/content.test.ts` that compiles one of each with a made-up attribute:
   * a type that forgets `validateAttributes` should fail a test, not silently
   * start discarding its author's instructions again.
   */
  directiveNames(): readonly string[] {
    return this.ordered.map((type) => type.directiveName);
  }

  typeForDirective(directiveName: string): ExerciseType {
    const type = this.byDirective.get(directiveName);

    if (type === undefined) {
      throw badRequest(
        "unsupported_exercise_directive",
        deferred.i18n.t("Directive {directiveName} is not supported.", {
          directiveName,
        }),
      );
    }

    return type;
  }

  typeFor(kind: ExerciseKind): ExerciseType {
    const type = this.byKind.get(kind);

    if (type === undefined) {
      throw badRequest(
        "unsupported_exercise_kind",
        deferred.i18n.t("Exercise kind {kind} is not supported.", { kind }),
      );
    }

    return type;
  }

  /** The type that renders this asset, or null: rendering is lenient. */
  typeForAssetId(assetId: string): ExerciseType | null {
    return this.byAssetId.get(assetId) ?? null;
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

  metadataFor(render: ExerciseRenderSpec): ComponentRegistryMetadata | null {
    return this.typeForAssetId(render.assetId)?.component ?? null;
  }

  renderExercise(node: ExerciseNode, context: ExerciseRenderContext): string {
    const type = this.typeForAssetId(node.render.assetId);

    if (type === null) {
      const revisionAttribute = contentRevisionAttribute(
        context.contentRevisionId,
      );

      return `<div data-component="${escapeHtml(node.render.component)}" data-component-version="${escapeHtml(node.render.componentVersion)}" data-exercise-id="${escapeHtml(node.exerciseId)}"${revisionAttribute}></div>`;
    }

    return type.render(node, context);
  }

  /**
   * The widget's own interface text in the viewer's language, for the
   * hydration payload. Empty for a type whose element shows no text of its
   * own, and for an asset no type claims — the map is a lookup with an English
   * fallback, so an absent entry costs nothing.
   *
   * Keyed by asset id rather than exercise kind because these strings belong
   * to the *element* that shows them — the same keying that decides which
   * bundle a document loads.
   */
  strings(
    assetId: string,
    i18n: Translator,
  ): Readonly<Record<string, string>> {
    return this.typeForAssetId(assetId)?.strings?.(i18n) ?? {};
  }
}

export function createDefaultExerciseRegistry(): ExerciseRegistry {
  return new ExerciseRegistry(EXERCISE_TYPES);
}
