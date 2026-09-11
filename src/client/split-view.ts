/**
 * The switch between a split page's views, and the handle that sets where
 * its two columns meet.
 *
 * A split is three states: both columns, or either one of them alone. Which
 * one is on is `data-mode` on the split, and this is what sets it. Where
 * there is no room for two columns CSS drops the both-columns half of the
 * switch and the handle with it, and `data-narrow-view` says which column
 * the page falls back to — the same fact the server pressed a half on.
 *
 * The control ships in the markup hidden, and is revealed here: without this
 * bundle there is nothing to switch with, and a page that cannot switch
 * should not offer to.
 */

/** Where the two columns stop being two views and become two columns. */
const WIDE_VIEWPORT = "(min-width: 70rem)";

/** How far one arrow press moves the handle, as a share of the width. */
const RESIZE_STEP = 2;

export function setUpSplitView(): void {
  const split = document.querySelector<HTMLElement>("[data-split-view]");
  const control = document.querySelector<HTMLElement>("[data-split-switch]");

  if (split === null || control === null) {
    return;
  }

  const wide = window.matchMedia(WIDE_VIEWPORT);

  const showPressed = (): void => {
    const mode = split.dataset.mode;
    // Where only one column fits, "both" is not on offer and the page is
    // showing the column it opened on — so press *that*. The control never
    // claims a state the page is not in, and never presses a half that isn't
    // there to see.
    const shown =
      mode === "split" && !wide.matches ? split.dataset.narrowView : mode;

    // `aria-pressed` on every half, not just the one clicked: the group is
    // the control, and a screen reader reads the state off whichever half it
    // is on.
    for (const half of control.querySelectorAll<HTMLElement>(
      "[data-view-target]",
    )) {
      half.setAttribute(
        "aria-pressed",
        String(half.dataset.viewTarget === shown),
      );
    }
  };

  control.dataset.enhanced = "true";
  showPressed();
  // Crossing the breakpoint changes which half of the switch is true without
  // changing the mode: "both columns" and "the column you opened on" are the
  // same picture on one side of it and different pictures on the other.
  wide.addEventListener("change", showPressed);

  control.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest("[data-view-target]");

    if (!(button instanceof HTMLElement)) {
      return;
    }

    split.dataset.mode = button.dataset.viewTarget;
    showPressed();
  });

  setUpResizer(split);
}

/**
 * Drag — or arrow — the boundary between the columns.
 *
 * The width is one custom property on the split, which the grid template
 * reads: nothing here measures a column or writes one's size, so the columns
 * stay the grid's business and this stays a number between two bounds. The
 * bounds and the starting number are the handle's own `aria-value*`
 * attributes, so the server states them once and this reads them back rather
 * than keeping a second copy of them in step.
 */
function setUpResizer(split: HTMLElement): void {
  const handle = split.querySelector<HTMLElement>("[data-split-resizer]");

  if (handle === null) {
    return;
  }

  const bound = (name: string, fallback: number): number => {
    const raw = Number(handle.getAttribute(name));

    return Number.isFinite(raw) ? raw : fallback;
  };
  const min = bound("aria-valuemin", 20);
  const max = bound("aria-valuemax", 80);
  const start = bound("aria-valuenow", 40);

  handle.dataset.enhanced = "true";

  let rail = start;
  /** Where in the handle the pointer took hold, so it doesn't jump on grab. */
  let grip = 0;

  const setRail = (next: number): void => {
    rail = Math.min(max, Math.max(min, Math.round(next)));
    split.style.setProperty("--split-rail", `${String(rail)}%`);
    handle.setAttribute("aria-valuenow", String(rail));
  };

  handle.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary) {
      return;
    }

    grip = event.clientX - handle.getBoundingClientRect().left;
    handle.setPointerCapture(event.pointerId);
    split.dataset.resizing = "true";
    // Otherwise the drag starts a text selection across both columns, which
    // then follows the pointer as a blue smear.
    event.preventDefault();
  });

  handle.addEventListener("pointermove", (event) => {
    // Capture is what makes a drag survive crossing the preview iframe,
    // which would otherwise swallow the pointer the moment it entered.
    if (!handle.hasPointerCapture(event.pointerId)) {
      return;
    }

    const bounds = split.getBoundingClientRect();

    if (bounds.width > 0) {
      setRail(((event.clientX - grip - bounds.left) / bounds.width) * 100);
    }
  });

  const release = (event: PointerEvent): void => {
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }

    delete split.dataset.resizing;
  };

  handle.addEventListener("pointerup", release);
  handle.addEventListener("pointercancel", release);

  handle.addEventListener("keydown", (event) => {
    const moved =
      event.key === "ArrowLeft"
        ? rail - RESIZE_STEP
        : event.key === "ArrowRight"
          ? rail + RESIZE_STEP
          : event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : null;

    if (moved === null) {
      return;
    }

    setRail(moved);
    // Arrow keys scroll the page, and a handle being nudged is not a page
    // being scrolled.
    event.preventDefault();
  });

  // Back to where the page opened, without hunting for it: the same gesture
  // that resets a pane boundary everywhere else.
  handle.addEventListener("dblclick", () => {
    setRail(start);
  });
}
