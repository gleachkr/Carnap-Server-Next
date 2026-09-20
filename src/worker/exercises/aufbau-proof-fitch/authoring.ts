import { renderMarkdownSource } from "../../application/content/markdown";
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
  goalBinderWarnings,
  PLAYGROUND_HEADER,
  parseAllowSorryAttribute,
  parsePlaygroundAttribute,
  parsePlaygroundBody,
  parseProofOptions,
  parseTheoremHeader,
  readGoalDeclaration,
  requireProofNotations,
  requireStarterBody,
  starterFormulaReader,
  starterLine,
  starterRuleReader,
  unreadableStarterFormula,
} from "../../exercise-kit/proof/authoring";
import { theoryLanguageSource } from "../../exercise-kit/proof/formulas";
import { requireSystem } from "../../exercise-kit/systems/theory";
import type { ExerciseCompileContext } from "../../exercise-kit/type";
import { ruleCitationShapes } from "./citations";
import { fitchToAuf } from "./translate";
import type { AufbauProofFitchPublicData } from "./types";
import {
  AUFBAU_PROOF_FITCH_ANSWER_KIND,
  AUFBAU_PROOF_FITCH_CAPABILITIES,
  AUFBAU_PROOF_FITCH_COMPONENT_METADATA,
  AUFBAU_PROOF_FITCH_KIND,
  AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
} from "./types";

/** What `::::aufbau-proof-fitch{…}` accepts beyond the shared exercise set. */
const AUFBAU_PROOF_FITCH_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "allow-sorry",
  "options",
  "playground",
  "system",
] as const;

/**
 * Compile an `:::aufbau-proof-fitch` exercise. Like `:::aufbau-proof` it names
 * the system its `system=` resolves to and keeps the goal declaration beside
 * it, so the join (`exercise-kit/systems/join.ts`) can hand the widget and
 * the grader `publicData.mm0` — theory plus declaration, the sole verification
 * input; its body reads prose (the prompt), a `theorem <name>: $ Γ ⊢ φ $` goal
 * line, a `----` underline, then a starter *Fitch* proof the editor opens
 * with. Which axiom opens a hypothesis, and how a sequent
 * is spelled — the turnstile, and the separator between a context's formulas
 * (`;` in a theory that is also a language and has spent the comma on
 * `R(a,b)`) — are read off the theory's `@syntax role` annotations
 * ({@link requireProofNotations}); the translator writes both symbols into
 * every emitted sequent, and the student's Fitch source never spells either.
 * Grading is identical to the linear type: the translated Fitch text compiles
 * to `.auf`, and the worker verifies the MMB against that joined mm0.
 *
 * With `playground`, the body has no goal line: prose, then optionally the
 * underline and a starter. Nothing is frozen beside the theory, and the goal
 * is whatever the submitted proof's last line says (`exercise-kit/proof/playground.ts`).
 */
export async function compileAufbauProofFitch(
  block: DirectiveBlock,
  context: ExerciseCompileContext,
): Promise<CompiledExercise | null> {
  const { diagnostics, renderOptions, resolveSystem } = context;
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
  const playground = parsePlaygroundAttribute(block, diagnostics);
  const allowSorry = parseAllowSorryAttribute(block, diagnostics);
  const header = playground ? null : parseTheoremHeader(block, diagnostics);
  const playgroundBody = playground
    ? parsePlaygroundBody(block, diagnostics)
    : null;

  if (id !== null) {
    validateExerciseId(block, id, diagnostics);
  }

  // The goal header must be followed by a '----' underline; the starter Fitch
  // proof (which may be empty) is everything after it. A playground has no
  // header, and its underline is optional.
  const starter =
    header !== null
      ? requireStarterBody(block, header, diagnostics)
      : (playgroundBody?.starter ?? null);

  if (header !== null && starter === null) {
    return null;
  }

  if (
    id === null ||
    theory === undefined ||
    notations === null ||
    (header === null && playgroundBody === null)
  ) {
    return null;
  }

  const { assumptionRule, contextSymbol, sequentSymbol } = notations;
  const promptLines =
    header?.promptLines ?? playgroundBody?.promptLines ?? [];
  /** What the starter is read against: the goal, or a playground's absence of one. */
  const scope = header ?? PLAYGROUND_HEADER;
  let goal: { readonly goalEngineDecl?: string } = {};

  if (header !== null) {
    const goalLine = block.bodyStartLine + header.headerIndex;

    // The goal's binders shadow the theory's own lexicon for the length of the
    // exercise (#253), which is how a rule schema is written and also how a
    // letter quietly stops meaning what the author thinks. Warnings, so the
    // author decides.
    diagnostics.push(...goalBinderWarnings(theory, header, goalLine));

    // The goal is read the way the lines are (`goalEngineDeclaration`): the
    // engine is handed what it can parse, and what it cannot is the author's
    // to hear about here rather than the widget's to refuse.
    const read = readGoalDeclaration(theory, header, goalLine, diagnostics);

    if (read === null) {
      return null;
    }

    goal = read;
  }

  // The starter is the text the editor opens with, so a line the theory's
  // language refuses is a proof the student is handed already broken. Read it
  // through the translator rather than line by line here, so the author's
  // diagnostic and the student's squiggle come from one walk of the source.
  if (starter !== null && starter.starterBody.length > 0) {
    const translated = fitchToAuf(
      starter.starterBody,
      scope.goalName,
      assumptionRule,
      sequentSymbol,
      contextSymbol,
      starterFormulaReader(theory, scope, "sentence"),
      ruleCitationShapes(theoryLanguageSource(theory, scope.theoremDecl)),
      starterRuleReader(theory, scope),
    );

    for (const problem of translated.formulaProblems) {
      diagnostics.push(
        unreadableStarterFormula(
          starterLine(block, starter, problem.sourceLine),
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
    ...(header === null
      ? { playground: true }
      : { goalDecl: header.theoremDecl }),
    ...(allowSorry ? { allowSorry: true } : {}),
    goalName: scope.goalName,
    options,
    promptHtml: await renderMarkdownSource(promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    sequentSymbol,
    starterBody: starter?.starterBody ?? "",
    system: theory.name,
  };

  return buildCompiledExercise({
    answerKind: AUFBAU_PROOF_FITCH_ANSWER_KIND,
    capabilities: AUFBAU_PROOF_FITCH_CAPABILITIES,
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
