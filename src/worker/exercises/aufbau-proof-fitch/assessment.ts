import type {
  AnswerEnvelope,
  EvaluationContext,
  ExerciseAnswerReview,
  ExerciseManifestItem,
  ExerciseReviewContext,
  NormalizedAnswer,
} from "../../domain/content";
import type { ProofAnswerShape } from "../../exercise-kit/proof/assessment";
import {
  evaluateProofCertificate,
  MAX_PROOF_TEXT_LENGTH,
  normalizeProofAnswer,
} from "../../exercise-kit/proof/assessment";
import {
  goalStatementText,
  proofRuleSpellings,
  proofTheoryText,
} from "../../exercise-kit/proof/formulas";
import {
  isPlaygroundExercise,
  playgroundGoalText,
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

/** The Fitch text the student wrote is kept beside the `.auf` it translated
 *  to, under the same generous cap. */
const MAX_FITCH_TEXT_LENGTH = MAX_PROOF_TEXT_LENGTH;

const SHAPE: ProofAnswerShape<AufbauProofFitchAnswerData> = {
  answerKind: AUFBAU_PROOF_FITCH_ANSWER_KIND,
  evaluatorVersion: "aufbau-proof-fitch-verifier@1",
  isAnswerData: isAufbauProofFitchAnswerData,
  isPublicData: isAufbauProofFitchPublicData,
  needs:
    "A Fitch proof answer needs a base64 mmb, a proofText, and a fitchText.",
  own: (data) => ({
    fields: { fitchText: data.fitchText },
    withinCaps: data.fitchText.length <= MAX_FITCH_TEXT_LENGTH,
  }),
  schemaVersion: AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
};

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
  ) {
    return normalizeProofAnswer(SHAPE, envelope, declaration);
  },

  evaluate(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    context: EvaluationContext,
  ) {
    return evaluateProofCertificate(SHAPE, answer, declaration, context);
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
