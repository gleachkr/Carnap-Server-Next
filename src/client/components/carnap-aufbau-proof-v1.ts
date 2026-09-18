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
import { proofTheoryText } from "../../worker/exercise-kit/proof/formulas";
import type { PlaygroundGoal } from "../../worker/exercise-kit/proof/playground";
import {
  lastProofStatement,
  playgroundGoal,
  playgroundGoalText,
  playgroundTheoryText,
} from "../../worker/exercise-kit/proof/playground";
import type { AufbauProofStringId } from "../../worker/exercises/aufbau-proof/strings";
import type { AufbauProofPublicData } from "../../worker/exercises/aufbau-proof/types";
import {
  type CompileDiagnostic,
  loadProofCompiler,
  readCompileResult,
} from "../proof-compiler";
import { CarnapExerciseElement, register, withoutCertificate } from "./base";
import shadowStyles from "./carnap-aufbau-proof-v1.css" with { type: "text" };
import goalStyles from "./proof-goal.css" with { type: "text" };

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

const SHADOW_STYLES = [shadowStyles, goalStyles].join("\n");

class AufbauProof extends CarnapExerciseElement<AufbauProofStringId> {
  /** The frozen theory: with the goal appended for an ordinary exercise, and
   *  bare for a playground, whose goal is appended per compile. */
  private theory: { readonly mm0: string; readonly source: string | null } = {
    mm0: "",
    source: null,
  };
  /** A playground derives its goal from the body's last line; see
   *  `exercise-kit/proof/playground.ts`. */
  private playground = false;
  /** The goal the last compile derived (playground only). */
  private goal: PlaygroundGoal | null = null;
  /** The goal row's statement, live in a playground. */
  private statementView: HTMLElement | null = null;
  private goalName = "";
  private editor: EditorView | null = null;
  private proofText = "";
  private mmb = "";
  private compileToken = 0;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  /** The compile now running, if any — what a submit waits on. */
  private inFlight: Promise<void> | null = null;
  /** The exercise's `allow-sorry`: an admitted line is a warning, not an error. */
  private allowSorry = false;
  /** Whether the last compile stood only by admitting lines (see `compile`). */
  private admitted = false;

  protected enhance(): void {
    const root = this.shadowRoot;
    const data = this.publicData;

    // Without the Declarative Shadow Root (no DSD support) or valid data there is
    // nothing to enhance; the inert SSR view stands. Review mode also stays inert.
    if (root === null || this.mode !== "answer" || !isProofPublicData(data)) {
      return;
    }

    this.theory = proofTheoryText(data);
    this.playground = data.playground === true;
    this.allowSorry = data.allowSorry === true;
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
    // A playground's row says what the proof *proves*, and follows the proof.
    label.textContent = this.t(this.playground ? "Proves" : "Prove");
    const decl = document.createElement("span");
    decl.className = "proof-goal-statement";
    decl.textContent = this.playground ? "" : goalDeclaration(data.mm0);
    this.statementView = decl;
    // The space is for text readers; the row's gap draws the visible one.
    goal.append(label, " ", decl);
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
    this.gateSubmit((event) => this.gate(event));
    // JS owns the widget now; the SSR markup's "still loading" flag would
    // otherwise stand for the life of the page.
    container.removeAttribute("aria-busy");
    this.dataset.enhanced = "true";
    this.syncAnswer();
    this.scheduleCompile();
  }

  /**
   * The submit gate. A compile still pending or running would leave this
   * submission without its certificate — and, with `allow-sorry`, without
   * knowing whether it may go at all — so it is settled first and the submit
   * sent again. Then, outside an exam, a proof that stands only by admitting
   * lines is held back and the reader told why: it would score nothing, and
   * the point of allowing `sorry!` was to let them see the rest check, not to
   * hand in the gaps. On an exam it goes as it stands, for nothing.
   */
  private gate(event: Event): void {
    const settling = this.settleCompile();
    if (settling !== null) {
      this.holdSubmit(event, settling);
      return;
    }
    if (this.admitted && !this.exam) {
      event.preventDefault();
      this.setCheckStatus(
        this.t(
          "A proof with lines admitted with sorry! cannot be submitted.",
        ),
      );
    }
  }

