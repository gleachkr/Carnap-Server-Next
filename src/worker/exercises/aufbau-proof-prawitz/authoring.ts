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
import { parsePrawitzStarter } from "./parse";
import type { PrawitzDiagnosticCode } from "./translate";
import { prawitzToAuf } from "./translate";
import type { AufbauProofPrawitzPublicData, PrawitzProofNode } from "./types";
import {
  AUFBAU_PROOF_PRAWITZ_ANSWER_KIND,
  AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA,
  AUFBAU_PROOF_PRAWITZ_KIND,
  AUFBAU_PROOF_PRAWITZ_SCHEMA_VERSION,
  DEFAULT_ASSUMPTION_RULE,
  DEFAULT_SEQUENT_SYMBOL,
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
  "assumption",
  "options",
  "sequent",
  "theory",
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
 * The `assumption=` attribute names the theory's assumption axiom (`ax` by
 * default) so the translator can tell assumption leaves from rule nodes and
 * emit every leaf through it; `sequent=` names the theory's turnstile notation
 * (`⊢` by default). Grading is identical to the sibling proof types: the
 * translated tree compiles to `.auf` in the browser, and the resulting MMB
 * certificate is verified against this frozen mm0.
 */
export async function compileAufbauProofPrawitz(
  block: DirectiveBlock,
  theories: ReadonlyMap<string, AufbauTheory>,
  diagnostics: CompilerDiagnostic[],
  renderOptions: MarkdownRenderOptions,
): Promise<CompiledExercise | null> {
  validateAttributes(block, AUFBAU_PROOF_PRAWITZ_ATTRIBUTES, diagnostics);

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
  const assumptionRule =
    block.attrs.assumption?.trim() || DEFAULT_ASSUMPTION_RULE;
  const sequentSymbol = block.attrs.sequent?.trim() || DEFAULT_SEQUENT_SYMBOL;
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

  // An optional `----` + starter body pre-populates the editor. A starter that
  // fails to parse — or whose discharge structure the translator rejects —
  // fails the compile with author feedback, not the student's error banner.
  let starterTree: PrawitzProofNode | undefined;
  const starter = extractStarterBody(block.bodyLines, header.headerIndex);
  if (starter !== null && starter.starterBody.length > 0) {
    const lineFor = (bodyLine: number | null | undefined): number =>
      block.bodyStartLine +
      (bodyLine === null || bodyLine === undefined
        ? starter.underlineIndex
        : starter.underlineIndex + 1 + bodyLine);

    const parsed = parsePrawitzStarter(
      starter.starterBody,
      assumptionRule,
      sequentSymbol,
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

    const structural = prawitzToAuf(
      parsed.tree,
      header.goalName,
      assumptionRule,
      sequentSymbol,
    ).diagnostics;
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
    starterTree = parsed.tree;
  }

  const publicData: AufbauProofPrawitzPublicData = {
    assumptionRule,
    goalFormula: header.goalFormula,
    goalName: header.goalName,
    mm0: `${theory.mm0}\n${header.theoremDecl}`,
    options,
    promptHtml: await renderMarkdownSource(header.promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    sequentSymbol,
    ...(starterTree === undefined ? {} : { starterTree }),
  };

  return buildCompiledExercise({
    answerKind: AUFBAU_PROOF_PRAWITZ_ANSWER_KIND,
    capabilities: {
      supportsAutomaticEvaluation: true,
      supportsManualReview: true,
    },
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
