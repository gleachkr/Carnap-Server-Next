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
import {
  correctCells,
  fillableCellCount,
  givenRowMatchesValuation,
  normalizeCounterexampleTarget,
  partialFillableCellCount,
  resolveTable,
} from "./grading";
import { formulaToString, MAX_TABLE_ATOMS, parseFormula } from "./logic";
import type {
  TruthTableCellValue,
  TruthTableCheckMode,
  TruthTableCounterexampleTarget,
  TruthTableFillScope,
  TruthTableGivenRow,
  TruthTableGrading,
  TruthTableOptions,
  TruthTablePublicData,
  TruthTableTurnstileGlyph,
  TruthTableVariant,
} from "./types";
import {
  TRUTH_TABLE_ANSWER_KIND,
  TRUTH_TABLE_COMPONENT_METADATA,
  TRUTH_TABLE_KIND,
  TRUTH_TABLE_SCHEMA_VERSION,
} from "./types";

const FORMULA_LINE = /^\s*-\s+(.+?)\s*$/;

/** The turnstile that separates premises from conclusions in a validity sequent. */
const TURNSTILE = ":|-:";

/**
 * Whether a line belongs to the trailing given grid. `prop` formulas never contain
 * a bare `|` (disjunction is `\/`), so a `|` in a table body reliably marks the
 * grid — the sole exception being the validity `:|-:` sequent, which callers
 * classify first. A `|`-bearing line whose left segment is the atom names (a
 * `P Q | P -> Q` header echo) is skipped in {@link parseGivenGrid}; every other is
 * a data row.
 */
function isGridLine(line: string): boolean {
  return line.includes("|");
}

/**
 * The bare-flag vocabulary Carnap accepts in a truth-table option string. We
 * implement `autoAtoms`, `nodash`, `nocheck`, `nocounterexample`, `hiddenGivens`,
 * and `strictGivens`; the rest are recognised so existing Carnap problems port
 * without a compile error, but are inert until the phase that adds them. Anything
 * outside this set is a typo and is rejected.
 */
const KNOWN_OPTION_FLAGS: ReadonlySet<string> = new Set([
  "autoAtoms",
  "nodash",
  "nocheck",
  "nocounterexample",
  "hiddenGivens",
  "strictGivens",
  "turnstilemark",
  "double-turnstile",
  "negated-double-turnstile",
  "immutable",
]);

function parseVariant(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): TruthTableVariant {
  if (
    value === undefined ||
    value === "simple" ||
    value === "validity" ||
    value === "partial"
  ) {
    return value ?? "simple";
  }

  diagnostics.push(
    diagnostic(
      line,
      "unsupported_truth_table_variant",
      "The variant attribute must be simple, validity, or partial.",
    ),
  );

  return "simple";
}

function parseFillScope(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): TruthTableFillScope {
  if (value === undefined || value === "all") {
    return "all";
  }

  if (value === "connectives" || value === "main") {
    return value;
  }

  diagnostics.push(
    diagnostic(
      line,
      "invalid_fill_scope",
      "The fill attribute must be all, connectives, or main.",
    ),
  );

  return "all";
}

function parseGrading(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): TruthTableGrading {
  if (value === undefined || value === "all-or-nothing") {
    return "all-or-nothing";
  }

  if (value === "partial") {
    return "partial";
  }

  diagnostics.push(
    diagnostic(
      line,
      "invalid_grading_mode",
      "The grading attribute must be all-or-nothing or partial.",
    ),
  );

  return "all-or-nothing";
}

