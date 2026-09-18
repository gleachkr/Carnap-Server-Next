import {
  type CompilerDiagnostic,
  diagnostic,
  diagnosticFrom,
} from "../../application/content/diagnostics";
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
  extractStarterBody,
  goalBinderWarnings,
  PLAYGROUND_HEADER,
  parsePlaygroundAttribute,
  parsePlaygroundBody,
  parseProofOptions,
  parseTheoremHeader,
  readGoalDeclaration,
  requireProofNotations,
  starterFormulaReader,
  starterRuleReader,
  unreadableStarterFormula,
} from "../../exercise-kit/proof/authoring";
import { requireSystem } from "../../exercise-kit/systems/theory";
import type { ExerciseCompileContext } from "../../exercise-kit/type";
import { parsePrawitzStarter } from "./parse";
import type { PrawitzDiagnosticCode } from "./translate";
import { prawitzToAuf } from "./translate";
import type { AufbauProofPrawitzPublicData, PrawitzProofNode } from "./types";
import {
  AUFBAU_PROOF_PRAWITZ_ANSWER_KIND,
  AUFBAU_PROOF_PRAWITZ_CAPABILITIES,
  AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA,
  AUFBAU_PROOF_PRAWITZ_KIND,
  AUFBAU_PROOF_PRAWITZ_SCHEMA_VERSION,
} from "./types";

/**
 * Word one of the translator's structural diagnostics for the author — `{line}`
 * is the starter line's label, filled from the node id (the parser keeps them
 * identical). A `switch` rather than a message map because `diagnostic()`
 * types each message's params from its placeholders.
 */
function starterStructuralDiagnostic(
  problem: {
    code: PrawitzDiagnosticCode;
    nodeId: string;
    params?: Readonly<Record<string, string>>;
  },
  line: number,
): CompilerDiagnostic {
  const label = problem.params?.label ?? "";
  switch (problem.code) {
    case "assumption_with_premises":
      return diagnostic(
        line,
        problem.code,
        "In the starter, assumption line “{line}” can't have premises.",
        { params: { line: problem.nodeId } },
      );
    case "discharge_formula_mismatch":
      return diagnostic(
        line,
        problem.code,
        "In the starter, the assumptions discharged by mark “{label}” on line “{line}” must share one formula.",
        { params: { label, line: problem.nodeId } },
      );
    case "discharge_without_leaf":
      return diagnostic(
        line,
        problem.code,
        "In the starter, the discharge mark “{label}” on line “{line}” doesn't match any assumption above it.",
        { params: { label, line: problem.nodeId } },
      );
  }
}

/** What `::::aufbau-proof-prawitz{…}` accepts beyond the shared exercise set. */
const AUFBAU_PROOF_PRAWITZ_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "options",
  "playground",
  "system",
] as const;

/**
 * Compile an `:::aufbau-proof-prawitz` exercise. Like its siblings it resolves
 * a named theory and freezes `theory + goal declaration` into `publicData.mm0`
 * (the sole verification input). Its body is prose + a `theorem …` header,
 * and — optionally — a `----` underline followed by starter lines in the tree
 * type's linear form, extended two ways: each line is a full sequent whose
 * context (left of the sequent symbol) is discarded — the labels re-derive
 * it — and discharge labels ride as trailing `-- label:n` comments
 * ({@link ./parse parsePrawitzStarter}). When
 * present, the starter seeds the editor instead of a blank canvas; its
 * structure is also run through the translator here so a discharge mark that
 * binds to nothing fails the compile rather than greeting the student as an
 * error.
 *
 * Which axiom an assumption leaf is emitted through, and how a sequent is
 * spelled — the turnstile (also stripped from pasted starter lines) and the
 * separator between a context's formulas — are read off the theory's
 * `@syntax role` annotations ({@link requireProofNotations}). Grading is
 * identical to the sibling proof types: the translated tree compiles to
 * `.auf` in the browser, and the resulting MMB certificate is verified
 * against this frozen mm0.
 *
 * With `playground`, the body has no goal line: nothing is frozen beside the
 * theory, and the goal is whatever the submitted tree's root says, dependency
 * context included (`exercise-kit/proof/playground.ts`).
 */
