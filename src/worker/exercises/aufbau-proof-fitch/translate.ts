/**
 * Translate a *Fitch-style* proof into the linear `.auf` proof text the Aufbau
 * compiler consumes. This is the crux of the Fitch exercise type: it is pure and
 * DOM-free so the client editor (which compiles the result) and the server tests
 * share it — the Fitch analogue of the tree type's `flattenProofTree`.
 *
 * The student writes one formula per line; leading whitespace marks subproof
 * nesting and a justification follows a colon: `<formula> :<rule> <ref> <ref>…`,
 * where a ref is a proof-step number `n` or a subproof range `a-b`. The
 * translator is theory-agnostic — it knows only the *assumption axiom* name (so
 * it can tell which lines introduce a context formula), the indentation scopes,
 * and the citations. It never reasons about the logic:
 *
 *  - Each non-blank line emits one `.auf` line, in order: step `k` → label `lk`.
 *  - Contexts are sequents `Γ ⊢ φ` over an ACUI context whose separator the
 *    theory names (`,` in most, `;` where the comma already separates a
 *    predicate's arguments — see `contextSymbol`). Every line — assumption or
 *    derived — carries its **ambient** context: every
 *    assumption of every scope on its open scope path. In a linear Fitch proof
 *    that is exactly the textbook accessibility set (a closed sibling box is
 *    off the path, so nothing from it can leak — the cross-branch pollution
 *    that pushed the Prawitz tree translator to dependency contexts cannot
 *    arise here). Discharge (`imp_intro`, …) falls out for free: a rule below
 *    a now-closed subproof no longer has that scope on its path, and the
 *    engine's own rule verifies the stripped sequent. `_` is emitted for the
 *    empty context.
 *  - Ambient contexts presume the house theory convention: every rule joins a
 *    **slack** context variable into its conclusion (implicit weakening, as in
 *    `ax`'s `ga ; ph ⊢ ph` and `reit`), so a nested line may cite shallower
 *    lines and still state its conclusion in its own larger scope. Without
 *    slack the conclusion could only be the exact join of the cited contexts.
 *  - A ref `n` becomes `ln`; a range `a-b` becomes `lb` (the subproof's last
 *    line, whose context still carries the assumption being discharged).
 *  - A rule that draws *several* premises from one subproof — Magnus's `¬I`,
 *    whose contradictory pair are two premises sharing one assumption — can be
 *    cited with a single range, the textbook's own shape: the range supplies
 *    the subproof's last k lines, one per premise. Which rules read that way
 *    is not this module's knowledge: the caller derives it from the rule
 *    signatures (see `citations.ts`) and passes it as `citationShapes`. The
 *    grouped lowering only engages when the citation has exactly one ref per
 *    *slot* and the rule has more premises than slots; a citation with one
 *    ref per premise keeps the plain lowering, so both spellings stay legal
 *    and unambiguous — the counts can only coincide when the two agree anyway.
 *  - Citations are checked for **accessibility**: a plain ref must lie on the
 *    citing line's open scope path, and a cited subproof's parent scope must be
 *    on that path. The engine would reject almost every violation anyway (the
 *    cited sequent's context no longer fits), but as an opaque unification
 *    error — and the one case it cannot reject (a closed subproof re-entered
 *    via a new assumption of the same formula) is sound yet still breaks the
 *    Fitch discipline, so the translator names it directly.
 *
 * The formulas themselves stay opaque to all of that, but they do not
 * necessarily reach the `.auf` as typed: `readFormula` reads each one in the
 * theory's own language and gives back the engine spelling, so a student may
 * write `Ax(F(x) -> G(x))` where the compiler needs `(∀ x ((F (x)) → (G (x))))`.
 * A theory that names no sentence sort passes them through untouched, which is
 * what every proof did before the reader existed. See
 * `aufbau-proof/formulas.ts` for the condition and what it is not.
 *
 * Rule names get the same treatment through `readRule`: a citation is
 * resolved to the name the engine declares (`∧I` to `and_intro`, where the
 * theory's `@syntax alias` says so) as the line is parsed, and everything
 * downstream — the assumption test, the citation-shape lookup, the emitted
 * `by` — sees the resolved name. The theory's assumption rule is read the
 * same way, so a line citing `AS` and one citing `ax` agree.
 *
 * Structural problems (bad dedent, unknown/misordered/inaccessible references,
 * a subproof citation whose ends don't bracket one subproof, a line with no
 * justification) are returned as diagnostics keyed to the source line; a
 * formula that will not read comes back in `formulaProblems`, worded by the
 * parser; logical errors come from the compiler and are attributed back
 * through `lineSpans`.
 */

