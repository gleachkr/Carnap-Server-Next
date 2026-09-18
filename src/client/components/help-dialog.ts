/**
 * The usage-instructions modal every interactive widget can offer behind a `(?)`
 * in the exercise's action bar.
 *
 * Framework-free on purpose. Two of the widgets that want one are Preact
 * islands and three are hand-written DOM, so this builds plain elements and
 * takes plain, already-translated strings — a widget passes what its `t()`
 * returned and never has to reach a catalog from here. The panel is created once
 * and appended to the widget's shadow root, outside any render tree; the trigger
 * is a light-DOM button in the action bar (see {@link mountHelpTrigger}), which
 * also means a rerendering island cannot pull the focused control out from under
 * an open dialog.
 *
 * Instructions live behind the button rather than on the page because they stop
 * being useful after the first minute and the space they take never stops being
 * spent. Nothing of them is left visible — the `(?)` is the whole affordance.
 */

import helpDialogStyles from "./help-dialog.css" with { type: "text" };
import { createToolbarIcon, type ToolbarIconName } from "./toolbar-icons";

/**
 * One row of the key table: the keys as written, what they do, and — for an
 * action that also has a toolbar button — the glyph on that button.
 */
export interface HelpShortcut {
  /** What the keys do, in the viewer's language. */
  readonly action: string;
  /**
   * The toolbar button's glyph, when there is one. The toolbars show no words
   * (see `toolbar-icons.ts` for why), so this table is where a glyph and its
   * meaning are first seen side by side.
   */
  readonly icon?: ToolbarIconName;
  /**
   * The keys themselves, one `<kbd>` each. Not translated and not translatable:
   * `Enter` and `Ctrl-Z` are what is printed on the key, and a widget that
   * renamed them in one language would be describing a keyboard nobody has.
   */
  readonly keys: readonly string[];
}

export interface HelpDialogContent {
  /** Accessible name of the dismiss button. */
  readonly close: string;
  /** Orientation prose, one paragraph per entry, before the key table. */
  readonly intro: readonly string[];
  /** Heading over the key table. */
  readonly keyboard: string;
  readonly shortcuts: readonly HelpShortcut[];
  /** The dialog's heading, which is also its accessible name. */
  readonly title: string;
}

/**
 * Which button opened a dialog, so closing it can hand focus back. A map rather
 * than a property on the element: one widget could grow a second trigger (a key
 * as well as the button), and whichever one was used is the one to return to.
 */
const triggers = new WeakMap<HTMLDialogElement, HTMLElement>();

/** Gap between the trigger and the panel, and from the viewport edge, in px. */
const GAP = 6;
const EDGE = 8;

/**
 * Build the dialog. Call once per widget and keep the element — reopening is
 * {@link openHelpDialog}, which does not rebuild anything.
 *
 * Nothing here goes through `innerHTML`: the strings are translations, and
 * a catalog is not a place to have to reason about markup injection.
 */