  /** Run a pending compile now; the promise to wait on, or null if settled. */
  private settleCompile(): Promise<void> | null {
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
      this.startCompile();
    }
    return this.inFlight;
  }

  private startCompile(): void {
    const run = this.compile().finally(() => {
      if (this.inFlight === run) {
        this.inFlight = null;
      }
    });
    this.inFlight = run;
  }

  protected getAnswer(): unknown {
    return {
      ...(this.goal === null ? {} : { goal: this.goal }),
      mmb: this.mmb,
      proofText: this.proofText,
    };
  }

  /**
   * What the body compiles against: the frozen text, or — in a playground —
   * the frozen text plus the goal the body's last line makes. `null` when
   * there is nothing to compile: a playground with no proof line yet, or one
   * whose statement's variables the theory cannot name (the mark says so).
   * Updates the goal row and the answer's goal as a side effect.
   */
  private compileTheory(body: string): string | null {
    if (!this.playground) {
      return this.theory.mm0;
    }

    const statement = lastProofStatement(body);
    // The student writes engine text and nothing reads it on the way in, so
    // the statement's variables are found by reading it once here.
    const goal =
      statement === null
        ? null
        : playgroundGoal(this.theory.source, {
            text: statement,
            variables: null,
          });
    this.goal = goal;

    if (this.statementView !== null) {
      this.statementView.textContent =
        goal === null ? "" : playgroundGoalText(this.theory.source, goal);
    }

    if (goal === null) {
      this.setMark(
        statement === null ? "idle" : "error",
        statement === null
          ? undefined
          : this.t("Could not work out what the last line states."),
      );
      return null;
    }

    return playgroundTheoryText(this.theory, goal).mm0;
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
    // A submit held for the old text was for the old text, and so was what
    // the status line said of it.
    this.dropHold();
    this.admitted = false;
    this.setCheckStatus("");
    this.setMark("working");
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      this.startCompile();
    }, DEBOUNCE_MS);
  }

  private async compile(): Promise<void> {
    const token = ++this.compileToken;
    const body = this.currentBody();
    const proof = this.assemble(body);
    const mm0 = this.compileTheory(body);

    if (mm0 === null) {
      this.mmb = "";
      this.proofText = proof;
      this.applyDiagnostics([], proof);
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
      result = compiler.compile(mm0, proof);
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

    const verdict = readCompileResult(result, {
      allowSorry: this.allowSorry,
    });
    this.proofText = proof;
    this.admitted = verdict.admitted;
    if (verdict.certificate !== null) {
      this.mmb = bytesToBase64(verdict.certificate);
      this.setMark("ok");
    } else {
      this.mmb = "";
      this.setMark("idle");
    }

    // The verdict lives on the action bar's correctness mark; specific problems
    // surface inline as editor squiggles with hover detail (empty on success —
    // this clears them). An admitted proof also gets the status line: the mark
    // says nothing, and what it is not saying deserves a sentence.
    this.applyDiagnostics(verdict.problems, proof);
    this.setCheckStatus(this.admittedStatus());
    this.syncAnswer();
  }

  /**
   * What the status line says of a proof that stands only by admitting lines:
   * that the rest checks, and what the admissions cost here. Detail, so
   * withheld under `terse` and `none` like the squiggles beside it; empty for
   * any other proof, which clears the line.
   */
  private admittedStatus(): string {
    if (!this.admitted || !this.showsDetail) {
      return "";
    }
    return this.t(
      this.exam
        ? "Every other line checks; lines admitted with sorry! do not score."
        : "Every other line checks; a proof with lines admitted with sorry! cannot be submitted.",
    );
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
  private applyDiagnostics(
    problems: readonly CompileDiagnostic[],
    proof: string,
  ): void {
    const editor = this.editor;
    if (editor === null) {
      return;
    }

    if (!this.showsDetail) {
      editor.dispatch(setDiagnostics(editor.state, []));
      return;
    }

    const docLength = editor.state.doc.length;
    const headerLength = this.goalName.length + PROOF_HEADER_SEPARATOR.length;
    const diagnostics: Diagnostic[] = [];

    for (const problem of problems) {
      const message = problem.message ?? this.t("Problem in the proof.");

      let from = 0;
      let to = docLength;
      if (problem.spanStart !== undefined && problem.spanEnd !== undefined) {
        from = byteToCharIndex(proof, problem.spanStart) - headerLength;
        to = byteToCharIndex(proof, problem.spanEnd) - headerLength;
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

      diagnostics.push({ from, message, severity: problem.severity, to });
    }

    editor.dispatch(setDiagnostics(editor.state, diagnostics));
  }
}

register("carnap-aufbau-proof", AufbauProof);
