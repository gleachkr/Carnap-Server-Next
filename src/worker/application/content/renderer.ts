import type {
  CompiledContentArtifact,
  ComponentRegistryMetadata,
  ContentNode,
  ExerciseRenderSpec,
} from "../../domain/content";
import { renderAufbauProof } from "../../exercises/aufbau-proof/read-only-view";
import { renderTheoryPanel } from "../../exercises/aufbau-proof/theory-panel";
import { AUFBAU_PROOF_COMPONENT_METADATA } from "../../exercises/aufbau-proof/types";
import { renderAufbauProofFitch } from "../../exercises/aufbau-proof-fitch/read-only-view";
import { AUFBAU_PROOF_FITCH_COMPONENT_METADATA } from "../../exercises/aufbau-proof-fitch/types";
import { renderAufbauProofPrawitz } from "../../exercises/aufbau-proof-prawitz/read-only-view";
import { AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA } from "../../exercises/aufbau-proof-prawitz/types";
import { renderAufbauProofTree } from "../../exercises/aufbau-proof-tree/read-only-view";
import { AUFBAU_PROOF_TREE_COMPONENT_METADATA } from "../../exercises/aufbau-proof-tree/types";
import { renderFreeResponse } from "../../exercises/free-response/read-only-view";
import { FREE_RESPONSE_COMPONENT_METADATA } from "../../exercises/free-response/types";
import {
  EXERCISE_HYDRATION_VERSION,
  type ExerciseHydration,
} from "../../exercises/hydration";
import { renderModel } from "../../exercises/model/read-only-view";
import { MODEL_COMPONENT_METADATA } from "../../exercises/model/types";
import { renderMultipleChoice } from "../../exercises/multiple-choice/read-only-view";
import { MULTIPLE_CHOICE_COMPONENT_METADATA } from "../../exercises/multiple-choice/types";
import { renderShortAnswer } from "../../exercises/short-answer/read-only-view";
import { SHORT_ANSWER_COMPONENT_METADATA } from "../../exercises/short-answer/types";
import { exerciseStrings } from "../../exercises/strings";
import { renderTruthTable } from "../../exercises/truth-table/read-only-view";
import { TRUTH_TABLE_COMPONENT_METADATA } from "../../exercises/truth-table/types";
import type { Translator } from "../../i18n/translator";
import { contentRevisionAttribute, escapeHtml } from "./render-support";

export interface RenderCompiledContentOptions {
  readonly contentRevisionId?: string;
}

export interface ExerciseRenderContext {
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
   * {@link exerciseGroupLabel} names the group generically in that case.
   */
  readonly title?: string | null;
}

export interface ComponentRenderer {
  readonly metadata: ComponentRegistryMetadata;
  render(
    node: Extract<ContentNode, { readonly kind: "exercise" }>,
    context: ExerciseRenderContext,
  ): string;
}

export class ComponentRegistry {
  private readonly renderers = new Map<string, ComponentRenderer>();

  register(renderer: ComponentRenderer): void {
    this.renderers.set(renderer.metadata.assetId, renderer);
  }

  metadataFor(render: ExerciseRenderSpec): ComponentRegistryMetadata | null {
    return this.renderers.get(render.assetId)?.metadata ?? null;
  }

  renderExercise(
    node: Extract<ContentNode, { readonly kind: "exercise" }>,
    context: ExerciseRenderContext,
  ): string {
    const renderer = this.renderers.get(node.render.assetId);
    const revisionAttribute = contentRevisionAttribute(
      context.contentRevisionId,
    );

    if (renderer === undefined) {
      return `<div data-component="${escapeHtml(node.render.component)}" data-component-version="${escapeHtml(node.render.componentVersion)}" data-exercise-id="${escapeHtml(node.exerciseId)}"${revisionAttribute}></div>`;
    }

    return renderer.render(node, context);
  }
}

