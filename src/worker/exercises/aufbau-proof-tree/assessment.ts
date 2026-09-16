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
import { readCertificate } from "../aufbau-proof/certificate";
// The certificate is the trust boundary, so the tree type reuses the linear
// type's verifier binding verbatim (verify against our frozen mm0, never the
// student's tree).
import { proofTheoryText } from "../aufbau-proof/formulas";
import {
  answerGoal,
  isPlaygroundExercise,
  playgroundGoalText,
  verificationText,
} from "../aufbau-proof/playground";
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
const MAX_PROOF_TEXT_LENGTH = 65_536;
const MAX_TREE_JSON_LENGTH = 131_072;

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

    const certificate = readCertificate(envelope.data);

    if (
      certificate === undefined ||
      certificate === null ||
      envelope.data.proofText.length > MAX_PROOF_TEXT_LENGTH ||
      JSON.stringify(envelope.data.tree).length > MAX_TREE_JSON_LENGTH
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
          tree: envelope.data.tree,
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

    // The certificate rides in the context, not the answer: it is verified
    // here and then gone, while the answer (the tree and its text) is kept.
    const mmb = context.certificate;

    if (mmb === undefined) {
      return { ...base, awardedScore: 0, status: "invalid" };
    }

    // The certificate is verified against the frozen mm0 — never the student's
    // tree or proofText — so a valid MMB proving the declared goal is the
    // definition of correct, however the tree that produced it was built. A
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
  }

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
      summary: context.i18n.t("Aufbau tree proof"),
    };
  }
}
