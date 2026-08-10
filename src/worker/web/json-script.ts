/**
 * JSON safe to embed in a `<script type="application/json">` payload: `<`/`&`
 * can't start a closing tag or an entity, and the two raw line separators are
 * illegal in JS string literals.
 *
 * Its own module, small as it is, because everything that emits a payload needs
 * it — the content document, the exercise hydration carrier, the UI-string
 * blocks — and routing them all through `content-document.tsx` made a cycle
 * once the scripts moved out into their own files: `script-assets` builds a
 * hash from `assignment-scripts`, which reads `ui-strings`, which wanted this.
 */
export function jsonScriptContent(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}