export function createHelpDialog(
  content: HelpDialogContent,
): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "help-dialog";

  const titleId = "help-dialog-title";
  // Ids inside a shadow root are scoped to it, so this cannot collide with the
  // page or with another exercise's dialog.
  dialog.setAttribute("aria-labelledby", titleId);

  const header = document.createElement("div");
  header.className = "help-dialog-header";

  const heading = document.createElement("h2");
  heading.className = "help-dialog-title";
  heading.id = titleId;
  heading.textContent = content.title;
  header.appendChild(heading);

  const dismiss = document.createElement("button");
  dismiss.className = "help-dialog-close";
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", content.close);
  dismiss.title = content.close;
  dismiss.textContent = "×";
  dismiss.addEventListener("click", () => dialog.close());
  header.appendChild(dismiss);

  dialog.appendChild(header);

  const body = document.createElement("div");
  body.className = "help-dialog-body";

  for (const paragraph of content.intro) {
    const element = document.createElement("p");
    element.textContent = paragraph;
    body.appendChild(element);
  }

  if (content.shortcuts.length > 0) {
    const subheading = document.createElement("h3");
    subheading.className = "help-dialog-heading";
    subheading.textContent = content.keyboard;
    body.appendChild(subheading);

    const list = document.createElement("dl");
    list.className = "help-shortcuts";

    for (const shortcut of content.shortcuts) {
      const term = document.createElement("dt");

      // Every row gets the cell, so the keys line up whether or not the
      // action has a button.
      const glyph = document.createElement("span");
      glyph.className = "help-shortcut-icon";

      if (shortcut.icon !== undefined) {
        glyph.appendChild(createToolbarIcon(shortcut.icon));
      }

      term.appendChild(glyph);

      for (const key of shortcut.keys) {
        const glyph = document.createElement("kbd");
        glyph.textContent = key;
        term.appendChild(glyph);
      }

      const description = document.createElement("dd");
      description.textContent = shortcut.action;

      list.append(term, description);
    }

    body.appendChild(list);
  }

  dialog.appendChild(body);

  // Click-outside-to-dismiss is not native to <dialog>. The backdrop is painted
  // by the dialog itself, so a click on it targets the dialog element; a click
  // on the panel targets something inside it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  // Browsers restore focus to the previously focused element on close, but only
  // when it is still focusable and still in the same tree — the widget rerenders
  // its toolbar, so be explicit rather than lose focus to the document.
  dialog.addEventListener("close", () => {
    triggers.get(dialog)?.focus();
  });

  return dialog;
}

/**
 * Put the `(?)` in the exercise's action bar and hand back the button.
 *
 * The bar rather than the widget's own toolbar, because the toolbar is a
 * different shape in every widget that has one — and two of them have no toolbar
 * at all — so "where the instructions are" was a fact about each widget rather
 * than about an exercise. The bar is the one row every type ends with, in light
 * DOM, so this is one position for all of them and one CSS rule describing it.
 *
 * First in the row, ahead of Check and Submit: reading how the thing works comes
 * before working it, and a fixed end of the row cannot be shunted along as a
 * widget grows another button.
 *
 * Returns null when there is no bar — the widget is then still reachable by its
 * `?` key, which is the same route a reader working from the keyboard uses.
 */
export function mountHelpTrigger(
  host: HTMLElement,
  label: string,
  open: (trigger: HTMLElement) => void,
): HTMLButtonElement | null {
  const bar = host.querySelector<HTMLElement>(".exercise-actions");

  if (bar === null) {
    return null;
  }

  // The glyph is decoration, so the name comes from the label rather than from
  // the "?" a reader would otherwise hear.
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "help-trigger";
  trigger.textContent = "?";
  trigger.setAttribute("aria-label", label);
  trigger.title = label;
  trigger.addEventListener("click", () => open(trigger));
  bar.prepend(trigger);

  return trigger;
}

