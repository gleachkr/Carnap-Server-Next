/**
 * Shared, DOM-free grading for truth tables. Imported by BOTH the worker
 * (authoritative score + review marks) and the client element (instant local
 * Check). Truth tables have no secret answer — the key is a function of the
 * public formulas — so grading the same way on both sides is safe and is what
 * lets the client mark cells without a round trip.
 *
 * Everything is positional against the layout the logic core derives from
 * `publicData.formulas`, so the worker and client agree cell-for-cell.
 */

import type { CellSegment, Formula, FormulaSegment } from "./logic";
import {
  collectAtoms,
  enumerateValuations,
  evaluate,
  formulaLayout,
  parseFormula,
} from "./logic";
import type {
  TruthTableAnswerData,
  TruthTableCellValue,
  TruthTableCounterexampleTarget,
  TruthTableGivenRow,
  TruthTableOptions,
  TruthTablePublicData,
} from "./types";

export interface ResolvedFormula {
  readonly source: string;
  readonly formula: Formula;
  /** Parens and cells, in display order (for the header and body layout). */
  readonly segments: readonly FormulaSegment[];
  /** Just the fillable/gradeable cells, in display order. */
  readonly cells: readonly CellSegment[];
}

export interface ResolvedTable {
  readonly atoms: readonly string[];
  /** `valuations[rowIndex][atomIndex]` — also the reference-column key. */
  readonly valuations: readonly (readonly boolean[])[];
  readonly formulas: readonly ResolvedFormula[];
}

/**
 * Parse the formulas and assemble the shared layout. Returns null if any
 * formula fails to parse (the author's compile step already rejects those, so
 * this is a defensive guard for malformed stored data).
 */
export function resolveTable(
  sources: readonly string[],
): ResolvedTable | null {
  const parsed: Formula[] = [];

  for (const source of sources) {
    const result = parseFormula(source);

    if (!result.ok) {
      return null;
    }

    parsed.push(result.formula);
  }

  const atoms = collectAtoms(parsed);
  const valuations = enumerateValuations(atoms);
  const formulas = parsed.map((formula, index) => {
    const segments = formulaLayout(formula);
    return {
      cells: segments.filter(
        (segment): segment is CellSegment => segment.kind === "cell",
      ),
      formula,
      segments,
      source: sources[index] ?? "",
    };
  });

  return { atoms, formulas, valuations };
}

function valuationMap(
  atoms: readonly string[],
  row: readonly boolean[],
): Map<string, boolean> {
  const map = new Map<string, boolean>();

  for (const [index, atom] of atoms.entries()) {
    map.set(atom, row[index] ?? false);
  }

  return map;
}

/** The correct value ("T"/"F") for every formula cell: `[formula][row][cell]`. */
export function correctCells(table: ResolvedTable): boolean[][][] {
  return table.formulas.map((formula) =>
    table.valuations.map((row) => {
      const map = valuationMap(table.atoms, row);
      return formula.cells.map((cell) => evaluate(cell.formula, map));
    }),
  );
}

/**
 * Whether a given row's reference pattern matches a concrete valuation: every
 * pinned atom (`T`/`F`) agrees, wildcards (`""`) match anything. This selects
 * which of a `simple`/`validity` table's 2ⁿ rows a given seeds.
 */
export function givenRowMatchesValuation(
  reference: readonly TruthTableCellValue[],
  valuation: readonly boolean[],
): boolean {
  return valuation.every((value, atomIndex) => {
    const pinned = reference[atomIndex] ?? "";
    return pinned === "" || pinned === boolToCell(value);
  });
}

/**
 * The value a given seeds into one formula cell on rows matching its pattern, or
 * `""` when no given pins it. For `simple`/`validity`, where the row's valuation
 * is fixed; the first matching given wins.
 */
export function givenCellValue(
  givens: readonly TruthTableGivenRow[] | null,
  valuation: readonly boolean[],
  formulaIndex: number,
  cellIndex: number,
): TruthTableCellValue {
  if (givens === null) {
    return "";
  }

  for (const given of givens) {
    if (!givenRowMatchesValuation(given.reference, valuation)) {
      continue;
    }

    const pinned = given.cells[formulaIndex]?.[cellIndex] ?? "";

    if (pinned !== "") {
      return pinned;
    }
  }

  return "";
}

