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
import {
  type AufbauProofFitchStringId,
  FITCH_DIAGNOSTIC_MESSAGES,
} from "../../worker/exercises/aufbau-proof-fitch/strings";
import {
  fitchScopeGeometry,
  fitchToAuf,
} from "../../worker/exercises/aufbau-proof-fitch/translate";
import type { AufbauProofFitchPublicData } from "../../worker/exercises/aufbau-proof-fitch/types";
import { loadProofCompiler } from "../proof-compiler";
import { CarnapExerciseElement, register, withoutCertificate } from "./base";

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
 * Colour of the Fitch scope-lines. Drawn in the editor's own text colour so the
 * bars read as structural ink, only slightly lighter than the formulas — not the
 * faint `--rule` divider tone. An instructor theme can override `--fitch-scope`.
 */
const SCOPE_COLOR =
  "var(--fitch-scope, color-mix(in srgb, currentColor 72%, transparent))";

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

function isFitchPublicData(
  value: unknown,
): value is AufbauProofFitchPublicData {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { mm0?: unknown }).mm0 === "string" &&
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

/** The theorem declaration line to show the student ("what to prove"). */
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
  const geometryByLine = fitchScopeGeometry(doc.toString(), assumptionRule);
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

const SHADOW_STYLES = `
  .proof-goal {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    /* Fira Code first (loaded as a web font) so connective ligatures render. */
    font-family: "Fira Code", ui-monospace, monospace;
    font-size: 0.9rem;
    gap: 0.4rem;
    margin: 0.5rem 0 0.4rem;
    opacity: 0.85;
  }
  .proof-goal-label {
    font-family: inherit;
    font-weight: 600;
    opacity: 0.7;
  }
  .proof-goal-decl {
    min-width: 0;
  }
  .proof-editor {
    border: 1px solid var(--rule, #d8d0c3);
    border-radius: 0.4rem;
    overflow: hidden;
  }
  .proof-editor .cm-editor {
    background: transparent;
  }
  .proof-editor .cm-editor.cm-focused {
    outline: none;
  }
  .proof-editor .cm-gutters {
    background: transparent;
    border: none;
    opacity: 0.5;
  }
  .proof-editor .cm-content {
    font-family: "Fira Code", ui-monospace, monospace;
    font-size: 0.9rem;
    /* Roomier lines so the scope struts read as a Fitch diagram and the
       assumption rule has clear air under each hypothesis. */
    line-height: 1.7;
  }
  /* The insertion point, which CodeMirror's base theme would otherwise paint
     black. It ships both colours and picks between them from the
     EditorView.darkTheme facet rather than from the OS, so a view that never
     sets that facet gets the black one in both schemes and the caret vanishes
     into the dark surface. Taking it from the ink token follows the palette
     instead, and needs no facet reconfigured when the preference changes.

     The extra .cm-editor in the selector is load-bearing. CodeMirror mounts its
     theme through adoptedStyleSheets, which the cascade puts after this shadow
     root's own style element, so its rule wins every tie on specificity alone.
     Its selector is two classes; this one is three. */
  .proof-editor .cm-editor .cm-content {
    caret-color: var(--ink, #16324a);
  }
  /* The bubble a diagnostic is read in. CodeMirror's base theme paints it
     #f5f5f5 from a rule scoped to &light, and &light is selected by the
     EditorView.darkTheme facet rather than by the OS — so a view that never sets
     that facet keeps the pale background in dark mode while the message inside
     inherits the light ink, and the text disappears into it. Repainting the
     bubble from the tokens covers both schemes at once.

     Two things about the selector. .cm-tooltip-lint names the <ul> *inside* the
     bubble rather than the bubble itself, so .cm-tooltip.cm-tooltip-lint matches
     nothing at all; the wrapper has to be named directly. And the extra
     .cm-editor is load-bearing for the same reason it is on the caret above —
     CodeMirror's adopted stylesheet is applied after this shadow root's own
     style element, so its two-class rule wins every tie. Three classes wins. */
  .proof-editor .cm-editor .cm-tooltip {
    background: var(--surface-soft, #f8f2e8);
    border: 1px solid var(--rule, #d8d0c3);
    border-radius: 0.3rem;
    color: var(--ink, #16324a);
    font-family: system-ui, sans-serif;
    font-size: 0.82rem;
  }
  /* The severity bar down the left of each message, which the base theme draws
     in a raw #d11 that neither palette uses. */
  .proof-editor .cm-editor .cm-diagnostic-error {
    border-left-color: var(--red, #b42318);
  }
`;

