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
import type { ExerciseAssessment } from "../../exercise-kit/type";
import { stringsResolver } from "../../i18n/translator";
import {
  answerRules,
  isTruthTreeAnswerData,
  isTruthTreePublicData,
  judgeTree,
  resolveTruthTree,
  treeProofOf,
} from "./grading";
import { renderTruthTreeReview } from "./read-only-view";
import { buildTruthTreeStrings } from "./strings";
import type { TruthTreeAnswerData } from "./types";
import {
  TRUTH_TREE_ANSWER_KIND,
  TRUTH_TREE_SCHEMA_VERSION,
  truthTreeName,
} from "./types";
import { describeJudgement } from "./verdict-text";

/**
 * `@2` since the engine checks a tree's steps (gh #46): the browser's
 * certificate is verified against a goal written here from the stored tree.
 */
const TRUTH_TREE_EVALUATOR_VERSION = "truth-tree-evaluator@2";

/**
 * The longest certificate a tree may carry, as base64: far past the proof
 * types' cap, because a tree's grows faster than its rows. Each step restates
 * its branch, and a first-order step carries its instance's normalization
 * through the whole branch, so one 48-row first-order branch is 3.3 MB and a
 * 55-row one 5 MB. Verifying is cheap at that size (about 50 ms in workerd for
 * 5 MB, decoding included); the cost is the student's upload.
 */
const MAX_TREE_CERTIFICATE_LENGTH = 8 * 1024 * 1024;

function treeAnswer(answer: NormalizedAnswer): TruthTreeAnswerData {
  return answer.data as unknown as TruthTreeAnswerData;
}

