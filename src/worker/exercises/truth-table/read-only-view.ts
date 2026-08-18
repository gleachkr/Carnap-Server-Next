import {
  contentRevisionAttribute,
  escapeHtml,
} from "../../application/content/render-support";
import type { ExerciseRenderContext } from "../../application/content/renderer";
import type { ContentNode } from "../../domain/content";
import type { Translator } from "../../i18n/translator";
import { previewExerciseActionsHtml } from "../actions";
import {
  EXERCISE_GROUP_SHADOW_STYLES,
  exerciseGroupLabel,
  exerciseLegendHtml,
} from "../group";
import { reviewHydrationScript } from "../hydration";
import {
  cellFillable,
  correctCells,
  givenCellValue,
  gradeTruthTable,
  isTruthTablePublicData,
  type ResolvedTable,
  referenceFillable,
  resolveCounterexample,
  resolveTable,
} from "./grading";
import { buildTruthTableStrings, type TruthTableStrings } from "./strings";
import type {
  TruthTableAnswerData,
  TruthTableCellValue,
  TruthTableGivenRow,
  TruthTableOptions,
  TruthTablePublicData,
} from "./types";
import { TRUTH_TABLE_COMPONENT_METADATA, TRUTH_TABLE_KIND } from "./types";

/**
 * Shadow-DOM chrome for the truth-table element, server-rendered into its
 * Declarative Shadow Root so it is isolated from author `:::style` CSS and needs
 * no JS to render. The prompt is slotted from light DOM so author CSS and the
 * document's math font
 * still reach it; the grid chrome cannot be. Custom properties (`--blue-strong`,
 * `--green`, `--red`, `--ink-muted`) inherit across the boundary.
 */
const TRUTH_TABLE_SHADOW_STYLES = `
  ${EXERCISE_GROUP_SHADOW_STYLES}

  /* Block, not grid: the run-in legend floats, and floats do not apply to grid
     items (see EXERCISE_GROUP_STYLES). What the grid's gap used to space, the
     children now space themselves — the slotted prompt and action bar carry page
     margins already, so only the note below needs one. */
  .tt-wrap {
    display: block;
  }

  .tt-scroll {
    overflow-x: auto;
  }

  table.tt {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  .tt th,
  .tt td {
    border: 1px solid var(--rule, #d8d0c3);
    min-width: 2rem;
    padding: 0.2rem 0.4rem;
    text-align: center;
  }

  /* The rule under the header carries the same weight as the separators between
     formulas (.tt-sep): both mark a division of the table itself rather than the
     grid of its cells, so they should read alike. */
  .tt thead th {
    border-bottom: 2px solid var(--ink, #16324a);
    font-weight: 600;
  }

  .tt .tt-paren {
    border-inline: 0;
    color: var(--ink-muted, #5f7388);
    min-width: 0;
    padding-inline: 0.1rem;
  }

  /*
   * Parens drop their side borders so they blend, but that erases the table's
   * outer edge when a formula ends (or starts) with one. Force the edge back on
   * the first and last cell of every row.
   */
  .tt tr > :first-child {
    border-inline-start: 1px solid var(--rule, #d8d0c3);
  }

  .tt tr > :last-child {
    border-inline-end: 1px solid var(--rule, #d8d0c3);
  }

  .tt .tt-sep {
    border-left: 2px solid var(--ink, #16324a);
  }

  .tt .tt-main {
    background: color-mix(in srgb, var(--gold, #9a6400) 12%, transparent);
    font-weight: 600;
  }

  .tt .tt-turnstile {
    font-weight: 600;
  }

  .tt-cell {
    background: var(--surface, #fbf7ef);
    border: 1px solid var(--rule, #d8d0c3);
    border-radius: 3px;
    color: inherit;
    cursor: pointer;
    font: inherit;
    min-width: 1.6rem;
    padding: 0.05rem 0.3rem;
  }

  .tt-cell[disabled] {
    cursor: default;
  }

  /* The grid is navigated by arrow key, so the ring is not a nicety — it is the
     only thing telling a keyboard user which of 32 cells they are about to
     change. Drawn outside the border so it reads against the filled and the
     marked states alike. */
  .tt-cell:focus-visible {
    outline: 2px solid var(--blue-strong, #074f9f);
    outline-offset: 2px;
  }

  .tt-cell[data-tt-value=""] {
    color: var(--ink-muted, #5f7388);
  }

  /*
   * A blank cell is still a cell. The nodash option leaves the glyph out
   * altogether, and an element with no text has no line box at all, so the button
   * collapses to its padding — a row of slivers instead of a grid, and a row that
   * jumps taller the moment a student puts a value in it. A zero-width space gives
   * every empty cell a line to stand on, so a blank one is exactly as tall as a
   * filled one whatever glyph (or none) the author chose. Selected on the value
   * rather than a class, because all three writers of an empty cell — the fillable
   * button, the scaffolded given, the withheld review — carry data-tt-value, and
   * only the blank value can be glyphless (a true/false mark is required
   * non-empty). Nothing hears it: the cells are named by aria-label, and a
   * zero-width space is nothing to read out in the first place.
   */
  .tt [data-tt-value=""]::before {
    content: "\\200b";
  }

  .tt-given {
    color: var(--ink-muted, #5f7388);
  }

  .tt-correct {
    color: var(--green, #1b7048);
    font-weight: 600;
  }

  .tt-incorrect {
    color: var(--red, #b42318);
    font-weight: 600;
  }

  .tt-cell.tt-correct {
    border-color: var(--green, #1b7048);
  }

  .tt-cell.tt-incorrect {
    border-color: var(--red, #b42318);
  }

  /* The Check / counterexample controls live in the shared light-DOM action bar
     (styled in the content stylesheet, so author CSS reaches every exercise's
     buttons uniformly), not in this shadow chrome. */

  /*
   * The counterexample selector: one radio per row, in a leading column the grid
   * always carries and shows only while the student is making that claim. Server
   * markup rather than cells the client injects, so the column is styled and
   * named by the same code as the rest of the grid; display:none rather than
   * visibility, so an unpressed table is exactly the table it was before.
   */
  .tt-ce-select {
    display: none;
  }

  .tt.tt-ce-mode .tt-ce-select {
    display: table-cell;
  }

  .tt-ce-radio {
    accent-color: var(--blue-strong, #074f9f);
    cursor: pointer;
    margin: 0;
  }

  /* The row the student is claiming as their counterexample. Nothing else recedes:
     the rest of the table is their own work, filled in as usual, and dimming it
     would make the grid they are reading from harder to read. */
  .tt tr.tt-ce-row > * {
    background: color-mix(in srgb, var(--gold, #9a6400) 14%, transparent);
  }

  .tt-ce-note {
    color: var(--ink-muted, #5f7388);
    margin: 0.75rem 0 0;
  }

  .tt-ce-note[data-state="correct"] {
    color: var(--green, #1b7048);
    font-weight: 600;
  }

`;

