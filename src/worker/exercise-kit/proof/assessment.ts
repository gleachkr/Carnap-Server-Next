import { verifyMmb } from "#proof-verifier";
import type {
  AnswerEnvelope,
  AnswerNormalizationResult,
  AutomaticEvaluation,
  EvaluationContext,
  ExerciseManifestItem,
  NormalizedAnswer,
} from "../../domain/content";
import type { JsonValue } from "../../domain/json";
import { diagnostic } from "../assessment";
import { readCertificate } from "./certificate";
import type { PlaygroundGoal } from "./playground";
import {
  answerGoal,
  isPlaygroundExercise,
  verificationText,
} from "./playground";

/**
 * The verifier boundary the four proof types share: what a proof answer must
 * carry to be normalized, and how its certificate is graded.
 *
 * The types differ in what the student *wrote* — a `.auf`, a Fitch source, a
 * tree — and every one of them grades the same way: the MMB certificate the
 * browser compiled rides in the envelope, is verified here against the frozen
 * theory (never against the student's text), and is then let go; the answer
 * kept is the text, from which the certificate can be compiled again. See
 * `./certificate.ts` and [[aufbau-engine-packages]].
 *
 * Each type calls these from its own `ExerciseAssessment`, handing over a
 * {@link ProofAnswerShape} — its kind and version constants, its data guard,
 * the fields it keeps beside `proofText` and the caps on them. Nothing else
 * varies, and nothing here decides what a type's answer looks like: a type
 * whose grading came to differ would simply stop calling.
 */

/** Generous cap so an intro proof passes but a submission can't be unbounded. */
export const MAX_PROOF_TEXT_LENGTH = 65_536;

/** The tree-shaped types' cap on their serialized tree — twice the text's,
 *  since a tree spells every node's id and label beside its formula. */
export const MAX_TREE_JSON_LENGTH = 131_072;

/** What every proof type's answer data carries: the `.auf`, and a playground's goal. */
export interface ProofAnswerData {
  readonly goal?: PlaygroundGoal;
  readonly proofText: string;
}

/** What the verifier needs of a proof type's public data: the frozen theory,
 *  in either of its shapes, and whether the goal is the answer's to supply. */
export interface ProofVerificationData {
  readonly mm0?: string;
  readonly playground?: boolean;
  readonly source?: string;
}

/** How one proof type's answers are shaped, for {@link normalizeProofAnswer}
 *  and {@link evaluateProofCertificate}. */
export interface ProofAnswerShape<Data extends ProofAnswerData> {
  readonly answerKind: string;
  readonly evaluatorVersion: string;
  readonly isAnswerData: (value: unknown) => value is Data;
  readonly isPublicData: (value: unknown) => value is ProofVerificationData;
  /** What a malformed answer is told it needs, e.g. "a proofText string and
   *  a base64 mmb string". */
  readonly needs: string;
  /** The type's own fields kept beside `proofText`, and whether they are
   *  within its caps; `proofText` and the certificate are checked here. */
  readonly own?: (data: Data) => {
    readonly fields: Readonly<Record<string, unknown>>;
    readonly withinCaps: boolean;
  };
  readonly schemaVersion: number;
}

/**
 * Check an envelope against the type's shape and keep the answer: the proof
 * text, the type's own fields, and — for a playground, which has no goal of
 * its own — the goal the proof derived, without which there is nothing to
 * verify the certificate against. The certificate itself is decoded and
 * returned beside the answer, for `evaluate`, not in it.
 */