export const TRUTH_TREE_ASSESSMENT = {
  normalizeAnswer(
    envelope: AnswerEnvelope,
    declaration: ExerciseManifestItem,
  ): AnswerNormalizationResult {
    if (envelope.kind !== TRUTH_TREE_ANSWER_KIND) {
      return {
        diagnostics: [
          diagnostic(
            "wrong_answer_kind",
            `Expected answer kind ${TRUTH_TREE_ANSWER_KIND}.`,
            ["kind"],
          ),
        ],
        ok: false,
        reason: "wrong-kind",
      };
    }

    if (envelope.schemaVersion !== TRUTH_TREE_SCHEMA_VERSION) {
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

    if (!isObject(envelope.data) || !isTruthTreeAnswerData(envelope.data)) {
      return {
        diagnostics: [
          diagnostic(
            "malformed_answer_data",
            "A truth-tree answer is a list of nodes, each a run of rows.",
            ["data"],
          ),
        ],
        ok: false,
        reason: "malformed",
      };
    }

    if (!isTruthTreePublicData(declaration.publicData)) {
      return {
        diagnostics: [
          diagnostic(
            "answer_shape_mismatch",
            "The submitted answer does not match the exercise's shape.",
            ["data"],
          ),
        ],
        ok: false,
        reason: "schema-invalid",
      };
    }

    // A wrong row, a wrong closure or an unfinished tree is a valid wrong
    // answer, scored zero with the reason: only JSON of the wrong
    // shape is refused here. The tree is kept as it came, so review shows
    // what was submitted. The certificate, the browser's compile of it, rides
    // beside the answer to be verified and let go; a tree never compiled has
    // none, and is graded without one.
    const data = envelope.data;
    const certificate = readCertificate(data, MAX_TREE_CERTIFICATE_LENGTH);

    if (certificate === null) {
      return {
        diagnostics: [
          diagnostic(
            "malformed_answer_data",
            "The tree's certificate is malformed or too large.",
            ["data", "mmb"],
          ),
        ],
        ok: false,
        reason: "malformed",
      };
    }

    return {
      answer: {
        data: {
          nodes: data.nodes,
          ...(data.rules === undefined ? {} : { rules: data.rules }),
          ...(data.instances === undefined
            ? {}
            : { instances: data.instances }),
          ...(data.directions === undefined
            ? {}
            : { directions: data.directions }),
        } as unknown as JsonValue,
        kind: TRUTH_TREE_ANSWER_KIND,
        schemaVersion: TRUTH_TREE_SCHEMA_VERSION,
      },
      ...(certificate === undefined ? {} : { certificate }),
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
      evaluatorVersion: TRUTH_TREE_EVALUATOR_VERSION,
      kind: "automatic" as const,
      nominalMaxScore: declaration.nominalPoints,
    };

    if (!isTruthTreePublicData(declaration.publicData)) {
      return {
        ...base,
        awardedScore: 0,
        feedback: {
          diagnostics: [{ code: "invalid_declaration_public_data" }],
        },
        status: "error",
      };
    }

    const resolved = resolveTruthTree(declaration.publicData);

    // Stored data that no longer reads is as invalid as data of the wrong
    // shape: this compiler never writes it.
    if (resolved === null) {
      return {
        ...base,
        awardedScore: 0,
        feedback: {
          diagnostics: [{ code: "invalid_declaration_public_data" }],
        },
        status: "error",
      };
    }

    // The goal is written here, from the stored tree and the frozen theory,
    // never taken from the browser; the certificate must prove exactly it.
    const data = treeAnswer(answer);
    const proof = treeProofOf(resolved, data);
    const mm0 = declaration.publicData.mm0;
    const mmb = context.certificate;
    let verified = false;

    if (mmb !== undefined && proof.goal !== null && mm0 !== undefined) {
      const result = await verifyMmb(`${mm0}\n${proof.goal}\n`, mmb);

      if (result.errored) {
        return {
          ...base,
          awardedScore: 0,
          feedback: { verified: false },
          status: "error",
        };
      }

      verified = result.ok;
    }

    const judgement = judgeTree(
      resolved,
      data,
      { kind: "verified", ok: verified },
      proof,
    );

    // All or nothing: a tree with one wrong row is not mostly right. The
    // engine's word is kept as the proof types keep it, since the certificate
    // is not: without it a review can no longer tell what only it could say.
    return {
      ...base,
      awardedScore: judgement.ok ? declaration.nominalPoints : 0,
      feedback: { verified },
      status: judgement.ok ? "correct" : "incorrect",
    };
  },

  reviewAnswer(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    context: ExerciseReviewContext,
  ): ExerciseAnswerReview {
    const i18n = context.i18n;

    if (!isTruthTreePublicData(declaration.publicData)) {
      return { summary: truthTreeName(i18n) };
    }

    const resolved = resolveTruthTree(declaration.publicData);

    if (resolved === null) {
      return { summary: truthTreeName(i18n) };
    }

    const data = treeAnswer(answer);
    // The certificate is not kept, so a review judges what it can without
    // the engine, and says nothing of what only the engine could tell.
    const judgement = judgeTree(resolved, data, { kind: "none" });
    const words = stringsResolver(buildTruthTreeStrings(i18n));
    // There is no answer key: the verdict is recomputed from the tree, so
    // sealing the evaluation alone would leave it on the page.
    const reveal = context.revealCorrectness !== false;
    const detail = declaration.feedback !== "terse";
    const summary = describeJudgement(
      judgement,
      { nodes: data.nodes },
      answerRules(data),
      words,
      detail,
    );

    return {
      ...(reveal && summary !== ""
        ? { details: [{ label: i18n.t("Result"), value: summary }] }
        : {}),
      elementHtml: renderTruthTreeReview(
        {
          answer: data,
          exerciseId: declaration.id,
          judgement,
          // Marks say which rows are right: drawn only where the verdict
          // may name the first problem.
          marks: reveal && detail,
          resolved,
          verdict: reveal ? summary : "",
        },
        words,
      ),
      summary: reveal && summary !== "" ? summary : truthTreeName(i18n),
    };
  },
} satisfies ExerciseAssessment;
