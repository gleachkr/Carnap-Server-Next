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
import type { ExerciseAssessment } from "../../exercise-kit/type";
import { stringsResolver } from "../../i18n/translator";
import {
  isTruthTreeAnswerData,
  isTruthTreePublicData,
  judgeTree,
  resolveTruthTree,
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

const TRUTH_TREE_EVALUATOR_VERSION = "truth-tree-evaluator@1";

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
    // what was submitted.
    const data = envelope.data;

    return {
      answer: {
        data: (data.rules === undefined
          ? { nodes: data.nodes }
          : { nodes: data.nodes, rules: data.rules }) as unknown as JsonValue,
        kind: TRUTH_TREE_ANSWER_KIND,
        schemaVersion: TRUTH_TREE_SCHEMA_VERSION,
      },
      ok: true,
    };
  },

  async evaluate(
    answer: NormalizedAnswer,
    declaration: ExerciseManifestItem,
    _context: EvaluationContext,
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

    if (resolved === null) {
      return { ...base, awardedScore: 0, status: "error" };
    }

    const judgement = judgeTree(resolved, treeAnswer(answer));

    // All or nothing: a tree with one wrong row is not mostly right.
    return {
      ...base,
      awardedScore: judgement.ok ? declaration.nominalPoints : 0,
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
    const judgement = judgeTree(resolved, data);
    const words = stringsResolver(buildTruthTreeStrings(i18n));
    // There is no answer key: the verdict is recomputed from the tree, so
    // sealing the evaluation alone would leave it on the page.
    const reveal = context.revealCorrectness !== false;
    const detail = declaration.feedback !== "terse";
    const summary = describeJudgement(
      judgement,
      { nodes: data.nodes },
      words,
      detail,
    );

    return {
      ...(reveal
        ? { details: [{ label: i18n.t("Result"), value: summary }] }
        : {}),
      elementHtml: renderTruthTreeReview(
        {
          answer: data,
          exerciseId: declaration.id,
          judgement,
          resolved,
          verdict: reveal ? summary : "",
        },
        words,
      ),
      summary: reveal ? summary : truthTreeName(i18n),
    };
  },
} satisfies ExerciseAssessment;
