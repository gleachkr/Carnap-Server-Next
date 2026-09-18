import type { CompiledSystems } from "../../worker/domain/content";
import type { ExerciseFeedback } from "../../worker/domain/exercises";
import {
  ANSWER_RECORDED_EVENT,
  UNSAVED_ANSWER_ATTRIBUTE,
} from "../../worker/exercise-kit/answer-events";
import {
  CORRECTNESS_MARK_CLASS,
  CORRECTNESS_MARK_GLYPHS,
  CORRECTNESS_MARK_LABEL_ATTRIBUTES,
  type CorrectnessMarkState,
} from "../../worker/exercise-kit/correctness-mark";
import type {
  ExerciseHydration,
  ExerciseHydrationMode,
} from "../../worker/exercise-kit/hydration";
import { withSystemText } from "../../worker/exercise-kit/systems/join";
import { formatMessage } from "../../worker/i18n/translator";

/**
 * The systems tables already read, by the document each was read from.
 *
 * Cached because every element on the page asks for the same one and the answer
 * cannot change once it is there — so a lesson of thirty proofs would otherwise
 * re-parse the same 30 KB of JSON thirty times on connect. Keyed by document
 * rather than held in a module variable because a page can hold more than one:
 * the revision editor's preview builds a whole content document into a `srcdoc`
 * frame, and its table is not this one's.
 */
const systemsByDocument = new WeakMap<Document, CompiledSystems>();

/**
 * The slice of `localStorage` the draft code uses, spelled structurally
 * because this module also typechecks under workers-types, which has neither
 * `Storage` nor the global. At runtime it is only ever the real thing.
 */
interface DraftStorage {
  readonly length: number;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

const DRAFT_KEY_PREFIX = "carnap:draft:";
const DRAFT_VERSION = 1;

/**
 * How long an untouched draft survives. There is no signal here for "the
 * attempt is over" — localStorage outlives every page — so age is the only
 * bound on growth. A month comfortably covers any assignment window while
 * keeping a semester of abandoned attempts from accumulating forever.
 */
const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface DraftRecord {
  /** The authored answer at save time — `authoredAnswer()`, JSON text. */
  readonly authored: string;
  /** What the server held at save time, for the unsaved-work comparison. */
  readonly saved: string;
  readonly savedAt: number;
  readonly version: number;
}

/**
 * The page's localStorage, or null when there is none to use — a disabled
 * store throws on the property read itself, and drafts are best-effort
 * everywhere: no storage means no drafts, never a broken widget.
 */
function draftStorage(): DraftStorage | null {
  try {
    return (
      (globalThis as { localStorage?: DraftStorage }).localStorage ?? null
    );
  } catch (_error) {
    return null;
  }
}

function parseDraftRecord(text: string): DraftRecord | null {
  try {
    const record = JSON.parse(text) as DraftRecord;

    if (
      record.version !== DRAFT_VERSION ||
      typeof record.authored !== "string" ||
      typeof record.saved !== "string" ||
      typeof record.savedAt !== "number"
    ) {
      return null;
    }

    return record;
  } catch (_error) {
    return null;
  }
}

let sweptStaleDrafts = false;

/**
 * Drop drafts past their age bound, and any record no current reader can
 * parse. Opportunistic, like the server's expiring tables: the next answering
 * page pays for the cleanup, once per load.
 */
function sweepStaleDrafts(storage: DraftStorage): void {
  if (sweptStaleDrafts) {
    return;
  }

  sweptStaleDrafts = true;

  try {
    // Downwards, so removals do not shift the keys still to visit.
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);

      if (key === null || !key.startsWith(DRAFT_KEY_PREFIX)) {
        continue;
      }

      const text = storage.getItem(key);
      const record = text === null ? null : parseDraftRecord(text);

      if (record === null || Date.now() - record.savedAt > DRAFT_MAX_AGE_MS) {
        storage.removeItem(key);
      }
    }
  } catch (_error) {
    return;
  }
}

/**
 * The systems table of the document an element is in.
 *
 * Missing or malformed is `undefined` rather than an error: a document whose
 * exercises are set in nothing emits no table at all, and a payload with no key
 * has nothing to look up in one either way.
 *
 * Only a table that was *found* is remembered. Caching the absence would be
 * caching an answer that can still change — the script sits at the foot of the
 * body, after the elements — and the saving it would buy is one `querySelector`
 * against a document that has no table to parse anyway.
 */
