import styles from "./problem-line.css" with { type: "text" };

/**
 * The line under a proof where F8 leaves the problem it went to.
 *
 * A squiggle's message is otherwise a hover tooltip: it needs a pointer to
 * float, and where it floats it covers the lines around it. The line shows it
 * below the proof instead, and keeps it there while the reader goes off to
 * fix it — usually somewhere else, at a line the problem cites — until F8
 * goes to another or the problem is gone. Where the problem is gets a tint
 * (the `is-pinned` and `cm-problem-pinned` rules in `./problem-line.css`).
 * Hovering a squiggle still floats its tooltip, as it did.
 *
 * Not a live region. F8 already says the problem — the CodeMirror editors
 * announce it, and the tree and Prawitz editors move focus onto a line
 * described by it — and a line that spoke as well would say everything
 * twice. It is ordinary text, met in place by a reader walking the page.
 *
 * Framework-free, like the help dialog, so the CodeMirror editors and the two
 * Preact islands share it; it is mounted outside any render tree.
 */

/** What the line says about the problem it holds. */
export interface ShownProblem {
  /** Where the problem is, in words — `Line 4` — or `null` where the tint is
   *  all there is to point with: a tree's lines are not numbered. */
  readonly where: string | null;
  /** The problem itself; several on one place are joined by newlines. */
  readonly message: string;
  /** Which of the problems it is: `2 of 3`. */
  readonly position: string;
  readonly severity: "error" | "warning";
}

export interface ProblemLine {
  show(problem: ShownProblem): void;
  clear(): void;
}

/**
 * Insert an empty, hidden problem line into `parent` before `before`, and its
 * stylesheet into `root`, the widget's shadow root.
 */
export function mountProblemLine(
  root: ShadowRoot,
  parent: HTMLElement,
  before: Node | null,
): ProblemLine {
  const style = document.createElement("style");
  style.textContent = styles;
  root.appendChild(style);

  const line = document.createElement("p");
  line.className = "problem-line";
  line.hidden = true;
  parent.insertBefore(line, before);

  const part = (className: string, text: string): HTMLSpanElement => {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  };

  return {
    clear() {
      line.hidden = true;
      line.replaceChildren();
      delete line.dataset.severity;
    },
    show(problem) {
      line.replaceChildren(
        ...(problem.where === null
          ? []
          : [part("problem-line-where", problem.where)]),
        part("problem-line-message", problem.message),
        part("problem-line-position", problem.position),
      );
      line.dataset.severity = problem.severity;
      line.hidden = false;
    },
  };
}