/** Whether a set of row values exhibits a counterexample property. */
function hasProperty(
  values: readonly boolean[],
  property: TruthTableCounterexampleTarget,
): boolean {
  if (values.length === 0) {
    return false;
  }

  switch (property) {
    case "tautology":
      return values.every((value) => value === false);
    case "inconsistency":
      return values.every((value) => value === true);
    case "equivalence":
      return values.some((value) => value !== values[0]);
  }
}

/**
 * Whether a given row (by index into the canonical valuation order) is a genuine
 * counterexample, evaluating each formula's main connective on that row. Mirrors
 * Carnap: a **simple** table (no `premiseCount`) needs the property to hold over
 * all formulas; a **validity** table needs every premise (the first
 * `premiseCount` formulas) true and the property to hold over the conclusions
 * (the rest). A property of the public formulas alone, independent of input.
 */
export function counterexampleHolds(
  table: ResolvedTable,
  rowIndex: number,
  property: TruthTableCounterexampleTarget,
  premiseCount: number | null = null,
): boolean {
  const row = table.valuations[rowIndex];

  if (row === undefined || table.formulas.length === 0) {
    return false;
  }

  const map = valuationMap(table.atoms, row);
  const values = table.formulas.map((formula) =>
    evaluate(formula.formula, map),
  );

  if (premiseCount === null) {
    return hasProperty(values, property);
  }

  return (
    values.slice(0, premiseCount).every((value) => value === true) &&
    hasProperty(values.slice(premiseCount), property)
  );
}

/**
 * Whether the sequent holds on a given row of a `validity` table: `true` unless
 * the row is a counterexample (see {@link counterexampleHolds}). This is the
 * correct value for the turnstile column's cell — mark `T` where it holds, `F`
 * on a counterexample. `property` is the counterexample-to property (default
 * `tautology`, i.e. conclusions all false — the ordinary invalidity case).
 */
export function sequentHolds(
  table: ResolvedTable,
  premiseCount: number,
  rowIndex: number,
  property: TruthTableCounterexampleTarget = "tautology",
): boolean {
  return !counterexampleHolds(table, rowIndex, property, premiseCount);
}

/**
 * Normalize a `counterexample-to` value (or a legacy stored target) to a
 * counterexample property, folding Carnap's synonyms; `null` if unrecognized.
 */
export function normalizeCounterexampleTarget(
  value: unknown,
): TruthTableCounterexampleTarget | null {
  switch (value) {
    case "tautology":
    case "validity":
      return "tautology";
    case "inconsistency":
    case "contradiction":
      return "inconsistency";
    case "equivalence":
      return "equivalence";
    default:
      return null;
  }
}

/**
 * The counterexample configuration for a set of options: the property and
 * whether the button is offered. Reads the current shape (`counterexampleTo` +
 * `showCounterexample`) and tolerates legacy stored data, where `counterexample`
 * held a target string (button on) or `null` (button off).
 */
export function resolveCounterexample(options: TruthTableOptions): {
  readonly property: TruthTableCounterexampleTarget;
  readonly showButton: boolean;
} {
  const candidate = options as {
    counterexampleTo?: unknown;
    showCounterexample?: unknown;
    counterexample?: unknown;
  };

  if (
    candidate.counterexampleTo !== undefined ||
    typeof candidate.showCounterexample === "boolean"
  ) {
    return {
      property:
        normalizeCounterexampleTarget(candidate.counterexampleTo) ??
        "tautology",
      showButton: candidate.showCounterexample !== false,
    };
  }

  // Legacy: `counterexample` was a target string, or `null` for button-off.
  if (candidate.counterexample === null) {
    return { property: "tautology", showButton: false };
  }

  return {
    property:
      normalizeCounterexampleTarget(candidate.counterexample) ?? "tautology",
    showButton: true,
  };
}

/**
 * The premise count for a validity table, or `null` when the public data does
 * not describe a well-formed validity argument (so its turnstile column is not
 * graded). Guards stored data defensively: `premiseCount` must be an integer in
 * `[1, formulas.length - 1]` (at least one premise and one conclusion).
 */
function validityPremiseCount(
  publicData: TruthTablePublicData,
): number | null {
  if (publicData.variant !== "validity") {
    return null;
  }

  const count = publicData.premiseCount;

  return typeof count === "number" &&
    Number.isInteger(count) &&
    count >= 1 &&
    count < publicData.formulas.length
    ? count
    : null;
}

/**
 * Normalize a submitted counterexample-row index to a valid row or `null` (a
 * full-table submission): a non-negative integer strictly less than the row
 * count. Out-of-range or non-integer values collapse to `null`.
 */