class AufbauProofFitch extends CarnapExerciseElement<AufbauProofFitchStringId> {
  private mm0 = "";
  private goalName = "";
  private assumptionRule = "ax";
  /** The theory's turnstile; artifacts compiled before `sequent=` existed have
   *  no `sequentSymbol`, so this default stands in for them. */
  private sequentSymbol = "⊢";
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

    this.mm0 = data.mm0;
    this.goalName = data.goalName;
    this.assumptionRule = data.assumptionRule;
    if (typeof data.sequentSymbol === "string" && data.sequentSymbol !== "") {
      this.sequentSymbol = data.sequentSymbol;
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
    label.textContent = this.t("Prove");
    const decl = document.createElement("span");
    decl.className = "proof-goal-decl";
    decl.textContent = goalDeclaration(data.mm0);
    goal.append(label, decl);
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
          scopeGuides,
        ],
      }),
    });

    this.dataset.enhanced = "true";
  }

  protected getAnswer(): unknown {
    return {
      fitchText: this.fitchText,
      mmb: this.mmb,
      proofText: this.proofText,
    };
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
    );
  }

  private onDocChanged(): void {
    this.fitchText = this.currentText();
    const translation = this.translateFitch(this.fitchText);
    this.proofText = translation.proofText;
    // Reflect the new source immediately; the certificate follows once it compiles.
    this.mmb = "";
    this.syncAnswer();

    if (translation.diagnostics.length > 0) {
      // Structural problems: show them straight away, don't compile.
      if (this.debounceHandle !== null) {
        clearTimeout(this.debounceHandle);
        this.debounceHandle = null;
      }
      this.setMark("idle");
      this.applyStructuralDiagnostics(translation.diagnostics);
      return;
    }

    this.scheduleCompile();
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

    if (translation.diagnostics.length > 0) {
      this.fitchText = fitchText;
      this.proofText = translation.proofText;
      this.mmb = "";
      this.setMark("idle");
      this.applyStructuralDiagnostics(translation.diagnostics);
      this.syncAnswer();
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
      result = compiler.compile(this.mm0, translation.proofText);
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
    if (result.ok === true && result.mmbBytes !== undefined) {
      this.mmb = bytesToBase64(result.mmbBytes);
      this.setMark("ok");
    } else {
      this.mmb = "";
      this.setMark("idle");
    }

    // The verdict lives on the "Prove" mark; specific problems surface inline as
    // editor squiggles with hover detail (empty on success — this clears them).
    this.applyCompilerDiagnostics(result, translation);
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

  /** Translator structural problems, keyed straight to their source line. */
  private applyStructuralDiagnostics(
    problems: ReturnType<typeof fitchToAuf>["diagnostics"],
  ): void {
    const editor = this.editor;
    if (editor === null) {
      return;
    }
    if (!this.showsDetail) {
      editor.dispatch(setDiagnostics(editor.state, []));
      return;
    }

    const diagnostics: Diagnostic[] = problems.map((problem) => {
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
    });
    editor.dispatch(setDiagnostics(editor.state, diagnostics));
  }

  /**
   * Translate the compiler's diagnostics (UTF-8 byte spans into the generated
   * `.auf`) back onto the Fitch source: find the generated line the span falls
   * in, then underline the source line that produced it (via the translator's
   * `lineSpans`). Spans that land outside any line fall back to line 0.
   */
  private applyCompilerDiagnostics(
    result: CompileResult,
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

    const raw = result.diagnostics;
    const diagnostics: Diagnostic[] = [];

    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item !== "object" || item === null) {
          continue;
        }
        const record = item as {
          message?: unknown;
          severity?: unknown;
          spanStart?: unknown;
        };
        const message =
          typeof record.message === "string"
            ? record.message
            : this.t("Problem in the proof.");
        const severity =
          record.severity === "warning"
            ? "warning"
            : record.severity === "info"
              ? "info"
              : "error";

        let sourceLine = 0;
        if (typeof record.spanStart === "number") {
          const charStart = byteToCharIndex(
            translation.proofText,
            record.spanStart,
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
          severity,
          to: Math.max(range.to, range.from + 1),
        });
      }
    }

    editor.dispatch(setDiagnostics(editor.state, diagnostics));
  }
}

register("carnap-aufbau-proof-fitch", AufbauProofFitch);
