/**
 * The switch between a split page's two views, wherever one is on the page.
 *
 * A split shows both columns when there is room for both, and CSS keeps this
 * control hidden there — it would have nothing to do. Where there is not, the
 * columns are two views of one page and `data-mode` says which is being
 * looked at; this is what sets it.
 *
 * The control ships in the markup pressed but hidden, and is revealed here:
 * without this bundle there is nothing to switch with, and a page that cannot
 * switch should not offer to.
 */
export function setUpSplitView(): void {
  const split = document.querySelector<HTMLElement>("[data-split-view]");
  const control = document.querySelector<HTMLElement>("[data-split-switch]");

  if (split === null || control === null) {
    return;
  }

  control.dataset.enhanced = "true";

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

    // `aria-pressed` on both halves, not just the one clicked: the pair is
    // the control, and a screen reader reads the state off whichever half it
    // is on.
    for (const other of control.querySelectorAll("[data-view-target]")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
  });
}