interface TruthTableElementMeta {
  readonly component: string;
  readonly componentVersion: string;
  readonly contentRevisionId?: string | undefined;
  readonly exerciseId: string;
  readonly exerciseKind: string;
  readonly i18n: Translator;
  /** The author's title, or null for the hidden generic group name. */
  readonly title: string | null;
}

/** How cell values render: the dash toggle plus the true/false glyphs. */
interface CellMarks {
  readonly nodash: boolean;
  readonly trueMark: string;
  readonly falseMark: string;
}

/** The rendering marks for a table's options (defaulting legacy-absent fields). */
function marksOf(options: TruthTableOptions): CellMarks {
  return {
    falseMark: options.falseMark ?? "F",
    nodash: options.nodash,
    trueMark: options.trueMark ?? "T",
  };
}

function cellGlyph(value: TruthTableCellValue, marks: CellMarks): string {
  if (value === "T") {
    return escapeHtml(marks.trueMark);
  }

  if (value === "F") {
    return escapeHtml(marks.falseMark);
  }

  return marks.nodash ? "" : "–";
}

function boolToCell(value: boolean): TruthTableCellValue {
  return value ? "T" : "F";
}

/** The glyph heading a validity table's mark column (cf. Carnap turnstile flags). */
function turnstileGlyphFor(options: TruthTableOptions): string {
  switch (options.turnstileGlyph) {
    case "double":
      return "⊨";
    case "negated-double":
      return "⊭";
    default:
      return "⊢";
  }
}

/**
 * The premise/conclusion split of a validity table, or `null` for a table with
 * no turnstile column (the simple variant, or malformed data).
 */
function turnstileSplit(publicData: TruthTablePublicData): number | null {
  if (publicData.variant !== "validity") {
    return null;
  }

  const count = publicData.premiseCount;

  return typeof count === "number" &&
    count >= 1 &&
    count < publicData.formulas.length
    ? count
    : null;
}

