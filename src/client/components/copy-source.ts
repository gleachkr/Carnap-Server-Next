/**
 * The author preview's "Copy as source": a button in the exercise's action bar
 * that copies what the author has built in the widget as directive source, so
 * an edited world or a proof tree can be pasted back into the lesson as the
 * exercise's starting point.
 *
 * Preview only. A student has no source to paste anything into, so the button
 * exists only in the revision editor's live preview — a `srcdoc` frame with no
 * submission form around the exercise. The saved-revision view has no form
 * either, but it is not being edited.
 *
 * In the bar rather than in the widget, for the reasons the `(?)` is (see
 * `mountHelpTrigger`): one row of controls for every type, which author CSS
 * can reach and a rerendering island cannot pull out from under focus. It goes
 * before Submit, after whatever the widget has already put there. "Copied." is
 * said on the bar's submission status line, which a preview never submits to
 * and so never uses.
 */

import { mountActionButton } from "./action-bar";

/** Whether `host` is being edited in the revision editor's live preview. */
export function isAuthorPreview(host: HTMLElement): boolean {
  return (
    host.closest("form.exercise-submission") === null &&
    globalThis.location?.href === "about:srcdoc"
  );
}

/**
 * Put "Copy as source" in `host`'s action bar and hand back the button, or
 * null outside the author preview or where there is no bar. `source` returns
 * the text to copy, or null when there is nothing to copy.
 */
export function mountCopySource(
  host: HTMLElement,
  strings: { readonly copied: string; readonly label: string },
  source: () => string | null,
): HTMLButtonElement | null {
  if (!isAuthorPreview(host)) {
    return null;
  }

  const status = host.querySelector<HTMLElement>(
    ".exercise-actions [data-exercise-status]",
  );

  return mountActionButton(host, "copy-source", strings.label, () => {
    const text = source();

    if (text === null) {
      return;
    }

    // Cleared first, so a second copy is a change the live region reads again.
    if (status !== null) {
      status.textContent = "";
    }

    void navigator.clipboard?.writeText(text).then(
      () => {
        if (status !== null) {
          status.textContent = strings.copied;
        }
      },
      () => undefined,
    );
  });
}