import type { SpecFormulaError } from "../../logic/specs/diagnostics";
import type {
  ProofFormulaReader,
  ProofRuleReader,
  ProofVariable,
} from "../aufbau-proof/formulas";
import {
  ENGINE_RULE,
  ENGINE_TEXT,
  unionVariables,
} from "../aufbau-proof/formulas";
import type { ProofStatement } from "../aufbau-proof/playground";

/** The header that separates the goal name from the proof body in `.auf`. */
const HEADER_SEPARATOR = "\n----\n";

/** The structural problems this translator can report. */
export type FitchDiagnosticCode =
  | "bad_reference"
  | "inaccessible_reference"
  | "inconsistent_indentation"
  | "missing_justification"
  | "missing_rule"
  | "range_depth_mismatch"
  | "range_escapes_subproof"
  | "range_expected"
  | "range_tail_depth_mismatch"
  | "range_too_short"
  | "unknown_reference";

/**
 * A structural problem in the Fitch source, keyed to its source line.
 *
 * Structural, not prose: the code and its parameters say *what* is wrong, and
 * `FITCH_DIAGNOSTIC_MESSAGES` (with the widget's string map) says it in the
 * student's language. This module runs in the browser as well as the Worker, so
 * it must not reach a catalog — and a code is a stabler thing for a test to
 * assert on than a sentence someone may reword.
 */
export interface FitchDiagnostic {
  readonly code: FitchDiagnosticCode;
  /** Values the message interpolates, by `{name}`. */
  readonly params?: Readonly<Record<string, string>>;
  /** Zero-based index into the source `fitchText` split on newlines. */
  readonly sourceLine: number;
}

/**
 * A line whose formula would not read in the theory's language.
 *
 * Kept apart from {@link FitchDiagnostic} because it is a different kind of
 * complaint from a different author: a structural problem is this module's own
 * and travels as a code the widget's string map words, while this one is the
 * *parser's*, already worded as an English template plus its values, and it
 * carries an offset *inside* the formula so the caret lands on the character
 * that broke rather than on the line. A caller that gates compilation on
 * "nothing wrong" has to look at both lists.
 */
export interface FitchFormulaProblem {
  /** Character offset of the formula's first character within its source line. */
  readonly column: number;
  readonly error: SpecFormulaError;
  /** The text that would not read, for a caller with no source to slice. */
  readonly formula: string;
  /** Zero-based index into the source `fitchText` split on newlines. */
  readonly sourceLine: number;
}

/** Where a generated `.auf` line sits, and which source line produced it. */
export interface FitchLineSpan {
  /** Character offset of the line start within `proofText`. */
  readonly from: number;
  /** Zero-based index of the source Fitch line. */
  readonly sourceLine: number;
  /** Character offset of the line end (exclusive) within `proofText`. */
  readonly to: number;
}

export interface TranslatedFitchProof {
  readonly diagnostics: readonly FitchDiagnostic[];
  /** Lines whose formula the theory's language refused; empty where the proof
   *  is written in engine text and nothing reads it. */
  readonly formulaProblems: readonly FitchFormulaProblem[];
  /** Char-space map from each generated line back to its source line. */
  readonly lineSpans: readonly FitchLineSpan[];
  /** `${goalName}\n----\n${body}` — the full text handed to `compile`. */
  readonly proofText: string;
  /**
   * What the last line asserts — its ambient context and its formula, as the
   * last emitted `$ … $` — and the variables the readings saw in it; `null`
   * for a proof with no lines. What a playground exercise makes its goal.
   */
  readonly statement: ProofStatement | null;
}

