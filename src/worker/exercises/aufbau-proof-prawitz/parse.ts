/**
 * Parse a linear starter body into a *Prawitz* proof tree — this type's
 * analogue of the tree type's {@link ../aufbau-proof-tree/parse parseProofTree},
 * which does all the structural work here too (line grammar, duplicate labels,
 * DAG/cycle/orphan rejection, single root). This module only adds the two
 * things a Prawitz node needs beyond a tree node:
 *
 *  - **Sequent lines, contexts discarded.** Starter lines are ordinary `.auf`
 *    sequent lines — the same text {@link ./translate prawitzToAuf} emits and
 *    the engine compiles — and each must contain the exercise's sequent
 *    symbol. Everything up to and including that symbol (the context) is
 *    discarded on parse: Prawitz nodes carry bare conclusions, and the
 *    translator re-infers every context from the discharge structure. One
 *    canonical input format, and a valid `.auf` proof is a valid starter.
 *  - **Discharge labels, as trailing comments.** `-- label:1` at the end of a
 *    line. Position resolves what it means, because a node can only carry one
 *    of the two fields: after an assumption line it is the leaf's discharge
 *    label (the textbook `[A]¹`); after any other line it lists the marks that
 *    rule discharges (the `¹` beside the inference line), comma-separated.
 *    Other trailing `-- …` text, and whole comment lines, stay ordinary
 *    comments.
 *
 * Hypothesis citations (`#n`) are rejected: in ND-over-sequent theories the
 * premises live in the goal sequent's context, and every leaf is an assumption
 * line (see the emission notes in {@link ./translate prawitzToAuf}).
 *
 * `serializePrawitzStarter` is the exact inverse (modulo node ids and line
 * labels): it runs the translator and annotates its `.auf` output with the
 * label comments. Tests pin the round-trip.
 */

import type { ProofTreeParseIssue } from "../aufbau-proof-tree/parse";
import { parseProofTree } from "../aufbau-proof-tree/parse";
import type { ProofTreeNode } from "../aufbau-proof-tree/types";
import { prawitzToAuf } from "./translate";
import type { PrawitzProofNode } from "./types";

export type PrawitzStarterResult =
  | {
      readonly ok: true;
      readonly tree: PrawitzProofNode;
      /** Body-line offset of each proof line, by its label — so a later pass
       *  (the translator's structural checks) can point diagnostics at the
       *  offending starter line. */
      readonly bodyLineByLabel: ReadonlyMap<string, number>;
    }
  | { readonly ok: false; readonly issue: ProofTreeParseIssue };

/** The `<label>:` prefix of a proof line (same shape parseProofTree accepts). */
const LINE_LABEL = /^\s*([A-Za-z_]\w*)\s*:/;

/** The payload of a semantic trailing comment: `label: <text>`. */
const LABEL_COMMENT = /^label:\s*(.*)$/;

/** A hypothesis citation `#n` inside a refs list. */
const HYP_REF = /#\d+/;

function issue(
  code: string,
  message: ProofTreeParseIssue["message"],
  bodyLine: number | null,
  params?: ProofTreeParseIssue["params"],
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

interface StrippedLines {
  readonly cleaned: string[];
  /** Trailing `label:` payloads, keyed by the line's leading label. */
  readonly labelComments: Map<string, { payload: string; bodyLine: number }>;
}

/**
 * Split each line into proof text and an optional trailing comment, collecting
 * the semantic `label:` payloads. The comment scan starts after the last `]`
 * (the refs list, syntactically the final element of a well-formed line) so a
 * `--` inside a formula can never open a comment; on a line with no `]` the
 * grammar is already broken and the truncation only shortens the reported text.
 */
function stripTrailingComments(
  body: string,
):
  | StrippedLines
  | { readonly ok: false; readonly issue: ProofTreeParseIssue } {
  const cleaned: string[] = [];
  const labelComments = new Map<
    string,
    { payload: string; bodyLine: number }
  >();

  for (const [bodyLine, raw] of body.split("\n").entries()) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("--")) {
      // A whole-line comment is inert — unless it *looks* semantic, which is
      // a label that would silently bind to nothing.
      if (LABEL_COMMENT.test(trimmed.replace(/^--\s*/, ""))) {
        return issue(
          "misplaced_label_comment",
          "A “-- label:” comment must sit at the end of the proof line it marks, not on its own line.",
          bodyLine,
        );
      }
      cleaned.push(raw);
      continue;
    }

    const commentAt = raw.indexOf("--", raw.lastIndexOf("]") + 1);
    if (commentAt === -1) {
      cleaned.push(raw);
      continue;
    }

    const proofText = raw.slice(0, commentAt);
    const comment = raw
      .slice(commentAt)
      .replace(/^--\s*/, "")
      .trim();
    cleaned.push(proofText);

    const semantic = LABEL_COMMENT.exec(comment);
    if (semantic === null) {
      continue;
    }
    const payload = (semantic[1] ?? "").trim();
    if (payload.length === 0) {
      return issue(
        "empty_label_comment",
        "This “-- label:” comment names no label.",
        bodyLine,
      );
    }
    const lineLabel = LINE_LABEL.exec(proofText)?.[1];
    if (lineLabel !== undefined) {
      labelComments.set(lineLabel, { bodyLine, payload });
    }
    // A line with no leading label is malformed; parseProofTree reports it.
  }

  return { cleaned, labelComments };
}

