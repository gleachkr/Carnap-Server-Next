import type {
  CompiledExercise,
  CompilerDiagnostic,
  DirectiveBlock,
  MarkdownRenderOptions,
} from "../../application/content/authoring-toolkit";
import {
  buildCompiledExercise,
  COMMON_EXERCISE_ATTRIBUTES,
  diagnostic,
  parseExamAttribute,
  parseFeedbackAttribute,
  parsePoints,
  renderMarkdownSource,
  requireAttribute,
  validateAttributes,
  validateExerciseId,
} from "../../application/content/authoring-toolkit";
import type { AufbauTheory } from "../aufbau-proof/authoring";
import {
  parseProofOptions,
  parseTheoremHeader,
} from "../aufbau-proof/authoring";
import type { AufbauProofFitchPublicData } from "./types";
import {
  AUFBAU_PROOF_FITCH_ANSWER_KIND,
  AUFBAU_PROOF_FITCH_COMPONENT_METADATA,
  AUFBAU_PROOF_FITCH_KIND,
  AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
  DEFAULT_ASSUMPTION_RULE,
  DEFAULT_SEQUENT_SYMBOL,
} from "./types";

/** The underline separating the goal header from the starter Fitch body. */
const UNDERLINE = /^\s*-{3,}\s*$/;

/** What `::::aufbau-proof-fitch{…}` accepts beyond the shared exercise set. */
const AUFBAU_PROOF_FITCH_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "assumption",
  "options",
  "sequent",
  "theory",
] as const;

/**
 * Compile an `:::aufbau-proof-fitch` exercise. Like `:::aufbau-proof` it resolves
 * a named theory and freezes `theory + goal declaration` into `publicData.mm0`
 * (the sole verification input); its body reads prose (the prompt), a `theorem
 * <name>: $ Γ ⊢ φ $` goal line, a `----` underline, then a starter *Fitch* proof
 * the editor opens with. The `assumption=` attribute names the theory's
 * assumption axiom (`ax` by default) so the translator can tell which lines
 * introduce a context formula; `sequent=` names its turnstile notation (`⊢` by
 * default), which the translator writes into every emitted sequent — the
 * student's Fitch source never spells it. Grading is identical to the linear type: the
 * translated Fitch text compiles to `.auf`, and the worker verifies the MMB
 * against this frozen mm0.
 */
export async function compileAufbauProofFitch(
  block: DirectiveBlock,
  theories: ReadonlyMap<string, AufbauTheory>,
  diagnostics: CompilerDiagnostic[],
  renderOptions: MarkdownRenderOptions,
): Promise<CompiledExercise | null> {
  validateAttributes(block, AUFBAU_PROOF_FITCH_ATTRIBUTES, diagnostics);

  const id = requireAttribute(block, "id", diagnostics);
  const theoryName = requireAttribute(block, "theory", diagnostics);
  const points = parsePoints(block.attrs.points, block.line, diagnostics);
  const exam = parseExamAttribute(block.attrs.exam, block.line, diagnostics);
  const feedback = parseFeedbackAttribute(block, diagnostics);
  const options = parseProofOptions(
    block.attrs.options,
    block.line,
    diagnostics,
  );
  const title = block.attrs.title?.trim();
  const assumptionRule =
    block.attrs.assumption?.trim() || DEFAULT_ASSUMPTION_RULE;
  const sequentSymbol = block.attrs.sequent?.trim() || DEFAULT_SEQUENT_SYMBOL;
  const header = parseTheoremHeader(block, diagnostics);

  if (id !== null) {
    validateExerciseId(block, id, diagnostics);
  }

  const theory = theoryName === null ? undefined : theories.get(theoryName);

  if (theoryName !== null && theory === undefined) {
    diagnostics.push(
      diagnostic(
        block.line,
        "unknown_theory",
        "No aufbau-mm0 theory named “{name}” is declared before this proof.",
        { params: { name: theoryName } },
      ),
    );
  }

  // The goal header must be followed by a '----' underline; the starter Fitch
  // proof (which may be empty) is everything after it.
  let starterBody = "";
  if (header !== null) {
    const lines = block.bodyLines;
    let underlineIndex = -1;

    for (
      let index = header.headerIndex + 1;
      index < lines.length;
      index += 1
    ) {
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

    starterBody = lines
      .slice(underlineIndex + 1)
      .join("\n")
      .trim();
  }

  if (id === null || theory === undefined || header === null) {
    return null;
  }

  const publicData: AufbauProofFitchPublicData = {
    assumptionRule,
    goalName: header.goalName,
    mm0: `${theory.mm0}\n${header.theoremDecl}`,
    options,
    promptHtml: await renderMarkdownSource(header.promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    sequentSymbol,
    starterBody,
  };

  return buildCompiledExercise({
    answerKind: AUFBAU_PROOF_FITCH_ANSWER_KIND,
    capabilities: {
      supportsAutomaticEvaluation: true,
      supportsManualReview: true,
    },
    exam,
    feedback,
    id,
    kind: AUFBAU_PROOF_FITCH_KIND,
    nominalPoints: points,
    privateData: {},
    publicData,
    render: AUFBAU_PROOF_FITCH_COMPONENT_METADATA,
    schemaVersion: AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
    title,
  });
}
