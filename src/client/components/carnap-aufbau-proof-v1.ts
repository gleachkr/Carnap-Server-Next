/**
 * `<carnap-aufbau-proof>` — the interactive proof editor.
 *
 * The server renders inert chrome into a Declarative Shadow Root (see the
 * worker-side `renderAufbauProofElement`): the prompt and the starting proof
 * source, styled with no JS. On connect this element replaces the static source
 * with a small CodeMirror editor for the proof body, shows the theorem to prove,
 * and gives live feedback: as the student types (debounced) it assembles the
 * full `.auf`, compiles it against the frozen theory with the lazily-loaded
 * `@aufbau/compiler` (WebAssembly), and reports whether it verifies.
 *
 * The answer mirrored into the form's hidden `answerData` is `{ proofText, mmb }`
 * — the MMB is the compiled certificate, and the worker re-verifies it against
 * the same frozen mm0 (the compiler here is an untrusted convenience; the
 * server-side verifier is the arbiter).
 *
 * Feedback is deliberately quiet: the shared correctness mark in the action bar
 * (a spinner while checking, a green check once it verifies), and any problems
 * shown inline in the editor as CodeMirror lint squiggles with hover detail — the
 * compiler reports UTF-8 byte spans into the proof, which we map back onto the
 * editable body. Author toggles for proof search (`auto?`) and completion are
 * carried in the options but not yet wired to editor assistance.
 */
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import type { AufbauProofStringId } from "../../worker/exercises/aufbau-proof/strings";
import type { AufbauProofPublicData } from "../../worker/exercises/aufbau-proof/types";
import { loadProofCompiler } from "../proof-compiler";
import { CarnapExerciseElement, register, withoutCertificate } from "./base";

const DEBOUNCE_MS = 400;

// The header the assembled proof carries above the editable body: the goal name,
// then the `----` underline. The body the editor holds starts after it, so the
// compiler's byte spans shift left by this many (ASCII) characters.
const PROOF_HEADER_SEPARATOR = "\n----\n";

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

import type { CompileResult } from "@aufbau/compiler";

function isProofPublicData(value: unknown): value is AufbauProofPublicData {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { mm0?: unknown }).mm0 === "string" &&
    typeof (value as { goalName?: unknown }).goalName === "string"
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

/** Strip the `<goalName>\n----\n` header a prior answer's proofText carries. */
function bodyFromProofText(proofText: string): string {
  const lines = proofText.split("\n");
  const underline = lines.findIndex((line) => /^\s*-{3,}\s*$/.test(line));
  return underline === -1 ? proofText : lines.slice(underline + 1).join("\n");
}

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

class AufbauProof extends CarnapExerciseElement<AufbauProofStringId> {
  private mm0 = "";
  private goalName = "";
  private editor: EditorView | null = null;
  private proofText = "";
  private mmb = "";
  private compileToken = 0;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  protected enhance(): void {
    const root = this.shadowRoot;
    const data = this.publicData;

    // Without the Declarative Shadow Root (no DSD support) or valid data there is
    // nothing to enhance; the inert SSR view stands. Review mode also stays inert.
    if (root === null || this.mode !== "answer" || !isProofPublicData(data)) {
      return;
    }

    this.mm0 = data.mm0;
    this.goalName = data.goalName;

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

    const prior = this.priorAnswer as { proofText?: unknown } | null;
    const initialBody =
      prior !== null && typeof prior.proofText === "string"
        ? bodyFromProofText(prior.proofText)
        : data.starterBody;

    this.editor = new EditorView({
      parent: host,
      root: root,
      state: EditorState.create({
        doc: initialBody,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          // CodeMirror's editable surface is a `role="textbox"` with no name of
          // its own, so without this the student tabs into an unlabelled box.
          EditorView.contentAttributes.of({
            "aria-label": this.t("Proof editor"),
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.onDocChanged();
            }
          }),
        ],
      }),
    });

    this.proofText = this.assemble(initialBody);
    // JS owns the widget now; the SSR markup's "still loading" flag would
    // otherwise stand for the life of the page.
    container.removeAttribute("aria-busy");
    this.dataset.enhanced = "true";
    this.syncAnswer();
    this.scheduleCompile();
  }

  protected getAnswer(): unknown {
    return { mmb: this.mmb, proofText: this.proofText };
  }

  /** The certificate is compiled from the proof, not typed by the reader. */
  protected override authoredAnswer(): string {
    return JSON.stringify(withoutCertificate(this.getAnswer()));
  }

  private assemble(body: string): string {
    return `${this.goalName}\n----\n${body}`;
  }

  private currentBody(): string {
    return this.editor?.state.doc.toString() ?? "";
  }

  private onDocChanged(): void {
    this.proofText = this.assemble(this.currentBody());
    // Reflect the new source immediately; the certificate follows once it compiles.
    this.mmb = "";
    this.syncAnswer();
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
    const proof = this.assemble(this.currentBody());

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
      result = compiler.compile(this.mm0, proof);
    } catch {
      // Some malformed input can make the compiler throw rather than returning
      // diagnostics. Don't let that reject and strand the spinner — treat it as
      // "not verified" and surface a generic marker inline.
      if (token !== this.compileToken) {
        return;
      }
      this.mmb = "";
      this.proofText = proof;
      this.setMark("idle");
      this.applyCompileFailure();
      this.syncAnswer();
      return;
    }

    if (token !== this.compileToken) {
      return;
    }

    if (result.ok === true && result.mmbBytes !== undefined) {
      this.mmb = bytesToBase64(result.mmbBytes);
      this.proofText = proof;
      this.setMark("ok");
    } else {
      this.mmb = "";
      this.proofText = proof;
      this.setMark("idle");
    }

    // The verdict lives on the action bar's correctness mark; specific problems
    // surface inline as editor squiggles with hover detail (empty on success —
    // this clears them).
    this.applyDiagnostics(result, proof);
    this.syncAnswer();
  }

  /**
   * The compiler threw before it could report diagnostics. Show a single generic
   * marker at the start of the body rather than stranding the spinner.
   */
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
   * Translate the compiler's diagnostics (UTF-8 byte spans into the assembled
   * proof) onto the editable body and hand them to CodeMirror's lint layer, which
   * renders the underlines and hover tooltips. A span that lands in the frozen
   * header (e.g. "proof block is empty") is clamped to the start of the body.
   */
  private applyDiagnostics(result: CompileResult, proof: string): void {
    const editor = this.editor;
    if (editor === null) {
      return;
    }

    if (!this.showsDetail) {
      editor.dispatch(setDiagnostics(editor.state, []));
      return;
    }

    const raw = result.diagnostics;
    const docLength = editor.state.doc.length;
    const headerLength = this.goalName.length + PROOF_HEADER_SEPARATOR.length;
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
          spanEnd?: unknown;
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

        let from = 0;
        let to = docLength;
        if (
          typeof record.spanStart === "number" &&
          typeof record.spanEnd === "number"
        ) {
          from = byteToCharIndex(proof, record.spanStart) - headerLength;
          to = byteToCharIndex(proof, record.spanEnd) - headerLength;
        }
        from = clamp(from, 0, docLength);
        to = clamp(to, from, docLength);
        // A zero-width span underlines nothing; nudge it to cover one character
        // so the squiggle is visible (unless the body is genuinely empty).
        if (from === to && docLength > 0) {
          if (to < docLength) {
            to += 1;
          } else {
            from -= 1;
          }
        }

        diagnostics.push({ from, message, severity, to });
      }
    }

    editor.dispatch(setDiagnostics(editor.state, diagnostics));
  }
}

register("carnap-aufbau-proof", AufbauProof);
