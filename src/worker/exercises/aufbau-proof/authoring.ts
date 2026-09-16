import {
  parseSpec,
  SurfaceLanguage,
  stripSyntaxAnnotations,
} from "@aufbau/syntax";
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
import { libraryDiagnostic, lineAt } from "../../application/content/mm0";
import { readLanguage } from "../../logic/specs";
import type { SpecFormulaError } from "../../logic/specs/diagnostics";
import { roleIndex } from "../../logic/specs/roles";
import type { TheoryResolver } from "../../logic/theories";
import {
  BUILT_IN_THEORY_PATHS,
  theoryByPath,
  theorySourceByFileName,
} from "../../logic/theories";
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
import { PLAYGROUND_GOAL_NAME } from "./playground";
import type {
  AufbauProofOptions,
  CompiledAufbauProofPublicData,
} from "./types";
import {
  AUFBAU_PROOF_ANSWER_KIND,
  AUFBAU_PROOF_COMPONENT_METADATA,
  AUFBAU_PROOF_KIND,
  AUFBAU_PROOF_SCHEMA_VERSION,
} from "./types";

/**
 * A theory name and the MM0 text an `:::aufbau-mm0` block declares.
 *
 * The two texts differ by the `@syntax` annotations, and which one a caller
 * wants is not a detail. `mm0` is engine input — what a goal declaration is
 * appended to and what a certificate is verified against — and the engine
 * rejects an annotation that is not its own. `source` is the artifact as
 * written and as the route serves it, which is what the `show` panel puts in
 * front of a reader: a file that is also a course's *language* says so in
 * those annotations, and hiding them would show a reader half of it.
 */
export interface AufbauTheory {
  readonly mm0: string;
  readonly name: string;
  /**
   * What the theory says about itself that a Fitch or Prawitz proof needs in
   * order to write its lines — see {@link DeclaredNotations} — or `null` when
   * the theory could not be read as a spec at all, which the `:::aufbau-mm0`
   * block reports for itself.
   */
  readonly notations: DeclaredNotations | null;
  /** Whether the author asked (`show`) for the source to appear in the lesson. */
  readonly show: boolean;
  readonly source: string;
}

/**
 * The parts of a calculus a proof editor has to know by role, each `null`
 * where the theory does not say: `@syntax role assumption` on the axiom
 * that opens a hypothesis, `role turnstile` and `role context-join` on the
 * constructors of a sequent.
 *
 * These are facts about the calculus, not about any exercise set in it. The
 * proof types write sequents in the theory's own notation and tell an
 * assumption line from a rule line by its axiom; there is exactly one right
 * answer to each per theory, so the theory gives it and no exercise repeats
 * it. A theory that is also a course's language cannot spell a sequent the
 * house way in any case — forallx's comma is the student's argument
 * separator, so its context join is `;` — which is why these were never
 * safe to assume.
 */
export interface DeclaredNotations {
  readonly assumptionRule: string | null;
  readonly contextSymbol: string | null;
  /**
   * Every spelling of the turnstile, `sequentSymbol` first: a starter is
   * recognized in any of them and written back in the canonical one.
   */
  readonly sequentSpellings: readonly string[];
  readonly sequentSymbol: string | null;
}

/** What a proof type asks a theory for, once every role has answered. */
export interface ProofNotations {
  readonly assumptionRule: string;
  readonly contextSymbol: string;
  readonly sequentSpellings: readonly string[];
  readonly sequentSymbol: string;
}

/**
 * The notations a theory names for itself, or `null` when it cannot be read
 * as a spec.
 *
 * Reading the theory as a *spec* is what makes the roles visible, and an
 * author's extension can make that reading fail in ways that have nothing to
 * do with the question being asked — a name the delimiters split, an
 * annotation we do not know. That failure is the block's own diagnostic
 * ({@link reportUnreadableTheory}), so here it is only `null`, and the proof
 * types stay quiet rather than add three "declares no role" complaints to a
 * theory that declares nothing legible.
 */
function declaredNotations(source: string): DeclaredNotations | null {
  try {
    const index = roleIndex(new SurfaceLanguage(parseSpec(source).spec));

    return {
      assumptionRule: index.ruleFor("assumption"),
      contextSymbol: index.spellingFor("context-join"),
      sequentSpellings: index.spellingsFor("turnstile"),
      sequentSymbol: index.spellingFor("turnstile"),
    };
  } catch {
    return null;
  }
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
  readonly starterBody: string;
  /** Index of the underline within `block.bodyLines`, or `null` without one. */
  readonly underlineIndex: number | null;
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
    return { promptLines: lines, starterBody: "", underlineIndex: null };
  }

  return {
    promptLines: lines.slice(0, underlineIndex),
    starterBody: lines
      .slice(underlineIndex + 1)
      .join("\n")
      .trim(),
    underlineIndex,
  };
}

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

/**
 * What `:::aufbau-mm0{…}` accepts. None of the exercise attributes: a theory
 * block declares shared MM0, it is not answered, scored, or fed back.
 */
