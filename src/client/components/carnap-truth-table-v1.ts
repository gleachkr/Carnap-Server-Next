/**
 * `<carnap-truth-table>` — the interactive truth-table element.
 *
 * The server renders the grid into a Declarative Shadow Root (see the worker-side
 * `renderTruthTableElement`), inert and correctly styled with no JS. On connect
 * this element adopts that shadow root, turns each fillable cell into a button
 * that cycles blank → T → F, restores the student's prior answer, and mirrors the
 * whole grid into the form's hidden `answerData` field so the runtime records it.
 *
 * Truth tables carry no secret key — the answer is a function of the public
 * formulas — so the element also offers a local **Check**: it grades the current
 * grid with the same shared core the worker uses and marks each cell, with no
 * round trip. Submitting still records authoritatively server-side.
 *
 * When the exercise allows it, the element also offers a **counterexample**
 * shortcut: instead of the full table, the student designates one row (by editing
 * it) that makes all formulas false (or true / disagree, per the target), and
 * that single row is graded.
 */

import type { ExerciseFeedback } from "../../worker/domain/exercises";
import {
  gradeTruthTable,
  resolveCounterexample,
  resolveTable,
} from "../../worker/exercises/truth-table/grading";
import type { TruthTableStringId } from "../../worker/exercises/truth-table/strings";
import type {
  TruthTableAnswerData,
  TruthTableCellValue,
  TruthTableCheckMode,
  TruthTableCounterexampleTarget,
  TruthTablePublicData,
} from "../../worker/exercises/truth-table/types";
import { CarnapExerciseElement, register } from "./base";

const CYCLE: Record<TruthTableCellValue, TruthTableCellValue> = {
  "": "T",
  T: "F",
  F: "",
};

/** The keys the grid consumes; anything else keeps its normal meaning. */
const GRID_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
]);

/**
 * One fillable cell and the table column it sits in. The column is the `<td>`'s
 * own index rather than a running count of fillable cells, so vertical movement
 * follows what a reader sees: a given-grid table can leave a column pre-filled on
 * one row and open on the next, and those cells still line up on screen.
 */
interface GridCell {
  readonly cell: HTMLButtonElement;
  readonly column: number;
}

/** Read a `trueMark`/`falseMark` override defensively, defaulting to `T`/`F`. */
function readMark(options: unknown, key: string, fallback: string): string {
  const value = (options as Record<string, unknown> | null)?.[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function isTruthTablePublicData(
  value: unknown,
): value is TruthTablePublicData {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { formulas?: unknown }).formulas)
  );
}

/**
 * The Check mode this reader gets: the server's resolved `feedback` where there
 * is one, the compiled `options.check` otherwise.
 *
 * The two say the same thing in two vocabularies — `feedback` is the shared one
 * and `check` is this type's own, kept working so ported Carnap content does not
 * churn. `feedback` wins because only it knows about the assignment: an exam
 * table's author may have written nothing at all, and the seal is still theirs.
 * A grid compiled before `feedback` existed has no such payload and falls
 * through to `check`, which is why this reads defensively at both ends.
 */
function readCheckMode(
  options: unknown,
  feedback: ExerciseFeedback,
): TruthTableCheckMode {
  if (feedback === "none") {
    return "off";
  }

  if (feedback === "terse") {
    return "terse";
  }

  const check = (options as { check?: unknown } | null)?.check;
  return check === "terse" || check === "off" ? check : "cells";
}

class CarnapTruthTable extends CarnapExerciseElement<TruthTableStringId> {
  private cells: HTMLButtonElement[] = [];
  /** {@link cells} again, grouped by table row — the map arrow keys walk. */
  private rows: GridCell[][] = [];
  private table: HTMLTableElement | null = null;
  private status: HTMLParagraphElement | null = null;
  private checkMode: TruthTableCheckMode = "cells";
  private nodash = false;
  /** Display glyphs for true/false cells (cf. Carnap `trueMark`/`falseMark`). */
  private trueMark = "T";
  private falseMark = "F";
  /** The counterexample property while the button is offered, else null. */
  private ceTarget: TruthTableCounterexampleTarget | null = null;
  /** Whether this is a validity table (turnstile column, premise/conclusion split). */
  private validityTable = false;
  /** Whether this is a partial table (one free row; no counterexample shortcut). */
  private partialTable = false;
  private ceMode = false;
  private ceRow: number | null = null;
  private ceButton: HTMLButtonElement | null = null;

