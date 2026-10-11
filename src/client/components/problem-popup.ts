import styles from "./problem-popup.css" with { type: "text" };
import { copyOfDrawing } from "./proof-problem";

/**
 * The bubble a field's problem floats in when the pointer rests on it, in the
 * widgets whose fields are not CodeMirror views: the tree, Prawitz and
 * truth-tree editors. It stands in for the `title` those fields used to carry,
 * so a problem looks the same there as under a squiggle in the linear and
 * Fitch editors, and it behaves as hover content has to (WCAG 1.4.13): the
 * pointer can move onto it without it closing, it stays until the pointer
 * leaves both or the problem changes, and Escape dismisses it wherever focus
 * is, as it does CodeMirror's.
 *
 * A field opts in by carrying its message in {@link PROBLEM_ATTRIBUTE}, and a
 * warning says so in {@link PROBLEM_SEVERITY_ATTRIBUTE}; the popup reads them
 * when the pointer arrives, so the islands just render the attributes. A
 * field whose problem is drawn — a rule's shape as boxes
 * (`./proof-problem.ts`) — also names, in {@link PROBLEM_NOTE_ATTRIBUTE},
 * the element drawing exactly that text (`./problem-note.tsx`), and the popup
 * shows a copy of the drawing instead; the text is still what tells it the
 * problem changed. It is
 * `aria-hidden`: a screen reader hears the same text through the field's
 * hidden note, and a touch, which floats no title either, floats nothing.
 *
 * Framework-free, like the problem line, so the Preact islands share it; it is
 * mounted outside any render tree.
 */

/** The attribute a field carries its problem's message in. */
export const PROBLEM_ATTRIBUTE = "data-problem";

/** The id, in the same shadow root, of the element drawing the field's
 *  problem: its {@link PROBLEM_ATTRIBUTE} text, as boxes where it has any. */
export const PROBLEM_NOTE_ATTRIBUTE = "data-problem-note";

/** Set to `warning` on a field whose problem is one; absent, it is an error. */
export const PROBLEM_SEVERITY_ATTRIBUTE = "data-problem-severity";

/** How long the pointer rests before the bubble floats: CodeMirror's lint
 *  hover time, so the two kinds of editor answer alike. */
const HOVER_DELAY_MS = 300;

/** How long the bubble outlasts the pointer leaving, so it can cross the gap
 *  between field and bubble without the bubble closing under it. */
const LEAVE_GRACE_MS = 150;

/** Between the field's edge and the bubble's, and the bubble and the window's. */
const GAP_PX = 2;
const MARGIN_PX = 4;

/**
 * Put an empty, hidden popup and its stylesheet into `root`, and float it over
 * any field inside `scope` carrying {@link PROBLEM_ATTRIBUTE}. Everything it
 * listens to is released when `signal` aborts.
 */
