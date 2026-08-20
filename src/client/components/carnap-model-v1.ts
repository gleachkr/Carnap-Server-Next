/**
 * `<carnap-model>` — the interactive finite-model element.
 *
 * The server renders every field into a Declarative Shadow Root (see the
 * worker-side `renderModelElement`), inert and correctly styled with no JS. On
 * connect this element adopts that shadow root, enables the controls, restores
 * the student's prior answer, and mirrors the whole model into the form's hidden
 * `answerData` field so the runtime records it.
 *
 * Two things it does that the inert markup cannot:
 *
 *   - **The domain drives the other fields.** A constant is a `<select>` over the
 *     domain and a function is a table of them — the last argument across the
 *     columns, the rest down the rows — so both have to be rebuilt whenever the
 *     domain changes. Values still in range survive the rebuild.
 *   - **A local Check**, which here is not an approximation of the server's
 *     grade but the same computation: a model exercise has no secret key —
 *     success is a property of the submitted model against public formulas — so
 *     the browser runs exactly the `checkModel` the worker runs.
 *
 * The generated value table is an *editor* over the string Carnap stores for a
 * function (`[0,0;1],[0,1;2]`), so what is recorded matches what an author
 * writes in a given.
 */
import {
  effectiveAnswer,
  isModelPublicData,
  resolveModel,
  seededFunctionRows,
} from "../../worker/exercises/model/grading";
import type {
  FunctionTableLayout,
  ModelField,
} from "../../worker/exercises/model/logic";
import {
  checkModel,
  formatFunctionTable,
  functionTableLayout,
  parseDomain,
  parseFunctionTable,
  parseNatural,
  parseTupleList,
  tupleKey,
} from "../../worker/exercises/model/logic";
import type { ModelStringId } from "../../worker/exercises/model/strings";
import type {
  ModelAnswerData,
  ModelPublicData,
} from "../../worker/exercises/model/types";
import { describeVerdict } from "../../worker/exercises/model/verdict-text";
import { CarnapExerciseElement, register } from "./base";

/** A field's row in the shadow root, with the field it stands for. */
interface FieldRow {
  readonly field: ModelField;
  readonly row: HTMLElement;
}

class CarnapModel extends CarnapExerciseElement<ModelStringId> {
  private data: ModelPublicData | null = null;
  private rows: FieldRow[] = [];
  private domainInput: HTMLInputElement | null = null;
  private status: HTMLParagraphElement | null = null;

  protected enhance(): void {
    const root = this.shadowRoot;
    const data = this.publicData;

    // The chrome lives in the Declarative Shadow Root; without it there is
    // nothing to enhance and the inert SSR view stands. A review is already
    // drawn and graded server-side.
    if (root === null || this.mode !== "answer" || !isModelPublicData(data)) {
      return;
    }

    this.data = data;
    this.status = root.querySelector<HTMLParagraphElement>(
      'p[data-role="status"]',
    );
    this.rows = this.collectRows(root, data);

    for (const { field, row } of this.rows) {
      if (field.kind === "domain") {
        this.domainInput = row.querySelector<HTMLInputElement>("input");
      }

      for (const control of controlsIn(row)) {
        // A locked given stays disabled: it is a requirement, not a hint. The
        // lock is marked on the control, because a function's given may fix
        // some cells of its table and leave the rest to the student.
        if (control.dataset.locked === undefined) {
          control.disabled = false;
        }

        control.addEventListener("input", () => {
          this.onFieldEdit(field);
        });
        control.addEventListener("change", () => {
          this.onFieldEdit(field);
        });
      }
    }

    this.restorePriorAnswer();
    this.buildControls();
    this.markWarnings();

    const fieldset = root.querySelector("fieldset");
    fieldset?.removeAttribute("aria-busy");
    this.dataset.enhanced = "true";
  }

