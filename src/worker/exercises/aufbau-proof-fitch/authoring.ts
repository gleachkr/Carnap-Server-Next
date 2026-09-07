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
import type { SystemResolver } from "../aufbau-proof/authoring";
import {
  goalBinderWarnings,
  parseProofOptions,
  parseTheoremHeader,
  readGoalDeclaration,
  requireProofNotations,
  requireSystem,
  starterFormulaReader,
  starterRuleReader,
  unreadableStarterFormula,
} from "../aufbau-proof/authoring";
import { theoryLanguageSource } from "../aufbau-proof/formulas";
import { ruleCitationShapes } from "./citations";
import { fitchToAuf } from "./translate";
import type { AufbauProofFitchPublicData } from "./types";
import {
  AUFBAU_PROOF_FITCH_ANSWER_KIND,
  AUFBAU_PROOF_FITCH_COMPONENT_METADATA,
  AUFBAU_PROOF_FITCH_KIND,
  AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
} from "./types";

/** The underline separating the goal header from the starter Fitch body. */
const UNDERLINE = /^\s*-{3,}\s*$/;

/** What `::::aufbau-proof-fitch{…}` accepts beyond the shared exercise set. */
const AUFBAU_PROOF_FITCH_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "options",
  "system",
] as const;

/**
 * Compile an `:::aufbau-proof-fitch` exercise. Like `:::aufbau-proof` it resolves
 * a named theory and freezes `theory + goal declaration` into `publicData.mm0`
 * (the sole verification input); its body reads prose (the prompt), a `theorem
 * <name>: $ Γ ⊢ φ $` goal line, a `----` underline, then a starter *Fitch* proof
 * the editor opens with. Which axiom opens a hypothesis, and how a sequent
 * is spelled — the turnstile, and the separator between a context's formulas
 * (`;` in a theory that is also a language and has spent the comma on
 * `R(a,b)`) — are read off the theory's `@syntax role` annotations
 * ({@link requireProofNotations}); the translator writes both symbols into
 * every emitted sequent, and the student's Fitch source never spells either.
 * Grading is identical to the linear type: the translated Fitch text compiles
 * to `.auf`, and the worker verifies the MMB against this frozen mm0.
 */
export async function compileAufbauProofFitch(
  block: DirectiveBlock,
  resolveSystem: SystemResolver,
  diagnostics: CompilerDiagnostic[],
  renderOptions: MarkdownRenderOptions,
): Promise<CompiledExercise | null> {
  validateAttributes(block, AUFBAU_PROOF_FITCH_ATTRIBUTES, diagnostics);

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
  const notations = requireProofNotations(block, theory, diagnostics);
  const header = parseTheoremHeader(block, diagnostics);

  if (id !== null) {
    validateExerciseId(block, id, diagnostics);
  }

  // The goal header must be followed by a '----' underline; the starter Fitch
  // proof (which may be empty) is everything after it.
  let starterBody = "";
  let underlineIndex = -1;
  if (header !== null) {
    const lines = block.bodyLines;

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

  if (
    id === null ||
    theory === undefined ||
    notations === null ||
    header === null
  ) {
    return null;
  }

  const { assumptionRule, contextSymbol, sequentSymbol } = notations;
  const goalLine = block.bodyStartLine + header.headerIndex;

  // The goal's binders shadow the theory's own lexicon for the length of the
  // exercise (#253), which is how a rule schema is written and also how a
  // letter quietly stops meaning what the author thinks. Warnings, so the
  // author decides.
  diagnostics.push(...goalBinderWarnings(theory, header, goalLine));

  // The goal is read the way the lines are (`goalEngineDeclaration`): the
  // engine is handed what it can parse, and what it cannot is the author's
  // to hear about here rather than the widget's to refuse.
  const goal = readGoalDeclaration(theory, header, goalLine, diagnostics);

  if (goal === null) {
    return null;
  }

  // The starter is the text the editor opens with, so a line the theory's
  // language refuses is a proof the student is handed already broken. Read it
  // through the translator rather than line by line here, so the author's
  // diagnostic and the student's squiggle come from one walk of the source.
  if (starterBody.length > 0) {
    const starterLine = block.bodyStartLine + underlineIndex + 1;
    const translated = fitchToAuf(
      starterBody,
      header.goalName,
      assumptionRule,
      sequentSymbol,
      contextSymbol,
      starterFormulaReader(theory, header, "sentence"),
      ruleCitationShapes(theoryLanguageSource(theory, header.theoremDecl)),
      starterRuleReader(theory, header),
    );

    for (const problem of translated.formulaProblems) {
      diagnostics.push(
        unreadableStarterFormula(
          starterLine + problem.sourceLine,
          problem.formula,
          problem.error,
        ),
      );
    }

    if (translated.formulaProblems.length > 0) {
      return null;
    }
  }

  const publicData: AufbauProofFitchPublicData = {
    assumptionRule,
    contextSymbol,
    ...goal,
    goalDecl: header.theoremDecl,
    goalName: header.goalName,
    options,
    promptHtml: await renderMarkdownSource(header.promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    sequentSymbol,
    starterBody,
    system: theory.name,
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
