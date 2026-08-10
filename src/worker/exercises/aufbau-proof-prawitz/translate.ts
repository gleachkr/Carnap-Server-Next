/**
 * Translate a *Prawitz-style* natural-deduction tree into the linear `.auf`
 * proof text the Aufbau compiler consumes. This is the crux of the Prawitz
 * exercise type: it is pure and DOM-free so the client editor (which compiles
 * the result) and the server tests share it — the Prawitz analogue of the tree
 * type's `flattenProofTree` and the Fitch type's `fitchToAuf`.
 *
 * Nodes carry bare formulas; sequent contexts are inferred from the discharge
 * structure alone, so the translator is theory-agnostic — it knows only the
 * assumption axiom's name. Where Fitch's indentation boxes *induce* discharge,
 * here the discharge labels induce the boxes:
 *
 *  - An assumption leaf labeled `n` is discharged at its nearest ancestor whose
 *    `discharge` list contains `n`. Its *box* — the region where it is in
 *    scope — is the subtree of the child of that ancestor through which the
 *    leaf is reached. An unlabeled (or undischarged) leaf is in scope
 *    everywhere: it is a standing premise.
 *  - Every node's context is its textbook **dependency set**: the undischarged
 *    assumptions above it. A leaf seeds with just itself (`a ⊢ a`, the `ax`
 *    axiom's `g` going to empty), and a derived node's context is the union of
 *    its premise contexts filtered to assumptions whose box contains the node —
 *    discharge falls out of the box filter. Nothing from a *different* branch
 *    ever enters a context. That matters once eigenvariable side conditions are
 *    in play: `all_intro`-style rules require the context not to mention the
 *    eigenvariable, and an imported side-branch formula that happens to mention
 *    it would spuriously sink a textbook-valid tree. (An earlier revision used
 *    "ambient" contexts — every in-scope assumption everywhere — to please
 *    theories whose rules share one context metavariable across premises;
 *    exactly that import broke ∀I. Such additive theories are out: rules must
 *    be *multiplicative*, per-premise context variables joined in the
 *    conclusion, as forallx's are.)
 *  - Entries are tracked **per leaf**, not per formula, so a second
 *    same-formula assumption under a different label survives its sibling's
 *    discharge; ACUI idempotence collapses the printed duplicates.
 *
 * A postorder traversal assigns each node a fresh label `l1..lN` — children
 * before their parent, so every citation is backward, as the `.auf` grammar
 * requires — and emits `lN: $ Γ ⊢ φ $ by rule [refs]` (`_` for the empty
 * context, and the theory's own sequent symbol in place of `⊢`). Every assumption leaf emits its own `ax` line: in ND-over-sequent
 * theories the premises live in the goal sequent's context, not in theorem
 * hypotheses, so there is no analogue of the tree type's line-less `#n` leaves.
 *
 * Structural problems (a discharge mark no assumption answers to, mixed
 * formulas under one mark, an assumption with premises) are returned as
 * diagnostics keyed to the offending node; logical errors come from the
 * compiler and are attributed back through `lineSpans`.
 */

import type { PrawitzProofNode } from "./types";

/** The header that separates the goal name from the proof body in `.auf`. */
const HEADER_SEPARATOR = "\n----\n";

/** The structural problems this translator can report. */
export type PrawitzDiagnosticCode =
  | "assumption_with_premises"
  | "discharge_formula_mismatch"
  | "discharge_without_leaf";

/**
 * A structural problem in the tree, keyed to the node that carries it.
 *
 * Structural, not prose: the code and its parameters say *what* is wrong, and
 * the widget's string map says it in the student's language. This module runs
 * in the browser as well as the Worker, so it must not reach a catalog — and a
 * code is a stabler thing for a test to assert on than a sentence someone may
 * reword.
 */
export interface PrawitzDiagnostic {
  readonly code: PrawitzDiagnosticCode;
  readonly nodeId: string;
  /** Values the message interpolates, by `{name}`. */
  readonly params?: Readonly<Record<string, string>>;
}

