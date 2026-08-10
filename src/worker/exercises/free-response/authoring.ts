import type {
  CompiledExercise,
  CompilerDiagnostic,
  DirectiveBlock,
  MarkdownRenderOptions,
} from "../../application/content/authoring-toolkit";
import {
  buildCompiledExercise,
  COMMON_EXERCISE_ATTRIBUTES,
  parseExamAttribute,
  parseFeedbackAttribute,
  parsePoints,
  renderInlineMarkdown,
  renderMarkdownChildren,
  requireAttribute,
  validateAttributes,
  validateExerciseId,
} from "../../application/content/authoring-toolkit";
import type {
  FreeResponsePrivateData,
  FreeResponsePublicData,
} from "./types";
import {
  FREE_RESPONSE_ANSWER_KIND,
  FREE_RESPONSE_COMPONENT_METADATA,
  FREE_RESPONSE_KIND,
  FREE_RESPONSE_SCHEMA_VERSION,
} from "./types";

/** What `::::free-response{…}` accepts beyond the shared exercise set. */
const FREE_RESPONSE_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "rubric",
] as const;

export async function compileFreeResponse(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
  renderOptions: MarkdownRenderOptions,
): Promise<CompiledExercise | null> {
  validateAttributes(block, FREE_RESPONSE_ATTRIBUTES, diagnostics);

  const id = requireAttribute(block, "id", diagnostics);
  const points = parsePoints(block.attrs.points, block.line, diagnostics);
  const title = block.attrs.title?.trim();
  const rubric = block.attrs.rubric?.trim();
  const exam = parseExamAttribute(block.attrs.exam, block.line, diagnostics);
  const feedback = parseFeedbackAttribute(block, diagnostics);

  if (id === null) {
    return null;
  }

  validateExerciseId(block, id, diagnostics);

  const publicData: FreeResponsePublicData = {
    promptHtml: await renderMarkdownChildren(block.children, renderOptions),
  };
  const privateData: FreeResponsePrivateData =
    rubric === undefined || rubric.length === 0
      ? {}
      : {
          // The rubric is an attribute, so anything wrong with it — a formula
          // that will not parse, say — is wrong on the directive's own line.
          rubricHtml: await renderInlineMarkdown(rubric, {
            ...renderOptions,
            lineOffset: block.line - 1,
          }),
        };

  return buildCompiledExercise({
    answerKind: FREE_RESPONSE_ANSWER_KIND,
    capabilities: {
      supportsAutomaticEvaluation: false,
      supportsManualReview: true,
    },
    exam,
    feedback,
    id,
    kind: FREE_RESPONSE_KIND,
    nominalPoints: points,
    privateData,
    publicData,
    render: FREE_RESPONSE_COMPONENT_METADATA,
    schemaVersion: FREE_RESPONSE_SCHEMA_VERSION,
    title,
  });
}
