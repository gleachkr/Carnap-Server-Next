/**
 * What the four proof directives share at authoring time: the goal header and
 * its declaration, the `----` starter (mandatory under the text-shaped types'
 * header, optional under the tree-shaped types'), the `playground` shape, the
 * `options=` flags, and the readers a starter is checked with — all over the
 * {@link AufbauTheory} the exercise's `system=` resolved to.
 *
 * Each shape's own starter parser stays with the type; this is the part every
 * one of them would otherwise repeat.
 */

import {
  type CompilerDiagnostic,
  diagnostic,
} from "../../application/content/diagnostics";
import type { SpecFormulaError } from "../../logic/specs/diagnostics";
import { type DirectiveBlock, parseBooleanAttribute } from "../authoring";
import type { AufbauTheory } from "../systems/theory";
import type {
  ProofFormulaReader,
  ProofFormulaShape,
  ProofRuleReader,
} from "./formulas";
import {
  goalBinderShadows,
  goalEngineDeclaration,
  proofFormulaReader,
  proofRuleReader,
  theoryLanguageSource,
} from "./formulas";
import type { AufbauProofOptions } from "./options";
import { PLAYGROUND_GOAL_NAME } from "./playground";

/** What a proof type asks a theory for, once every role has answered. */
export interface ProofNotations {
  readonly assumptionRule: string;
  readonly contextSymbol: string;
  readonly sequentSpellings: readonly string[];
  readonly sequentSymbol: string;
}

/** The roles a Fitch or Prawitz proof needs, in the order they are reported. */
const PROOF_NOTATION_ROLES: readonly (readonly [
  "assumptionRule" | "contextSymbol" | "sequentSymbol",
  string,
])[] = [
  ["assumptionRule", "assumption"],
  ["sequentSymbol", "turnstile"],
  ["contextSymbol", "context-join"],
];

/**
 * The notations a Fitch or Prawitz exercise writes its lines with, read off
 * the theory, or `null` with a diagnostic for each role the theory omits.
 *
 * Quiet when there is no theory (the `system=` check has spoken) or when the
 * theory could not be read as a spec (its block has). Otherwise every missing
 * role is reported, not just the first: an author adding the annotations to
 * a theory of their own should learn all three at once.
 */
export function requireProofNotations(
  block: DirectiveBlock,
  theory: AufbauTheory | undefined,
  diagnostics: CompilerDiagnostic[],
): ProofNotations | null {
  if (theory === undefined || theory.notations === null) {
    return null;
  }

  const found: Partial<
    Record<"assumptionRule" | "contextSymbol" | "sequentSymbol", string>
  > = {};

  for (const [key, role] of PROOF_NOTATION_ROLES) {
    const value = theory.notations[key];

    if (value === null) {
      diagnostics.push(
        diagnostic(
          block.line,
          "missing_system_role",
          "System “{system}” declares no “@syntax role {role}”, which a Fitch or Prawitz proof needs to write its lines. Put the annotation on the declaration that plays that part.",
          { params: { role, system: theory.name } },
        ),
      );
    } else {
      found[key] = value;
    }
  }

  const { assumptionRule, contextSymbol, sequentSymbol } = found;

  return assumptionRule === undefined ||
    contextSymbol === undefined ||
    sequentSymbol === undefined
    ? null
    : {
        assumptionRule,
        contextSymbol,
        sequentSpellings: theory.notations.sequentSpellings,
        sequentSymbol,
      };
}

/**
 * How this exercise's starter is read, given the theory it is set in and the
 * goal it proves.
 *
 * The same text and the same decision the widget will make later, taken from
 * {@link theoryLanguageSource} so the two cannot part company: an author who
 * writes a starter the language refuses learns it here, while compiling, and
 * not from a student who cannot get the widget to accept what it opened with.
 */
export function starterFormulaReader(
  theory: AufbauTheory,
  header: { readonly goalName: string; readonly theoremDecl: string },
  shape: ProofFormulaShape,
): ProofFormulaReader {
  return proofFormulaReader(
    theoryLanguageSource(theory, header.theoremDecl),
    shape,
    header.goalName,
  );
}

/**
 * The rule reader for a starter proof, over the same text the formula reader
 * reads, so the two share one parse of the theory.
 */
export function starterRuleReader(
  theory: AufbauTheory,
  header: { readonly theoremDecl: string },
): ProofRuleReader {
  return proofRuleReader(theoryLanguageSource(theory, header.theoremDecl));
}

/**
 * The goal declaration as the engine will be handed it, or `null` after
 * reporting every formula in it the theory's language refused.
 *
 * `{}` where the theory names no sort to read at: the declaration then goes
 * to the engine as written, and nothing is frozen beside it. Spread the
 * result into `publicData`, so that `goalEngineDecl` exists exactly when a
 * reading happened — which is what the join keys on.
 */