/** The written-out header cells for one formula (no turnstile handling). */
function formulaHead(formula: ResolvedTable["formulas"][number]): string {
  return formula.segments
    .map((segment, index) => {
      const sep = index === 0 ? " tt-sep" : "";

      if (segment.kind === "paren") {
        return `<th class="tt-paren${sep}" aria-hidden="true">${escapeHtml(segment.text)}</th>`;
      }

      const main = segment.isMain ? " tt-main" : "";
      return `<th scope="col" class="${sep === "" && main === "" ? "" : `${sep}${main}`.trim()}">${escapeHtml(segment.text)}</th>`;
    })
    .join("");
}

/**
 * The counterexample selector's header cell. Its name is for a reader who meets
 * the column with no grid to look at; sighted readers have the radios and the
 * hint in the status line, and a visible heading over a column of radios would
 * only widen the table.
 */
function ceSelectHead(strings: TruthTableStrings): string {
  return `<th scope="col" class="tt-ce-select"><span class="visually-hidden">${escapeHtml(strings["Counterexample row"])}</span></th>`;
}

/**
 * One row's counterexample radio. Disabled like the cell buttons, for the same
 * reason: before the element upgrades nothing here works, and a control that
 * takes focus and does nothing is worse than one that says it is not ready.
 * `aria-label` carries the whole claim ("use row 3…") because the column heading
 * is not part of a radio's accessible name.
 */
function ceSelectCell(rowIndex: number, strings: TruthTableStrings): string {
  const label = strings["Use row {row} as the counterexample"].replace(
    "{row}",
    String(rowIndex + 1),
  );

  return `<td class="tt-ce-select"><input class="tt-ce-radio" type="radio" name="tt-ce-row" value="${rowIndex}" disabled aria-label="${escapeHtml(label)}"></td>`;
}

/**
 * The header row: the counterexample selector (when the table offers one),
 * reference atom columns, then each formula written out. For a validity table
 * the turnstile column is inserted between the last premise and the first
 * conclusion (at formula index `premiseCount`).
 */
function headerRow(
  table: ResolvedTable,
  premiseCount: number | null,
  turnstileGlyph: string,
  ceSelect = "",
): string {
  const atomHeads = table.atoms
    .map((atom) => `<th scope="col">${escapeHtml(atom)}</th>`)
    .join("");
  const formulaHeads = table.formulas
    .map((formula, formulaIndex) => {
      const turnstile =
        premiseCount !== null && formulaIndex === premiseCount
          ? `<th scope="col" class="tt-sep tt-turnstile">${turnstileGlyph}</th>`
          : "";
      return turnstile + formulaHead(formula);
    })
    .join("");

  return `<tr>${ceSelect}${atomHeads}${formulaHeads}</tr>`;
}

/**
 * One grid cell. Fillable cells are inert `<button>`s the element enables and
 * cycles; given cells are `<span>`s showing the scaffolded value. Both carry the
 * same `data-tt-*` coordinates and a `data-tt-value` so the element can read the
 * whole grid — given cells included — back into a full-width answer.
 */
function bodyCell(
  coords: string,
  fillable: boolean,
  value: TruthTableCellValue,
  marks: CellMarks,
  extraClass: string,
  name: CellName | null = null,
): string {
  if (fillable) {
    // `data-tt-name` carries the column's name so the client can rebuild the
    // accessible name after every click without re-deriving the grid's geometry.
    const named =
      name === null
        ? ""
        : ` aria-label="${escapeHtml(cellAccessibleName(name, value))}" data-tt-name="${escapeHtml(name.column)}"`;

    // `tabindex="-1"` on every fillable cell: the grid is one tab stop, and the
    // client promotes whichever cell holds focus (see the roving focus in
    // `carnap-truth-table-v1.ts`). A 4-variable table is 32 cells, and tabbing
    // through all of them to reach the next exercise is its own barrier. Safe
    // before hydration because these buttons ship `disabled`, so nothing is
    // focusable either way until the element upgrades.
    return `<td class="${`tt-input${extraClass}`.trim()}"><button class="tt-cell" type="button" disabled tabindex="-1" ${coords} data-tt-value="${value}"${named}>${cellGlyph(value, marks)}</button></td>`;
  }

  return `<td class="${`tt-given-cell${extraClass}`.trim()}"><span class="tt-given" ${coords} data-tt-value="${value}">${cellGlyph(value, marks)}</span></td>`;
}

/**
 * What one cell is called: its column, its 1-based row, and its value in words.
 * Sighted readers get all three from the grid's geometry and the glyph; a screen
 * reader gets only the button's name, so the name has to carry them.
 */
interface CellName {
  readonly column: string;
  /** 0-based; null on a `partial` table, whose one row has no fixed identity. */
  readonly rowIndex: number | null;
  readonly strings: TruthTableStrings;
}

