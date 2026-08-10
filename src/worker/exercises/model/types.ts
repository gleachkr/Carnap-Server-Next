/**
 * Constants and data shapes for the model exercise type. DOM-free; the logic
 * core, authoring, assessment, view, and client element all share it.
 */

import type { ModelInput, ModelTarget } from "./logic";

export const MODEL_KIND = "model@1";
export const MODEL_SCHEMA_VERSION = 1;
export const MODEL_ANSWER_KIND = "model-answer@1";
export const MODEL_COMPONENT_METADATA = {
  assetId: "carnap-model-v1",
  clientModule: true,
  component: "carnap-model",
  componentVersion: "1",
} as const;

/**
 * The task shape, following Carnap's three `CounterModeler` classes:
 *   - `simple`     build a model in which the given formulas all come out the
 *                  way the target says; the default.
 *   - `validity`   an argument written with the `:|-:` turnstile. The premises
 *                  must come out true and the conclusions must have the target
 *                  property, so the default is a counterexample to validity.
 *   - `constraint` `constraints : formulas`. The constraints must come out true
 *                  as well, which is how an author rules out the model that
 *                  makes a universal claim true by having one element.
 *
 * The variant is a display distinction by the time it is stored: authoring
 * compiles it, with `counterexample-to`, down to
 * {@link ModelPublicData.required} / {@link ModelPublicData.targeted} and a
 * {@link ModelTarget}, so grading re-derives nothing.
 */
export type ModelVariant = "simple" | "validity" | "constraint";

/**
 * Whether the local Check button is offered. Submitting always grades
 * server-side; Check is the same computation without the round trip, so `off`
 * (cf. Carnap `nocheck`) costs a student the instant answer only.
 */
export type ModelCheckMode = "on" | "off";

/**
 * Which glyph separates a validity exercise's premises from its conclusions in
 * the prompt (display only):
 *   - `single`         `⊢` (default)
 *   - `double`         `⊨` (cf. Carnap `double-turnstile`)
 *   - `negated-double` `⊭` (cf. Carnap `negated-double-turnstile`)
 */
export type ModelTurnstileGlyph = "single" | "double" | "negated-double";

export interface ModelOptions {
  readonly check: ModelCheckMode;
  /**
   * Lock every seeded given so the student cannot change it (cf. Carnap
   * `strictGivens`, which turns hints into requirements — a fixed domain, say,
   * or a domain large enough that a universal claim cannot be true for free).
   * Without it a given is prefilled but editable.
   */
  readonly strictGivens: boolean;
  readonly turnstileGlyph: ModelTurnstileGlyph;
}

export interface ModelPublicData {
  /** The id of the notation system the formulas are written in. */
  readonly dialect: string;
  /**
   * Author-seeded field values, keyed by field label exactly as the givens
   * lines write them (`Domain`, `F(_,_)`, `a`). Absent when the author seeded
   * nothing.
   */
  readonly givens?: Readonly<Record<string, string>>;
  readonly options: ModelOptions;
  readonly promptHtml: string;
  /**
   * Formulas that must come out true whatever else happens — a validity
   * exercise's premises, a constraint exercise's constraints — in canonical
   * source. Empty for a simple exercise.
   */
  readonly required: readonly string[];
  readonly target: ModelTarget;
  /** The formulas {@link target} applies to, in canonical source. Never empty. */
  readonly targeted: readonly string[];
  readonly variant: ModelVariant;
}

/**
 * A submitted model: exactly the text the student put in each field, keyed by
 * field label.
 *
 * Raw strings rather than a parsed model, as Carnap records them
 * (`CounterModelFields = [(String,String)]`), for two reasons: the review page
 * can show what was actually typed, and the field spellings are the same ones an
 * author writes in givens, so there is one representation to reason about. The
 * generated function value table is an editor over the string it produces, not a
 * different format.
 */
export type ModelAnswerData = ModelInput;
