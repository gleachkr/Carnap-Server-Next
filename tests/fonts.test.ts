import { describe, expect, test } from "bun:test";

import { FONT_ROUTE_PREFIX } from "../src/worker/web/fonts";
import { MATH_FONT_HREF } from "../src/worker/web/math-font";
import { CONTENT_STYLES } from "../src/worker/web/styles";
import {
  UI_FONTS,
  uiFontFile,
  uiFontSource,
  WHOLE_FONTS,
  wholeFontFile,
} from "../src/worker/web/ui-fonts";
import { unpaintedBy } from "./helpers/woff2-cmap";

/**
 * The operators a student meets, gathered from `src/worker/logic/theories`:
 * every connective and quantifier the built-in languages declare, the
 * turnstile, and the arrows the chrome and the widgets' key hints use.
 *
 * Not in the list, and deliberately: `≐ ≗ ≜ ⟚`, MM0's own relations. Fira Code
 * does not carry them and they appear in exactly one place — an `aufbau-mm0`
 * block with `show`, quoting the artifact verbatim — so they fall back, and a
 * reader who has opened the theory panel is reading MM0 source rather than
 * their own language. Adding them here would be asking the wrong font.
 */
const OPERATORS = "¬∀∃∧∨→↔⊃≡≠⊢⊤⊥←↑↓";

/**
 * The fonts are served from this origin, and these are the assertions that keep
 * them that way. The bug they answer is not hypothetical: a Google-hosted font
 * URL was withdrawn under a stylesheet readers had already cached, and the
 * console filled with download failures nothing on our side could fix.
 *
 * Two things can rot here — a declaration naming a file the package does not
 * ship, and a page quietly reacquiring a third-party font link — and neither is
 * visible without looking at the network panel of a browser that happens to be
 * missing the font locally. So both are checked.
 */
describe("fonts", () => {
  const faces = [...CONTENT_STYLES.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(
    (match) => match[1] ?? "",
  );

  test("every declared subset has a face in the shared layer", () => {
    for (const font of UI_FONTS) {
      for (const subset of font.subsets) {
        const href = `${FONT_ROUTE_PREFIX}${uiFontFile(font, subset)}`;
        const face = faces.find((body) => body.includes(href));

        expect(face).toBeDefined();
        expect(face).toContain(`font-family: "${font.family}"`);
        expect(face).toContain(`font-weight: ${font.weight}`);
        // Without a range the browser downloads every subset for any page.
        expect(face).toContain("unicode-range:");
      }
    }

    expect(faces.some((body) => body.includes(MATH_FONT_HREF))).toBe(true);
  });

  test("every declared subset is a file the package actually ships", async () => {
    for (const font of UI_FONTS) {
      for (const subset of font.subsets) {
        const source = uiFontSource(font, subset);

        expect(await Bun.file(source).exists()).toBe(true);
      }
    }

    for (const font of WHOLE_FONTS) {
      expect(await Bun.file(font.source).exists()).toBe(true);
    }
  });

  test("a whole family has a face, and no range to narrow it", () => {
    for (const font of WHOLE_FONTS) {
      const href = `${FONT_ROUTE_PREFIX}${wholeFontFile(font)}`;
      const face = faces.find((body) => body.includes(href));

      expect(face).toBeDefined();
      expect(face).toContain(`font-family: "${font.family}"`);
      expect(face).toContain(`font-weight: ${font.weight}`);
      expect(face).not.toContain("unicode-range:");
    }
  });

  /**
   * The reason Fira Code is served whole, stated as the thing that would break
   * if it were not.
   *
   * Google's subsetter partitions by script and none of its scripts is
   * mathematics, so `@fontsource-variable/fira-code` — which this platform did
   * ship, for months — carries `¬` (U+00AC, along for the ride in Latin-1) and
   * not one other operator. The effect is invisible to whoever chose the font:
   * their machine has a system fallback, so the quantifiers render, in a face
   * nobody picked and a different one per platform. Upstream Fira Code has all
   * of them.
   *
   * This asserts the coverage rather than the package name, because coverage is
   * what is actually wanted — a future move to a family that has the glyphs
   * should pass, and a move back to one that does not should fail here rather
   * than in a reader's browser.
   */
  test("the served families paint every operator a student can meet", async () => {
    for (const font of WHOLE_FONTS) {
      const file = await Bun.file(font.source).bytes();

      expect(`${font.family}: ${unpaintedBy(file, OPERATORS)}`).toBe(
        `${font.family}: `,
      );
    }
  });

  test("the shared layer asks no other origin for a font", () => {
    for (const face of faces) {
      expect(face).toMatch(
        new RegExp(`src: url\\("${FONT_ROUTE_PREFIX}[^"]+\\.woff2"\\)`),
      );
    }

    // The URLs the platform used to carry, named so that reintroducing either
    // fails here rather than in a reader's console.
    expect(CONTENT_STYLES).not.toContain("fonts.googleapis.com");
    expect(CONTENT_STYLES).not.toContain("fonts.gstatic.com");
  });

  test("each served file is named once, and by version", () => {
    const files = [
      ...UI_FONTS.flatMap((font) =>
        font.subsets.map((subset) => uiFontFile(font, subset)),
      ),
      ...WHOLE_FONTS.map(wholeFontFile),
    ];

    expect(new Set(files).size).toBe(files.length);

    for (const font of UI_FONTS) {
      for (const subset of font.subsets) {
        expect(uiFontFile(font, subset)).toContain(font.version);
      }
    }

    for (const font of WHOLE_FONTS) {
      expect(wholeFontFile(font)).toContain(font.version);
    }
  });
});