function cellAccessibleName(
  name: CellName,
  value: TruthTableCellValue,
): string {
  const word =
    value === "T"
      ? name.strings.true
      : value === "F"
        ? name.strings.false
        : name.strings.blank;

  if (name.rowIndex === null) {
    return name.strings["{column}: {value}"]
      .replace("{column}", name.column)
      .replace("{value}", word);
  }

  return name.strings["{column}, row {row}: {value}"]
    .replace("{column}", name.column)
    .replace("{row}", String(name.rowIndex + 1))
    .replace("{value}", word);
}

/** The fillable turnstile-column cell for one row of a validity table. */
function turnstileBodyCell(
  rowIndex: number,
  marks: CellMarks,
  strings: TruthTableStrings,
): string {
  return bodyCell(
    `data-tt-role="validity" data-tt-row="${rowIndex}"`,
    true,
    "",
    marks,
    " tt-sep tt-turnstile",
    { column: strings.Turnstile, rowIndex, strings },
  );
}

/** One body row of the interactive/inert grid for a single valuation. */
function bodyRow(
  table: ResolvedTable,
  options: TruthTableOptions,
  keyCells: readonly (readonly (readonly boolean[])[])[],
  givens: readonly TruthTableGivenRow[] | null,
  marks: CellMarks,
  rowIndex: number,
  premiseCount: number | null,
  strings: TruthTableStrings,
  ceSelect: boolean,
): string {
  const refFillable = referenceFillable(options);
  const valuation = table.valuations[rowIndex] ?? [];
  const referenceCells = table.atoms
    .map((atom, atomIndex) => {
      const value = refFillable
        ? ""
        : boolToCell(valuation[atomIndex] ?? false);
      return bodyCell(
        `data-tt-role="reference" data-tt-row="${rowIndex}" data-tt-atom="${atomIndex}"`,
        refFillable,
        value,
        marks,
        "",
        { column: atom, rowIndex, strings },
      );
    })
    .join("");

  const formulaCells = table.formulas
    .map((formula, formulaIndex) => {
      let cellIndex = -1;

      const turnstile =
        premiseCount !== null && formulaIndex === premiseCount
          ? turnstileBodyCell(rowIndex, marks, strings)
          : "";

      return (
        turnstile +
        formula.segments
          .map((segment, segmentIndex) => {
            const sep = segmentIndex === 0 ? " tt-sep" : "";

            if (segment.kind === "paren") {
              return `<td class="tt-paren${sep}"></td>`;
            }

            cellIndex += 1;
            const main = segment.isMain ? " tt-main" : "";
            const extra = `${sep}${main}`;
            // A seeded (given) cell is prefilled; locked when `strictGivens`,
            // else editable. A plain cell follows the fill scope, prefilled with
            // the key when it is not fillable.
            const seeded = givenCellValue(
              givens,
              valuation,
              formulaIndex,
              cellIndex,
            );
            const fillable =
              seeded !== ""
                ? !options.strictGivens
                : cellFillable(segment, options);
            const value =
              seeded !== ""
                ? seeded
                : fillable
                  ? ""
                  : boolToCell(
                      keyCells[formulaIndex]?.[rowIndex]?.[cellIndex] ??
                        false,
                    );

            return bodyCell(
              `data-tt-role="cell" data-tt-formula="${formulaIndex}" data-tt-row="${rowIndex}" data-tt-cell="${cellIndex}"`,
              fillable,
              value,
              marks,
              extra,
              { column: segment.text, rowIndex, strings },
            );
          })
          .join("")
      );
    })
    .join("");

  const select = ceSelect ? ceSelectCell(rowIndex, strings) : "";

  return `<tr>${select}${referenceCells}${formulaCells}</tr>`;
}

/**
 * The single given (if any) a partial table should pre-fill into its row, plus
 * whether it is frozen. Only a lone visible given is pre-filled: with several
 * givens they are alternatives (ambiguous to show), and `hiddenGivens` keeps them
 * off the grid entirely. In both those cases the row starts blank.
 */
function partialDisplay(
  publicData: TruthTablePublicData,
): { given: TruthTableGivenRow; locked: boolean } | null {
  const givens = publicData.givens;

  if (
    publicData.variant !== "partial" ||
    publicData.options.hiddenGivens ||
    !Array.isArray(givens) ||
    givens.length !== 1
  ) {
    return null;
  }

  const given = givens[0];

  return given === undefined
    ? null
    : { given, locked: publicData.options.strictGivens === true };
}

