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
  MAX_TREE_JSON_LENGTH,
  normalizeProofAnswer,
} from "../../exercise-kit/proof/assessment";
import { proofTheoryText } from "../../exercise-kit/proof/formulas";
import {
  isPlaygroundExercise,
  playgroundGoalText,
} from "../../exercise-kit/proof/playground";
import type { ExerciseAssessment } from "../../exercise-kit/type";
import { renderAufbauProofTreeReview } from "./read-only-view";
import type { AufbauProofTreeAnswerData } from "./types";
import {
  AUFBAU_PROOF_TREE_ANSWER_KIND,
  AUFBAU_PROOF_TREE_SCHEMA_VERSION,
  aufbauProofTreeName,
  isAufbauProofTreeAnswerData,
  isAufbauProofTreePublicData,
} from "./types";

const SHAPE: ProofAnswerShape<AufbauProofTreeAnswerData> = {
  answerKind: AUFBAU_PROOF_TREE_ANSWER_KIND,
  evaluatorVersion: "aufbau-proof-tree-verifier@1",
  isAnswerData: isAufbauProofTreeAnswerData,
  isPublicData: isAufbauProofTreePublicData,
  needs:
    "A tree proof answer needs a base64 mmb, a proofText string, and a tree.",
  own: (data) => ({
    fields: { tree: data.tree },
    withinCaps: JSON.stringify(data.tree).length <= MAX_TREE_JSON_LENGTH,
  }),
  schemaVersion: AUFBAU_PROOF_TREE_SCHEMA_VERSION,
};

function treeAnswerData(answer: NormalizedAnswer): AufbauProofTreeAnswerData {
  return answer.data as unknown as AufbauProofTreeAnswerData;
}

/**
 * What the review names beside the drawn tree: the root's formula, as the
 * student wrote it, or — for a playground, which was asked nothing — the goal
 * the answer derived, which is the statement the recorded verdict is about.
 */
function reviewDetail(
  data: AufbauProofTreeAnswerData,
  declaration: ExerciseManifestItem,
  context: ExerciseReviewContext,
): { readonly label: string; readonly value: string } {
  if (
    isPlaygroundExercise(declaration.publicData) &&
    data.goal !== undefined
  ) {
    return {
      label: context.i18n.t("Goal"),
      value: playgroundGoalText(
        isAufbauProofTreePublicData(declaration.publicData)
          ? proofTheoryText(declaration.publicData).source
          : null,
        data.goal,
      ),
    };
  }

  return { label: context.i18n.t("Proof"), value: data.tree.formula };
}

export const AUFBAU_PROOF_TREE_ASSESSMENT = {
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
    const data = treeAnswerData(answer);

    return {
      details: [reviewDetail(data, declaration, context)],
      elementHtml: renderAufbauProofTreeReview(
        {
          exerciseId: declaration.id,
          tree: data.tree,
        },
        context.i18n,
      ),
      summary: aufbauProofTreeName(context.i18n),
    };
  },
} satisfies ExerciseAssessment;
