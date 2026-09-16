import { verifyMmb } from "#proof-verifier";
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
// The certificate is the trust boundary, so the Fitch type reuses the linear
// type's verifier binding verbatim (verify against our frozen mm0, never the
// student's Fitch text or the translated proof).
import {
  goalStatementText,
  proofRuleSpellings,
  proofTheoryText,
} from "../../exercise-kit/proof/formulas";
import {
  answerGoal,
  isPlaygroundExercise,
  playgroundGoalText,
  verificationText,
} from "../../exercise-kit/proof/playground";
import type { ExerciseAssessment } from "../../exercise-kit/type";
import { renderAufbauProofFitchReview } from "./read-only-view";
import type {
  AufbauProofFitchAnswerData,
  AufbauProofFitchPublicData,
} from "./types";
import {
  AUFBAU_PROOF_FITCH_ANSWER_KIND,
  AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
  DEFAULT_ASSUMPTION_RULE,
  isAufbauProofFitchAnswerData,
  isAufbauProofFitchPublicData,
} from "./types";

const AUFBAU_PROOF_FITCH_EVALUATOR_VERSION = "aufbau-proof-fitch-verifier@1";

/** Generous caps so an intro proof passes but a submission can't be unbounded. */
const MAX_PROOF_TEXT_LENGTH = 65_536;
const MAX_FITCH_TEXT_LENGTH = 65_536;

function fitchAnswerData(
  answer: NormalizedAnswer,
): AufbauProofFitchAnswerData {
  return answer.data as unknown as AufbauProofFitchAnswerData;
}

/**
 * The goal a review names, in the terms the student was asked it: the statement
 * the theorem declares, not the theorem's name. The name is the engine's handle
 * on the goal and means nothing to a reader — least of all here, where it sits
 * beside the exercise id it is free to differ from.
 *
 * A playground was asked nothing, and its goal is the one the answer derived
 * — the statement the recorded verdict is about.
 *
 * The name is still the fallback, as it was the whole of this line before, for
 * a declaration this artifact's text does not carry.
 */
function reviewGoal(
  publicData: AufbauProofFitchPublicData | null,
  answer: AufbauProofFitchAnswerData,
  declaration: ExerciseManifestItem,
): string {
  if (publicData === null) {
    return declaration.id;
  }

  const theory = proofTheoryText(publicData);

  if (isPlaygroundExercise(publicData)) {
    return answer.goal === undefined
      ? declaration.id
      : playgroundGoalText(theory.source, answer.goal);
  }

  return (
    goalStatementText(theory.source, publicData.goalName) ??
    publicData.goalName
  );
}

export const AUFBAU_PROOF_FITCH_ASSESSMENT = {
  normalizeAnswer(
    envelope: AnswerEnvelope,
    declaration: ExerciseManifestItem,
  ): AnswerNormalizationResult {
    if (envelope.kind !== AUFBAU_PROOF_FITCH_ANSWER_KIND) {
      return {
        diagnostics: [
          diagnostic(
            "wrong_answer_kind",
            `Expected answer kind ${AUFBAU_PROOF_FITCH_ANSWER_KIND}.`,
            ["kind"],
          ),
        ],
        ok: false,
        reason: "wrong-kind",
      };
    }

    if (envelope.schemaVersion !== AUFBAU_PROOF_FITCH_SCHEMA_VERSION) {
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

    const certificate = readCertificate(envelope.data);

    if (
      certificate === undefined ||
      certificate === null ||
      envelope.data.proofText.length > MAX_PROOF_TEXT_LENGTH ||
      envelope.data.fitchText.length > MAX_FITCH_TEXT_LENGTH
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
          fitchText: envelope.data.fitchText,
          ...(goal === undefined ? {} : { goal }),
          proofText: envelope.data.proofText,
        } as unknown as JsonValue,
        kind: AUFBAU_PROOF_FITCH_ANSWER_KIND,
        schemaVersion: AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
      },
      certificate,
      ok: true,
    };
  },

  async evaluate(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    context: EvaluationContext,
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

    // The certificate rides in the context, not the answer: it is verified
    // here and then gone, while the answer (the two texts) is what is kept.
    const mmb = context.certificate;

    if (mmb === undefined) {
      return { ...base, awardedScore: 0, status: "invalid" };
    }

    // The certificate is verified against the frozen mm0 — never the student's
    // Fitch text or the translated proof — so a valid MMB proving the declared
    // goal is the definition of correct, however the proof was written. A
    // playground's goal is the answer's own, appended to the same frozen text
    // once it has been checked (`verificationText`).
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
  },

  reviewAnswer(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    context: ExerciseReviewContext,
  ): ExerciseAnswerReview {
    const data = fitchAnswerData(answer);
    const publicData = isAufbauProofFitchPublicData(declaration.publicData)
      ? declaration.publicData
      : null;
    return {
      details: [
        {
          label: context.i18n.t("Goal"),
          value: reviewGoal(publicData, data, declaration),
        },
      ],
      elementHtml: renderAufbauProofFitchReview(
        {
          assumptionRule:
            publicData?.assumptionRule ?? DEFAULT_ASSUMPTION_RULE,
          assumptionSpellings:
            publicData === null
              ? []
              : proofRuleSpellings(
                  proofTheoryText(publicData).source,
                  publicData.assumptionRule,
                ),
          exerciseId: declaration.id,
          fitchText: data.fitchText,
        },
        context.i18n,
      ),
      summary: context.i18n.t("Aufbau Fitch proof"),
    };
  },
} satisfies ExerciseAssessment;