/**
 * Parse a starter body into a Prawitz tree, or report the first structural
 * problem. `body` is the proof lines only (no `theorem` header). A node whose
 * rule is `assumptionRule` becomes an assumption leaf; `sequentSymbol` is the
 * exercise's turnstile notation — required in every line, with the context
 * left of it discarded.
 */
export function parsePrawitzStarter(
  body: string,
  assumptionRule: string,
  sequentSymbol: string,
): PrawitzStarterResult {
  const stripped = stripTrailingComments(body);
  if ("ok" in stripped) {
    return stripped;
  }

  // Reject hypothesis citations up front, with a line to point at — the tree
  // parser would otherwise absorb them as `#n` leaves that mean nothing here.
  for (const [bodyLine, line] of stripped.cleaned.entries()) {
    const refs = /\[([^\]]*)\]\s*$/.exec(line)?.[1] ?? "";
    if (HYP_REF.test(refs)) {
      return issue(
        "hyp_ref_in_prawitz_starter",
        "A Prawitz proof has no “#n” hypothesis leaves — write each premise as its own assumption line.",
        bodyLine,
      );
    }
  }

  const parsed = parseProofTree(stripped.cleaned.join("\n"));
  if (!parsed.ok) {
    return parsed;
  }

  const bodyLineByLabel = new Map<string, number>();
  for (const [bodyLine, line] of stripped.cleaned.entries()) {
    const label = LINE_LABEL.exec(line)?.[1];
    if (label !== undefined && !bodyLineByLabel.has(label)) {
      bodyLineByLabel.set(label, bodyLine);
    }
  }

  const convert = (
    node: ProofTreeNode,
  ):
    | PrawitzProofNode
    | { readonly ok: false; readonly issue: ProofTreeParseIssue } => {
    const at = node.formula.indexOf(sequentSymbol);
    if (at === -1) {
      return issue(
        "starter_line_not_sequent",
        "Starter line “{line}” must be a full sequent — its formula has no “{symbol}”.",
        bodyLineByLabel.get(node.id) ?? null,
        { line: node.id, symbol: sequentSymbol },
      );
    }
    const formula = node.formula.slice(at + sequentSymbol.length).trim();

    const comment = stripped.labelComments.get(node.id);
    const premises: PrawitzProofNode[] = [];
    for (const premise of node.premises) {
      const built = convert(premise);
      if ("ok" in built) {
        return built;
      }
      premises.push(built);
    }

    if (node.rule === assumptionRule) {
      if (comment !== undefined && /[\s,]/.test(comment.payload)) {
        return issue(
          "assumption_label_list",
          "An assumption carries a single discharge label; “{payload}” reads as a list.",
          comment.bodyLine,
          { payload: comment.payload },
        );
      }
      return {
        formula,
        id: node.id,
        ...(comment === undefined ? {} : { label: comment.payload }),
        premises,
        rule: node.rule,
      };
    }

    const discharge =
      comment === undefined
        ? []
        : comment.payload
            .split(/[\s,]+/)
            .map((mark) => mark.trim())
            .filter((mark) => mark.length > 0);
    return {
      ...(discharge.length === 0 ? {} : { discharge }),
      formula,
      id: node.id,
      premises,
      rule: node.rule,
    };
  };

  const tree = convert(parsed.tree);
  if ("ok" in tree) {
    return tree;
  }
  return { bodyLineByLabel, ok: true, tree };
}

/**
 * Render a Prawitz tree back into starter lines — the inverse of
 * {@link parsePrawitzStarter} up to node ids and generated line labels. The
 * proof lines are the translator's own `.auf` output (full sequents, inferred
 * contexts), each annotated with its node's label comment, so a serialized
 * complete tree is itself engine-compilable text.
 */
export function serializePrawitzStarter(
  root: PrawitzProofNode,
  assumptionRule: string,
  sequentSymbol: string,
): string {
  const byId = new Map<string, PrawitzProofNode>();
  const index = (node: PrawitzProofNode): void => {
    byId.set(node.id, node);
    for (const premise of node.premises) {
      index(premise);
    }
  };
  index(root);

  const translated = prawitzToAuf(
    root,
    "starter",
    assumptionRule,
    sequentSymbol,
  );
  return translated.lineSpans
    .map((span) => {
      const line = translated.proofText.slice(span.from, span.to);
      const node = byId.get(span.nodeId);
      const marks =
        node === undefined
          ? ""
          : node.rule === assumptionRule
            ? (node.label?.trim() ?? "")
            : (node.discharge ?? []).join(", ");
      return marks.length === 0 ? line : `${line} -- label:${marks}`;
    })
    .join("\n");
}
