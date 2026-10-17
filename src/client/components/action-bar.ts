/**
 * A widget's own control in the exercise's action bar: the shared light-DOM
 * row (`.exercise-actions`) that holds Submit, so every type's buttons sit in
 * one row, styled uniformly by the content stylesheet and any author CSS.
 *
 * A control goes before Submit and after whatever the widget has already put
 * there, so a widget adds its buttons in the order it wants them read.
 */

/**
 * Put a button labelled `label` in `host`'s action bar, before Submit, and
 * hand it back; null where there is no bar.
 */
export function mountActionButton(
  host: HTMLElement,
  className: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement | null {
  const bar = host.querySelector<HTMLElement>(".exercise-actions");

  if (bar === null) {
    return null;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  bar.insertBefore(
    button,
    bar.querySelector<HTMLElement>('button[type="submit"]'),
  );

  return button;
}