/**
 * The single body row of a `partial` table: the student picks the valuation and
 * fills every cell (the `fill` scope does not apply — with no fixed key there is
 * nothing to pre-fill the omitted cells with). A lone visible given pre-fills the
 * cells it pins, frozen when `strictGivens` is set.
 */
function partialBodyRow(
  table: ResolvedTable,
  marks: CellMarks,
  display: { given: TruthTableGivenRow; locked: boolean } | null,
  strings: TruthTableStrings,
): string {
  const referenceCells = table.atoms
    .map((atom, atomIndex) => {
      const pinned = display?.given.reference[atomIndex] ?? "";
      const locked = display?.locked === true && pinned !== "";
      return bodyCell(
        `data-tt-role="reference" data-tt-row="0" data-tt-atom="${atomIndex}"`,
        !locked,
        pinned,
        marks,
        "",
        { column: atom, rowIndex: null, strings },
      );
    })
    .join("");

  const formulaCells = table.formulas
    .map((formula, formulaIndex) => {
      let cellIndex = -1;

      return formula.segments
        .map((segment, segmentIndex) => {
          const sep = segmentIndex === 0 ? " tt-sep" : "";

          if (segment.kind === "paren") {
            return `<td class="tt-paren${sep}"></td>`;
          }

          cellIndex += 1;
          const main = segment.isMain ? " tt-main" : "";
          // A partial given may pin any cell of the formula, not just its main.
          const pinned =
            display?.given.cells[formulaIndex]?.[cellIndex] ?? "";
          const locked = display?.locked === true && pinned !== "";

          return bodyCell(
            `data-tt-role="cell" data-tt-formula="${formulaIndex}" data-tt-row="0" data-tt-cell="${cellIndex}"`,
            !locked,
            pinned,
            marks,
            `${sep}${main}`,
            { column: segment.text, rowIndex: null, strings },
          );
        })
        .join("");
    })
    .join("");

  return `<tr>${referenceCells}${formulaCells}</tr>`;
}

/** The review body row of a `partial` submission: the one row, cells marked. */
function partialReviewRow(
  table: ResolvedTable,
  options: TruthTableOptions,
  grade: NonNullable<ReturnType<typeof gradeTruthTable>>,
  answer: TruthTableAnswerData,
  strings: TruthTableStrings,
  reveal: boolean,
): string {
  const marks = marksOf(options);
  const referenceCells = table.atoms
    .map((_atom, atomIndex) => {
      // The valuation is the student's free choice — shown, but not graded.
      const submitted = answer.reference[0]?.[atomIndex] ?? "";
      return `<td>${reviewMark(null, submitted, marks, strings, reveal)}</td>`;
    })
    .join("");

  const formulaCells = table.formulas
    .map((formula, formulaIndex) => {
      let cellIndex = -1;

      return formula.segments
        .map((segment, segmentIndex) => {
          const sep = segmentIndex === 0 ? " tt-sep" : "";

          if (segment.kind === "paren") {
            return `<td class="tt-paren${sep}"></td>`;
          }

          cellIndex += 1;
          const c = cellIndex;
          const main = segment.isMain ? " tt-main" : "";
          const cls = `${sep}${main}`.trim();
          const verdict = grade.cells[formulaIndex]?.[0]?.[c] ?? null;
          const submitted = answer.cells[formulaIndex]?.[0]?.[c] ?? "";
          return `<td class="${cls}">${reviewMark(verdict, submitted, marks, strings, reveal)}</td>`;
        })
        .join("");
    })
    .join("");

  return `<tr>${referenceCells}${formulaCells}</tr>`;
}

/** The review note under a partial table, explaining the verdict. */
function partialReviewNote(
  grade: NonNullable<ReturnType<typeof gradeTruthTable>>,
  strings: TruthTableStrings,
): string {
  const partial = grade.partial;

  if (partial === null) {
    return "";
  }

  if (grade.allCorrect) {
    return `<p class="tt-ce-note" data-state="correct">${escapeHtml(strings["That row is correct."])}</p>`;
  }

  const text =
    partial.hasGivens &&
    partial.filledCorrectly &&
    !partial.consistentWithGiven
      ? strings[
          "This row is filled in correctly, but it doesn't satisfy the given conditions."
        ]
      : strings["This row isn't filled in correctly yet."];

  return `<p class="tt-ce-note">${escapeHtml(text)}</p>`;
}

function slottedPrompt(promptHtml: string): string {
  if (promptHtml.trim().length === 0) {
    return "";
  }

  return `<div class="exercise-prompt" slot="prompt">${promptHtml}</div>`;
}