export function createDefaultComponentRegistry(): ComponentRegistry {
  const registry = new ComponentRegistry();
  const capabilities = {
    supportsAutomaticEvaluation: true,
    supportsManualReview: true,
  };
  const manualCapabilities = {
    supportsAutomaticEvaluation: false,
    supportsManualReview: true,
  };

  registry.register({
    metadata: {
      ...MULTIPLE_CHOICE_COMPONENT_METADATA,
      capabilities,
    },
    render: renderMultipleChoice,
  });

  registry.register({
    metadata: {
      ...FREE_RESPONSE_COMPONENT_METADATA,
      capabilities: manualCapabilities,
    },
    render: renderFreeResponse,
  });

  registry.register({
    metadata: {
      ...SHORT_ANSWER_COMPONENT_METADATA,
      capabilities,
    },
    render: renderShortAnswer,
  });

  registry.register({
    metadata: {
      ...TRUTH_TABLE_COMPONENT_METADATA,
      capabilities,
    },
    render: renderTruthTable,
  });

  registry.register({
    metadata: {
      ...MODEL_COMPONENT_METADATA,
      capabilities,
    },
    render: renderModel,
  });

  registry.register({
    metadata: {
      ...AUFBAU_PROOF_COMPONENT_METADATA,
      capabilities,
    },
    render: renderAufbauProof,
  });

  registry.register({
    metadata: {
      ...AUFBAU_PROOF_TREE_COMPONENT_METADATA,
      capabilities,
    },
    render: renderAufbauProofTree,
  });

  registry.register({
    metadata: {
      ...AUFBAU_PROOF_FITCH_COMPONENT_METADATA,
      capabilities,
    },
    render: renderAufbauProofFitch,
  });

  registry.register({
    metadata: {
      ...AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA,
      capabilities,
    },
    render: renderAufbauProofPrawitz,
  });

  return registry;
}

export function renderCompiledContent(
  artifact: CompiledContentArtifact,
  i18n: Translator,
  registry = createDefaultComponentRegistry(),
  options: RenderCompiledContentOptions = {},
): string {
  // The titles live in the manifest, not on the nodes: `exerciseTitle` is
  // authoring metadata the compiler files alongside the points and the answer
  // key, so a renderer that only walks the document cannot see it.
  const titles = new Map(
    artifact.manifest.map((item) => [item.id, item.title ?? null]),
  );

  return artifact.document.nodes
    .map((node) => {
      if (node.kind === "markdown") {
        return node.html;
      }

      if (node.kind === "theory") {
        return renderTheoryPanel(node, i18n);
      }

      return registry.renderExercise(node, {
        ...(options.contentRevisionId === undefined
          ? {}
          : { contentRevisionId: options.contentRevisionId }),
        i18n,
        title: titles.get(node.exerciseId) ?? null,
      });
    })
    .join("\n");
}

/**
 * The client bundles a document needs: one asset id per exercise type used,
 * skipping the types that ship no client module (see
 * {@link ComponentRegistryMetadata.clientModule}) and any whose asset id no
 * renderer claims. Requesting a bundle that was never built would only 404 —
 * and a 404 body served as JSON is a module-load error in the console.
 */
export function componentAssetsForArtifact(
  artifact: CompiledContentArtifact,
  registry = createDefaultComponentRegistry(),
): string[] {
  return [
    ...new Set(
      artifact.document.nodes
        .filter((node) => node.kind === "exercise")
        .filter(
          (node) => registry.metadataFor(node.render)?.clientModule === true,
        )
        .map((node) => node.render.assetId),
    ),
  ];
}

/**
 * The document-scoped hydration table for a preview: every exercise's public
 * render data, keyed by exercise id. The sibling of
 * {@link componentAssetsForArtifact} — that says which bundles a document needs,
 * this says what to hand each element once they load.
 *
 * The interactive path has no use for it: each submission form embeds its own
 * payload (with the student's prior answer), and that per-element payload wins.
 * A preview has no forms, so without this table an element upgrades with
 * `publicData === null` and leaves the inert server markup standing.
 *
 * Mode is `answer` because the widget is genuinely in its answering state — it
 * is fully interactive, just unsubmittable: there is no form to mirror into and
 * no submit button, so an author can work the exercise without recording
 * anything.
 */
export function exerciseHydrationForArtifact(
  artifact: CompiledContentArtifact,
  i18n: Translator,
): Record<string, ExerciseHydration> {
  const table: Record<string, ExerciseHydration> = {};

  for (const node of artifact.document.nodes) {
    if (node.kind !== "exercise") {
      continue;
    }

    table[node.exerciseId] = {
      mode: "answer",
      options: {},
      priorAnswer: null,
      publicData: node.publicData,
      strings: exerciseStrings(node.render.assetId, i18n),
      version: EXERCISE_HYDRATION_VERSION,
    };
  }

  return table;
}