  protected enhance(): void {
    const root = this.shadowRoot;
    const data = this.publicData;

    // The chrome lives in the Declarative Shadow Root; without it (no DSD
    // support) there is nothing to enhance and the inert SSR view stands. A
    // review is already drawn and graded server-side, and says so in its
    // payload — asked here the same way every other widget asks, rather than
    // left to fall out of its public data being absent.
    if (
      root === null ||
      this.mode !== "answer" ||
      !isTruthTablePublicData(data)
    ) {
      return;
    }

    this.nodash = data.options.nodash === true;
    this.trueMark = readMark(data.options, "trueMark", "T");
    this.falseMark = readMark(data.options, "falseMark", "F");
    this.checkMode = readCheckMode(data.options, this.feedback);
    this.partialTable = data.variant === "partial";
    const ce = resolveCounterexample(data.options);
    // A partial table is already a single-row task, so it offers no separate
    // counterexample shortcut (whatever the default `showCounterexample`).
    this.ceTarget = ce.showButton && !this.partialTable ? ce.property : null;
    this.validityTable = typeof data.premiseCount === "number";
    this.table = root.querySelector<HTMLTableElement>("table.tt");
    this.cells = Array.from(
      root.querySelectorAll<HTMLButtonElement>(
        "button.tt-cell[data-tt-role]",
      ),
    );

    for (const cell of this.cells) {
      cell.disabled = false;
      cell.addEventListener("click", () => {
        this.onCellClick(cell);
      });
    }

    this.wireRovingFocus();

    if (this.checkMode !== "off" || this.ceTarget !== null) {
      this.buildControls();
    }

    this.restorePriorAnswer();

    this.dataset.enhanced = "true";
  }

  /** The display glyph for a cell value, honoring the mark options. */
  private glyph(value: TruthTableCellValue): string {
    if (value === "T") {
      return this.trueMark;
    }

    if (value === "F") {
      return this.falseMark;
    }

    return this.nodash ? "" : "–";
  }

  /**
   * Write one cell's value, keeping in step the three things that describe it:
   * the `data-tt-value` the answer is read out of, the glyph a sighted reader
   * sees, and the `aria-label` a screen reader hears. The label cannot be left to
   * the glyph — that may be an author's custom mark, or under `nodash` nothing at
   * all, leaving the button with no name — so it names the value in words, along
   * with the column and row the cell sits in. The server rendered the first one;
   * this keeps it true after every click.
   */
  private setCellValue(cell: HTMLElement, value: TruthTableCellValue): void {
    cell.dataset.ttValue = value;
    cell.textContent = this.glyph(value);

    const column = cell.dataset.ttName;

    if (column === undefined) {
      return;
    }

    // One literal per `t()` call: the extraction gate reads these call sites
    // literally, so a computed argument would reach no catalog.
    const word =
      value === "T"
        ? this.t("true")
        : value === "F"
          ? this.t("false")
          : this.t("blank");

    cell.setAttribute(
      "aria-label",
      this.partialTable
        ? this.t("{column}: {value}", { column, value: word })
        : this.t("{column}, row {row}: {value}", {
            column,
            // 1-based, counting the all-true row as row 1, the way the grid reads.
            row: Number(cell.dataset.ttRow) + 1,
            value: word,
          }),
    );
  }

  /** Cycle a cell; in counterexample mode, editing a row also designates it. */
  private onCellClick(cell: HTMLButtonElement): void {
    if (this.ceMode) {
      const row = Number(cell.dataset.ttRow);

      if (this.ceRow !== row) {
        this.selectCounterexampleRow(row);
      }
    }

    const next = CYCLE[(cell.dataset.ttValue ?? "") as TruthTableCellValue];
    this.setCellValue(cell, next);
    // Editing invalidates the last Check, so wipe the whole result — not just
    // this cell — so no stale marks linger elsewhere in the grid.
    this.clearCheck();
    this.syncAnswer();
  }

