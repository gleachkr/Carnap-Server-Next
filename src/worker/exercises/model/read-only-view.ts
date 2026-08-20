import {
  contentRevisionAttribute,
  escapeHtml,
  VISUALLY_HIDDEN_STYLES,
} from "../../application/content/render-support";
import type { ExerciseRenderContext } from "../../application/content/renderer";
import type { ContentNode } from "../../domain/content";
import type { Translator } from "../../i18n/translator";
import { stringsResolver } from "../../i18n/translator";
import { previewExerciseActionsHtml } from "../actions";
import {
  EXERCISE_GROUP_SHADOW_STYLES,
  exerciseGroupLabel,
  exerciseLegendHtml,
} from "../group";
import type { ResolvedModel } from "./grading";
import {
  isModelPublicData,
  resolveModel,
  seededFunctionRows,
} from "./grading";
import type { Formula, ModelField, ModelVerdict } from "./logic";
import {
  DOMAIN_FIELD_LABEL,
  formulaToDisplay,
  functionTableLayout,
  parseDomain,
  tupleKey,
} from "./logic";
import type { ModelStrings } from "./strings";
import { buildModelStrings } from "./strings";
import type {
  ModelAnswerData,
  ModelPublicData,
  ModelTurnstileGlyph,
} from "./types";
import { MODEL_KIND } from "./types";
import { describeVerdict } from "./verdict-text";

/**
 * Shadow-DOM chrome styles for the model element, server-rendered into its
 * Declarative Shadow Root. The shadow boundary isolates them from author
 * `:::style` CSS; the prompt is slotted from light DOM so author CSS and the
 * document's math font still reach it. Custom properties inherit across the
 * boundary, so the palette tokens resolve to the content document's values —
 * which is also why nothing here is a hex literal.
 */
const MODEL_SHADOW_STYLES = `
  ${EXERCISE_GROUP_SHADOW_STYLES}

  .model-goal {
    font-size: 1.05rem;
    margin-bottom: 0.75rem;
  }

  .model-fields {
    display: grid;
    gap: 0.5rem;
  }

  .model-row {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .model-label {
    font-weight: 560;
    min-width: 6ch;
  }

  .model-input {
    background: var(--control-surface, #fbf7ef);
    border: 1px solid var(--rule, #d8d0c3);
    border-radius: 3px;
    color: inherit;
    font: inherit;
    min-width: 12ch;
    padding: 0.15rem 0.35rem;
  }

  .model-input:disabled,
  .model-select:disabled {
    opacity: 0.75;
  }

  .model-select {
    background: var(--control-surface, #fbf7ef);
    border: 1px solid var(--rule, #d8d0c3);
    border-radius: 3px;
    color: inherit;
    font: inherit;
    padding: 0.1rem 0.25rem;
  }

  /* A locked given is a requirement, not a hint: it reads as part of the
     exercise rather than as something left half-answered. */
  .model-row[data-locked] .model-label {
    font-weight: 600;
  }

  .model-warning {
    color: var(--red, #b42318);
    font-weight: 600;
  }

  .model-warning:empty {
    display: none;
  }

  /* A function's values as a table: the last argument across the columns, the
     rest down the rows. A binary function over a small domain is then the
     square it is written as on a blackboard, and no cell has to repeat the
     function symbol — the argument is read off the two axes. A table wider than
     the column scrolls rather than stretching the exercise. */
  .model-function {
    flex: 1 1 auto;
    max-width: 100%;
    min-width: 0;
    overflow-x: auto;
  }

  .model-function-table {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  .model-function-table td,
  .model-function-table th {
    padding: 0.1rem 0.3rem;
    text-align: center;
  }

  /* The two argument axes, ruled off the way a textbook value table is. */
  .model-function-table thead td,
  .model-function-table thead th {
    border-bottom: 1px solid var(--rule-soft, #e5ded3);
    font-weight: 560;
  }

  .model-function-table th[scope="row"] {
    border-right: 1px solid var(--rule-soft, #e5ded3);
    font-weight: 560;
    text-align: right;
    white-space: nowrap;
  }

  /* A locked given is part of the exercise. Muting the control says so more
     plainly than the browser's own disabled styling, which on a select is
     nearly invisible against this palette. Marked on the control rather than
     the row: a function's given may fix some cells of its table and leave the
     rest to the student. */
  .model-input[data-locked],
  .model-select[data-locked] {
    background: var(--surface-soft, #f8f2e8);
    border-style: dashed;
  }

  .model-status:empty {
    display: none;
  }

  ${VISUALLY_HIDDEN_STYLES}
`;

