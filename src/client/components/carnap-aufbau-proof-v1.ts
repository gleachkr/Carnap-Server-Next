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
 *
 * The debounce, the superseding compile, the certificate and the submit gate
 * are `./proof-element.ts`, shared with the other three proof widgets; the
 * chrome and lint helpers are `./proof-editor.ts`, shared with Fitch.
 */

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import type { Diagnostic } from "@codemirror/lint";
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
import {
  PROOF_HEADER_SEPARATOR,
  proofTextOf,
} from "../../worker/exercise-kit/proof/proof-text";
import type { AufbauProofStringId } from "../../worker/exercises/aufbau-proof/strings";
import type { AufbauProofPublicData } from "../../worker/exercises/aufbau-proof/types";
import { byteToCharIndex, type CompileDiagnostic } from "../proof-compiler";
import { register } from "./base";
import {
  clamp,
  goalDeclaration,
  mountProofEditor,
  showCompileFailure,
  showDiagnostics,
} from "./proof-editor";
import editorStyles from "./proof-editor.css" with { type: "text" };
import { ProofExerciseElement } from "./proof-element";
import goalStyles from "./proof-goal.css" with { type: "text" };

function isProofPublicData(value: unknown): value is AufbauProofPublicData {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { mm0?: unknown }).mm0 === "string" &&
    typeof (value as { goalName?: unknown }).goalName === "string"
  );
}

/** Strip the `<goalName>\n----\n` header a prior answer's proofText carries. */
function bodyFromProofText(proofText: string): string {
  const lines = proofText.split("\n");
  const underline = lines.findIndex((line) => /^\s*-{3,}\s*$/.test(line));
  return underline === -1 ? proofText : lines.slice(underline + 1).join("\n");
}

const SHADOW_STYLES = [editorStyles, goalStyles].join("\n");

class AufbauProof extends ProofExerciseElement<AufbauProofStringId> {
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

    // A playground's row says what the proof *proves*, and follows the proof.
    const chrome = mountProofEditor(root, SHADOW_STYLES, {
      label: this.t(this.playground ? "Proves" : "Prove"),
      statement: this.playground ? "" : goalDeclaration(data.mm0),
    });
    if (chrome === null) {
      return;
    }
    this.statementView = chrome.statement;

    const prior = this.priorAnswer as { proofText?: unknown } | null;
    const initialBody =
      prior !== null && typeof prior.proofText === "string"
        ? bodyFromProofText(prior.proofText)
        : data.starterBody;

    this.editor = new EditorView({
      parent: chrome.host,
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
    chrome.container.removeAttribute("aria-busy");
    this.dataset.enhanced = "true";
    this.syncAnswer();
    this.setMark("working");
    this.scheduleCompile();
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

  private assemble(body: string): string {
    return proofTextOf(this.goalName, body);
  }

  private currentBody(): string {
    return this.editor?.state.doc.toString() ?? "";
  }

  private onDocChanged(): void {
    this.proofText = this.assemble(this.currentBody());
    // Reflect the new source immediately; the certificate follows once it compiles.
    this.forgetVerdict();
    this.syncAnswer();
    this.setMark("working");
    this.scheduleCompile();
  }

  protected async compile(): Promise<void> {
    const body = this.currentBody();
    const proof = this.assemble(body);
    const mm0 = this.compileTheory(body);
    this.proofText = proof;

    if (mm0 === null) {
      this.cancelCompile();
      this.mmb = "";
      this.applyDiagnostics([], proof);
      this.syncAnswer();
      return;
    }

    const run = await this.runCompiler(mm0, proof);
    if (run === null) {
      return;
    }
    if (run.kind === "unavailable") {
      this.setMark("error", this.t("Could not load the proof engine."));
      return;
    }
    if (run.kind === "unreadable") {
      this.setMark("idle");
      if (this.editor !== null) {
        showCompileFailure(
          this.editor,
          this.showsDetail
            ? this.t(
                "The proof engine couldn't read this proof — check for unexpected characters.",
              )
            : null,
        );
      }
      this.syncAnswer();
      return;
    }

    this.setMark(run.verdict.certificate !== null ? "ok" : "idle");
    // The verdict lives on the action bar's correctness mark; specific problems
    // surface inline as editor squiggles with hover detail (empty on success —
    // this clears them). An admitted proof also gets the status line: the mark
    // says nothing, and what it is not saying deserves a sentence.
    this.applyDiagnostics(run.verdict.problems, proof);
    this.setCheckStatus(this.admittedStatus());
    this.syncAnswer();
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
      showDiagnostics(editor, []);
      return;
    }

    const docLength = editor.state.doc.length;
    // The body the editor holds starts after the header, so the compiler's
    // byte spans shift left by this many (ASCII) characters.
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

    showDiagnostics(editor, diagnostics);
  }
}

register("carnap-aufbau-proof", AufbauProof);