function normalizeCounterexampleRow(
  answer: TruthTableAnswerData,
  rowCount: number,
): number | null {
  const value = answer.counterexample;

  if (value === undefined || value === null) {
    return null;
  }

  return Number.isInteger(value) && value >= 0 && value < rowCount
    ? value
    : null;
}

/** Whether the left reference atom columns are student-filled. */
export function referenceFillable(options: TruthTableOptions): boolean {
  return !options.autoAtoms;
}

/** Whether one formula cell is student-filled, given the fill scope. */
export function cellFillable(
  cell: CellSegment,
  options: TruthTableOptions,
): boolean {
  switch (options.fill) {
    case "all":
      return true;
    case "connectives":
      return cell.role === "connective";
    case "main":
      return cell.role === "connective" && cell.isMain;
  }
}

/**
 * The total number of student-filled cells across the whole grid. Pass
 * `hasTurnstile` for a validity table, whose turnstile column adds one
 * always-filled cell per row.
 */
export function fillableCellCount(
  table: ResolvedTable,
  options: TruthTableOptions,
  hasTurnstile = false,
): number {
  const rows = table.valuations.length;
  const referenceCells = referenceFillable(options)
    ? rows * table.atoms.length
    : 0;
  const formulaCellCount = table.formulas.reduce(
    (total, formula) =>
      total +
      rows *
        formula.cells.filter((cell) => cellFillable(cell, options)).length,
    0,
  );
  const turnstileCells = hasTurnstile ? rows : 0;

  return referenceCells + formulaCellCount + turnstileCells;
}

/**
 * The cells a student fills in a `partial` table's single row: the whole row —
 * every reference atom plus every formula cell. The `fill` scope does not apply,
 * since with no fixed key there is nothing to pre-fill the omitted cells with.
 */
export function partialFillableCellCount(table: ResolvedTable): number {
  const formulaCells = table.formulas.reduce(
    (total, formula) => total + formula.cells.length,
    0,
  );

  return table.atoms.length + formulaCells;
}

function boolToCell(value: boolean): TruthTableCellValue {
  return value ? "T" : "F";
}

function answerReferenceCell(
  answer: TruthTableAnswerData,
  row: number,
  atom: number,
): TruthTableCellValue {
  return answer.reference[row]?.[atom] ?? "";
}

function answerFormulaCell(
  answer: TruthTableAnswerData,
  formula: number,
  row: number,
  cell: number,
): TruthTableCellValue {
  return answer.cells[formula]?.[row]?.[cell] ?? "";
}

/**
 * A cell-by-cell verdict for a submitted table. `reference`/`cells` hold `true`
 * (right), `false` (wrong or blank), or `null` (a given cell — not graded), so
 * the review renderer and the client's Check can mark exactly the graded cells.
 */
export interface TruthTableGrade {
  readonly fillableCount: number;
  readonly correctCount: number;
  readonly allCorrect: boolean;
  readonly reference: readonly (readonly (boolean | null)[])[];
  readonly cells: readonly (readonly (readonly (boolean | null)[])[])[];
  /**
   * Present when the student submitted a counterexample instead of the full
   * table. `row` is the designated row; `filledCorrectly` is whether that row's
   * graded cells all match the key; `predicateHolds` is whether that row is a
   * genuine counterexample for the target. `allCorrect` is their conjunction.
   */
  readonly counterexample: {
    readonly row: number;
    readonly filledCorrectly: boolean;
    readonly predicateHolds: boolean;
  } | null;
  /**
   * The turnstile column verdicts of a `validity` table, one per row (`true`
   * right, `false` wrong or blank). `null` when this is not a validity table.
   */
  readonly validity: readonly (boolean | null)[] | null;
  /**
   * Present for the `partial` variant: whether the single row is `filledCorrectly`
   * (a complete valuation with every formula cell evaluated correctly) and
   * `consistentWithGiven` (matches at least one given, or `true` when there are no
   * givens). `hasGivens` records whether the exercise constrained the row.
   * `allCorrect` is `filledCorrectly && consistentWithGiven`.
   */
  readonly partial: {
    readonly filledCorrectly: boolean;
    readonly consistentWithGiven: boolean;
    readonly hasGivens: boolean;
  } | null;
}