export async function compileAufbauProofPrawitz(
  block: DirectiveBlock,
  context: ExerciseCompileContext,
): Promise<CompiledExercise | null> {
  const { diagnostics, renderOptions, resolveSystem } = context;
  validateAttributes(block, AUFBAU_PROOF_PRAWITZ_ATTRIBUTES, diagnostics);

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
  const notations = requireProofNotations(block, theory, diagnostics);
  const title = block.attrs.title?.trim();
  const playground = parsePlaygroundAttribute(block, diagnostics);
  const header = playground ? null : parseTheoremHeader(block, diagnostics);
  const playgroundBody = playground
    ? parsePlaygroundBody(block, diagnostics)
    : null;

  if (id !== null) {
    validateExerciseId(block, id, diagnostics);
  }

  if (header !== null && header.goalFormula.length === 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        "missing_goal_formula",
        "The goal header must state the goal formula inside '$ … $'.",
      ),
    );
  }

  if (
    id === null ||
    theory === undefined ||
    notations === null ||
    (header === null && playgroundBody === null) ||
    (header !== null && header.goalFormula.length === 0)
  ) {
    return null;
  }

  const { assumptionRule, contextSymbol, sequentSpellings, sequentSymbol } =
    notations;
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

  // An optional `----` + starter body pre-populates the editor. A starter that
  // fails to parse — or whose discharge structure the translator rejects —
  // fails the compile with author feedback, not the student's error banner.
  let starterTree: PrawitzProofNode | undefined;
  const starter =
    header !== null
      ? extractStarterBody(block.bodyLines, header.headerIndex)
      : playgroundBody?.underlineIndex === null ||
          playgroundBody?.underlineIndex === undefined
        ? null
        : {
            starterBody: playgroundBody.starterBody,
            underlineIndex: playgroundBody.underlineIndex,
          };
  if (starter !== null && starter.starterBody.length > 0) {
    const lineFor = (bodyLine: number | null | undefined): number =>
      block.bodyStartLine +
      (bodyLine === null || bodyLine === undefined
        ? starter.underlineIndex
        : starter.underlineIndex + 1 + bodyLine);

    const readRule = starterRuleReader(theory, scope);
    const parsed = parsePrawitzStarter(
      starter.starterBody,
      assumptionRule,
      sequentSpellings,
      readRule,
    );
    if (!parsed.ok) {
      diagnostics.push(
        diagnosticFrom(
          lineFor(parsed.issue.bodyLine),
          parsed.issue.code,
          parsed.issue,
        ),
      );
      return null;
    }

    const translated = prawitzToAuf(
      parsed.tree,
      scope.goalName,
      assumptionRule,
      sequentSymbol,
      contextSymbol,
      starterFormulaReader(theory, scope, "sentence"),
      readRule,
    );

    // A node the theory's language refuses is a canvas the student is handed
    // already broken, so the author hears about it here rather than nobody
    // hearing about it until the widget refuses to compile.
    for (const problem of translated.formulaProblems) {
      diagnostics.push(
        unreadableStarterFormula(
          lineFor(parsed.bodyLineByLabel.get(problem.nodeId)),
          problem.formula,
          problem.error,
        ),
      );
    }

    const structural = translated.diagnostics;
    if (structural.length > 0) {
      for (const problem of structural) {
        diagnostics.push(
          starterStructuralDiagnostic(
            problem,
            lineFor(parsed.bodyLineByLabel.get(problem.nodeId)),
          ),
        );
      }
      return null;
    }

    if (translated.formulaProblems.length > 0) {
      return null;
    }
    starterTree = parsed.tree;
  }

  const publicData: AufbauProofPrawitzPublicData = {
    assumptionRule,
    contextSymbol,
    ...goal,
    ...(header === null
      ? { playground: true }
      : { goalDecl: header.theoremDecl }),
    goalFormula: header?.goalFormula ?? "",
    goalName: scope.goalName,
    options,
    promptHtml: await renderMarkdownSource(promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    sequentSymbol,
    ...(starterTree === undefined ? {} : { starterTree }),
    system: theory.name,
  };

  return buildCompiledExercise({
    answerKind: AUFBAU_PROOF_PRAWITZ_ANSWER_KIND,
    capabilities: AUFBAU_PROOF_PRAWITZ_CAPABILITIES,
    exam,
    feedback,
    id,
    kind: AUFBAU_PROOF_PRAWITZ_KIND,
    nominalPoints: points,
    privateData: {},
    publicData,
    render: AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA,
    schemaVersion: AUFBAU_PROOF_PRAWITZ_SCHEMA_VERSION,
    title,
  });
}
