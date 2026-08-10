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
  diagnosticFrom,
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
  extractStarterBody,
  parseProofOptions,
  parseTheoremHeader,
} from "../aufbau-proof/authoring";
import { parseProofTree } from "./parse";
import type { AufbauProofTreePublicData, ProofTreeNode } from "./types";
import {
  AUFBAU_PROOF_TREE_ANSWER_KIND,
  AUFBAU_PROOF_TREE_COMPONENT_METADATA,
  AUFBAU_PROOF_TREE_KIND,
  AUFBAU_PROOF_TREE_SCHEMA_VERSION,
} from "./types";

/** What `::::aufbau-proof-tree{…}` accepts beyond the shared exercise set. */
const AUFBAU_PROOF_TREE_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "options",
  "theory",
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
 */
export async function compileAufbauProofTree(
  block: DirectiveBlock,
  theories: ReadonlyMap<string, AufbauTheory>,
  diagnostics: CompilerDiagnostic[],
  renderOptions: MarkdownRenderOptions,
): Promise<CompiledExercise | null> {
  validateAttributes(block, AUFBAU_PROOF_TREE_ATTRIBUTES, diagnostics);

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
    header === null ||
    header.goalFormula.length === 0
  ) {
    return null;
  }

  // An optional `----` + `.auf` body pre-populates the tree. A body that parses
  // to a graph (or is otherwise malformed) fails the compile with author feedback.
  let starterTree: ProofTreeNode | undefined;
  const starter = extractStarterBody(block.bodyLines, header.headerIndex);
  if (starter !== null && starter.starterBody.length > 0) {
    const parsed = parseProofTree(starter.starterBody);
    if (parsed.ok) {
      starterTree = parsed.tree;
    } else {
      const offset =
        parsed.issue.bodyLine === null
          ? starter.underlineIndex
          : starter.underlineIndex + 1 + parsed.issue.bodyLine;
      diagnostics.push(
        diagnosticFrom(
          block.bodyStartLine + offset,
          parsed.issue.code,
          parsed.issue,
        ),
      );
      return null;
    }
  }

  const publicData: AufbauProofTreePublicData = {
    goalFormula: header.goalFormula,
    goalName: header.goalName,
    mm0: `${theory.mm0}\n${header.theoremDecl}`,
    options,
    promptHtml: await renderMarkdownSource(header.promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    ...(starterTree === undefined ? {} : { starterTree }),
  };

  return buildCompiledExercise({
    answerKind: AUFBAU_PROOF_TREE_ANSWER_KIND,
    capabilities: {
      supportsAutomaticEvaluation: true,
      supportsManualReview: true,
    },
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