/**
 * One citation ref of a rule, and which of the rule's premises it supplies.
 *
 * A `line` slot is an ordinary earlier step. A `range` slot is a subproof
 * citation `a-b`; its final lines map onto `premises` in order, so a slot with
 * one premise contributes the subproof's last line (the lowering every range
 * has always had) and a slot with k contributes the last k — Magnus's `¬I`,
 * where the contradictory pair are the two lines the box ends with. Premise
 * indices rather than positions, because nothing guarantees a group's members
 * sit next to each other in the rule's own premise order.
 */
export interface CitationSlot {
  readonly kind: "line" | "range";
  /** Rule premise indices this ref supplies, in the order the lines map on. */
  readonly premises: readonly number[];
}

/**
 * How one rule's citation names its premises — the information Carnap's
 * `indirectInference` table declared by hand, here *derived* from the rule's
 * own signature (see `citations.ts`) and handed to the translator, which
 * stays as theory-agnostic as ever: it applies the shape, it never infers it.
 */
export interface RuleCitationShape {
  /** How many premises the rule takes — the ref count of the plain spelling. */
  readonly premiseCount: number;
  /** One entry per citation ref, in premise order of each slot's first member. */
  readonly slots: readonly CitationSlot[];
}

interface Reference {
  /** The last step of the citation: `n` for a line, `b` for a range `a-b`. */
  readonly label: number;
  /** The first step of a range citation `a-b`, or `null` for a plain line ref. */
  readonly rangeStart: number | null;
}

interface ParsedLine {
  /** Absolute indentation columns of each enclosing subproof (top scope dropped),
   *  outermost first — where the client draws each scope-bar. */
  readonly columns: readonly number[];
  readonly formula: string;
  /** The variables the reading saw in `formula`; `null` where nothing read it. */
  readonly variables: readonly ProofVariable[] | null;
  readonly isAssumption: boolean;
  /** Index of the first freshly-opened bar in {@link columns}: a deeper indent or
   *  a sibling-subproof split. Bars at or past it get the assumption rule drawn
   *  under them and a seam above, so sibling subproofs read as separate boxes. */
  readonly openFrom: number;
  readonly refs: readonly Reference[];
  readonly rule: string;
  /** Scope ids from outermost to this line's own scope. */
  readonly scopePath: readonly number[];
  readonly sourceLine: number;
}

const REFERENCE = /^(\d+)(?:-(\d+))?$/;

/** The count of leading space/tab characters — the line's indentation width. */
function leadingWidth(line: string): number {
  const match = /^[ \t]*/.exec(line);
  return match === null ? 0 : match[0].length;
}

/**
 * Parse one proof line into its formula, justification, and citations. The
 * justification is introduced by the *last* colon on the line, so formulas whose
 * own notation uses a colon (e.g. a modal `w : a`) still split correctly. A line
 * with no colon, or a colon with no rule after it, is a structural error.
 */
function parseJustification(
  content: string,
  sourceLine: number,
  assumptionRule: string,
  diagnostics: FitchDiagnostic[],
  currentStep: number,
  readRule: ProofRuleReader,
): {
  formula: string;
  isAssumption: boolean;
  refs: Reference[];
  rule: string;
} {
  const colon = content.lastIndexOf(":");

  if (colon === -1) {
    diagnostics.push({
      code: "missing_justification",
      sourceLine,
    });
    return {
      formula: content.trim(),
      isAssumption: false,
      refs: [],
      rule: "",
    };
  }

  const formula = content.slice(0, colon).trim();
  const tokens = content
    .slice(colon + 1)
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  const rule = readRule(tokens[0] ?? "");

  if (rule.length === 0) {
    diagnostics.push({
      code: "missing_rule",
      sourceLine,
    });
  }

  const refs: Reference[] = [];
  for (const token of tokens.slice(1)) {
    const match = REFERENCE.exec(token);

    if (match === null) {
      diagnostics.push({
        code: "bad_reference",
        params: { token },
        sourceLine,
      });
      continue;
    }

    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);

    // Citations must point strictly earlier — the `.auf` grammar forbids
    // forward references, and a range must lie wholly before this step.
    if (start < 1 || start > end || end >= currentStep) {
      diagnostics.push({
        code: "unknown_reference",
        params: { token },
        sourceLine,
      });
      continue;
    }

    // A range cites the subproof's last line; a plain number cites that line.
    // Keep the range's first line too, so its shape can be checked against the
    // subproof it claims to name (see the range validation in `fitchToAuf`).
    refs.push({
      label: end,
      rangeStart: match[2] === undefined ? null : start,
    });
  }

  return {
    formula,
    isAssumption: rule.length > 0 && rule === assumptionRule,
    refs,
    rule,
  };
}

