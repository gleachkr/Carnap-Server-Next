/**
 * Constants and data shapes for the Aufbau *Fitch* proof exercise type — a
 * textbook Fitch-style input modality (indentation marks subproofs) over the
 * same sequent/ND engine as the {@link ../aufbau-proof/types linear} and {@link
 * ../aufbau-proof-tree/types tree} proof types. DOM-free; the authoring
 * compiler, translator, assessment, read-only view, and client editor share it.
 *
 * The student edits a Fitch proof as text. A pure translator ({@link
 * ../aufbau-proof-fitch/translate fitchToAuf}) turns indentation into
 * comma-separated sequent contexts and emits the exact linear `.auf` the
 * compiler consumes; the browser compiles that to an MMB certificate against the
 * frozen theory. The trust boundary is unchanged: the worker re-verifies the MMB
 * against `publicData.mm0` (the frozen theory + goal), never the student's text.
 * See [[aufbau-engine-packages]], [[aufbau-proof-exercise]].
 */

import type { AufbauProofOptions } from "../aufbau-proof/types";

export const AUFBAU_PROOF_FITCH_KIND = "aufbau-proof-fitch@1";
export const AUFBAU_PROOF_FITCH_SCHEMA_VERSION = 1;
export const AUFBAU_PROOF_FITCH_ANSWER_KIND = "aufbau-proof-fitch-answer@1";
export const AUFBAU_PROOF_FITCH_COMPONENT_METADATA = {
  assetId: "carnap-aufbau-proof-fitch-v1",
  clientModule: true,
  component: "carnap-aufbau-proof-fitch",
  componentVersion: "1",
} as const;

/** The theory's assumption axiom, absent an author override. See `assumption=`. */
export const DEFAULT_ASSUMPTION_RULE = "ax";

/** The theory's sequent (turnstile) symbol, absent an author override. See `sequent=`. */
export const DEFAULT_SEQUENT_SYMBOL = "⊢";

/**
 * Everything the widget and grader need, frozen at authoring time.
 *   - `assumptionRule` the theory's assumption axiom (`ax` by default): the
 *                      translator treats a line citing it with no premises as an
 *                      assumption, adding its formula to the active context
 *   - `goalName`       the theorem name the proof establishes
 *   - `mm0`            the resolved theory plus the appended goal declaration
 *                      `theorem <goalName> …: $ Γ ⊢ φ $;` — the sole verification
 *                      input
 *   - `options`        the shared editor-assistance toggles (reused from the
 *                      linear proof type)
 *   - `promptHtml`     the rendered prose above the goal
 *   - `sequentSymbol`  the theory's sequent (turnstile) notation (`⊢` by
 *                      default): the translator writes it between each emitted
 *                      context and formula. Optional because artifacts compiled
 *                      before it existed are still served from `compiled_json`;
 *                      read it as `?? DEFAULT_SEQUENT_SYMBOL`
 *   - `starterBody`    the seed Fitch proof text the editor opens with
 */
export interface AufbauProofFitchPublicData {
  readonly assumptionRule: string;
  readonly goalName: string;
  readonly mm0: string;
  readonly options: AufbauProofOptions;
  readonly promptHtml: string;
  readonly sequentSymbol?: string;
  readonly starterBody: string;
}

/**
 * The submitted answer. `mmb` is the base64 MMB certificate the client compiled
 * from the translated Fitch text — the only thing graded. `proofText` (the
 * translated `.auf`) and `fitchText` (the student's source) are retained for
 * review and to restore the editor; neither is trusted for grading.
 */
export interface AufbauProofFitchAnswerData {
  readonly fitchText: string;
  readonly mmb: string;
  readonly proofText: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAufbauProofFitchPublicData(
  value: unknown,
): value is AufbauProofFitchPublicData {
  return (
    isObject(value) &&
    typeof value.assumptionRule === "string" &&
    typeof value.goalName === "string" &&
    typeof value.mm0 === "string" &&
    typeof value.promptHtml === "string" &&
    typeof value.starterBody === "string" &&
    (value.sequentSymbol === undefined ||
      typeof value.sequentSymbol === "string") &&
    isObject(value.options) &&
    typeof value.options.allowAuto === "boolean" &&
    typeof value.options.allowCompletion === "boolean"
  );
}

export function isAufbauProofFitchAnswerData(
  value: unknown,
): value is AufbauProofFitchAnswerData {
  return (
    isObject(value) &&
    typeof value.fitchText === "string" &&
    typeof value.mmb === "string" &&
    typeof value.proofText === "string"
  );
}