export function normalizeProofAnswer<Data extends ProofAnswerData>(
  shape: ProofAnswerShape<Data>,
  envelope: AnswerEnvelope,
  declaration: ExerciseManifestItem,
): AnswerNormalizationResult {
  if (envelope.kind !== shape.answerKind) {
    return {
      diagnostics: [
        diagnostic(
          "wrong_answer_kind",
          `Expected answer kind ${shape.answerKind}.`,
          ["kind"],
        ),
      ],
      ok: false,
      reason: "wrong-kind",
    };
  }

  if (envelope.schemaVersion !== shape.schemaVersion) {
    return {
      diagnostics: [
        diagnostic(
          "unsupported_answer_schema_version",
          "The answer schema version is not supported.",
          ["schemaVersion"],
        ),
      ],
      ok: false,
      reason: "schema-invalid",
    };
  }

  if (!shape.isAnswerData(envelope.data)) {
    return {
      diagnostics: [
        diagnostic("malformed_answer_data", shape.needs, ["data"]),
      ],
      ok: false,
      reason: "malformed",
    };
  }

  const data = envelope.data;
  const certificate = readCertificate(data);
  const own = shape.own?.(data) ?? { fields: {}, withinCaps: true };

  if (
    certificate === undefined ||
    certificate === null ||
    data.proofText.length > MAX_PROOF_TEXT_LENGTH ||
    !own.withinCaps
  ) {
    return {
      diagnostics: [
        diagnostic(
          "malformed_answer_data",
          "The proof certificate is missing, malformed, or too large.",
          ["data"],
        ),
      ],
      ok: false,
      reason: "malformed",
    };
  }

  const goal = answerGoal(data);

  if (isPlaygroundExercise(declaration.publicData) && goal === undefined) {
    return {
      diagnostics: [
        diagnostic(
          "malformed_answer_data",
          "A playground proof answer needs the goal its proof derived.",
          ["data", "goal"],
        ),
      ],
      ok: false,
      reason: "malformed",
    };
  }

  return {
    answer: {
      data: {
        ...(goal === undefined ? {} : { goal }),
        proofText: data.proofText,
        ...own.fields,
      } as unknown as JsonValue,
      kind: shape.answerKind,
      schemaVersion: shape.schemaVersion,
    },
    certificate,
    ok: true,
  };
}

/**
 * Grade a normalized proof answer by its certificate. A valid MMB proving the
 * declared goal is the definition of correct, however the proof was written —
 * the verification is against the frozen mm0, never the student's text. A
 * playground's goal is the answer's own, appended to the same frozen text
 * once it has been checked (`verificationText`).
 */
export async function evaluateProofCertificate<Data extends ProofAnswerData>(
  shape: ProofAnswerShape<Data>,
  answer: NormalizedAnswer,
  declaration: ExerciseManifestItem,
  context: EvaluationContext,
): Promise<AutomaticEvaluation> {
  const base = {
    declarationHash: declaration.declarationHash,
    evaluatorVersion: shape.evaluatorVersion,
    kind: "automatic" as const,
    nominalMaxScore: declaration.nominalPoints,
  };

  if (!shape.isPublicData(declaration.publicData)) {
    return {
      ...base,
      awardedScore: 0,
      feedback: {
        diagnostics: [{ code: "invalid_declaration_public_data" }],
      },
      status: "error",
    };
  }

  // The certificate rides in the context, not the answer: it is verified
  // here and then gone, while the answer (the text) is what is kept.
  const mmb = context.certificate;

  if (mmb === undefined) {
    return { ...base, awardedScore: 0, status: "invalid" };
  }

  const theory = verificationText(declaration.publicData, answer.data);

  if (!theory.ok) {
    return {
      ...base,
      awardedScore: 0,
      feedback: { diagnostics: [{ code: `playground_${theory.problem}` }] },
      status: "invalid",
    };
  }

  const result = await verifyMmb(theory.mm0, mmb);

  if (result.errored) {
    return {
      ...base,
      awardedScore: 0,
      feedback: { verified: false },
      status: "error",
    };
  }

  return {
    ...base,
    awardedScore: result.ok ? declaration.nominalPoints : 0,
    feedback: { verified: result.ok },
    status: result.ok ? "correct" : "incorrect",
  };
}