/**
 * Walk the Fitch source once, giving every non-blank line its scope path,
 * justification, and scope-bar geometry. This single walk is the shared source of
 * truth for {@link fitchToAuf} (which turns the scopes into sequent contexts) and
 * {@link fitchScopeGeometry} (which draws the bars), so the boxes the student sees
 * can never drift from the contexts the compiler actually checks.
 */
function walkFitch(
  fitchText: string,
  assumptionRule: string,
  readFormula: ProofFormulaReader,
  readRule: ProofRuleReader,
): {
  diagnostics: FitchDiagnostic[];
  formulaProblems: FitchFormulaProblem[];
  lines: ParsedLine[];
  rawLineCount: number;
  scopeAssumptions: ReadonlyMap<number, readonly string[]>;
  /** The variables each read formula holds, by its engine text. */
  variablesByFormula: ReadonlyMap<string, readonly ProofVariable[] | null>;
} {
  const rawLines = fitchText.split("\n");
  const diagnostics: FitchDiagnostic[] = [];
  const formulaProblems: FitchFormulaProblem[] = [];
  // Resolved once, so a configured alias and a cited canonical name (or the
  // other way about) meet as the same rule.
  const assumption = readRule(assumptionRule);

  // Only non-blank lines are proof steps; blanks neither number nor emit.
  const proofLines = rawLines
    .map((raw, sourceLine) => ({ raw, sourceLine }))
    .filter((line) => line.raw.trim().length > 0);

  // Strip the common leading indentation so the shallowest lines sit at depth 0
  // regardless of how the whole proof is indented in its host document.
  const minIndent = proofLines.reduce(
    (least, line) => Math.min(least, leadingWidth(line.raw)),
    Number.POSITIVE_INFINITY,
  );
  const baseIndent = Number.isFinite(minIndent) ? minIndent : 0;

  // Assign each line its scope path via an indentation stack seeded with the
  // depth-0 top scope (width 0, after the common-indent strip). A deeper indent
  // opens a fresh scope; a shallower one pops back to a matching level. Seeding
  // the top scope is what lets a proof *open* with an indented assumption (e.g.
  // `⊢ a → a`, whose only outer line is the final conclusion).
  const indentStack: number[] = [0];
  const scopeStack: number[] = [0];
  let nextScopeId = 1;
  const parsed: ParsedLine[] = [];
  const scopeAssumptions = new Map<number, string[]>([[0, []]]);
  const variablesByFormula = new Map<
    string,
    readonly ProofVariable[] | null
  >();
  // Scopes that have already emitted a derived (non-assumption) line. Used to
  // split sibling subproofs: a fresh assumption in a box that has derived
  // something begins a new box.
  const scopesWithDerived = new Set<number>();

  for (const [index, line] of proofLines.entries()) {
    const width = leadingWidth(line.raw) - baseIndent;
    const top = indentStack[indentStack.length - 1] ?? 0;
    const openedDeeper = width > top;

    if (openedDeeper) {
      indentStack.push(width);
      scopeStack.push(nextScopeId);
      scopeAssumptions.set(nextScopeId, []);
      nextScopeId += 1;
    } else if (width < top) {
      while (
        indentStack.length > 1 &&
        (indentStack[indentStack.length - 1] ?? 0) > width
      ) {
        indentStack.pop();
        scopeStack.pop();
      }

      if ((indentStack[indentStack.length - 1] ?? 0) !== width) {
        diagnostics.push({
          code: "inconsistent_indentation",
          sourceLine: line.sourceLine,
        });
        // Treat it as the level we popped to, so translation can continue.
        indentStack[indentStack.length - 1] = width;
      }
    }

    const content = line.raw.trim();
    const justification = parseJustification(
      content,
      line.sourceLine,
      assumption,
      diagnostics,
      index + 1,
      readRule,
    );

    // Surface text in, engine text out — and from here down the *engine*
    // spelling is the line's formula, so a context built from an assumption
    // and the conclusion that discharges it agree character for character
    // however either was typed. A formula that will not read is reported and
    // passed through untouched: the proof still assembles, the spans still
    // line up, and the compiler remains the authority on what it means.
    const reading = readFormula(justification.formula);
    const formula = reading.ok ? reading.text : justification.formula;

    if (!reading.ok) {
      const column = leadingWidth(line.raw);
      for (const error of reading.errors) {
        formulaProblems.push({
          column,
          error,
          formula: justification.formula,
          sourceLine: line.sourceLine,
        });
      }
    }

    // Sibling subproofs: inside a box (depth ≥ 1) that has already derived a
    // line, a new assumption at the same level opens a *new* box, so the two
    // subproofs of ∨-elimination / ↔-introduction each discharge only their own
    // assumption. At the top level, assumptions are shared premises; a run of
    // assumptions before any derivation stays one box (reiteration into a box).
    let siblingSplit = false;
    if (
      justification.isAssumption &&
      !openedDeeper &&
      scopeStack.length > 1 &&
      scopesWithDerived.has(scopeStack[scopeStack.length - 1] ?? 0)
    ) {
      scopeStack[scopeStack.length - 1] = nextScopeId;
      scopeAssumptions.set(nextScopeId, []);
      nextScopeId += 1;
      siblingSplit = true;
    }

    const scopePath = [...scopeStack];
    // Absolute indentation column of each enclosing subproof (top scope dropped),
    // and the index of the first bar this line freshly opens: a deeper indent or
    // a sibling split reopens the innermost bar (drawn with a seam + assumption
    // rule); every other line inherits all its bars from the line above.
    const columns = indentStack.slice(1).map((w) => w + baseIndent);
    const openFrom =
      openedDeeper || siblingSplit ? columns.length - 1 : columns.length;
    parsed.push({
      columns,
      formula,
      isAssumption: justification.isAssumption,
      variables: reading.ok ? (reading.variables ?? null) : null,
      openFrom,
      refs: justification.refs,
      rule: justification.rule,
      scopePath,
      sourceLine: line.sourceLine,
    });

    variablesByFormula.set(
      formula,
      reading.ok ? (reading.variables ?? null) : null,
    );

    if (justification.isAssumption) {
      const ownScope = scopePath[scopePath.length - 1] ?? 0;
      scopeAssumptions.get(ownScope)?.push(formula);
    } else {
      scopesWithDerived.add(scopeStack[scopeStack.length - 1] ?? 0);
    }
  }

  return {
    diagnostics,
    formulaProblems,
    lines: parsed,
    rawLineCount: rawLines.length,
    scopeAssumptions,
    variablesByFormula,
  };
}

