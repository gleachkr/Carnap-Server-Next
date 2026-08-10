import type {
  ComponentRegistryMetadata,
  ExerciseCapabilities,
  ExerciseKind,
} from "../../domain/content";
import {
  AUFBAU_PROOF_ANSWER_KIND,
  AUFBAU_PROOF_COMPONENT_METADATA,
  AUFBAU_PROOF_KIND,
  AUFBAU_PROOF_SCHEMA_VERSION,
} from "../../exercises/aufbau-proof/types";
import {
  AUFBAU_PROOF_FITCH_ANSWER_KIND,
  AUFBAU_PROOF_FITCH_COMPONENT_METADATA,
  AUFBAU_PROOF_FITCH_KIND,
  AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
} from "../../exercises/aufbau-proof-fitch/types";
import {
  AUFBAU_PROOF_PRAWITZ_ANSWER_KIND,
  AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA,
  AUFBAU_PROOF_PRAWITZ_KIND,
  AUFBAU_PROOF_PRAWITZ_SCHEMA_VERSION,
} from "../../exercises/aufbau-proof-prawitz/types";
import {
  AUFBAU_PROOF_TREE_ANSWER_KIND,
  AUFBAU_PROOF_TREE_COMPONENT_METADATA,
  AUFBAU_PROOF_TREE_KIND,
  AUFBAU_PROOF_TREE_SCHEMA_VERSION,
} from "../../exercises/aufbau-proof-tree/types";
import {
  FREE_RESPONSE_ANSWER_KIND,
  FREE_RESPONSE_COMPONENT_METADATA,
  FREE_RESPONSE_KIND,
  FREE_RESPONSE_SCHEMA_VERSION,
} from "../../exercises/free-response/types";
import {
  MODEL_ANSWER_KIND,
  MODEL_COMPONENT_METADATA,
  MODEL_KIND,
  MODEL_SCHEMA_VERSION,
} from "../../exercises/model/types";
import {
  MULTIPLE_CHOICE_ANSWER_KIND,
  MULTIPLE_CHOICE_COMPONENT_METADATA,
  MULTIPLE_CHOICE_KIND,
  MULTIPLE_CHOICE_SCHEMA_VERSION,
} from "../../exercises/multiple-choice/types";
import {
  SHORT_ANSWER_ANSWER_KIND,
  SHORT_ANSWER_COMPONENT_METADATA,
  SHORT_ANSWER_KIND,
  SHORT_ANSWER_SCHEMA_VERSION,
} from "../../exercises/short-answer/types";
import {
  TRUTH_TABLE_ANSWER_KIND,
  TRUTH_TABLE_COMPONENT_METADATA,
  TRUTH_TABLE_KIND,
  TRUTH_TABLE_SCHEMA_VERSION,
} from "../../exercises/truth-table/types";
import { deferred } from "../../i18n/deferred";
import { badRequest } from "../errors";

/**
 * The authoring-side exercise registry: maps a directive name to the metadata
 * the content compiler needs. Deliberately imports only per-type constants — no
 * assessment classes — so the compile/preview path (client-bundled) never pulls
 * in the grading layer (which, for aufbau-proof, drags in the verifier wasm).
 * The assessment-side registry lives in `registry.ts`.
 */

export interface ExerciseCompileDirective {
  readonly directiveName: string;
  readonly exerciseKind: ExerciseKind;
  readonly schemaVersion: number;
}

export interface AuthoringExerciseType extends ExerciseCompileDirective {
  readonly answerKind: string;
  readonly component: ComponentRegistryMetadata;
}

export class AuthoringExerciseRegistry {
  private readonly directives = new Map<string, AuthoringExerciseType>();

  register(type: AuthoringExerciseType): void {
    this.directives.set(type.directiveName, type);
  }

  /**
   * Every directive an author may write. Exists for the sweep in
   * `tests/content.test.ts` that compiles one of each with a made-up attribute:
   * a tenth exercise type that forgets `validateAttributes` should fail a test,
   * not silently start discarding its author's instructions again.
   */
  directiveNames(): readonly string[] {
    return [...this.directives.keys()];
  }