/** Grade a submitted table against the key derived from the public formulas. */
export function gradeTruthTable(
  publicData: TruthTablePublicData,
  answer: TruthTableAnswerData,
): TruthTableGrade | null {
  const table = resolveTable(publicData.formulas);

  if (table === null) {
    return null;
  }

  // A partial table is a single free row with its own grading (the valuation is
  // the student's choice, so there is no fixed key), handled separately.
  if (publicData.variant === "partial") {
    return gradePartial(table, tableGivens(publicData), answer);
  }

  const options = publicData.options;
  const givens = tableGivens(publicData);
  const refFillable = referenceFillable(options);
  const keyCells = correctCells(table);
  const premiseCount = validityPremiseCount(publicData);

  // A counterexample submission grades only its one designated row; it is
  // honoured only while the exercise actually offers the button.
  const { property, showButton } = resolveCounterexample(options);
  const ceRow = showButton
    ? normalizeCounterexampleRow(answer, table.valuations.length)
    : null;
  const grades = (rowIndex: number): boolean =>
    ceRow === null || rowIndex === ceRow;

  let fillableCount = 0;
  let correctCount = 0;

  const reference = table.valuations.map((row, rowIndex) =>
    row.map((value, atomIndex) => {
      if (!refFillable || !grades(rowIndex)) {
        return null;
      }

      fillableCount += 1;
      const correct =
        answerReferenceCell(answer, rowIndex, atomIndex) ===
        boolToCell(value);

      if (correct) {
        correctCount += 1;
      }

      return correct;
    }),
  );

  const cells = table.formulas.map((formula, formulaIndex) =>
    table.valuations.map((row, rowIndex) => {
      return formula.cells.map((cell, cellIndex) => {
        // A given (seeded) cell is graded unless it is locked (`strictGivens`);
        // a plain cell is graded only when the fill scope makes it fillable.
        const seeded =
          givenCellValue(givens, row, formulaIndex, cellIndex) !== "";
        const graded = seeded
          ? !options.strictGivens
          : cellFillable(cell, options);

        if (!graded || !grades(rowIndex)) {
          return null;
        }

        fillableCount += 1;
        const expected = boolToCell(
          keyCells[formulaIndex]?.[rowIndex]?.[cellIndex] ?? false,
        );
        const correct =
          answerFormulaCell(answer, formulaIndex, rowIndex, cellIndex) ===
          expected;

        if (correct) {
          correctCount += 1;
        }

        return correct;
      });
    }),
  );

  // The turnstile column of a validity table: one mark per row, correct when it
  // matches whether the row is a counterexample (per the counterexample-to
  // property). A validity counterexample grades only its designated row (like
  // the other columns); a full-table submission grades every row.
  const validity =
    premiseCount === null
      ? null
      : table.valuations.map((_row, rowIndex) => {
          if (!grades(rowIndex)) {
            return null;
          }

          fillableCount += 1;
          const expected = boolToCell(
            !counterexampleHolds(table, rowIndex, property, premiseCount),
          );
          const correct = (answer.validity?.[rowIndex] ?? "") === expected;

          if (correct) {
            correctCount += 1;
          }

          return correct;
        });

  const filledCorrectly = fillableCount > 0 && correctCount === fillableCount;

  if (ceRow !== null) {
    const predicateHolds = counterexampleHolds(
      table,
      ceRow,
      property,
      premiseCount,
    );
    return {
      allCorrect: filledCorrectly && predicateHolds,
      cells,
      correctCount,
      counterexample: { filledCorrectly, predicateHolds, row: ceRow },
      fillableCount,
      partial: null,
      reference,
      validity,
    };
  }

  return {
    allCorrect: filledCorrectly,
    cells,
    correctCount,
    counterexample: null,
    fillableCount,
    partial: null,
    reference,
    validity,
  };
}

/**
 * A table's given rows, or `null` when there are none. For `partial` any
 * correctly filled row is then accepted; for `simple`/`validity` no cells are
 * seeded.
 */
function tableGivens(
  publicData: TruthTablePublicData,
): readonly TruthTableGivenRow[] | null {
  const givens = publicData.givens;

  return Array.isArray(givens) && givens.length > 0 ? givens : null;
}