  /**
   * The whole grid as **one** tab stop, walked with the arrow keys — the ARIA
   * grid pattern, and the reason the cells ship `tabindex="-1"`.
   *
   * Before this, every cell was its own tab stop: a 4-variable table put 32
   * presses of Tab between a student and the next exercise, and a table with two
   * formulas put 40. Naming the cells (their `aria-label`) made the grid legible;
   * it did nothing about the distance across it.
   *
   * Nothing here changes a value — Space and Enter already do that, since the
   * cells are real buttons and the browser fires `click` for both. Moving focus
   * deliberately does *not* count as editing, which matters in counterexample
   * mode: designating a row is an edit (it clears the grid), so arrowing through
   * the rows to read them must stay free of that.
   */
  private wireRovingFocus(): void {
    const table = this.table;
    const first = this.cells[0];

    if (table === null || first === undefined) {
      return;
    }

    const byRow = new Map<HTMLTableRowElement, GridCell[]>();

    for (const cell of this.cells) {
      cell.tabIndex = -1;

      const container = cell.closest("td");
      const row = cell.closest("tr");

      if (container === null || row === null) {
        continue;
      }

      const entries = byRow.get(row) ?? [];

      entries.push({ cell, column: container.cellIndex });
      byRow.set(row, entries);
    }

    // `this.cells` is in document order, so the rows and each row's cells are
    // already in the order they read on screen.
    this.rows = [...byRow.values()];
    first.tabIndex = 0;

    // Whichever cell holds focus becomes the tab stop, so tabbing away and back
    // returns to where the student was rather than to the top-left corner. One
    // listener on the table covers clicks and keyboard alike.
    table.addEventListener("focusin", (event) => {
      const cell = this.cellOf(event.target);

      if (cell !== null) {
        this.setTabStop(cell);
      }
    });

    table.addEventListener("keydown", (event) => {
      this.onGridKeyDown(event);
    });
  }

  private onGridKeyDown(event: KeyboardEvent): void {
    // Alt/Meta/Shift combinations belong to the browser (and Shift+Arrow to text
    // selection); Ctrl is ours, for jumping to the first or last cell.
    if (!GRID_KEYS.has(event.key) || event.altKey || event.metaKey) {
      return;
    }

    const cell = this.cellOf(event.target);
    const at = cell === null ? null : this.locate(cell);

    if (cell === null || at === null) {
      return;
    }

    // Claim the key even when the move is clamped at an edge, or the arrow would
    // scroll the content frame out from under the student instead.
    event.preventDefault();

    const target = this.destination(at, event.key, event.ctrlKey);

    if (target === null || target === cell) {
      return;
    }

    this.setTabStop(target);
    target.focus();
  }

  /** Where a key leads from `at`, or null when it leads nowhere (an edge). */
  private destination(
    at: { readonly index: number; readonly row: number },
    key: string,
    ctrl: boolean,
  ): HTMLButtonElement | null {
    const row = this.rows[at.row];

    if (row === undefined) {
      return null;
    }

    switch (key) {
      case "ArrowLeft":
        return row[at.index - 1]?.cell ?? null;
      case "ArrowRight":
        return row[at.index + 1]?.cell ?? null;
      case "ArrowUp":
        return this.sameColumn(at, -1);
      case "ArrowDown":
        return this.sameColumn(at, 1);
      case "Home":
        return (ctrl ? this.rows[0]?.[0] : row[0])?.cell ?? null;
      case "End": {
        const last = ctrl ? this.rows[this.rows.length - 1] : row;

        return last?.[last.length - 1]?.cell ?? null;
      }
      default:
        return null;
    }
  }

  /**
   * The same column one row up or down — or, when that column holds a given cell
   * there, the nearest open one. Landing somewhere beats trapping focus in a
   * column that dead-ends halfway down a partly pre-filled grid.
   */
  private sameColumn(
    at: { readonly index: number; readonly row: number },
    step: number,
  ): HTMLButtonElement | null {
    const column = this.rows[at.row]?.[at.index]?.column;
    const row = this.rows[at.row + step];

    if (column === undefined || row === undefined) {
      return null;
    }

    let best: GridCell | null = null;

    for (const entry of row) {
      if (
        best === null ||
        Math.abs(entry.column - column) < Math.abs(best.column - column)
      ) {
        best = entry;
      }
    }

    return best?.cell ?? null;
  }

  private cellOf(target: EventTarget | null): HTMLButtonElement | null {
    return target instanceof HTMLButtonElement && this.cells.includes(target)
      ? target
      : null;
  }

  private locate(
    cell: HTMLButtonElement,
  ): { readonly index: number; readonly row: number } | null {
    for (const [row, entries] of this.rows.entries()) {
      const index = entries.findIndex((entry) => entry.cell === cell);

      if (index !== -1) {
        return { index, row };
      }
    }

    return null;
  }

