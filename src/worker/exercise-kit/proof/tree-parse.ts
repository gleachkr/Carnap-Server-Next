/**
 * Parse a linear `.auf` proof body back into a proof *tree* — the inverse of
 * the tree type's `flattenProofTree`. Authors write a starter proof in the same
 * line-per-node form the tree flattens to (`<label>: $ <formula> $ by <rule>
 * [<refs>]`), and this turns it into the {@link ProofTreeNode} the editor seeds
 * from. It is pure and DOM-free so the authoring compiler and its tests share it.
 *
 * A linear proof is only a *tree* when every line is cited by at most one other
 * line and exactly one line goes uncited (the root). A line cited twice makes the
 * proof a DAG, which the tree editor cannot represent — such a body is reported
 * as malformed rather than silently duplicated. Citations to the goal theorem's
 * hypotheses (`#n`) become `hyp` leaves and never count toward that limit.
 */

import type { DiagnosticMessageId } from "../../application/content/diagnostic-strings";
import type { TranslatableMessage } from "../../i18n/translator";

/**
 * One node of a proof tree: a conclusion `formula` justified by a `rule` citing
 * its child `premises` (visited before it when flattening, so every reference
 * is backward — the `.auf` grammar forbids forward references). A leaf with
 * `hyp` set is instead a reference to the goal theorem's `hyp`-th hypothesis; it
 * contributes `#hyp` to its parent's citation list and emits no proof line of
 * its own. `id` is a stable handle for editing and for attributing a compiler
 * diagnostic back to the node that produced the offending line.
 */
export interface ProofTreeNode {
  readonly formula: string;
  readonly hyp?: number;
  readonly id: string;
  readonly premises: readonly ProofTreeNode[];
  readonly rule: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isProofTreeNode(value: unknown): value is ProofTreeNode {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.formula === "string" &&
    typeof value.rule === "string" &&
    (value.hyp === undefined || typeof value.hyp === "number") &&
    Array.isArray(value.premises) &&
    value.premises.every(isProofTreeNode)
  );
}

/**
 * One problem found while parsing, addressed to the author.
 *
 * The prose travels as an unfilled English template plus its values, the same
 * shape a compiler diagnostic uses, because the authoring compiler turns each of
 * these straight into one — and neither this module nor that one has a
 * translator to word it with.
 */
export interface ProofTreeParseIssue extends TranslatableMessage {
  /** A stable machine code (also used as the compiler diagnostic code). */
  readonly code: string;
  readonly message: DiagnosticMessageId;
  /** 0-based offset of the offending line within the body, or null. */
  readonly bodyLine: number | null;
}

export type ProofTreeParseResult =
  | {
      readonly ok: true;
      /** Where each label sat in the body, so a caller holding a node id (which
       *  is its label) can put a diagnostic on the line that wrote it. */
      readonly bodyLineByLabel: ReadonlyMap<string, number>;
      readonly tree: ProofTreeNode;
    }
  | { readonly ok: false; readonly issue: ProofTreeParseIssue };

/** `<label>: $ <formula> $ by <rule> [<refs>]` — one proof line, one tree node. */
const PROOF_LINE =
  /^\s*([A-Za-z_]\w*)\s*:\s*\$([^$]*)\$\s+by\s+([^\s[]+)\s*\[([^\]]*)\]\s*$/;

/** A hypothesis citation `#n` (a reference to the goal's n-th hypothesis). */
const HYP_REF = /^#(\d+)$/;

interface ParsedLine {
  readonly label: string;
  readonly formula: string;
  readonly rule: string;
  readonly refs: readonly string[];
  readonly bodyLine: number;
}

function issue(
  code: string,
  message: DiagnosticMessageId,
  bodyLine: number | null,
  params?: TranslatableMessage["params"],
): { readonly ok: false; readonly issue: ProofTreeParseIssue } {
  return {
    issue: {
      bodyLine,
      code,
      message,
      ...(params === undefined ? {} : { params }),
    },
    ok: false,
  };
}

/**
 * Parse a `.auf` proof body into a proof tree, or report the first structural
 * problem. `body` is the proof lines only (no `goalName`/`----` header — the goal
 * is declared separately in the directive's `theorem` line).
 */
