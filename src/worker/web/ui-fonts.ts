/**
 * The three families the interface is set in, served from this origin.
 *
 * They used to come from Google Fonts — two `preconnect`s and a render-blocking
 * stylesheet in every page's head. That is a dependency on a third party for
 * something the platform cannot do without, and it failed in all three of the
 * ways such a dependency fails:
 *
 * - **The URLs rot.** Google's stylesheet is cacheable and its font URLs are
 *   not permanent; a reader holding a day-old copy of the stylesheet was asking
 *   `fonts.gstatic.com` for a file that had been withdrawn and getting a 404,
 *   with nothing on our side to fix. This is the report that prompted the move.
 * - **They are blocked.** A content blocker, Firefox's strict tracking
 *   protection, a school proxy or a national firewall all refuse
 *   `fonts.gstatic.com`, and the whole interface then falls back to system type.
 * - **They are a disclosure.** Every page view told Google the reader's IP and
 *   user agent. `Referrer-Policy` kept the path off the wire (see
 *   `../middleware/security-headers`), which was as far as that could be taken
 *   while the request was made at all.
 *
 * Self-hosting answers all three, and costs one dependency per family and a
 * `cp` in `build:client`. The files are ordinary npm packages, copied by
 * `scripts/copy-fonts.ts` beside the math font and the Aufbau WASM, so there is
 * no vendored binary in the tree.
 *
 * **Variable fonts, one file per subset.** Google served a static instance per
 * weight; fontsource ships the variable font, which is one file covering the
 * whole axis — fewer requests than the weights we asked for, and any weight in
 * range is then available to a stylesheet without a new download. The families
 * are declared under their plain names (`Inter`, not fontsource's `Inter
 * Variable`), because that is what `--body-font` and the widgets already ask
 * for and a reader with the font installed locally should get theirs.
 *
 * **Every subset the packages ship**, not just `latin`. `unicode-range` is what
 * makes that free: a browser fetches a subset only when the page actually puts
 * a character from it on screen, so a reader of English prose downloads the
 * same three files they would have from Google, and a lesson quoting Greek —
 * φ and ψ are ordinary metavariables here — or Cyrillic still gets real type.
 * Dropping a subset would be a silent regression against what Google served.
 */

import { fontHref } from "./fonts";

/**
 * The subsets, which are Google's and carry the same ranges in all three
 * packages — asserted against the installed CSS by `scripts/copy-fonts.ts`, so
 * a version bump that re-cuts them fails the build instead of quietly leaving
 * characters unpainted.
 */
const SUBSET_RANGES = {
  cyrillic: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116",
  "cyrillic-ext":
    "U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F",
  greek: "U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF",
  "greek-ext": "U+1F00-1FFF",
  latin:
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  "latin-ext":
    "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
  /* Box drawing and the vertical-line pieces, which is what a proof widget
     rules its scope lines with. */
  symbols2: "U+2000-2001,U+2004-2008,U+200A,U+23B8-23BD,U+2500-259F",
  vietnamese:
    "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB",
} as const;

export type FontSubset = keyof typeof SUBSET_RANGES;

export type UiFont = {
  /** The name stylesheets ask for, and the name a local install would have. */
  readonly family: string;
  /** The package under `@fontsource-variable/`, and the file-name stem. */
  readonly package: string;
  /** Checked against the installed package at build time. */
  readonly version: string;
  /** The variable font's weight axis, spelled as `font-weight` wants it. */
  readonly weight: string;
  /** Every subset the package ships for the upright weight axis. */
  readonly subsets: readonly FontSubset[];
};

const WESTERN_SUBSETS = [
  "cyrillic",
  "cyrillic-ext",
  "greek",
  "greek-ext",
  "latin",
  "latin-ext",
] as const;

export const UI_FONTS: readonly UiFont[] = [
  {
    family: "EB Garamond",
    package: "eb-garamond",
    version: "5.3.0",
    weight: "400 800",
    subsets: [...WESTERN_SUBSETS, "vietnamese"],
  },
  {
    family: "Fira Code",
    package: "fira-code",
    version: "5.3.0",
    weight: "300 700",
    subsets: [...WESTERN_SUBSETS, "symbols2"],
  },
  {
    family: "Inter",
    package: "inter",
    version: "5.3.0",
    weight: "100 900",
    subsets: [...WESTERN_SUBSETS, "vietnamese"],
  },
];

/** Where the copy script reads a subset from, inside the installed package. */
export function uiFontSource(font: UiFont, subset: FontSubset): string {
  return (
    `node_modules/@fontsource-variable/${font.package}/files/` +
    `${font.package}-${subset}-wght-normal.woff2`
  );
}

/** And what it is served as: the same file, with its version in the name. */
export function uiFontFile(font: UiFont, subset: FontSubset): string {
  return `${font.package}-${font.version}-${subset}.woff2`;
}

/**
 * The `@font-face` rules, which live in the shared content layer rather than in
 * a sheet of their own: it is the one stylesheet both the app shell and a
 * content document load, and a font declared in a document is available to the
 * shadow roots inside it, which is where the proof widgets ask for Fira Code.
 *
 * `swap` because prose a reader can read in the wrong face beats prose they
 * cannot read at all, and because the fallbacks below each family are chosen to
 * be close enough that the swap is not a lurch.
 */
export const UI_FONT_FACES = UI_FONTS.flatMap((font) =>
  font.subsets.map(
    (subset) => `
  @font-face {
    font-display: swap;
    font-family: "${font.family}";
    font-weight: ${font.weight};
    src: url("${fontHref(uiFontFile(font, subset))}") format("woff2");
    unicode-range: ${SUBSET_RANGES[subset]};
  }`,
  ),
).join("\n");

/** The declared range for a subset, for the build-time check against fontsource. */
export function subsetRange(subset: FontSubset): string {
  return SUBSET_RANGES[subset];
}