  private setTabStop(cell: HTMLButtonElement): void {
    for (const other of this.cells) {
      other.tabIndex = other === cell ? 0 : -1;
    }
  }

  protected getAnswer(): TruthTableAnswerData {
    const data = this.publicData;
    const empty: TruthTableAnswerData = { cells: [], reference: [] };

    if (!isTruthTablePublicData(data)) {
      return empty;
    }

    const table = resolveTable(data.formulas);

    if (table === null) {
      return empty;
    }

    // A partial table is one free row; every other variant fills all 2ⁿ rows.
    const rowCount = data.variant === "partial" ? 1 : table.valuations.length;
    const reference: TruthTableCellValue[][] = Array.from(
      { length: rowCount },
      () => table.atoms.map(() => ""),
    );
    const cells: TruthTableCellValue[][][] = table.formulas.map((formula) =>
      Array.from({ length: rowCount }, () => formula.cells.map(() => "")),
    );
    // A validity table carries a turnstile column: one mark per row.
    const validity: TruthTableCellValue[] | null =
      typeof data.premiseCount === "number"
        ? table.valuations.map(() => "")
        : null;

    // Read every cell — fillable buttons and given spans alike — so the grid is
    // full width and lines up with the worker's positional grader.
    const root = this.shadowRoot;

    for (const el of root?.querySelectorAll<HTMLElement>("[data-tt-role]") ??
      []) {
      const value = (el.dataset.ttValue ?? "") as TruthTableCellValue;
      const row = Number(el.dataset.ttRow);

      if (el.dataset.ttRole === "reference") {
        const atom = Number(el.dataset.ttAtom);
        const target = reference[row];

        if (target !== undefined && atom < target.length) {
          target[atom] = value;
        }

        continue;
      }

      if (el.dataset.ttRole === "validity") {
        if (validity !== null && row < validity.length) {
          validity[row] = value;
        }

        continue;
      }

      const formula = Number(el.dataset.ttFormula);
      const cell = Number(el.dataset.ttCell);
      const target = cells[formula]?.[row];

      if (target !== undefined && cell < target.length) {
        target[cell] = value;
      }
    }

    // A row is designated only while in counterexample mode with a selection;
    // otherwise this is an ordinary full-table submission.
    return {
      cells,
      counterexample: this.ceMode ? this.ceRow : null,
      reference,
      ...(validity === null ? {} : { validity }),
    };
  }

  private restorePriorAnswer(): void {
    const prior = this.priorAnswer as TruthTableAnswerData | null;

    if (prior === null || typeof prior !== "object") {
      return;
    }

    for (const cell of this.cells) {
      const value = this.priorValue(prior, cell);

      if (value !== null) {
        this.setCellValue(cell, value);
      }
    }

    // Re-enter counterexample mode if that is how the prior answer was made.
    const priorRow =
      typeof prior.counterexample === "number" ? prior.counterexample : null;

    if (priorRow !== null && this.ceTarget !== null) {
      this.setCounterexampleMode(true);
      this.ceRow = priorRow;
      this.highlightRow(priorRow);
    }
  }

  private priorValue(
    prior: TruthTableAnswerData,
    cell: HTMLButtonElement,
  ): TruthTableCellValue | null {
    const row = Number(cell.dataset.ttRow);

    if (cell.dataset.ttRole === "reference") {
      return prior.reference?.[row]?.[Number(cell.dataset.ttAtom)] ?? null;
    }

    if (cell.dataset.ttRole === "validity") {
      return prior.validity?.[row] ?? null;
    }

    return (
      prior.cells?.[Number(cell.dataset.ttFormula)]?.[row]?.[
        Number(cell.dataset.ttCell)
      ] ?? null
    );
  }

  /**
   * Add the Check / counterexample affordances the inert SSR grid omits, into
   * the shared light-DOM action bar (`.exercise-actions`) so they sit in one row
   * with Submit and are styled uniformly by the content stylesheet and any
   * author CSS. The Check status drops onto its own line under the button row.
   */
  private buildControls(): void {
    const bar = this.querySelector<HTMLElement>(".exercise-actions");

    if (bar === null) {
      return;
    }

    // Insert our controls before the (server-rendered) submit button, so the row
    // reads Check · counterexample · Submit.
    const submit = bar.querySelector<HTMLElement>('button[type="submit"]');

    const status = document.createElement("p");
    status.className = "exercise-status tt-check-status";
    status.setAttribute("aria-live", "polite");
    this.status = status;

    if (this.checkMode !== "off") {
      const check = document.createElement("button");
      check.type = "button";
      check.className = "tt-check";
      check.textContent = this.t("Check");
      check.addEventListener("click", () => {
        this.runCheck();
      });
      bar.insertBefore(check, submit);
    }

    if (this.ceTarget !== null) {
      const ce = document.createElement("button");
      ce.type = "button";
      ce.className = "tt-check tt-ce";
      ce.textContent = this.t("Find counterexample");
      ce.setAttribute("aria-pressed", "false");
      ce.addEventListener("click", () => {
        this.setCounterexampleMode(!this.ceMode);
      });
      this.ceButton = ce;
      bar.insertBefore(ce, submit);
    }

    bar.append(status);
  }