/** Whether the submitted (partial) row matches one given's pinned cells. */
function rowMatchesGiven(
  table: ResolvedTable,
  answer: TruthTableAnswerData,
  given: TruthTableGivenRow,
): boolean {
  const refRow = answer.reference[0] ?? [];
  const referenceOk = table.atoms.every((_atom, atomIndex) => {
    const pinned = given.reference[atomIndex] ?? "";
    return pinned === "" || (refRow[atomIndex] ?? "") === pinned;
  });

  if (!referenceOk) {
    return false;
  }

  return table.formulas.every((formula, formulaIndex) =>
    formula.cells.every((_cell, cellIndex) => {
      const pinned = given.cells[formulaIndex]?.[cellIndex] ?? "";
      return (
        pinned === "" ||
        (answer.cells[formulaIndex]?.[0]?.[cellIndex] ?? "") === pinned
      );
    }),
  );
}

/**
 * Grade a `partial` submission: the student fills one free row (their own choice
 * of valuation). It is correct when the valuation is complete, every formula cell
 * evaluates that valuation correctly, and — if the exercise carries givens — the
 * row matches at least one of them. The reference (valuation) cells are the free
 * input, so they are not themselves graded; only the formula cells are.
 */
function gradePartial(
  table: ResolvedTable,
  givens: readonly TruthTableGivenRow[] | null,
  answer: TruthTableAnswerData,
): TruthTableGrade {
  const refRow = answer.reference[0] ?? [];
  const complete =
    table.atoms.length > 0 &&
    table.atoms.every((_atom, atomIndex) => {
      const value = refRow[atomIndex] ?? "";
      return value === "T" || value === "F";
    });
  const map = new Map<string, boolean>();

  if (complete) {
    for (const [atomIndex, atom] of table.atoms.entries()) {
      map.set(atom, refRow[atomIndex] === "T");
    }
  }

  const keyCells = complete
    ? table.formulas.map((formula) =>
        formula.cells.map((cell) => evaluate(cell.formula, map)),
      )
    : null;

  let fillableCount = 0;
  let correctCount = 0;

  // The valuation is the student's free choice, so reference cells carry no
  // verdict (all null); only the single row exists.
  const reference = [table.atoms.map(() => null)];

  const cells = table.formulas.map((formula, formulaIndex) => [
    formula.cells.map((_cell, cellIndex) => {
      fillableCount += 1;
      const expected =
        keyCells === null
          ? null
          : boolToCell(keyCells[formulaIndex]?.[cellIndex] ?? false);
      const submitted = answer.cells[formulaIndex]?.[0]?.[cellIndex] ?? "";
      const correct = expected !== null && submitted === expected;

      if (correct) {
        correctCount += 1;
      }

      return correct;
    }),
  ]);

  const filledCorrectly =
    complete && fillableCount > 0 && correctCount === fillableCount;
  const consistentWithGiven =
    givens === null ||
    givens.some((given) => rowMatchesGiven(table, answer, given));

  return {
    allCorrect: filledCorrectly && consistentWithGiven,
    cells,
    correctCount,
    counterexample: null,
    fillableCount,
    partial: {
      consistentWithGiven,
      filledCorrectly,
      hasGivens: givens !== null,
    },
    reference,
    validity: null,
  };
}

/** The fraction of possible credit [0, 1] for a grade under a grading mode. */
export function truthTableScoreFraction(
  grade: TruthTableGrade,
  grading: TruthTableOptions["grading"],
): number {
  // A counterexample is an all-or-nothing claim ("this row disproves it"), so it
  // is never partially credited, even under partial grading.
  if (grade.counterexample !== null) {
    return grade.allCorrect ? 1 : 0;
  }

  // A partial row that must match givens is a single claim ("here is a witness"),
  // so it is all-or-nothing. Without givens it is an ordinary fill and may earn
  // partial credit for its correct cells under partial grading.
  if (grade.partial !== null) {
    if (grade.partial.hasGivens || grading === "all-or-nothing") {
      return grade.allCorrect ? 1 : 0;
    }

    return grade.fillableCount === 0
      ? 0
      : grade.correctCount / grade.fillableCount;
  }

  if (grading === "all-or-nothing") {
    return grade.allCorrect ? 1 : 0;
  }

  if (grade.fillableCount === 0) {
    return 0;
  }

  return grade.correctCount / grade.fillableCount;
}

function isCellValue(value: unknown): value is TruthTableCellValue {
  return value === "T" || value === "F" || value === "";
}

function isCellRow(value: unknown): value is TruthTableCellValue[] {
  return Array.isArray(value) && value.every(isCellValue);
}

function isCellGrid(value: unknown): value is TruthTableCellValue[][] {
  return Array.isArray(value) && value.every(isCellRow);
}