/**
 * Lower one line's citations to `.auf` labels, in rule-premise order.
 *
 * The grouped lowering engages only when the rule's shape is known, the rule
 * has more premises than citation slots (some subproof supplies several), and
 * the student wrote exactly one ref per slot. Everything else — no shape, the
 * one-ref-per-premise spelling, a ref count that matches neither — takes the
 * plain lowering every proof has always had, so the two spellings coexist and
 * a malformed count stays the compiler's arity complaint, as before.
 *
 * A multi-premise slot's range must genuinely end with the lines it claims:
 * they have to exist after the assumption (`range_too_short`) and sit in the
 * cited box itself, not a nested or sibling one (`range_tail_depth_mismatch`).
 * On any complaint the lowering still emits best-effort labels; a diagnostic
 * already blocks compilation.
 */
function lowerReferences(
  line: ParsedLine,
  shape: RuleCitationShape | undefined,
  parsed: readonly ParsedLine[],
  diagnostics: FitchDiagnostic[],
): readonly number[] {
  const grouped =
    shape !== undefined &&
    shape.slots.length < shape.premiseCount &&
    line.refs.length === shape.slots.length;

  if (!grouped) {
    return line.refs.map((ref) => ref.label);
  }

  const byPremise: number[] = [];

  for (const [slotIndex, slot] of shape.slots.entries()) {
    const ref = line.refs[slotIndex];

    if (ref === undefined) {
      continue; // unreachable: the lengths were compared above
    }

    const count = slot.premises.length;

    if (count === 1) {
      byPremise[slot.premises[0] ?? 0] = ref.label;
      continue;
    }

    const fallback = () => {
      for (const premise of slot.premises) {
        byPremise[premise] = ref.label;
      }
    };

    if (ref.rangeStart === null) {
      diagnostics.push({
        code: "range_expected",
        params: { token: `${ref.label}` },
        sourceLine: line.sourceLine,
      });
      fallback();
      continue;
    }

    // The k lines all come after the assumption that opens the subproof.
    if (ref.label - ref.rangeStart < count) {
      diagnostics.push({
        code: "range_too_short",
        params: { lines: `${count}` },
        sourceLine: line.sourceLine,
      });
      fallback();
      continue;
    }

    // …and in the cited box itself. Same *scope*, not merely same depth: a
    // sibling split re-boxes at the same indentation, and a pair straddling
    // the seam is two boxes' last lines, not one box's last two.
    const lastLine = parsed[ref.label - 1];
    const sameScope = (step: number): boolean => {
      const at = parsed[step - 1];
      return (
        at !== undefined &&
        lastLine !== undefined &&
        at.scopePath.length === lastLine.scopePath.length &&
        at.scopePath.every((scope, i) => lastLine.scopePath[i] === scope)
      );
    };

    for (let step = ref.label - count + 1; step < ref.label; step += 1) {
      if (!sameScope(step)) {
        diagnostics.push({
          code: "range_tail_depth_mismatch",
          params: { lines: `${count}` },
          sourceLine: line.sourceLine,
        });
        break;
      }
    }

    for (const [offset, premise] of slot.premises.entries()) {
      byPremise[premise] = ref.label - count + 1 + offset;
    }
  }

  // Sparse holes cannot arise from a well-formed shape; `filter` drops them
  // if a malformed one ever produces any, leaving the compiler to complain.
  return byPremise.filter((label) => label !== undefined);
}