const TURNSTILES: Readonly<Record<ModelTurnstileGlyph, string>> = {
  double: "⊨",
  "negated-double": "⊭",
  single: "⊢",
};

/**
 * What the exercise asks for, above the fields.
 *
 * In logical symbols, not the ASCII the formulas are stored as: this is
 * `intercalate ", " . map (rewriteWith opts . show)` in the original, which is
 * why `AxAyf(x,y) = f(y,x)` is read back as `∀x∀yf(x,y)=f(y,x)`. It needs the
 * *parsed* formulas, so it takes the resolved exercise; without one (stored data
 * that no longer resolves) it falls back to the stored source.
 *
 * A validity exercise shows its sequent. The other two show only the targeted
 * formulas: a constraint exercise's constraints stay *implicit*, as the manual
 * calls them, so the model that satisfies a universal claim by having one
 * element still looks admissible until it is checked.
 */
export function modelGoalText(
  publicData: ModelPublicData,
  resolved: ResolvedModel | null = resolveModel(publicData),
): string {
  const show = (
    formulas: readonly Formula[],
    fallback: readonly string[],
  ): string =>
    resolved === null
      ? fallback.join(", ")
      : formulas
          .map((formula) => formulaToDisplay(formula, resolved.dialect))
          .join(", ");
  const targeted = show(resolved?.task.targeted ?? [], publicData.targeted);

  if (publicData.variant !== "validity") {
    return targeted;
  }

  const turnstile = TURNSTILES[publicData.options.turnstileGlyph];
  const required = show(resolved?.task.required ?? [], publicData.required);

  return `${required} ${turnstile} ${targeted}`;
}

/** The domain a field's controls are built for before the student edits one. */
export function initialDomain(
  publicData: ModelPublicData,
): readonly number[] {
  const seeded = publicData.givens?.[DOMAIN_FIELD_LABEL];
  const parsed = parseDomain(seeded ?? "0");

  // Carnap seeds the domain box with `0`, so an untouched exercise interprets
  // every symbol over a one-element domain.
  return parsed.ok ? parsed.value : [0];
}

interface FieldRenderContext {
  readonly domain: readonly number[];
  readonly disabled: boolean;
  readonly givens: Readonly<Record<string, string>>;
  readonly locked: boolean;
  readonly strings: ModelStrings;
}

/** A `<select>` over the domain, for a constant or a function value. */
function domainSelect(
  attributes: string,
  domain: readonly number[],
  selected: number | null,
  disabled: boolean,
): string {
  const options = domain
    .map(
      (element) =>
        `<option${element === selected ? " selected" : ""} value="${element}">${element}</option>`,
    )
    .join("");

  return `<select class="model-select"${disabled ? " disabled" : ""} ${attributes}>${options}</select>`;
}