export function parseProofTree(body: string): ProofTreeParseResult {
  const parsed: ParsedLine[] = [];

  const sourceLines = body.split("\n");
  for (const [bodyLine, raw] of sourceLines.entries()) {
    const trimmed = raw.trim();
    // Skip blank lines and `--` comments (as the `.auf` grammar allows).
    if (trimmed.length === 0 || trimmed.startsWith("--")) {
      continue;
    }

    const match = PROOF_LINE.exec(raw);
    if (match === null) {
      return issue(
        "malformed_proof_line",
        "Could not parse “{line}”. Each starter line must read '<label>: $ <formula> $ by <rule> [<refs>]'.",
        bodyLine,
        { line: trimmed },
      );
    }

    const [, label = "", formula = "", rule = "", refsRaw = ""] = match;
    parsed.push({
      bodyLine,
      formula: formula.trim(),
      label,
      refs: refsRaw
        .split(",")
        .map((ref) => ref.trim())
        .filter((ref) => ref.length > 0),
      rule,
    });
  }

  if (parsed.length === 0) {
    return issue(
      "empty_starter_proof",
      "The starter proof has no lines.",
      null,
    );
  }

  // Index the lines and reject duplicate labels.
  const byLabel = new Map<string, ParsedLine>();
  for (const line of parsed) {
    if (byLabel.has(line.label)) {
      return issue(
        "duplicate_proof_label",
        "The label “{label}” is defined more than once.",
        line.bodyLine,
        { label: line.label },
      );
    }
    byLabel.set(line.label, line);
  }

  // Count non-hypothesis citations of each label. A label cited twice makes the
  // proof a DAG, not a tree; an unknown citation is a dangling reference.
  const citationCount = new Map<string, number>();
  for (const line of parsed) {
    for (const ref of line.refs) {
      if (HYP_REF.test(ref)) {
        continue;
      }
      if (!byLabel.has(ref)) {
        return issue(
          "unknown_proof_reference",
          "Line “{label}” cites “{reference}”, which is not a line above it.",
          line.bodyLine,
          { label: line.label, reference: ref },
        );
      }
      const count = (citationCount.get(ref) ?? 0) + 1;
      citationCount.set(ref, count);
      if (count > 1) {
        return issue(
          "proof_is_not_a_tree",
          "Line “{label}” is cited more than once, so this proof is a graph, not a tree. The tree editor needs each line used by at most one other line; duplicate the shared derivation into each branch.",
          line.bodyLine,
          { label: ref },
        );
      }
    }
  }

  // The root is the single uncited line.
  const roots = parsed.filter((line) => !citationCount.has(line.label));
  if (roots.length === 0) {
    return issue(
      "proof_has_no_root",
      "No line is left uncited, so there is no root to prove the goal (the lines cite each other in a cycle).",
      null,
    );
  }
  if (roots.length > 1) {
    return issue(
      "proof_has_multiple_roots",
      "More than one line is uncited ({labels}); a proof tree must end at a single root.",
      roots[1]?.bodyLine ?? null,
      { labels: roots.map((line) => line.label).join(", ") },
    );
  }

  // Exactly one, by the two checks above.
  const root = roots[0] as ParsedLine;

  // Build the tree from the root, tracking which lines were reached so we can
  // flag any that dangle off the tree. No cycle guard: every label is cited
  // at most once and the root not at all, so a walk from the root can never
  // return to a line it has visited — a cycle among the other lines is
  // simply never reached, and is reported as such below.
  const reached = new Set<string>();
  let hypCounter = 0;

  function build(line: ParsedLine): ProofTreeNode | ProofTreeParseResult {
    reached.add(line.label);

    const premises: ProofTreeNode[] = [];
    for (const ref of line.refs) {
      const hyp = HYP_REF.exec(ref);
      if (hyp !== null) {
        hypCounter += 1;
        premises.push({
          formula: "",
          hyp: Number(hyp[1]),
          id: `hyp-${hypCounter}`,
          premises: [],
          rule: "",
        });
        continue;
      }
      // Non-hypothesis refs are validated above, so this lookup always hits.
      const child = byLabel.get(ref) as ParsedLine;
      const built = build(child);
      if ("ok" in built) {
        return built;
      }
      premises.push(built);
    }

    return {
      formula: line.formula,
      id: line.label,
      premises,
      rule: line.rule,
    };
  }

  const built = build(root);
  if ("ok" in built) {
    return built;
  }

  if (reached.size !== parsed.length) {
    const orphan = parsed.find((line) => !reached.has(line.label));
    return issue(
      "proof_line_unreachable",
      "Line “{label}” is not connected to the root of the proof; every line must feed into the conclusion.",
      orphan?.bodyLine ?? null,
      { label: orphan?.label ?? "?" },
    );
  }

  const bodyLineByLabel = new Map<string, number>();
  for (const line of parsed) {
    if (!bodyLineByLabel.has(line.label)) {
      bodyLineByLabel.set(line.label, line.bodyLine);
    }
  }

  return { bodyLineByLabel, ok: true, tree: built };
}
