/**
 * `<carnap-aufbau-proof-fitch>` — the interactive Fitch-style proof editor.
 *
 * The server renders inert chrome into a Declarative Shadow Root (see the
 * worker-side `renderAufbauProofFitchElement`): the prompt and the starting
 * Fitch source, styled with no JS. On connect this element replaces the static
 * source with a CodeMirror editor that draws the subproof scope-lines, shows the
 * theorem to prove, and gives live feedback: as the student types (debounced) it
 * translates the Fitch text to linear `.auf` (`fitchToAuf`), compiles that
 * against the frozen theory with the lazily-loaded `@aufbau/compiler`, and
 * reports whether it verifies.
 *
 * The answer mirrored into the form's hidden `answerData` is `{ fitchText,
 * proofText, mmb }` — the MMB is the compiled certificate, and the worker
 * re-verifies it against the same frozen mm0 (the compiler here is an untrusted
 * convenience; the server-side verifier is the arbiter).
 *
 * Two diagnostic sources feed the same CodeMirror lint layer: `fitchToAuf`'s
 * structural problems (bad indentation, unknown references) map straight to the
 * offending source line, and the compiler's problems — reported as byte spans
 * into the generated `.auf` — are mapped back through the translator's
 * `lineSpans` to the Fitch line that produced them.
 */

import type { CompileResult } from "@aufbau/compiler";
import {
  defaultKeymap,
  deleteCharBackwardStrict,
  history,
  historyKeymap,
} from "@codemirror/commands";
import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import { EditorState, Facet, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  lineNumbers,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type {
  ProofFormulaReader,
  ProofRuleReader,
} from "../../worker/exercise-kit/proof/formulas";
import {
  ENGINE_RULE,
  ENGINE_TEXT,
  goalStatementText,
  hasTheoryText,
  proofFormulaReader,
  proofRuleReader,
  proofTheoryText,
} from "../../worker/exercise-kit/proof/formulas";
import type { PlaygroundGoal } from "../../worker/exercise-kit/proof/playground";
import {
  playgroundGoal,
  playgroundGoalText,
  playgroundTheoryText,
} from "../../worker/exercise-kit/proof/playground";
import { ruleCitationShapes } from "../../worker/exercises/aufbau-proof-fitch/citations";
import {
  type AufbauProofFitchStringId,
  FITCH_DIAGNOSTIC_MESSAGES,
} from "../../worker/exercises/aufbau-proof-fitch/strings";
import {
  fitchScopeGeometry,
  fitchToAuf,
  type RuleCitationShape,
} from "../../worker/exercises/aufbau-proof-fitch/translate";
import type { AufbauProofFitchPublicData } from "../../worker/exercises/aufbau-proof-fitch/types";
import {
  type CompileDiagnostic,
  loadProofCompiler,
  readCompileResult,
} from "../proof-compiler";
import { CarnapExerciseElement, register, withoutCertificate } from "./base";
import shadowStyles from "./carnap-aufbau-proof-fitch-v1.css" with {
  type: "text",
};
import goalStyles from "./proof-goal.css" with { type: "text" };

const DEBOUNCE_MS = 400;

/** Left gutter (CSS px) before the outermost scope-line; the bars themselves
 * sit at the student's own indentation columns, not at a fixed per-depth step. */
const SCOPE_BASE = 8;
/** How far (characters) a scope-line sits left of its subproof's content, so the
 * bar hugs the text regardless of how many spaces the student indents. */
const SCOPE_GAP_CHARS = 1;
const SCOPE_MAX_DEPTH = 8;
/** The assumption rule runs this many characters past the proof's widest line. */
const TICK_OVERHANG_CHARS = 3;

/**
 * Colour of the Fitch scope-lines: the exercise token for them, which defaults
 * to the editor's own text colour at a slight fade so the bars read as
 * structural ink, only slightly lighter than the formulas — not the faint
 * divider tone. An author's `:::style` sets `--exercise-scope-line`.
 */
const SCOPE_COLOR = "var(--_scope-line)";

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) {
    return 1;
  }
  if (codePoint < 0x800) {
    return 2;
  }
  if (codePoint < 0x10000) {
    return 3;
  }
  return 4;
}

