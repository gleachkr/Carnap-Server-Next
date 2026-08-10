import { buildDiagnosticStrings } from "../application/content/diagnostic-strings";
import type { EvaluatorKind } from "../domain/assessment";
import { buildExerciseActionsStrings } from "../exercises/actions";
import {
  EXERCISE_STRING_ASSET_IDS,
  exerciseStrings,
} from "../exercises/strings";
import {
  formatMessage,
  placeholders,
  type Translator,
} from "../i18n/translator";
import { jsonScriptContent } from "./json-script";
import {
  evaluatorKindLabel,
  type ReviewState,
  reviewStateLabel,
} from "./labels";

/**
 * Strings for the server-generated inline enhancement scripts.
 *
 * Those scripts are JavaScript we emit as text, so they cannot call `i18n.t`
 * themselves — and interpolating translated prose into a script body would put
 * arbitrary text inside a string literal we are also escaping for HTML. Instead
 * each script gets a sibling `<script type="application/json">` payload and
 * reads it through {@link readStringsPrelude}, which is the pattern the exercise
 * runtime already uses for its state (`data-carnap-exercise-runtime-state`).
 *
 * Every lookup in a script is written `S.key || "English"`, so a page cached
 * from before a payload existed still says something sensible.
 *
 * One payload per document region, each rendered next to the script that reads
 * it: the layout owns the chrome strings, the assignment page owns its own. A
 * single shared payload would mean the layout had to know what the assignment
 * page's scripts need.
 */

/**
 * Resolve a builder's messages, keeping only the ones the browser could not
 * have worked out for itself.
 *
 * Every payload here is a lookup with an English fallback on the reading side,
 * so an entry whose translation *is* the text the reader would have fallen back
 * to is bytes on the wire that change nothing. In English that is all of them:
 * the diagnostics map alone measured 9.2 KB on every English editor page, 73
 * sentences each mapped to itself.
 *
 * The filter runs while the builder resolves rather than over the finished map,
 * because the fallback is `options.message ?? id` — a disambiguated id
 * ("Correct (truth-table cell)" displaying "Correct") is just as redundant when
 * it resolves to its own display text, and only the call knows that. For the
 * same reason the keys here are catalog *ids*, not whatever the builder chose to
 * key its own map by: an id is what {@link payloadTranslator} will be asked for.
 */
function translatedStrings(
  build: (i18n: Translator) => unknown,
  i18n: Translator,
): Readonly<Record<string, string>> {
  const kept: Record<string, string> = {};

  build({
    locale: i18n.locale,
    t: (id, values, options) => {
      const text = i18n.t(id, values, options);

      if (text !== (options?.message ?? id)) {
        kept[id] = text;
      }

      return text;
    },
  });

  return kept;
}

/**
 * The reading side of a strings payload: a {@link Translator} answering from
 * text the server resolved ahead of time.
 *
 * For a browser that re-runs server render code. The editor's preview bundle
 * rebuilds the whole content document on every keystroke, through the same
 * `contentDocumentHtml` and `exerciseStrings` the server render used — and those
 * ask for their prose through a `Translator`. Handing them this one is what
 * keeps a rebuild in the page's language: it used to pass
 * `passthroughTranslator`, so an author's first keystroke turned every widget
 * label and the `<noscript>` sentence English while the document went on
 * declaring `lang="de"`.
 *
 * A miss falls back exactly as a catalog lookup does — the explicit display
 * message if there is one, otherwise the id — which is what lets
 * {@link translatedStrings} drop every entry that resolves to its own source
 * text. Substitution only, never ICU: see {@link formatMessage}.
 *
 * `locale` is the tag `strings` was resolved for, and comes out of the same
 * payload, so a rebuild cannot word itself in one language while declaring
 * another.
 */
export function payloadTranslator(
  strings: Readonly<Record<string, string>>,
  locale: string,
): Translator {
  return {
    locale,
    t: (id, values, options) =>
      formatMessage(strings[id] ?? options?.message ?? id, values),
  };
}

/** The layout's always-present enhancement scripts. */
export interface LayoutUiStrings {
  readonly copied: string;
  readonly copyFailed: string;
  /**
   * The page's resolved locale, so `Intl` formatting inside the scripts matches
   * the language the page is written in rather than the browser's own.
   */
  readonly locale: string;
}

export function layoutUiStrings(i18n: Translator): LayoutUiStrings {
  return {
    copied: i18n.t("Copied"),
    copyFailed: i18n.t("Copy failed"),
    locale: i18n.locale,
  };
}

