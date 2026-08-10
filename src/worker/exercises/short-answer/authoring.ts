import type {
  CompiledExercise,
  CompilerDiagnostic,
  DirectiveBlock,
  MarkdownRenderOptions,
} from "../../application/content/authoring-toolkit";
import {
  buildCompiledExercise,
  COMMON_EXERCISE_ATTRIBUTES,
  diagnostic,
  parseBooleanAttribute,
  parseExamAttribute,
  parseFeedbackAttribute,
  parsePoints,
  renderMarkdownChildren,
  requireAttribute,
  validateAttributes,
  validateExerciseId,
} from "../../application/content/authoring-toolkit";
import type { ShortAnswerPrivateData, ShortAnswerPublicData } from "./types";
import {
  SHORT_ANSWER_ANSWER_KIND,
  SHORT_ANSWER_COMPONENT_METADATA,
  SHORT_ANSWER_KIND,
  SHORT_ANSWER_SCHEMA_VERSION,
} from "./types";

function parseAcceptedAnswers(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): string[] {
  const raw = block.attrs.answers ?? block.attrs.answer;

  if (raw === undefined || raw.trim().length === 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        "missing_answer",
        "A short-answer exercise requires answer or answers.",
      ),
    );

    return [];
  }

  const answers = raw
    .split("|")
    .map((answer) => answer.trim())
    .filter((answer) => answer.length > 0);

  if (answers.length === 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        "invalid_answer_key",
        "A short-answer exercise needs at least one accepted answer.",
      ),
    );
  }

  return [...new Set(answers)];
}

/** What `::::short-answer{…}` accepts beyond the shared exercise set. */
const SHORT_ANSWER_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "answer",
  "answers",
  "case-sensitive",
] as const;

export async function compileShortAnswer(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
  renderOptions: MarkdownRenderOptions,
): Promise<CompiledExercise | null> {
  validateAttributes(block, SHORT_ANSWER_ATTRIBUTES, diagnostics);

  const id = requireAttribute(block, "id", diagnostics);
  const points = parsePoints(block.attrs.points, block.line, diagnostics);
  const title = block.attrs.title?.trim();
  const acceptedAnswers = parseAcceptedAnswers(block, diagnostics);
  const caseSensitive = parseBooleanAttribute(
    block.attrs["case-sensitive"],
    block.line,
    "case-sensitive",
    diagnostics,
  );
  const exam = parseExamAttribute(block.attrs.exam, block.line, diagnostics);
  const feedback = parseFeedbackAttribute(block, diagnostics);

  if (id === null) {
    return null;
  }

  validateExerciseId(block, id, diagnostics);

  const publicData: ShortAnswerPublicData = {
    promptHtml: await renderMarkdownChildren(block.children, renderOptions),
  };
  const privateData: ShortAnswerPrivateData = {
    acceptedAnswers,
    caseSensitive,
  };

  return buildCompiledExercise({
    answerKind: SHORT_ANSWER_ANSWER_KIND,
    capabilities: {
      supportsAutomaticEvaluation: true,
      supportsManualReview: true,
    },
    exam,
    feedback,
    id,
    kind: SHORT_ANSWER_KIND,
    nominalPoints: points,
    privateData,
    publicData,
    render: SHORT_ANSWER_COMPONENT_METADATA,
    schemaVersion: SHORT_ANSWER_SCHEMA_VERSION,
    title,
  });
}