/** A rectangle in this document's client coordinates. */
interface Band {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

/**
 * The part of this document the reader can actually see.
 *
 * Not `innerHeight`: lesson content is served in an iframe the parent page
 * sizes to the whole document's height (`CONTENT_FRAME_SCRIPT` in
 * `src/worker/web/layout.tsx`), so inside it the layout viewport is the *entire
 * lesson* — `innerHeight` can be several thousand px, `vh` units are
 * meaningless, and the frame itself never scrolls. What moves is the page
 * around it. So walk out through the ancestor frames and intersect each one's
 * visible rect, which gives the band the reader is looking at expressed in this
 * document's own coordinates. Outside a frame the loop does not run and this is
 * just the viewport.
 */
function readerViewport(): Band {
  const own: Band = {
    bottom: window.innerHeight,
    left: 0,
    right: document.documentElement.clientWidth,
    top: 0,
  };

  let { bottom, left, right, top } = own;
  let win: Window = window;
  let offsetX = 0;
  let offsetY = 0;

  // `frameElement` is null once the window above is cross-origin, which is the
  // only case this cannot see through. The depth bound is a guard against a
  // pathological nesting, not something any page here does.
  for (let depth = 0; depth < 8; depth += 1) {
    const frame = win.frameElement;
    const above = win.parent;

    if (frame === null || above === win) {
      break;
    }

    // A frame's rect is in its parent's coordinates, so accumulating the
    // offsets maps that parent's viewport back into this document's.
    const rect = frame.getBoundingClientRect();
    offsetX += rect.left;
    offsetY += rect.top;

    top = Math.max(top, -offsetY);
    left = Math.max(left, -offsetX);
    bottom = Math.min(bottom, above.innerHeight - offsetY);
    right = Math.min(
      right,
      above.document.documentElement.clientWidth - offsetX,
    );
    win = above;
  }

  // A frame scrolled clean out of view leaves no band to place anything in.
  // Fall back to this document's own viewport rather than an empty rect.
  return bottom - top < 4 * EDGE || right - left < 4 * EDGE
    ? own
    : {
        bottom,
        left,
        right,
        top,
      };
}

/**
 * The panel's size while it is still closed.
 *
 * A closed dialog is `display: none` and has no box, so it has to be given one
 * to be measured — but *not* by showing it, because the size is needed before
 * `showModal` (see {@link openHelpDialog}). Nothing is painted between these
 * statements, and `visibility: hidden` means nothing would be visible if it
 * were.
 */
function measureClosed(dialog: HTMLDialogElement): DOMRect {
  dialog.style.visibility = "hidden";
  dialog.style.display = "block";
  const rect = dialog.getBoundingClientRect();
  dialog.style.display = "";
  dialog.style.visibility = "";
  return rect;
}

/**
 * Show the dialog just below the control that asked for it.
 *
 * Deliberately *not* centred, and deliberately not scrolled to. The UA's
 * `dialog:modal { inset: 0; margin: auto }` centres on the layout viewport,
 * which inside the content frame is the whole lesson — the panel would land at
 * the lesson's midpoint, on a long page thousands of pixels from the exercise
 * that opened it, reading as a button that does nothing.
 *
 * Placement happens *before* `showModal` because showing a dialog focuses it,
 * and focusing an element scrolls it into view — through every ancestor scroll
 * container, including the parent page holding the content frame. Nothing in
 * this document can scroll that page back. So the panel must already be inside
 * {@link readerViewport} when it is shown, leaving that scroll nothing to do.
 *
 * `position: absolute` on a top-layer element resolves against the initial
 * containing block, i.e. document coordinates, which is what makes one
 * calculation right both inside that iframe and on the standalone content page.
 */
export function openHelpDialog(
  dialog: HTMLDialogElement,
  trigger: HTMLElement,
): void {
  triggers.set(dialog, trigger);

  const band = readerViewport();
  const anchor = trigger.getBoundingClientRect();
  const { scrollX, scrollY } = window;

  // Hold the panel to the visible band, so that wherever it is put below it
  // cannot stick out of the reader's view — and so a long key table scrolls
  // inside the panel. This is what `max-height` in the stylesheet cannot do:
  // `vh` inside the content frame is a fraction of the entire lesson.
  dialog.style.maxHeight = `${String(Math.round(band.bottom - band.top - 2 * EDGE))}px`;

  const panel = measureClosed(dialog);

  const rightmost = Math.max(
    band.left + EDGE,
    band.right - panel.width - EDGE,
  );
  const left = Math.min(Math.max(anchor.left, band.left + EDGE), rightmost);

  // Below the trigger, unless that would put it past the bottom of the band, in
  // which case above.
  const below = anchor.bottom + GAP;
  const top =
    below + panel.height > band.bottom - EDGE
      ? Math.max(band.top + EDGE, anchor.top - GAP - panel.height)
      : below;

  dialog.style.left = `${String(Math.round(scrollX + left))}px`;
  dialog.style.top = `${String(Math.round(scrollY + top))}px`;

  dialog.showModal();

  // Belt and braces for the rounding above: a panel a pixel outside the band
  // would still be scrolled to. This can only undo a scroll of *this* document,
  // which is why it is the fallback and the placement is the fix.
  if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
    window.scrollTo(scrollX, scrollY);
  }
}

/** The look; the prose is in the stylesheet, with the rules. */
export const HELP_DIALOG_STYLES = helpDialogStyles;