export function readGoalDeclaration(
  theory: AufbauTheory,
  header: TheoremHeader,
  line: number,
  diagnostics: CompilerDiagnostic[],
): { readonly goalEngineDecl?: string } | null {
  const reading = goalEngineDeclaration(
    theoryLanguageSource(theory, header.theoremDecl),
    header.goalName,
  );

  if (reading === null) {
    return {};
  }

  if (reading.ok) {
    return { goalEngineDecl: reading.declaration };
  }

  for (const problem of reading.problems) {
    diagnostics.push(
      diagnostic(
        line,
        "invalid_goal_formula",
        "Could not parse the goal's formula “{formula}”: {detail}",
        { params: { detail: problem.error, formula: problem.formula } },
      ),
    );
  }

  return null;
}

/**
 * Every goal binder that displaces a meaning the theory's language already
 * gave its name, as warnings on the goal declaration's own line.
 *
 * Warnings and not errors, deliberately. Shadowing is how a rule schema is
 * *written* — `theorem mp (a b: wff)` has to call its metavariables
 * something, and in a theory whose lexicon spends every letter there is
 * nothing left to call them — so refusing it would refuse the textbook. What
 * the compiler can honestly say is what the name meant before, which is the
 * half it knows and the author may not; whether that matters is the author's
 * call, and they are the only one who can make it.
 *
 * See {@link goalBinderShadows} for what counts: a binder that rebinds a name
 * to the same reading it already had displaces nothing and is not reported.
 */
export function goalBinderWarnings(
  theory: AufbauTheory,
  header: TheoremHeader,
  line: number,
): CompilerDiagnostic[] {
  const source = theoryLanguageSource(theory, header.theoremDecl);

  return goalBinderShadows(source, header.goalName).map((shadow) => {
    if (shadow.kind === "notation") {
      return diagnostic(
        line,
        "goal_binder_shadows_notation",
        "The goal binds “{name}” as {sort}, and this theory spells a notation the same way. That spelling will not parse inside this exercise.",
        {
          params: { name: shadow.name, sort: shadow.sort },
          severity: "warning",
        },
      );
    }

    if (shadow.kind === "term") {
      return diagnostic(
        line,
        "goal_binder_shadows_term",
        "The goal binds “{name}” as {sort}, and this theory declares a term of that name. Inside this exercise “{name}” is the binder, not the term.",
        {
          params: { name: shadow.name, sort: shadow.sort },
          severity: "warning",
        },
      );
    }

    return diagnostic(
      line,
      "goal_binder_shadows_variable",
      "The goal binds “{name}” as {sort}, and this theory reads “{name}” as a variable of sort {displacedSort}. Inside this exercise the binder wins.",
      {
        params: {
          displacedSort: shadow.displacedSort ?? "",
          name: shadow.name,
          sort: shadow.sort,
        },
        severity: "warning",
      },
    );
  });
}

/**
 * A starter formula the theory's language refused, said to its author.
 *
 * The same `invalid_formula` sentence a model or translation exercise reports
 * for the same reason, with the parser's own complaint quoted inside it — which
 * is why it goes through {@link diagnostic}'s params rather than being
 * flattened here: the revision editor resolves the inner message in the
 * viewer's language too.
 */
export function unreadableStarterFormula(
  line: number,
  formula: string,
  error: SpecFormulaError,
): CompilerDiagnostic {
  return diagnostic(
    line,
    "invalid_formula",
    "Could not parse formula “{formula}”: {detail}",
    { params: { detail: error, formula } },
  );
}

/** A `theorem <name>` header line and its structural parts. */
const THEOREM_HEADER = /^\s*theorem\s+([A-Za-z_][A-Za-z0-9_]*)\b/;
/** The underline separating the goal header from the starter proof body. */
export const UNDERLINE = /^\s*-{3,}\s*$/;

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

/** The goal header parsed out of a proof directive body, shared by all four
 * proof types. */
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
 * all four proof types.
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

/** A starter under its `----`: the text the editor opens with, and where
 *  the underline sits within `block.bodyLines`, for diagnostics. */
export interface StarterBody {
  readonly starterBody: string;
  readonly underlineIndex: number;
}

/**
 * Pull an *optional* starter body out of a directive: the lines after a `----`
 * underline that follows the goal header. Returns the body text and the index
 * of the underline within `bodyLines` (for diagnostics), or null when no
 * underline follows the header (the "build from scratch" case). Text between
 * the header and a missing underline is ignored.
 */
