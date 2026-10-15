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
import type { Formula } from "../../exercise-kit/formula";
import {
  freeVariables,
  isArgumentLine,
  parseFormula,
  splitArgumentLine,
} from "../../exercise-kit/formula";
import { parseSystemAttribute } from "../../exercise-kit/systems/attribute";
import type { ExerciseCompileContext } from "../../exercise-kit/type";
import { roleIndex } from "../../logic/specs/roles";
import { engineText } from "./logic/formulas";
import { FORALLX_UBC } from "./logic/system";
import type { TruthTreePublicData, TruthTreeTask } from "./types";
import {
  TRUTH_TREE_ANSWER_KIND,
  TRUTH_TREE_CAPABILITIES,
  TRUTH_TREE_COMPONENT_METADATA,
  TRUTH_TREE_KIND,
  TRUTH_TREE_SCHEMA_VERSION,
} from "./types";

const LIST_ITEM = /^\s*-\s+(.+?)\s*$/;

/** What `::::truth-tree{…}` accepts beyond the shared exercise set. */
const TRUTH_TREE_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "system",
] as const;

/** The language a tree is set in when the author names none. */
const DEFAULT_TRUTH_TREE_SYSTEM = "forallx-ubc";

interface Located {
  readonly line: number;
  readonly text: string;
}

interface TreeBody {
  readonly promptLines: readonly string[];
  readonly items: readonly Located[];
  readonly arguments: readonly Located[];
}

/**
 * Prose, then the root: one `premises :|-: conclusion` line, or a list of
 * sentences. The prompt is the run of lines before the first of either.
 */
function parseBody(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): TreeBody {
  const promptLines: string[] = [];
  const items: Located[] = [];
  const argumentLines: Located[] = [];
  let pastPrompt = false;

  for (const [index, line] of block.bodyLines.entries()) {
    const lineNumber = block.bodyStartLine + index;

    if (isArgumentLine(line)) {
      pastPrompt = true;
      argumentLines.push({ line: lineNumber, text: line });
      continue;
    }

    const item = LIST_ITEM.exec(line);

    if (item !== null) {
      pastPrompt = true;
      items.push({ line: lineNumber, text: item[1] ?? "" });
      continue;
    }

    if (!pastPrompt) {
      promptLines.push(line);
    } else if (line.trim().length > 0) {
      diagnostics.push(
        diagnostic(
          lineNumber,
          "invalid_truth_tree_body",
          "Only the root's sentences may follow the first of them.",
        ),
      );
    }
  }

  return { arguments: argumentLines, items, promptLines };
}

/** Lines of the body the nested-directive scan leaves alone. */
export function truthTreeDataBodyLines(
  block: DirectiveBlock,
): ReadonlySet<number> {
  const data = new Set<number>();
  let pastPrompt = false;

  for (const [index, line] of block.bodyLines.entries()) {
    pastPrompt ||= LIST_ITEM.test(line) || isArgumentLine(line);

    if (pastPrompt) {
      data.add(block.bodyStartLine + index);
    }
  }

  return data;
}