function parseOptionFlags(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): {
  autoAtoms: boolean;
  nodash: boolean;
  nocheck: boolean;
  nocounterexample: boolean;
  hiddenGivens: boolean;
  strictGivens: boolean;
  doubleTurnstile: boolean;
  negatedDoubleTurnstile: boolean;
} {
  const flags = {
    autoAtoms: false,
    doubleTurnstile: false,
    hiddenGivens: false,
    negatedDoubleTurnstile: false,
    nocheck: false,
    nocounterexample: false,
    nodash: false,
    strictGivens: false,
  };

  if (value === undefined) {
    return flags;
  }

  for (const token of value.split(/\s+/).filter((part) => part.length > 0)) {
    if (token === "autoAtoms") {
      flags.autoAtoms = true;
    } else if (token === "nodash") {
      flags.nodash = true;
    } else if (token === "nocheck") {
      flags.nocheck = true;
    } else if (token === "nocounterexample") {
      flags.nocounterexample = true;
    } else if (token === "hiddenGivens") {
      flags.hiddenGivens = true;
    } else if (token === "strictGivens") {
      flags.strictGivens = true;
    } else if (token === "double-turnstile") {
      flags.doubleTurnstile = true;
    } else if (token === "negated-double-turnstile") {
      flags.negatedDoubleTurnstile = true;
    } else if (!KNOWN_OPTION_FLAGS.has(token)) {
      diagnostics.push(
        diagnostic(
          line,
          "unknown_truth_table_option",
          "Unknown truth-table option “{option}”.",
          { params: { option: token } },
        ),
      );
    }
  }

  return flags;
}

/**
 * Resolve the counterexample property from the `counterexample-to` attribute
 * (default `tautology`), folding Carnap's synonyms `validity` and `contradiction`.
 * The property applies whether or not the button is shown (a validity table's
 * turnstile column uses it either way).
 */
function parseCounterexampleProperty(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): TruthTableCounterexampleTarget {
  if (value === undefined) {
    return "tautology";
  }

  const property = normalizeCounterexampleTarget(value);

  if (property !== null) {
    return property;
  }

  diagnostics.push(
    diagnostic(
      line,
      "invalid_counterexample_target",
      "The counterexample-to attribute must be validity, tautology, equivalence, inconsistency, or contradiction.",
    ),
  );

  return "tautology";
}

/**
 * The table's own `check=` spelling (and the `nocheck` flag behind it) read as
 * shared feedback — `undefined` when the author wrote neither.
 *
 * The absence has to survive the translation. An unwritten `check` is not a
 * request for cell marks; reading it as one would make every table ever
 * authored override the `exam` default and go on marking cells through an exam.
 */
function checkAttributeAsFeedback(
  value: string | undefined,
  nocheck: boolean,
  line: number,
  diagnostics: CompilerDiagnostic[],
): ExerciseFeedback | undefined {
  if (value === "cells" || value === "terse" || value === "off") {
    return value === "cells" ? "full" : value === "terse" ? "terse" : "none";
  }

  if (value !== undefined) {
    diagnostics.push(
      diagnostic(
        line,
        "invalid_check_mode",
        "The check attribute must be cells, terse, or off.",
      ),
    );
  }

  return nocheck ? "none" : undefined;
}

/**
 * The stored `options.check`, still written in the type's own vocabulary.
 *
 * The widget prefers the resolved `feedback` off its hydration payload, which
 * knows about the assignment; this is what a grid compiled today leaves behind
 * for anything still reading `publicData`, and what a grid compiled before
 * `feedback` existed already carries.
 */
function checkModeFor(
  feedback: ExerciseFeedback | undefined,
): TruthTableCheckMode {
  return feedback === "none"
    ? "off"
    : feedback === "terse"
      ? "terse"
      : "cells";
}

/** Longest glyph a `trueMark`/`falseMark` may render. */
const MAX_MARK_LENGTH = 8;

/**
 * Resolve a `trueMark`/`falseMark` attribute (the glyph shown for a true/false
 * cell), falling back to `fallback` (`"T"`/`"F"`) when absent or invalid.
 */
function parseMark(
  value: string | undefined,
  fallback: string,
  attribute: string,
  line: number,
  diagnostics: CompilerDiagnostic[],
): string {
  if (value === undefined) {
    return fallback;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_MARK_LENGTH) {
    diagnostics.push(
      diagnostic(
        line,
        "invalid_mark",
        "The {attribute} attribute must be a glyph of 1 to {max} characters.",
        { params: { attribute, max: MAX_MARK_LENGTH } },
      ),
    );
    return fallback;
  }

  return trimmed;
}

/** Which turnstile glyph the option flags select (negated takes precedence). */
function turnstileGlyphFromFlags(flags: {
  doubleTurnstile: boolean;
  negatedDoubleTurnstile: boolean;
}): TruthTableTurnstileGlyph {
  if (flags.negatedDoubleTurnstile) {
    return "negated-double";
  }

  return flags.doubleTurnstile ? "double" : "single";
}