/**
 * Translate Fitch `fitchText` into `.auf` for `goalName`, treating a line that
 * cites `assumptionRule` with no earlier premises as an assumption, and writing
 * `sequentSymbol` as the turnstile of every emitted sequent and
 * `contextSymbol` between the formulas of a context — both the theory's own
 * notations, since not every theory spells them `⊢` and `,`.
 *
 * The context separator defaults to `,` because that is what a theory whose
 * only sequence is the context spells it, which was every theory until one
 * file became both the proof system and the *language*: there the comma is
 * already the student's argument separator in `R(a,b)`, and MM0 gives a math
 * token one meaning, so the context takes `;` instead. See
 * `logic/theories/forallx-calgary-2019.mm0`.
 *
 * Returns the assembled proof text, a source-line map for diagnostics, and any
 * structural diagnostics (best-effort `proofText` is still returned when they
 * are present).
 */
export function fitchToAuf(
  fitchText: string,
  goalName: string,
  assumptionRule: string,
  sequentSymbol: string,
  contextSymbol = ",",
  readFormula: ProofFormulaReader = ENGINE_TEXT,
  citationShapes?: ReadonlyMap<string, RuleCitationShape>,
  readRule: ProofRuleReader = ENGINE_RULE,
): TranslatedFitchProof {
  const {
    diagnostics,
    formulaProblems,
    lines: parsed,
    scopeAssumptions,
    variablesByFormula,
  } = walkFitch(fitchText, assumptionRule, readFormula, readRule);

  // A subproof citation `a-b` must name one genuine subproof: line `a` (the
  // assumption that opens it) and line `b` (its last line) at the same
  // indentation, with nothing between them reaching back out to a shallower
  // level. Only the last line's label reaches the emitted `.auf`, so without
  // this a range that ends in a deeper (or shallower) scope than it opens would
  // still compile — the discharge just uses the last line's context.
  //
  // Citations are also checked for accessibility (the Fitch discipline): a
  // plain ref must be on the citing line's open scope path, and a range's
  // subproof must hang off a scope on that path. Scope ids are never reused,
  // so "still open here" is exactly "my scopePath starts with the cited
  // line's" — a later subproof that re-assumes the same formula gets a fresh
  // id and does not resurrect the closed one.
  const stepDepth = (step: number): number =>
    (parsed[step - 1]?.scopePath.length ?? 1) - 1;

  const onOpenPath = (
    cited: readonly number[],
    citing: readonly number[],
  ): boolean =>
    cited.length <= citing.length &&
    cited.every((scope, index) => citing[index] === scope);

  for (const line of parsed) {
    for (const ref of line.refs) {
      if (ref.rangeStart === null) {
        const cited = parsed[ref.label - 1];
        if (
          cited !== undefined &&
          !onOpenPath(cited.scopePath, line.scopePath)
        ) {
          diagnostics.push({
            code: "inaccessible_reference",
            params: { token: `${ref.label}` },
            sourceLine: line.sourceLine,
          });
        }
        continue;
      }
      const opener = parsed[ref.rangeStart - 1];
      if (
        opener !== undefined &&
        !onOpenPath(opener.scopePath.slice(0, -1), line.scopePath)
      ) {
        diagnostics.push({
          code: "inaccessible_reference",
          params: { token: `${ref.rangeStart}-${ref.label}` },
          sourceLine: line.sourceLine,
        });
      }
      if (stepDepth(ref.rangeStart) !== stepDepth(ref.label)) {
        diagnostics.push({
          code: "range_depth_mismatch",
          sourceLine: line.sourceLine,
        });
        continue;
      }
      const floor = stepDepth(ref.rangeStart);
      let escapes = false;
      for (let step = ref.rangeStart + 1; step < ref.label; step += 1) {
        if (stepDepth(step) < floor) {
          escapes = true;
          break;
        }
      }
      if (escapes) {
        diagnostics.push({
          code: "range_escapes_subproof",
          sourceLine: line.sourceLine,
        });
      }
    }
  }

  // Emit. Every line's context is its ambient scope path: the assumptions of
  // every scope still open at that line, outermost first. The theory's slack
  // context variables absorb whatever the cited lines' (smaller) contexts
  // don't cover, and discharge falls out when a closed scope leaves the path.
  const bodyLines: string[] = [];
  let statement: ProofStatement | null = null;

  for (const [index, line] of parsed.entries()) {
    const seen = new Set<string>();
    const formulas: string[] = [];
    for (const scope of line.scopePath) {
      for (const formula of scopeAssumptions.get(scope) ?? []) {
        if (!seen.has(formula)) {
          seen.add(formula);
          formulas.push(formula);
        }
      }
    }

    const contextText =
      formulas.length === 0 ? "_" : formulas.join(` ${contextSymbol} `);
    const refText = lowerReferences(
      line,
      citationShapes?.get(line.rule),
      parsed,
      diagnostics,
    )
      .map((label) => `l${label}`)
      .join(", ");
    const sequent = `${contextText} ${sequentSymbol} ${line.formula}`;
    bodyLines.push(
      `l${index + 1}: $ ${sequent} $ by ${line.rule} [${refText}]`,
    );

    // The last line's sequent is the proof's statement, and its variables are
    // those of the formulas in it — the context's and its own. A formula
    // nothing read (engine text passed through) leaves the set unknown.
    if (index === parsed.length - 1) {
      statement = {
        text: sequent,
        variables: unionVariables(
          [...formulas, line.formula].map(
            (formula) => variablesByFormula.get(formula) ?? null,
          ),
        ),
      };
    }
  }

  const proofText = `${goalName}${HEADER_SEPARATOR}${bodyLines.join("\n")}`;
  const bodyStart = goalName.length + HEADER_SEPARATOR.length;
  const lineSpans: FitchLineSpan[] = [];
  let offset = bodyStart;
  for (const [index, body] of bodyLines.entries()) {
    lineSpans.push({
      from: offset,
      sourceLine: parsed[index]?.sourceLine ?? 0,
      to: offset + body.length,
    });
    // + 1 for the newline joining this line to the next.
    offset += body.length + 1;
  }

  return { diagnostics, formulaProblems, lineSpans, proofText, statement };
}

