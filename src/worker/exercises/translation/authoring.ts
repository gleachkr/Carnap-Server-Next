import type { SurfaceLanguage } from "@aufbau/syntax";
import {
  type CompilerDiagnostic,
  diagnostic,
} from "../../application/content/diagnostics";
import { renderMarkdownSource } from "../../application/content/markdown";
import {
  buildCompiledExercise,
  COMMON_EXERCISE_ATTRIBUTES,
  type CompiledExercise,
  type DirectiveBlock,
  parseExamAttribute,
  parsePoints,
  reconcileFeedback,
  requireAttribute,
  validateAttributes,
  validateExerciseId,
} from "../../exercise-kit/authoring";
import {
  DEFAULT_LANGUAGE_ID,
  formulaToString,
  parseFormula,
  splitFormulaList,
} from "../../exercise-kit/formula";
import { parseSystemAttribute } from "../../exercise-kit/systems/attribute";
import type { ExerciseCompileContext } from "../../exercise-kit/type";
import type { TranslationTest } from "./logic/tests";
import { parseTranslationTests } from "./logic/tests";
import { isPropositional } from "./logic/variant";
import type { TranslationPublicData, TranslationVariant } from "./types";
import {
  TRANSLATION_ANSWER_KIND,
  TRANSLATION_CAPABILITIES,
  TRANSLATION_COMPONENT_METADATA,
  TRANSLATION_KIND,
  TRANSLATION_SCHEMA_VERSION,
} from "./types";

const SOLUTION_LINE = /^\s*-\s+(.+?)\s*$/;

/**
 * The bare-flag vocabulary Carnap accepts in a translation option string:
 * `nocheck` (this type's spelling of `feedback="none"`) and `checksyntax`
 * (under exam, refuse to submit text that does not parse). `exam` is an
 * attribute here rather than a flag. Anything else is a typo and is rejected.
 */
const KNOWN_OPTION_FLAGS: ReadonlySet<string> = new Set([
  "checksyntax",
  "nocheck",
]);

function parseVariant(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): TranslationVariant {
  if (
    value === undefined ||
    value === "prop" ||
    value === "first-order" ||
    value === "exact"
  ) {
    return value ?? "prop";
  }

  diagnostics.push(
    diagnostic(
      line,
      "unsupported_translation_variant",
      "The variant attribute must be prop, first-order, or exact.",
    ),
  );

  return "prop";
}

interface OptionFlags {
  readonly checksyntax: boolean;
  readonly nocheck: boolean;
}

function parseOptionFlags(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): OptionFlags {
  const flags = new Set<string>();

  for (const token of (value ?? "").split(/\s+/)) {
    if (token.length === 0) {
      continue;
    }

    if (!KNOWN_OPTION_FLAGS.has(token)) {
      diagnostics.push(
        diagnostic(
          line,
          "unknown_translation_option",
          "Unknown translation option “{option}”.",
          { params: { option: token } },
        ),
      );
      continue;
    }

    flags.add(token);
  }

  return {
    checksyntax: flags.has("checksyntax"),
    nocheck: flags.has("nocheck"),
  };
}

/** The `tests=` attribute, with each unknown token named to the author. */
function parseTests(
  value: string | undefined,
  variant: TranslationVariant,
  line: number,
  diagnostics: CompilerDiagnostic[],
): readonly TranslationTest[] {
  const parsed = parseTranslationTests(value ?? "");

  for (const token of parsed.unknown) {
    diagnostics.push(
      diagnostic(
        line,
        "unknown_translation_test",
        "Unknown translation test “{test}”.",
        { params: { test: token } },
      ),
    );
  }

  if (
    variant === "prop" &&
    parsed.tests.some((test) => test.kind === "pnf")
  ) {
    diagnostics.push(
      diagnostic(
        line,
        "pnf_needs_first_order",
        "The PNF test applies only to first-order translations.",
      ),
    );
  }

  return parsed.tests;
}

interface TranslationBody {
  readonly promptLines: readonly string[];
  readonly solutions: readonly string[];
}

/**
 * Prose — the sentence to symbolize — then `- formula` list items, one
 * admissible solution per item. A single item may hold Carnap's
 * comma-separated alternates; the split respects brackets so `R(a,b)` stays
 * whole.
 */