/** Map a UTF-8 byte offset (as the compiler reports spans) to a JS string index. */
function byteToCharIndex(text: string, byteOffset: number): number {
  let bytes = 0;
  let index = 0;
  for (const char of text) {
    if (bytes >= byteOffset) {
      break;
    }
    bytes += utf8Length(char.codePointAt(0) ?? 0);
    index += char.length;
  }
  return index;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Whether the source has a problem of either kind, so nothing should compile. */
function unreadable(translation: ReturnType<typeof fitchToAuf>): boolean {
  return (
    translation.diagnostics.length > 0 ||
    translation.formulaProblems.length > 0
  );
}

function isFitchPublicData(
  value: unknown,
): value is AufbauProofFitchPublicData {
  return (
    typeof value === "object" &&
    value !== null &&
    hasTheoryText(value) &&
    typeof (value as { goalName?: unknown }).goalName === "string" &&
    typeof (value as { assumptionRule?: unknown }).assumptionRule === "string"
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * What to show the student as the goal, given the exercise's two theory texts.
 *
 * The statement the goal declares, with the theorem's name, its binders and
 * its `$ … $` taken off — the same thing the tree and Prawitz editors show,
 * and the same register as the surface text the student types below it. A
 * declaration is how a goal is *stored*, not how it is asked: `unimp {x: var}
 * {a: name}` names an engine handle that is not even the exercise id, and
 * binds a variable whose only job is to make `∀ x` legal.
 *
 * Whether the theory is a *language* does not come into it — that decides how
 * the formulas are read, not how the declaration around them splits. The
 * fallback is the declaration this row used to show, reached only when the
 * text declares no such goal at all, where showing the line as written beats
 * showing nothing.
 */
function goalText(
  theory: { readonly mm0: string; readonly source: string | null },
  goalName: string,
): string {
  return (
    goalStatementText(theory.source, goalName) ?? goalDeclaration(theory.mm0)
  );
}

/** The theorem declaration line, its keyword and trailing `;` taken off. */
function goalDeclaration(mm0: string): string {
  const lines = mm0.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trim();
    if (/^theorem\b/.test(line)) {
      return line.replace(/;\s*$/, "").replace(/^theorem\s+/, "");
    }
  }
  return "";
}

/** Code-point length — so a formula's astral glyphs count as one monospace cell. */
function cellWidth(text: string): number {
  return Array.from(text).length;
}

/** The x (px, from the line's left) of the bar for a subproof whose content sits
 * at indentation `column` — a small fixed gap left of that content. */
function columnX(column: number, charWidth: number): number {
  const gapped = Math.max(0, column - SCOPE_GAP_CHARS);
  return Math.round(SCOPE_BASE + gapped * charWidth);
}

/**
 * The inline `background` drawing one line's scope-lines as gradient layers: a
 * vertical bar a hair left of each enclosing subproof's content `column` — so the
 * bars hug the text and sit in the whitespace the student typed, adding no
 * indentation of their own — plus, for the bars this line freshly opens (index
 * `openFrom` and beyond), the horizontal assumption rule under each.
 *
 * A freshly-opened bar is drawn as `╷` (its lower half only) so the strut starts
 * below the assumption instead of butting against the line above; enclosing bars
 * run the full height so same-depth lines join into continuous struts. A *sibling*
 * subproof (∨E, ↔I) reopens the innermost bar at the same indentation, so its `╷`
 * leaves a seam above — the visible break between the two boxes. Each rule runs
 * from its bar to `tickRight` — a shared right edge a few characters past the
 * proof's widest line — meeting the strut below at a clean junction.
 */
function lineScopeStyle(
  columns: readonly number[],
  openFrom: number,
  tickRight: number,
  charWidth: number,
): string {
  const bars = columns.slice(0, SCOPE_MAX_DEPTH);
  const layers: string[] = [];
  const sizes: string[] = [];
  const positions: string[] = [];

  bars.forEach((column, index) => {
    const x = columnX(column, charWidth);
    layers.push(`linear-gradient(${SCOPE_COLOR} 0 0)`);
    if (index >= openFrom) {
      // Opened at this line: lower half only (`╷`), leaving a gap up top.
      sizes.push("1px 50%");
      positions.push(`${x}px 100%`);
    } else {
      sizes.push("1px 100%");
      positions.push(`${x}px 0`);
    }
  });

  for (let index = openFrom; index < bars.length; index += 1) {
    const x = columnX(bars[index] ?? 0, charWidth);
    const width = Math.max(0, Math.round(tickRight - x));
    layers.push(`linear-gradient(${SCOPE_COLOR} 0 0)`);
    sizes.push(`${width}px 1px`);
    positions.push(`${x}px 100%`);
  }

  return `padding-left:${SCOPE_BASE}px;background-image:${layers.join(",")};background-size:${sizes.join(",")};background-position:${positions.join(",")};background-repeat:no-repeat;`;
}

/**
 * Draw the Fitch scope-lines: each line gets one vertical bar per enclosing
 * subproof, drawn at the indentation {@link fitchScopeGeometry column} where that
 * subproof opened. Adjacent lines in the same scope stack their bars into
 * continuous struts — the "superimposed subproof lines". A line that *opens* a
 * subproof — a deeper indent, or a sibling box at the same indentation (∨E, ↔I) —
 * gets a seam above its innermost bar and the horizontal assumption rule under it,
 * so sibling subproofs read as separate boxes. The rules share a right edge {@link
 * TICK_OVERHANG_CHARS} characters past the widest line, measured from the editor's
 * monospace character width. The `openFrom` split point comes from the same walk
 * that assigns the sequent contexts (via the theory's assumption rule, read from
 * {@link assumptionRuleFacet}), so the boxes never disagree with the proof.
 * Recomputed on every edit and on geometry changes (font load); presentational.
 */
function buildScopeDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const assumptionRule = view.state.facet(assumptionRuleFacet);
  const readRule = view.state.facet(ruleReaderFacet);
  const geometryByLine = fitchScopeGeometry(
    doc.toString(),
    assumptionRule,
    readRule,
  );
  const charWidth = view.defaultCharacterWidth || 8;

  // The shared right edge of the assumption rules: a few characters past the
  // proof's widest rendered line.
  let widest = 0;
  for (const [index, line] of geometryByLine.entries()) {
    if (line === null || index + 1 > doc.lines) {
      continue;
    }
    const right =
      SCOPE_BASE + cellWidth(doc.line(index + 1).text) * charWidth;
    widest = Math.max(widest, right);
  }
  const tickRight = widest + TICK_OVERHANG_CHARS * charWidth;

  const builder = new RangeSetBuilder<Decoration>();
  for (const [index, line] of geometryByLine.entries()) {
    if (line === null) {
      // Blank line: no strut.
      continue;
    }
    if (line.columns.length > 0 && index + 1 <= doc.lines) {
      const docLine = doc.line(index + 1);
      builder.add(
        docLine.from,
        docLine.from,
        Decoration.line({
          attributes: {
            style: lineScopeStyle(
              line.columns,
              line.openFrom,
              tickRight,
              charWidth,
            ),
          },
        }),
      );
    }
  }
  return builder.finish();
}

/** The theory's assumption-axiom name, handed to the scope-bar ViewPlugin so it
 * can tell which lines open sibling subproofs (only assumptions split a box). */
const assumptionRuleFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? "ax",
});

