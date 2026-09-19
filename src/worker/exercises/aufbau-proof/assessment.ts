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
  normalizeProofAnswer,
} from "../../exercise-kit/proof/assessment";
import {
  isPlaygroundExercise,
  playgroundGoalText,
} from "../../exercise-kit/proof/playground";
import type { ExerciseAssessment } from "../../exercise-kit/type";
import { renderAufbauProofReview } from "./read-only-view";
import type { AufbauProofAnswerData } from "./types";
import {
  AUFBAU_PROOF_ANSWER_KIND,
  AUFBAU_PROOF_SCHEMA_VERSION,
  isAufbauProofAnswerData,
  isAufbauProofPublicData,
} from "./types";

/** The linear answer is the `.auf` itself: nothing kept beside `proofText`. */
const SHAPE: ProofAnswerShape<AufbauProofAnswerData> = {
  answerKind: AUFBAU_PROOF_ANSWER_KIND,
  evaluatorVersion: "aufbau-proof-verifier@1",
  isAnswerData: isAufbauProofAnswerData,
  isPublicData: isAufbauProofPublicData,
  needs: "A proof answer needs a proofText string and a base64 mmb string.",
  schemaVersion: AUFBAU_PROOF_SCHEMA_VERSION,
};

function proofAnswerData(answer: NormalizedAnswer): AufbauProofAnswerData {
  return answer.data as unknown as AufbauProofAnswerData;
}

export const AUFBAU_PROOF_ASSESSMENT = {
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
  },
} satisfies ExerciseAssessment;