/**
 * The grid and its chrome as one named group. A `<fieldset>` rather than the
 * plain `<div>` this used to be: the cells are form controls, and without a group
 * around them a reader arriving at a page of tables has nothing to say which
 * table they are in. `legend` is empty only on the review path, where the
 * enclosing submission card already names the exercise.
 */
function gridMarkup(
  inner: string,
  legend: string,
  extra = "",
  /**
   * How to drive the grid from the keyboard, for the answering path only (the
   * review path has nothing to fill). Hidden from sight rather than printed: the
   * cells are one tab stop with arrow-key movement, which is what a grid is
   * *expected* to do, so the note is there for a reader who cannot see the
   * geometry and would otherwise have no way to learn the arrows work.
   */
  keyboardHint = "",
): string {
  const described = keyboardHint === "" ? "" : ' aria-describedby="tt-keys"';
  const hint =
    keyboardHint === ""
      ? ""
      : `<p class="visually-hidden" id="tt-keys">${escapeHtml(keyboardHint)}</p>`;

  return `<fieldset class="exercise-group tt-wrap">
            ${legend}
            <slot name="prompt"></slot>
            ${hint}
            <div class="tt-scroll">
              <table class="tt"${described}>${inner}</table>
            </div>
            ${extra}
            <slot name="exercise-actions"></slot>
          </fieldset>`;
}

/**
 * The truth-table custom element with its Declarative Shadow Root. The SSR
 * markup is inert (cell buttons disabled) and renders correctly with no JS. On
 * the interactive path the element upgrades in place — enabling the cells,
 * wiring cycling + local Check, and restoring the prior answer. The preview
 * paths reuse this exact markup and upgrade it too — cells cycle and Check
 * works, with no form to submit into.
 */
export function renderTruthTableElement(
  publicData: TruthTablePublicData,
  meta: TruthTableElementMeta,
  actions = "",
): string {
  const table = resolveTable(publicData.formulas);

  if (table === null) {
    return `<carnap-truth-table data-exercise-id="${escapeHtml(meta.exerciseId)}"></carnap-truth-table>`;
  }

  const keyCells = correctCells(table);
  const premiseCount = turnstileSplit(publicData);
  const marks = marksOf(publicData.options);
  // The same map the element reads out of its hydration payload, so the name a
  // cell is born with and the name the client re-computes on the first click are
  // worded by one catalog entry.
  const strings = buildTruthTableStrings(meta.i18n);
  const givens =
    Array.isArray(publicData.givens) && publicData.givens.length > 0
      ? publicData.givens
      : null;
  // The counterexample selector rides along with the button that reveals it. A
  // partial table is already a single-row task, so it offers neither.
  const ceSelect =
    publicData.variant !== "partial" &&
    resolveCounterexample(publicData.options).showButton;
  // A partial table is one free row; every other variant fills all 2ⁿ rows.
  const rows =
    publicData.variant === "partial"
      ? partialBodyRow(table, marks, partialDisplay(publicData), strings)
      : table.valuations
          .map((_row, rowIndex) =>
            bodyRow(
              table,
              publicData.options,
              keyCells,
              givens,
              marks,
              rowIndex,
              premiseCount,
              strings,
              ceSelect,
            ),
          )
          .join("");
  const grid = gridMarkup(
    `<thead>${headerRow(
      table,
      premiseCount,
      turnstileGlyphFor(publicData.options),
      ceSelect ? ceSelectHead(strings) : "",
    )}</thead><tbody>${rows}</tbody>`,
    exerciseLegendHtml(
      exerciseGroupLabel(meta.exerciseKind, meta.title, meta.i18n),
    ),
    "",
    strings["Arrow keys move between cells. Space or Enter changes one."],
  );

  return `<carnap-truth-table data-component="${escapeHtml(meta.component)}" data-component-version="${escapeHtml(meta.componentVersion)}" data-exercise-id="${escapeHtml(meta.exerciseId)}" data-exercise-kind="${escapeHtml(meta.exerciseKind)}"${contentRevisionAttribute(meta.contentRevisionId)}>
        <template shadowrootmode="open">
          <style>${TRUTH_TABLE_SHADOW_STYLES}</style>
          ${grid}
        </template>
        ${slottedPrompt(publicData.promptHtml)}
        ${actions}
      </carnap-truth-table>`;
}

interface TruthTableReview {
  readonly answer: TruthTableAnswerData;
  readonly exerciseId: string;
}

