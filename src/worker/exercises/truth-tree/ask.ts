/**
 * Asking the engine about a tree, the same for the editor and the tests.
 *
 * The answer the student writes does not say which instance each general row
 * was written with, or which way round each identity on a branch marked open
 * is developed; the engine is asked. One compile states every candidate
 * ({@link askingProofOf}), and a link or pair it refuses says only that it was
 * not that one. {@link readAsked} reads that compile: the instances that held
 * and the directions refused least, which the answer carries; the errors of
 * the tree's steps and ends, in those directions; and the derivation stating
 * only them, which is what the server writes from that answer. Where it
 * differs from the one asked, the asking compile's certificate is not the
 * tree's, and that derivation is owed a compile of its own.
 */

import {
  heldDirections,
  heldInstances,
  inDirections,
  readTreeDiagnostics,
  type TreeDiagnostic,
  type TreeProof,
} from "./aufbau/emit";
import { type ResolvedTree, treeProofOf } from "./grading";
import type { TruthTreeAnswerData } from "./types";

/**
 * A tree written down to ask the engine which instance each general row was
 * written with and which direction each paired row is developed in: every
 * candidate stated, whatever the answer carries.
 */
export function askingProofOf(
  resolved: ResolvedTree,
  answer: TruthTreeAnswerData,
): TreeProof {
  return treeProofOf(resolved, answer, { asking: true });
}

/** What a compile said, as far as asking a tree needs it. */
export interface TreeCompiled {
  /** Its diagnostics, as `readTreeDiagnostics` reads them. */
  readonly diagnostics: unknown;
  /** Whether it certified what it compiled. */
  readonly certified: boolean;
}

/** A theorem and its proof, for a compile still to come. */
export interface TreeDerivation {
  readonly goal: string;
  readonly proof: string;
}

/** What the engine made of a tree it was asked about. */
export interface TreeAsked {
  /** The instance each general row was written with, where one held. */
  readonly instances: ReadonlyMap<string, string>;
  /** The statement each paired row is developed by. */
  readonly directions: ReadonlyMap<string, string>;
  /** The derivation stating only those, as the server writes it. */
  readonly proof: TreeProof;
  /**
   * The errors of the tree's steps and ends: the compile's, less its links
   * and the directions not chosen.
   */
  readonly errors: readonly TreeDiagnostic[];
  /**
   * Whether the tree certifies: the asking compile did, or every step held
   * and the certificate is {@link owed}.
   */
  readonly certified: boolean;
  /**
   * The derivation to compile for the certificate, where every step held and
   * it differs from the one asked; null where the asking compile's
   * certificate is the tree's, or there is none to be had.
   */
  readonly owed: TreeDerivation | null;
}

/** Read a compile of {@link askingProofOf}'s derivation of `answer`. */
export function readAsked(
  resolved: ResolvedTree,
  answer: TruthTreeAnswerData,
  asking: TreeProof,
  compiled: TreeCompiled,
): TreeAsked {
  const diagnostics = readTreeDiagnostics(compiled.diagnostics, asking);
  const instances = heldInstances(asking, diagnostics);
  const directions = heldDirections(asking, diagnostics);
  const proof = treeProofOf(resolved, answer, { directions, instances });
  const errors = inDirections(diagnostics, directions).filter(
    (error) => error.subject?.type !== "link",
  );
  const owed =
    errors.length === 0 &&
    proof.goal !== null &&
    proof.proof !== null &&
    (proof.goal !== asking.goal || proof.proof !== asking.proof)
      ? { goal: proof.goal, proof: proof.proof }
      : null;

  return {
    certified: owed !== null || compiled.certified,
    directions,
    errors,
    instances,
    owed,
    proof,
  };
}
