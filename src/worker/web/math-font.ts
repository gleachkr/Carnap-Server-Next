/**
 * The math font, and where it is served from.
 *
 * MathML is drawn by the browser, and a browser draws it acceptably only with a
 * font that carries an OpenType MATH table — the one that says how far a brace
 * may stretch and where a radical's bar sits. Without one, every fraction, root
 * and matrix is assembled out of guesses. None of the fonts a machine reliably
 * has is such a font, so the platform ships one.
 *
 * STIX Two Math, because it is the only serious candidate on npm: it arrives as
 * an ordinary dependency and `scripts/copy-math-font.ts` copies it the way
 * `build:client` already copies the Aufbau WASM, so there is no vendored binary
 * in the tree and nothing to fetch from a CDN at read time. Instructors who want
 * a different one — New Computer Modern, for a page that should look like TeX —
 * override `math { font-family }` from a `:::style` block.
 *
 * The version is in the URL so the response can honestly say `immutable`, which
 * is the same bargain `style-assets.ts` makes with its content hashes. A font is
 * the largest thing a reader fetches for a page of prose, and it is identical on
 * every page, so it should be fetched once ever rather than revalidated hourly.
 */

/**
 * Checked against the installed package at build time, so that bumping the
 * dependency without bumping this fails the build rather than serving a URL
 * with nothing behind it.
 */
export const MATH_FONT_VERSION = "5.3.0";

export const MATH_FONT_FILE = `stix-two-math-${MATH_FONT_VERSION}.woff2`;

/**
 * Absolute, so it resolves the same from a page, an iframe, or the `srcdoc`
 * document the revision editor previews into — which has origin `null` and
 * would resolve a relative URL against nothing.
 */
export const MATH_FONT_HREF = `/assets/fonts/${MATH_FONT_FILE}`;

/** Everything under here is named by version and may be cached forever. */
export const FONT_ROUTE_PREFIX = "/assets/fonts/";

/** A year, the maximum `max-age` anything is worth setting. */
export const FONT_CACHE_CONTROL = "public, max-age=31536000, immutable";
