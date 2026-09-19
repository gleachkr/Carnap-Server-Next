import type { ExerciseCapabilities } from "../../domain/exercises";
import type { Translator } from "../../i18n/translator";
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

import { isObject } from "../../exercise-kit/assessment";
import type { AufbauProofOptions } from "../../exercise-kit/proof/options";
import { isAufbauProofOptions } from "../../exercise-kit/proof/options";
import type { PlaygroundGoal } from "../../exercise-kit/proof/playground";
import { isPlaygroundGoal } from "../../exercise-kit/proof/playground";

export const AUFBAU_PROOF_KIND = "aufbau-proof@1";
export const AUFBAU_PROOF_SCHEMA_VERSION = 1;
export const AUFBAU_PROOF_ANSWER_KIND = "aufbau-proof-answer@1";
export const AUFBAU_PROOF_COMPONENT_METADATA = {
  assetId: "carnap-aufbau-proof-v1",
  clientModule: true,
  component: "carnap-aufbau-proof",
  componentVersion: "1",
} as const;

/** What grading can do for this type; declared once, copied onto each manifest item. */
export const AUFBAU_PROOF_CAPABILITIES: ExerciseCapabilities = {
  supportsAutomaticEvaluation: true,
  supportsManualReview: true,
};

/** The generic group name for an untitled exercise of this type. */
export function aufbauProofName(i18n: Translator): string {
  return i18n.t("Proof");
}

/**
 * Everything the widget and grader need, frozen at authoring time.
 *   - `allowSorry`  set when a line may be admitted with `sorry!`: the
 *                   widget marks such a line as a warning, not an error,
 *                   and (outside an exam) will not submit the proof while
 *                   one stands; it never scores either way
 *   - `goalDecl`    this exercise's own `theorem <goalName>: $ … $;`, which the
 *                   join appends to the system's text
 *   - `goalName`    the theorem name; the student's proof body attaches to a
 *                   `<goalName>` public-theorem-block header (see `docs/proof.md`)
 *   - `mm0`         the resolved theory text plus the appended goal declaration
 *                   — the sole verification input. **Filled by the join**, not
 *                   stored: see `exercise-kit/systems/join.ts`. It is required here
 *                   because this interface describes the payload as a consumer
 *                   receives it, which is always after the join; what the
 *                   compiler writes is {@link CompiledAufbauProofPublicData}.
 *   - `playground`  set when the exercise has no goal of its own: `goalDecl`
 *                   is absent, `goalName` is the fixed `playground`, and the
 *                   answer carries the statement its proof derived (see
 *                   `exercise-kit/proof/playground.ts`)
 *   - `promptHtml`  the rendered prose above the theorem header
 *   - `source`      the theory as written, `@syntax` intact, which the join
 *                   fills in beside `mm0`. This type's students write engine
 *                   text and nothing reads their lines in it; a playground
 *                   reads its derived *statement* in it, to find the variables
 *                   the goal must bind
 *   - `starterBody` the seed proof body shown in the editable region (may hold
 *                   `auto?` holes)
 *   - `system`      which of the document's systems this exercise is set in
 */
export interface AufbauProofPublicData {
  readonly allowSorry?: boolean;
  readonly goalDecl?: string;
  readonly goalName: string;
  readonly mm0: string;
  readonly options: AufbauProofOptions;
  readonly playground?: boolean;
  readonly promptHtml: string;
  readonly source?: string;
  readonly starterBody: string;
  readonly system?: string;
}

/**
 * The payload as it is stored and as it goes on the wire: the key instead of
 * the text. One copy of a 30 KB theory per document rather than one per
 * exercise is the whole point of the table; `mm0` is what the reader's own join
 * puts back.
 */
export type CompiledAufbauProofPublicData = Omit<
  AufbauProofPublicData,
  "mm0"
>;

/**
 * The answer as stored: `proofText` is the full `.auf` the student wrote
 * (header + body), shown on review and restored into the editor; it is never
 * trusted for grading. The envelope the client submits carries one more field,
 * `mmb`, the base64 MMB certificate the client compiled from that text — the
 * only thing graded, read by `readCertificate` and verified in `evaluate`, and
 * not kept: the verdict is what the record holds, and the text is enough to
 * compile the certificate again.
 */
export interface AufbauProofAnswerData {
  /** A playground's derived goal — what its certificate is verified against. */
  readonly goal?: PlaygroundGoal;
  readonly proofText: string;
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
    typeof value.proofText === "string" &&
    (value.goal === undefined || isPlaygroundGoal(value.goal))
  );
}
