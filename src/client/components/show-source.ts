/**
 * Ctrl-?: a widget's work, shown as directive source.
 *
 * What the author preview's "Copy as source" button copies (see
 * `copy-source.ts`), offered on every form — a student's included — as a key
 * rather than a button, since a button a student never needs is one more
 * thing in the bar. Original Carnap had the same key for the same thing.
 *
 * Ctrl on every platform, the Mac too: Cmd-? is the system's own key for
 * searching an app's Help menu. And matched on the character typed, not the
 * key pressed, so it follows `?` wherever a layout puts it (Shift-ß, Shift-,).
 * The listener is on the host and captures, so the key works from inside a
 * field as well as from a selected line, and nothing inside sees it.
 *
 * Only where the work is not already text: the world, proof tree and Prawitz
 * editors. A linear or Fitch proof is its own source, copied from the editor.
 *
 * A dialog, not a silent copy: the reader sees what they are getting, and the
 * key always visibly does something. It opens on Copy, so Enter copies; the
 * text is left unselected, since a block of highlighted proof is noise when a
 * button does the copying, and a screen reader would read all of it out.
 * Where the clipboard is refused, the text is one Shift-Tab and Ctrl-A away.
 */

import type { CopySourceStringId } from "../../worker/exercise-kit/copy-source-strings";
import { createDialogFrame, openHelpDialog } from "./help-dialog";

/** What the key is called in each widget's key table. */
export const SHOW_SOURCE_KEYS: readonly string[] = ["Ctrl-?"];

/** Whether `event` is Ctrl-?: Ctrl alone with Shift, whatever key types `?`. */
export function isShowSourceKey(event: KeyboardEvent): boolean {
  return (
    event.key === "?" && event.ctrlKey && !event.altKey && !event.metaKey
  );
}

/**
 * Give `host` its Ctrl-?, opening a dialog in `root` that shows what `source`
 * returns when the key is pressed, or `unavailable` where it returns null —
 * a Prawitz workspace still in pieces, which no starter can hold. The panel
 * wears the help dialog's styles, which the widget already carries; `t` is
 * the widget's own, narrowed to the text said here.
 */
export function mountShowSource(
  host: HTMLElement,
  root: ShadowRoot,
  t: (id: CopySourceStringId) => string,
  source: () => string | null,
  unavailable = "",
): void {
  const { body, dialog } = createDialogFrame(
    "help-dialog source-dialog",
    "source-dialog-title",
    t("Your work as source"),
    t("Close"),
  );

  // Read-only rather than a <pre>: it keeps its own scroll, and selecting all
  // of it is one key.
  const text = document.createElement("textarea");
  text.className = "source-dialog-text";
  text.readOnly = true;
  text.spellcheck = false;
  text.wrap = "off";
  text.setAttribute("aria-labelledby", "source-dialog-title");

  const none = document.createElement("p");
  none.textContent = unavailable;

  const actions = document.createElement("div");
  actions.className = "source-dialog-actions";

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = t("Copy");

  const status = document.createElement("span");
  status.setAttribute("role", "status");

  copy.addEventListener("click", () => {
    // Cleared first, so a second copy is a change the live region reads again.
    status.textContent = "";
    void navigator.clipboard?.writeText(text.value).then(
      () => {
        status.textContent = t("Copied.");
      },
      () => undefined,
    );
  });

  actions.append(copy, status);
  body.append(text, none, actions);
  root.appendChild(dialog);

  // The panel is inside the widget's shadow root, so a key pressed in it
  // would otherwise go on to the widget's own keys: Ctrl-Z in the text would
  // undo the proof under the dialog.
  dialog.addEventListener("keydown", (event) => event.stopPropagation());

  host.addEventListener(
    "keydown",
    (event) => {
      if (!isShowSourceKey(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (dialog.open) {
        return;
      }

      const shown = source();
      text.value = shown ?? "";
      text.hidden = shown === null;
      actions.hidden = shown === null;
      none.hidden = shown !== null;
      status.textContent = "";
      text.rows = Math.min(Math.max(text.value.split("\n").length, 3), 16);

      const [origin] = event.composedPath();
      openHelpDialog(dialog, origin instanceof HTMLElement ? origin : host);

      if (shown !== null) {
        copy.focus({ preventScroll: true });
      }
    },
    { capture: true },
  );
}
