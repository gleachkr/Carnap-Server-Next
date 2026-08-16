/**
 * How the platform serves a font, shared by the two kinds it ships: the math
 * font (`./math-font`) and the interface families (`./ui-fonts`).
 *
 * The rule both obey is that a file's name carries the version of the package
 * it came from, so the response can honestly say `immutable` — the same bargain
 * `style-assets.ts` makes with its content hashes. A font is the largest thing
 * a reader fetches for a page of prose and it is identical on every page, so it
 * should be fetched once ever rather than revalidated hourly.
 *
 * `scripts/copy-fonts.ts` puts the files here at build time and writes the
 * `_headers` that tells Workers Assets about the caching; `src/server/main.ts`
 * states the same rule for the Bun host, both from the constants below.
 */

/** Everything under here is named by version and may be cached forever. */
export const FONT_ROUTE_PREFIX = "/assets/fonts/";

/** A year, the maximum `max-age` anything is worth setting. */
export const FONT_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Absolute, so it resolves the same from a page, an iframe, or the `srcdoc`
 * document the revision editor previews into — which has origin `null` and
 * would resolve a relative URL against nothing.
 */
export function fontHref(file: string): string {
  return `${FONT_ROUTE_PREFIX}${file}`;
}
