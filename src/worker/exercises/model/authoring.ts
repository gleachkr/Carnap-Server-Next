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
  parsePoints,
  reconcileFeedback,
  renderMarkdownSource,
  requireAttribute,
  validateAttributes,
  validateExerciseId,
} from "../../application/content/authoring-toolkit";
import type { ExerciseFeedback } from "../../domain/exercises";
import type { FirstOrderDialect, ModelField, ModelTarget } from "./logic";
import {
  DEFAULT_DIALECT_ID,
  dialectById,
  FORALLX_CALGARY_2019,
  formulaToString,
  modelSignature,
  parseDomain,
  parseFormula,
  parseFunctionTable,
  parseNatural,
  parseTupleList,
  splitFormulaList,
} from "./logic";
import type {
  ModelCheckMode,
  ModelOptions,
  ModelPublicData,
  ModelTurnstileGlyph,
  ModelVariant,
} from "./types";
import {
  MODEL_ANSWER_KIND,
  MODEL_COMPONENT_METADATA,
  MODEL_KIND,
  MODEL_SCHEMA_VERSION,
} from "./types";

const FORMULA_LINE = /^\s*-\s+(.+?)\s*$/;

/** The turnstile that separates premises from conclusions in a sequent. */
const TURNSTILE = ":|-:";

/**
 * A givens line: `| Domain : 0,1,2`.
 *
 * Keyed on a *leading* `|` rather than on containing one, because unlike the
 * propositional profile a first-order dialect may spell disjunction `|`. No
 * formula can begin with it, so the leading position is unambiguous.
 */
const GIVEN_LINE = /^\s*\|\s*([^:]+?)\s*:\s*(.*)$/;

function isGivenLine(line: string): boolean {
  return /^\s*\|/.test(line);
}

/**
 * The bare-flag vocabulary Carnap accepts in a countermodel option string. We
 * implement `nocheck`, `strictGivens`, and the two turnstile glyphs; `exam` is
 * an attribute here rather than a flag. `forallxStyle` — Carnap's undocumented
 * relabelling to "UD =", "extension(F) =", "referent(a) =" — is recognised so
 * ported problems still compile, but is inert. Anything outside this set is a
 * typo and is rejected.
 */
const KNOWN_OPTION_FLAGS: ReadonlySet<string> = new Set([
  "nocheck",
  "strictGivens",
  "double-turnstile",
  "negated-double-turnstile",
  "forallxStyle",
]);

function parseVariant(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): ModelVariant {
  if (
    value === undefined ||
    value === "simple" ||
    value === "validity" ||
    value === "constraint"
  ) {
    return value ?? "simple";
  }

  diagnostics.push(
    diagnostic(
      line,
      "unsupported_model_variant",
      "The variant attribute must be simple, validity, or constraint.",
    ),
  );

  return "simple";
}

function parseDialect(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): FirstOrderDialect {
  const dialect = dialectById(value ?? DEFAULT_DIALECT_ID);

  if (dialect !== null) {
    return dialect;
  }

  diagnostics.push(
    diagnostic(
      line,
      "unsupported_model_system",
      "The system attribute must name a notation system this server knows: {systems}.",
      { params: { systems: DEFAULT_DIALECT_ID } },
    ),
  );

  return FORALLX_CALGARY_2019;
}

interface OptionFlags {
  readonly doubleTurnstile: boolean;
  readonly negatedDoubleTurnstile: boolean;
  readonly nocheck: boolean;
  readonly strictGivens: boolean;
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
          "unknown_model_option",
          "Unknown model option “{option}”.",
          { params: { option: token } },
        ),
      );
      continue;
    }

    flags.add(token);
  }

  return {
    doubleTurnstile: flags.has("double-turnstile"),
    negatedDoubleTurnstile: flags.has("negated-double-turnstile"),
    nocheck: flags.has("nocheck"),
    strictGivens: flags.has("strictGivens"),
  };
}

