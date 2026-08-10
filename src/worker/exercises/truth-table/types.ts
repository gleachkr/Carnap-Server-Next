/**
 * Constants and data shapes for the truth-table exercise type. DOM-free; the
 * grading core, authoring, assessment, view, and client element all share it.
 */

export const TRUTH_TABLE_KIND = "truth-table@1";
export const TRUTH_TABLE_SCHEMA_VERSION = 1;
export const TRUTH_TABLE_ANSWER_KIND = "truth-table-answer@1";
export const TRUTH_TABLE_COMPONENT_METADATA = {
  assetId: "carnap-truth-table-v1",
  clientModule: true,
  component: "carnap-truth-table",
  componentVersion: "1",
} as const;

/**
 * The truth-table task shape:
 *   - `simple`   construct a table for one or more formulas (tautology /
 *                counterexample); the default.
 *   - `validity` test an argument written with the `:|-:` turnstile; the grid
 *                gains one **turnstile column** the student marks `T`/`F` per
 *                row (`F` = that row is a counterexample: every premise true and
 *                every conclusion false).
 *   - `partial`  fill in a single free row: the student chooses the atom
 *                valuation and completes that one row's cells. Correct when the
 *                row is filled consistently with the chosen valuation and (if the
 *                exercise carries {@link TruthTablePublicData.givens}) matches at
 *                least one given.
 */
export type TruthTableVariant = "simple" | "validity" | "partial";

/**
 * Which cells the student fills — an authoring choice, not a property of the
 * type (see [[truth-tables-plan]]):
 *   - `all`         every atom-occurrence and connective cell (Carnap default)
 *   - `connectives` only the sub-formula (connective) columns
 *   - `main`        only the main-connective column of each formula
 */
export type TruthTableFillScope = "all" | "connectives" | "main";

/** How a submitted table is scored. */
export type TruthTableGrading = "all-or-nothing" | "partial";

/**
 * How the local Check reports results (Submit always grades authoritatively):
 *   - `cells` marks every graded cell green/red with a running count
 *   - `terse` only says whether the table is right or "there's an error
 *             somewhere", so students go hunting for it
 *   - `off`   no Check button at all (cf. Carnap `nocheck`)
 */
export type TruthTableCheckMode = "cells" | "terse" | "off";

/**
 * The property a counterexample row must exhibit, mirroring Carnap's
 * `counterexample-to`. Over a set of formula values on a row:
 *   - `tautology`     every value is false (Carnap synonym: `validity`)
 *   - `equivalence`   the values are not all equal (some formula disagrees)
 *   - `inconsistency` every value is true (Carnap synonym: `contradiction`)
 *
 * How it is applied depends on the variant (see {@link counterexampleHolds}):
 * a **simple** table applies it to all formulas; a **validity** table requires
 * every premise (left of the turnstile) true and applies the property to the
 * conclusions (right of the turnstile).
 */
export type TruthTableCounterexampleTarget =
  | "tautology"
  | "equivalence"
  | "inconsistency";

/**
 * Which glyph labels a validity table's turnstile column (display only; the
 * column's per-row values stay `T`/`F`):
 *   - `single`         `⊢` (default)
 *   - `double`         `⊨` (cf. Carnap `double-turnstile`)
 *   - `negated-double` `⊭` (cf. Carnap `negated-double-turnstile`)
 */
export type TruthTableTurnstileGlyph = "single" | "double" | "negated-double";