/** The exercise submission runtime and the component-failure notice. */
export interface ExerciseUiStrings {
  readonly loadFailed: string;
  readonly noAnswerFields: string;
  readonly noSubmission: string;
  readonly notRecorded: string;
  readonly submitFailed: string;
  /** Both status sentences, whole, so a translator owns the word order. */
  readonly submittedAt: string;
  readonly submittedAtScored: string;
  readonly submitting: string;
}

export function exerciseUiStrings(i18n: Translator): ExerciseUiStrings {
  return {
    loadFailed: i18n.t(
      "This exercise couldn't load. Please reload the page.",
    ),
    noAnswerFields: i18n.t("This exercise form has no known answer fields."),
    noSubmission: i18n.t("No submission in this attempt."),
    notRecorded: i18n.t(
      "Not correct yet, so nothing was recorded. Try again.",
    ),
    submitFailed: i18n.t("The submission was not accepted."),
    // Resolved but not filled in: the runtime substitutes the values, since it
    // only learns them from the submission response. `placeholders` is what keeps
    // them intact through the format step.
    submittedAt: i18n.t("Submitted at {when}.", placeholders("when")),
    submittedAtScored: i18n.t(
      "Submitted at {when} · {score}/{maxScore}.",
      placeholders("maxScore", "score", "when"),
    ),
    submitting: i18n.t("Submitting…"),
  };
}

/**
 * Names for the fold controls in a Carnap Markdown source view — the gutter
 * button on a foldable line, and the placeholder that stands in for a folded
 * block.
 *
 * Shared by the two bundles that mount one: the revision editor, which gets them
 * inside {@link EditorUiStrings}, and the read-only viewer on a revision page,
 * which has no payload of its own and takes them off the host element's
 * `data-fold-label` / `data-unfold-label` attributes, the way it already takes
 * its own name from `data-source-label`. One shape either way, so the two views
 * cannot come to name the same control differently.
 */
export interface MarkdownFoldStrings {
  readonly fold: string;
  readonly unfold: string;
}

export function markdownFoldStrings(i18n: Translator): MarkdownFoldStrings {
  return {
    fold: i18n.t("Fold this block"),
    unfold: i18n.t("Unfold this block"),
  };
}

/**
 * The live-preview bundle on the revision editor.
 *
 * That bundle recompiles the author's Markdown in the browser, lists the
 * compiler's diagnostics itself, and rebuilds the whole preview document — all
 * with no catalog to hand, so every word of it has to arrive here. It is a
 * module rather than an inline script, so it reads this payload from the DOM
 * directly instead of through {@link readStringsPrelude}.
 */
export interface EditorUiStrings {
  /** Whole, with the code as a placeholder: the bundle splits it around a `<code>`. */
  readonly diagnostic: string;
  /**
   * Every sentence the compiler can say *that this locale translates*, keyed by
   * its English source text — because which ones it will say is only known once
   * the author has typed something. The bundle resolves a diagnostic against
   * this map the same way the server-side list resolves one against the catalog,
   * so an untranslated sentence needs no entry (see {@link translatedStrings}).
   */
  readonly diagnostics: Readonly<Record<string, string>>;
  /** Names for the source pane's fold controls. */
  readonly fold: MarkdownFoldStrings;
  /** What the bundle needs to rebuild the preview document in this language. */
  readonly preview: EditorPreviewStrings;
  /** The author-only proof-engine checks the preview runs after a clean compile. */
  readonly proofChecks: {
    readonly declaresCleanly: string;
    readonly notVerified: string;
    /** One check's line, with the exercise id as the placeholder. */
    readonly result: string;
    readonly starterVerifies: string;
    readonly unreadableStarter: string;
    readonly unreadableTheory: string;
  };
}

/**
 * Everything the preview *rebuild* words itself with — the exercise widgets and
 * the content document's own prose — plus the language it is all in.
 *
 * One flat map rather than one per widget, because the browser never looks these
 * up itself: it hands them back to the server's own render code through
 * {@link payloadTranslator}, and that code asks by catalog id. The catalog is
 * keyed by id alone, so splitting the map per widget could only duplicate the
 * entries two widgets share — 795 bytes of them in `de` — without telling the
 * reader anything it could act on.
 */
export interface EditorPreviewStrings {
  /**
   * The locale `strings` was resolved for, and therefore the one the rebuilt
   * document declares. It travels with the strings so the two cannot disagree:
   * read off `document.documentElement.lang` instead, the prose and the `lang`
   * attribute are two channels, and a rebuild that lost its prose kept the tag.
   */
  readonly locale: string;
  /** Catalog id → text, for every message a rebuild can ask for. */
  readonly strings: Readonly<Record<string, string>>;
}