/**
 * The type's own `check=` spelling (and the `nocheck` flag behind it) read as
 * shared feedback — `undefined` when the author wrote neither.
 *
 * The absence has to survive the translation: an unwritten `check` is not a
 * request for the Check button, and reading it as one would make every model
 * ever authored override the `exam` default and keep checking through an exam.
 */
function checkAttributeAsFeedback(
  value: string | undefined,
  nocheck: boolean,
  line: number,
  diagnostics: CompilerDiagnostic[],
): ExerciseFeedback | undefined {
  if (value !== undefined && value !== "on" && value !== "off") {
    diagnostics.push(
      diagnostic(
        line,
        "unsupported_model_check_mode",
        "The check attribute must be on or off.",
      ),
    );
  }

  // The flag and the attribute say the same thing; either one turning it off
  // wins, so `nocheck` keeps working on a ported problem.
  if (nocheck || value === "off") {
    return "none";
  }

  return value === "on" ? "full" : undefined;
}

/**
 * The stored `options.check`, still in the type's own vocabulary. The widget
 * prefers the resolved `feedback` off its hydration payload — which knows about
 * the assignment — but this is what an exercise compiled before `feedback`
 * existed carries, and the fallback for anything still reading `publicData`.
 *
 * The model has no middle setting of its own: its Check is a verdict and a
 * sentence, so `terse` and `full` both leave the button on.
 */
function checkModeFor(
  feedback: ExerciseFeedback | undefined,
): ModelCheckMode {
  return feedback === "none" ? "off" : "on";
}

function turnstileGlyphFromFlags(flags: OptionFlags): ModelTurnstileGlyph {
  if (flags.negatedDoubleTurnstile) {
    return "negated-double";
  }

  return flags.doubleTurnstile ? "double" : "single";
}

/**
 * The `counterexample-to` vocabulary, resolved against the variant into the
 * property the targeted formulas must have.
 *
 * The defaults are Carnap's: a simple or constraint exercise asks for a model in
 * which the formulas come out *true* (`truthful`), and a validity exercise for
 * one in which the conclusions come out *false* (`falsey`) — a counterexample.
 * Carnap's names for the properties overlap, `validity` and `tautology` being
 * one test, so several map to the same target.
 */
function parseTarget(
  value: string | undefined,
  variant: ModelVariant,
  line: number,
  diagnostics: CompilerDiagnostic[],
): ModelTarget {
  if (value === undefined) {
    return variant === "validity" ? "all-false" : "all-true";
  }

  if (value === "validity" || value === "tautology") {
    return "all-false";
  }

  if (value === "inconsistency" || value === "contradiction") {
    return "all-true";
  }

  if (value === "equivalence") {
    return "not-all-equal";
  }

  diagnostics.push(
    diagnostic(
      line,
      "unsupported_counterexample_target",
      "The counterexample-to attribute must be validity, tautology, equivalence, inconsistency, or contradiction.",
    ),
  );

  return variant === "validity" ? "all-false" : "all-true";
}

function parseFormulaList(
  source: string,
  dialect: FirstOrderDialect,
  line: number,
  diagnostics: CompilerDiagnostic[],
): string[] {
  const formulas: string[] = [];

  for (const piece of splitFormulaList(source)) {
    const trimmed = piece.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const parsed = parseFormula(trimmed, dialect);

    if (parsed.ok) {
      formulas.push(formulaToString(parsed.formula, dialect));
    } else {
      diagnostics.push(
        diagnostic(
          line,
          "invalid_formula",
          "Could not parse formula “{formula}”: {detail}",
          {
            // The parser's own complaint, nested rather than pasted in, so it
            // is translated with the sentence that quotes it.
            params: {
              detail: parsed.errors[0] ?? { message: "syntax error" },
              formula: trimmed,
            },
          },
        ),
      );
    }
  }

  return formulas;
}