function isOptions(value: unknown): value is TruthTableOptions {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    (candidate.fill === "all" ||
      candidate.fill === "connectives" ||
      candidate.fill === "main") &&
    (candidate.grading === "all-or-nothing" ||
      candidate.grading === "partial") &&
    // `check` was added later; tolerate its absence so earlier-compiled data
    // still validates (readers default it to "cells").
    (candidate.check === undefined ||
      candidate.check === "cells" ||
      candidate.check === "terse" ||
      candidate.check === "off") &&
    // Counterexample config: accept the current shape (`counterexampleTo` +
    // `showCounterexample`) and legacy data, where `counterexample` was a target
    // string or `null`. All are optional so earlier-compiled data validates.
    (candidate.counterexampleTo === undefined ||
      normalizeCounterexampleTarget(candidate.counterexampleTo) !== null) &&
    (candidate.showCounterexample === undefined ||
      typeof candidate.showCounterexample === "boolean") &&
    (candidate.counterexample === undefined ||
      candidate.counterexample === null ||
      normalizeCounterexampleTarget(candidate.counterexample) !== null) &&
    typeof candidate.autoAtoms === "boolean" &&
    typeof candidate.nodash === "boolean" &&
    // `hiddenGivens`/`strictGivens` were added with the partial variant; the
    // Phase-6 marks/turnstile options later still. All are tolerated absent so
    // earlier-compiled data validates (readers default them).
    (candidate.hiddenGivens === undefined ||
      typeof candidate.hiddenGivens === "boolean") &&
    (candidate.strictGivens === undefined ||
      typeof candidate.strictGivens === "boolean") &&
    (candidate.trueMark === undefined ||
      typeof candidate.trueMark === "string") &&
    (candidate.falseMark === undefined ||
      typeof candidate.falseMark === "string") &&
    (candidate.turnstileGlyph === undefined ||
      candidate.turnstileGlyph === "single" ||
      candidate.turnstileGlyph === "double" ||
      candidate.turnstileGlyph === "negated-double")
  );
}

/** Structural guard for one given row (reference pattern + per-cell pins). */
function isGivenRow(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    isCellRow((value as { reference?: unknown }).reference) &&
    isCellGrid((value as { cells?: unknown }).cells)
  );
}

/** Structural guard for a table's given rows. */
function isGivenRows(value: unknown): boolean {
  return Array.isArray(value) && value.every(isGivenRow);
}

/** Structural guard for the stored public data. */
export function isTruthTablePublicData(
  value: unknown,
): value is TruthTablePublicData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const formulasOk =
    Array.isArray(candidate.formulas) &&
    candidate.formulas.every((formula) => typeof formula === "string");
  // `premiseCount` accompanies the validity variant only, and must name a real
  // split (≥1 premise, ≥1 conclusion). Simple tables must not carry it.
  const premiseCountOk =
    candidate.variant === "validity"
      ? Array.isArray(candidate.formulas) &&
        typeof candidate.premiseCount === "number" &&
        Number.isInteger(candidate.premiseCount) &&
        candidate.premiseCount >= 1 &&
        candidate.premiseCount < candidate.formulas.length
      : candidate.premiseCount === undefined;
  // Givens may accompany any variant, and are optional.
  const givensOk =
    candidate.givens === undefined ? true : isGivenRows(candidate.givens);

  return (
    (candidate.variant === "simple" ||
      candidate.variant === "validity" ||
      candidate.variant === "partial") &&
    typeof candidate.promptHtml === "string" &&
    formulasOk &&
    premiseCountOk &&
    givensOk &&
    isOptions(candidate.options)
  );
}

/** Structural guard for a submitted answer payload. */
export function isTruthTableAnswerData(
  value: unknown,
): value is TruthTableAnswerData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    reference?: unknown;
    cells?: unknown;
    counterexample?: unknown;
    validity?: unknown;
  };

  const counterexampleOk =
    candidate.counterexample === undefined ||
    candidate.counterexample === null ||
    (typeof candidate.counterexample === "number" &&
      Number.isInteger(candidate.counterexample) &&
      candidate.counterexample >= 0);

  const validityOk =
    candidate.validity === undefined || isCellRow(candidate.validity);

  return (
    isCellGrid(candidate.reference) &&
    Array.isArray(candidate.cells) &&
    candidate.cells.every(isCellGrid) &&
    counterexampleOk &&
    validityOk
  );
}