/** One field's row: its label, its control, and its parse warning. */
function renderField(field: ModelField, context: FieldRenderContext): string {
  const id = `model-field-${encodeURIComponent(field.label)}`;
  const given = context.givens[field.label] ?? "";
  const locked = context.locked && given !== "";
  const disabled = context.disabled || locked;
  const lockedAttr = locked ? " data-locked" : "";
  const label = `<label class="model-label" for="${id}">${escapeHtml(
    field.kind === "domain" ? context.strings("Domain") : field.label,
  )}</label>`;
  const row = (control: string): string =>
    `<div class="model-row" data-field="${escapeHtml(field.label)}" data-kind="${field.kind}"${lockedAttr}>${label}${control}</div>`;

  if (field.kind === "proposition") {
    const value = given.toLowerCase() === "true";

    return row(
      `<select aria-describedby="${id}-hint" class="model-select" data-role="value"${lockedAttr}${disabled ? " disabled" : ""} id="${id}"><option value="True"${value ? " selected" : ""}>${escapeHtml(context.strings("True"))}</option><option value="False"${value ? "" : " selected"}>${escapeHtml(context.strings("False"))}</option></select><span class="visually-hidden" id="${id}-hint">${escapeHtml(context.strings("{field}: its truth value", { field: field.label }))}</span>`,
    );
  }

  if (field.kind === "constant") {
    const parsed = Number.parseInt(given, 10);
    const selected = Number.isNaN(parsed) ? (context.domain[0] ?? 0) : parsed;

    return row(
      `${domainSelect(
        `aria-describedby="${id}-hint" data-role="value" id="${id}"${lockedAttr}`,
        context.domain,
        selected,
        disabled,
      )}<span class="visually-hidden" id="${id}-hint">${escapeHtml(context.strings("{field}: which element it names", { field: field.label }))}</span>`,
    );
  }

  if (field.kind === "function") {
    // A function's given fixes the arguments it names and no others, so the
    // seeding — and the lock, under `strictGivens` — is per cell rather than per
    // field. A given the student is free to change is still shown: it is the
    // model the exercise starts from, and a table left at its default is not
    // that model.
    const seeded = seededFunctionRows(given, field.arity);
    const layout = functionTableLayout(context.domain, field.arity);
    const cell = (tuple: readonly number[]): string => {
      const argument = tupleKey(tuple);
      const name = context.strings("{field} of {argument}", {
        argument,
        field: field.label,
      });
      const value = seeded.get(argument);
      const cellLocked = locked && value !== undefined;

      return `<td>${domainSelect(
        `aria-label="${escapeHtml(name)}" data-argument="${escapeHtml(argument)}" data-role="value"${cellLocked ? " data-locked" : ""}`,
        context.domain,
        value ?? context.domain[0] ?? 0,
        context.disabled || cellLocked,
      )}</td>`;
    };
    // The corner cell is empty: the field's own label, to the left of the whole
    // table, already says which function this is. A unary function has no
    // header column, and so no corner either.
    const corner = layout?.rowHeaders === true ? "<td></td>" : "";
    const head =
      layout === null
        ? ""
        : `<thead><tr>${corner}${layout.columns
            .map((element) => `<th scope="col">${element}</th>`)
            .join("")}</tr></thead>`;
    const body =
      layout === null
        ? ""
        : `<tbody>${layout.rows
            .map(
              (line) =>
                `<tr>${layout.rowHeaders ? `<th scope="row">${escapeHtml(line.label)}</th>` : ""}${line.cells.map(cell).join("")}</tr>`,
            )
            .join("")}</tbody>`;

    // The label names the group rather than one control, so it is not a `for=`
    // target: each select carries its own name (`f(_,_) of 0,1`), and the two
    // header rows put the same argument on the page for a sighted reader.
    return `<div class="model-row" data-field="${escapeHtml(field.label)}" data-kind="function"${lockedAttr}><span class="model-label">${escapeHtml(field.label)}</span><div class="model-function" data-role="table" role="group" aria-label="${escapeHtml(field.label)}"><table class="model-function-table">${head}${body}</table></div></div>`;
  }

  // Domain and relations are free text: a comma-separated list of numbers, or
  // the tuples in an extension.
  const hint =
    field.kind === "domain"
      ? ""
      : `<span class="visually-hidden" id="${id}-hint">${escapeHtml(context.strings("{field}: the tuples in its extension", { field: field.label }))}</span>`;
  const value = field.kind === "domain" ? given || "0" : given;

  return row(
    `<input class="model-input"${field.kind === "domain" ? "" : ` aria-describedby="${id}-hint"`}${disabled ? " disabled" : ""}${locked ? " readonly" : ""}${lockedAttr} data-role="value" id="${id}" type="text" value="${escapeHtml(value)}"><span aria-live="polite" class="model-warning" data-role="warning"></span>${hint}`,
  );
}

interface ModelElementMeta {
  readonly component: string;
  readonly componentVersion: string;
  readonly contentRevisionId?: string | undefined;
  readonly exerciseId: string;
  readonly exerciseKind: string;
  readonly i18n: Translator;
  /** The author's title, or null for the hidden generic group name. */
  readonly title: string | null;
}

/**
 * The model custom element with its Declarative Shadow Root.
 *
 * The SSR markup is inert (controls disabled, `aria-busy`) and correctly styled
 * with no JS. On connect the element enables the controls, restores the prior
 * answer, and rebuilds the constant selects and function tables whenever the
 * domain changes — which is why they are rendered here for the *initial* domain
 * only.
 */
