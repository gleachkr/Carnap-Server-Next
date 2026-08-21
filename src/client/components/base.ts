import type { ExerciseFeedback } from "../../worker/domain/exercises";
import {
  ANSWER_RECORDED_EVENT,
  UNSAVED_ANSWER_ATTRIBUTE,
} from "../../worker/exercises/answer-events";
import {
  CORRECTNESS_MARK_CLASS,
  CORRECTNESS_MARK_GLYPHS,
  CORRECTNESS_MARK_LABEL_ATTRIBUTES,
  type CorrectnessMarkState,
} from "../../worker/exercises/correctness-mark";
import type {
  ExerciseHydration,
  ExerciseHydrationMode,
} from "../../worker/exercises/hydration";
import { formatMessage } from "../../worker/i18n/translator";

/**
 * Shared base for interactive exercise custom elements.
 *
 * Carnap requires JavaScript for exercises: the server renders each element's
 * chrome into a Declarative Shadow Root that stays inert until the element
 * upgrades. On connect the base reads the exercise's hydration payload (the
 * `<script data-exercise-hydration>` the server embeds; see the worker-side
 * `ExerciseHydration` contract) and exposes it to subclasses via {@link mode},
 * {@link publicData}, and {@link priorAnswer}, then calls {@link enhance} and
 * mirrors the answer into the form's hidden `answerData` field. That field, and
 * the `data-unsaved` flag {@link authoredAnswer} drives, are all the runtime
 * reads (the element never touches fetch, CSRF, or idempotency — the runtime
 * owns recording).
 *
 * A subclass MUST set `this.dataset.enhanced = "true"` once it has enhanced
 * successfully: the content document's failure affordance treats an element
 * that has not done so within a deadline as failed and shows a reload notice.
 *
 * `StringId` is the union of interface strings the widget uses — its per-widget
 * `strings.ts` derives it from the builder that fills the payload, so `tsc`
 * rejects a {@link t} call for text the server never sent.
 *
 * It defaults to `never`, not `string`: a widget with no registered strings
 * asset gets an empty `strings` payload, so every lookup would fall back to
 * English in every locale — silently, forever. Defaulting to `never` makes
 * {@link t} uncallable until the subclass names its union, which is the point at
 * which the server side has to exist.
 */
export abstract class CarnapExerciseElement<
  StringId extends string = never,