function parseBody(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): {
  formulas: string[];
  givens: TruthTableGivenRow[];
  promptLines: string[];
} {
  const promptLines: string[] = [];
  const formulas: string[] = [];
  const gridRows: { text: string; line: number }[] = [];

  for (const [index, line] of block.bodyLines.entries()) {
    const lineNumber = block.bodyStartLine + index;

    // A `|` line after the first formula is the trailing given grid; before any
    // formula it is still prompt prose.
    if (formulas.length > 0 && isGridLine(line)) {
      gridRows.push({ line: lineNumber, text: line });
      continue;
    }

    const match = FORMULA_LINE.exec(line);

    if (match === null) {
      if (formulas.length === 0) {
        promptLines.push(line);
      } else if (line.trim().length > 0) {
        diagnostics.push(
          diagnostic(
            lineNumber,
            "invalid_truth_table_body",
            "Only formula list items or a given grid may appear after the first formula.",
          ),
        );
      }

      continue;
    }

    // A single bullet may list several comma-separated formulas, so multiple
    // formulas can share one line just as they do on a validity sequent's sides.
    formulas.push(
      ...parseFormulaList(match[1] ?? "", lineNumber, diagnostics),
    );
  }

  return {
    formulas,
    givens: parseGivenGrid(gridRows, formulas, "simple", diagnostics),
    promptLines,
  };
}

/**
 * Parse one side of a sequent — a comma-separated list of formulas — into
 * canonical `prop` sources, collecting a diagnostic per unparseable formula.
 * Commas never occur inside a `prop` formula, so a plain split is unambiguous.
 */