interface ModelBody {
  readonly givenLines: readonly { line: number; text: string }[];
  readonly promptLines: readonly string[];
  readonly required: readonly string[];
  readonly targeted: readonly string[];
}

/** Prose, then `- formula` list items, then any givens. */
function parseSimpleBody(
  block: DirectiveBlock,
  dialect: FirstOrderDialect,
  diagnostics: CompilerDiagnostic[],
): ModelBody {
  const promptLines: string[] = [];
  const targeted: string[] = [];
  const givenLines: { line: number; text: string }[] = [];

  for (const [index, line] of block.bodyLines.entries()) {
    const lineNumber = block.bodyStartLine + index;

    if (isGivenLine(line)) {
      givenLines.push({ line: lineNumber, text: line });
      continue;
    }

    const match = FORMULA_LINE.exec(line);

    if (match === null) {
      if (targeted.length === 0) {
        promptLines.push(line);
      } else if (line.trim().length > 0) {
        diagnostics.push(
          diagnostic(
            lineNumber,
            "invalid_model_body",
            "Only formula list items or givens may appear after the first formula.",
          ),
        );
      }

      continue;
    }

    targeted.push(
      ...parseFormulaList(match[1] ?? "", dialect, lineNumber, diagnostics),
    );
  }

  return { givenLines, promptLines, required: [], targeted };
}

/** Prose, then one `premises :|-: conclusions` line, then any givens. */
function parseValidityBody(
  block: DirectiveBlock,
  dialect: FirstOrderDialect,
  diagnostics: CompilerDiagnostic[],
): ModelBody {
  const promptLines: string[] = [];
  const givenLines: { line: number; text: string }[] = [];
  let sequent: { line: number; text: string } | null = null;
  let extraTurnstile = false;

  for (const [index, line] of block.bodyLines.entries()) {
    const lineNumber = block.bodyStartLine + index;

    // Checked before the givens test, because the turnstile itself contains a
    // `|` and would otherwise look like a givens line.
    if (line.includes(TURNSTILE)) {
      if (sequent === null) {
        sequent = { line: lineNumber, text: line };
      } else {
        extraTurnstile = true;
      }

      continue;
    }

    if (isGivenLine(line)) {
      givenLines.push({ line: lineNumber, text: line });
      continue;
    }

    if (sequent === null) {
      promptLines.push(line);
    } else if (line.trim().length > 0) {
      diagnostics.push(
        diagnostic(
          lineNumber,
          "invalid_model_body",
          "A validity exercise has only givens after its sequent line.",
        ),
      );
    }
  }

  if (sequent === null) {
    diagnostics.push(
      diagnostic(
        block.line,
        "missing_turnstile",
        "A validity exercise needs a sequent with the ':|-:' turnstile, e.g. 'AxEyR(x,y) :|-: ExAyR(y,x)'.",
      ),
    );

    return { givenLines, promptLines, required: [], targeted: [] };
  }

  const parts = sequent.text.replace(/^\s*-\s+/, "").split(TURNSTILE);

  if (parts.length !== 2 || extraTurnstile) {
    diagnostics.push(
      diagnostic(
        sequent.line,
        "multiple_turnstiles",
        "A validity sequent must contain exactly one ':|-:' turnstile.",
      ),
    );

    return { givenLines, promptLines, required: [], targeted: [] };
  }

  const required = parseFormulaList(
    parts[0] ?? "",
    dialect,
    sequent.line,
    diagnostics,
  );
  const targeted = parseFormulaList(
    parts[1] ?? "",
    dialect,
    sequent.line,
    diagnostics,
  );

  if (required.length === 0) {
    diagnostics.push(
      diagnostic(
        sequent.line,
        "empty_premises",
        "A validity sequent needs at least one premise before the ':|-:' turnstile.",
      ),
    );
  }

  if (targeted.length === 0) {
    diagnostics.push(
      diagnostic(
        sequent.line,
        "empty_conclusions",
        "A validity sequent needs at least one conclusion after the ':|-:' turnstile.",
      ),
    );
  }

  return { givenLines, promptLines, required, targeted };
}

