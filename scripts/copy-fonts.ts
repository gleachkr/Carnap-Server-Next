/**
 * Put the fonts where the pages ask for them, and tell Cloudflare they may be
 * cached forever.
 *
 * Part of `build:client`, beside the `cp` that places the Aufbau WASM. Three
 * things are generated rather than committed because `public/` is build output:
 * the versioned font files themselves, and a `_headers` file, which is how
 * Workers Assets is told anything about a response. Without it the platform's
 * default applies — `max-age=0, must-revalidate` — and every page load spends a
 * round trip revalidating files that are named after their own version and
 * therefore cannot have changed. That file is also where the static assets get
 * their `nosniff`, since Cloudflare answers for them before the worker (and its
 * security-headers middleware) runs.
 *
 * The rule is scoped to `/assets/fonts/*` rather than `/assets/*` on purpose:
 * the client bundles beside it are *not* content-addressed (`editor-preview.js`
 * keeps its name across deploys), so telling a browser to keep those for a year
 * would strand returning readers on last month's JavaScript.
 *
 * Two kinds of check run here rather than at read time, because the failure
 * they prevent is a 404 or an unpainted character in a reader's browser and the
 * only place to notice it is the build: that each package is the version the
 * URL claims, and — for the interface families, whose subsetting is Google's
 * and not ours — that the `unicode-range` we serve is still the one the
 * installed package cuts the file to.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import garamondPackage from "../node_modules/@fontsource-variable/eb-garamond/package.json";
import firaPackage from "../node_modules/@fontsource-variable/fira-code/package.json";
import interPackage from "../node_modules/@fontsource-variable/inter/package.json";
import stixPackage from "../node_modules/@fontsource/stix-two-math/package.json";
import { NOSNIFF_HEADER } from "../src/worker/middleware/security-headers";
import { FONT_CACHE_CONTROL, FONT_ROUTE_PREFIX } from "../src/worker/web/fonts";
import { MATH_FONT_FILE, MATH_FONT_VERSION } from "../src/worker/web/math-font";
import {
  type FontSubset,
  subsetRange,
  UI_FONTS,
  type UiFont,
  uiFontFile,
  uiFontSource,
} from "../src/worker/web/ui-fonts";

const MATH_FONT_SOURCE =
  "node_modules/@fontsource/stix-two-math/files/stix-two-math-latin-400-normal.woff2";
const DESTINATION = join("public", FONT_ROUTE_PREFIX.replace(/^\//, ""));

/** The installed versions, by package name as `ui-fonts.ts` spells it. */
const INSTALLED_VERSIONS: Record<string, string> = {
  "eb-garamond": garamondPackage.version,
  "fira-code": firaPackage.version,
  inter: interPackage.version,
};

async function copy(source: string, file: string): Promise<void> {
  const font = Bun.file(source);

  if (!(await font.exists())) {
    throw new Error(`Font not found at ${source}. Run \`bun install\`.`);
  }

  const target = join(DESTINATION, file);
  await mkdir(dirname(target), { recursive: true });
  await Bun.write(target, font);
}

/**
 * What the package's own stylesheet says each subset is cut to. Read rather
 * than trusted: fontsource regenerates these from Google, and a re-cut range is
 * invisible until a reader meets a character on the wrong side of it.
 */
async function installedRanges(font: UiFont): Promise<Map<string, string>> {
  const css = await Bun.file(
    `node_modules/@fontsource-variable/${font.package}/wght.css`,
  ).text();
  const ranges = new Map<string, string>();

  for (const face of css.matchAll(
    /src: url\(\.\/files\/([^)]+)\)[^;]+;\s*unicode-range: ([^;]+);/g,
  )) {
    const subset = face[1]
      .replace(`${font.package}-`, "")
      .replace("-wght-normal.woff2", "");
    ranges.set(subset, face[2].trim());
  }

  return ranges;
}

async function copyUiFont(font: UiFont): Promise<void> {
  const installed = INSTALLED_VERSIONS[font.package];

  if (installed !== font.version) {
    throw new Error(
      `@fontsource-variable/${font.package} is ${installed} but ui-fonts.ts says ${font.version}. ` +
        "Update src/worker/web/ui-fonts.ts — the version is in the URL, so a stale one serves a 404.",
    );
  }

  const ranges = await installedRanges(font);
  const shipped = [...ranges.keys()].sort().join(" ");
  const declared = [...font.subsets].sort().join(" ");

  if (shipped !== declared) {
    throw new Error(
      `@fontsource-variable/${font.package} ships subsets [${shipped}] but ui-fonts.ts declares [${declared}]. ` +
        "A subset we do not serve is a character a reader sees in a fallback face; decide, then update ui-fonts.ts.",
    );
  }

  for (const subset of font.subsets) {
    const range = ranges.get(subset);

    if (range !== subsetRange(subset as FontSubset)) {
      throw new Error(
        `@fontsource-variable/${font.package} cuts ${subset} to "${range}" but ui-fonts.ts declares ` +
          `"${subsetRange(subset as FontSubset)}". Update SUBSET_RANGES in src/worker/web/ui-fonts.ts.`,
      );
    }

    await copy(uiFontSource(font, subset), uiFontFile(font, subset));
  }
}

if (stixPackage.version !== MATH_FONT_VERSION) {
  throw new Error(
    `@fontsource/stix-two-math is ${stixPackage.version} but MATH_FONT_VERSION says ${MATH_FONT_VERSION}. ` +
      "Update src/worker/web/math-font.ts — the version is in the URL, so a stale one serves a 404.",
  );
}

await copy(MATH_FONT_SOURCE, MATH_FONT_FILE);

for (const font of UI_FONTS) {
  await copyUiFont(font);
}

// `nosniff` over everything under `/assets`, because these are the responses
// the worker's security-headers middleware cannot reach — Workers Assets
// answers for them before the worker runs at all. Everything in `public/` lives
// under this prefix, so one rule covers the lot; the fonts' caching rule stays
// narrow for the reason above.
await writeFile(
  join("public", "_headers"),
  `${FONT_ROUTE_PREFIX}*\n  Cache-Control: ${FONT_CACHE_CONTROL}\n` +
    `\n/assets/*\n  ${NOSNIFF_HEADER.name}: ${NOSNIFF_HEADER.value}\n`,
);