function parseBody(
  block: DirectiveBlock,
  language: SurfaceLanguage,
  variant: TranslationVariant,
  diagnostics: CompilerDiagnostic[],
): TranslationBody {
  const promptLines: string[] = [];
  const solutions: string[] = [];

  for (const [index, line] of block.bodyLines.entries()) {
    const lineNumber = block.bodyStartLine + index;
    const match = SOLUTION_LINE.exec(line);

    if (match === null) {
      if (solutions.length === 0) {
        promptLines.push(line);
      } else if (line.trim().length > 0) {
        diagnostics.push(
          diagnostic(
            lineNumber,
            "invalid_translation_body",
            "Only solution list items may appear after the first solution.",
          ),
        );
      }

      continue;
    }

    for (const piece of splitFormulaList(match[1] ?? "")) {
      const trimmed = piece.trim();

      if (trimmed.length === 0) {
        continue;
      }

      const parsed = parseFormula(trimmed, language);

      if (!parsed.ok) {
        diagnostics.push(
          diagnostic(
            lineNumber,
            "invalid_formula",
            "Could not parse formula “{formula}”: {detail}",
            {
              params: {
                detail: parsed.errors[0] ?? { message: "syntax error" },
                formula: trimmed,
              },
            },
          ),
        );
        continue;
      }

      if (variant === "prop" && !isPropositional(parsed.formula)) {
        diagnostics.push(
          diagnostic(
            lineNumber,
            "non_propositional_solution",
            "“{formula}” is not propositional; a prop translation uses sentence letters and connectives only.",
            { params: { formula: trimmed } },
          ),
        );
        continue;
      }

      solutions.push(formulaToString(parsed.formula, language));
    }
  }

  return { promptLines, solutions };
}

/** What `::::translation{…}` accepts beyond the shared exercise set. */
const TRANSLATION_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "options",
  "starter",
  "system",
  "tests",
  "variant",
] as const;

export async function compileTranslation(
  block: DirectiveBlock,
  context: ExerciseCompileContext,
): Promise<CompiledExercise | null> {
  const { diagnostics, renderOptions, resolveSystem } = context;
  validateAttributes(block, TRANSLATION_ATTRIBUTES, diagnostics);

  const id = requireAttribute(block, "id", diagnostics);
  const points = parsePoints(block.attrs.points, block.line, diagnostics);
  const variant = parseVariant(block.attrs.variant, block.line, diagnostics);
  const { language, system } = parseSystemAttribute(
    block,
    resolveSystem,
    diagnostics,
    { defaultId: DEFAULT_LANGUAGE_ID },
  );
  const flags = parseOptionFlags(
    block.attrs.options,
    block.line,
    diagnostics,
  );
  const tests = parseTests(
    block.attrs.tests,
    variant,
    block.line,
    diagnostics,
  );
  const title = block.attrs.title?.trim();
  const exam = parseExamAttribute(block.attrs.exam, block.line, diagnostics);
  const starter = block.attrs.starter;
  const body = parseBody(block, language, variant, diagnostics);

  if (id === null) {
    return null;
  }

  validateExerciseId(block, id, diagnostics);

  const feedback = reconcileFeedback(
    block,
    flags.nocheck ? "none" : undefined,
    diagnostics,
  );

  if (body.solutions.length === 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        "empty_translation_exercise",
        "A translation exercise requires at least one solution formula.",
      ),
    );
  }

  const publicData: TranslationPublicData = {
    checksyntax: flags.checksyntax,
    promptHtml: await renderMarkdownSource(body.promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    solutions: body.solutions,
    ...(starter === undefined ? {} : { starter }),
    system,
    tests,
    variant,
  };

  return buildCompiledExercise({
    answerKind: TRANSLATION_ANSWER_KIND,
    capabilities: TRANSLATION_CAPABILITIES,
    exam,
    feedback,
    id,
    kind: TRANSLATION_KIND,
    nominalPoints: points,
    privateData: {},
    publicData,
    render: TRANSLATION_COMPONENT_METADATA,
    schemaVersion: TRANSLATION_SCHEMA_VERSION,
    title,
  });
}