/**
 * Prose, then one `- constraints : formulas` list item, then any givens.
 *
 * The separator has to be a list item rather than Carnap's bare line, because
 * `:` is far too common in prose to key on: "Find a model where:" would
 * otherwise be read as the constraint line and the real one as a stray.
 */
function parseConstraintBody(
  block: DirectiveBlock,
  dialect: FirstOrderDialect,
  diagnostics: CompilerDiagnostic[],
): ModelBody {
  const promptLines: string[] = [];
  const givenLines: { line: number; text: string }[] = [];
  let split: { line: number; text: string } | null = null;

  for (const [index, line] of block.bodyLines.entries()) {
    const lineNumber = block.bodyStartLine + index;

    if (isGivenLine(line)) {
      givenLines.push({ line: lineNumber, text: line });
      continue;
    }

    const item = FORMULA_LINE.exec(line);

    if (split === null && item !== null && (item[1] ?? "").includes(":")) {
      split = { line: lineNumber, text: item[1] ?? "" };
      continue;
    }

    if (split === null) {
      promptLines.push(line);
    } else if (line.trim().length > 0) {
      diagnostics.push(
        diagnostic(
          lineNumber,
          "invalid_model_body",
          "A constraint exercise has only givens after its constraint line.",
        ),
      );
    }
  }

  if (split === null) {
    diagnostics.push(
      diagnostic(
        block.line,
        "missing_constraint_separator",
        "A constraint exercise needs a '- constraints : formulas' list item, e.g. '- ExEy~x = y : AxAyF(x,y)'.",
      ),
    );

    return { givenLines, promptLines, required: [], targeted: [] };
  }

  const separator = split.text.indexOf(":");
  const required = parseFormulaList(
    split.text.slice(0, separator),
    dialect,
    split.line,
    diagnostics,
  );
  const targeted = parseFormulaList(
    split.text.slice(separator + 1),
    dialect,
    split.line,
    diagnostics,
  );

  if (required.length === 0) {
    diagnostics.push(
      diagnostic(
        split.line,
        "empty_constraints",
        "A constraint exercise needs at least one constraint before the ':'.",
      ),
    );
  }

  return { givenLines, promptLines, required, targeted };
}

/**
 * Read the `| Field : value` lines, checking each names a field this exercise
 * actually has and holds something that field could contain.
 *
 * Carnap validates a given only when the student submits, so a typo in a field
 * name silently seeds nothing ("missing or duplicated field … in countermodel
 * spec" goes to the browser console). Checking at compile time puts it in front
 * of the author instead.
 */
function parseGivens(
  lines: readonly { line: number; text: string }[],
  signature: readonly ModelField[],
  diagnostics: CompilerDiagnostic[],
): Record<string, string> {
  const byLabel = new Map(signature.map((field) => [field.label, field]));
  const givens: Record<string, string> = {};

  for (const { line, text } of lines) {
    const match = GIVEN_LINE.exec(text);

    if (match === null) {
      diagnostics.push(
        diagnostic(
          line,
          "invalid_model_given",
          "A given is written '| Field : value'.",
        ),
      );
      continue;
    }

    const label = (match[1] ?? "").trim();
    const value = (match[2] ?? "").trim();
    const field = byLabel.get(label);

    if (field === undefined) {
      diagnostics.push(
        diagnostic(
          line,
          "unknown_model_given_field",
          "This exercise has no field called “{field}”.",
          { params: { field: label } },
        ),
      );
      continue;
    }

    if (label in givens) {
      diagnostics.push(
        diagnostic(
          line,
          "duplicate_model_given",
          "There is already a given for “{field}”.",
          { params: { field: label } },
        ),
      );
      continue;
    }

    if (!givenValueReads(field, value)) {
      diagnostics.push(
        diagnostic(
          line,
          "invalid_model_given_value",
          "“{value}” is not something “{field}” can contain.",
          { params: { field: label, value } },
        ),
      );
      continue;
    }

    givens[label] = value;
  }

  return givens;
}