> extends HTMLElement {
  /** The enclosing exercise form, or null if the element is used standalone. */
  protected form: HTMLFormElement | null = null;

  /** The parsed hydration payload, or null when absent/invalid. */
  protected hydration: ExerciseHydration | null = null;

  /**
   * The authored answer as the server last had it — set to whatever the element
   * renders on connect (the prior answer it restores, or the empty state it
   * starts from), and moved forward each time a submission is recorded.
   */
  private savedAnswer = "";

  /** The answer as of the submit in flight, if there is one. */
  private submittedAnswer: string | null = null;

  connectedCallback(): void {
    this.form = this.closest<HTMLFormElement>("form.exercise");
    this.hydration = this.readHydration();
    this.enhance();
    this.syncAnswer();

    // What the element just rendered is the server's own state arriving, not an
    // edit — so it is the mark everything after it is measured against.
    this.savedAnswer = this.authoredAnswer();
    this.markUnsaved(this.savedAnswer);

    // What gets recorded is the answer as it stood when the submit began. An
    // edit made while the request is in flight is unsaved work, and adopting
    // whatever the element holds when the response lands would silently lose it.
    this.form?.addEventListener("submit", () => {
      this.submittedAnswer = this.authoredAnswer();
    });

    this.form?.addEventListener(ANSWER_RECORDED_EVENT, () => {
      this.savedAnswer = this.submittedAnswer ?? this.authoredAnswer();
      this.submittedAnswer = null;
      this.markUnsaved();
    });
  }

  /**
   * The part of the answer the reader authors, serialized — what "unsaved work"
   * is measured against, and by default the whole answer.
   *
   * It must be **stable**: two reads with nothing in between have to agree, or
   * every read looks like an edit. That rules out minting anything (an id, a
   * timestamp) while serializing — see the Prawitz widget's `EMPTY_TREE`, which
   * exists because its placeholder node used to be freshly made per read.
   *
   * A widget whose answer carries a *derived* field must leave it out here. The
   * proof types are the case in point: they compile a certificate from the
   * proof text asynchronously, so their serialized answer changes on its own
   * seconds after the page settles. Counting that as an edit would warn about
   * leaving a page nobody has touched. See {@link withoutCertificate}.
   */
  protected authoredAnswer(): string {
    return JSON.stringify(this.getAnswer());
  }

  /** Flag (or unflag) this element as holding work the server does not have. */
  private markUnsaved(answer = this.authoredAnswer()): void {
    this.toggleAttribute(
      UNSAVED_ANSWER_ATTRIBUTE,
      answer !== this.savedAnswer,
    );
  }

  /**
   * One-time enhancement of the server-rendered markup: wire listeners, add
   * interaction affordances. Call {@link syncAnswer} whenever the answer
   * changes so the hidden field tracks the live state.
   */
  protected abstract enhance(): void;

  /**
   * The current answer payload — the `data` of the answer envelope, matching
   * the shape the exercise type's server-side `normalizeAnswer` expects.
   */
  protected abstract getAnswer(): unknown;

  /** The render/interaction mode; defaults to `answer` without a payload. */
  protected get mode(): ExerciseHydrationMode {
    return this.hydration?.mode ?? "answer";
  }

  /** The widget's public render data, or null when unhydrated. */
  protected get publicData(): unknown {
    return this.hydration?.publicData ?? null;
  }

  /**
   * How much this reader may be told about whether their work is right, already
   * resolved by the server against the assignment (see
   * `resolveExerciseFeedback`). `full` when the payload says nothing, which is
   * both the ordinary case and what a payload written before this field existed
   * degrades to.
   *
   * A widget consults it before offering a Check button or drawing detail. It
   * does not have to remember to consult it before claiming the work is right:
   * {@link setMark} refuses that under `none` whatever the widget passes.
   */
  protected get feedback(): ExerciseFeedback {
    return this.hydration?.options?.feedback ?? "full";
  }

  /**
   * Whether this widget may show *why*, as opposed to merely whether.
   *
   * The difference between `terse` and `full`: the truth table's per-cell marks,
   * the proof editors' inline compiler squiggles, the sentence naming which
   * formula came out wrong. Under `terse` the correctness mark still speaks, and
   * the student goes hunting for the error themselves — which is the whole point
   * of the setting, and is how Carnap's `nocheck`-adjacent modes have always
   * read.
   *
   * The four proof types get the roughest deal from it, and knowingly: their
   * compiler's diagnostics do not distinguish "this is not a proof" from "you
   * typed a bracket wrong", so withholding the first withholds the second. An
   * author choosing `terse` on a proof is choosing that.
   */
  protected get showsDetail(): boolean {
    return this.feedback === "full";
  }

  /** The viewer's own prior answer for this attempt, or null when none. */
  protected get priorAnswer(): unknown {
    return this.hydration?.priorAnswer ?? null;
  }

  /**
   * Interface text in the viewer's language, from the strings the server put in
   * the hydration payload, with `{name}` placeholders filled from `values`.
   *
   * No i18n runtime ships to the browser: ids *are* the English source text, so
   * a payload without this string (or without a `strings` map at all) renders
   * that English. Substitution is the only formatting available here — see
   * `ExerciseHydration.strings` for what that rules out of the copy.
   */
  protected t(
    id: StringId,
    values?: Readonly<Record<string, number | string>>,
  ): string {
    return formatMessage(this.hydration?.strings?.[id] ?? id, values);
  }

  /**
   * Read the exercise hydration payload, most specific channel first: inside the
   * element (a self-contained widget), then inside the enclosing form (the
   * interactive path, whose payload carries the student's prior answer), then
   * the document's hydration table keyed by exercise id (a preview, which has no
   * forms — see the worker's `exerciseHydrationForArtifact`).
   */
  private readHydration(): ExerciseHydration | null {
    const script =
      this.querySelector<HTMLScriptElement>(
        "script[data-exercise-hydration]",
      ) ??
      this.form?.querySelector<HTMLScriptElement>(
        "script[data-exercise-hydration]",
      ) ??
      null;

    if (script === null) {
      return this.readHydrationFromDocument();
    }

    try {
      return JSON.parse(script.textContent ?? "") as ExerciseHydration;
    } catch (_error) {
      return null;
    }
  }

  /** This element's entry in the document-scoped hydration table, if any. */
  private readHydrationFromDocument(): ExerciseHydration | null {
    const exerciseId = this.dataset.exerciseId;
    const table = document.querySelector<HTMLScriptElement>(
      "script[data-exercise-hydration-map]",
    );

    if (exerciseId === undefined || table === null) {
      return null;
    }

    try {
      const parsed = JSON.parse(table.textContent ?? "{}") as Record<
        string,
        ExerciseHydration
      >;

      return parsed[exerciseId] ?? null;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Set the exercise's correctness mark — the shared indicator in the action
   * bar (see `worker/exercises/correctness-mark.ts`).
   *
   * A widget that can grade itself in the browser calls this with its own
   * verdict, which overrides whatever the runtime last wrote there from the
   * recorded evaluation. That is the right precedence: the runtime's answer is
   * about the submission the server holds, this one is about the work on
   * screen, and only one of those is what the reader is looking at. A widget
   * whose local verdict lapses — the grid was edited, the proof stopped
   * compiling — passes `idle` rather than leaving a stale claim up.
   *
   * `title` is the specific complaint behind an `error`, shown on hover; it is
   * cleared on every other state so a fixed problem does not linger there.
   *
   * Under `feedback: "none"` this refuses to make the claim at all: `ok` and
   * `working` both come out `idle`. That is the whole reported bug — the server
   * withheld an exam's verdict and the widget wrote a green check over the top
   * of the same mark, because the mark is one element and the widget was the
   * last to touch it. Enforcing it here rather than in six widgets means a
   * seventh cannot reintroduce it by forgetting.
   *
   * `error` still passes: a proof engine that will not load is a malfunction,
   * not a verdict, and a student staring at a dead widget should be told.
   * `working` is clamped rather than shown because a spinner that always
   * resolves to a dash is a promise the mark cannot keep.
   */
  protected setMark(state: CorrectnessMarkState, title?: string): void {
    if (this.feedback === "none" && state !== "error") {
      state = "idle";
    }

    // The form when there is one, this element otherwise: a preview renders the
    // action bar (and so the mark) inside the element, with no form around it,
    // and an author trying their own exercise wants the same verdict a student
    // will get. Looking inside the element first would be wrong on the
    // submission path, where a page holds many exercises — but there the bar is
    // inside the element *and* inside its form, so the wider search still lands
    // on the right one.
    const mark = (this.form ?? this).querySelector<HTMLElement>(
      `.${CORRECTNESS_MARK_CLASS}`,
    );

    if (mark == null) {
      return;
    }

    mark.dataset.state = state;

    // The names for all four states ride on the element the server rendered,
    // so no widget has to carry four more strings of its own.
    const label = mark.getAttribute(CORRECTNESS_MARK_LABEL_ATTRIBUTES[state]);

    if (label !== null) {
      mark.setAttribute("aria-label", label);
    }

    // `working` has no glyph: the stylesheet draws the spinner for that state,
    // which keeps this method to attribute writes. It matters more than it
    // looks — the base class is browser code that a worker-program test pulls
    // in, and building an SVG here does not typecheck under workers-types.
    mark.textContent =
      state === "working" ? "" : CORRECTNESS_MARK_GLYPHS[state];

    // The tooltip says what the mark means, so hovering answers the question a
    // small coloured glyph raises. A specific complaint beats the state's name
    // when there is one — and empty counts as none, because the two island
    // widgets keep one status record and pass `markTitle: ""` for every state
    // that has nothing to add. Always assigned, so a fixed problem's message
    // cannot linger over a green check.
    mark.title = title === undefined || title === "" ? (label ?? "") : title;
  }

  /**
   * What this widget's own Check has to say, on the line under the button row.
   *
   * The element is the server-rendered one in the shared action bar (see
   * `exercises/actions.ts`), found the same way and for the same reasons as the
   * correctness mark above. Empty text clears the line, which the stylesheet then
   * hides — so "no verdict" and "no line" are one call, and a widget cannot leave
   * a stale sentence standing by forgetting to remove an attribute.
   *
   * `correct` is the only distinction the line draws, because it is the only one
   * a colour can carry honestly: everything else it says — a count of right
   * cells, a failed test, a hint about which row to fill, why a button did
   * nothing — is somewhere on a road to being right, and red for all of it would
   * call an unfinished table an error.
   *
   * Deliberately *not* clamped under `feedback: "none"`, unlike
   * {@link CarnapExerciseElement.setMark}. The mark makes exactly one claim, so
   * withholding it is a decision this class can take alone; this line carries
   * hints and refusals as well as verdicts — a widget that will not submit
   * unparseable text on an exam has to be able to say so — and only the caller
   * knows which it is holding. Each one gates on {@link showsDetail} at the point
   * it words the sentence.
   */
  protected setCheckStatus(text: string, correct = false): void {
    const line = (this.form ?? this).querySelector<HTMLElement>(
      "[data-exercise-check-status]",
    );

    if (line == null) {
      return;
    }

    line.textContent = text;

    if (correct && text !== "") {
      line.dataset.state = "correct";
    } else {
      delete line.dataset.state;
    }
  }

  /**
   * Reflect the current answer into the form's hidden `answerData` field, and
   * re-check whether it still matches what the server has.
   */
  protected syncAnswer(): void {
    const field = this.form?.querySelector<HTMLInputElement>(
      'input[name="answerData"]',
    );

    if (field != null) {
      field.value = JSON.stringify(this.getAnswer());
    }

    this.markUnsaved();
  }
}

/**
 * An answer with the compiled proof certificate left out.
 *
 * All four proof types carry an `mmb` field that the engine derives from the
 * proof text — asynchronously, on a debounce, and reset to empty on every
 * keystroke in between. It is the machine's work rather than the reader's, and
 * the exception that {@link CarnapExerciseElement.authoredAnswer} exists for;
 * naming it once here beats four copies of the reasoning.
 */
export function withoutCertificate(answer: unknown): unknown {
  const { mmb: _certificate, ...authored } = answer as { mmb?: unknown };

  return authored;
}

/**
 * Define a custom element once. Bundles may load more than once (e.g. two
 * revisions of the same content on a page), and a second `define` for the same
 * tag throws — so guard it.
 */
export function register(tag: string, ctor: CustomElementConstructor): void {
  if (customElements.get(tag) === undefined) {
    customElements.define(tag, ctor);
  }
}
