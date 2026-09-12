/**
 * `<carnap-translation>` — a symbolization exercise in the tradition of the
 * original Carnap's Translate. The student types a formula for the sentence
 * the prompt poses; a live preview under the input reads their ASCII back in
 * logical symbols (or words the parser's complaint); and the answer is judged
 * up to logical equivalence with one of the author's solutions.
 *
 * Equivalence checking runs like the proof types, not like the model: the
 * verdict *is* a certificate. On a pause in typing (or on Enter) the widget
 * asks the page's `auto?` search (`../proof-search.ts`, an LSP in a
 * worker) for a rewrite chain joining the parsed answer to a solution,
 * compiles the found proof to an MMB with the page's one compiler, and stashes
 * `{ text, mmb, solutionIndex }` in `answerData` — the worker re-verifies the
 * certificate against its own emission, so the search stays an untrusted
 * convenience. A verbatim (canonically equal) solution needs no certificate,
 * which is also all the `exact` variant ever accepts.
 *
 * Because the check is live, there is no Check button; Enter forces an
 * immediate check and is also when verdict sentences may appear in the status
 * line (a verdict flickering while someone is mid-thought is noise, but the
 * mark tracks continuously). `feedback` gates all of it the usual way: under
 * `terse` the sentences stay away, and under `none` the base clamps the mark
 * while the certificate still gets computed — grading needs it even when the
 * student is told nothing.
 *
 * A submit waits for the check. The certificate is what makes an equivalent
 * answer count, and it arrives after a pause and a search; a click that lands
 * inside that window would send the text alone, which the worker can only
 * grade as incorrect. So the submit gate runs a pending check at once, waits
 * out a search in flight, and only then lets the form go — resubmitting it
 * itself, once, unless the text changed meanwhile.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";
import type { Formula } from "../../worker/exercises/first-order";
import {
  firstOrderLanguageFor,
  formulaToString,
  parseFormula,
} from "../../worker/exercises/first-order";
import { buildEquivalenceCheck } from "../../worker/exercises/translation/logic/mm0";
import { verbatimSolutionIndex } from "../../worker/exercises/translation/logic/solutions";
import type { TranslationTestFailure } from "../../worker/exercises/translation/logic/tests";
import { runTranslationTests } from "../../worker/exercises/translation/logic/tests";
import { isPropositional } from "../../worker/exercises/translation/logic/variant";
import type { TranslationStringId } from "../../worker/exercises/translation/strings";
import type { TranslationPublicData } from "../../worker/exercises/translation/types";
import { isTranslationPublicData } from "../../worker/exercises/translation/types";
import { describeTestFailure } from "../../worker/exercises/translation/verdict-text";
import { loadProofCompiler } from "../proof-compiler";
import { findEquivalenceProof } from "../proof-search";
import { CarnapExerciseElement, register } from "./base";

const DEBOUNCE_MS = 600;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

class CarnapTranslation extends CarnapExerciseElement<TranslationStringId> {
  private data: TranslationPublicData | null = null;
  private language: SurfaceLanguage | null = null;
  private input: HTMLInputElement | null = null;
  private preview: HTMLParagraphElement | null = null;

  /** The certificate for the current text, when the last check found one. */
  private mmb = "";
  private solutionIndex: number | null = null;

  private checkToken = 0;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  /** The equivalence search now running for the current text, if any. */
  private inFlight: Promise<void> | null = null;

  /**
   * The search a submit is waiting on. A second click during the wait is the
   * same request; an edit abandons it, since what the reader asked to submit is
   * no longer what the field holds.
   */
  private held: Promise<void> | null = null;

  protected enhance(): void {
    const root = this.shadowRoot;
    const data = this.publicData;

    if (
      root === null ||
      this.mode !== "answer" ||
      !isTranslationPublicData(data)
    ) {
      return;
    }

    this.data = data;
    this.language = firstOrderLanguageFor(data);
    this.input = root.querySelector<HTMLInputElement>(
      'input[data-role="text"]',
    );
    this.preview = root.querySelector<HTMLParagraphElement>(
      'p[data-role="preview"]',
    );

    const input = this.input;
    if (input === null || this.language === null) {
      return;
    }

    const prior = this.priorAnswer as { text?: unknown } | null;
    if (typeof prior?.text === "string") {
      input.value = prior.text;
    }

    input.disabled = false;
    input.addEventListener("input", () => {
      this.onEdit();
    });
    // Carnap parity: return checks. It must not submit — preventDefault keeps
    // the form quiet while the (async) check runs.
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.runCheck(true);
      }
    });

    this.gateSubmit((event) => {
      // The `checksyntax` gate: refuse to submit text that does not parse. The
      // explanation is not a verdict — it is why the button did nothing — so it
      // shows whatever the feedback setting says.
      if (this.data?.checksyntax === true) {
        const parsed = this.parseCurrent();
        if (parsed === null || !parsed.ok) {
          event.preventDefault();
          this.setCheckStatus(
            this.t(
              "This answer does not parse, so it cannot be submitted on an exam.",
            ),
          );
          return;
        }
      }

      // The hold: a check still pending or running would leave this submission
      // without its certificate. Settle it first, then send.
      const settling = this.settleCheck();
      if (settling === null) {
        return;
      }
      event.preventDefault();
      if (this.held === settling) {
        return;
      }
      this.held = settling;
      void settling.then(() => {
        if (this.held !== settling) {
          return;
        }
        this.held = null;
        this.form?.requestSubmit();
      });
    });

    this.updatePreview();
    this.syncAnswer();
    if (input.value.trim() !== "") {
      this.runCheck(false);
    }

    root.querySelector("fieldset")?.removeAttribute("aria-busy");
    this.dataset.enhanced = "true";
  }

  protected getAnswer(): unknown {
    return {
      text: this.input?.value ?? "",
      ...(this.mmb !== "" && this.solutionIndex !== null
        ? { mmb: this.mmb, solutionIndex: this.solutionIndex }
        : {}),
    };
  }

  /**
   * Unsaved work is measured against the text alone: the certificate is the
   * machine's work, derived asynchronously — counting its arrival as an edit
   * would warn about leaving a page nobody has touched.
   */
  protected override authoredAnswer(): string {
    return JSON.stringify({ text: this.input?.value ?? "" });
  }

  private onEdit(): void {
    // The text changed under the certificate; drop it until a check remakes it.
    // A search still running is for the old text (its token will discard the
    // result), and a submit held for it was for the old text too.
    this.mmb = "";
    this.solutionIndex = null;
    this.inFlight = null;
    this.held = null;
    this.updatePreview();
    this.setCheckStatus("");
    this.syncAnswer();
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
    }
    this.debounceHandle = setTimeout(() => {
      this.runCheck(false);
    }, DEBOUNCE_MS);
  }

  /**
   * Bring the check up to date for a submit: run a pending one now, and hand
   * back the search to wait on, or null when there is nothing to wait for — a
   * verbatim or unparseable answer settles synchronously, and a search already
   * finished has left its certificate (or not) in place.
   */
  private settleCheck(): Promise<void> | null {
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
      this.runCheck(false);
    }
    return this.inFlight;
  }

  private parseCurrent(): ReturnType<typeof parseFormula> | null {
    const text = this.input?.value.trim() ?? "";
    if (text === "" || this.language === null) {
      return null;
    }
    return parseFormula(text, this.language);
  }

  /**
   * The live reading under the input. Not gated by `feedback`: everything on
   * this line is a function of the student's own keystrokes — there is no key
   * to leak and no verdict to withhold.
   */
  private updatePreview(): void {
    const preview = this.preview;
    if (preview === null || this.language === null) {
      return;
    }
    const parsed = this.parseCurrent();
    if (parsed === null) {
      preview.textContent = "";
      delete preview.dataset.mood;
      return;
    }
    if (parsed.ok) {
      preview.textContent = this.t("Reads as {formula}", {
        formula: formulaToString(parsed.formula, this.language),
      });
      delete preview.dataset.mood;
      return;
    }
    const error = parsed.errors[0];
    preview.textContent =
      error === undefined
        ? this.t("Expected a formula.")
        : this.t(
            error.message as TranslationStringId,
            error.params as Readonly<Record<string, string>> | undefined,
          );
    preview.dataset.mood = "error";
  }

  /**
   * Check the current text, computing the certificate the submission will
   * carry. `explicit` marks a check the reader asked for (Enter): that is
   * when verdict sentences may appear, feedback allowing — the mark alone
   * tracks the background runs.
   */
  private runCheck(explicit: boolean): void {
    const token = ++this.checkToken;
    // This check supersedes any the debounce was still holding.
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    const say = (sentence: string, correct = false): void => {
      if (explicit && this.showsDetail) {
        this.setCheckStatus(sentence, correct);
      }
    };
    const data = this.data;
    const language = this.language;
    const parsed = this.parseCurrent();

    if (data === null || language === null || parsed === null) {
      this.setMark("idle");
      return;
    }

    if (!parsed.ok) {
      // The preview is already wording the complaint; the mark just says the
      // work is not right yet.
      this.setMark("idle");
      return;
    }

    const formula = parsed.formula;

    if (data.variant === "prop" && !isPropositional(formula)) {
      this.setMark("idle");
      say(
        this.t(
          "This exercise wants a propositional sentence: sentence letters and connectives only.",
        ),
      );
      return;
    }

    const failures = runTranslationTests(formula, data.tests);
    if (failures.length > 0) {
      this.setMark("idle");
      say(this.describeFailures(failures));
      return;
    }

    const solutionAt = verbatimSolutionIndex(
      formula,
      data.solutions,
      language,
    );

    if (solutionAt >= 0) {
      // Verbatim (canonically): correct in every variant, no certificate
      // needed — the server takes the same fast path.
      this.mmb = "";
      this.solutionIndex = null;
      this.syncAnswer();
      this.setMark("ok");
      say(
        data.variant === "exact"
          ? this.t("This matches the intended answer.")
          : this.t(
              "This translation is logically equivalent to the intended answer.",
            ),
        true,
      );
      return;
    }

    if (data.variant === "exact") {
      this.setMark("idle");
      say(this.t("This does not exactly match the intended answer."));
      return;
    }

    this.setMark("working");
    const search = this.searchForCertificate(
      token,
      explicit,
      formula,
      data,
      language,
    );
    this.inFlight = search;
    // The search never rejects (it reports its own failures), so this only
    // ever clears — and only its own entry, never a newer search's.
    void search.then(() => {
      if (this.inFlight === search) {
        this.inFlight = null;
      }
    });
  }

  /** The equivalence hunt: each solution in turn until a certificate lands. */
  private async searchForCertificate(
    token: number,
    explicit: boolean,
    formula: Formula,
    data: TranslationPublicData,
    language: SurfaceLanguage,
  ): Promise<void> {
    if (data.variant === "exact") {
      return;
    }

    try {
      for (const [index, source] of data.solutions.entries()) {
        const solution = parseFormula(source, language);
        if (!solution.ok) {
          continue;
        }

        const sources = buildEquivalenceCheck(formula, solution.formula);
        const expanded = await findEquivalenceProof(sources);
        if (token !== this.checkToken) {
          return;
        }
        if (expanded === null) {
          continue;
        }

        const compiler = await loadProofCompiler();
        if (token !== this.checkToken) {
          return;
        }
        const result = compiler.compile(sources.mm0, expanded);
        if (result.ok === true && result.mmbBytes !== undefined) {
          this.mmb = bytesToBase64(result.mmbBytes);
          this.solutionIndex = index;
          this.syncAnswer();
          this.setMark("ok");
          if (explicit && this.showsDetail) {
            this.setCheckStatus(
              this.t(
                "This translation is logically equivalent to the intended answer.",
              ),
              true,
            );
          }
          return;
        }
      }
    } catch {
      if (token === this.checkToken) {
        this.setMark(
          "error",
          this.t(
            "The equivalence checker could not load. Your work is safe; check again in a moment.",
          ),
        );
      }
      return;
    }

    if (token !== this.checkToken) {
      return;
    }
    this.setMark("idle");
    if (explicit && this.showsDetail) {
      this.setCheckStatus(
        this.t("This translation is not equivalent to the intended answer."),
      );
    }
  }

  private describeFailures(
    failures: readonly TranslationTestFailure[],
  ): string {
    return failures
      .map((failure) =>
        describeTestFailure(failure, (id, values) => this.t(id, values)),
      )
      .join(" ");
  }
}

register("carnap-translation", CarnapTranslation);