/**
 * The subproof depth (0 = top level) of every raw line, or `null` for a blank
 * line. The client editor uses this to draw the Fitch scope-lines; it walks the
 * same indentation stack as {@link fitchToAuf} (after the same common-indent
 * strip) so the bars line up exactly with the sequent contexts.
 */
export function fitchLineDepths(fitchText: string): (number | null)[] {
  const rawLines = fitchText.split("\n");
  const minIndent = rawLines.reduce(
    (least, raw) =>
      raw.trim().length === 0 ? least : Math.min(least, leadingWidth(raw)),
    Number.POSITIVE_INFINITY,
  );
  const baseIndent = Number.isFinite(minIndent) ? minIndent : 0;
  const indentStack: number[] = [0];

  return rawLines.map((raw) => {
    if (raw.trim().length === 0) {
      return null;
    }

    const width = leadingWidth(raw) - baseIndent;
    const top = indentStack[indentStack.length - 1] ?? 0;

    if (width > top) {
      indentStack.push(width);
    } else if (width < top) {
      while (
        indentStack.length > 1 &&
        (indentStack[indentStack.length - 1] ?? 0) > width
      ) {
        indentStack.pop();
      }
      if ((indentStack[indentStack.length - 1] ?? 0) !== width) {
        indentStack[indentStack.length - 1] = width;
      }
    }

    return indentStack.length - 1;
  });
}