function parseFormulaList(
  source: string,
  line: number,
  diagnostics: CompilerDiagnostic[],
): string[] {
  const formulas: string[] = [];

  for (const piece of source.split(",")) {
    const trimmed = piece.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const parsed = parseFormula(trimmed);

    if (parsed.ok) {
      formulas.push(formulaToString(parsed.formula));
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

/**
 * Parse a validity body: prose before the sequent is the prompt; the one line
 * carrying the `:|-:` turnstile is the argument, `premises :|-: conclusions`
 * (each side comma-separated). Returns the formulas as premises followed by
 * conclusions plus the split point.
 */
function parseValidityBody(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): {
  formulas: string[];
  givens: TruthTableGivenRow[];
  premiseCount: number;
  promptLines: string[];
} {
  const promptLines: string[] = [];
  const gridRows: { text: string; line: number }[] = [];
  let sequent: { text: string; line: number } | null = null;
  let extraTurnstileLine = false;

  for (const [index, line] of block.bodyLines.entries()) {
    const lineNumber = block.bodyStartLine + index;

    if (line.includes(TURNSTILE)) {
      if (sequent === null) {
        sequent = { line: lineNumber, text: line };
      } else {
        extraTurnstileLine = true;
      }

      continue;
    }

    // After the sequent, a `|` line is the trailing given grid.
    if (sequent !== null && isGridLine(line)) {
      gridRows.push({ line: lineNumber, text: line });
      continue;
    }

    if (sequent === null) {
      promptLines.push(line);
    } else if (line.trim().length > 0) {
      diagnostics.push(
        diagnostic(
          lineNumber,
          "invalid_truth_table_body",
          "A validity exercise has only a given grid after its sequent line.",
        ),
      );
    }
  }

  if (sequent === null) {
    diagnostics.push(
      diagnostic(
        block.line,
        "missing_turnstile",
        "A validity exercise needs a sequent with the ':|-:' turnstile, e.g. 'P, P -> Q :|-: Q'.",
      ),
    );
    return { formulas: [], givens: [], premiseCount: 0, promptLines };
  }

  // Strip an optional leading list bullet, so '- P :|-: Q' also reads.
  const parts = sequent.text.replace(/^\s*-\s+/, "").split(TURNSTILE);

  if (parts.length !== 2 || extraTurnstileLine) {
    diagnostics.push(
      diagnostic(
        sequent.line,
        "multiple_turnstiles",
        "A validity sequent must contain exactly one ':|-:' turnstile.",
      ),
    );
    return { formulas: [], givens: [], premiseCount: 0, promptLines };
  }

  const premises = parseFormulaList(
    parts[0] ?? "",
    sequent.line,
    diagnostics,
  );
  const conclusions = parseFormulaList(
    parts[1] ?? "",
    sequent.line,
    diagnostics,
  );

  if (premises.length === 0) {
    diagnostics.push(
      diagnostic(
        sequent.line,
        "empty_premises",
        "A validity sequent needs at least one premise before the ':|-:' turnstile.",
      ),
    );
  }

  if (conclusions.length === 0) {
    diagnostics.push(
      diagnostic(
        sequent.line,
        "empty_conclusions",
        "A validity sequent needs at least one conclusion after the ':|-:' turnstile.",
      ),
    );
  }

  const formulas = [...premises, ...conclusions];

  return {
    formulas,
    givens: parseGivenGrid(gridRows, formulas, "validity", diagnostics),
    premiseCount: premises.length,
    promptLines,
  };
}

/**
 * Parse a partial body: prose before the first formula is the prompt; `- formula`
 * list items (comma-separated allowed) are the table's formulas; a trailing given
 * grid supplies the accepted row(s). Structurally identical to {@link parseBody},
 * with the grid interpreted per the `partial` variant.
 */
function parsePartialBody(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): {
  formulas: string[];
  givens: TruthTableGivenRow[];
  promptLines: string[];
} {
  const promptLines: string[] = [];
  const formulas: string[] = [];
  const gridRows: { text: string; line: number }[] = [];

  for (const [index, line] of block.bodyLines.entries()) {
    const lineNumber = block.bodyStartLine + index;

    if (formulas.length > 0 && isGridLine(line)) {
      gridRows.push({ line: lineNumber, text: line });
      continue;
    }

    const match = FORMULA_LINE.exec(line);

    if (match === null) {
      if (formulas.length === 0) {
        promptLines.push(line);
      } else if (line.trim().length > 0) {
        diagnostics.push(
          diagnostic(
            lineNumber,
            "invalid_truth_table_body",
            "Only formula list items or a given grid may appear after the first formula.",
          ),
        );
      }

      continue;
    }

    formulas.push(
      ...parseFormulaList(match[1] ?? "", lineNumber, diagnostics),
    );
  }

  return {
    formulas,
    givens: parseGivenGrid(gridRows, formulas, "partial", diagnostics),
    promptLines,
  };
}

/**
 * Tokenize one `|`-delimited grid segment into cell values, one per whitespace-
 * separated token: `T`/`F` pin a value, `.` leaves the cell free. Returns `null`
 * on an unrecognized token (the caller reports it).
 */
function parseGridSegment(segment: string): TruthTableCellValue[] | null {
  const tokens = segment
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const values: TruthTableCellValue[] = [];

  for (const token of tokens) {
    if (token === "T") {
      values.push("T");
    } else if (token === "F") {
      values.push("F");
    } else if (token === ".") {
      values.push("");
    } else {
      return null;
    }
  }

  return values;
}

/**
 * Check one seeded (`simple`/`validity`) given against the computed key: every
 * pinned cell must equal the table's value on every row the reference pattern
 * matches (the key is a function of the formulas, so a given only reveals it). A
 * `partial` given carries no key to check against. Returns `false` (and reports)
 * on the first conflict.
 */
function givenAgreesWithKey(
  table: NonNullable<ReturnType<typeof resolveTable>>,
  keyCells: readonly (readonly (readonly boolean[])[])[],
  given: TruthTableGivenRow,
  line: number,
  diagnostics: CompilerDiagnostic[],
): boolean {
  for (const [rowIndex, valuation] of table.valuations.entries()) {
    if (!givenRowMatchesValuation(given.reference, valuation)) {
      continue;
    }

    for (const [formulaIndex, formulaCells] of given.cells.entries()) {
      for (const [cellIndex, pinned] of formulaCells.entries()) {
        if (pinned === "") {
          continue;
        }

        const expected =
          (keyCells[formulaIndex]?.[rowIndex]?.[cellIndex] ?? false)
            ? "T"
            : "F";

        if (pinned !== expected) {
          diagnostics.push(
            diagnostic(
              line,
              "given_conflicts_with_key",
              "This given assigns {pinned} to a cell whose computed value is {expected}.",
              { params: { expected, pinned } },
            ),
          );
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Parse the trailing given grid into {@link TruthTableGivenRow}s. Each data row is
 * `refTokens | f1Tokens | … | fNTokens`; token counts must match the reference
 * atoms and each formula's cell count. For `simple`/`validity` a row's reference
 * tokens select which 2ⁿ rows it seeds (`.` is a wildcard) and its pins are
 * checked against the computed key; for `partial` each row is one accepted
 * alternative (reference `.` = the student's free choice).
 */
function parseGivenGrid(
  rows: readonly { text: string; line: number }[],
  formulas: readonly string[],
  variant: TruthTableVariant,
  diagnostics: CompilerDiagnostic[],
): TruthTableGivenRow[] {
  if (rows.length === 0) {
    return [];
  }

  const table = resolveTable(formulas);

  // Malformed formulas are already reported; skip the grid rather than pile on.
  if (table === null) {
    return [];
  }

  const cellCounts = table.formulas.map((formula) => formula.cells.length);
  const keyCells = variant === "partial" ? null : correctCells(table);
  const givens: TruthTableGivenRow[] = [];

  for (const { text, line } of rows) {
    const segments = text.split("|");

    // A header echo (`P Q | P -> Q`) whose left segment is the atom names is
    // skipped, not parsed as data.
    const leftTokens = (segments[0] ?? "")
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0);
    if (
      leftTokens.length === table.atoms.length &&
      leftTokens.every((token, index) => token === table.atoms[index])
    ) {
      continue;
    }

    if (segments.length !== formulas.length + 1) {
      diagnostics.push(
        diagnostic(
          line,
          "given_row_arity",
          "A given row needs {expected} '|'-separated segments (reference plus one per formula); found {found}.",
          {
            params: { expected: formulas.length + 1, found: segments.length },
          },
        ),
      );
      continue;
    }

    const reference = parseGridSegment(segments[0] ?? "");

    if (reference === null) {
      diagnostics.push(
        diagnostic(
          line,
          "invalid_grid_token",
          "A given cell must be T, F, or '.'.",
        ),
      );
      continue;
    }

    if (reference.length !== table.atoms.length) {
      diagnostics.push(
        diagnostic(
          line,
          "given_cell_arity",
          "The reference segment needs {expected} tokens (one per atom); found {found}.",
          {
            params: {
              expected: table.atoms.length,
              found: reference.length,
            },
          },
        ),
      );
      continue;
    }

    const cells: TruthTableCellValue[][] = [];
    let malformed = false;

    for (let index = 0; index < formulas.length; index += 1) {
      const parsed = parseGridSegment(segments[index + 1] ?? "");

      if (parsed === null) {
        diagnostics.push(
          diagnostic(
            line,
            "invalid_grid_token",
            "A given cell must be T, F, or '.'.",
          ),
        );
        malformed = true;
        break;
      }

      if (parsed.length !== cellCounts[index]) {
        diagnostics.push(
          diagnostic(
            line,
            "given_cell_arity",
            "Formula {index} needs {expected} cell tokens; found {found}.",
            {
              params: {
                expected: cellCounts[index] ?? 0,
                found: parsed.length,
                index: index + 1,
              },
            },
          ),
        );
        malformed = true;
        break;
      }

      cells.push(parsed);
    }

    if (malformed) {
      continue;
    }

    const given: TruthTableGivenRow = { cells, reference };

    if (
      keyCells !== null &&
      !givenAgreesWithKey(table, keyCells, given, line, diagnostics)
    ) {
      continue;
    }

    givens.push(given);
  }

  return givens;
}

function validateTable(
  block: DirectiveBlock,
  formulas: readonly string[],
  options: TruthTableOptions,
  variant: TruthTableVariant,
  diagnostics: CompilerDiagnostic[],
): void {
  if (formulas.length === 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        "no_formulas",
        "A truth-table exercise requires at least one formula.",
      ),
    );
    return;
  }

  const table = resolveTable(formulas);

  if (table === null) {
    return;
  }

  if (table.atoms.length > MAX_TABLE_ATOMS) {
    diagnostics.push(
      diagnostic(
        block.line,
        "too_many_atoms",
        "A truth table may use at most {max} atoms; this one uses {found}.",
        { params: { found: table.atoms.length, max: MAX_TABLE_ATOMS } },
      ),
    );
    return;
  }

  const fillable =
    variant === "partial"
      ? partialFillableCellCount(table)
      : fillableCellCount(table, options, variant === "validity");

  if (fillable === 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        "no_fillable_cells",
        "These options leave no cells for the student to fill.",
      ),
    );
  }
}

/** What `::::truth-table{…}` accepts beyond the shared exercise set. */
const TRUTH_TABLE_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "check",
  "counterexample-to",
  "falseMark",
  "fill",
  "grading",
  "options",
  "trueMark",
  "variant",
] as const;

export async function compileTruthTable(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
  renderOptions: MarkdownRenderOptions,
): Promise<CompiledExercise | null> {
  validateAttributes(block, TRUTH_TABLE_ATTRIBUTES, diagnostics);

  const id = requireAttribute(block, "id", diagnostics);
  const points = parsePoints(block.attrs.points, block.line, diagnostics);
  const variant = parseVariant(block.attrs.variant, block.line, diagnostics);
  const fill = parseFillScope(block.attrs.fill, block.line, diagnostics);
  const grading = parseGrading(block.attrs.grading, block.line, diagnostics);
  const flags = parseOptionFlags(
    block.attrs.options,
    block.line,
    diagnostics,
  );
  const title = block.attrs.title?.trim();
  const exam = parseExamAttribute(block.attrs.exam, block.line, diagnostics);
  // The validity variant reads a single-line `premises :|-: conclusions`
  // sequent; simple and partial read one formula per list item. All three may
  // carry a trailing given grid.
  const isValidity = variant === "validity";
  const isPartial = variant === "partial";
  const body = isValidity
    ? parseValidityBody(block, diagnostics)
    : isPartial
      ? { premiseCount: 0, ...parsePartialBody(block, diagnostics) }
      : { premiseCount: 0, ...parseBody(block, diagnostics) };

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
  // `counterexample-to` sets the property a counterexample row must show — for a
  // validity table it applies to the conclusions (premises stay all-true), for a
  // simple table to every formula. `nocounterexample` only hides the button.
  const counterexampleTo = parseCounterexampleProperty(
    block.attrs["counterexample-to"],
    block.line,
    diagnostics,
  );
  const trueMark = parseMark(
    block.attrs.trueMark,
    "T",
    "trueMark",
    block.line,
    diagnostics,
  );
  const falseMark = parseMark(
    block.attrs.falseMark,
    "F",
    "falseMark",
    block.line,
    diagnostics,
  );
  const options: TruthTableOptions = {
    autoAtoms: flags.autoAtoms,
    check,
    counterexampleTo,
    falseMark,
    fill,
    grading,
    hiddenGivens: flags.hiddenGivens,
    nodash: flags.nodash,
    showCounterexample: !flags.nocounterexample,
    strictGivens: flags.strictGivens,
    trueMark,
    turnstileGlyph: turnstileGlyphFromFlags(flags),
  };

  validateTable(block, body.formulas, options, variant, diagnostics);

  const publicData: TruthTablePublicData = {
    formulas: body.formulas,
    options,
    promptHtml: await renderMarkdownSource(body.promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    // Only a validity table carries a premise/conclusion split.
    ...(isValidity ? { premiseCount: body.premiseCount } : {}),
    // Any variant may carry a seeded given grid (only when the author wrote one).
    ...(body.givens.length > 0 ? { givens: body.givens } : {}),
    variant,
  };

  return buildCompiledExercise({
    answerKind: TRUTH_TABLE_ANSWER_KIND,
    capabilities: {
      supportsAutomaticEvaluation: true,
      supportsManualReview: true,
    },
    exam,
    feedback,
    id,
    kind: TRUTH_TABLE_KIND,
    nominalPoints: points,
    privateData: {},
    publicData,
    render: TRUTH_TABLE_COMPONENT_METADATA,
    schemaVersion: TRUTH_TABLE_SCHEMA_VERSION,
    title,
  });
}
