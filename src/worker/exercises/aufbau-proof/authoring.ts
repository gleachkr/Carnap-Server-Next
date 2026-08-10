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
  parseBooleanAttribute,
  parseExamAttribute,
  parseFeedbackAttribute,
  parsePoints,
  renderMarkdownSource,
  requireAttribute,
  validateAttributes,
  validateExerciseId,
} from "../../application/content/authoring-toolkit";
import type { AufbauProofOptions, AufbauProofPublicData } from "./types";
import {
  AUFBAU_PROOF_ANSWER_KIND,
  AUFBAU_PROOF_COMPONENT_METADATA,
  AUFBAU_PROOF_KIND,
  AUFBAU_PROOF_SCHEMA_VERSION,
} from "./types";

/** A theory name and the MM0 text an `:::aufbau-mm0` block declares. */
export interface AufbauTheory {
  readonly mm0: string;
  readonly name: string;
  /** Whether the author asked (`show`) for the source to appear in the lesson. */
  readonly show: boolean;
}

/** A `theorem <name>` header line and its structural parts. */
const THEOREM_HEADER = /^\s*theorem\s+([A-Za-z_][A-Za-z0-9_]*)\b/;
/** The underline separating the goal header from the starter proof body. */
const UNDERLINE = /^\s*-{3,}\s*$/;

/** The option flags an author may set on a proof directive's `options=`. */
const KNOWN_PROOF_OPTIONS: ReadonlySet<string> = new Set([
  "auto",
  "complete",
]);

export function parseProofOptions(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): AufbauProofOptions {
  const flags = new Set(
    (value ?? "").split(/\s+/).filter((flag) => flag.length > 0),
  );

  for (const flag of flags) {
    if (!KNOWN_PROOF_OPTIONS.has(flag)) {
      diagnostics.push(
        diagnostic(
          line,
          "unknown_proof_option",
          "Unknown proof option “{option}”. Supported options are 'auto' and 'complete'.",
          { params: { option: flag } },
        ),
      );
    }
  }

  return {
    allowAuto: flags.has("auto"),
    allowCompletion: flags.has("complete"),
  };
}

/** The goal header parsed out of a proof directive body, shared by both proof
 * types (linear and tree). */
export interface TheoremHeader {
  /** The goal's conclusion, the content of the last `$ … $` in the header. */
  readonly goalFormula: string;
  readonly goalName: string;
  /** Index of the header line within `block.bodyLines`. */
  readonly headerIndex: number;
  readonly promptLines: readonly string[];
  /** The MM0 theorem declaration, normalized to end with a single `;`. */
  readonly theoremDecl: string;
}

/**
 * Find the `theorem <name>: $ … $` goal header in a proof directive body and
 * split off the prose above it. The prompt is everything before the header; the
 * theorem declaration is the header line normalized to end with a single `;`;
 * `goalFormula` is the content of the header's last `$ … $` group (the
 * conclusion, since MM0 hypotheses precede it via `>`). Returns null (with a
 * `missing_theorem_header` diagnostic) when no header line is present. Shared by
 * the linear and tree proof types.
 */
export function parseTheoremHeader(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): TheoremHeader | null {
  const lines = block.bodyLines;
  let headerIndex = -1;
  let goalName = "";

  for (const [index, line] of lines.entries()) {
    const match = THEOREM_HEADER.exec(line);

    if (match !== null) {
      headerIndex = index;
      goalName = match[1] ?? "";
      break;
    }
  }

  if (headerIndex === -1) {
    diagnostics.push(
      diagnostic(
        block.line,
        "missing_theorem_header",
        "A proof exercise needs a 'theorem <name>: $ … $' line declaring the goal.",
      ),
    );
    return null;
  }

  const headerLine = (lines[headerIndex] ?? "").trim();
  const dollarGroups = [...headerLine.matchAll(/\$([^$]*)\$/g)];
  const goalFormula = (
    dollarGroups[dollarGroups.length - 1]?.[1] ?? ""
  ).trim();

  return {
    goalFormula,
    goalName,
    headerIndex,
    promptLines: lines.slice(0, headerIndex),
    theoremDecl: `${headerLine.replace(/;\s*$/, "")};`,
  };
}