export function mountProblemPopup(
  root: ShadowRoot,
  scope: HTMLElement,
  signal: AbortSignal,
): void {
  const style = document.createElement("style");
  style.textContent = styles;
  root.appendChild(style);

  const popup = document.createElement("div");
  popup.className = "problem-popup";
  popup.hidden = true;
  popup.setAttribute("aria-hidden", "true");
  const message = document.createElement("div");
  message.className = "problem-popup-message";
  popup.append(message);
  root.appendChild(popup);

  const view = root.ownerDocument.defaultView ?? window;

  /** The field under the pointer, shown or about to be. */
  let anchor: HTMLElement | null = null;
  /** The message shown for it, to notice it changing. */
  let shown: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const problemOf = (element: Element | null): HTMLElement | null =>
    element?.closest<HTMLElement>(`[${PROBLEM_ATTRIBUTE}]`) ?? null;

  const place = (): void => {
    if (anchor === null || popup.hidden) {
      return;
    }
    const field = anchor.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const left = Math.max(
      MARGIN_PX,
      Math.min(field.left, view.innerWidth - width - MARGIN_PX),
    );
    // Above the field, as CodeMirror floats a lint message; below when there
    // is no room above.
    const above = field.top - GAP_PX - height;
    const below = field.bottom + GAP_PX;
    const top = above < MARGIN_PX ? below : above;
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  };

  const hide = (): void => {
    clearTimeout(timer);
    anchor = null;
    shown = null;
    popup.hidden = true;
  };

  const show = (field: HTMLElement): void => {
    const text = field.getAttribute(PROBLEM_ATTRIBUTE) ?? "";
    if (text === "" || !field.isConnected) {
      hide();
      return;
    }
    shown = text;
    const noteId = field.getAttribute(PROBLEM_NOTE_ATTRIBUTE);
    const note = noteId === null ? null : root.getElementById(noteId);
    if (note === null) {
      message.textContent = text;
    } else {
      message.replaceChildren(...copyOfDrawing(note));
    }
    popup.dataset.severity =
      field.getAttribute(PROBLEM_SEVERITY_ATTRIBUTE) === "warning"
        ? "warning"
        : "error";
    popup.hidden = false;
    place();
  };

  const isOver = (target: EventTarget | null): boolean =>
    target instanceof Node &&
    (popup.contains(target) || (anchor?.contains(target) ?? false));

  scope.addEventListener(
    "pointerover",
    (event) => {
      if (event.pointerType === "touch") {
        return;
      }
      const field = problemOf(event.target as Element | null);
      if (field === anchor) {
        // Back on the field it is shown for: stay.
        if (anchor !== null && shown !== null) {
          clearTimeout(timer);
        }
        return;
      }
      clearTimeout(timer);
      if (field === null) {
        if (anchor !== null && shown !== null) {
          timer = setTimeout(hide, LEAVE_GRACE_MS);
        } else {
          anchor = null;
        }
        return;
      }
      // Another field: its bubble replaces the one shown at once, as moving
      // along a line of squiggles does; from nothing it waits for the pointer
      // to rest.
      const wasShown = shown !== null;
      hide();
      anchor = field;
      if (wasShown) {
        show(field);
      } else {
        timer = setTimeout(() => show(field), HOVER_DELAY_MS);
      }
    },
    { signal },
  );

  const leave = (event: PointerEvent): void => {
    if (anchor === null || isOver(event.relatedTarget)) {
      return;
    }
    clearTimeout(timer);
    if (shown === null) {
      anchor = null;
      return;
    }
    timer = setTimeout(hide, LEAVE_GRACE_MS);
  };
  scope.addEventListener("pointerout", leave, { signal });
  popup.addEventListener("pointerout", leave, { signal });
  popup.addEventListener(
    "pointerover",
    () => {
      clearTimeout(timer);
    },
    { signal },
  );

  // Escape dismisses it wherever focus is — the pointer can float it while
  // focus is anywhere on the page — and goes on to do whatever else it does
  // there. Resting on the same field does not float it again; leaving and
  // coming back does.
  root.ownerDocument.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !popup.hidden) {
        const field = anchor;
        hide();
        anchor = field;
      }
    },
    { signal },
  );

  // The page scrolling carries the field away from where the bubble was put.
  view.addEventListener("scroll", place, {
    capture: true,
    passive: true,
    signal,
  });
  view.addEventListener("resize", place, { passive: true, signal });

  // A field whose problem changes — fixed, or replaced by another — or that
  // leaves the page takes its bubble with it, as an edit closes CodeMirror's.
  const observer = new MutationObserver(() => {
    if (anchor === null) {
      return;
    }
    const current = anchor.isConnected
      ? anchor.getAttribute(PROBLEM_ATTRIBUTE)
      : null;
    if (current === null || (shown !== null && current !== shown)) {
      hide();
    }
  });
  observer.observe(scope, {
    attributeFilter: [PROBLEM_ATTRIBUTE],
    attributes: true,
    childList: true,
    subtree: true,
  });
  signal.addEventListener("abort", () => {
    observer.disconnect();
    hide();
  });
}