  /** Every field row in the shadow root, paired with the field it renders. */
  private collectRows(root: ShadowRoot, data: ModelPublicData): FieldRow[] {
    const byLabel = new Map(
      (resolveModel(data)?.signature ?? []).map((field) => [
        field.label,
        field,
      ]),
    );

    return Array.from(
      root.querySelectorAll<HTMLElement>(".model-row[data-field]"),
    ).flatMap((row) => {
      const field = byLabel.get(row.dataset.field ?? "");
      return field === undefined ? [] : [{ field, row }];
    });
  }

  /**
   * The Check button, in the shared light-DOM action bar
   * (`.exercise-actions`) so it sits in one row with Submit and is styled
   * uniformly by the content stylesheet and any author CSS.
   */
  private buildControls(): void {
    // The server's resolved `feedback` first, the compiled `options.check`
    // second: the two are one setting in two vocabularies, and only the first
    // knows whether this is an exam. A model compiled before `feedback` existed
    // carries no such payload and falls through to `check`.
    //
    // There is no `terse` here to honour — this Check is a verdict and a
    // sentence naming what came out wrong, with no separate quieter form — so
    // it either offers the button or it does not.
    if (this.feedback === "none" || this.data?.options.check === "off") {
      return;
    }

    const bar = this.querySelector<HTMLElement>(".exercise-actions");

    if (bar === null) {
      return;
    }

    const check = document.createElement("button");
    check.type = "button";
    check.className = "model-check";
    check.textContent = this.t("Check");
    check.addEventListener("click", () => {
      this.runCheck();
    });
    bar.insertBefore(
      check,
      bar.querySelector<HTMLElement>('button[type="submit"]'),
    );
  }

  /** A field changed: rebuild what depends on it, then re-mirror the answer. */
  private onFieldEdit(field: ModelField): void {
    if (field.kind === "domain") {
      this.rebuildDomainDependents();
    }

    this.markWarnings();
    this.clearStatus();
    this.syncAnswer();
  }

  /**
   * Rebuild the controls whose shape follows from the domain.
   *
   * A constant's `<select>` offers the domain's elements; a function's table has
   * a cell per argument tuple over it. Both keep whatever value is still in
   * range, so widening a domain does not discard the work already done.
   */
  private rebuildDomainDependents(): void {
    const parsed = parseDomain(this.domainInput?.value ?? "");

    if (!parsed.ok) {
      // Nothing to rebuild against until the domain reads; the warning already
      // says so, and the controls keep their last good shape.
      return;
    }

    const domain = parsed.value;

    for (const { field, row } of this.rows) {
      if (field.kind === "constant") {
        const select = row.querySelector<HTMLSelectElement>("select");

        if (select !== null && select.dataset.locked === undefined) {
          fillOptions(select, domain, Number.parseInt(select.value, 10));
        }

        continue;
      }

      // A function's table is rebuilt even where a given locks part of it: the
      // locked cells are re-seeded from the given, and the rest follow the
      // domain like any other.
      if (field.kind === "function") {
        this.rebuildFunctionTable(field, row, domain);
      }
    }
  }

