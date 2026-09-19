import { diagnosticFrom } from "../../application/content/diagnostics";
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
  optionalStarterBody,
  PLAYGROUND_HEADER,
  parseAllowSorryAttribute,
  parsePlaygroundAttribute,
  parsePlaygroundBody,
  parseProofOptions,
  parseTheoremHeader,
  readGoalDeclaration,
  requireGoalFormula,
  starterFormulaReader,
  starterLine,
  starterRuleReader,
  unreadableStarterFormula,
} from "../../exercise-kit/proof/authoring";
import { parseProofTree } from "../../exercise-kit/proof/tree-parse";
import { requireSystem } from "../../exercise-kit/systems/theory";
import type { ExerciseCompileContext } from "../../exercise-kit/type";
import { flattenProofTree } from "./flatten";
import type { AufbauProofTreePublicData, ProofTreeNode } from "./types";
import {
  AUFBAU_PROOF_TREE_ANSWER_KIND,
  AUFBAU_PROOF_TREE_CAPABILITIES,
  AUFBAU_PROOF_TREE_COMPONENT_METADATA,
  AUFBAU_PROOF_TREE_KIND,
  AUFBAU_PROOF_TREE_SCHEMA_VERSION,
} from "./types";

/** What `::::aufbau-proof-tree{…}` accepts beyond the shared exercise set. */
const AUFBAU_PROOF_TREE_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "allow-sorry",
  "options",
  "playground",
  "system",
] as const;

/**
 * Compile an `:::aufbau-proof-tree` exercise. Like `:::aufbau-proof` it resolves
 * a named theory and freezes `theory + goal declaration` into `publicData.mm0`
 * (the sole verification input). Its body is prose + a `theorem …` header, and —
 * optionally — a `----` underline followed by a starter proof written in the same
 * linear `.auf` form the tree flattens to. When present, that starter is parsed
 * back into a tree ({@link ./parse parseProofTree}) and the editor seeds from it
 * instead of a bare goal root; a starter that is a graph rather than a tree is
 * reported as malformed. Grading is identical to the linear type (a flattened
 * tree compiles to the same `.auf`, verified against this frozen mm0).
 *
 * With `playground`, the body has no goal line and the root is the student's
 * to write: nothing is frozen beside the theory, and the goal is whatever the
 * submitted tree's root says (`exercise-kit/proof/playground.ts`).
 */
export async function compileAufbauProofTree(
  block: DirectiveBlock,
  context: ExerciseCompileContext,
): Promise<CompiledExercise | null> {
  const { diagnostics, renderOptions, resolveSystem } = context;
  validateAttributes(block, AUFBAU_PROOF_TREE_ATTRIBUTES, diagnostics);

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
  const allowSorry = parseAllowSorryAttribute(block, diagnostics);
  const header = playground ? null : parseTheoremHeader(block, diagnostics);
  const playgroundBody = playground
    ? parsePlaygroundBody(block, diagnostics)
    : null;

  if (id !== null) {
    validateExerciseId(block, id, diagnostics);
  }

  const goalStated = requireGoalFormula(block, header, diagnostics);

  if (
    id === null ||
    theory === undefined ||
    (header === null && playgroundBody === null) ||
    !goalStated
  ) {
    return null;
  }

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

  // An optional `----` + `.auf` body pre-populates the tree. A body that parses
  // to a graph (or is otherwise malformed) fails the compile with author feedback.
  let starterTree: ProofTreeNode | undefined;
  const starter = optionalStarterBody(block, header, playgroundBody);
  if (starter !== null && starter.starterBody.length > 0) {
    const parsed = parseProofTree(starter.starterBody);
    if (parsed.ok) {
      // A node the theory's language refuses is a tree the student is handed
      // already broken. `flattenProofTree` is what the widget will run over
      // this same tree, so reading through it is what makes the author's
      // diagnostic and the student's squiggle the same judgement.
      const { formulaProblems } = flattenProofTree(
        parsed.tree,
        scope.goalName,
        starterFormulaReader(theory, scope, "sequent"),
        starterRuleReader(theory, scope),
      );

      for (const problem of formulaProblems) {
        diagnostics.push(
          unreadableStarterFormula(
            starterLine(
              block,
              starter,
              parsed.bodyLineByLabel.get(problem.nodeId),
            ),
            problem.formula,
            problem.error,
          ),
        );
      }

      if (formulaProblems.length > 0) {
        return null;
      }

      starterTree = parsed.tree;
    } else {
      diagnostics.push(
        diagnosticFrom(
          starterLine(block, starter, parsed.issue.bodyLine),
          parsed.issue.code,
          parsed.issue,
        ),
      );
      return null;
    }
  }

  const publicData: AufbauProofTreePublicData = {
    ...goal,
    ...(header === null
      ? { playground: true }
      : { goalDecl: header.theoremDecl }),
    ...(allowSorry ? { allowSorry: true } : {}),
    goalFormula: header?.goalFormula ?? "",
    goalName: scope.goalName,
    options,
    promptHtml: await renderMarkdownSource(promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    ...(starterTree === undefined ? {} : { starterTree }),
    system: theory.name,
  };

  return buildCompiledExercise({
    answerKind: AUFBAU_PROOF_TREE_ANSWER_KIND,
    capabilities: AUFBAU_PROOF_TREE_CAPABILITIES,
    exam,
    feedback,
    id,
    kind: AUFBAU_PROOF_TREE_KIND,
    nominalPoints: points,
    privateData: {},
    publicData,
    render: AUFBAU_PROOF_TREE_COMPONENT_METADATA,
    schemaVersion: AUFBAU_PROOF_TREE_SCHEMA_VERSION,
    title,
  });
}