  /** Enter or leave counterexample mode, resetting the grid either way. */
  private setCounterexampleMode(on: boolean): void {
    this.ceMode = on;
    this.ceRow = null;
    this.clearGrid();
    this.clearRowHighlight();
    this.clearCheck();
    this.table?.classList.toggle("tt-ce-mode", on);

    if (this.ceButton !== null) {
      this.ceButton.setAttribute("aria-pressed", String(on));
      this.ceButton.textContent = this.t(
        on ? "Cancel counterexample" : "Find counterexample",
      );
    }

    if (this.status !== null) {
      this.status.textContent = on ? this.counterexampleHint() : "";
      this.status.removeAttribute("data-state");
    }

    this.syncAnswer();
  }

  private counterexampleHint(): string {
    // On a validity table the property applies to the conclusions, with every
    // premise required true; on a simple table it applies to all formulas.
    if (this.validityTable) {
      switch (this.ceTarget) {
        case "inconsistency":
          return this.t(
            "Pick one row where every premise is true and every conclusion is true, then fill it in.",
          );
        case "equivalence":
          return this.t(
            "Pick one row where every premise is true and the conclusions disagree, then fill it in.",
          );
        default:
          return this.t(
            "Pick one row where every premise is true and the conclusion is false, then fill it in.",
          );
      }
    }

    switch (this.ceTarget) {
      case "inconsistency":
        return this.t(
          "Pick one row where every formula is true, then fill it in.",
        );
      case "equivalence":
        return this.t(
          "Pick one row where the formulas disagree, then fill it in.",
        );
      default:
        return this.t(
          "Pick one row where every formula is false, then fill it in.",
        );
    }
  }

  /** Choose `row` as the counterexample: clear the grid and highlight it. */
  private selectCounterexampleRow(row: number): void {
    this.clearGrid();
    this.ceRow = row;
    this.highlightRow(row);
  }

  private clearGrid(): void {
    for (const cell of this.cells) {
      this.setCellValue(cell, "");
      cell.classList.remove("tt-correct", "tt-incorrect");
    }
  }

  private bodyRows(): HTMLTableRowElement[] {
    return Array.from(
      this.table?.querySelectorAll<HTMLTableRowElement>("tbody tr") ?? [],
    );
  }

  private clearRowHighlight(): void {
    for (const tr of this.bodyRows()) {
      tr.classList.remove("tt-ce-row");
    }
  }

  private highlightRow(row: number): void {
    this.clearRowHighlight();
    this.bodyRows()[row]?.classList.add("tt-ce-row");
  }

  /** Wipe the last Check: clear every cell mark and the status line. */
  private clearCheck(): void {
    for (const cell of this.cells) {
      cell.classList.remove("tt-correct", "tt-incorrect");
    }

    if (this.status !== null) {
      // In counterexample mode keep the standing hint; only clear results.
      this.status.textContent = this.ceMode ? this.counterexampleHint() : "";
      this.status.removeAttribute("data-state");
    }

    // An edited grid is no longer the grid any verdict was about, including a
    // recorded one the runtime put up on load.
    this.setMark("idle");
  }

