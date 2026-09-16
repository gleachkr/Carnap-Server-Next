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
import { diagnostic, isObject } from "../../exercise-kit/assessment";
import { readCertificate } from "../../exercise-kit/proof/certificate";
import {
  answerGoal,
  isPlaygroundExercise,
  playgroundGoalText,
  verificationText,
} from "../../exercise-kit/proof/playground";
import { verifyMmb } from "../../exercise-kit/proof/verifier";
import { renderAufbauProofReview } from "./read-only-view";
import type { AufbauProofAnswerData } from "./types";
import {
  AUFBAU_PROOF_ANSWER_KIND,
  AUFBAU_PROOF_COMPONENT_METADATA,
  AUFBAU_PROOF_KIND,
  AUFBAU_PROOF_SCHEMA_VERSION,
  isAufbauProofAnswerData,
  isAufbauProofPublicData,
} from "./types";

const AUFBAU_PROOF_EVALUATOR_VERSION = "aufbau-proof-verifier@1";

/** Generous cap so an intro proof passes but a submission can't be unbounded. */
const MAX_PROOF_TEXT_LENGTH = 65_536;

function proofAnswerData(answer: NormalizedAnswer): AufbauProofAnswerData {
  return answer.data as unknown as AufbauProofAnswerData;
}

export class AufbauProofExerciseType implements AssessmentExerciseType {
  readonly answerKind = AUFBAU_PROOF_ANSWER_KIND;
  readonly capabilities = {
    supportsAutomaticEvaluation: true,
    supportsManualReview: true,
  };
  readonly component = {
    ...AUFBAU_PROOF_COMPONENT_METADATA,
    capabilities: this.capabilities,
  };
  readonly kind = AUFBAU_PROOF_KIND;
  readonly schemaVersion = AUFBAU_PROOF_SCHEMA_VERSION;

  normalizeAnswer(
    envelope: AnswerEnvelope,
    declaration: ExerciseManifestItem,
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

    if (!isObject(envelope.data) || !isAufbauProofAnswerData(envelope.data)) {
      return {
        diagnostics: [
          diagnostic(
            "malformed_answer_data",
            "A proof answer needs a proofText string and a base64 mmb string.",
            ["data"],
          ),
        ],
        ok: false,
        reason: "malformed",
      };
    }

    const certificate = readCertificate(envelope.data);

    if (
      certificate === undefined ||
      certificate === null ||
      envelope.data.proofText.length > MAX_PROOF_TEXT_LENGTH
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

    // A playground's goal travels with the answer, since the artifact has
    // none: without it there is nothing to verify the certificate against.
    const goal = answerGoal(envelope.data);

    if (isPlaygroundExercise(declaration.publicData) && goal === undefined) {
      return {
        diagnostics: [
          diagnostic(
            "malformed_answer_data",
            "A playground proof answer needs the goal its proof derived.",
            ["data", "goal"],
          ),
        ],
        ok: false,
        reason: "malformed",
      };
    }

    return {
      answer: {
        data: {
          ...(goal === undefined ? {} : { goal }),
          proofText: envelope.data.proofText,
        } as unknown as JsonValue,
        kind: this.answerKind,
        schemaVersion: this.schemaVersion,
      },
      certificate,
      ok: true,
    };
  }

  async evaluate(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    context: EvaluationContext,
  ): Promise<AutomaticEvaluation> {
    const base = {
      declarationHash: declaration.declarationHash,
      evaluatorVersion: AUFBAU_PROOF_EVALUATOR_VERSION,
      kind: "automatic" as const,
      nominalMaxScore: declaration.nominalPoints,
    };

    if (!isAufbauProofPublicData(declaration.publicData)) {
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

    // The certificate rides in the context, not the answer: it is verified
    // here and then gone, while the answer (the proof text) is what is kept.
    const mmb = context.certificate;

    if (mmb === undefined) {
      return { ...base, awardedScore: 0, status: "invalid" };
    }

    // The certificate is verified against the frozen mm0 — never the student's
    // proofText — so a valid MMB proving the declared goal is the definition of
    // correct, however it was produced. A playground's goal is the answer's
    // own, appended to the same frozen text once it has been checked
    // (`verificationText`).
    const theory = verificationText(declaration.publicData, answer.data);

    if (!theory.ok) {
      return {
        ...base,
        awardedScore: 0,
        feedback: { diagnostics: [{ code: `playground_${theory.problem}` }] },
        status: "invalid",
      };
    }

    const result = await verifyMmb(theory.mm0, mmb);

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
    const data = proofAnswerData(answer);
    const firstLine = data.proofText.split("\n", 1)[0] ?? "";
    // A playground's header names the fixed `playground`; what a reviewer
    // wants to see is the statement the proof derived.
    const detail =
      isPlaygroundExercise(declaration.publicData) && data.goal !== undefined
        ? {
            label: context.i18n.t("Goal"),
            value: playgroundGoalText(
              isAufbauProofPublicData(declaration.publicData)
                ? declaration.publicData.source
                : null,
              data.goal,
            ),
          }
        : { label: context.i18n.t("Proof"), value: firstLine };

    return {
      details: [detail],
      elementHtml: renderAufbauProofReview(
        {
          exerciseId: declaration.id,
          proofText: data.proofText,
        },
        context.i18n,
      ),
      summary: context.i18n.t("Aufbau proof"),
    };
  }
}
