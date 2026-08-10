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
// The certificate is the trust boundary, so the Fitch type reuses the linear
// type's verifier binding verbatim (verify against our frozen mm0, never the
// student's Fitch text or the translated proof).
import { verifyMmb } from "../aufbau-proof/verifier";
import { renderAufbauProofFitchReview } from "./read-only-view";
import type { AufbauProofFitchAnswerData } from "./types";
import {
  AUFBAU_PROOF_FITCH_ANSWER_KIND,
  AUFBAU_PROOF_FITCH_COMPONENT_METADATA,
  AUFBAU_PROOF_FITCH_KIND,
  AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
  DEFAULT_ASSUMPTION_RULE,
  isAufbauProofFitchAnswerData,
  isAufbauProofFitchPublicData,
} from "./types";

const AUFBAU_PROOF_FITCH_EVALUATOR_VERSION = "aufbau-proof-fitch-verifier@1";

/** Generous caps so an intro proof passes but a submission can't be unbounded. */
const MAX_MMB_BASE64_LENGTH = 262_144;
const MAX_PROOF_TEXT_LENGTH = 65_536;
const MAX_FITCH_TEXT_LENGTH = 65_536;

function fitchAnswerData(
  answer: NormalizedAnswer,
): AufbauProofFitchAnswerData {
  return answer.data as unknown as AufbauProofFitchAnswerData;
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

export class AufbauProofFitchExerciseType implements AssessmentExerciseType {
  readonly answerKind = AUFBAU_PROOF_FITCH_ANSWER_KIND;
  readonly capabilities = {
    supportsAutomaticEvaluation: true,
    supportsManualReview: true,
  };
  readonly component = {
    ...AUFBAU_PROOF_FITCH_COMPONENT_METADATA,
    capabilities: this.capabilities,
  };
  readonly kind = AUFBAU_PROOF_FITCH_KIND;
  readonly schemaVersion = AUFBAU_PROOF_FITCH_SCHEMA_VERSION;

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
      !isAufbauProofFitchAnswerData(envelope.data)
    ) {
      return {
        diagnostics: [
          diagnostic(
            "malformed_answer_data",
            "A Fitch proof answer needs a base64 mmb, a proofText, and a fitchText.",
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
      envelope.data.fitchText.length > MAX_FITCH_TEXT_LENGTH ||
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
          fitchText: envelope.data.fitchText,
          mmb: envelope.data.mmb,
          proofText: envelope.data.proofText,
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
      evaluatorVersion: AUFBAU_PROOF_FITCH_EVALUATOR_VERSION,
      kind: "automatic" as const,
      nominalMaxScore: declaration.nominalPoints,
    };

    if (!isAufbauProofFitchPublicData(declaration.publicData)) {
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

    const mmb = decodeBase64(fitchAnswerData(answer).mmb);

    if (mmb === null) {
      return { ...base, awardedScore: 0, status: "invalid" };
    }

    // The certificate is verified against the frozen mm0 — never the student's
    // Fitch text or the translated proof — so a valid MMB proving the declared
    // goal is the definition of correct, however the proof was written.
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
    const data = fitchAnswerData(answer);
    const publicData = isAufbauProofFitchPublicData(declaration.publicData)
      ? declaration.publicData
      : null;
    const goalName = publicData?.goalName ?? declaration.id;

    return {
      details: [{ label: context.i18n.t("Goal"), value: goalName }],
      elementHtml: renderAufbauProofFitchReview(
        {
          assumptionRule:
            publicData?.assumptionRule ?? DEFAULT_ASSUMPTION_RULE,
          exerciseId: declaration.id,
          fitchText: data.fitchText,
        },
        context.i18n,
      ),
      summary: context.i18n.t("Aufbau Fitch proof"),
    };
  }
}