  /**
   * Grade the current grid locally. A counterexample submission reports whether
   * the chosen row is valid; otherwise, in `cells` mode each fillable cell is
   * marked green/red with a running count, and in `terse` mode only whether the
   * whole table is right, so students go find the error themselves.
   */
  private runCheck(): void {
    const data = this.publicData;

    if (!isTruthTablePublicData(data) || this.status === null) {
      return;
    }

    if (this.ceMode && this.ceRow === null) {
      this.status.textContent = this.t("Choose a row, then fill it in.");
      this.status.removeAttribute("data-state");
      return;
    }

    const grade = gradeTruthTable(data, this.getAnswer());

    if (grade === null) {
      return;
    }

    // One verdict for all three report paths below, since they differ only in
    // how they explain a table that is not right yet. A local Check is exact
    // here — the answer key is in the page — so this is the same claim the
    // server would make.
    this.setMark(grade.allCorrect ? "ok" : "idle");

    if (grade.counterexample !== null) {
      this.reportCounterexample(grade);
      return;
    }

    if (grade.partial !== null) {
      this.reportPartial(grade);
      return;
    }

    if (grade.allCorrect) {
      this.status.textContent = this.t("All cells correct.");
      this.status.setAttribute("data-state", "correct");
    } else if (this.checkMode === "terse") {
      this.status.textContent = this.t("There's an error somewhere.");
      this.status.removeAttribute("data-state");
    } else {
      this.status.textContent = this.t("Correct cells: {count} of {total}", {
        count: grade.correctCount,
        total: grade.fillableCount,
      });
      this.status.removeAttribute("data-state");
    }

    if (this.checkMode === "terse") {
      return;
    }

    this.markCells(grade);
  }

  /**
   * Report a partial-table Check: the student fills one free row. It is correct
   * when the valuation is complete, every cell evaluates it correctly, and (if
   * the exercise has givens) the row matches one. Cells are still marked so the
   * student sees which are wrong.
   */
  private reportPartial(
    grade: NonNullable<ReturnType<typeof gradeTruthTable>>,
  ): void {
    if (this.status === null) {
      return;
    }

    const partial = grade.partial;

    if (grade.allCorrect) {
      this.status.textContent = this.t("That row is correct.");
      this.status.setAttribute("data-state", "correct");
    } else if (this.checkMode === "terse") {
      this.status.textContent = this.t("Not correct yet.");
      this.status.removeAttribute("data-state");
    } else if (
      partial?.hasGivens &&
      partial.filledCorrectly &&
      !partial.consistentWithGiven
    ) {
      this.status.textContent = this.t(
        "This row is filled in correctly, but it doesn't satisfy the given conditions.",
      );
      this.status.removeAttribute("data-state");
    } else {
      this.status.textContent = this.t("Correct cells: {count} of {total}", {
        count: grade.correctCount,
        total: grade.fillableCount,
      });
      this.status.removeAttribute("data-state");
    }

    if (this.checkMode !== "terse") {
      this.markCells(grade);
    }
  }

  private reportCounterexample(
    grade: NonNullable<ReturnType<typeof gradeTruthTable>>,
  ): void {
    if (this.status === null) {
      return;
    }

    const ce = grade.counterexample;

    if (grade.allCorrect) {
      this.status.textContent = this.t("That's a valid counterexample.");
      this.status.setAttribute("data-state", "correct");
    } else if (this.checkMode === "terse") {
      this.status.textContent = this.t("Not a valid counterexample yet.");
      this.status.removeAttribute("data-state");
    } else if (ce?.predicateHolds && !ce.filledCorrectly) {
      this.status.textContent = this.t(
        "This row is a counterexample, but it isn't filled in correctly.",
      );
      this.status.removeAttribute("data-state");
    } else {
      this.status.textContent = this.t("This row isn't a counterexample.");
      this.status.removeAttribute("data-state");
    }

    if (this.checkMode !== "terse") {
      // Only the designated row carries verdicts, so this marks just that row.
      this.markCells(grade);
    }
  }

  private markCells(
    grade: NonNullable<ReturnType<typeof gradeTruthTable>>,
  ): void {
    for (const cell of this.cells) {
      const verdict = this.verdictFor(grade, cell);
      cell.classList.toggle("tt-correct", verdict === true);
      cell.classList.toggle("tt-incorrect", verdict === false);
    }
  }

  private verdictFor(
    grade: NonNullable<ReturnType<typeof gradeTruthTable>>,
    cell: HTMLButtonElement,
  ): boolean | null {
    const row = Number(cell.dataset.ttRow);

    if (cell.dataset.ttRole === "reference") {
      return grade.reference[row]?.[Number(cell.dataset.ttAtom)] ?? null;
    }

    if (cell.dataset.ttRole === "validity") {
      return grade.validity?.[row] ?? null;
    }

    return (
      grade.cells[Number(cell.dataset.ttFormula)]?.[row]?.[
        Number(cell.dataset.ttCell)
      ] ?? null
    );
  }
}

register("carnap-truth-table", CarnapTruthTable);