/** One line's scope-bar geometry: the absolute indentation columns of its
 * enclosing subproofs (outermost first) and the index of the first freshly-opened
 * bar (see {@link ParsedLine.openFrom}). */
export interface FitchScopeLine {
  readonly columns: readonly number[];
  readonly openFrom: number;
}

/**
 * The scope-bar geometry for every raw line — `null` for a blank line, otherwise
 * the enclosing subproofs' indentation {@link FitchScopeLine columns} (common
 * indent included, so the client draws each bar *inside* the whitespace the
 * student typed) and the first freshly-opened bar. Shares {@link walkFitch} with
 * {@link fitchToAuf}, so the drawn boxes match the sequent contexts exactly: two
 * *sibling* subproofs at one indentation (∨-elimination, ↔-introduction) report a
 * reopened innermost bar on the second box, which the client draws with a seam so
 * the two boxes read apart rather than as one continuous bar.
 *
 * Needs the `assumptionRule` to tell assumption lines from derived ones — only a
 * fresh assumption after a derived line splits a sibling box — and `readRule`
 * to recognize it under whatever alias a line cited it by.
 */
export function fitchScopeGeometry(
  fitchText: string,
  assumptionRule: string,
  readRule: ProofRuleReader = ENGINE_RULE,
): (FitchScopeLine | null)[] {
  const walk = walkFitch(fitchText, assumptionRule, ENGINE_TEXT, readRule);
  const geometry: (FitchScopeLine | null)[] = Array.from(
    { length: walk.rawLineCount },
    () => null,
  );
  for (const line of walk.lines) {
    geometry[line.sourceLine] = {
      columns: line.columns,
      openFrom: line.openFrom,
    };
  }
  return geometry;
}