/**
 * Pull an *optional* starter body out of a directive: the lines after a `----`
 * underline that follows the goal header. Returns the body text and the index
 * of the underline within `bodyLines` (for diagnostics), or null when no
 * underline follows the header (the "build from scratch" case). Text between
 * the header and a missing underline is ignored. The tree and Prawitz types
 * share this; the linear type's underline is mandatory (`parseProofBody`).
 */
export function extractStarterBody(
  bodyLines: readonly string[],
  headerIndex: number,
): { readonly starterBody: string; readonly underlineIndex: number } | null {
  for (let index = headerIndex + 1; index < bodyLines.length; index += 1) {
    const line = bodyLines[index] ?? "";
    if (line.trim().length === 0) {
      continue;
    }
    if (!UNDERLINE.test(line)) {
      return null;
    }
    return {
      starterBody: bodyLines
        .slice(index + 1)
        .join("\n")
        .trim(),
      underlineIndex: index,
    };
  }
  return null;
}

interface ProofBody {
  readonly goalName: string;
  /** The MM0 theorem declaration, normalized to end with a single `;`. */
  readonly theoremDecl: string;
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
  diagnostics: CompilerDiagnostic[],
): ProofBody | null {
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
    promptLines: header.promptLines,
    starterBody,
    theoremDecl: header.theoremDecl,
  };
}

/**
 * What `:::aufbau-mm0{…}` accepts. None of the exercise attributes: a theory
 * block declares shared MM0, it is not answered, scored, or fed back. `src` is
 * listed although it is refused below — the refusal says why, which "unknown
 * attribute" would not.
 */
const AUFBAU_MM0_ATTRIBUTES = ["name", "show", "src"] as const;

/**
 * Compile an `:::aufbau-mm0` theory block. Not an exercise — the top-level
 * compiler handles it inline (like `:::style`), collecting the theory by name so
 * `:::aufbau-proof` blocks can reference it. Declaring a theory does not put it
 * on the page: MM0 source is machinery, and a lesson that teaches from a
 * textbook's rules rarely wants a slab of it above every exercise. `show` asks
 * for the read-only panel. `src=` (a theory located elsewhere) is not supported
 * yet.
 */
export function compileAufbauMm0(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): AufbauTheory | null {
  validateAttributes(block, AUFBAU_MM0_ATTRIBUTES, diagnostics);

  const name = requireAttribute(block, "name", diagnostics);
  const show = parseBooleanAttribute(
    block.attrs.show,
    block.line,
    "show",
    diagnostics,
  );

  if (block.attrs.src !== undefined) {
    diagnostics.push(
      diagnostic(
        block.line,
        "unsupported_theory_src",
        "An aufbau-mm0 src attribute is not supported yet; write the MM0 inline.",
      ),
    );
  }

  const mm0 = block.bodyLines.join("\n").trim();

  if (mm0.length === 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        "empty_theory",
        "An aufbau-mm0 block needs MM0 source in its body.",
      ),
    );
  }

  if (name === null || mm0.length === 0) {
    return null;
  }

  return { mm0, name, show };
}

/** What `::::aufbau-proof{…}` accepts beyond the shared exercise set. */
const AUFBAU_PROOF_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "options",
  "theory",
] as const;

/**
 * Compile an `:::aufbau-proof` exercise. Freezes the referenced theory plus the
 * goal declaration into `publicData.mm0` so the worker can verify a submitted
 * MMB against it independently of anything the student sends.
 */
export async function compileAufbauProof(
  block: DirectiveBlock,
  theories: ReadonlyMap<string, AufbauTheory>,
  diagnostics: CompilerDiagnostic[],
  renderOptions: MarkdownRenderOptions,
): Promise<CompiledExercise | null> {
  validateAttributes(block, AUFBAU_PROOF_ATTRIBUTES, diagnostics);

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
  const body = parseProofBody(block, diagnostics);

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

  if (id === null || theory === undefined || body === null) {
    return null;
  }

  const publicData: AufbauProofPublicData = {
    goalName: body.goalName,
    mm0: `${theory.mm0}\n${body.theoremDecl}`,
    options,
    promptHtml: await renderMarkdownSource(body.promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    starterBody: body.starterBody,
  };

  return buildCompiledExercise({
    answerKind: AUFBAU_PROOF_ANSWER_KIND,
    capabilities: {
      supportsAutomaticEvaluation: true,
      supportsManualReview: true,
    },
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
