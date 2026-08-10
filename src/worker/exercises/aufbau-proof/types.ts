/**
 * Constants and data shapes for the Aufbau proof exercise type. DOM-free; the
 * authoring compiler, assessment (server-side verifier), read-only view, and
 * client editor element all share it.
 *
 * The trust boundary is the MMB certificate: the student's browser compiles the
 * proof against the frozen theory (see {@link AufbauProofPublicData.mm0}) and
 * submits `{ proofText, mmb }`; the worker re-verifies the MMB against that same
 * mm0 with `@aufbau/verifier`. Verification attests only mm0-declared theorems,
 * so the goal is frozen into `mm0` as a `theorem <goalName>: $ … $;` — the proof
 * is correct iff the certificate proves that declared goal. See
 * [[aufbau-engine-packages]].
 */

export const AUFBAU_PROOF_KIND = "aufbau-proof@1";
export const AUFBAU_PROOF_SCHEMA_VERSION = 1;
export const AUFBAU_PROOF_ANSWER_KIND = "aufbau-proof-answer@1";
export const AUFBAU_PROOF_COMPONENT_METADATA = {
  assetId: "carnap-aufbau-proof-v1",
  clientModule: true,
  component: "carnap-aufbau-proof",
  componentVersion: "1",
} as const;

/**
 * Author toggles for the in-browser editor's assistance. Both default off so an
 * intro propositional-logic problem stays honest; an author teaching, say, ZFC
 * can switch them on.
 *   - `allowAuto`       expose the compiler's `auto?` / `apply?` proof search
 *   - `allowCompletion` expose LSP rule-name completion
 */
export interface AufbauProofOptions {
  readonly allowAuto: boolean;
  readonly allowCompletion: boolean;
}

/**
 * Everything the widget and grader need, frozen at authoring time.
 *   - `goalName`    the theorem name; the student's proof body attaches to a
 *                   `<goalName>` public-theorem-block header (see `docs/proof.md`)
 *   - `mm0`         the resolved theory text plus the appended goal declaration
 *                   `theorem <goalName>: $ … $;` — the sole verification input
 *   - `promptHtml`  the rendered prose above the theorem header
 *   - `starterBody` the seed proof body shown in the editable region (may hold
 *                   `auto?` holes)
 */
export interface AufbauProofPublicData {
  readonly goalName: string;
  readonly mm0: string;
  readonly options: AufbauProofOptions;
  readonly promptHtml: string;
  readonly starterBody: string;
}

/**
 * The submitted answer. `mmb` is the base64 MMB certificate the client compiled
 * — the only thing graded. `proofText` is the full `.auf` the student wrote
 * (header + body), retained for review display; it is never trusted for grading.
 */
export interface AufbauProofAnswerData {
  readonly mmb: string;
  readonly proofText: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAufbauProofOptions(
  value: unknown,
): value is AufbauProofOptions {
  return (
    isObject(value) &&
    typeof value.allowAuto === "boolean" &&
    typeof value.allowCompletion === "boolean"
  );
}

export function isAufbauProofPublicData(
  value: unknown,
): value is AufbauProofPublicData {
  return (
    isObject(value) &&
    typeof value.goalName === "string" &&
    typeof value.mm0 === "string" &&
    typeof value.promptHtml === "string" &&
    typeof value.starterBody === "string" &&
    isAufbauProofOptions(value.options)
  );
}

export function isAufbauProofAnswerData(
  value: unknown,
): value is AufbauProofAnswerData {
  return (
    isObject(value) &&
    typeof value.mmb === "string" &&
    typeof value.proofText === "string"
  );
}