export interface TruthTableOptions {
  readonly fill: TruthTableFillScope;
  readonly grading: TruthTableGrading;
  readonly check: TruthTableCheckMode;
  /**
   * The counterexample property (cf. Carnap `counterexample-to`), default
   * `"tautology"`. It defines both what a submitted counterexample row must show
   * and — for a validity table — the correct value of its turnstile column, so
   * it applies even when the button is hidden. Legacy stored data instead carried
   * a `counterexample: target | null` field; {@link resolveCounterexample} reads
   * either shape.
   */
  readonly counterexampleTo: TruthTableCounterexampleTarget;
  /**
   * Whether the "Find counterexample" button is offered (cf. Carnap
   * `nocounterexample`, which sets this `false`). Independent of the property.
   */
  readonly showCounterexample: boolean;
  /** Prefill (give) the reference atom columns; cf. Carnap `autoAtoms`. */
  readonly autoAtoms: boolean;
  /** Draw empty cells blank rather than with a dash; cf. Carnap `nodash`. */
  readonly nodash: boolean;
  /**
   * Hide a partial table's givens (cf. Carnap `hiddenGivens`): they still
   * constrain the accepted solution, but the row starts blank rather than
   * pre-filled. Only meaningful for the `partial` variant.
   */
  readonly hiddenGivens: boolean;
  /**
   * Lock every seeded given cell so the student cannot edit it (cf. Carnap
   * `strictGivens`, "makes givens immutable"): given cells render inert and are
   * not graded. Without it, a given cell is prefilled but editable (and graded
   * like any other cell). Applies to any variant carrying
   * {@link TruthTablePublicData.givens}. (Carnap's separate whole-table
   * `immutable` display lock is not yet implemented.)
   */
  readonly strictGivens: boolean;
  /** Glyph rendered for a true cell in place of `T`; cf. Carnap `trueMark`. */
  readonly trueMark: string;
  /** Glyph rendered for a false cell in place of `F`; cf. Carnap `falseMark`. */
  readonly falseMark: string;
  /** Which glyph labels a validity table's turnstile column. */
  readonly turnstileGlyph: TruthTableTurnstileGlyph;
}

/**
 * A "given" row the author seeds, aligned to {@link TruthTablePublicData.formulas}
 * and the shared cell layout. Positions left `""` are unconstrained.
 *
 *   - `reference[atomIndex]` — a valuation pattern. For `simple`/`validity` it
 *     selects which of the 2ⁿ rows the row's cell pins apply to (a `T`/`F` token
 *     matches rows with that atom value; `""` is a wildcard). For `partial` it
 *     pins the student's single chosen valuation.
 *   - `cells[formulaIndex][cellIndex]` — pins one written cell of a formula to
 *     `T`/`F` (any cell in the formula's layout, not just the main connective).
 *
 * A table may carry several given rows. For `simple`/`validity` each seeds the
 * matched rows' cells (validated against the computed key when authored). For
 * `partial` each is an alternative a solution may match — accept-any-one — so
 * multiple rows express alternatives (e.g. the two rows that witness an
 * inequivalence).
 */
export interface TruthTableGivenRow {
  readonly reference: readonly TruthTableCellValue[];
  readonly cells: readonly (readonly TruthTableCellValue[])[];
}

export interface TruthTablePublicData {
  readonly variant: TruthTableVariant;
  readonly promptHtml: string;
  /**
   * Canonical `prop` source for each formula, in author order. For the
   * `validity` variant this is the premises followed by the conclusions, and
   * {@link premiseCount} marks the boundary.
   */
  readonly formulas: readonly string[];
  /**
   * Present only for the `validity` variant: how many leading entries of
   * {@link formulas} are premises (the rest are conclusions). Always at least 1,
   * and strictly less than `formulas.length` (there is at least one conclusion).
   * Absent for `simple`.
   */
  readonly premiseCount?: number;
  /**
   * The author-seeded given rows, when any. For `simple`/`validity` they
   * prepopulate the matched rows' cells (scaffolding); for `partial` they are the
   * alternative row-constraints a solution must match one of. Absent (or empty)
   * means no cells are seeded / any correctly filled row is accepted.
   */
  readonly givens?: readonly TruthTableGivenRow[];
  readonly options: TruthTableOptions;
}

/** A single grid cell's value: true, false, or unfilled. */
export type TruthTableCellValue = "T" | "F" | "";

/**
 * A submitted table, positionally aligned to the layout both sides derive from
 * {@link TruthTablePublicData.formulas} via the logic core:
 *   - `reference[rowIndex][atomIndex]` — the left reference atom columns
 *   - `cells[formulaIndex][rowIndex][cellIndex]` — each formula's written cells
 */
export interface TruthTableAnswerData {
  readonly reference: readonly (readonly TruthTableCellValue[])[];
  readonly cells: readonly (readonly (readonly TruthTableCellValue[])[])[];
  /**
   * The turnstile column of a `validity` table: one mark per row (aligned to the
   * canonical valuation order), where the student asserts `T` if the sequent
   * holds on that row and `F` if that row is a counterexample to validity.
   * Absent for the `simple` variant.
   */
  readonly validity?: readonly TruthTableCellValue[];
  /**
   * When present, the student submitted a counterexample rather than the full
   * table: the index of the one row (into the canonical valuation order) they
   * designate as the counterexample. Only that row's cells are graded, and the
   * row must additionally satisfy the exercise's counterexample target. Absent or
   * `null` for an ordinary full-table submission.
   */
  readonly counterexample?: number | null;
}
