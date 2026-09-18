import {
  type ExerciseElementMeta,
  escapeHtml,
  exerciseRootAttributes,
  VISUALLY_HIDDEN_STYLES,
} from "../../application/content/render-support";
import type { ContentNode } from "../../domain/content";
import { previewExerciseActionsHtml } from "../../exercise-kit/actions";
import {
  EXERCISE_GROUP_SHADOW_STYLES,
  exerciseGroupLabel,
  exerciseLegendHtml,
} from "../../exercise-kit/group";
import { EXERCISE_TOKEN_STYLES } from "../../exercise-kit/tokens";
import type { ExerciseRenderContext } from "../../exercise-kit/type";
import type { Translator } from "../../i18n/translator";
import { stringsResolver } from "../../i18n/translator";
import type { ResolvedModel } from "./grading";
import {
  isModelPublicData,
  resolveModel,
  seededFunctionRows,
} from "./grading";
import type { Formula, ModelField, ModelVerdict } from "./logic";
import {
  DOMAIN_FIELD_LABEL,
  formulaToString,
  functionTableLayout,
  parseDomain,
  tupleKey,
} from "./logic";
import reviewStyles from "./review.css" with { type: "text" };
import shadowStyles from "./shadow.css" with { type: "text" };
import type { ModelStrings } from "./strings";
import { buildModelStrings } from "./strings";
import type {
  ModelAnswerData,
  ModelPublicData,
  ModelTurnstileGlyph,
} from "./types";
import { MODEL_KIND, modelName } from "./types";
import { describeVerdict } from "./verdict-text";

const MODEL_SHADOW_STYLES = [
  EXERCISE_GROUP_SHADOW_STYLES,
  shadowStyles,
  VISUALLY_HIDDEN_STYLES,
].join("\n");

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
          .map((formula) => formulaToString(formula, resolved.language))
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

interface ModelElementMeta extends ExerciseElementMeta {
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
    exerciseGroupLabel(modelName(meta.i18n), meta.title),
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

  return `<carnap-model${exerciseRootAttributes(meta)}>
        <template shadowrootmode="open">
          <style>${MODEL_SHADOW_STYLES}</style>
          <fieldset aria-busy="true" class="exercise-group model">
            ${legend}
            <slot name="prompt"></slot>
            <p class="model-goal">${escapeHtml(modelGoalText(publicData, resolved))}</p>
            <div class="model-fields">${fields}</div>
            <slot name="exercise-actions"></slot>
          </fieldset>
        </template>
        <div class="exercise-prompt" slot="prompt">${publicData.promptHtml}</div>
        ${actions}
      </carnap-model>`;
}

const MODEL_REVIEW_STYLES = [EXERCISE_TOKEN_STYLES, reviewStyles].join("\n");

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
            language: resolved.language,
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
    context.actions ?? previewExerciseActionsHtml(context.i18n, true),
  );
}