/**
 * A submitted cell in ordinary ink, making no claim about itself. Two readers
 * get this: a review that withholds its verdicts (`feedback="none"`, until
 * grades are out), and the rows outside a counterexample submission's one
 * designated row — the student's own working, which only that row was graded
 * against. Not the muted `.tt-given` treatment, which says "this was handed to
 * you"; these cells are the reader's own work.
 */
function plainMark(submitted: TruthTableCellValue, marks: CellMarks): string {
  return `<span data-tt-value="${submitted}">${cellGlyph(submitted, marks)}</span>`;
}

function reviewMark(
  verdict: boolean | null,
  submitted: TruthTableCellValue,
  marks: CellMarks,
  strings: TruthTableStrings,
  reveal: boolean,
): string {
  if (verdict === null) {
    return `<span class="tt-given" data-tt-value="${submitted}">${cellGlyph(submitted, marks)}</span>`;
  }

  if (!reveal) {
    return plainMark(submitted, marks);
  }

  const cls = verdict ? "tt-correct" : "tt-incorrect";
  // Translated text, so it is escaped like every other catalog string here.
  // Sighted readers get the verdict from the cell's colour; the visually-hidden
  // `.visually-hidden` span is the *only* place assistive tech can read it, so
  // markup a quote in some locale broke would drop the verdict silently.
  const state = escapeHtml(verdict ? strings.Correct : strings.Incorrect);
  return `<span class="${cls}" data-tt-value="${submitted}">${cellGlyph(submitted, marks)}<span class="visually-hidden">${state}</span></span>`;
}

/**
 * One review body row: the student's cells marked correct/incorrect. When the
 * submission was a counterexample, only its one designated row carries verdicts;
 * the others are echoed back as the student left them — the table they filled in
 * on the way to the row they are claiming — rather than blanked or filled with
 * the key, neither of which is anything they wrote.
 */
function reviewRow(
  table: ResolvedTable,
  publicData: TruthTablePublicData,
  grade: NonNullable<ReturnType<typeof gradeTruthTable>>,
  answer: TruthTableAnswerData,
  keyCells: readonly (readonly (readonly boolean[])[])[],
  rowIndex: number,
  ceRow: number | null,
  premiseCount: number | null,
  strings: TruthTableStrings,
  reveal: boolean,
): string {
  const marks = marksOf(publicData.options);
  // An ungraded row of a counterexample submission: shown, but not judged.
  const echoed = ceRow !== null && rowIndex !== ceRow;
  const turnstileCell = (): string => {
    const submitted = answer.validity?.[rowIndex] ?? "";

    if (echoed) {
      return `<td class="tt-sep tt-turnstile">${plainMark(submitted, marks)}</td>`;
    }

    const verdict = grade.validity?.[rowIndex] ?? null;
    return `<td class="tt-sep tt-turnstile">${reviewMark(verdict, submitted, marks, strings, reveal)}</td>`;
  };
  const referenceCells = table.atoms
    .map((_atom, atomIndex) => {
      if (echoed) {
        // The atom columns are the table's coordinates, so an `autoAtoms` grid
        // shows them whatever the answer carries; where the student fills them
        // in themselves, this is their row as they left it.
        const submitted = referenceFillable(publicData.options)
          ? (answer.reference[rowIndex]?.[atomIndex] ?? "")
          : boolToCell(table.valuations[rowIndex]?.[atomIndex] ?? false);
        return `<td>${plainMark(submitted, marks)}</td>`;
      }

      const verdict = grade.reference[rowIndex]?.[atomIndex] ?? null;
      const submitted =
        verdict === null
          ? boolToCell(table.valuations[rowIndex]?.[atomIndex] ?? false)
          : (answer.reference[rowIndex]?.[atomIndex] ?? "");
      return `<td>${reviewMark(verdict, submitted, marks, strings, reveal)}</td>`;
    })
    .join("");

  const formulaCells = table.formulas
    .map((formula, formulaIndex) => {
      let cellIndex = -1;

      const turnstile =
        premiseCount !== null && formulaIndex === premiseCount
          ? turnstileCell()
          : "";

      return (
        turnstile +
        formula.segments
          .map((segment, segmentIndex) => {
            const sep = segmentIndex === 0 ? " tt-sep" : "";

            if (segment.kind === "paren") {
              return `<td class="tt-paren${sep}"></td>`;
            }

            cellIndex += 1;
            const c = cellIndex;
            const main = segment.isMain ? " tt-main" : "";
            const cls = `${sep}${main}`.trim();

            if (echoed) {
              return `<td class="${cls}">${plainMark(
                answer.cells[formulaIndex]?.[rowIndex]?.[c] ?? "",
                marks,
              )}</td>`;
            }

            const verdict =
              grade.cells[formulaIndex]?.[rowIndex]?.[c] ?? null;
            const submitted =
              verdict === null
                ? boolToCell(keyCells[formulaIndex]?.[rowIndex]?.[c] ?? false)
                : (answer.cells[formulaIndex]?.[rowIndex]?.[c] ?? "");
            return `<td class="${cls}">${reviewMark(verdict, submitted, marks, strings, reveal)}</td>`;
          })
          .join("")
      );
    })
    .join("");

  const rowClass =
    ceRow !== null && rowIndex === ceRow ? ' class="tt-ce-row"' : "";
  return `<tr${rowClass}>${referenceCells}${formulaCells}</tr>`;
}

