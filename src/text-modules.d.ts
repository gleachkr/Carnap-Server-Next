/**
 * Files this program imports for their *text* rather than for their meaning:
 *
 * ```ts
 * import styles from "./widget.css" with { type: "text" };
 * ```
 *
 * The attribute is the whole mechanism. Bun honours it at run time (the tests,
 * `bun run serve`, the container) and in `bun build` (the client bundles), and
 * esbuild honours it inside Wrangler (the worker) — with no loader rule, no
 * `rules` block in `wrangler.jsonc`, and no plugin in any of the three. All
 * TypeScript needs is to be told what the module's shape is, which is this
 * file; it does not resolve the import itself.
 *
 * What it buys is that CSS and MM0 get to be CSS and MM0: syntax highlighting,
 * a formatter, and — the reason this was worth doing — no escaping. A stylesheet
 * that lived in a template literal ended at the first backtick in a comment, and
 * `tsc` then blamed a line hundreds of rules further down. See the note in
 * `docs/`.
 *
 * Only `type: "text"` is declared, because only text is wanted. An import with
 * no attribute keeps failing to typecheck, which is the honest answer: without
 * the attribute the bundlers disagree — esbuild would try to *parse* a `.css`
 * file as a stylesheet and Bun would make it a `CSSStyleSheet`.
 */

declare module "*.css" {
  const source: string;
  export default source;
}

declare module "*.mm0" {
  const source: string;
  export default source;
}
