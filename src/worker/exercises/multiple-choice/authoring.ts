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
  parseExamAttribute,
  parseFeedbackAttribute,
  parsePoints,
  renderInlineMarkdown,
  renderMarkdownSource,
  requireAttribute,
  validateAttributes,
  validateExerciseId,
} from "../../application/content/authoring-toolkit";
import type {
  MultipleChoiceMode,
  MultipleChoiceOptionPublicData,
  MultipleChoicePrivateData,
  MultipleChoicePublicData,
} from "./types";
import {
  MULTIPLE_CHOICE_ANSWER_KIND,
  MULTIPLE_CHOICE_COMPONENT_METADATA,
  MULTIPLE_CHOICE_KIND,
  MULTIPLE_CHOICE_SCHEMA_VERSION,
} from "./types";

/** What `::::multiple-choice{…}` accepts beyond the shared exercise set. */
const MULTIPLE_CHOICE_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "mode",
] as const;

const OPTION_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

interface ParsedOption {
  readonly correct: boolean;
  readonly html: string;
  readonly id: string;
}

function parseMode(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): MultipleChoiceMode {
  if (value === undefined || value === "single") {
    return "single";
  }

  if (value === "multiple") {
    return "multiple";
  }

  diagnostics.push(
    diagnostic(
      line,
      "invalid_mode",
      "Multiple-choice mode must be single or multiple.",
    ),
  );

  return "single";
}

async function parseOptions(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
  renderOptions: MarkdownRenderOptions,
): Promise<{
  readonly options: ParsedOption[];
  readonly promptLines: string[];
}> {
  const options: ParsedOption[] = [];
  const promptLines: string[] = [];
  let sawOption = false;

  for (const [index, line] of block.bodyLines.entries()) {
    const lineNumber = block.bodyStartLine + index;
    const match =
      /^\s*-\s*\[([ xX])\]\s+([A-Za-z][A-Za-z0-9_-]*)\s*\|\s*(.+)$/.exec(
        line,
      );

    if (match !== null) {
      const checked = match[1] ?? " ";
      const id = match[2] ?? "";
      const label = match[3] ?? "";

      sawOption = true;

      if (!OPTION_ID_PATTERN.test(id)) {
        diagnostics.push(
          diagnostic(
            lineNumber,
            "invalid_option_id",
            "Option IDs must start with a letter and use letters, numbers, underscores, or hyphens.",
          ),
        );
      }

      if (label.trim().length === 0) {
        diagnostics.push(
          diagnostic(
            lineNumber,
            "invalid_option_label",
            "Option labels cannot be empty.",
          ),
        );
      }

      options.push({
        correct: checked.toLowerCase() === "x",
        html: await renderInlineMarkdown(label, {
          ...renderOptions,
          lineOffset: lineNumber - 1,
        }),
        id,
      });
      continue;
    }

    if (!sawOption) {
      promptLines.push(line);
      continue;
    }

    if (line.trim().length > 0) {
      diagnostics.push(
        diagnostic(
          lineNumber,
          "invalid_multiple_choice_body",
          "Only option lines may appear after the first option.",
        ),
      );
    }
  }

  return { options, promptLines };
}

function validateMultipleChoice(
  block: DirectiveBlock,
  id: string,
  mode: MultipleChoiceMode,
  options: readonly ParsedOption[],
  diagnostics: CompilerDiagnostic[],
): void {
  validateExerciseId(block, id, diagnostics);

  if (options.length < 2) {
    diagnostics.push(
      diagnostic(
        block.line,
        "not_enough_options",
        "A multiple-choice exercise requires at least two options.",
      ),
    );
  }

  const optionIds = new Set<string>();

  for (const option of options) {
    if (optionIds.has(option.id)) {
      diagnostics.push(
        diagnostic(
          block.line,
          "duplicate_option_id",
          "Option ID {id} is used more than once in this exercise.",
          { params: { id: option.id } },
        ),
      );
    }

    optionIds.add(option.id);
  }

  const correctCount = options.filter((option) => option.correct).length;

  if (mode === "single" && correctCount !== 1) {
    diagnostics.push(
      diagnostic(
        block.line,
        "invalid_answer_key",
        "Single-select exercises must have exactly one correct option.",
      ),
    );
  }

  if (mode === "multiple" && correctCount < 1) {
    diagnostics.push(
      diagnostic(
        block.line,
        "invalid_answer_key",
        "Multiple-select exercises must have at least one correct option.",
      ),
    );
  }
}

export async function compileMultipleChoice(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
  renderOptions: MarkdownRenderOptions,
): Promise<CompiledExercise | null> {
  validateAttributes(block, MULTIPLE_CHOICE_ATTRIBUTES, diagnostics);

  const id = requireAttribute(block, "id", diagnostics);
  const points = parsePoints(block.attrs.points, block.line, diagnostics);
  const mode = parseMode(block.attrs.mode, block.line, diagnostics);
  const title = block.attrs.title?.trim();
  const exam = parseExamAttribute(block.attrs.exam, block.line, diagnostics);
  const feedback = parseFeedbackAttribute(block, diagnostics);
  const parsed = await parseOptions(block, diagnostics, renderOptions);

  if (id === null) {
    return null;
  }

  validateMultipleChoice(block, id, mode, parsed.options, diagnostics);

  const publicOptions: MultipleChoiceOptionPublicData[] = parsed.options.map(
    (option) => ({ html: option.html, id: option.id }),
  );
  const publicData: MultipleChoicePublicData = {
    mode,
    options: publicOptions,
    promptHtml: await renderMarkdownSource(parsed.promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
  };
  const privateData: MultipleChoicePrivateData = {
    correctOptionIds: parsed.options
      .filter((option) => option.correct)
      .map((option) => option.id),
    mode,
  };

  return buildCompiledExercise({
    answerKind: MULTIPLE_CHOICE_ANSWER_KIND,
    capabilities: {
      supportsAutomaticEvaluation: true,
      supportsManualReview: true,
    },
    exam,
    feedback,
    id,
    kind: MULTIPLE_CHOICE_KIND,
    nominalPoints: points,
    privateData,
    publicData,
    render: MULTIPLE_CHOICE_COMPONENT_METADATA,
    schemaVersion: MULTIPLE_CHOICE_SCHEMA_VERSION,
    title,
  });
}