  /** One function field's value table, over the current domain. */
  private rebuildFunctionTable(
    field: ModelField,
    row: HTMLElement,
    domain: readonly number[],
  ): void {
    const host = row.querySelector<HTMLElement>('[data-role="table"]');
    const layout = functionTableLayout(domain, field.arity);

    if (host === null || layout === null) {
      return;
    }

    const seeded = seededFunctionRows(
      this.data?.givens?.[field.label] ?? "",
      field.arity,
    );
    const lock = this.data?.options.strictGivens ?? false;

    // What the student has chosen so far, so a rebuild is not a reset.
    const kept = new Map<string, number>();

    for (const select of host.querySelectorAll<HTMLSelectElement>("select")) {
      const argument = select.dataset.argument;

      if (argument !== undefined) {
        kept.set(argument, Number.parseInt(select.value, 10));
      }
    }

    // Mirrors the server's table exactly — same shape, same headers, same
    // document order; `tests/dom/model-element.test.ts` is what keeps the two
    // in step.
    const table = document.createElement("table");
    table.className = "model-function-table";
    table.append(functionTableHead(layout));

    const body = document.createElement("tbody");

    for (const line of layout.rows) {
      const tr = document.createElement("tr");

      if (layout.rowHeaders) {
        const header = document.createElement("th");
        header.scope = "row";
        header.textContent = line.label;
        tr.append(header);
      }

      for (const tuple of line.cells) {
        const argument = tupleKey(tuple);
        const fixed = seeded.get(argument);
        const select = document.createElement("select");
        select.className = "model-select";
        select.dataset.argument = argument;
        select.dataset.role = "value";
        select.setAttribute(
          "aria-label",
          this.t("{field} of {argument}", {
            argument,
            field: field.label,
          }),
        );
        select.addEventListener("change", () => {
          this.onFieldEdit(field);
        });

        if (lock && fixed !== undefined) {
          select.dataset.locked = "";
          select.disabled = true;
          fillOptions(select, domain, fixed);
        } else {
          // What the student chose, else what the given seeded — a cell the old
          // domain had no place for is still the exercise's.
          fillOptions(select, domain, kept.get(argument) ?? fixed ?? null);
        }

        const cell = document.createElement("td");
        cell.append(select);
        tr.append(cell);
      }

      body.append(tr);
    }

    table.append(body);
    host.replaceChildren(table);
  }

  /** Mark every field whose contents will not read. */
  private markWarnings(): void {
    for (const { field, row } of this.rows) {
      const warning = row.querySelector<HTMLElement>('[data-role="warning"]');

      if (warning === null) {
        continue;
      }

      const reads = this.fieldReads(field, row);
      warning.textContent = reads ? "" : "⚠";

      if (reads) {
        warning.removeAttribute("title");
      } else {
        warning.title = this.t("This value cannot be read.");
      }
    }
  }

  /** Whether one field's current contents parse. */
  private fieldReads(field: ModelField, row: HTMLElement): boolean {
    const value = this.fieldValue(field, row);

    if (field.kind === "domain") {
      return parseDomain(value).ok;
    }

    if (field.kind === "relation") {
      return parseTupleList(value, field.arity).ok;
    }

    if (field.kind === "constant") {
      return parseNatural(value).ok;
    }

    if (field.kind === "function") {
      return parseFunctionTable(value, field.arity).ok;
    }

    return true;
  }

  /** One field's value, in the spelling the answer records. */
  private fieldValue(field: ModelField, row: HTMLElement): string {
    if (field.kind === "function") {
      const rows = Array.from(
        row.querySelectorAll<HTMLSelectElement>("select[data-argument]"),
      ).map((select) => ({
        args: (select.dataset.argument ?? "")
          .split(",")
          .filter((part) => part !== "")
          .map((part) => Number.parseInt(part, 10)),
        value: Number.parseInt(select.value, 10),
      }));

      return formatFunctionTable(rows);
    }

    const control = row.querySelector<HTMLInputElement | HTMLSelectElement>(
      '[data-role="value"]',
    );

    return control?.value ?? "";
  }

  /** Put the student's own last answer back into the fields. */
  private restorePriorAnswer(): void {
    const prior = this.priorAnswer;

    if (!isAnswerData(prior)) {
      return;
    }

    // A locked domain is the exercise's, not the attempt's: grading puts it
    // back either way, and showing the student's own instead would make every
    // other field look like it was built over the wrong one.
    if (
      this.domainInput !== null &&
      this.domainInput.dataset.locked === undefined &&
      prior.domain !== ""
    ) {
      this.domainInput.value = prior.domain;
      this.rebuildDomainDependents();
    }

    for (const { field, row } of this.rows) {
      const value = prior.fields[field.label];

      if (field.kind === "domain" || value === undefined) {
        continue;
      }

      // A function's table is restored cell by cell, because a locked given may
      // hold only some of its rows. Every other kind is locked whole or not at
      // all.
      if (field.kind === "function") {
        this.restoreFunctionTable(row, field, value);
        continue;
      }

      const control = row.querySelector<HTMLInputElement | HTMLSelectElement>(
        '[data-role="value"]',
      );

      if (control !== null && control.dataset.locked === undefined) {
        control.value = value;
      }
    }
  }