/** Where a tree node's generated proof line sits in the assembled `proofText`. */
export interface PrawitzLineSpan {
  /** Character offset of the line start within `proofText`. */
  readonly from: number;
  readonly nodeId: string;
  /** Character offset of the line end (exclusive) within `proofText`. */
  readonly to: number;
}

export interface TranslatedPrawitzProof {
  /** The inferred context of each node (deduped formulas, emission order), by
   *  node id — the sequent the student's bare formula was completed to. The
   *  editor surfaces these live, and tests pin them. */
  readonly contexts: ReadonlyMap<string, readonly string[]>;
  readonly diagnostics: readonly PrawitzDiagnostic[];
  /** Char-space map from each generated line back to its source node. */
  readonly lineSpans: readonly PrawitzLineSpan[];
  /** `${goalName}\n----\n${body}` — the full text handed to `compile`. */
  readonly proofText: string;
}

interface WalkedNode {
  readonly children: WalkedNode[];
  /** Preorder index — doubles as the deterministic context-emission order. */
  readonly index: number;
  readonly node: PrawitzProofNode;
  readonly parent: WalkedNode | null;
}

/** The discharge labels of a node, trimmed, with empties dropped. */
function dischargeLabels(node: PrawitzProofNode): string[] {
  return (node.discharge ?? [])
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

/**
 * Translate `root` (the node proving the goal) into `.auf` text for `goalName`,
 * treating a node whose rule is `assumptionRule` as an assumption leaf and
 * writing `sequentSymbol` as the theory's turnstile in every emitted sequent.
 * Returns the assembled proof text, a char-space map from each generated line
 * to its source node, the inferred per-node contexts, and any structural
 * diagnostics (best-effort `proofText` is still returned when they are
 * present).
 */
export function prawitzToAuf(
  root: PrawitzProofNode,
  goalName: string,
  assumptionRule: string,
  sequentSymbol: string,
): TranslatedPrawitzProof {
  const diagnostics: PrawitzDiagnostic[] = [];

  // Preorder walk: parent pointers for discharge resolution, a stable index
  // per node, and the assumption leaves in discovery order.
  const all: WalkedNode[] = [];
  const leaves: WalkedNode[] = [];
  function build(
    node: PrawitzProofNode,
    parent: WalkedNode | null,
  ): WalkedNode {
    const walked: WalkedNode = {
      children: [],
      index: all.length,
      node,
      parent,
    };
    all.push(walked);
    if (node.rule === assumptionRule) {
      leaves.push(walked);
      if (node.premises.length > 0) {
        diagnostics.push({
          code: "assumption_with_premises",
          nodeId: node.id,
        });
      }
    }
    for (const premise of node.premises) {
      walked.children.push(build(premise, walked));
    }
    return walked;
  }
  const rootWalked = build(root, null);

  // Resolve each labeled leaf to its box: the subtree (as a set of preorder
  // indexes) of the child — of its nearest discharging ancestor — through
  // which the leaf is reached. `null` box = in scope everywhere (a premise).
  const collectIndexes = (walked: WalkedNode, into: Set<number>): void => {
    into.add(walked.index);
    for (const child of walked.children) {
      collectIndexes(child, into);
    }
  };

  const boxes = new Map<number, Set<number> | null>();
  /** discharge node index → label → formulas of the leaves it discharges. */
  const dischargedAt = new Map<number, Map<string, string[]>>();

  for (const leafWalked of leaves) {
    const label = leafWalked.node.label?.trim() ?? "";
    let box: Set<number> | null = null;
    if (label.length > 0) {
      let through = leafWalked;
      let ancestor = leafWalked.parent;
      while (ancestor !== null) {
        if (dischargeLabels(ancestor.node).includes(label)) {
          box = new Set<number>();
          collectIndexes(through, box);
          let byLabel = dischargedAt.get(ancestor.index);
          if (byLabel === undefined) {
            byLabel = new Map<string, string[]>();
            dischargedAt.set(ancestor.index, byLabel);
          }
          let formulas = byLabel.get(label);
          if (formulas === undefined) {
            formulas = [];
            byLabel.set(label, formulas);
          }
          formulas.push(leafWalked.node.formula);
          break;
        }
        through = ancestor;
        ancestor = ancestor.parent;
      }
    }
    boxes.set(leafWalked.index, box);
  }

  // A discharge mark every leaf passed over is a mistake the engine cannot
  // name (vacuous discharge is inexpressible here — the mark is a silent
  // no-op); mixed formulas under one mark are textbook-invalid even though the
  // per-leaf tracking would translate them.
  for (const walked of all) {
    const marks = dischargeLabels(walked.node);
    const byLabel = dischargedAt.get(walked.index);
    for (const label of marks) {
      const formulas = byLabel?.get(label) ?? [];
      if (formulas.length === 0) {
        diagnostics.push({
          code: "discharge_without_leaf",
          nodeId: walked.node.id,
          params: { label },
        });
      } else if (new Set(formulas).size > 1) {
        diagnostics.push({
          code: "discharge_formula_mismatch",
          nodeId: walked.node.id,
          params: { label },
        });
      }
    }
  }

  const inScopeAt = (leafIndex: number, at: number): boolean => {
    const box = boxes.get(leafIndex);
    return box === null || box === undefined ? true : box.has(at);
  };

  // Postorder emission with per-leaf context sets.
  const lines: string[] = [];
  const owners: string[] = [];
  const contextLeaves = new Map<number, readonly number[]>();
  const contexts = new Map<string, readonly string[]>();
  let counter = 0;

  const contextFormulas = (leafIndexes: readonly number[]): string[] => {
    const seen = new Set<string>();
    const formulas: string[] = [];
    for (const leafIndex of leafIndexes) {
      const formula = all[leafIndex]?.node.formula ?? "";
      if (!seen.has(formula)) {
        seen.add(formula);
        formulas.push(formula);
      }
    }
    return formulas;
  };

  function emit(walked: WalkedNode): string {
    const refs = walked.children.map(emit);

    let entries: readonly number[];
    if (walked.node.rule === assumptionRule) {
      // A leaf depends only on itself; everything else is inherited upward.
      entries = [walked.index];
    } else {
      const merged: number[] = [];
      const seen = new Set<number>();
      for (const child of walked.children) {
        for (const leafIndex of contextLeaves.get(child.index) ?? []) {
          if (!seen.has(leafIndex) && inScopeAt(leafIndex, walked.index)) {
            seen.add(leafIndex);
            merged.push(leafIndex);
          }
        }
      }
      // Emission order must not depend on which premise a shared assumption
      // happened to surface in first — sort back into leaf discovery order.
      entries = merged.sort((a, b) => a - b);
    }
    contextLeaves.set(walked.index, entries);

    const formulas = contextFormulas(entries);
    contexts.set(walked.node.id, formulas);
    const contextText = formulas.length === 0 ? "_" : formulas.join(" , ");

    counter += 1;
    const label = `l${counter}`;
    owners.push(walked.node.id);
    lines.push(
      `${label}: $ ${contextText} ${sequentSymbol} ${walked.node.formula} $ by ${walked.node.rule} [${refs.join(", ")}]`,
    );
    return label;
  }

  emit(rootWalked);

  const proofText = `${goalName}${HEADER_SEPARATOR}${lines.join("\n")}`;
  const bodyStart = goalName.length + HEADER_SEPARATOR.length;

  const lineSpans: PrawitzLineSpan[] = [];
  let offset = bodyStart;
  for (const [index, line] of lines.entries()) {
    lineSpans.push({
      from: offset,
      nodeId: owners[index] ?? "",
      to: offset + line.length,
    });
    // + 1 for the newline joining this line to the next.
    offset += line.length + 1;
  }

  return { contexts, diagnostics, lineSpans, proofText };
}
