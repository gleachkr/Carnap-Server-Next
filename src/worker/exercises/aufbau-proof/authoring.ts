import { renderMarkdownSource } from "../../application/content/authoring-toolkit";
import {
  type CompilerDiagnostic,
  diagnostic,
} from "../../application/content/diagnostics";
import {
  buildCompiledExercise,
  COMMON_EXERCISE_ATTRIBUTES,
  type CompiledExercise,
  type DirectiveBlock,
  parseExamAttribute,
  parseFeedbackAttribute,
  parsePoints,
  requireAttribute,
  validateAttributes,
  validateExerciseId,
} from "../../exercise-kit/authoring";
import {
  parsePlaygroundAttribute,
  parsePlaygroundBody,
  parseProofOptions,
  parseTheoremHeader,
  UNDERLINE,
} from "../../exercise-kit/proof/authoring";
import { PLAYGROUND_GOAL_NAME } from "../../exercise-kit/proof/playground";
import { requireSystem } from "../../exercise-kit/systems/theory";
import type { ExerciseCompileContext } from "../../exercise-kit/type";
import type { CompiledAufbauProofPublicData } from "./types";
import {
  AUFBAU_PROOF_ANSWER_KIND,
  AUFBAU_PROOF_CAPABILITIES,
  AUFBAU_PROOF_COMPONENT_METADATA,
  AUFBAU_PROOF_KIND,
  AUFBAU_PROOF_SCHEMA_VERSION,
} from "./types";

interface ProofBody {
  readonly goalName: string;
  /** The MM0 theorem declaration, normalized to end with a single `;`;
   *  empty for a playground, which declares its goal from the proof. */
  readonly theoremDecl: string;
  readonly playground: boolean;
  readonly promptLines: readonly string[];
  readonly starterBody: string;
}

/**
 * Split a proof directive body into its prompt, goal header, and starter body.
 * The body reads: prose (the prompt), then a single `theorem <name>: $ … $` line
 * (the goal, in MM0 declaration syntax), then a `----` underline, then the
 * starter proof lines. Returns null (with a diagnostic) when the header or
 * underline is missing.
 */
function parseProofBody(
  block: DirectiveBlock,
  playground: boolean,
  diagnostics: CompilerDiagnostic[],
): ProofBody | null {
  if (playground) {
    const body = parsePlaygroundBody(block, diagnostics);

    return body === null
      ? null
      : {
          goalName: PLAYGROUND_GOAL_NAME,
          playground: true,
          promptLines: body.promptLines,
          starterBody: body.starterBody,
          theoremDecl: "",
        };
  }

  const header = parseTheoremHeader(block, diagnostics);

  if (header === null) {
    return null;
  }

  const lines = block.bodyLines;
  // The first non-blank line after the header must be the '----' underline.
  let underlineIndex = -1;

  for (let index = header.headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (line.trim().length === 0) {
      continue;
    }

    if (UNDERLINE.test(line)) {
      underlineIndex = index;
    }

    break;
  }

  if (underlineIndex === -1) {
    diagnostics.push(
      diagnostic(
        block.bodyStartLine + header.headerIndex,
        "missing_proof_underline",
        "The goal header must be followed by a '----' underline, then the proof body.",
      ),
    );
    return null;
  }

  const starterBody = lines
    .slice(underlineIndex + 1)
    .join("\n")
    .trim();

  return {
    goalName: header.goalName,
    playground: false,
    promptLines: header.promptLines,
    starterBody,
    theoremDecl: header.theoremDecl,
  };
}

/** What `::::aufbau-proof{…}` accepts beyond the shared exercise set. */
const AUFBAU_PROOF_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "options",
  "playground",
  "system",
] as const;

/**
 * Compile an `:::aufbau-proof` exercise. Names the referenced theory and keeps
 * the goal declaration beside it, so the join (`exercise-kit/systems/join.ts`) can hand
 * the widget and the grader `publicData.mm0` — the theory plus the declaration —
 * and the worker can verify a submitted MMB against it independently of
 * anything the student sends.
 */
export async function compileAufbauProof(
  block: DirectiveBlock,
  context: ExerciseCompileContext,
): Promise<CompiledExercise | null> {
  const { diagnostics, renderOptions, resolveSystem } = context;
  validateAttributes(block, AUFBAU_PROOF_ATTRIBUTES, diagnostics);

  const id = requireAttribute(block, "id", diagnostics);
  const theory =
    requireSystem(block, resolveSystem, diagnostics) ?? undefined;
  const points = parsePoints(block.attrs.points, block.line, diagnostics);
  const exam = parseExamAttribute(block.attrs.exam, block.line, diagnostics);
  const feedback = parseFeedbackAttribute(block, diagnostics);
  const options = parseProofOptions(
    block.attrs.options,
    block.line,
    diagnostics,
  );
  const title = block.attrs.title?.trim();
  const playground = parsePlaygroundAttribute(block, diagnostics);
  const body = parseProofBody(block, playground, diagnostics);

  if (id !== null) {
    validateExerciseId(block, id, diagnostics);
  }

  if (id === null || theory === undefined || body === null) {
    return null;
  }

  // A playground freezes no declaration: the join appends nothing, and the
  // goal is whatever the submitted proof's last line says (`exercise-kit/proof/playground.ts`).
  const publicData: CompiledAufbauProofPublicData = {
    ...(body.playground
      ? { playground: true }
      : { goalDecl: body.theoremDecl }),
    goalName: body.goalName,
    options,
    promptHtml: await renderMarkdownSource(body.promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    starterBody: body.starterBody,
    system: theory.name,
  };

  return buildCompiledExercise({
    answerKind: AUFBAU_PROOF_ANSWER_KIND,
    capabilities: AUFBAU_PROOF_CAPABILITIES,
    exam,
    feedback,
    id,
    kind: AUFBAU_PROOF_KIND,
    nominalPoints: points,
    privateData: {},
    publicData,
    render: AUFBAU_PROOF_COMPONENT_METADATA,
    schemaVersion: AUFBAU_PROOF_SCHEMA_VERSION,
    title,
  });
}