/** Whether a given's value is well formed for the field it seeds. */
function givenValueReads(field: ModelField, value: string): boolean {
  switch (field.kind) {
    case "domain":
      return parseDomain(value).ok;
    case "proposition": {
      const lowered = value.toLowerCase();
      return lowered === "true" || lowered === "false";
    }
    case "constant":
      return parseNatural(value).ok;
    case "relation":
      return parseTupleList(value, field.arity).ok;
    default:
      return parseFunctionTable(value, field.arity).ok;
  }
}

/** What `::::model{…}` accepts beyond the shared exercise set. */
const MODEL_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "check",
  "counterexample-to",
  "options",
  "system",
  "variant",
] as const;

export async function compileModel(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
  renderOptions: MarkdownRenderOptions,
): Promise<CompiledExercise | null> {
  validateAttributes(block, MODEL_ATTRIBUTES, diagnostics);

  const id = requireAttribute(block, "id", diagnostics);
  const points = parsePoints(block.attrs.points, block.line, diagnostics);
  const variant = parseVariant(block.attrs.variant, block.line, diagnostics);
  const dialect = parseDialect(block.attrs.system, block.line, diagnostics);
  const flags = parseOptionFlags(
    block.attrs.options,
    block.line,
    diagnostics,
  );
  const title = block.attrs.title?.trim();
  const exam = parseExamAttribute(block.attrs.exam, block.line, diagnostics);
  const body =
    variant === "validity"
      ? parseValidityBody(block, dialect, diagnostics)
      : variant === "constraint"
        ? parseConstraintBody(block, dialect, diagnostics)
        : parseSimpleBody(block, dialect, diagnostics);

  if (id === null) {
    return null;
  }

  validateExerciseId(block, id, diagnostics);

  const feedback = reconcileFeedback(
    block,
    checkAttributeAsFeedback(
      block.attrs.check,
      flags.nocheck,
      block.line,
      diagnostics,
    ),
    diagnostics,
  );
  const check = checkModeFor(feedback);
  const target = parseTarget(
    block.attrs["counterexample-to"],
    variant,
    block.line,
    diagnostics,
  );
  const options: ModelOptions = {
    check,
    strictGivens: flags.strictGivens,
    turnstileGlyph: turnstileGlyphFromFlags(flags),
  };

  if (body.targeted.length === 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        "empty_model_exercise",
        "A model exercise requires at least one formula.",
      ),
    );
  }

  // The givens are checked against the fields the formulas ask for, so the
  // signature has to be derived here even though it is not stored.
  const parsed = [...body.required, ...body.targeted].flatMap((source) => {
    const result = parseFormula(source, dialect);
    return result.ok ? [result.formula] : [];
  });
  const givens = parseGivens(
    body.givenLines,
    modelSignature(parsed),
    diagnostics,
  );

  const publicData: ModelPublicData = {
    dialect: dialect.id,
    ...(Object.keys(givens).length > 0 ? { givens } : {}),
    options,
    promptHtml: await renderMarkdownSource(body.promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    required: body.required,
    target,
    targeted: body.targeted,
    variant,
  };

  return buildCompiledExercise({
    answerKind: MODEL_ANSWER_KIND,
    capabilities: {
      supportsAutomaticEvaluation: true,
      supportsManualReview: true,
    },
    exam,
    feedback,
    id,
    kind: MODEL_KIND,
    nominalPoints: points,
    privateData: {},
    publicData,
    render: MODEL_COMPONENT_METADATA,
    schemaVersion: MODEL_SCHEMA_VERSION,
    title,
  });
}
