/**
 * The `.auf` text a proof exercise compiles: the goal's name, a `----`
 * underline, then the proof body, one line per step. The linear widget's
 * student writes the body by hand; the Fitch, tree and Prawitz translators
 * emit it, and map each emitted line back to what produced it so the
 * compiler's byte-span diagnostics can land on the student's own line or
 * node. DOM-free: the browser assembles this too.
 */

/** Between the goal name and the body. */
export const PROOF_HEADER_SEPARATOR = "\n----\n";

/** `${goalName}\n----\n${body}` — the whole text handed to `compile`. */
export function proofTextOf(goalName: string, body: string): string {
  return `${goalName}${PROOF_HEADER_SEPARATOR}${body}`;
}

/** Where one emitted line sits in the assembled text. */
export interface ProofLineSpan {
  /** Character offset of the line start within `proofText`. */
  readonly from: number;
  /** Character offset of the line end (exclusive) within `proofText`. */
  readonly to: number;
}

/**
 * Assemble emitted body lines under the goal header, and locate each in the
 * result. `owners[i]` is what produced `lines[i]` — a `{ nodeId }` or a
 * `{ sourceLine }` — and comes back spread into that line's span.
 */
export function assembleProofText<Owner extends object>(
  goalName: string,
  lines: readonly string[],
  owners: readonly Owner[],
): {
  readonly lineSpans: readonly (Owner & ProofLineSpan)[];
  readonly proofText: string;
} {
  const lineSpans: (Owner & ProofLineSpan)[] = [];
  let offset = goalName.length + PROOF_HEADER_SEPARATOR.length;

  for (const [index, line] of lines.entries()) {
    lineSpans.push({
      ...(owners[index] as Owner),
      from: offset,
      to: offset + line.length,
    });
    // + 1 for the newline joining this line to the next.
    offset += line.length + 1;
  }

  return { lineSpans, proofText: proofTextOf(goalName, lines.join("\n")) };
}
