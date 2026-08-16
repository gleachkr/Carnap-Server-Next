import { describe, expect, test } from "bun:test";

import { FONT_ROUTE_PREFIX } from "../src/worker/web/fonts";
import { MATH_FONT_HREF } from "../src/worker/web/math-font";
import { CONTENT_STYLES } from "../src/worker/web/styles";
import {
  UI_FONTS,
  uiFontFile,
  uiFontSource,
} from "../src/worker/web/ui-fonts";

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
    const files = UI_FONTS.flatMap((font) =>
      font.subsets.map((subset) => uiFontFile(font, subset)),
    );

    expect(new Set(files).size).toBe(files.length);

    for (const font of UI_FONTS) {
      for (const subset of font.subsets) {
        expect(uiFontFile(font, subset)).toContain(font.version);
      }
    }
  });
});
