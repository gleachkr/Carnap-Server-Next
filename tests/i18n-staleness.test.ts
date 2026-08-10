import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { checkStaleness } from "../scripts/i18n-check";

/**
 * The committed catalogs must be what the current source extracts to.
 *
 * Nothing else notices when they are not, and both directions do damage. A new
 * `i18n.t("…")` whose id never reached a catalog renders as clean English in
 * every locale — which looks correct to anyone testing in English, and reaches
 * no translator. An id no call site passes any more is still *compiled and
 * shipped*, and one carrying the ICU apostrophe bug will sit there tripping the
 * placeholder sweep over prose nothing renders. `tests/i18n-extraction.test.ts`
 * catches the first case at the call site; this catches both, plus a
 * `messages.ts` left behind by a `.po` edit that was never recompiled.
 *
 * This is the same question `bun run i18n:check` answers, over the same code
 * (`scripts/i18n-check.ts`), which is how `bun run validate` covers it without
 * the script joining the command chain. Run the command for the readable
 * report: this test names the stale file, the script names the messages.
 */

const ROOT = resolve(import.meta.dir, "..");
const CATALOG_PATHS = ["en", "de", "en-XA"].flatMap((locale) =>
  ["messages.po", "messages.ts"].map((name) =>
    join(ROOT, "src", "locales", locale, name),
  ),
);

/**
 * The bytes of every committed catalog. Compared before and after, this is the
 * *whole* claim of the second test: not that `src/locales/` is clean — a reader
 * may well be part-way through a translation — but that running the check left
 * it exactly as it found it.
 */
function catalogBytes(): Record<string, string | null> {
  return Object.fromEntries(
    CATALOG_PATHS.map((path) => [
      path,
      existsSync(path) ? readFileSync(path, "utf8") : null,
    ]),
  );
}

// One extraction of all of `src/` plus three compiles, at module load, so the
// tests below read a single run rather than paying for it twice.
const before = catalogBytes();
const work = mkdtempSync(join(tmpdir(), "carnap-i18n-test-"));
let result: ReturnType<typeof checkStaleness>;

try {
  result = checkStaleness(work);
} finally {
  rmSync(work, { force: true, recursive: true });
}

const after = catalogBytes();

describe("catalog staleness", () => {
  test("the committed catalogs match what the source extracts to", () => {
    // `bun run i18n:check` prints which messages moved. The fix is `bun run i18n`.
    expect(
      result.diffs.map((diff) => `src/locales/${diff.locale}/${diff.name}`),
    ).toEqual([]);
    expect(result.code).toBe(0);
  });

  test("checking leaves the committed catalogs untouched", () => {
    expect(after).toEqual(before);
  });
});
