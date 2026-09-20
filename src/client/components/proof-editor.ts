import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";

/**
 * What the two CodeMirror proof editors — linear `.auf` and Fitch — share
 * around their views: the chrome mounted above the action bar, the goal
 * declaration shown in it, and the two ways a compiler's diagnostics reach
 * the lint layer. The pipeline behind the editor is `./proof-element.ts`,
 * shared with the tree and Prawitz islands as well.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The theorem declaration line, its keyword and trailing `;` taken off. */
export function goalDeclaration(mm0: string): string {
  const lines = mm0.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trim();
    if (/^theorem\b/.test(line)) {
      return line.replace(/;\s*$/, "").replace(/^theorem\s+/, "");
    }
  }
  return "";
}

/** What {@link mountProofEditor} put in the shadow root. */
export interface ProofEditorChrome {
  /** The `.proof` card the server rendered, now without its inert source. */
  readonly container: HTMLElement;
  /** Where the CodeMirror view goes. */
  readonly host: HTMLElement;
  /** The goal row's statement, which a playground rewrites per compile. */
  readonly statement: HTMLElement;
}

/**
 * Replace the server's inert proof source with the editor's chrome: the
 * widget's styles, a goal row (`label` before `statement`, the statement
 * empty in a playground until the proof says what it proves) and an empty
 * host for the view. Both go in above the projected action bar
 * (`slot="exercise-actions"`), which sits at the card's foot, not appended
 * after it. `null` when the card is not there to enhance.
 */
export function mountProofEditor(
  root: ShadowRoot,
  styles: string,
  goal: { readonly label: string; readonly statement: string },
): ProofEditorChrome | null {
  const container = root.querySelector<HTMLElement>(".proof");
  if (container === null) {
    return null;
  }
  root.querySelector(".proof-source")?.remove();

  const style = document.createElement("style");
  style.textContent = styles;
  root.appendChild(style);

  const actionsSlot = container.querySelector<HTMLElement>(
    'slot[name="exercise-actions"]',
  );

  const row = document.createElement("div");
  row.className = "proof-goal";
  const label = document.createElement("span");
  label.className = "proof-goal-label";
  label.textContent = goal.label;
  const statement = document.createElement("span");
  statement.className = "proof-goal-statement";
  statement.textContent = goal.statement;
  // The space is for text readers; the row's gap draws the visible one.
  row.append(label, " ", statement);
  container.insertBefore(row, actionsSlot);

  const host = document.createElement("div");
  host.className = "proof-editor";
  container.insertBefore(host, actionsSlot);

  return { container, host, statement };
}

/** Hand the lint layer what to underline; empty clears it. */
export function showDiagnostics(
  editor: EditorView,
  diagnostics: readonly Diagnostic[],
): void {
  editor.dispatch(setDiagnostics(editor.state, [...diagnostics]));
}

/**
 * The compiler threw before it could report diagnostics: one generic marker
 * at the start of the body rather than a stranded spinner — or none, where
 * `message` is null because detail is withheld.
 */
export function showCompileFailure(
  editor: EditorView,
  message: string | null,
): void {
  showDiagnostics(
    editor,
    message === null
      ? []
      : [
          {
            from: 0,
            message,
            severity: "error",
            to: Math.min(editor.state.doc.length, 1),
          },
        ],
  );
}