/** The theory's rule reader, alongside: what each cited name resolves to, so a
 * line citing the assumption rule by alias still opens a box. */
const ruleReaderFacet = Facet.define<ProofRuleReader, ProofRuleReader>({
  combine: (values) => values[0] ?? ENGINE_RULE,
});

const scopeGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildScopeDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.geometryChanged
      ) {
        this.decorations = buildScopeDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const SHADOW_STYLES = [shadowStyles, goalStyles].join("\n");

class AufbauProofFitch extends CarnapExerciseElement<AufbauProofFitchStringId> {
  /** The frozen theory: with the goal appended for an ordinary exercise, and
   *  bare for a playground, whose goal is appended per compile. */
  private theory: { readonly mm0: string; readonly source: string | null } = {
    mm0: "",
    source: null,
  };
  /** A playground derives its goal from the proof's last line; see
   *  `exercise-kit/proof/playground.ts`. */
  private playground = false;
  /** The goal the last translation derived (playground only). */
  private goal: PlaygroundGoal | null = null;
  /** The goal row's statement, live in a playground. */
  private statementView: HTMLElement | null = null;
  /** Reads a typed line in the theory's language; passes text through where
   *  the exercise was frozen without one. See `exercise-kit/proof/formulas.ts`. */
  private readFormula: ProofFormulaReader = ENGINE_TEXT;
  /** Cited rule name to the engine's, from the theory's `@syntax alias` lines. */
  private readRule: ProofRuleReader = ENGINE_RULE;
  /** How each rule's citation names its premises, derived from the theory's
   *  own rule signatures. See `aufbau-proof-fitch/citations.ts`. */
  private citationShapes: ReadonlyMap<string, RuleCitationShape> = new Map();
  private goalName = "";
  private assumptionRule = "ax";
  /** The theory's turnstile; artifacts compiled before `sequent=` existed have
   *  no `sequentSymbol`, so this default stands in for them. */
  private sequentSymbol = "⊢";
  /** The theory's context separator, on the same terms as `sequentSymbol`. */
  private contextSymbol = ",";
  private editor: EditorView | null = null;
  private proofText = "";
  private fitchText = "";
  private mmb = "";
  private compileToken = 0;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  protected enhance(): void {
    const root = this.shadowRoot;
    const data = this.publicData;

    if (root === null) {
      // No Declarative Shadow Root (no DSD support): the inert SSR view stands.
      return;
    }

    // A submitted proof shown read-only: upgrade it to a read-only CodeMirror
    // that draws the same scope-lines as the interactive editor. The mode comes
    // from the hydration payload, as it does for every widget; markup with no
    // payload at all falls through to the check below and stays inert.
    if (this.mode === "review") {
      this.enhanceReview(root);
      return;
    }

    // Without valid data there is nothing to enhance; the inert SSR view stands.
    if (!isFitchPublicData(data)) {
      return;
    }

    const theory = proofTheoryText(data);
    this.theory = theory;
    this.playground = data.playground === true;
    this.readFormula = proofFormulaReader(
      theory.source,
      "sentence",
      data.goalName,
    );
    this.citationShapes = ruleCitationShapes(theory.source);
    this.readRule = proofRuleReader(theory.source);
    this.goalName = data.goalName;
    this.assumptionRule = data.assumptionRule;
    if (typeof data.sequentSymbol === "string" && data.sequentSymbol !== "") {
      this.sequentSymbol = data.sequentSymbol;
    }
    if (typeof data.contextSymbol === "string" && data.contextSymbol !== "") {
      this.contextSymbol = data.contextSymbol;
    }

    const container = root.querySelector<HTMLElement>(".proof");
    const source = root.querySelector<HTMLElement>(".proof-source");
    if (container === null) {
      return;
    }
    source?.remove();

    const style = document.createElement("style");
    style.textContent = SHADOW_STYLES;
    root.appendChild(style);

    // The projected action bar (slot="exercise-actions") sits at the card's
    // foot; the goal row and editor go in above it, not appended after.
    const actionsSlot = container.querySelector<HTMLElement>(
      'slot[name="exercise-actions"]',
    );

    const goal = document.createElement("div");
    goal.className = "proof-goal";
    const label = document.createElement("span");
    label.className = "proof-goal-label";
    // A playground's row says what the proof *proves*, and follows the proof.
    label.textContent = this.t(this.playground ? "Proves" : "Prove");
    const statement = document.createElement("span");
    statement.className = "proof-goal-statement";
    statement.textContent = this.playground
      ? ""
      : goalText(theory, this.goalName);
    this.statementView = statement;
    // The space is for text readers; the row's gap draws the visible one.
    goal.append(label, " ", statement);
    container.insertBefore(goal, actionsSlot);

    const host = document.createElement("div");
    host.className = "proof-editor";
    container.insertBefore(host, actionsSlot);

    const prior = this.priorAnswer as { fitchText?: unknown } | null;
    const initialText =
      prior !== null && typeof prior.fitchText === "string"
        ? prior.fitchText
        : data.starterBody;

    this.editor = new EditorView({
      parent: host,
      root: root,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([
            // Backspace deletes exactly one character, even in the leading
            // whitespace. CodeMirror's default swallows a whole indent unit
            // there, which assumes indentation comes in fixed steps — here it
            // does not: any deeper indent opens a subproof, so a single space
            // is a meaningful edit. With the default binding, a student who
            // indents a line sitting one space in, sees it become a
            // sub-subproof's assumption, and reaches for Backspace to take it
            // back gets both spaces removed and the line thrown out to the
            // margin.
            {
              key: "Backspace",
              run: deleteCharBackwardStrict,
              shift: deleteCharBackwardStrict,
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          // CodeMirror's editable surface is a `role="textbox"` with no name of
          // its own, so without this the student tabs into an unlabelled box.
          EditorView.contentAttributes.of({
            "aria-label": this.t("Fitch proof editor"),
          }),
          assumptionRuleFacet.of(this.assumptionRule),
          ruleReaderFacet.of(this.readRule),
          scopeGuides,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.onDocChanged();
            }
          }),
        ],
      }),
    });

    this.fitchText = initialText;
    this.proofText = this.translateFitch(initialText).proofText;
    // JS owns the widget now; the SSR markup's "still loading" flag would
    // otherwise stand for the life of the page.
    container.removeAttribute("aria-busy");
    this.dataset.enhanced = "true";
    this.syncAnswer();
    this.scheduleCompile();
  }

  /**
   * Upgrade the read-only review markup: swap the inert `<pre>` source for a
   * non-editable CodeMirror carrying only the scope-line decorations (no
   * translate/compile/lint — the verdict is already recorded). The submitted
   * Fitch text is read back from the `<pre>` (its `textContent` is the decoded
   * source) and the assumption rule from `data-assumption-rule`, so the boxes
   * split exactly where the interactive editor's would.
   */
  private enhanceReview(root: ShadowRoot): void {
    const source = root.querySelector<HTMLElement>(".proof-source");
    if (source === null) {
      return;
    }
    const fitchText = source.textContent ?? "";
    const assumptionRule = this.getAttribute("data-assumption-rule") || "ax";
    // The theory is not on this page; what the boxes need from it is which
    // spellings mean the assumption rule, and the server lists those.
    const spellings = new Set(
      (this.getAttribute("data-assumption-spellings") ?? "")
        .split(/\s+/)
        .filter((one) => one.length > 0),
    );
    const readRule: ProofRuleReader = (cited) =>
      spellings.has(cited) ? assumptionRule : cited;

    const style = document.createElement("style");
    style.textContent = SHADOW_STYLES;
    root.appendChild(style);

    const host = document.createElement("div");
    host.className = "proof-editor";
    source.replaceWith(host);

    new EditorView({
      parent: host,
      root: root,
      state: EditorState.create({
        doc: fitchText,
        extensions: [
          lineNumbers(),
          EditorView.lineWrapping,
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({
            "aria-label": this.t("Submitted proof"),
          }),
          assumptionRuleFacet.of(assumptionRule),
          ruleReaderFacet.of(readRule),
          scopeGuides,
        ],
      }),
    });

    this.dataset.enhanced = "true";
  }

  protected getAnswer(): unknown {
    return {
      fitchText: this.fitchText,
      ...(this.goal === null ? {} : { goal: this.goal }),
      mmb: this.mmb,
      proofText: this.proofText,
    };
  }

  /**
   * What this translation compiles against: the frozen text, or — in a
   * playground — the frozen text plus the goal the translation's last line
   * makes. `null` when there is nothing to compile: a playground with no
   * lines yet, or one whose statement's variables the theory cannot name
   * (the mark says so). Updates the goal row and the answer's goal as a side
   * effect, since every caller wants both kept in step.
   */
  private compileTheory(
    translation: ReturnType<typeof fitchToAuf>,
  ): string | null {
    if (!this.playground) {
      return this.theory.mm0;
    }

    const goal =
      translation.statement === null
        ? null
        : playgroundGoal(this.theory.source, translation.statement);
    this.goal = goal;

    if (this.statementView !== null) {
      this.statementView.textContent =
        goal === null ? "" : playgroundGoalText(this.theory.source, goal);
    }

    if (goal === null) {
      if (translation.statement !== null) {
        this.setMark(
          "error",
          this.t("Could not work out what the last line states."),
        );
      }
      return null;
    }

    return playgroundTheoryText(this.theory, goal).mm0;
  }

  /** The certificate is compiled from the proof, not typed by the reader. */
  protected override authoredAnswer(): string {
    return JSON.stringify(withoutCertificate(this.getAnswer()));
  }

  private currentText(): string {
    return this.editor?.state.doc.toString() ?? "";
  }

  private translateFitch(fitchText: string): ReturnType<typeof fitchToAuf> {
    return fitchToAuf(
      fitchText,
      this.goalName,
      this.assumptionRule,
      this.sequentSymbol,
      this.contextSymbol,
      this.readFormula,
      this.citationShapes,
      this.readRule,
    );
  }

  private onDocChanged(): void {
    this.fitchText = this.currentText();
    const translation = this.translateFitch(this.fitchText);
    this.proofText = translation.proofText;
    // Reflect the new source immediately; the certificate follows once it compiles.
    this.mmb = "";
    this.syncAnswer();

    if (unreadable(translation)) {
      // Structural problems, or a formula the language refused: show them
      // straight away, don't compile.
      if (this.debounceHandle !== null) {
        clearTimeout(this.debounceHandle);
        this.debounceHandle = null;
      }
      this.setMark("idle");
      this.applyStructuralDiagnostics(translation);
      return;
    }

    this.scheduleCompile();
  }

  /** Nothing to compile: an empty playground, or one with no derivable goal. */
  private settleWithoutCompile(): void {
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    this.compileToken += 1;
    this.mmb = "";
    this.syncAnswer();
  }

  private scheduleCompile(): void {
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
    }
    this.setMark("working");
    this.debounceHandle = setTimeout(() => {
      void this.compile();
    }, DEBOUNCE_MS);
  }

  private async compile(): Promise<void> {
    const token = ++this.compileToken;
    const fitchText = this.currentText();
    const translation = this.translateFitch(fitchText);

    if (unreadable(translation)) {
      this.fitchText = fitchText;
      this.proofText = translation.proofText;
      this.mmb = "";
      this.setMark("idle");
      this.applyStructuralDiagnostics(translation);
      this.syncAnswer();
      return;
    }

    const mm0 = this.compileTheory(translation);

    if (mm0 === null) {
      this.fitchText = fitchText;
      this.proofText = translation.proofText;
      if (translation.statement === null) {
        this.setMark("idle");
      }
      this.applyCompilerDiagnostics([], translation);
      this.settleWithoutCompile();
      return;
    }

    let compiler: { compile(mm0: string, proof: string): CompileResult };
    try {
      compiler = await loadProofCompiler();
    } catch {
      if (token === this.compileToken) {
        this.setMark("error", this.t("Could not load the proof engine."));
      }
      return;
    }

    // A newer edit superseded this run while the engine loaded/compiled.
    if (token !== this.compileToken) {
      return;
    }

    let result: CompileResult;
    try {
      result = compiler.compile(mm0, translation.proofText);
    } catch {
      // Some malformed input can make the compiler throw rather than returning
      // diagnostics. Don't let that reject and strand the spinner.
      if (token !== this.compileToken) {
        return;
      }
      this.mmb = "";
      this.fitchText = fitchText;
      this.proofText = translation.proofText;
      this.setMark("idle");
      this.applyCompileFailure();
      this.syncAnswer();
      return;
    }

    if (token !== this.compileToken) {
      return;
    }

    this.fitchText = fitchText;
    this.proofText = translation.proofText;
    const verdict = readCompileResult(result);
    if (verdict.certificate !== null) {
      this.mmb = bytesToBase64(verdict.certificate);
      this.setMark("ok");
    } else {
      this.mmb = "";
      this.setMark("idle");
    }

    // The verdict lives on the "Prove" mark; specific problems surface inline as
    // editor squiggles with hover detail (empty on success — this clears them).
    this.applyCompilerDiagnostics(verdict.problems, translation);
    this.syncAnswer();
  }

  /** The char range of source line `sourceLine` (0-based) in the editor doc. */
  private lineRange(sourceLine: number): { from: number; to: number } {
    const doc = this.editor?.state.doc;
    if (doc === undefined) {
      return { from: 0, to: 0 };
    }
    const lineNumber = clamp(sourceLine + 1, 1, doc.lines);
    const line = doc.line(lineNumber);
    return { from: line.from, to: line.to };
  }

  /** The compiler threw before it could report diagnostics. */
  private applyCompileFailure(): void {
    const editor = this.editor;
    if (editor === null) {
      return;
    }
    if (!this.showsDetail) {
      editor.dispatch(setDiagnostics(editor.state, []));
      return;
    }

    const diagnostic: Diagnostic = {
      from: 0,
      message: this.t(
        "The proof engine couldn't read this proof — check for unexpected characters.",
      ),
      severity: "error",
      to: Math.min(editor.state.doc.length, 1),
    };
    editor.dispatch(setDiagnostics(editor.state, [diagnostic]));
  }

  /**
   * Everything wrong with the source before the compiler has seen it: the
   * translator's structural problems, underlined across their whole line, and
   * the language's refusals, underlined from the character that broke the
   * formula. A structural code is worded from this widget's own map; a
   * refusal arrives already worded by the parser, as a template plus its
   * values, so it goes through the same `t` by a different route.
   */
  private applyStructuralDiagnostics(
    translation: ReturnType<typeof fitchToAuf>,
  ): void {
    const editor = this.editor;
    if (editor === null) {
      return;
    }
    if (!this.showsDetail) {
      editor.dispatch(setDiagnostics(editor.state, []));
      return;
    }

    const diagnostics: Diagnostic[] = translation.diagnostics.map(
      (problem) => {
        const range = this.lineRange(problem.sourceLine);
        return {
          from: range.from,
          message: this.t(
            FITCH_DIAGNOSTIC_MESSAGES[problem.code],
            problem.params,
          ),
          severity: "error" as const,
          to: Math.max(range.to, range.from + 1),
        };
      },
    );

    for (const problem of translation.formulaProblems) {
      const range = this.lineRange(problem.sourceLine);
      // The parser counts from the formula's first character; the formula
      // starts `column` characters into its line. Clamped because a caret at
      // the very end of a formula would otherwise sit past the line.
      const at = clamp(
        range.from + problem.column + problem.error.position,
        range.from,
        Math.max(range.to - 1, range.from),
      );
      diagnostics.push({
        from: at,
        message: this.t(problem.error.message, problem.error.params),
        severity: "error",
        to: Math.max(range.to, at + 1),
      });
    }

    editor.dispatch(setDiagnostics(editor.state, diagnostics));
  }

  /**
   * Translate the compiler's diagnostics (UTF-8 byte spans into the generated
   * `.auf`) back onto the Fitch source: find the generated line the span falls
   * in, then underline the source line that produced it (via the translator's
   * `lineSpans`). Spans that land outside any line fall back to line 0.
   */
  private applyCompilerDiagnostics(
    problems: readonly CompileDiagnostic[],
    translation: ReturnType<typeof fitchToAuf>,
  ): void {
    const editor = this.editor;
    if (editor === null) {
      return;
    }

    if (!this.showsDetail) {
      editor.dispatch(setDiagnostics(editor.state, []));
      return;
    }

    const diagnostics: Diagnostic[] = [];

    for (const problem of problems) {
      const message = problem.message ?? this.t("Problem in the proof.");

      let sourceLine = 0;
      if (problem.spanStart !== undefined) {
        const charStart = byteToCharIndex(
          translation.proofText,
          problem.spanStart,
        );
        const span = translation.lineSpans.find(
          (candidate) =>
            charStart >= candidate.from && charStart <= candidate.to,
        );
        sourceLine = span?.sourceLine ?? 0;
      }

      const range = this.lineRange(sourceLine);
      diagnostics.push({
        from: range.from,
        message,
        severity: problem.severity,
        to: Math.max(range.to, range.from + 1),
      });
    }

    editor.dispatch(setDiagnostics(editor.state, diagnostics));
  }
}

register("carnap-aufbau-proof-fitch", AufbauProofFitch);
