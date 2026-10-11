import {
  type Diagnostic,
  forEachDiagnostic,
  openLintPanel,
  setDiagnostics,
} from "@codemirror/lint";
import { EditorState, type Extension, StateEffect } from "@codemirror/state";
import {
  type Command,
  closeHoverTooltips,
  Decoration,
  type DecorationSet,
  EditorView,
  hasHoverTooltips,
  keymap,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { ProofEditorStringId } from "../../worker/exercise-kit/proof/editor-strings";
import type { ProofEngineStringId } from "../../worker/exercise-kit/proof/engine-strings";
import {
  createHelpDialog,
  HELP_DIALOG_STYLES,
  mountHelpTrigger,
  openHelpDialog,
} from "./help-dialog";
import { mountProblemLine, type ProblemLine } from "./problem-line";
import {
  type ProblemText,
  plainProblem,
  problemNodes,
  problemsNodes,
} from "./proof-problem";

/**
 * What the two CodeMirror proof editors — linear `.auf` and Fitch — share
 * around their views: the chrome mounted above the action bar, the goal
 * declaration shown in it, the two ways a compiler's diagnostics reach
 * the lint layer, the keys that reach them back out of it, and the help
 * dialog that says so. The pipeline behind the editor is `./proof-element.ts`,
 * shared with the tree and Prawitz islands as well.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** What {@link mountProofEditor} put in the shadow root. */
export interface ProofEditorChrome {
  /** The `.proof` card the server rendered, now without its inert source. */
  readonly container: HTMLElement;
  /** Where the CodeMirror view goes. */
  readonly host: HTMLElement;
  /** The goal row's statement, which a playground rewrites per compile. */
  readonly statement: HTMLElement;
  /** Under the editor: where F8 leaves the problem it went to. Empty, and
   *  hidden, until {@link problemKeys} puts one there. */
  readonly problems: ProblemLine;
}

/**
 * Replace the server's inert proof source with the editor's chrome: the
 * widget's styles, a goal row (`label` before `statement`, the statement
 * empty in a playground until the proof says what it proves), an empty
 * host for the view, and the problem line under it. All go in above the
 * projected action bar
 * (`slot="exercise-actions"`), which sits at the card's foot, not appended
 * after it. `null` when the card is not there to enhance.
 */
export function mountProofEditor(
  root: ShadowRoot,
  styles: string,
  goal: { readonly label: string; readonly statement: string },
): ProofEditorChrome | null {
  const container = root.querySelector<HTMLElement>(".proof");
  if (container === null) {
    return null;
  }
  root.querySelector(".proof-source")?.remove();

  const style = document.createElement("style");
  style.textContent = styles;
  root.appendChild(style);

  const actionsSlot = container.querySelector<HTMLElement>(
    'slot[name="exercise-actions"]',
  );

  const row = document.createElement("div");
  row.className = "proof-goal";
  const label = document.createElement("span");
  label.className = "proof-goal-label";
  label.textContent = goal.label;
  const statement = document.createElement("span");
  statement.className = "proof-goal-statement";
  statement.textContent = goal.statement;
  // The space is for text readers; the row's gap draws the visible one.
  row.append(label, " ", statement);
  container.insertBefore(row, actionsSlot);

  const host = document.createElement("div");
  host.className = "proof-editor";
  container.insertBefore(host, actionsSlot);
  const problems = mountProblemLine(root, container, actionsSlot);

  return { container, host, problems, statement };
}

/**
 * A diagnostic, and the problem it draws: `message` is the problem as text
 * (`problemText`), for F8 to say; `problem`, where there is one, is what the
 * tooltip, the error list and the problem line draw — a rule's shape as
 * boxes rather than text. A diagnostic without one draws its message.
 */
export interface ProofDiagnostic extends Diagnostic {
  readonly problem?: ProblemText;
}

/** The problem a diagnostic draws. */
function problemOf(diagnostic: ProofDiagnostic): ProblemText {
  return diagnostic.problem ?? plainProblem(diagnostic.message);
}

/** Hand the lint layer what to underline; empty clears it. */
export function showDiagnostics(
  editor: EditorView,
  diagnostics: readonly ProofDiagnostic[],
): void {
  editor.dispatch(setDiagnostics(editor.state, diagnostics.map(numbered)));
}

/**
 * The diagnostic, drawn with the number of the line it is on before its
 * message. The number is for the error list (Mod-Shift-M), where a message
 * stands apart from the proof; the hover bubble, drawn by the same renderer
 * beside the squiggle itself, hides it (`./proof-editor.css`). It is counted
 * where the diagnostic lies when drawn, not where it was reported: the list
 * can open after edits the next compile has not yet caught up with.
 *
 * Worded through the state's phrases, where {@link problemKeys} puts the
 * reader's language; `message` is left as it was, for F8 and the problem line.
 */
function numbered(diagnostic: ProofDiagnostic): ProofDiagnostic {
  const drawn: ProofDiagnostic = {
    ...diagnostic,
    renderMessage(view) {
      let from = diagnostic.from;
      forEachDiagnostic(view.state, (each, start) => {
        if (each === drawn) {
          from = start;
        }
      });
      const line = document.createElement("span");
      line.className = "cm-diagnosticLine";
      line.textContent = view.state.phrase(
        "Line $1",
        view.state.doc.lineAt(Math.min(from, view.state.doc.length)).number,
      );
      const text = document.createElement("span");
      text.append(line, " ", ...problemNodes(problemOf(diagnostic)));
      return text;
    },
  };
  return drawn;
}

/**
 * The compiler threw before it could report diagnostics: one generic marker
 * at the start of the body rather than a stranded spinner — or none, where
 * `message` is null because detail is withheld.
 */
export function showCompileFailure(
  editor: EditorView,
  message: string | null,
): void {
  showDiagnostics(
    editor,
    message === null
      ? []
      : [
          {
            from: 0,
            message,
            severity: "error",
            to: Math.min(editor.state.doc.length, 1),
          },
        ],
  );
}

/**
 * Whether CodeMirror reads `Mod` as Cmd, by its own test: the help dialog
 * names the keys as they are bound, not as some other platform's are.
 */
const MAC = /Mac/.test(navigator.platform);

/** Either editor's `t()`, narrowed to the text the helpers here say. */
type ProofEditorText = (
  id: ProofEditorStringId | ProofEngineStringId,
  values?: Readonly<Record<string, number | string>>,
) => string;

/**
 * The keys that take a reader to the squiggles without a mouse. A squiggle's
 * message is otherwise only a hover tooltip, which a screen reader never
 * meets, and which covers the lines around it.
 *
 * F8 and Shift-F8 step between problems, as they do in the tree and Prawitz
 * editors (`./problem-keys.ts`): each selects the problem's text, says it
 * aloud, and leaves it in `line`, under the editor, with its text tinted
 * ({@link pinnedProblem}). Where CodeMirror's own commands float the tooltip
 * instead, these do not — the line is where a problem gone to by key is read.
 * Mod-Shift-M opens CodeMirror's diagnostics panel, the error list, each
 * entry numbered by its line ({@link numbered}). Escape puts a hovered
 * problem's tooltip away ({@link escapeClosesTooltip}). The help dialog
 * ({@link mountProofEditorHelp}) is where a reader learns of them.
 */
export function problemKeys(
  t: ProofEditorText,
  line: ProblemLine,
): Extension {
  const none = t("No errors.");

  return [
    escapeClosesTooltip,
    pinnedProblem(t, line),
    EditorState.phrases.of({
      close: t("Close"),
      Diagnostics: t("Errors"),
      // CodeMirror fills `$1` itself, so the translation is formatted with
      // it standing in for the number ({@link numbered}).
      "Line $1": t("Line {line}", { line: "$1" }),
      "No diagnostics": none,
    }),
    keymap.of([
      { key: "F8", run: announcing(stepToProblem(1), none) },
      { key: "Shift-F8", run: announcing(stepToProblem(-1), none) },
      { key: "Mod-Shift-m", run: openLintPanel },
    ]),
  ];
}

/** Where a problem is in the document: a diagnostic's range. */
interface ProblemRange {
  readonly from: number;
  readonly to: number;
}

/** Pin the problem at this range in the problem line. */
const pinProblem = StateEffect.define<ProblemRange>();

/** The distinct ranges the problems cover, in document order: the places F8
 *  stops, one for several problems on the same text. */
function problemRanges(state: EditorState): ProblemRange[] {
  const ranges: ProblemRange[] = [];
  forEachDiagnostic(state, (_diagnostic, from, to) => {
    if (!ranges.some((range) => range.from === from && range.to === to)) {
      ranges.push({ from, to });
    }
  });
  return ranges.sort((a, b) => a.from - b.from || a.to - b.to);
}

/**
 * Select the next problem after the selection — the previous one, for a
 * `step` of -1 — wrapping at either end, and pin it. CodeMirror's
 * `nextDiagnostic` and `previousDiagnostic`, stepping the same way, without
 * the tooltip they float. Declines where there is nowhere to go: no problems,
 * or only the one already selected — which is pinned all the same, since the
 * reader pressed the key to see it.
 */
function stepToProblem(step: -1 | 1): Command {
  return (view) => {
    const ranges = problemRanges(view.state);
    const selection = view.state.selection.main;
    const target =
      step === 1
        ? (ranges.find((range) => range.to > selection.to) ?? ranges[0])
        : ([...ranges].reverse().find((range) => range.to < selection.to) ??
          ranges.at(-1));

    if (target === undefined) {
      return false;
    }
    if (target.from === selection.from && target.to === selection.to) {
      view.dispatch({ effects: pinProblem.of(target) });
      return false;
    }

    view.dispatch({
      effects: pinProblem.of(target),
      scrollIntoView: true,
      selection: { anchor: target.from, head: target.to },
    });
    return true;
  };
}

/** Whether a problem's range is the pinned one, or lies across it. An empty
 *  range — a problem at a point — counts where it touches. */
function overlaps(range: ProblemRange, pinned: ProblemRange): boolean {
  return range.from === range.to || pinned.from === pinned.to
    ? range.from <= pinned.to && range.to >= pinned.from
    : range.from < pinned.to && range.to > pinned.from;
}

const pinnedMark = Decoration.mark({ class: "cm-problem-pinned" });

/**
 * The problem F8 last went to, held in the problem line and tinted in the
 * text, until F8 goes to another or the problem is gone.
 *
 * The pin is a place, carried through edits, not a diagnostic: the compiler
 * replaces every diagnostic on each run, and a reader fixing a line the
 * problem cites should not see it vanish because the run that followed
 * re-reported it. Whatever problems lie across that place are the ones the
 * line says, and the pin follows their span; when none do, the problem was
 * fixed, and the line clears.
 */
function pinnedProblem(t: ProofEditorText, line: ProblemLine): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private pinned: ProblemRange | null = null;

      update(update: ViewUpdate): void {
        let pinned = this.pinned;
        if (pinned !== null && update.docChanged) {
          pinned = {
            from: update.changes.mapPos(pinned.from, 1),
            to: update.changes.mapPos(pinned.to, -1),
          };
        }
        for (const transaction of update.transactions) {
          for (const effect of transaction.effects) {
            if (effect.is(pinProblem)) {
              pinned = effect.value;
            }
          }
        }
        this.show(update.state, pinned);
      }

      destroy(): void {
        line.clear();
      }

      private show(state: EditorState, pinned: ProblemRange | null): void {
        if (pinned === null && this.pinned === null) {
          return;
        }
        const ranges = problemRanges(state);
        const here =
          pinned === null
            ? []
            : ranges.filter((range) => overlaps(range, pinned));
        const first = here[0];

        if (first === undefined) {
          this.pinned = null;
          this.decorations = Decoration.none;
          line.clear();
          return;
        }

        this.pinned = {
          from: first.from,
          to: Math.max(...here.map((range) => range.to)),
        };
        const said: ProofDiagnostic[] = [];
        forEachDiagnostic(state, (diagnostic, from, to) => {
          if (here.some((range) => range.from === from && range.to === to)) {
            said.push(diagnostic);
          }
        });
        line.show({
          content: problemsNodes(said.map(problemOf)),
          position: t("{index} of {count}", {
            count: ranges.length,
            index: ranges.indexOf(first) + 1,
          }),
          severity: said.some((diagnostic) => diagnostic.severity === "error")
            ? "error"
            : "warning",
          where: t("Line {line}", {
            line: state.doc.lineAt(first.from).number,
          }),
        });
        this.decorations = Decoration.set(
          here
            .filter((range) => range.to > range.from)
            .map((range) => pinnedMark.range(range.from, range.to)),
        );
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/**
 * Escape closes a problem's tooltip, wherever focus is. A tooltip can cover the
 * lines above or below it, and one floated by hovering stays until the pointer
 * moves; content that appears on hover has to be dismissible without moving
 * the pointer (WCAG 1.4.13), and CodeMirror binds no key to do it.
 *
 * So the listener is on the document, not the editor's keymap: a pointer can
 * float a tooltip while focus is anywhere on the page. It acts only while this
 * editor has one open, and lets the key go on, so Escape still does whatever
 * else it does where focus is.
 */
const escapeClosesTooltip = ViewPlugin.fromClass(
  class {
    private readonly document: Document;

    constructor(private readonly view: EditorView) {
      this.document = view.dom.ownerDocument;
      this.document.addEventListener("keydown", this.onKeydown);
    }

    destroy(): void {
      this.document.removeEventListener("keydown", this.onKeydown);
    }

    private readonly onKeydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && hasHoverTooltips(this.view.state)) {
        this.view.dispatch({ effects: closeHoverTooltips });
      }
    };
  },
);