/** Parse one root sentence; `null` after reporting why not. */
function readSentence(
  source: string,
  line: number,
  language: Parameters<typeof parseFormula>[1],
  diagnostics: CompilerDiagnostic[],
): Formula | null {
  const trimmed = source.trim();
  const parsed = parseFormula(trimmed, language);

  if (!parsed.ok) {
    diagnostics.push(
      diagnostic(
        line,
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
    return null;
  }

  if (freeVariables(parsed.formula).length > 0) {
    diagnostics.push(
      diagnostic(
        line,
        "truth_tree_open_sentence",
        "“{formula}” has free variables, and a tree's root must be sentences.",
        { params: { formula: trimmed } },
      ),
    );
    return null;
  }

  return parsed.formula;
}

export async function compileTruthTree(
  block: DirectiveBlock,
  context: ExerciseCompileContext,
): Promise<CompiledExercise | null> {
  const { diagnostics, renderOptions, resolveSystem } = context;
  validateAttributes(block, TRUTH_TREE_ATTRIBUTES, diagnostics);

  const id = requireAttribute(block, "id", diagnostics);
  const points = parsePoints(block.attrs.points, block.line, diagnostics);
  const title = block.attrs.title?.trim();
  const exam = parseExamAttribute(block.attrs.exam, block.line, diagnostics);
  const feedback = reconcileFeedback(block, undefined, diagnostics);
  const { language, system } = parseSystemAttribute(
    block,
    resolveSystem,
    diagnostics,
    { defaultId: DEFAULT_TRUTH_TREE_SYSTEM },
  );
  const body = parseBody(block, diagnostics);

  if (id === null) {
    return null;
  }

  validateExerciseId(block, id, diagnostics);

  if (roleIndex(language).termFor("negation") === null) {
    diagnostics.push(
      diagnostic(
        block.line,
        "truth_tree_no_negation",
        "The language “{name}” has no negation, which a truth tree needs.",
        { params: { name: system } },
      ),
    );
    return null;
  }

  let task: TruthTreeTask = "consistency";
  const premises: Formula[] = [];
  const conclusions: Formula[] = [];

  if (body.arguments.length > 0 && body.items.length > 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        "truth_tree_mixed_root",
        "Write the root as one argument line or as a list of sentences, not both.",
      ),
    );
  } else if (body.arguments.length > 0) {
    task = "validity";

    for (const extra of body.arguments.slice(1)) {
      diagnostics.push(
        diagnostic(
          extra.line,
          "multiple_turnstiles",
          "A validity sequent must contain exactly one ':|-:' turnstile.",
        ),
      );
    }

    const first = body.arguments[0] as Located;
    const argument = splitArgumentLine(first.text);

    if (argument === null) {
      diagnostics.push(
        diagnostic(
          first.line,
          "multiple_turnstiles",
          "A validity sequent must contain exactly one ':|-:' turnstile.",
        ),
      );
    } else if (argument.conclusions.length === 0) {
      diagnostics.push(
        diagnostic(
          first.line,
          "empty_conclusions",
          "A validity sequent needs at least one conclusion after the ':|-:' turnstile.",
        ),
      );
    } else if (argument.conclusions.length > 1) {
      diagnostics.push(
        diagnostic(
          first.line,
          "truth_tree_conclusions",
          "A truth tree tests an argument with one conclusion.",
        ),
      );
    } else {
      for (const piece of argument.premises) {
        const formula = readSentence(
          piece,
          first.line,
          language,
          diagnostics,
        );

        if (formula !== null) {
          premises.push(formula);
        }
      }

      for (const piece of argument.conclusions) {
        const formula = readSentence(
          piece,
          first.line,
          language,
          diagnostics,
        );

        if (formula !== null) {
          conclusions.push(formula);
        }
      }
    }
  } else if (body.items.length > 0) {
    for (const item of body.items) {
      const formula = readSentence(
        item.text,
        item.line,
        language,
        diagnostics,
      );

      if (formula !== null) {
        premises.push(formula);
      }
    }
  } else {
    diagnostics.push(
      diagnostic(
        block.line,
        "truth_tree_no_root",
        "A truth tree needs a root: an argument line “premises :|-: conclusion”, or a list of sentences.",
      ),
    );
  }

  // The root is what UBC's method says to write (§5.2): the premises, and the
  // negation of the conclusion. These are the only formulas a reader sees
  // that the author did not type, so they are printed in the language itself.
  const rootFormulas: Formula[] = [
    ...premises,
    ...conclusions.map(
      (conclusion): Formula => ({ operand: conclusion, type: "not" }),
    ),
  ];
  const root: string[] = [];

  for (const formula of rootFormulas) {
    const engine = engineText(formula, language);

    if (engine === null) {
      diagnostics.push(
        diagnostic(
          block.line,
          "truth_tree_unprintable_root",
          "The root could not be written in the language.",
        ),
      );
      return null;
    }

    root.push(engine);
  }

  if (root.length > FORALLX_UBC.rowCap) {
    diagnostics.push(
      diagnostic(
        block.line,
        "truth_tree_root_too_long",
        "A truth tree's root may have at most {max} sentences.",
        { params: { max: String(FORALLX_UBC.rowCap) } },
      ),
    );
  }

  const publicData: TruthTreePublicData = {
    premises: premises.length,
    promptHtml: await renderMarkdownSource(body.promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    root,
    rules: FORALLX_UBC.id,
    system,
    task,
  };

  return buildCompiledExercise({
    answerKind: TRUTH_TREE_ANSWER_KIND,
    capabilities: TRUTH_TREE_CAPABILITIES,
    exam,
    feedback,
    id,
    kind: TRUTH_TREE_KIND,
    nominalPoints: points,
    privateData: {},
    publicData: publicData as unknown as Parameters<
      typeof buildCompiledExercise
    >[0]["publicData"],
    render: TRUTH_TREE_COMPONENT_METADATA,
    schemaVersion: TRUTH_TREE_SCHEMA_VERSION,
    title,
  });
}
