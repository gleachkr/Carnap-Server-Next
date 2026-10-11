/**
 * F8 and Shift-F8 in the tree and Prawitz proof editors: the keys that step
 * between the lines with a problem, so a reader who cannot see the squiggles
 * — or hover them — can still reach what they say. The two CodeMirror editors
 * bind the same keys to CodeMirror's own diagnostic commands
 * (`./proof-editor.ts`), so all four proof widgets answer one key alike.
 *
 * Each line with a problem carries a hidden note, named by its treeitem's
 * `aria-describedby` (see {@link problemNoteId}): moving focus there says the
 * line and then its problem. The note is hidden rather than visually hidden,
 * because a description is read from a hidden element all the same, and a
 * reader walking the page in browse mode should not meet every message a
 * second time, out of place.
 *
 * The line F8 goes to is also pinned ({@link PinnedProblem}): its problem is
 * shown in the problem line under the proof and its formula tinted, and both
 * stay while the reader works elsewhere.
 */

import type { ProblemLine } from "./problem-line";
import { copyOfDrawing } from "./proof-problem";

/** The id of the hidden note holding a line's problems, in its shadow root. */
export function problemNoteId(lineId: string): string {
  return `problem-${lineId}`;
}

/** Which way a key steps between problems: F8 forward, Shift-F8 back. */
export function problemStep(event: KeyboardEvent): -1 | 1 | null {
  if (event.key !== "F8" || event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }

  return event.shiftKey ? -1 : 1;
}

/**
 * Move focus to the next line with a problem after the reader's focus — or
 * the previous one, for a `step` of -1 — wrapping at either end, in document
 * order, which is the order the proof's lines are read and flattened in.
 *
 * Returns what is left to say aloud: nothing when focus moved, since the line's
 * description says it; the note again when the reader is already on the only
 * line with a problem, where focus has nowhere to move and so says nothing;
 * and `none` when no line has one.
 */
export function stepToProblem(
  root: ShadowRoot,
  step: -1 | 1,
  none: string,
): string | null {
  const lines = Array.from(
    root.querySelectorAll<HTMLElement>('[role="treeitem"][aria-describedby]'),
  );
  const here = root.activeElement;
  const toward =
    step === 1
      ? Node.DOCUMENT_POSITION_FOLLOWING
      : Node.DOCUMENT_POSITION_PRECEDING;
  // A line that contains the focus — its own field, being edited — is where
  // the reader already is, and is neither ahead of them nor behind.
  const ahead = lines.filter(
    (line) =>
      here !== null &&
      !line.contains(here) &&
      (here.compareDocumentPosition(line) & toward) !== 0,
  );
  const target =
    step === 1 ? (ahead[0] ?? lines[0]) : (ahead.at(-1) ?? lines.at(-1));

  if (target === undefined) {
    return none;
  }
  if (target === here) {
    const note = root.getElementById(
      target.getAttribute("aria-describedby") ?? "",
    );
    return note?.textContent ?? null;
  }

  target.focus();
  return null;
}

/**
 * A polite live region, inserted into `parent` before `before`, and the
 * function that speaks through it. Visually hidden: it is there to be heard.
 */
export function mountAnnouncer(
  parent: HTMLElement,
  before: Node | null,
): (text: string) => void {
  const region = document.createElement("p");
  region.className = "visually-hidden";
  region.setAttribute("aria-live", "polite");
  parent.insertBefore(region, before);

  return (text) => {
    // A live region that is handed the text it already holds reads nothing,
    // so a repeat — F8 pressed twice on a proof with no problems — is told
    // apart by a trailing space.
    region.textContent = region.textContent === text ? `${text} ` : text;
  };
}

/** The lines with a problem, in document order — the order F8 visits them. */
function problemLines(root: ShadowRoot): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('[role="treeitem"][aria-describedby]'),
  );
}

/**
 * The problem F8 last went to, in a tree or Prawitz editor: shown in the
 * problem line, and its line marked `is-pinned` (tinted, by
 * `./problem-line.css`), until F8 goes to another or the line's problem is
 * gone.
 *
 * Held as the line's note id, which names its node and so outlives the
 * rerenders an edit causes, and read back out of the rendered tree after each
 * of them ({@link sync}): the note is what the problem *is*, as far as F8 is
 * concerned, so a line without one has nothing to pin. The class is set on
 * the treeitem directly rather than through the island's props, which Preact
 * leaves alone while the `class` it rendered there does not change; a node
 * it rebuilds simply gets it again on the next sync.
 */
export class PinnedProblem {
  private noteId: string | null = null;

  constructor(
    private readonly root: ShadowRoot,
    private readonly line: ProblemLine,
    private readonly position: (index: number, count: number) => string,
  ) {}

  /** Pin the problem of the line focus is on — where F8 just left it. */
  pinFocused(): void {
    const here = this.root.activeElement?.closest('[role="treeitem"]');
    this.noteId = here?.getAttribute("aria-describedby") ?? null;
    this.sync();
  }

  /** Bring the line and the tint up to date with the tree as rendered. */
  sync(): void {
    const lines = problemLines(this.root);
    const index = lines.findIndex(
      (line) => line.getAttribute("aria-describedby") === this.noteId,
    );
    for (const pinned of this.root.querySelectorAll(".is-pinned")) {
      if (pinned !== lines[index]) {
        pinned.classList.remove("is-pinned");
      }
    }

    const pinned = lines[index];
    const note =
      this.noteId === null ? null : this.root.getElementById(this.noteId);
    if (pinned === undefined || note === null) {
      this.noteId = null;
      this.line.clear();
      return;
    }

    pinned.classList.add("is-pinned");
    // The note is the problem drawn (`./problem-note.tsx`): a copy of it is
    // what the line shows, a rule's shape and all.
    this.line.show({
      content: copyOfDrawing(note),
      position: this.position(index + 1, lines.length),
      // A line can hold an error and a sorry! warning at once; the error is
      // the one that matters. Only an error squiggles the formula.
      severity:
        pinned.querySelector(".is-error") === null ? "warning" : "error",
      where: null,
    });
  }
}