/**
 * The `(?)` in the action bar and the instructions behind it, as the tree and
 * Prawitz editors have them: the editor's own paragraphs and then the one on
 * reading the verdict, and the keys the two editors share. The problem keys
 * are listed only where `problems` says they are bound — not where feedback
 * withholds the problems.
 *
 * There is no `?` key to open it, as there is on a tree's line: here `?` is
 * something a student may want to type.
 */
export function mountProofEditorHelp(
  element: HTMLElement,
  root: ShadowRoot,
  t: ProofEditorText,
  content: { readonly intro: readonly string[]; readonly title: string },
  problems: boolean,
): void {
  const style = document.createElement("style");
  style.textContent = HELP_DIALOG_STYLES;
  root.appendChild(style);

  const mod = MAC ? "Cmd" : "Ctrl";
  const dialog = createHelpDialog({
    close: t("Close help"),
    intro: [
      ...content.intro,
      t(
        "The mark beside the Submit button shows whether the proof checks. A line with an error is underlined. Hover it to read what is wrong, or press F8 to go to it: the error then stays below the proof while you fix it.",
      ),
    ],
    keyboard: t("Keyboard"),
    shortcuts: [
      { action: t("Undo"), keys: [`${mod}-Z`] },
      { action: t("Redo"), keys: [MAC ? "Cmd-Shift-Z" : "Ctrl-Y"] },
      ...(problems
        ? [
            { action: t("Go to the next error"), keys: ["F8"] },
            { action: t("Go to the previous error"), keys: ["Shift-F8"] },
            { action: t("List every error"), keys: [`${mod}-Shift-M`] },
            { action: t("Close the error message"), keys: ["Esc"] },
          ]
        : []),
    ],
    title: content.title,
  });
  root.appendChild(dialog);

  mountHelpTrigger(element, t("Usage and keyboard shortcuts"), (trigger) =>
    openHelpDialog(dialog, trigger),
  );
}

/**
 * Run a step between diagnostics, then say what the selection landed on —
 * every message on it, or `none` when there was nowhere to land. The step
 * itself declines when the only problem is already selected; the reader
 * pressed the key to hear it, so it is said again.
 */
function announcing(step: Command, none: string): Command {
  return (view) => {
    step(view);
    const { from, to } = view.state.selection.main;
    const said: string[] = [];
    forEachDiagnostic(view.state, (diagnostic, start, end) => {
      if (start <= from && end >= to) {
        said.push(diagnostic.message);
      }
    });
    view.dispatch({
      effects: EditorView.announce.of(
        said.length > 0 ? said.join(" ") : none,
      ),
    });
    return true;
  };
}