  /** Restore a function's value table from the string it serializes to. */
  private restoreFunctionTable(
    row: HTMLElement,
    field: ModelField,
    value: string,
  ): void {
    const parsed = parseFunctionTable(value, field.arity);

    if (!parsed.ok) {
      return;
    }

    const byArgument = new Map(
      parsed.value.map((entry) => [entry.args.join(","), entry.value]),
    );

    for (const select of row.querySelectorAll<HTMLSelectElement>(
      "select[data-argument]",
    )) {
      const wanted = byArgument.get(select.dataset.argument ?? "");

      if (wanted !== undefined && select.dataset.locked === undefined) {
        select.value = String(wanted);
      }
    }
  }

  /** Grade the current model in the browser and say how it did. */
  private runCheck(): void {
    const data = this.data;
    const resolved = data === null ? null : resolveModel(data);

    if (data === null || resolved === null || this.status === null) {
      return;
    }

    const verdict = checkModel(
      resolved.signature,
      resolved.task,
      effectiveAnswer(data, this.currentAnswer(), resolved.signature),
    );

    this.status.textContent = describeVerdict(
      verdict,
      {
        dialect: resolved.dialect,
        required: resolved.task.required,
        target: resolved.task.target,
        targeted: resolved.task.targeted,
        variant: data.variant,
      },
      (id, values) => this.t(id, values),
    );

    if (verdict.ok) {
      this.status.setAttribute("data-state", "correct");
    } else {
      this.status.removeAttribute("data-state");
    }

    // A model exercise has no answer key, so the browser runs the very check the
    // worker runs: this mark is not a guess at what the server will say.
    this.setMark(verdict.ok ? "ok" : "idle");
  }

  private clearStatus(): void {
    if (this.status !== null) {
      this.status.textContent = "";
      this.status.removeAttribute("data-state");
    }

    // An edited model is not the model any verdict was about, including a
    // recorded one the runtime put up on load.
    this.setMark("idle");
  }

  private currentAnswer(): ModelAnswerData {
    const fields: Record<string, string> = {};
    let domain = "";

    for (const { field, row } of this.rows) {
      if (field.kind === "domain") {
        domain = this.fieldValue(field, row);
        continue;
      }

      fields[field.label] = this.fieldValue(field, row);
    }

    return { domain, fields };
  }

  protected getAnswer(): unknown {
    return this.currentAnswer();
  }
}

/** A value table's column headers: the last argument, after an empty corner. */
function functionTableHead(
  layout: FunctionTableLayout,
): HTMLTableSectionElement {
  const head = document.createElement("thead");
  const row = document.createElement("tr");

  if (layout.rowHeaders) {
    row.append(document.createElement("td"));
  }

  for (const element of layout.columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = String(element);
    row.append(th);
  }

  head.append(row);

  return head;
}

/** Fill a select with the domain's elements, keeping `selected` if it is one. */
function fillOptions(
  select: HTMLSelectElement,
  domain: readonly number[],
  selected: number | null,
): void {
  const keep =
    selected !== null && domain.includes(selected)
      ? selected
      : (domain[0] ?? 0);

  select.replaceChildren();

  for (const element of domain) {
    const option = document.createElement("option");
    option.value = String(element);
    option.textContent = String(element);
    option.selected = element === keep;
    select.append(option);
  }
}

/** Every control in a field row that holds part of the answer. */
function controlsIn(
  row: HTMLElement,
): (HTMLInputElement | HTMLSelectElement)[] {
  return Array.from(
    row.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      'input[data-role="value"], select[data-role="value"]',
    ),
  );
}

function isAnswerData(value: unknown): value is ModelAnswerData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const data = value as Partial<ModelAnswerData>;

  return (
    typeof data.domain === "string" &&
    typeof data.fields === "object" &&
    data.fields !== null
  );
}

register("carnap-model", CarnapModel);