/**
 * The truth-table element in `review` mode: the student's submitted grid, each
 * graded cell marked correct (green) or incorrect (red), given cells muted.
 * Truth tables carry no secret key, so the same marks show to students and
 * instructors. The Declarative Shadow Root attaches at parse time, so it renders
 * inline on the review and results pages with no iframe and no bundle.
 *
 * The element still upgrades if some other exercise on the page pulls a bundle
 * in, so the review carries a hydration payload saying so: `mode` is the one
 * question every widget asks to tell answering from reviewing, and `data-review`
 * is a marker for styling and tests rather than the signal.
 */
export function renderTruthTableReview(
  publicData: TruthTablePublicData,
  review: TruthTableReview,
  i18n: Translator,
  reveal = true,
): string {
  const strings = buildTruthTableStrings(i18n);
  const hydration = reviewHydrationScript(
    TRUTH_TABLE_COMPONENT_METADATA.assetId,
    i18n,
  );
  const table = resolveTable(publicData.formulas);
  const grade = gradeTruthTable(publicData, review.answer);

  if (table === null || grade === null) {
    return `<carnap-truth-table data-exercise-id="${escapeHtml(review.exerciseId)}" data-review>${hydration}</carnap-truth-table>`;
  }

  const keyCells = correctCells(table);
  const ceRow = grade.counterexample?.row ?? null;
  const premiseCount = turnstileSplit(publicData);
  const isPartial = publicData.variant === "partial";
  const rows = isPartial
    ? partialReviewRow(
        table,
        publicData.options,
        grade,
        review.answer,
        strings,
        reveal,
      )
    : table.valuations
        .map((_row, rowIndex) =>
          reviewRow(
            table,
            publicData,
            grade,
            review.answer,
            keyCells,
            rowIndex,
            ceRow,
            premiseCount,
            strings,
            reveal,
          ),
        )
        .join("");
  // Every note this renders is a verdict — "That row is correct", "Not a valid
  // counterexample" — so a withheld review has none to show.
  const note = !reveal
    ? ""
    : isPartial
      ? partialReviewNote(grade, strings)
      : grade.counterexample === null
        ? ""
        : `<p class="tt-ce-note"${grade.allCorrect ? ' data-state="correct"' : ""}>${escapeHtml(
            grade.allCorrect
              ? strings["Valid counterexample."]
              : strings["Not a valid counterexample."],
          )}</p>`;
  const grid = gridMarkup(
    `<thead>${headerRow(table, premiseCount, turnstileGlyphFor(publicData.options))}</thead><tbody>${rows}</tbody>`,
    "",
    note,
  );

  return `<carnap-truth-table data-exercise-id="${escapeHtml(review.exerciseId)}" data-review>
        <template shadowrootmode="open">
          <style>${TRUTH_TABLE_SHADOW_STYLES}</style>
          ${grid}
        </template>
        ${hydration}
      </carnap-truth-table>`;
}

export function renderTruthTable(
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  context: ExerciseRenderContext,
): string {
  if (
    node.exerciseKind !== TRUTH_TABLE_KIND ||
    !isTruthTablePublicData(node.publicData)
  ) {
    return `<div data-component="${escapeHtml(node.render.component)}" data-exercise-id="${escapeHtml(node.exerciseId)}"></div>`;
  }

  return renderTruthTableElement(
    node.publicData,
    {
      component: node.render.component,
      componentVersion: node.render.componentVersion,
      contentRevisionId: context.contentRevisionId,
      exerciseId: node.exerciseId,
      exerciseKind: node.exerciseKind,
      i18n: context.i18n,
      title: context.title ?? null,
    },
    // A preview has no attempt to submit to, but it gets the same closing row a
    // student's copy has, with the button disabled: the shape the author is
    // writing towards, and the row this widget's own controls land in.
    previewExerciseActionsHtml(context.i18n, true),
  );
}