export function renderModelElement(
  publicData: ModelPublicData,
  meta: ModelElementMeta,
  actions = "",
): string {
  const resolved = resolveModel(publicData);
  const strings = stringsResolver(buildModelStrings(meta.i18n));
  const legend = exerciseLegendHtml(
    exerciseGroupLabel(meta.exerciseKind, meta.title, meta.i18n),
  );
  const context: FieldRenderContext = {
    disabled: true,
    domain: initialDomain(publicData),
    givens: publicData.givens ?? {},
    locked: publicData.options.strictGivens,
    strings,
  };
  const fields = (resolved?.signature ?? [])
    .map((field) => renderField(field, context))
    .join("");

  return `<carnap-model data-component="${escapeHtml(meta.component)}" data-component-version="${escapeHtml(meta.componentVersion)}" data-exercise-id="${escapeHtml(meta.exerciseId)}" data-exercise-kind="${escapeHtml(meta.exerciseKind)}"${contentRevisionAttribute(meta.contentRevisionId)}>
        <template shadowrootmode="open">
          <style>${MODEL_SHADOW_STYLES}</style>
          <fieldset aria-busy="true" class="exercise-group model">
            ${legend}
            <slot name="prompt"></slot>
            <p class="model-goal">${escapeHtml(modelGoalText(publicData, resolved))}</p>
            <div class="model-fields">${fields}</div>
            <p class="exercise-status model-status" data-role="status" role="status"></p>
            <slot name="exercise-actions"></slot>
          </fieldset>
        </template>
        <div class="exercise-prompt" slot="prompt">${publicData.promptHtml}</div>
        ${actions}
      </carnap-model>`;
}

/**
 * Shadow-DOM styles for the model `review` widget: the submitted model as a
 * plain list of field values, with the verdict above it.
 */
const MODEL_REVIEW_STYLES = `
  .model-review-goal {
    font-weight: 560;
    margin: 0 0 0.4rem;
  }

  .model-review-verdict {
    margin: 0 0 0.5rem;
  }

  .model-review {
    display: grid;
    gap: 0.2rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .model-review-field {
    display: flex;
    gap: 0.4rem;
  }

  .model-review-label {
    font-weight: 560;
  }

  .model-review-value {
    font-variant-numeric: tabular-nums;
  }
`;

export interface ModelReview {
  readonly answer: ModelAnswerData;
  readonly exerciseId: string;
  readonly verdict: ModelVerdict;
}

/**
 * The submitted model, rendered statically for the review and results pages.
 *
 * Shows what the student actually typed rather than a normalized rendering of
 * it, which is the reason the answer stores raw strings: an instructor reading a
 * wrong answer wants to see the wrong thing.
 *
 * `reveal` is what a sealed exercise turns off: the model itself is the reader's
 * own work and stays, but the sentence above it — which names the formulas that
 * came out wrong — is the verdict, and there is nothing left of it to show.
 */
export function renderModelReview(
  publicData: ModelPublicData,
  review: ModelReview,
  i18n: Translator,
  reveal = true,
): string {
  const resolved = resolveModel(publicData);
  const strings = stringsResolver(buildModelStrings(i18n));
  const verdict =
    resolved === null || !reveal
      ? ""
      : describeVerdict(
          review.verdict,
          {
            dialect: resolved.dialect,
            required: resolved.task.required,
            target: resolved.task.target,
            targeted: resolved.task.targeted,
            variant: publicData.variant,
          },
          strings,
        );
  const rows = (resolved?.signature ?? [])
    .map((field) => {
      const value =
        field.kind === "domain"
          ? review.answer.domain
          : (review.answer.fields[field.label] ?? "");
      const label = field.kind === "domain" ? strings("Domain") : field.label;

      return `<li class="model-review-field"><span class="model-review-label">${escapeHtml(label)}:</span> <span class="model-review-value">${escapeHtml(value)}</span></li>`;
    })
    .join("");

  return `<carnap-model data-exercise-id="${escapeHtml(review.exerciseId)}" data-review>
        <template shadowrootmode="open">
          <style>${MODEL_REVIEW_STYLES}</style>
          <p class="model-review-goal">${escapeHtml(modelGoalText(publicData, resolved))}</p>
          ${verdict.length === 0 ? "" : `<p class="model-review-verdict">${escapeHtml(verdict)}</p>`}
          <ul class="model-review">${rows}</ul>
        </template>
      </carnap-model>`;
}

export function renderModel(
  node: Extract<ContentNode, { readonly kind: "exercise" }>,
  context: ExerciseRenderContext,
): string {
  if (
    node.exerciseKind !== MODEL_KIND ||
    !isModelPublicData(node.publicData)
  ) {
    return `<div data-component="${escapeHtml(node.render.component)}" data-exercise-id="${escapeHtml(node.exerciseId)}"></div>`;
  }

  return renderModelElement(
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
