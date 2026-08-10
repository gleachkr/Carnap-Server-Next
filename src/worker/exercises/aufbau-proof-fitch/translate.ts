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
 *  - Contexts are sequents `Γ ⊢ φ` with a comma-separated ACUI context. Every
 *    line — assumption or derived — carries its **ambient** context: every
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
 *    `ax`'s `g , a ⊢ a` and `reit`), so a nested line may cite shallower lines
 *    and still state its conclusion in its own larger scope. Without slack the
 *    conclusion could only be the exact join of the cited contexts.
 *  - A ref `n` becomes `ln`; a range `a-b` becomes `lb` (the subproof's last
 *    line, whose context still carries the assumption being discharged).
 *  - Citations are checked for **accessibility**: a plain ref must lie on the
 *    citing line's open scope path, and a cited subproof's parent scope must be
 *    on that path. The engine would reject almost every violation anyway (the
 *    cited sequent's context no longer fits), but as an opaque unification
 *    error — and the one case it cannot reject (a closed subproof re-entered
 *    via a new assumption of the same formula) is sound yet still breaks the
 *    Fitch discipline, so the translator names it directly.
 *
 * Structural problems (bad dedent, unknown/misordered/inaccessible references,
 * a subproof citation whose ends don't bracket one subproof, a line with no
 * justification) are returned as diagnostics keyed to the source line; logical
 * errors come from the compiler and are attributed back through `lineSpans`.
 */

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
  /** Char-space map from each generated line back to its source line. */
  readonly lineSpans: readonly FitchLineSpan[];
  /** `${goalName}\n----\n${body}` — the full text handed to `compile`. */
  readonly proofText: string;
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
  const rule = tokens[0] ?? "";

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
): {
  diagnostics: FitchDiagnostic[];
  lines: ParsedLine[];
  rawLineCount: number;
  scopeAssumptions: ReadonlyMap<number, readonly string[]>;
} {
  const rawLines = fitchText.split("\n");
  const diagnostics: FitchDiagnostic[] = [];

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
      assumptionRule,
      diagnostics,
      index + 1,
    );

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
      formula: justification.formula,
      isAssumption: justification.isAssumption,
      openFrom,
      refs: justification.refs,
      rule: justification.rule,
      scopePath,
      sourceLine: line.sourceLine,
    });

    if (justification.isAssumption) {
      const ownScope = scopePath[scopePath.length - 1] ?? 0;
      scopeAssumptions.get(ownScope)?.push(justification.formula);
    } else {
      scopesWithDerived.add(scopeStack[scopeStack.length - 1] ?? 0);
    }
  }

  return {
    diagnostics,
    lines: parsed,
    rawLineCount: rawLines.length,
    scopeAssumptions,
  };
}

/**
 * Translate Fitch `fitchText` into `.auf` for `goalName`, treating a line that
 * cites `assumptionRule` with no earlier premises as an assumption, and writing
 * `sequentSymbol` as the turnstile of every emitted sequent (the theory's own
 * notation — not every theory spells it `⊢`). Returns the assembled proof text,
 * a source-line map for diagnostics, and any structural diagnostics
 * (best-effort `proofText` is still returned when they are present).
 */
export function fitchToAuf(
  fitchText: string,
  goalName: string,
  assumptionRule: string,
  sequentSymbol: string,
): TranslatedFitchProof {
  const {
    diagnostics,
    lines: parsed,
    scopeAssumptions,
  } = walkFitch(fitchText, assumptionRule);

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

    const contextText = formulas.length === 0 ? "_" : formulas.join(" , ");
    const refText = line.refs.map((ref) => `l${ref.label}`).join(", ");
    bodyLines.push(
      `l${index + 1}: $ ${contextText} ${sequentSymbol} ${line.formula} $ by ${line.rule} [${refText}]`,
    );
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

  return { diagnostics, lineSpans, proofText };
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
 * fresh assumption after a derived line splits a sibling box.
 */
export function fitchScopeGeometry(
  fitchText: string,
  assumptionRule: string,
): (FitchScopeLine | null)[] {
  const walk = walkFitch(fitchText, assumptionRule);
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