/**
 * Ask for every message the preview rebuild can need. Resolved through
 * {@link translatedStrings}, which is what records them.
 */
function buildPreviewStrings(i18n: Translator): void {
  // Every widget's text, not only the types the author has written so far: the
  // payload is fixed when the page is served, and the next keystroke can add an
  // exercise of any type.
  for (const assetId of EXERCISE_STRING_ASSET_IDS) {
    exerciseStrings(assetId, i18n);
  }

  // The content document's own sentence, listed again here because a payload has
  // to exist before anything is rendered. The id is the one `contentDocumentHtml`
  // uses, so both call sites share a single catalog entry — and
  // `tests/editor-preview-strings.test.ts` fails if they ever drift apart.
  i18n.t(
    "This exercise needs JavaScript enabled to load. Please turn it on for this site.",
  );

  // The action bar every exercise in the preview now ends with: the disabled
  // submit, the reason it is disabled, and the four names the correctness mark
  // carries. Rendered by the server's own render code, so the browser only has
  // to have been sent the words.
  buildExerciseActionsStrings(i18n);
}

export function editorUiStrings(
  i18n: Translator,
  locale: string,
): EditorUiStrings {
  return {
    diagnostic: i18n.t(
      "{code} line {line}: {message}",
      placeholders("code", "line", "message"),
    ),
    diagnostics: translatedStrings(buildDiagnosticStrings, i18n),
    fold: markdownFoldStrings(i18n),
    preview: {
      locale,
      strings: translatedStrings(buildPreviewStrings, i18n),
    },
    proofChecks: {
      declaresCleanly: i18n.t("goal declares cleanly ✓"),
      notVerified: i18n.t("not verified"),
      result: i18n.t("{id} — {status}", placeholders("id", "status")),
      starterVerifies: i18n.t("starter verifies ✓"),
      unreadableStarter: i18n.t(
        "the proof engine could not read this starter",
      ),
      unreadableTheory: i18n.t(
        "the proof engine could not read this theory or goal",
      ),
    },
  };
}

/** The instructor review queue's in-place card updates. */
export interface ReviewUiStrings {
  readonly actionFailed: string;
  readonly allReviewed: string;
  /**
   * Who produced the score, keyed by `evaluatorKind` — the script used to print
   * the raw enum value, which stayed English (and untranslated) in every locale.
   */
  readonly evaluators: Readonly<Record<EvaluatorKind, string>>;
  readonly notGraded: string;
  /** The scored status line, whole, filled in by the script. */
  readonly scored: string;
  /** Keyed by machine review state, so the script never compares prose. */
  readonly states: Readonly<Record<ReviewState, string>>;
}

export function reviewUiStrings(i18n: Translator): ReviewUiStrings {
  return {
    actionFailed: i18n.t("The action was not accepted."),
    allReviewed: i18n.t("Every recorded submission has been reviewed."),
    evaluators: {
      automatic: evaluatorKindLabel(i18n, "automatic"),
      manual: evaluatorKindLabel(i18n, "manual"),
    },
    notGraded: i18n.t("Not graded"),
    scored: i18n.t(
      "{score}/{maxScore} · {evaluator}",
      placeholders("evaluator", "maxScore", "score"),
    ),
    states: {
      "auto-graded": reviewStateLabel(i18n, "auto-graded"),
      "needs-review": reviewStateLabel(i18n, "needs-review"),
      reviewed: reviewStateLabel(i18n, "reviewed"),
    },
  };
}

/**
 * Render a strings payload as an inline JSON script, to be placed immediately
 * before the script that reads it.
 */
export function uiStringsScript(attribute: string, strings: object): string {
  return `<script type="application/json" ${attribute}>${jsonScriptContent(
    strings,
  )}</script>`;
}

/**
 * The few lines a script uses to pick its payload up. Returns a statement
 * declaring `binding`; an absent or unparseable payload yields `{}` so every
 * `S.key || "English"` lookup falls through to its default.
 */
export function readStringsPrelude(attribute: string, binding = "S"): string {
  return `  const ${binding} = (() => {
    const element = document.querySelector("[${attribute}]");

    if (element === null) {
      return {};
    }

    try {
      return JSON.parse(element.textContent || "{}");
    } catch (_error) {
      return {};
    }
  })();`;
}

export const LAYOUT_UI_STRINGS_ATTRIBUTE = "data-carnap-ui-strings";
export const EXERCISE_UI_STRINGS_ATTRIBUTE = "data-carnap-exercise-strings";
export const REVIEW_UI_STRINGS_ATTRIBUTE = "data-carnap-review-strings";
export const EDITOR_UI_STRINGS_ATTRIBUTE = "data-carnap-editor-strings";
