/**
 * Warn before a navigation discards typed-but-unsaved form input.
 *
 * There is nothing here to translate: the browser writes the wording itself and
 * decides whether to show it at all (it will not, without a prior interaction).
 * The whole job is deciding whether the form still holds work the server has
 * never seen.
 *
 * The interactive exercises answer that question a different way — their answer
 * lives in a shadow-DOM widget rather than in the form's own fields, and their
 * runtime is an inline script in a document this bundle never reaches, so it
 * carries its own guard. See `exerciseRuntimeScript` in `assignment-detail.tsx`.
 */

/**
 * Ask before leaving while `form` holds changes. Safe to call on a form that
 * some enhancement has taken over, as long as the enhancement writes back
 * through the real fields — the revision editor's CodeMirror view keeps the
 * `sourceText` textarea current for exactly that reason.
 */
export function warnBeforeDiscarding(form: HTMLFormElement): void {
  // The form's own window, not the ambient global: everything here belongs to
  // the document the form is in, which is not always the top one — and reading
  // a form with a *different* realm's FormData yields nothing at all.
  const view = form.ownerDocument.defaultView;

  if (view === null) {
    return;
  }

  /** Every field's current value, as one comparable string. */
  const snapshot = (): string => {
    const pairs: [string, string][] = [];

    for (const [name, value] of new view.FormData(form)) {
      // A File has no value to compare — its identity is the selection itself,
      // which the reader cannot lose by reloading (the picker has to be used
      // again either way).
      if (typeof value === "string") {
        pairs.push([name, value]);
      }
    }

    return new view.URLSearchParams(pairs).toString();
  };

  let saved = snapshot();

  // A save is itself a navigation, and it must not be the thing we warn about.
  // The submit event fires before the unload, so re-marking here is enough.
  form.addEventListener("submit", () => {
    saved = snapshot();
  });

  view.addEventListener("beforeunload", (event) => {
    if (snapshot() === saved) {
      return;
    }

    event.preventDefault();
    // The older spelling of the same request, still needed by some engines.
    event.returnValue = "";
  });
}