export function extractStarterBody(
  bodyLines: readonly string[],
  headerIndex: number,
): StarterBody | null {
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

/**
 * The starter of a text-shaped directive (linear, Fitch), whose underline is
 * mandatory: the first non-blank line after the goal header must be the
 * `----`, and the starter — which may be empty — is everything after it.
 * Null with a `missing_proof_underline` diagnostic otherwise.
 */
export function requireStarterBody(
  block: DirectiveBlock,
  header: TheoremHeader,
  diagnostics: CompilerDiagnostic[],
): StarterBody | null {
  const starter = extractStarterBody(block.bodyLines, header.headerIndex);

  if (starter === null) {
    diagnostics.push(
      diagnostic(
        block.bodyStartLine + header.headerIndex,
        "missing_proof_underline",
        "The goal header must be followed by a '----' underline, then the proof body.",
      ),
    );
  }

  return starter;
}

/**
 * The starter of a tree-shaped directive (tree, Prawitz), which may have none:
 * under the goal header's underline when the exercise has a goal, under a
 * playground's when it does not.
 */
export function optionalStarterBody(
  block: DirectiveBlock,
  header: TheoremHeader | null,
  playgroundBody: PlaygroundBody | null,
): StarterBody | null {
  return header !== null
    ? extractStarterBody(block.bodyLines, header.headerIndex)
    : (playgroundBody?.starter ?? null);
}

/**
 * The document line of a starter's `bodyLine` (zero-based, counted from the
 * line under the underline) — or the underline's own line for a problem that
 * names no line, which is one about the starter as a whole.
 */
export function starterLine(
  block: DirectiveBlock,
  starter: StarterBody,
  bodyLine: number | null | undefined,
): number {
  return (
    block.bodyStartLine +
    (bodyLine === null || bodyLine === undefined
      ? starter.underlineIndex
      : starter.underlineIndex + 1 + bodyLine)
  );
}

/**
 * Whether a goal header states its goal formula. The tree-shaped types draw
 * the goal as the root node, so a header whose last `$ … $` is empty gives
 * them nothing to draw; the text-shaped types hand the declaration to the
 * engine whole and do not ask. True with no header (a playground).
 */
export function requireGoalFormula(
  block: DirectiveBlock,
  header: TheoremHeader | null,
  diagnostics: CompilerDiagnostic[],
): boolean {
  if (header === null || header.goalFormula.length > 0) {
    return true;
  }

  diagnostics.push(
    diagnostic(
      block.line,
      "missing_goal_formula",
      "The goal header must state the goal formula inside '$ … $'.",
    ),
  );

  return false;
}

/**
 * The `playground` attribute: a proof exercise with no goal of its own, whose
 * statement is whatever its proof proves (see `playground.ts`). A bare
 * `{playground}` means true.
 */
export function parsePlaygroundAttribute(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): boolean {
  return parseBooleanAttribute(
    block.attrs.playground,
    block.line,
    "playground",
    diagnostics,
  );
}

/**
 * The `allow-sorry` attribute: whether a line may be admitted with the
 * engine's `sorry!` and shown as a warning rather than an error. It never
 * makes such a proof correct — the verifier refuses a certificate that admits
 * a line, and the widget sends none — it only changes what the student is
 * told, and whether the widget will let the proof leave (it will on an exam,
 * for nothing; otherwise it holds it back and says so). A bare `{allow-sorry}`
 * means true.
 *
 * Three of the four proof directives take it; the Prawitz one does not, and
 * says why in its widget's `gate`.
 */
export function parseAllowSorryAttribute(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): boolean {
  return parseBooleanAttribute(
    block.attrs["allow-sorry"],
    block.line,
    "allow-sorry",
    diagnostics,
  );
}

/**
 * The header a playground's starter is read against: the fixed goal name, and
 * no declaration — nothing is appended to the theory until the proof has a
 * last line. Shaped like {@link TheoremHeader} so the starter readers take it.
 */
export const PLAYGROUND_HEADER = {
  goalName: PLAYGROUND_GOAL_NAME,
  theoremDecl: "",
} as const;

/** A playground directive body: prose, then an optional `----` + starter. */
export interface PlaygroundBody {
  readonly promptLines: readonly string[];
  readonly starter: StarterBody | null;
}

/**
 * Split a *playground* directive body: the prompt is everything above the
 * first `----` underline, the starter everything below it; with no underline
 * the whole body is prompt. There is no `theorem` header to find, and one
 * present is refused rather than ignored: an author who wrote a goal and set
 * `playground` has said two things, and the exercise should not quietly be
 * the one they did not mean. (The converse holds too — a directive *without*
 * `playground` and without a header is still `missing_theorem_header`, so a
 * typo'd header never turns an exercise into a playground.)
 */
export function parsePlaygroundBody(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): PlaygroundBody | null {
  const lines = block.bodyLines;

  for (const [index, line] of lines.entries()) {
    if (THEOREM_HEADER.test(line)) {
      diagnostics.push(
        diagnostic(
          block.bodyStartLine + index,
          "playground_declares_goal",
          "A playground exercise takes its goal from the proof itself; remove the 'theorem …' header, or drop 'playground'.",
        ),
      );
      return null;
    }
  }

  const underlineIndex = lines.findIndex((line) => UNDERLINE.test(line));

  if (underlineIndex === -1) {
    return { promptLines: lines, starter: null };
  }

  return {
    promptLines: lines.slice(0, underlineIndex),
    starter: {
      starterBody: lines
        .slice(underlineIndex + 1)
        .join("\n")
        .trim(),
      underlineIndex,
    },
  };
}
