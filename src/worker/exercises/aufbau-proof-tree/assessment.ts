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
// The certificate is the trust boundary, so the tree type reuses the linear
// type's verifier binding verbatim (verify against our frozen mm0, never the
// student's tree).
import { verifyMmb } from "../aufbau-proof/verifier";
import { renderAufbauProofTreeReview } from "./read-only-view";
import type { AufbauProofTreeAnswerData } from "./types";
import {
  AUFBAU_PROOF_TREE_ANSWER_KIND,
  AUFBAU_PROOF_TREE_COMPONENT_METADATA,
  AUFBAU_PROOF_TREE_KIND,
  AUFBAU_PROOF_TREE_SCHEMA_VERSION,
  isAufbauProofTreeAnswerData,
  isAufbauProofTreePublicData,
} from "./types";

const AUFBAU_PROOF_TREE_EVALUATOR_VERSION = "aufbau-proof-tree-verifier@1";

/** Generous caps so an intro proof passes but a submission can't be unbounded. */
const MAX_MMB_BASE64_LENGTH = 262_144;
const MAX_PROOF_TEXT_LENGTH = 65_536;
const MAX_TREE_JSON_LENGTH = 131_072;

function treeAnswerData(answer: NormalizedAnswer): AufbauProofTreeAnswerData {
  return answer.data as unknown as AufbauProofTreeAnswerData;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export class AufbauProofTreeExerciseType implements AssessmentExerciseType {
  readonly answerKind = AUFBAU_PROOF_TREE_ANSWER_KIND;
  readonly capabilities = {
    supportsAutomaticEvaluation: true,
    supportsManualReview: true,
  };
  readonly component = {
    ...AUFBAU_PROOF_TREE_COMPONENT_METADATA,
    capabilities: this.capabilities,
  };
  readonly kind = AUFBAU_PROOF_TREE_KIND;
  readonly schemaVersion = AUFBAU_PROOF_TREE_SCHEMA_VERSION;

  normalizeAnswer(
    envelope: AnswerEnvelope,
    _declaration: ExerciseManifestItem,
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

    if (
      !isObject(envelope.data) ||
      !isAufbauProofTreeAnswerData(envelope.data)
    ) {
      return {
        diagnostics: [
          diagnostic(
            "malformed_answer_data",
            "A tree proof answer needs a base64 mmb, a proofText string, and a tree.",
            ["data"],
          ),
        ],
        ok: false,
        reason: "malformed",
      };
    }

    if (
      envelope.data.mmb.length > MAX_MMB_BASE64_LENGTH ||
      envelope.data.proofText.length > MAX_PROOF_TEXT_LENGTH ||
      JSON.stringify(envelope.data.tree).length > MAX_TREE_JSON_LENGTH ||
      decodeBase64(envelope.data.mmb) === null
    ) {
      return {
        diagnostics: [
          diagnostic(
            "malformed_answer_data",
            "The proof certificate is missing, malformed, or too large.",
            ["data"],
          ),
        ],
        ok: false,
        reason: "malformed",
      };
    }

    return {
      answer: {
        data: {
          mmb: envelope.data.mmb,
          proofText: envelope.data.proofText,
          tree: envelope.data.tree,
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
      evaluatorVersion: AUFBAU_PROOF_TREE_EVALUATOR_VERSION,
      kind: "automatic" as const,
      nominalMaxScore: declaration.nominalPoints,
    };

    if (!isAufbauProofTreePublicData(declaration.publicData)) {
      return {
        ...base,
        awardedScore: 0,
        feedback: {
          diagnostics: [
            {
              code: "invalid_declaration_public_data",
            },
          ],
        },
        status: "error",
      };
    }

    const mmb = decodeBase64(treeAnswerData(answer).mmb);

    if (mmb === null) {
      return { ...base, awardedScore: 0, status: "invalid" };
    }

    // The certificate is verified against the frozen mm0 — never the student's
    // tree or proofText — so a valid MMB proving the declared goal is the
    // definition of correct, however the tree that produced it was built.
    const result = await verifyMmb(declaration.publicData.mm0, mmb);

    if (result.errored) {
      return {
        ...base,
        awardedScore: 0,
        feedback: { verified: false },
        status: "error",
      };
    }

    return {
      ...base,
      awardedScore: result.ok ? declaration.nominalPoints : 0,
      feedback: { verified: result.ok },
      status: result.ok ? "correct" : "incorrect",
    };
  }

  reviewAnswer(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    context: ExerciseReviewContext,
  ): ExerciseAnswerReview {
    const data = treeAnswerData(answer);

    return {
      details: [{ label: context.i18n.t("Proof"), value: data.tree.formula }],
      elementHtml: renderAufbauProofTreeReview(
        {
          exerciseId: declaration.id,
          tree: data.tree,
        },
        context.i18n,
      ),
      summary: context.i18n.t("Aufbau tree proof"),
    };
  }
}
