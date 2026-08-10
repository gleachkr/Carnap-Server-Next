/**
 * Put the math font where the content documents ask for it, and tell Cloudflare
 * it may be cached forever.
 *
 * Part of `build:client`, beside the `cp` that places the Aufbau WASM. Two
 * things are generated rather than committed because `public/` is build output:
 * the versioned font file itself, and a `_headers` file, which is how Workers
 * Assets is told anything about a response. Without it the platform's default
 * applies — `max-age=0, must-revalidate` — and every page load spends a round
 * trip revalidating a 396 KB file that is named after its own version and
 * therefore cannot have changed. That file is also where the static assets get
 * their `nosniff`, since Cloudflare answers for them before the worker (and its
 * security-headers middleware) runs.
 *
 * The rule is scoped to `/assets/fonts/*` rather than `/assets/*` on purpose:
 * the client bundles beside it are *not* content-addressed (`editor-preview.js`
 * keeps its name across deploys), so telling a browser to keep those for a year
 * would strand returning readers on last month's JavaScript.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import packageJson from "../node_modules/@fontsource/stix-two-math/package.json";
import { NOSNIFF_HEADER } from "../src/worker/middleware/security-headers";
import {
  FONT_CACHE_CONTROL,
  FONT_ROUTE_PREFIX,
  MATH_FONT_FILE,
  MATH_FONT_VERSION,
} from "../src/worker/web/math-font";

const SOURCE =
  "node_modules/@fontsource/stix-two-math/files/stix-two-math-latin-400-normal.woff2";
const DESTINATION = join("public", FONT_ROUTE_PREFIX.replace(/^\//, ""));

if (packageJson.version !== MATH_FONT_VERSION) {
  throw new Error(
    `@fontsource/stix-two-math is ${packageJson.version} but MATH_FONT_VERSION says ${MATH_FONT_VERSION}. ` +
      "Update src/worker/web/math-font.ts — the version is in the URL, so a stale one serves a 404.",
  );
}

const font = Bun.file(SOURCE);

if (!(await font.exists())) {
  throw new Error(`Math font not found at ${SOURCE}. Run \`bun install\`.`);
}

const target = join(DESTINATION, MATH_FONT_FILE);

await mkdir(dirname(target), { recursive: true });
await Bun.write(target, font);

// `nosniff` over everything under `/assets`, because these are the responses
// the worker's security-headers middleware cannot reach — Workers Assets
// answers for them before the worker runs at all. Everything in `public/` lives
// under this prefix, so one rule covers the lot; the font's caching rule stays
// narrow for the reason above.
await writeFile(
  join("public", "_headers"),
  `${FONT_ROUTE_PREFIX}*\n  Cache-Control: ${FONT_CACHE_CONTROL}\n` +
    `\n/assets/*\n  ${NOSNIFF_HEADER.name}: ${NOSNIFF_HEADER.value}\n`,
);