const AUFBAU_MM0_ATTRIBUTES = ["name", "show", "src"] as const;

/** A `src` that is anything but a path on this site: a scheme, or `//host`. */
const ELSEWHERE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * The theory a `src=` names, or null with a diagnostic saying which kind of
 * miss it was — the two are worth telling apart, because one is a typo and the
 * other is a feature that does not exist yet.
 *
 * **Built-ins first, and without asking anyone.** A shipped theory resolves
 * from the module graph rather than by fetching the path it names. The bytes
 * are the same either way (`tests/theories.test.ts` holds the route and this
 * resolver to each other), and answering locally is what lets a theory resolve
 * identically here, in the browser preview, and in tests with no server
 * running. It also means the ordinary lesson never touches `resolve`, whose
 * absence is therefore not a failure — it is what a caller with nothing to
 * offer beyond the built-ins passes.
 *
 * A path this site serves out of the *database* is the second backing:
 * `resolve` is how a caller that can read one answers. The third branch, a URL
 * on somebody else's server, is still refused above.
 */
async function resolveTheorySrc(
  src: string,
  line: number,
  diagnostics: CompilerDiagnostic[],
  resolve: TheoryResolver | undefined,
): Promise<string | null> {
  if (ELSEWHERE.test(src)) {
    diagnostics.push(
      diagnostic(
        line,
        "remote_theory_src",
        "“{path}” is not a path this site serves. A theory kept somewhere else is not supported yet.",
        { params: { path: src } },
      ),
    );

    return null;
  }

  const found = theoryByPath(src) ?? (await resolve?.(src)) ?? null;

  if (found === null) {
    diagnostics.push(
      diagnostic(
        line,
        "unknown_theory_src",
        "No theory is served at “{path}”. This site ships: {available}. A theory of your own is at the address on its revision page.",
        {
          params: {
            available: BUILT_IN_THEORY_PATHS.join(", "),
            path: src,
          },
        },
      ),
    );
  }

  return found;
}

/**
 * Compile an `:::aufbau-mm0` theory block. Not an exercise — the top-level
 * compiler handles it inline (like `:::style`), collecting the theory by name so
 * `:::aufbau-proof` blocks can reference it. Declaring a theory does not put it
 * on the page: MM0 source is machinery, and a lesson that teaches from a
 * textbook's rules rarely wants a slab of it above every exercise. `show` asks
 * for the read-only panel.
 *
 * The block's MM0 is a `src=` naming a theory this site serves, a body written
 * inline, or **both** — in which case the body extends the named theory. That
 * is what a course with its own vocabulary needs: the shipped forallx signature
 * is one binary predicate and two unary ones, and without extension the only
 * way to add `Cube` or `Loves` would be to paste all three hundred lines back
 * into the lesson. Appending is how the goal declaration already composes with
 * a theory further down this file, so nothing new is being invented — the
 * author's lines simply arrive last, and the engine reads the result as one
 * theory.
 *
 * The result is stripped of `@syntax` annotations, because what comes back is
 * engine input and `@syntax` is not the engine's — it rejects an annotation it
 * does not know. A built-in theory carries them when it is also the *language*
 * a course teaches (forallx: Calgary is one file for both), and an author is
 * free to write them in an extension for the same reason; either way they are
 * read by `@aufbau/syntax` from the artifact and never reach the compiler.
 *
 * An extension that adds a *name* has one thing to know, and
 * {@link reportUnreadableTheory} is what tells them: whether `Cube` can be
 * written at all is decided by the delimiters, not by the declaration. Against
 * forallx, whose 52 lexicon letters are all delimiters so that `AxF(x)` reads
 * tight, it cannot be — until the extension declares it whole with its own
 * `--| @syntax delimiter $ Cube $`.
 */
export async function compileAufbauMm0(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
  resolve?: TheoryResolver,
): Promise<AufbauTheory | null> {
  validateAttributes(block, AUFBAU_MM0_ATTRIBUTES, diagnostics);

  const name = requireAttribute(block, "name", diagnostics);
  const show = parseBooleanAttribute(
    block.attrs.show,
    block.line,
    "show",
    diagnostics,
  );

  const src = block.attrs.src;
  const extension = block.bodyLines.join("\n").trim();
  const base =
    src === undefined
      ? null
      : await resolveTheorySrc(src, block.line, diagnostics, resolve);

  if (src === undefined && extension.length === 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        "empty_theory",
        "An aufbau-mm0 block needs MM0 source in its body, or a src naming a theory this site serves.",
      ),
    );
  }

  // A `src` that did not resolve is not the same as no `src`: compiling the
  // extension on its own would hand the engine a theory missing everything the
  // author expected to build on, and bury the real diagnostic under whatever it
  // said about the fragment.
  if (name === null || (src !== undefined && base === null)) {
    return null;
  }

  const source =
    base === null
      ? extension
      : extension.length === 0
        ? base
        : `${base}\n${extension}`;

  if (source.length === 0) {
    return null;
  }

  reportUnreadableTheory(block, base, source, diagnostics);

  return {
    mm0: stripSyntaxAnnotations(source),
    name,
    notations: declaredNotations(source),
    show,
    source,
  };
}