  typeForDirective(directiveName: string): AuthoringExerciseType {
    const type = this.directives.get(directiveName);

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
}

function registerAuthoringType(
  registry: AuthoringExerciseRegistry,
  input: {
    readonly answerKind: string;
    readonly capabilities: ExerciseCapabilities;
    /** A type's `*_COMPONENT_METADATA`; capabilities are supplied alongside. */
    readonly component: Omit<ComponentRegistryMetadata, "capabilities">;
    readonly directiveName: string;
    readonly exerciseKind: ExerciseKind;
    readonly schemaVersion: number;
  },
): void {
  registry.register({
    answerKind: input.answerKind,
    component: {
      ...input.component,
      capabilities: input.capabilities,
    },
    directiveName: input.directiveName,
    exerciseKind: input.exerciseKind,
    schemaVersion: input.schemaVersion,
  });
}

export function createDefaultAuthoringExerciseRegistry(): AuthoringExerciseRegistry {
  const registry = new AuthoringExerciseRegistry();
  const automaticCapabilities = {
    supportsAutomaticEvaluation: true,
    supportsManualReview: true,
  };
  const manualCapabilities = {
    supportsAutomaticEvaluation: false,
    supportsManualReview: true,
  };

  // Directive names carry no site prefix: a `carnap-` on the front of each of
  // these would only repeat the name of the site the author is already writing
  // for. The `aufbau-` on the proof types is different — it names the engine
  // that checks them, which is a real distinction.
  registerAuthoringType(registry, {
    answerKind: MULTIPLE_CHOICE_ANSWER_KIND,
    capabilities: automaticCapabilities,
    component: MULTIPLE_CHOICE_COMPONENT_METADATA,
    directiveName: "multiple-choice",
    exerciseKind: MULTIPLE_CHOICE_KIND,
    schemaVersion: MULTIPLE_CHOICE_SCHEMA_VERSION,
  });
  registerAuthoringType(registry, {
    answerKind: FREE_RESPONSE_ANSWER_KIND,
    capabilities: manualCapabilities,
    component: FREE_RESPONSE_COMPONENT_METADATA,
    directiveName: "free-response",
    exerciseKind: FREE_RESPONSE_KIND,
    schemaVersion: FREE_RESPONSE_SCHEMA_VERSION,
  });
  registerAuthoringType(registry, {
    answerKind: SHORT_ANSWER_ANSWER_KIND,
    capabilities: automaticCapabilities,
    component: SHORT_ANSWER_COMPONENT_METADATA,
    directiveName: "short-answer",
    exerciseKind: SHORT_ANSWER_KIND,
    schemaVersion: SHORT_ANSWER_SCHEMA_VERSION,
  });
  registerAuthoringType(registry, {
    answerKind: TRUTH_TABLE_ANSWER_KIND,
    capabilities: automaticCapabilities,
    component: TRUTH_TABLE_COMPONENT_METADATA,
    directiveName: "truth-table",
    exerciseKind: TRUTH_TABLE_KIND,
    schemaVersion: TRUTH_TABLE_SCHEMA_VERSION,
  });
  registerAuthoringType(registry, {
    answerKind: MODEL_ANSWER_KIND,
    capabilities: automaticCapabilities,
    component: MODEL_COMPONENT_METADATA,
    directiveName: "model",
    exerciseKind: MODEL_KIND,
    schemaVersion: MODEL_SCHEMA_VERSION,
  });
  registerAuthoringType(registry, {
    answerKind: AUFBAU_PROOF_ANSWER_KIND,
    capabilities: automaticCapabilities,
    component: AUFBAU_PROOF_COMPONENT_METADATA,
    directiveName: "aufbau-proof",
    exerciseKind: AUFBAU_PROOF_KIND,
    schemaVersion: AUFBAU_PROOF_SCHEMA_VERSION,
  });
  registerAuthoringType(registry, {
    answerKind: AUFBAU_PROOF_TREE_ANSWER_KIND,
    capabilities: automaticCapabilities,
    component: AUFBAU_PROOF_TREE_COMPONENT_METADATA,
    directiveName: "aufbau-proof-tree",
    exerciseKind: AUFBAU_PROOF_TREE_KIND,
    schemaVersion: AUFBAU_PROOF_TREE_SCHEMA_VERSION,
  });
  registerAuthoringType(registry, {
    answerKind: AUFBAU_PROOF_FITCH_ANSWER_KIND,
    capabilities: automaticCapabilities,
    component: AUFBAU_PROOF_FITCH_COMPONENT_METADATA,
    directiveName: "aufbau-proof-fitch",
    exerciseKind: AUFBAU_PROOF_FITCH_KIND,
    schemaVersion: AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
  });
  registerAuthoringType(registry, {
    answerKind: AUFBAU_PROOF_PRAWITZ_ANSWER_KIND,
    capabilities: automaticCapabilities,
    component: AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA,
    directiveName: "aufbau-proof-prawitz",
    exerciseKind: AUFBAU_PROOF_PRAWITZ_KIND,
    schemaVersion: AUFBAU_PROOF_PRAWITZ_SCHEMA_VERSION,
  });

  return registry;
}
