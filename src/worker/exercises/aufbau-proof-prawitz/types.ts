/**
 * Constants and data shapes for the Aufbau *Prawitz* proof exercise type —
 * natural-deduction trees in Gentzen/Prawitz style, over the same sequent/ND
 * theories the Fitch type targets. DOM-free; the authoring compiler,
 * translator, assessment, read-only view, and client editor share it.
 *
 * The student builds a tree whose nodes carry *bare formulas*, not sequents:
 * assumption leaves may carry a discharge label (the textbook `[A]¹`), and a
 * rule node may list the labels its inference discharges. The translator
 * ({@link ./translate prawitzToAuf}) infers each node's sequent context from
 * that structure alone and emits the linear `.auf` the engine consumes; the
 * browser compiles it to an MMB certificate against the frozen theory. The
 * trust boundary is unchanged from the sibling types: the worker re-verifies
 * the MMB against `publicData.mm0`, never the student's tree. See
 * [[aufbau-engine-packages]], [[aufbau-proof-exercise]].
 */

import type { AufbauProofOptions } from "../aufbau-proof/types";

export const AUFBAU_PROOF_PRAWITZ_KIND = "aufbau-proof-prawitz@1";
export const AUFBAU_PROOF_PRAWITZ_SCHEMA_VERSION = 1;
export const AUFBAU_PROOF_PRAWITZ_ANSWER_KIND =
  "aufbau-proof-prawitz-answer@1";
export const AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA = {
  assetId: "carnap-aufbau-proof-prawitz-v1",
  clientModule: true,
  component: "carnap-aufbau-proof-prawitz",
  componentVersion: "1",
} as const;

/** The theory's assumption axiom, absent an author override. See `assumption=`. */
export const DEFAULT_ASSUMPTION_RULE = "ax";

/** The theory's sequent (turnstile) symbol, absent an author override. See `sequent=`. */
export const DEFAULT_SEQUENT_SYMBOL = "⊢";

/**
 * One node of a Prawitz proof tree: a `formula` justified by a `rule` citing
 * its child `premises`. A node whose rule is the exercise's assumption axiom is
 * an *assumption leaf*; its optional `label` is the discharge label (`[A]¹`),
 * and a leaf with no label is an undischarged premise. A rule node's
 * `discharge` lists the labels whose assumptions its inference discharges (the
 * `¹` beside the inference line). `id` is a stable handle for editing and for
 * attributing a compiler diagnostic back to the node that produced the
 * offending line — it has no cross-session meaning.
 */
export interface PrawitzProofNode {
  readonly discharge?: readonly string[];
  readonly formula: string;
  readonly id: string;
  readonly label?: string;
  readonly premises: readonly PrawitzProofNode[];
  readonly rule: string;
}

/**
 * Everything the widget and grader need, frozen at authoring time.
 *   - `assumptionRule` the theory's assumption axiom (`ax` by default): a node
 *                      citing it is an assumption leaf, and the translator
 *                      emits every leaf through it
 *   - `goalFormula`    the goal's conclusion (inside `$ … $`)
 *   - `goalName`       the theorem name the root proves
 *   - `mm0`            the resolved theory plus the appended goal declaration
 *                      `theorem <goalName> …: $ … $;` — the sole verification
 *                      input
 *   - `options`        the shared editor-assistance toggles (reused from the
 *                      linear proof type)
 *   - `promptHtml`     the rendered prose above the goal
 *   - `sequentSymbol`  the theory's sequent (turnstile) notation (`⊢` by
 *                      default): the translator writes it between each emitted
 *                      context and formula, and the starter parser strips a
 *                      context left of it. Optional because artifacts compiled
 *                      before it existed are still served from `compiled_json`;
 *                      read it as `?? DEFAULT_SEQUENT_SYMBOL`
 *   - `starterTree`    an optional pre-populated tree the editor seeds from
 *                      instead of a blank canvas (parsed from the author's
 *                      starter lines, discharge labels included)
 */
export interface AufbauProofPrawitzPublicData {
  readonly assumptionRule: string;
  readonly goalFormula: string;
  readonly goalName: string;
  readonly mm0: string;
  readonly options: AufbauProofOptions;
  readonly promptHtml: string;
  readonly sequentSymbol?: string;
  readonly starterTree?: PrawitzProofNode;
}

/**
 * The submitted answer. `mmb` is the base64 MMB certificate the client
 * compiled from the translated tree — the only thing graded. `proofText` (the
 * translated `.auf`) and `tree` (the structure) are retained for review and to
 * restore the editor; neither is trusted for grading.
 */
export interface AufbauProofPrawitzAnswerData {
  readonly mmb: string;
  readonly proofText: string;
  readonly tree: PrawitzProofNode;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isPrawitzProofNode(
  value: unknown,
): value is PrawitzProofNode {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.formula === "string" &&
    typeof value.rule === "string" &&
    (value.label === undefined || typeof value.label === "string") &&
    (value.discharge === undefined ||
      (Array.isArray(value.discharge) &&
        value.discharge.every((entry) => typeof entry === "string"))) &&
    Array.isArray(value.premises) &&
    value.premises.every(isPrawitzProofNode)
  );
}

export function isAufbauProofPrawitzPublicData(
  value: unknown,
): value is AufbauProofPrawitzPublicData {
  return (
    isObject(value) &&
    typeof value.assumptionRule === "string" &&
    typeof value.goalFormula === "string" &&
    typeof value.goalName === "string" &&
    typeof value.mm0 === "string" &&
    typeof value.promptHtml === "string" &&
    (value.sequentSymbol === undefined ||
      typeof value.sequentSymbol === "string") &&
    (value.starterTree === undefined ||
      isPrawitzProofNode(value.starterTree)) &&
    isObject(value.options) &&
    typeof value.options.allowAuto === "boolean" &&
    typeof value.options.allowCompletion === "boolean"
  );
}

export function isAufbauProofPrawitzAnswerData(
  value: unknown,
): value is AufbauProofPrawitzAnswerData {
  return (
    isObject(value) &&
    typeof value.mmb === "string" &&
    typeof value.proofText === "string" &&
    isPrawitzProofNode(value.tree)
  );
}