/**
 * Report a block whose MM0 will not read as a language, at a line its author
 * can act on.
 *
 * The complaint used to surface one level away: an exercise set in the block
 * said only that the system "does not read as a language", while the library
 * had said which name the delimiters split, and where. Declaring an ordinary
 * `term Cube (sq: seq): wff;` against forallx is the case that costs — its
 * lexicon letters are all delimiters, so `Cube` segments as `C u b e` and no
 * student could ever type it — and the author was told none of that.
 *
 * Reading here is not a second read: the first exercise naming this block does
 * the same one, and `readLanguage` memoizes on the text.
 *
 * **Errors only.** forallx: Calgary warns nine times over about its
 * engine-only tokens (`⊢`, `≐`, …) — correct reports about a file the author
 * did not write, and every block extending it would inherit the noise.
 *
 * The theory is still returned. A block that answered with nothing would send
 * every exercise naming it to `unknown_system`, which lists the systems in
 * scope and would not mention that this one is right here and broken.
 */
function reportUnreadableTheory(
  block: DirectiveBlock,
  base: string | null,
  source: string,
  diagnostics: CompilerDiagnostic[],
): void {
  const read = readLanguage(source);

  if (read.language !== null) {
    return;
  }

  // Where the author's own text starts in the composed source. A `src` is a
  // file they named rather than wrote, so anything wrong inside it is reported
  // at the block itself instead of at a line of theirs that does not exist.
  const bodyStart = base === null ? 0 : base.length + 1;
  const body = block.bodyLines.join("\n");
  const trimmed = body.length - body.trimStart().length;

  for (const one of read.errors) {
    diagnostics.push(
      libraryDiagnostic(
        one.span.start < bodyStart
          ? block.line
          : block.line + lineAt(body, one.span.start - bodyStart + trimmed),
        one,
      ),
    );
  }

  // A file that read as statements and still could not be assembled into a
  // parser: the library threw rather than reporting, so there are no spans and
  // the block's own line is the only honest place to say it.
  if (read.errors.length === 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        "unusable_mm0",
        "This MM0 does not read: {reason}",
        { params: { reason: read.thrown ?? "unknown" } },
      ),
    );
  }
}

/**
 * A shipped theory as a system, by the id an author writes in `system=` — which
 * is the file's stem, and so the tail of the address `src=` takes.
 *
 * The `show` is false because nobody asked: a global is named, not declared, so
 * there is no block for an author to have written `show` on. Reading a theory
 * this way is the same reading `:::aufbau-mm0` gives it, notations and all, so
 * an exercise cannot behave differently for having skipped the block.
 */
export function builtInSystem(id: string): AufbauTheory | null {
  const source = theorySourceByFileName(`${id}.mm0`);

  if (source === null) {
    return null;
  }

  return {
    mm0: stripSyntaxAnnotations(source),
    name: id,
    notations: declaredNotations(source),
    show: false,
    source,
  };
}

/**
 * How an exercise gets the system it names.
 *
 * Two namespaces, in one order: an `:::aufbau-mm0` block this document
 * declares, then an id the server ships. A document-local block wins, which is
 * what lets a course extend forallx and go on calling the result what it likes.
 *
 * The resolver reports its own miss, because only the caller that built it
 * knows *both* namespaces — a diagnostic written here could name the shipped
 * ids and would never mention that a block was looked for, which is exactly the
 * case a typo'd block name lands in. See `application/content/compiler.ts`.
 */
export type SystemResolver = (
  name: string,
  line: number,
  diagnostics: CompilerDiagnostic[],
) => AufbauTheory | null;

/**
 * The system an exercise's `system=` names, with both the missing attribute and
 * the unresolvable name already reported.
 *
 * Shared by all four proof types (and, through the same resolver, by the two
 * semantic ones), so that "which logic am I in" is asked one way everywhere.
 */
export function requireSystem(
  block: DirectiveBlock,
  resolve: SystemResolver,
  diagnostics: CompilerDiagnostic[],
): AufbauTheory | null {
  const name = requireAttribute(block, "system", diagnostics);

  return name === null ? null : resolve(name, block.line, diagnostics);
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
 * the goal declaration beside it, so the join (`exercises/systems.ts`) can hand
 * the widget and the grader `publicData.mm0` — the theory plus the declaration —
 * and the worker can verify a submitted MMB against it independently of
 * anything the student sends.
 */
export async function compileAufbauProof(
  block: DirectiveBlock,
  resolveSystem: SystemResolver,
  diagnostics: CompilerDiagnostic[],
  renderOptions: MarkdownRenderOptions,
): Promise<CompiledExercise | null> {
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
  // goal is whatever the submitted proof's last line says (`playground.ts`).
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