function documentSystems(owner: Document): CompiledSystems | undefined {
  const cached = systemsByDocument.get(owner);

  if (cached !== undefined) {
    return cached;
  }

  const script = owner.querySelector<HTMLScriptElement>(
    "script[data-carnap-systems]",
  );

  if (script === null) {
    return undefined;
  }

  try {
    const systems = JSON.parse(script.textContent ?? "{}") as CompiledSystems;

    systemsByDocument.set(owner, systems);

    return systems;
  } catch (_error) {
    return undefined;
  }
}

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
 * The base also keeps a local draft of unsaved work (see {@link resolveDraftKey}
 * and the write in {@link markUnsaved}): every edit mirrors the authored answer
 * into localStorage, a recorded submission clears it, and a draft that survives
 * — a crash, a dead battery — is restored on the next connect through the
 * `priorAnswer` channel. Widgets need no code for any of this; a widget whose
 * answer carries derived state opts it out of the draft the same way it opts it
 * out of the unsaved-work check, by overriding {@link authoredAnswer}.
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

  /** The check a submission is waiting on (see {@link holdSubmit}). */
  private held: Promise<void> | null = null;

  /** This exercise's draft key, or null when drafts are off (see resolveDraftKey). */
  private draftKey: string | null = null;

  /**
   * Whether draft writes may happen yet. False until connect has settled
   * `savedAnswer`: the `syncAnswer` inside `connectedCallback` runs before the
   * baseline exists, and a write then would store the pristine render as a
   * draft of itself.
   */
  private draftReady = false;

  /** The last record written, to skip rewriting an unchanged draft. */
  private lastDraft: { authored: string; saved: string } | null = null;

  connectedCallback(): void {
    this.form = this.closest<HTMLFormElement>("form.exercise-submission");
    this.hydration = this.readHydration();
    this.draftKey = this.resolveDraftKey();

    // A surviving draft is unsaved work from a page that never came back — a
    // crash, a dead battery. It restores through the priorAnswer channel
    // because a draft *is* a prior answer that never got recorded: same
    // envelope, same rendering path, so no widget knows drafts exist.
    const draft = this.readDraft();

    if (draft !== null && this.hydration !== null) {
      this.hydration = { ...this.hydration, priorAnswer: draft.prior };
    }

    try {
      this.enhance();
    } catch (error) {
      // A draft the widget cannot render must not brick the exercise on every
      // load. Dropping it makes the failure notice's advice — reload — true.
      if (draft !== null) {
        this.removeDraft();
      }

      throw error;
    }

    this.syncAnswer();

    // What the element just rendered is the server's own state arriving, not an
    // edit — so it is the mark everything after it is measured against. Under a
    // restored draft the render is *ahead* of the server, and the baseline is
    // the one the draft was measured against, so the unsaved flag (and the
    // beforeunload guard it drives) comes up already set.
    if (draft === null) {
      this.savedAnswer = this.authoredAnswer();
      this.markUnsaved(this.savedAnswer);
    } else {
      this.savedAnswer = draft.saved;
      this.markUnsaved();
    }

    this.draftReady = true;

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
    const unsaved = answer !== this.savedAnswer;

    this.toggleAttribute(UNSAVED_ANSWER_ATTRIBUTE, unsaved);

    // The same comparison decides the draft: work the server lacks is exactly
    // what is worth a local copy, and work it has needs none — which makes a
    // recorded submission clear the draft with no listener of its own, since
    // the recorded-answer handler lands here with the two sides equal.
    if (!this.draftReady) {
      return;
    }

    if (unsaved) {
      this.writeDraft(answer);
    } else {
      this.removeDraft();
    }
  }

  /**
   * Where drafts for this exercise live, or null for none. Only the answering
   * path keeps drafts: review mode shows recorded work, and a formless element
   * (a preview) has no attempt. The form's `action` already names the attempt
   * — `/courses/…/attempts/{id}/submissions` — so together with the exercise
   * id it is the "exercise id and attempt" key with no new markup. It is *not*
   * keyed by content revision, deliberately: a revision published mid-attempt
   * changes `priorAnswer`'s fit too, and a draft should survive exactly as
   * well as a prior answer does.
   */
  private resolveDraftKey(): string | null {
    if (this.mode !== "answer" || this.form === null) {
      return null;
    }

    const action = this.form.getAttribute("action");
    const exerciseId =
      this.form.dataset.exerciseId ?? this.dataset.exerciseId;

    if (action === null || action === "" || exerciseId === undefined) {
      return null;
    }

    return `${DRAFT_KEY_PREFIX}${action}#${exerciseId}`;
  }

  /**
   * The stored draft for this exercise, vetted for restoring: a parseable
   * record whose answer parses and actually differs from what the server held.
   * Anything less is removed on the spot, so a corrupted draft costs one
   * reload rather than failing every one.
   */
  private readDraft(): {
    prior: ExerciseHydration["priorAnswer"];
    saved: string;
  } | null {
    if (this.draftKey === null) {
      return null;
    }

    const storage = draftStorage();

    if (storage === null) {
      return null;
    }

    sweepStaleDrafts(storage);

    let text: string | null = null;

    try {
      text = storage.getItem(this.draftKey);
    } catch (_error) {
      return null;
    }

    if (text === null) {
      return null;
    }

    const record = parseDraftRecord(text);

    if (record === null || record.authored === record.saved) {
      this.removeDraft();
      return null;
    }

    try {
      return {
        prior: JSON.parse(
          record.authored,
        ) as ExerciseHydration["priorAnswer"],
        saved: record.saved,
      };
    } catch (_error) {
      this.removeDraft();
      return null;
    }
  }

  private writeDraft(authored: string): void {
    if (
      this.draftKey === null ||
      (this.lastDraft?.authored === authored &&
        this.lastDraft.saved === this.savedAnswer)
    ) {
      return;
    }

    const storage = draftStorage();

    if (storage === null) {
      return;
    }

    // Unthrottled by design: a trailing debounce would lose the last seconds
    // before a crash, which is the one moment drafts exist for, and an answer
    // is a few kilobytes at worst. Failure — quota, a locked-down store — just
    // means no draft; the beforeunload guard still covers deliberate leaving.
    try {
      storage.setItem(
        this.draftKey,
        JSON.stringify({
          authored,
          saved: this.savedAnswer,
          savedAt: Date.now(),
          version: DRAFT_VERSION,
        }),
      );
      this.lastDraft = { authored, saved: this.savedAnswer };
    } catch (_error) {
      return;
    }
  }

  private removeDraft(): void {
    if (this.draftKey === null) {
      return;
    }

    this.lastDraft = null;

    try {
      draftStorage()?.removeItem(this.draftKey);
    } catch (_error) {
      return;
    }
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
   * Whether a wrong answer is kept — the assignment's exam-ness, resolved by
   * the server for this reader (`resolveExerciseExam`); false when the payload
   * says nothing, which is every payload written before the field existed and
   * every render outside an assignment.
   *
   * What a widget does with it is let go: an answer it would otherwise hold
   * back for the student's own good, on an exam, is one they must be able to
   * hand in as it stands. It does not decide what is shown — that is
   * {@link feedback}, which an exam usually seals but need not.
   */
  protected get exam(): boolean {
    return this.hydration?.options?.exam === true;
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
   *
   * Whichever channel answers, the payload names the system this exercise is
   * set in rather than carrying its text, and {@link joinSystems} puts the text
   * back from the document's own table. The join is here, at the one point
   * every payload passes through, so that no widget has to know the table
   * exists: what `publicData` hands `enhance` is what it always was.
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
      return this.joinSystems(this.readHydrationFromDocument());
    }

    try {
      return this.joinSystems(
        JSON.parse(script.textContent ?? "") as ExerciseHydration,
      );
    } catch (_error) {
      return null;
    }
  }

  /**
   * The payload with its system's MM0 spliced into `publicData`, read from the
   * document-scoped table the content document emits beside the component asset
   * list.
   *
   * A missing table is not a failure to report: a payload that froze its own
   * text (every artifact compiled before the table existed) has nothing to look
   * up, and `withSystemText` passes it through.
   */
  private joinSystems(
    hydration: ExerciseHydration | null,
  ): ExerciseHydration | null {
    if (hydration === null) {
      return null;
    }

    return {
      ...hydration,
      publicData: withSystemText(
        hydration.publicData,
        documentSystems(this.ownerDocument),
      ),
    };
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
   * bar (see `worker/exercise-kit/correctness-mark.ts`).
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
   * `exercise-kit/actions.ts`), found the same way and for the same reasons as the
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
   * Register a gate on the form's submission: a listener that may
   * `preventDefault()` to keep the answer from leaving — text a syntax gate
   * refuses, a check that has not settled.
   *
   * It listens in the capture phase, and that is the whole point. The page's
   * exercise runtime replaces native submission with a `fetch`, and it does so
   * from a bubbling listener registered before any element upgrades (the
   * component bundles load after the runtime script). At the event's target the
   * capturing listeners run first regardless of registration order, so this is
   * the one way a widget's refusal can be seen by the runtime, which checks
   * `defaultPrevented` before it sends anything. A plain `addEventListener`
   * here would run after the request had already gone.
   */
  protected gateSubmit(gate: (event: Event) => void): void {
    this.form?.addEventListener("submit", gate, { capture: true });
  }

  /**
   * From inside a gate: keep this submission until `settling` resolves, then
   * submit again. For a check still pending or running at the moment of
   * submit — a translation's equivalence search, a proof's compile — whose
   * result the answer, or the gate itself, is waiting on. The gate runs again
   * on the resubmit, so a hold followed by a refusal is one gate with two
   * outcomes.
   *
   * Idempotent over the same promise: a second click while held changes
   * nothing. An edit that makes the held check stale should {@link dropHold},
   * or the resubmit would send the answer the student had already moved on
   * from.
   */
  protected holdSubmit(event: Event, settling: Promise<void>): void {
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
  }

  /** Forget a held submission: the answer changed under it. */
  protected dropHold(): void {
    this.held = null;
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
