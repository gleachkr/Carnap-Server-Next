import type { CompileResult, LoadedCompiler } from "@aufbau/compiler";
import type { ProofEngineStringId } from "../../worker/exercise-kit/proof/engine-strings";
import {
  bytesToBase64,
  type CompileVerdict,
  loadProofCompiler,
  readCompileResult,
} from "../proof-compiler";
import { CarnapExerciseElement, withoutCertificate } from "./base";

/**
 * How long after the last edit a compile starts. Long enough that a student
 * mid-word is not compiled on every keystroke, short enough that the mark
 * answers before they look up.
 */
const DEBOUNCE_MS = 400;

/**
 * What one run of the engine came to, once it is known to be the current one.
 *
 * `unavailable` is the engine failing to load (a network blip on the wasm —
 * the loader forgets a failed load, so the next edit tries again);
 * `unreadable` is the engine throwing instead of reporting, which some
 * malformed input still provokes; `verdict` is the ordinary case, with the
 * certificate and the admitted flag already taken up by the element.
 */
export type CompileRun =
  | { readonly kind: "unavailable" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "verdict"; readonly verdict: CompileVerdict };

/**
 * What the four proof widgets — linear `.auf`, Fitch, tree and Prawitz — do
 * alike between an edit and a verdict, so that each keeps only what makes
 * it a different editor: how the proof is written and how a diagnostic finds
 * its way back onto it.
 *
 * The shape is one debounced, superseding compile at a time. An edit calls
 * {@link scheduleCompile}; the debounce runs the subclass's {@link compile},
 * which gathers what to compile and hands it to {@link runCompiler}; a newer
 * edit, or a {@link cancelCompile} because there is now nothing to compile,
 * supersedes any run still in flight, whose result is then dropped rather
 * than landed over the newer text. The certificate ({@link mmb}) is derived
 * work, reset on every edit ({@link forgetVerdict}) and left out of the
 * authored answer, which is what keeps a page nobody has touched from
 * warning about unsaved changes.
 *
 * The submit gate is here too: a submit while a compile is pending or running
 * is held until it settles and sent again, and — under `allow-sorry`, outside
 * an exam — a proof that stands only by admitting lines is refused and the
 * reader told why. See {@link gate}.
 *
 * `StringId` is the widget's own union; the pipeline widens `t` to the engine
 * set it reads itself, which every proof type's `strings.ts` spreads in
 * (`tests/exercise-strings.test.ts` pins that, since the widening would
 * otherwise let a type drop the spread and fall back to English unnoticed).
 */
export abstract class ProofExerciseElement<
  StringId extends string,
> extends CarnapExerciseElement<StringId | ProofEngineStringId> {
  /** The certificate the last compile produced, base64; empty until then. */
  protected mmb = "";
  /** The exercise's `allow-sorry`: an admitted line is a warning, not an error. */
  protected allowSorry = false;
  /** Whether the last compile stood only by admitting lines. */
  protected admitted = false;

  /** Bumped by whatever makes a run in flight stale; a run compares its own. */
  private compileToken = 0;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  /** The compile now running, if any — what a submit waits on. */
  private inFlight: Promise<void> | null = null;

  /**
   * Gather the current proof and the theory it compiles against, hand them to
   * {@link runCompiler}, and show what came back. Run only through the
   * pipeline — the debounce, or a submit settling it.
   */
  protected abstract compile(): Promise<void>;

  /** The certificate is compiled from the proof, not typed by the reader. */
  protected override authoredAnswer(): string {
    return JSON.stringify(withoutCertificate(this.getAnswer()));
  }

  /** A widget taken out of the page has nothing left to check. */
  disconnectedCallback(): void {
    this.clearDebounce();
  }

  /**
   * The proof changed under the last verdict: whatever a submit was held
   * for, whatever the status line said, whether lines were admitted, and the
   * certificate were all about the old one. Before `syncAnswer`, so the
   * answer never carries a certificate for text it no longer holds.
   */
  protected forgetVerdict(): void {
    this.dropHold();
    this.admitted = false;
    this.mmb = "";
    this.setCheckStatus("");
  }

  /**
   * Compile once the edits pause. Supersedes a run in flight: its verdict was
   * for the text before this edit, and landing it now would show that
   * text's mark — and, in the CodeMirror widgets, mirror that text into the
   * answer — over the newer one until the next run corrected it.
   */
  protected scheduleCompile(): void {
    this.clearDebounce();
    this.compileToken += 1;
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      this.startCompile();
    }, DEBOUNCE_MS);
  }

  /**
   * There is nothing to compile — a playground with no line yet, a source the
   * translator could not read — so nothing pending or in flight may land.
   */
  protected cancelCompile(): void {
    this.clearDebounce();
    this.compileToken += 1;
  }

  /**
   * The submit gate. A compile still pending or running would leave this
   * submission without its certificate — and, with `allow-sorry`, without
   * knowing whether it may go at all — so it is settled first and the submit
   * sent again. Then, outside an exam, a proof that stands only by admitting
   * lines is held back and the reader told why: it would score nothing, and
   * the point of allowing `sorry!` was to let them see the rest check, not to
   * hand in the gaps. On an exam it goes as it stands, for nothing.
   *
   * Registered by the subclass once its editor is up, through `gateSubmit`.
   */
  protected gate(event: Event): void {
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

  /**
   * What the status line says of a proof that stands only by admitting lines:
   * that the rest checks, and what the admissions cost here. Detail, so
   * withheld under `terse` and `none` like the problems beside it; empty for
   * any other proof, which clears the line.
   */
  protected admittedStatus(): string {
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
   * Run the engine over `proof` against `mm0`, from inside {@link compile}.
   *
   * This run is the current one from here on — a run still in flight from an
   * earlier edit is superseded — and stays so until an edit supersedes it in
   * turn while the engine loads, in which case `null` comes back and the
   * caller shows nothing. The compile itself is synchronous, so once the
   * engine is in hand nothing can intervene. On a verdict the certificate
   * and the admitted flag are taken up here, since every widget keeps them
   * the same way; what to show for it is the caller's.
   */
  protected async runCompiler(
    mm0: string,
    proof: string,
  ): Promise<CompileRun | null> {
    const token = ++this.compileToken;

    let compiler: LoadedCompiler;
    try {
      compiler = await loadProofCompiler();
    } catch {
      return token === this.compileToken ? { kind: "unavailable" } : null;
    }
    if (token !== this.compileToken) {
      return null;
    }

    let result: CompileResult;
    try {
      result = compiler.compile(mm0, proof);
    } catch {
      this.mmb = "";
      return { kind: "unreadable" };
    }

    const verdict = readCompileResult(result, {
      allowSorry: this.allowSorry,
    });
    this.admitted = verdict.admitted;
    this.mmb =
      verdict.certificate === null ? "" : bytesToBase64(verdict.certificate);
    return { kind: "verdict", verdict };
  }

  /** Run a pending compile now; the promise to wait on, or null if settled. */
  private settleCompile(): Promise<void> | null {
    if (this.debounceHandle !== null) {
      this.clearDebounce();
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

  private clearDebounce(): void {
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
  }
}
