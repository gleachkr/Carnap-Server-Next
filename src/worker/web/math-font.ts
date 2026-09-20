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
 * an ordinary dependency and `scripts/copy-fonts.ts` copies it the way
 * `build:client` already copies the Aufbau WASM, so there is no vendored binary
 * in the tree and nothing to fetch from a CDN at read time. Instructors who want
 * a different one — New Computer Modern, for a page that should look like TeX —
 * override `math { font-family }` from a `:::style` block.
 *
 * The version is in the URL, for the reason `./fonts` gives.
 */

import { fontHref } from "./fonts";

/**
 * Checked against the installed package at build time, so that bumping the
 * dependency without bumping this fails the build rather than serving a URL
 * with nothing behind it.
 */
export const MATH_FONT_VERSION = "5.3.0";

export const MATH_FONT_FILE = `stix-two-math-${MATH_FONT_VERSION}.woff2`;

export const MATH_FONT_HREF = fontHref(MATH_FONT_FILE);

/**
 * The `@font-face` itself, generated here rather than written in
 * `./content.css` because the URL carries the font package's version
 * (`./fonts`) and a stylesheet has nowhere to read one. `./styles` joins it into the content layer beside
 * the interface families, which are generated for the same reason.
 *
 * A rule that *uses* the family — `math { font-family }` — is ordinary CSS and
 * stays in the stylesheet. Only the declaration has to be built.
 */
export const MATH_FONT_FACE = `@font-face {
  font-display: swap;
  font-family: "STIX Two Math";
  src: url("${MATH_FONT_HREF}") format("woff2");
}`;
